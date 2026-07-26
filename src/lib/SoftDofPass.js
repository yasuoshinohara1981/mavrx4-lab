/**
 * 軽量な被写界深度（DOF）パス。three の `BokehPass` の置き換え。
 *
 * `BokehPass` が重い理由は2つある:
 *   1. ボケ合成シェーダーが **1画素あたり41回** も `texture2D` を撃つ（ピント面でも撃つ）
 *   2. 深度用にシーンを丸ごと再描画する RT がフル解像度
 *
 * ここでは
 *   - ピントが合っている画素は **中心1サンプルで即リターン**（画面の大半がこれで済む）
 *   - ボケる画素も **13サンプル**（2リング）に抑える
 *   - 深度 RT は `depthScale` 倍（既定 0.5）で描く。ボケ量の判定にしか使わないので粗くて十分
 * とすることで、見た目のボケ味をほぼ保ったまま実測コストを大きく下げる。
 *
 * uniform 名は `BokehPass` と互換（focus / aperture / maxblur / nearClip / farClip / aspect）なので、
 * オートフォーカス側のコードはそのまま使える。
 */

import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import {
    Color,
    HalfFloatType,
    MeshDepthMaterial,
    NearestFilter,
    NoBlending,
    RGBADepthPacking,
    ShaderMaterial,
    Vector2,
    WebGLRenderTarget
} from 'three';

