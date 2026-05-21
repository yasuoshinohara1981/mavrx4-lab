/**
 * Scene4: Scene3 系統をベースに、StudioBox 可視メッシュ＋部屋ジオメトリを非表示にした真っ黒空間。
 * ポスト（DOF・SSAO・Bloom・フィルムグレイン等）は Scene3 と同じパイプライン。
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
    StudioBox
} from '../../lib/presentation/index.js';
import * as Room from '../scene02/scene2.room.js';
import * as Motion from '../scene02/scene2.motion.js';
import {
    initCurlSnakeSystems,
    updateCurlSnakeSystems,
    disposeCurlSnakeSystems,
    scene3OnTrack6Spawn
} from '../scene03/scene3.snakeMain.js';
import { parseTrackNumber } from '../scene02/scene2.helpers.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';

export class Scene4 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenodub';
        this.initialized = false;
        this.sceneNumber = 4;
        this.kitNo = 4;
        this.sharedResourceManager = sharedResourceManager;

        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;

        this.sceneLightingScale = 0.32;

        this.useTrack2Strobe = true;
        this.usePhysicalStrobe = true;

        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = true;
        this.sceneFogDensity = 0.00008;
        this.sceneFogColor = 0x000000;
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

        this.strobeCameraSpot = null;
        this._strobeCameraSpotTarget = null;
        this._strobeCameraSpotPeak = 450.0;

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
        this._totalSphereGlow = 0;
        this.collectiveGlowLight = null;
    }

    buildRoom() {
        Room.buildRoom(this);
    }

    setupLights() {
        Room.setupLights(this);
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
        cameraParticle.minDistance = 800;
        cameraParticle.maxDistance = 4500;
        cameraParticle.maxDistanceReset = 4000;
        cameraParticle.minY = 100;
        cameraParticle.maxY = 5000;
        cameraParticle.initializePosition?.();
    }

    /** StudioBox の発光メッシュだけ消す（PointLight はそのまま）。 */
    _hideStudioBoxVisuals() {
        if (!this.studio) return;
        if (this.studio.studioBox) this.studio.studioBox.visible = false;
        if (this.studio.studioFloor) this.studio.studioFloor.visible = false;
        const lamps = this.studio.fluorescentLights || [];
        for (let i = 0; i < lamps.length; i++) {
            const lamp = lamps[i];
            if (lamp && lamp.group) lamp.group.visible = false;
        }
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
            fluorescentPointIntensity: 45.0,
            fluorescentPointDecay: 1.2
        };
        this.studio = new StudioBox(this.scene, studioOpts);
        this._hideStudioBoxVisuals();

        this.buildRoom();

        const ceilBase = ceilingSpotRigOptionsForStudioRoom(L);
        const ceilingOpts = {
            ...ceilBase,
            emissiveIntensity: 0.0,
            shadowDebugSpot: {
                ...ceilBase.shadowDebugSpot,
                intensity: 0.0
            }
        };
        this.studio.attachCeilingSpotRig(this.roomGroup, ceilingOpts);
        this.ceilingMesh = this.studio.ceilingSpotRig.ceilingMesh;

        if (this.roomGroup) {
            const floorMat = this.roomGroup.children[0].material;
            const wallMat = this.roomGroup.children[1].material;
            applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);
            // 床・壁・天井プレーンを描画しない（ライト用ロジック・コリダーは維持）
            this.roomGroup.visible = false;
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

        this.setupPhysicalStrobeLight(1.0);

        this.collectiveGlowLight = new THREE.PointLight(0xfff2a0, 0, 5000);
        this.collectiveGlowLight.decay = 2.0;
        this.scene.add(this.collectiveGlowLight);

        this.scene.add(this.camera);

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

        if (this.collectiveGlowLight && this._snakeHeadPos) {
            this.collectiveGlowLight.position.copy(this._snakeHeadPos);
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

        if (this.usePhysicalStrobe && this.strobeCameraSpot) {
            this.strobeCameraSpot.intensity = (this.strobeFlashIntensity ?? 0) * this.strobePhysicalPeak;
        }
    }

    handleTrackNumber(trackNumber, message) {
        const tn = parseTrackNumber(trackNumber, message);
        if (tn !== 6) return;
        const args = message.args || [];
        const velocity = args[1] != null ? Number(args[1]) : 100;
        const durationMs = args[2] != null ? Number(args[2]) : 0;

        if (!Number.isFinite(velocity) || velocity <= 0) return;
        if (this.trackEffects[6]) scene3OnTrack6Spawn(this, velocity, durationMs);
    }

    initPostProcessing() {
        setupPostEffectsPipeline(this, {
            ssaoKernelSize: 48,
            filmGrainIntensity: 0.65,
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
