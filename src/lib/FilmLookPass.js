/**
 * グレイン直前の軽い仕上げ（色収差 / 任意でボックスぼかし混ぜ）。
 * ぼかし mix はピクセル格子と干渉しやすい。SceneBase は CA のみ（soften=0）で使う。
 */

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UniformsUtils, Vector2 } from 'three';

const FilmLookShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(1, 1) },
        caAmount: { value: 0.0 },
        soften: { value: 0.0 }
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
        uniform vec2 resolution;
        uniform float caAmount;
        uniform float soften;

        varying vec2 vUv;

        void main() {
            vec2 uv = vUv;
            vec2 px = vec2(1.0) / max(resolution, vec2(1.0));

            vec2 p = uv - 0.5;
            float dist = length(p);
            vec2 dir = dist > 1e-5 ? (p / dist) * caAmount * (0.78 + 0.14 * dist * dist) : vec2(0.0);

            float r = texture2D(tDiffuse, uv + dir).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - dir).b;
            vec3 sharp = vec3(r, g, b);

            vec3 color;
            if (soften < 0.0001) {
                color = sharp;
            } else {
                vec3 blur = (
                    texture2D(tDiffuse, uv + vec2(-px.x, -px.y)).rgb +
                    texture2D(tDiffuse, uv + vec2(0.0, -px.y)).rgb +
                    texture2D(tDiffuse, uv + vec2(px.x, -px.y)).rgb +
                    texture2D(tDiffuse, uv + vec2(-px.x, 0.0)).rgb +
                    texture2D(tDiffuse, uv).rgb +
                    texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb +
                    texture2D(tDiffuse, uv + vec2(-px.x, px.y)).rgb +
                    texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb +
                    texture2D(tDiffuse, uv + vec2(px.x, px.y)).rgb
                ) * (1.0 / 9.0);
                color = mix(sharp, blur, clamp(soften, 0.0, 1.0));
            }
            gl_FragColor = vec4(color, texture2D(tDiffuse, uv).a);
        }
    `
};

export class FilmLookPass extends ShaderPass {
    /**
     * @param {Object} [options]
     * @param {number} [options.caAmount=0] 色収差（0 でオフ）
     * @param {number} [options.soften=0] ボックスブラー寄せの混合（0=シャープのみ。縦横筋の原因になりやすい）
     */
    constructor(options = {}) {
        const shader = {
            uniforms: UniformsUtils.clone(FilmLookShader.uniforms),
            vertexShader: FilmLookShader.vertexShader,
            fragmentShader: FilmLookShader.fragmentShader
        };
        shader.uniforms.caAmount.value = options.caAmount ?? 0.0;
        shader.uniforms.soften.value = options.soften ?? 0.0;
        super(shader);
    }
}
