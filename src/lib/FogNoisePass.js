/**
 * シーンに FogExp2 は掛けず、カラー＋深度バッファから霧を合成する。
 * fogDensity に微弱な空間ノイズを乗せ、時間でゆっくり変化させる（Three.js 標準の FogExp2 と同式）。
 */
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderMaterial, UniformsUtils } from 'three';

const FogNoiseShader = {
    uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        hasDepth: { value: 1 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 10000 },
        fogColor: { value: null },
        fogDensity: { value: 0.00042 },
        time: { value: 0 },
        projectionMatrixInverse: { value: null },
        viewMatrixInverse: { value: null },
        noiseAmp: { value: 0.055 },
        noiseScale: { value: 0.00007 },
        timeScale: { value: 0.11 }
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform int hasDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec3 fogColor;
        uniform float fogDensity;
        uniform float time;
        uniform mat4 projectionMatrixInverse;
        uniform mat4 viewMatrixInverse;
        uniform float noiseAmp;
        uniform float noiseScale;
        uniform float timeScale;

        varying vec2 vUv;

        float triWave(float x) {
            return abs(fract(x) - 0.5);
        }

        /** -1〜1 付近のゆるい空間ノイズ（局所的な密度ムラ、激しく動かない） */
        float slowSpaceNoise(vec3 wp, float t) {
            vec3 p = wp * noiseScale;
            float t1 = t * timeScale;
            float s = 0.0;
            s += sin(p.x * 1.3 + p.y * 0.7 + p.z * 0.9 + t1 * 0.85);
            s += 0.55 * sin(p.x * 2.1 - p.z * 1.4 + p.y * 0.6 + t1 * 0.62 + 1.7);
            s += 0.32 * sin(dot(p, vec3(0.85, 1.1, 0.75)) * 1.9 + t1 * 0.48 + 0.3);
            s += 0.18 * triWave(p.x * 3.1 + triWave(p.y * 2.7 + triWave(p.z * 2.9 + t1 * 0.15)));
            return s * 0.28;
        }

        void main() {
            vec4 sceneColor = texture2D(tDiffuse, vUv);

            if (hasDepth == 0) {
                gl_FragColor = sceneColor;
                return;
            }

            float depth = texture2D(tDepth, vUv).x;
            vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            vec4 viewPos = projectionMatrixInverse * ndc;
            viewPos /= viewPos.w;
            float fogDepth = length(viewPos.xyz);

            vec4 worldPos = viewMatrixInverse * vec4(viewPos.xyz, 1.0);
            float n = slowSpaceNoise(worldPos.xyz, time);
            float d = fogDensity * (1.0 + noiseAmp * n);
            d = max(d, fogDensity * 0.35);

            float fogFactor = 1.0 - exp(-(d * d) * (fogDepth * fogDepth));
            fogFactor = clamp(fogFactor, 0.0, 1.0);

            vec3 rgb = mix(sceneColor.rgb, fogColor, fogFactor);
            gl_FragColor = vec4(rgb, sceneColor.a);
        }
    `
};

export class FogNoisePass extends Pass {
    /**
     * @param {THREE.Camera} camera
     */
    constructor(camera) {
        super();
        this.camera = camera;
        this.needsSwap = true;
        this.clear = false;

        const uniforms = UniformsUtils.clone(FogNoiseShader.uniforms);
        uniforms.projectionMatrixInverse.value = camera.projectionMatrixInverse;
        uniforms.viewMatrixInverse.value = camera.matrixWorld;

        const material = new ShaderMaterial({
            name: 'FogNoisePass',
            uniforms,
            vertexShader: FogNoiseShader.vertexShader,
            fragmentShader: FogNoiseShader.fragmentShader,
            depthTest: false,
            depthWrite: false
        });

        this.fsQuad = new FullScreenQuad(material);
    }

    get uniforms() {
        return this.fsQuad.material.uniforms;
    }

    render(renderer, writeBuffer, readBuffer /* , deltaTime, maskActive */) {
        const mat = this.fsQuad.material;
        const u = mat.uniforms;

        u.tDiffuse.value = readBuffer.texture;
        const dt = readBuffer.depthTexture;
        u.hasDepth.value = dt ? 1 : 0;
        u.tDepth.value = dt;

        u.cameraNear.value = this.camera.near;
        u.cameraFar.value = this.camera.far;
        u.projectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
        u.viewMatrixInverse.value.copy(this.camera.matrixWorld);

        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        renderer.autoClear = false;
        this.fsQuad.render(renderer);
        renderer.autoClear = true;
    }

    setSize(/* width, height */) {}

    dispose() {
        this.fsQuad.dispose();
    }
}