const SoftDofShader = {
    uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        resolution: { value: new Vector2(1, 1) },
        focus: { value: 1.0 },
        aspect: { value: 1.0 },
        aperture: { value: 0.025 },
        maxblur: { value: 0.01 },
        nearClip: { value: 1.0 },
        farClip: { value: 1000.0 }
    },

    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>

        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float focus;
        uniform float aspect;
        uniform float aperture;
        uniform float maxblur;
        uniform float nearClip;
        uniform float farClip;

        varying vec2 vUv;

        void main() {
            float depth = unpackRGBAToDepth(texture2D(tDepth, vUv));
            float viewZ = perspectiveDepthToViewZ(depth, nearClip, farClip);
            // BokehPass と同じ式（viewZ は負値）
            float factor = focus + viewZ;
            float blur = clamp(factor * aperture, -maxblur, maxblur);
            float amt = abs(blur);

            vec4 center = texture2D(tColor, vUv);

            // ボケ半径が1画素を下回るなら合成しても結果が変わらない。
            // ピント面（画面のかなりの割合）がここで1サンプルで抜けるのが最大の節約
            float radiusPx = amt * 0.4 * resolution.x;
            if (radiusPx < 1.0) {
                gl_FragColor = center;
                return;
            }

            vec2 ac = vec2(1.0, aspect) * blur;

            // 内側リング（4）＋外側リング（8）。BokehPass の41タップ→13タップ
            vec4 col = center;
            col += texture2D(tColor, vUv + vec2( 0.18,  0.00) * ac);
            col += texture2D(tColor, vUv + vec2(-0.18,  0.00) * ac);
            col += texture2D(tColor, vUv + vec2( 0.00,  0.18) * ac);
            col += texture2D(tColor, vUv + vec2( 0.00, -0.18) * ac);

            col += texture2D(tColor, vUv + vec2( 0.40,  0.00) * ac);
            col += texture2D(tColor, vUv + vec2(-0.40,  0.00) * ac);
            col += texture2D(tColor, vUv + vec2( 0.00,  0.40) * ac);
            col += texture2D(tColor, vUv + vec2( 0.00, -0.40) * ac);
            col += texture2D(tColor, vUv + vec2( 0.28,  0.28) * ac);
            col += texture2D(tColor, vUv + vec2(-0.28,  0.28) * ac);
            col += texture2D(tColor, vUv + vec2( 0.28, -0.28) * ac);
            col += texture2D(tColor, vUv + vec2(-0.28, -0.28) * ac);

            col /= 13.0;

            // ボケ始めの境界が段差にならないよう、1〜2px の範囲は中心とブレンドする
            gl_FragColor = mix(center, col, clamp(radiusPx - 1.0, 0.0, 1.0));
        }
    `
};

export class SoftDofPass extends Pass {
    /**
     * @param {import('three').Scene} scene
     * @param {import('three').Camera} camera
     * @param {object} [params]
     * @param {number} [params.focus]
     * @param {number} [params.aperture]
     * @param {number} [params.maxblur]
     * @param {number} [params.depthScale=0.5] 深度RTの解像度倍率（ボケ量判定用なので粗くて可）
     */
    constructor(scene, camera, params = {}) {
        super();

        this.scene = scene;
        this.camera = camera;
        this.depthScale = params.depthScale ?? 0.5;

        this.renderTargetDepth = new WebGLRenderTarget(1, 1, {
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            type: HalfFloatType,
            depthBuffer: true,
            stencilBuffer: false
        });
        this.renderTargetDepth.texture.name = 'SoftDofPass.depth';

        this.materialDepth = new MeshDepthMaterial();
        this.materialDepth.depthPacking = RGBADepthPacking;
        this.materialDepth.blending = NoBlending;

        this.material = new ShaderMaterial({
            uniforms: {
                tColor: { value: null },
                tDepth: { value: this.renderTargetDepth.texture },
                resolution: { value: new Vector2(1, 1) },
                focus: { value: params.focus ?? 1.0 },
                aspect: { value: camera.aspect ?? 1.0 },
                aperture: { value: params.aperture ?? 0.025 },
                maxblur: { value: params.maxblur ?? 0.01 },
                nearClip: { value: camera.near },
                farClip: { value: camera.far }
            },
            vertexShader: SoftDofShader.vertexShader,
            fragmentShader: SoftDofShader.fragmentShader,
            depthTest: false,
            depthWrite: false
        });
        // BokehPass 互換（オートフォーカスが host.bokehPass.uniforms.focus を書く）
        this.uniforms = this.material.uniforms;

        this.fsQuad = new FullScreenQuad(this.material);
        this._oldClearColor = new Color();
    }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.uniforms;

        // --- 深度をテクスチャへ（縮小して描く：ボケ量の判定にしか使わない）---
        this.scene.overrideMaterial = this.materialDepth;

        renderer.getClearColor(this._oldClearColor);
        const oldClearAlpha = renderer.getClearAlpha();
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setClearColor(0xffffff);
        renderer.setClearAlpha(1.0);
        renderer.setRenderTarget(this.renderTargetDepth);
        renderer.clear();
        renderer.render(this.scene, this.camera);

        this.scene.overrideMaterial = null;
        renderer.setClearColor(this._oldClearColor);
        renderer.setClearAlpha(oldClearAlpha);
        renderer.autoClear = oldAutoClear;

        // --- ボケ合成 ---
        u.tColor.value = readBuffer.texture;
        u.nearClip.value = this.camera.near;
        u.farClip.value = this.camera.far;
        u.resolution.value.set(readBuffer.width, readBuffer.height);

        if (this.renderToScreen) {
            renderer.setRenderTarget(null);
            this.fsQuad.render(renderer);
        } else {
            renderer.setRenderTarget(writeBuffer);
            if (this.clear) renderer.clear();
            this.fsQuad.render(renderer);
        }
    }

    setSize(width, height) {
        this.uniforms.aspect.value = width / Math.max(1, height);
        const s = Math.min(1, Math.max(0.125, this.depthScale));
        this.renderTargetDepth.setSize(
            Math.max(1, Math.floor(width * s)),
            Math.max(1, Math.floor(height * s))
        );
    }

    dispose() {
        this.renderTargetDepth.dispose();
        this.materialDepth.dispose();
        this.material.dispose();
        this.fsQuad.dispose();
    }
}
