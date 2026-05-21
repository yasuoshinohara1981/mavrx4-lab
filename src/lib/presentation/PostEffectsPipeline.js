import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { attachDepthOfField, attachFilmGrainPass } from './DepthOfFieldAndGrain.js';

/**
 * Scene1/2 と同じレンダラー設定（ACES + 露出 + sRGB）。EffectComposer を使うシーンでは必須。
 * @param {import('three').WebGLRenderer} renderer
 * @param {number} [sceneLightingScale=0.32] Scene1 の `sceneLightingScale` に合わせる（未指定は 1/2 既定）
 */
export function applyStandardPresentationRenderer(renderer, sceneLightingScale = 0.32) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const Lexp = sceneLightingScale ?? 1;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.42, 0.92, Lexp);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/**
 * 中間バッファを画面に出す前にトーンマップ＋色空間を適用する（グレインの直前に置く）。
 * @param {PostEffectsPipelineHost} host
 */
export function attachPresentationOutputPass(host) {
    if (!host?.composer) return;
    if (host.outputPass) return;
    host.outputPass = new OutputPass();
    host.composer.addPass(host.outputPass);
}

/**
 * @param {PostEffectsPipelineHost} host
 */
export function disposePresentationOutputPass(host) {
    if (!host?.outputPass) return;
    if (host.composer) {
        const idx = host.composer.passes.indexOf(host.outputPass);
        if (idx !== -1) host.composer.passes.splice(idx, 1);
    }
    host.outputPass.dispose();
    host.outputPass = null;
}

/**
 * スクリーン空間のポストエフェクト（SSAO・Bloom・被写界深度・トーンマップ出力・グレイン）を1本のパイプラインにまとめる。
 * シーンは {@link setupPostEffectsPipeline} を呼ぶ。host は SceneBase サブクラス（composer / dofParams / 各フラグ）。
 */

/**
 * @typedef {import('./DepthOfFieldAndGrain.js').PostEffectsHost & {
 *   useSSAO: boolean,
 *   useBloom: boolean,
 *   ssaoPass?: object,
 *   saoPass?: object,
 *   bloomPass?: object,
 *   outputPass?: object,
 *   aoDepthTexture?: import('three').DepthTexture,
 *   ssaoNearKernelRadius?: number,
 *   ssaoNearMinDistance?: number,
 *   ssaoNearMaxDistance?: number,
 *   ssaoFarAttenuation?: number
 * }} PostEffectsPipelineHost
 */

/**
 * @param {PostEffectsPipelineHost} host
 * @param {object} [options]
 */
export function setupPostEffectsPipeline(host, options = {}) {
    if (!host.composer) {
        host.composer = new EffectComposer(host.renderer);
        host.composer.addPass(new RenderPass(host.scene, host.camera));
    }

    const useSsao = options.ssao !== false && host.useSSAO && !host.ssaoPass;
    if (useSsao) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const ssaoKernelSize = options.ssaoKernelSize ?? 32;
        host.ssaoPass = new SSAOPass(host.scene, host.camera, w, h, ssaoKernelSize);
        host.ssaoPass.kernelRadius = options.ssaoKernelRadius ?? host.ssaoNearKernelRadius ?? 9.2;
        host.ssaoPass.minDistance = options.ssaoMinDistance ?? host.ssaoNearMinDistance ?? 0.018;
        host.ssaoPass.maxDistance = options.ssaoMaxDistance ?? host.ssaoNearMaxDistance ?? 0.165;
        host.composer.addPass(host.ssaoPass);
        syncSsaoDepthAndCameraUniforms(host.renderer, host.camera, host.composer, host.ssaoPass, host);
    }

    const useBloom = options.bloom !== false && host.useBloom;
    if (useBloom && !host.bloomPass) {
        const res = new THREE.Vector2(
            Math.max(64, window.innerWidth / 6),
            Math.max(64, window.innerHeight / 6)
        );
        host.bloomPass = new UnrealBloomPass(
            res,
            options.bloomStrength ?? 0.14,
            options.bloomRadius ?? 0.68,
            options.bloomThreshold ?? 0.64
        );
        host.composer.addPass(host.bloomPass);
    }

    const useDof = options.dof !== false && host.useDOF;
    if (useDof) {
        attachDepthOfField(host, {
            focus: options.dofFocus ?? 2100,
            aperture: options.dofAperture ?? 0.0000012,
            maxblur: options.dofMaxBlur ?? 0.0028
        });
    }

    if (options.outputPass !== false) {
        attachPresentationOutputPass(host);
    }

    attachFilmGrainPass(host, options.filmGrainIntensity ?? 0.22, options.filmGrainGrayscale ?? false);
}

