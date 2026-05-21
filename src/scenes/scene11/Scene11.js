/**
 * Scene11: Studio 部屋＋StudioBox（箱は非表示）＋天井スポットまでを Scene1/2 と同系で構築。
 * メインオブジェクト・OSC トラック処理は後から追加する。
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import {
    setupPostEffectsPipeline,
    attachStrobeFlashPass,
    updateSsaoDistanceAttenuation,
    resizePostEffectsPasses,
    disposePresentationOutputPass,
    applyStudioRoomToneAndBackdrop,
    setupStudioRoomEnvironmentMap,
    disposeStudioRoomEnvironmentMap,
    studioBoxOptionsForStudioRoom,
    ceilingSpotRigOptionsForStudioRoom,
    applyStudioRoomFloorWallEnvMaps,
    StudioBox,
    STUDIO_ROOM_SCENE_FOG_COLOR
} from '../../lib/presentation/index.js';
import * as Room from '../scene10/scene10.room.js';
import * as Motion from '../scene10/scene10.motion.js';
import {
    initCurlSnakeSystems,
    updateCurlSnakeSystems,
    disposeCurlSnakeSystems,
    scene3OnTrack6Spawn
} from './scene11.snakeMain.js';
import { parseTrackNumber } from '../scene10/scene10.helpers.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';

export class Scene11 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenoxa';
        this.initialized = false;
        this.sceneNumber = 11;
        this.kitNo = 3;
        this.sharedResourceManager = sharedResourceManager;

        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;

        this.sceneLightingScale = 0.32;

        this.useTrack2Strobe = true;
        this.usePhysicalStrobe = true; // 物理ストロボを有効化

        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = true;
        /** ストロボ時はキー光をカメラスポットに寄せるため、ベースはやや暗め */
        this.sceneFogDensity = 0.00012; // フォグを少し薄くして見通しを良くする
        this.sceneFogColor = 0x080808; // 漆黒から少しグレーに寄せて空間を感じさせる
        this.useSSAO = true;
        this.useFilmGrain = true;
        this.useAutoFocusDOF = false;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        this.ssaoNearKernelRadius = 14;
        this.ssaoNearMinDistance = 0.012;
        this.ssaoNearMaxDistance = 0.24;
        this.ssaoFarAttenuation = 0.82;
        this.outputPass = null;

        this.fillPointLight = null;
        this.pulsePointLight = null;
        this.promoWallFillLight = null;
        this.promoWallLightTarget = null;

        /** トラック2ストロボ用：カメラ視線方向のスポット（ポストフラッシュに同期） */
        this.strobeCameraSpot = null;
        this._strobeCameraSpotTarget = null;
        this._strobeCameraSpotPeak = 450.0; // 1500.0 から 450.0 に落として、より「しっとり」したフラッシュに

        this.atmosphere = null;
        this.ambientParticleCount = 2000;
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientMinLiving = 180;

        this.trackEffects = {
            1: true, 2: true, 3: false, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false
        };
        this.setScreenshotText(this.title);

        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;

        this._centerSmoothed = new THREE.Vector3(0, 900, 0);
        this._totalSphereGlow = 0; // Sphere全体の輝度の合計値用
        this.collectiveGlowLight = null; // Sphereの群れを代表するライト
    }

    buildRoom() {
        Room.buildRoom(this);
    }

    setupLights() {
        Room.setupLights(this);
        // 部屋全体を暗くするために、ライトの強度を下げるか色を調整する
        // 0.5から0.85に大幅に戻して、ディテールが見えるようにする
        if (this.fillPointLight) this.fillPointLight.intensity *= 0.85;
        if (this.promoWallFillLight) this.promoWallFillLight.intensity *= 0.85;
    }

    createAmbientFloatingParticles() {
        this.atmosphere = new StudioAtmosphere(this.scene, {
            roomHalfW: this.roomHalfW,
            roomHalfD: this.roomHalfD,
            floorTopY: this.floorTopY,
            ceilingY: this.ceilingY,
            particleCount: this.ambientParticleCount,
            particleLifetimeMs: this.ambientParticleLifetimeMs,
            particleFadeOutMs: this.ambientParticleFadeOutMs,
            minLivingBurst: this.ambientMinLiving
        });
    }

    updateCamera() {
        Motion.updateCamera(this);
    }

    setupCameraParticleDistance(cameraParticle) {
        // 注視点（y=900付近）からの距離を確保するため、
        // 原点からの最大距離制限（CameraParticle内部で使用）を少し広めに設定する
        cameraParticle.minDistance = 800; // 400から800に引き上げてドアップを防止！🛡️
        cameraParticle.maxDistance = 4500; 
        cameraParticle.maxDistanceReset = 4000;
        cameraParticle.minY = 100;
        cameraParticle.maxY = 5000;
        cameraParticle.initializePosition?.();
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });

        if (this.camera.fov < 35 || this.camera.fov > 50) this.camera.fov = 42;
        this.camera.near = 12;
        this.camera.far = 12000;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, 1000, 4500);
        this.camera.lookAt(0, 400, 0);

        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;

        const L = this.sceneLightingScale;
        const studioOpts = {
            ...studioBoxOptionsForStudioRoom(L, this._roomEnvTexture),
            ambientIntensity: 0.015, 
            lightIntensity: Math.max(3.0, 3.5 * L), 
            fluorescentPointIntensity: 45.0, // 15.0 から 45.0 に大幅アップ！💡
            fluorescentPointDecay: 1.2 // 減衰を少し調整して広がりを出す
        };
        this.studio = new StudioBox(this.scene, studioOpts);
        if (this.studio.studioBox) this.studio.studioBox.visible = false;

        this.buildRoom();

        const ceilBase = ceilingSpotRigOptionsForStudioRoom(L);
        const ceilingOpts = {
            ...ceilBase,
            emissiveIntensity: 0.0, // 天井ライトの自発光をオフにするやで！🌟
            shadowDebugSpot: {
                ...ceilBase.shadowDebugSpot,
                intensity: 0.0 // 照り返しも完全にオフ
            }
        };
        this.studio.attachCeilingSpotRig(this.roomGroup, ceilingOpts);
        this.ceilingMesh = this.studio.ceilingSpotRig.ceilingMesh;
        if (this.ceilingMesh) this.ceilingMesh.visible = true;

        if (this.roomGroup) {
            const floorMat = this.roomGroup.children[0].material;
            const wallMat = this.roomGroup.children[1].material;
            applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);
        }

        this.setupLights();

        this.createAmbientFloatingParticles();

        if (this.calloutSystem) {
            for (let i = this.calloutSystem.callouts.length - 1; i >= 0; i--) {
                const c = this.calloutSystem.callouts[i];
                if (c.mesh3D) this.calloutSystem.disposeCallout3DMesh(c);
            }
            this.calloutSystem.callouts.length = 0;
            this.calloutSystem.setScene(this.scene);
        }
        this.setupCameraParticleDistances();
        this.initPostProcessing();

        this.setupPhysicalStrobeLight(1.0); // 15.0 -> 1.5 に10分の1ダウン！死ぬほど弱くしたで！📸

        // Sphereの群れを代表するライトを設置
        this.collectiveGlowLight = new THREE.PointLight(0xfff2a0, 0, 5000);
        this.collectiveGlowLight.decay = 2.0; // 1.5 から 2.0 にして減衰を強める
        this.scene.add(this.collectiveGlowLight);

        this.scene.add(this.camera); // カメラをシーンに追加して、付随するライトを有効化するやで！🚀

        initCurlSnakeSystems(this);

        this.initialized = true;
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;
        if (this.atmosphere) {
            const p = this._snakeHeadPos ?? this._centerSmoothed;
            this.atmosphere.update(deltaTime, this.time, p);
        }
        updateCurlSnakeSystems(this, deltaTime);

        // Sphereの群れのライトを更新
        if (this.collectiveGlowLight && this._snakeHeadPos) {
            this.collectiveGlowLight.position.copy(this._snakeHeadPos);
            // 総輝度に合わせて強度を調整（250.0 から 800.0 に引き上げ）
            this.collectiveGlowLight.intensity = (this._totalSphereGlow || 0) * 800.0;
        }

        this.updateCamera();

        const focusTargets = [
            this.roomGroup,
            this._snakeSphereInst,
            this._nodeLinkInst
        ].filter(Boolean);
        if (this.useAutoFocusDOF) this.updateAutoFocus(focusTargets);
        else if (this.bokehPass?.uniforms?.focus) this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        updateSsaoDistanceAttenuation(this, this._snakeHeadPos ?? this._centerSmoothed);

        // 物理ストロボライトの更新
        if (this.usePhysicalStrobe && this.strobeCameraSpot) {
            this.strobeCameraSpot.intensity = (this.strobeFlashIntensity ?? 0) * this.strobePhysicalPeak;
        }
    }

    handleTrackNumber(trackNumber, message) {
        const tn = parseTrackNumber(trackNumber, message);
        if (tn !== 6) return;
        const args = message.args || [];
        const noteNumber = args[0] || 64;
        const velocity = args[1] != null ? Number(args[1]) : 100;
        const durationMs = args[2] != null ? Number(args[2]) : 0;

        if (!Number.isFinite(velocity) || velocity <= 0) return;
        if (this.trackEffects[6]) scene3OnTrack6Spawn(this, velocity, durationMs);
    }

    initPostProcessing() {
        setupPostEffectsPipeline(this, {
            ssaoKernelSize: 48,
            filmGrainIntensity: 0.65, // 0.46から引き上げて、ピント面のノイズをより強調
            filmGrainGrayscale: false
        });
        attachStrobeFlashPass(this);
        this.applyTrackEffectsToPostPasses();
    }

    onResize() {
        super.onResize();
        resizePostEffectsPasses(this);
    }

    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        disposeCurlSnakeSystems(this);

        if (this.atmosphere) {
            this.atmosphere.dispose();
            this.atmosphere = null;
        }

        if (this.promoWallFillLight) {
            this.scene.remove(this.promoWallFillLight);
            this.promoWallFillLight.dispose();
            this.promoWallFillLight = null;
        }
        if (this.promoWallLightTarget) {
            this.scene.remove(this.promoWallLightTarget);
            this.promoWallLightTarget = null;
        }

        if (this.roomGroup) {
            this.scene.remove(this.roomGroup);
            const seenMats = new Set();
            const seenTex = new Set();
            this.roomGroup.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material && !seenMats.has(o.material)) {
                    seenMats.add(o.material);
                    const m = o.material;
                    for (const t of [m.map, m.bumpMap, m.normalMap, m.roughnessMap, m.aoMap]) {
                        if (t && !seenTex.has(t)) {
                            seenTex.add(t);
                            t.dispose();
                        }
                    }
                    m.dispose();
                }
            });
            this.roomGroup = null;
        }
        this.ceilingMesh = null;

        if (this.studio) {
            this.studio.dispose();
            this.studio = null;
        }

        if (this.ssaoPass && this.composer) {
            const idx = this.composer.passes.indexOf(this.ssaoPass);
            if (idx !== -1) this.composer.passes.splice(idx, 1);
            this.ssaoPass = null;
        }
        if (this.saoPass && this.composer) {
            const idx = this.composer.passes.indexOf(this.saoPass);
            if (idx !== -1) this.composer.passes.splice(idx, 1);
            this.saoPass = null;
        }
        if (this.aoDepthTexture) {
            this.aoDepthTexture.dispose();
            this.aoDepthTexture = null;
        }
        disposePresentationOutputPass(this);

        disposeStudioRoomEnvironmentMap({ pmremGenerator: this.pmremGenerator, envMapTexture: this._roomEnvTexture }, this.scene);
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;
        this.bloomPass = null;

        super.dispose();
    }
}
