/**
 * 均一オーバーレイではなく、輝度・被写界深度（ピント前後）に応じて強度を変えるフィルムグレイン。
 * BokehPass の深度テクスチャと同じ focus/aperture/maxblur でボケ量を推定する。
 * 合焦域に粒を乗せすぎないよう、dofMod／focusSharp 項は控えめ。
 */

import { ShaderMaterial, UniformsUtils } from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const SensorFilmGrainShader = {
    name: 'SensorFilmGrainShader',

    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0.0 },
        intensity: { value: 0.5 },
        grayscale: { value: false },
        /** 0〜1: RGB を別乱数で振るセンサー／フィルムの色ノイズ（クロマ粒） */
        uColorNoise: { value: 0.0 },
        uUseDepth: { value: 0.0 },
        tDepth: { value: null },
        focus: { value: 1.0 },
        aperture: { value: 0.000005 },
        maxblur: { value: 0.003 },
        aspect: { value: 1.0 },
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

        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float intensity;
        uniform bool grayscale;
        uniform float uColorNoise;

        uniform float uUseDepth;
        uniform sampler2D tDepth;
        uniform float focus;
        uniform float aperture;
        uniform float maxblur;
        uniform float aspect;
        uniform float nearClip;
        uniform float farClip;

        varying vec2 vUv;

        float sampleDepth(vec2 uv) {
            return unpackRGBAToDepth(texture2D(tDepth, uv));
        }

        float viewZFromDepth(float depth) {
            return perspectiveDepthToViewZ(depth, nearClip, farClip);
        }

        void main() {
            vec4 base = texture2D(tDiffuse, vUv);

            float luma = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
            // 暗部でやや強く、明部で弱く（ショットノイズに近い分布）
            float lumMod = mix(1.2, 0.74, smoothstep(0.02, 0.9, luma));

            float dofMod = 1.0;
            float focusSharp = 0.0;
            if (uUseDepth > 0.5) {
                float vz = viewZFromDepth(sampleDepth(vUv));
                float factor = focus + vz;
                float blurAmt = abs(clamp(factor * aperture, -maxblur, maxblur));
                // ボケ域は粒が潰れるので弱め。
                // 合焦域（blurAmt が 0 に近い）でノイズを濃くする。
                float t = smoothstep(0.0, maxblur * 0.9, blurAmt);
                
                // t=0 (ピント面) で 1.4, t=1 (ボケ面) で 0.5 になるように調整
                dofMod = mix(1.4, 0.5, t); 
                focusSharp = 1.0 - t;
            }

            float spatial = clamp(intensity * lumMod * dofMod, 0.0, 1.0);

            float n1 = rand(fract(vUv * 1337.0 + vec2(time * 0.41, time * 0.29)));
            float n2 = rand(fract(vUv * 2683.0 + vec2(time * -0.17, time * 0.53)));
            float n3 = rand(fract(vUv * 5011.0 + vec2(time * 0.11, time * -0.07)));
            // 合焦域の超高周波は弱め（ピント面だけノイズが目立つのを防ぐ）
            float noise = n1 * 0.52 + n2 * 0.33 + n3 * 0.15 + focusSharp * 0.05 * (n3 - 0.5);

            float cr = rand(fract(vUv * 7919.0 + vec2(time * 0.31, time * 0.19)));
            float cg = rand(fract(vUv * 8923.0 + vec2(time * -0.23, time * 0.41)));
            float cb = rand(fract(vUv * 9823.0 + vec2(time * 0.17, time * -0.29)));
            vec3 chroma = (vec3(cr, cg, cb) - 0.5) * 2.0;

            vec3 grainMul = vec3(clamp(0.1 + noise, 0.0, 1.0));
            grainMul = grainMul + chroma * uColorNoise * 0.32;
            grainMul = clamp(grainMul, 0.0, 1.85);

            vec3 grainLayer = base.rgb + base.rgb * grainMul;
            vec3 color = mix(base.rgb, grainLayer, spatial);

            if (grayscale) {
                color = vec3(luminance(color));
            }

            gl_FragColor = vec4(color, base.a);
        }
    `
};

export class SensorFilmGrainPass extends Pass {
    /**
     * @param {number} [intensity=0.35]
     * @param {boolean} [grayscale=false]
     * @param {number} [colorNoise=0] - 0〜1、RGB を別乱数にする色ノイズの強さ
     */
    constructor(intensity = 0.35, grayscale = false, colorNoise = 0) {
        super();

        const shader = SensorFilmGrainShader;
        this.uniforms = UniformsUtils.clone(shader.uniforms);
        this.uniforms.intensity.value = intensity;
        this.uniforms.grayscale.value = grayscale;
        this.uniforms.uColorNoise.value = Math.max(0, Math.min(1, colorNoise));

        this.material = new ShaderMaterial({
            name: shader.name,
            uniforms: this.uniforms,
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader
        });

        this.fsQuad = new FullScreenQuad(this.material);

        /** @type {import('three/examples/jsm/postprocessing/BokehPass.js').BokehPass | null} */
        this._bokehPass = null;
        /** @type {() => boolean} */
        this._useDepthTest = () => false;
    }

    /**
     * BokehPass から深度と DOF パラメータを毎フレーム同期する
     * @param {import('three/examples/jsm/postprocessing/BokehPass.js').BokehPass} bokehPass
     * @param {() => boolean} useDepthWhen - 深度を使う条件（例: useDOF && bokehPass.enabled）
     */
    bindBokehPass(bokehPass, useDepthWhen) {
        this._bokehPass = bokehPass;
        this._useDepthTest = useDepthWhen;
    }

    render(renderer, writeBuffer, readBuffer, deltaTime) {
        this.uniforms.tDiffuse.value = readBuffer.texture;
        this.uniforms.time.value += deltaTime;

        const bp = this._bokehPass;
        const depthOk = bp && this._useDepthTest();
        if (depthOk) {
            const u = bp.uniforms;
            this.uniforms.uUseDepth.value = 1.0;
            this.uniforms.tDepth.value = bp.renderTargetDepth.texture;
            this.uniforms.focus.value = u.focus.value;
            this.uniforms.aperture.value = u.aperture.value;
            this.uniforms.maxblur.value = u.maxblur.value;
            this.uniforms.aspect.value = u.aspect.value;
            this.uniforms.nearClip.value = u.nearClip.value;
            this.uniforms.farClip.value = u.farClip.value;
        } else {
            this.uniforms.uUseDepth.value = 0.0;
        }

        if (this.renderToScreen) {
            renderer.setRenderTarget(null);
            this.fsQuad.render(renderer);
        } else {
            renderer.setRenderTarget(writeBuffer);
            if (this.clear) renderer.clear();
            this.fsQuad.render(renderer);
        }
    }

    setSize() {
        // 解像度依存の uniform なし（Bokeh 側が aspect を更新）
    }

    dispose() {
        this.material.dispose();
        this.fsQuad.dispose();
    }
}
