import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SensorFilmGrainPass } from '../SensorFilmGrainPass.js';
import { FilmLookPass } from '../FilmLookPass.js';
import { debugLog } from '../DebugLogger.js';

/**
 * 被写界深度（BokehPass）とフィルムグレイン（SensorFilmGrainPass）。
 * SceneBase から分離 — 「見え方」は presentation 側で組み立てる。
 */

/**
 * @typedef {object} PostEffectsHost
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').Camera} camera
 * @property {import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer} [composer]
 * @property {boolean} useDOF
 * @property {boolean} useFilmGrain
 * @property {import('three/examples/jsm/postprocessing/BokehPass.js').BokehPass} [bokehPass]
 * @property {import('../FilmLookPass.js').FilmLookPass} [filmLookPass]
 * @property {import('../SensorFilmGrainPass.js').SensorFilmGrainPass} [filmPass]
 * @property {{ focus?: number, aperture?: number, maxblur?: number }} [dofParams]
 */

/**
 * @param {PostEffectsHost} host
 * @param {object} [params]
 */
export function attachDepthOfField(host, params = {}) {
    if (!host.composer) {
        host.composer = new EffectComposer(host.renderer);
        host.composer.addPass(new RenderPass(host.scene, host.camera));
    }

    host.dofParams = { ...host.dofParams, ...params };

    if (host.bokehPass) {
        host.composer.removePass(host.bokehPass);
    }

    host.bokehPass = new BokehPass(host.scene, host.camera, {
        focus: host.dofParams.focus,
        aperture: host.dofParams.aperture,
        maxblur: host.dofParams.maxblur,
        width: window.innerWidth,
        height: window.innerHeight
    });

    host.bokehPass.enabled = host.useDOF;
    host.composer.addPass(host.bokehPass);

    debugLog('effect', 'DOF (BokehPass) initialized');
}

/**
 * @param {PostEffectsHost} host
 * @param {number} [intensity=0.35]
 * @param {boolean} [grayscale=false]
 */
export function attachFilmGrainPass(host, intensity = 0.35, grayscale = false) {
    if (!host.useFilmGrain) return;
    if (!host.composer) {
        host.composer = new EffectComposer(host.renderer);
        host.composer.addPass(new RenderPass(host.scene, host.camera));
    }
    if (host.filmPass) return;

    const filmLookCa = 0.0004;
    const filmLookSoften = 0.0;
    if (!host.filmLookPass && (filmLookCa > 0.0 || filmLookSoften > 0.0)) {
        host.filmLookPass = new FilmLookPass({ caAmount: filmLookCa, soften: filmLookSoften });
        host.composer.addPass(host.filmLookPass);
        debugLog('effect', 'FilmLookPass (CA only) added');
    }
    host.filmPass = new SensorFilmGrainPass(intensity, grayscale);
    if (host.bokehPass) {
        host.filmPass.bindBokehPass(host.bokehPass, () => host.useDOF && host.bokehPass && host.bokehPass.enabled);
    }
    host.composer.addPass(host.filmPass);
    debugLog('effect', 'FilmGrain (SensorFilmGrainPass) added');
}
