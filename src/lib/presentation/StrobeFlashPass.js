import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const strobeFlashShader = {
    uniforms: {
        tDiffuse: { value: null },
        uFlash: { value: 0.0 }
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uFlash;
        varying vec2 vUv;
        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            // 塗りつぶしを完全に廃止して、物理ライトの照り返しのみで見せる！
            vec3 col = tex.rgb;
            gl_FragColor = vec4(col, tex.a);
        }
    `
};

/**
 * 最終合成に近い全画面ホワイトフラッシュ（トラック2ストロボ用）。
 * {@link setupPostEffectsPipeline} のフィルムグレインより後に載せる想定。
 * @param {{ composer?: import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer, strobeFlashPass?: ShaderPass | null }} host
 */
export function attachStrobeFlashPass(host) {
    if (!host?.composer) return;
    if (host.strobeFlashPass) return;
    host.strobeFlashPass = new ShaderPass(strobeFlashShader);
    host.strobeFlashPass.enabled = true;
    host.composer.addPass(host.strobeFlashPass);
}

/**
 * @param {{ composer?: object, strobeFlashPass?: ShaderPass | null }} host
 */
export function disposeStrobeFlashPass(host) {
    if (!host?.strobeFlashPass) return;
    if (host.composer) {
        const idx = host.composer.passes.indexOf(host.strobeFlashPass);
        if (idx !== -1) host.composer.passes.splice(idx, 1);
    }
    if (host.strobeFlashPass.material) host.strobeFlashPass.material.dispose();
    host.strobeFlashPass = null;
}