/**
 * EffectComposer の RT1 に深度テクスチャを載せ、SSAO マテリアルの near/far/tDepth を同期する。
 */
export function syncSsaoDepthAndCameraUniforms(renderer, camera, composer, aoPass, host) {
    if (!aoPass || !host) return;
    if (!host.aoDepthTexture && composer?.renderTarget1) {
        const size = renderer.getSize(new THREE.Vector2());
        const ratio = renderer.getPixelRatio();
        const w = Math.max(1, Math.floor(size.x * ratio));
        const h = Math.max(1, Math.floor(size.y * ratio));
        host.aoDepthTexture = new THREE.DepthTexture(w, h);
        host.aoDepthTexture.type = THREE.UnsignedIntType;
        host.aoDepthTexture.format = THREE.DepthFormat;
        composer.renderTarget1.depthTexture = host.aoDepthTexture;
        composer.renderTarget1.depthBuffer = true;
    }

    const candidateDepth =
        aoPass.beautyRenderTarget?.depthTexture ||
        aoPass.normalRenderTarget?.depthTexture ||
        aoPass.depthRenderTarget?.depthTexture ||
        host.aoDepthTexture ||
        null;

    const maybeMaterials = [
        aoPass.ssaoMaterial,
        aoPass.saoMaterial,
        aoPass.materialAO,
        aoPass.vBlurMaterial,
        aoPass.hBlurMaterial
    ];

    for (const m of maybeMaterials) {
        const u = m?.uniforms;
        if (!u) continue;
        if (u.cameraNear) u.cameraNear.value = camera.near;
        if (u.cameraFar) u.cameraFar.value = camera.far;
        if (u.tDepth && candidateDepth) u.tDepth.value = candidateDepth;
    }
}

/**
 * カメラとフォーカス位置の距離に応じて SSAO のカーネル帯を弱める（遠景での過暗化を抑える）。
 * @param {PostEffectsPipelineHost} host
 * @param {import('three').Vector3} focusWorld
 */
export function updateSsaoDistanceAttenuation(host, focusWorld) {
    const aoPass = host.ssaoPass || host.saoPass;
    if (!aoPass || !focusWorld) return;

    const camDist = host.camera.position.distanceTo(focusWorld);
    const nearD = 900;
    const farD = 6200;
    const t = THREE.MathUtils.clamp((camDist - nearD) / (farD - nearD), 0, 1);
    const farAtt = host.ssaoFarAttenuation ?? 0.62;
    const aoScale = THREE.MathUtils.lerp(1.0, farAtt, t);
    const kr = host.ssaoNearKernelRadius ?? 9.2;
    const mn = host.ssaoNearMinDistance ?? 0.018;
    const mx = host.ssaoNearMaxDistance ?? 0.165;
    if ('kernelRadius' in aoPass) aoPass.kernelRadius = kr * aoScale;
    if ('minDistance' in aoPass) aoPass.minDistance = mn * aoScale;
    if ('maxDistance' in aoPass) aoPass.maxDistance = mx * aoScale;
    syncSsaoDepthAndCameraUniforms(host.renderer, host.camera, host.composer, aoPass, host);
}

/**
 * リサイズ後に SSAO と深度テクスチャ解像度を合わせる。
 * @param {PostEffectsPipelineHost} host
 */
export function resizePostEffectsPasses(host) {
    if (host.ssaoPass && typeof host.ssaoPass.setSize === 'function') {
        host.ssaoPass.setSize(window.innerWidth, window.innerHeight);
    }
    if (host.saoPass && typeof host.saoPass.setSize === 'function') {
        host.saoPass.setSize(window.innerWidth, window.innerHeight);
    }
    if (host.aoDepthTexture) {
        const ratio = host.renderer.getPixelRatio();
        host.aoDepthTexture.image.width = Math.max(1, Math.floor(window.innerWidth * ratio));
        host.aoDepthTexture.image.height = Math.max(1, Math.floor(window.innerHeight * ratio));
        host.aoDepthTexture.needsUpdate = true;
    }
    syncSsaoDepthAndCameraUniforms(
        host.renderer,
        host.camera,
        host.composer,
        host.ssaoPass || host.saoPass,
        host
    );
}
