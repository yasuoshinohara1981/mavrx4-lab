/**
 * Scene2: 既定は Studio 部屋＋StudioBox（箱は非表示）＋天井スポット等。voidBlackSoloMode を true にすると真っ黒＋チリ中心の実験モード。
 * メインの飛行オブジェクト：エメラルド風立方体 InstancedMesh・運動モード11種・OSC トラック6。
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import {
    setupPostEffectsPipeline,
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

// 分割したモジュールのインポート
import * as Helpers from './scene2.helpers.js';
import * as Motion from './scene2.motion.js';
import * as Room from './scene2.room.js';
import * as Shards from './scene2.shards.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';
import { MagmaSphere } from '../../lib/MagmaSphere.js';

export class Scene2 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenobirth';
        this.initialized = false;
        this.sceneNumber = 2;
        this.kitNo = 2;
        this.sharedResourceManager = sharedResourceManager;

        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;

        this.magma = null;

        this.sceneLightingScale = 0.32;
        this._roomEnvPresentation = null;

        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = true;
        this.sceneFogDensity = 0.00005;
        /** void 以外は共通の暖色フォグ（{@link STUDIO_ROOM_SCENE_FOG_COLOR}） */
        this.sceneFogColor = STUDIO_ROOM_SCENE_FOG_COLOR;
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

        this.atmosphere = null;

        this.wallTitleGroup = null;
        this._wallTitleMaterial = null;

        this.airNoiseVolume = null;
        this.airNoiseMaterial = null;

        this.trackEffects = {
            1: true, 2: false, 3: false, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false
        };
        this.setScreenshotText(this.title);

        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;

        this.ambientParticleCount = 2000;
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientMinLiving = 180;

        this.sphereCount = 5000;
        this.spawnRadius = 800;
        this.instancedMeshManager = null;
        this.particles = [];
        this.gridSize = 120;
        this.grid = new Map();
        this.expandSpheres = [];
        this.modeTimer = 0;
        this.modeInterval = 10.0;
        this.totalModeCount = 13;
        this.useGravity = false;
        this.spiralMode = false;
        this.torusMode = false;
        this.useWallCollision = true;
        this.currentVisibleCount = this.sphereCount;

        this.MODE_DRIFT_FIELD = 0;
        this.MODE_UPTHRUST = 1;
        this.MODE_HELIX_RAIL = 2;
        this.MODE_LEMNISCATE = 3;
        this.MODE_HONEYCOMB = 4;
        this.MODE_BEAT_INTERFERENCE = 5;
        this.MODE_BINARY_ROTATE = 6;
        this.MODE_DNA_HELIX = 7;
        this.MODE_TOROIDAL_VORTEX = 8;
        this.MODE_TRIPLE_WELL = 9;
        this.MODE_PRECESS_ORBIT = 10;
        this.MODE_SPHERE_SHELL = 11;
        this.MODE_SPHERE_VORTEX = 12;

        this.currentMode = this.MODE_DRIFT_FIELD;
        this.totalModeCount = 13;
        this.modeHistory = new Set([this.MODE_DRIFT_FIELD]);

        this._tmpV = new THREE.Vector3();
        this._mat = new THREE.Matrix4();
        this._quat = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
        this._centerSmoothed = new THREE.Vector3(0, 900, 0);
        this._colorTmp = new THREE.Color();

        /**
         * true: 真っ黒＋チリ強め・部屋非表示・天井スポット無し（実験用）。
         * false: 従来どおりタイル部屋・フォグ・天井スポット・StudioBox 周りのライト。
         */
        this.voidBlackSoloMode = false;
        /** @type {THREE.Light[] | null} */
        this._voidBlackSoloLights = null;

        /** true: インスタンス色を力の強さヒートマップ（赤＝強・青〜黒＝弱） */
        this.useHeatmapParticleColors = false;
        /** ヒートマップの追従（0〜1、大きいほど素早く変化） */
        this.heatmapColorSmoothing = 0.45;
        /** 力の相対値を表示 t に変換する指数（小さいほど暖色域に寄りやすい） */
        this.heatmapResponseGamma = 0.4;
        /** 0〜1: 速度を混ぜる（0 で力のみ） */
        this.heatmapVelocityBlend = 0;
    }

    static TICK_LOOP = 36864;

    // ヘルパー・ユーティリティの委譲
    normalizeMidiVelocity(v) { return Helpers.normalizeMidiVelocity(v); }
    _setRandomRockCharcoalColor(out) { Helpers.setRandomRockCharcoalColor(out); }
    static parseTrackNumber(trackNumber, message) { return Helpers.parseTrackNumber(trackNumber, message); }

    // モーション・カメラの委譲
    _smoothCenterFromParticles(dt) { Motion.smoothCenterFromParticles(this, dt); }
    updateCamera() { Motion.updateCamera(this); }
    applyCameraModeForMovement() { Motion.applyCameraModeForMovement(this); }

    // 部屋・ライトの委譲
    buildRoom() { Room.buildRoom(this); }
    _initWallMatteBlack3DText() { return Room.initWallMatteBlack3DText(this); }
    setupLights() { Room.setupLights(this); }

    // パーティクル・インスタンスの委譲
    createSpheres() { Shards.createSpheres(this); }
    updatePhysics(deltaTime) { Shards.updatePhysics(this, deltaTime); }
    triggerExpandEffect(velocity = 127) { Shards.triggerExpandEffect(this, velocity); }

    // 大気関連の委譲
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

    _applyEnvMapToSphereMaterial() {
        const m = this.instancedMeshManager?.getMainMesh()?.material;
        const env = this.scene?.environment;
        if (m && env) { m.envMap = env; m.needsUpdate = true; }
    }

    updateExpandSpheres() {
        const now = Date.now();
        for (let i = this.expandSpheres.length - 1; i >= 0; i--) {
            const effect = this.expandSpheres[i];
            const progress = (now - effect.startTime) / effect.duration;
            if (progress >= 1.0) {
                if (effect.light) this.scene.remove(effect.light);
                if (effect.mesh) { this.scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); }
                this.expandSpheres.splice(i, 1);
            } else {
                if (effect.light) effect.light.intensity = effect.maxIntensity * (1.0 - Math.pow(progress, 0.5));
                if (effect.mesh) effect.mesh.scale.setScalar(1.0 - progress);
            }
        }
    }

    switchCameraRandom() {
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex) { newIndex = Math.floor(Math.random() * this.cameraParticles.length); }
        this.currentCameraIndex = newIndex;
        const cp = this.cameraParticles[this.currentCameraIndex];
        this.cameraParticles.forEach((p) => { p.minDistance = 400; p.maxDistance = 2000; p.boxMin = null; p.boxMax = null; p.maxSpeed = 8.0; });
        const angle1 = Math.random() * Math.PI * 2; const angle2 = Math.random() * Math.PI; const dist = 1000 + Math.random() * 2000;
        cp.position.set(Math.cos(angle1) * Math.sin(angle2) * dist, Math.sin(angle1) * Math.sin(angle2) * dist + 500, Math.cos(angle2) * dist);
        cp.applyRandomForce();
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();
        const voidMode = this.voidBlackSoloMode;
        this.renderer.shadowMap.enabled = !voidMode;
        if (!voidMode) {
            this.renderer.shadowMap.type = THREE.PCFShadowMap;
        }
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: voidMode ? false : this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: voidMode ? 0x000000 : this.sceneFogColor
        });

        if (this.camera.fov < 35 || this.camera.fov > 50) this.camera.fov = 42;
        this.camera.near = 12; this.camera.far = 12000; this.camera.updateProjectionMatrix();
        this.camera.position.set(0, 1000, 4500); this.camera.lookAt(0, 400, 0);

        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;

        this.studio = new StudioBox(this.scene, studioBoxOptionsForStudioRoom(this.sceneLightingScale, this._roomEnvTexture));
        // Scene1 と同様、StudioBox の箱自体は非表示にして独自構築の部屋（またはタイル設定）を使う
        if (this.studio.studioBox) this.studio.studioBox.visible = false;

        this.buildRoom();
        if (this.roomGroup) this.roomGroup.visible = !voidMode;

        if (!voidMode) {
            this.studio.attachCeilingSpotRig(this.roomGroup, { ...ceilingSpotRigOptionsForStudioRoom(this.sceneLightingScale) });
            this.ceilingMesh = this.studio.ceilingSpotRig.ceilingMesh;
            if (this.ceilingMesh) this.ceilingMesh.visible = true;
        }
        if (this.roomGroup) {
            const floorMat = this.roomGroup.children[0].material;
            const wallMat = this.roomGroup.children[1].material;
            applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);
        }

        this.setupLights();
        this.magma = new MagmaSphere(this.scene, {
            radius: 450,
            position: new THREE.Vector3(0, 900, 0),
            sceneLightingScale: this.sceneLightingScale,
            shapeMorphStrength: 1.0
        });
        // this.magma.mesh.geometry.computeVertexNormals(); // MeshStandardMaterial ベースなので不要


        this.createSpheres();
        this.createAmbientFloatingParticles();
        this._applyEnvMapToSphereMaterial();

        if (this.calloutSystem) this.calloutSystem.setScene(this.scene);
        this.setupCameraParticleDistances();
        this.initPostProcessing();
        await this._initWallMatteBlack3DText();
        this.initialized = true;
    }

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 750; cameraParticle.maxDistance = 4850; cameraParticle.maxDistanceReset = 4500;
        cameraParticle.minY = -200; cameraParticle.maxY = 4500; cameraParticle.initializePosition?.();
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;
        if (this.atmosphere) {
            const p = this._centerSmoothed ?? new THREE.Vector3(0, this.floorTopY + 600, 0);
            this.atmosphere.update(deltaTime, this.time, p);
        }
        this.currentVisibleCount = this.sphereCount;
        this.setParticleCount(this.sphereCount);
        if (this.instancedMeshManager) {
            const mainMesh = this.instancedMeshManager.getMainMesh();
            if (mainMesh) { mainMesh.count = this.sphereCount; mainMesh.instanceMatrix.needsUpdate = true; }
        }

        this.modeTimer += deltaTime;
        if (this.modeTimer >= this.modeInterval) {
            this.modeTimer = 0;
            const weights = [1.0, 1.2, 1.5, 1.5, 1.0, 1.0, 1.2, 1.0, 0.8, 1.5, 1.05, 1.8, 1.8];
            const unvisitedModes = [];
            for (let i = 0; i < this.totalModeCount; i++) { if (!this.modeHistory.has(i)) unvisitedModes.push(i); }
            let nextMode = -1;
            if (unvisitedModes.length > 0) {
                let subTotalWeight = 0; unvisitedModes.forEach((m) => { subTotalWeight += weights[m]; });
                let random = Math.random() * subTotalWeight;
                for (const m of unvisitedModes) { if (random < weights[m]) { nextMode = m; break; } random -= weights[m]; }
                if (nextMode === -1) nextMode = unvisitedModes[0];
            } else {
                const totalWeight = weights.reduce((a, b) => a + b, 0);
                let random = Math.random() * totalWeight;
                for (let i = 0; i < weights.length; i++) { if (random < weights[i]) { nextMode = i; break; } random -= weights[i]; }
                if (nextMode === this.currentMode) nextMode = (nextMode + 1) % this.totalModeCount;
            }
            this.currentMode = nextMode;
            this.modeHistory.add(nextMode);
            if (this.modeHistory.size >= this.totalModeCount) { this.modeHistory.clear(); this.modeHistory.add(this.currentMode); }
            this.useGravity = false; this.spiralMode = this.currentMode === this.MODE_HELIX_RAIL; this.torusMode = false;
            this.applyCameraModeForMovement();
            if (this.currentMode === this.MODE_UPTHRUST) {
                this.particles.forEach((part) => { if (part.velocity.y < 0) part.velocity.y *= 0.65; });
            } else if (this.currentMode === this.MODE_HELIX_RAIL) {
                this.particles.forEach((p) => {
                    const rr = Math.random() * this.spawnRadius; const theta = Math.random() * Math.PI * 2; const phi = Math.random() * Math.PI;
                    p.position.set(rr * Math.sin(phi) * Math.cos(theta), p.spiralHeightFactor * 5000 - 500, rr * Math.sin(phi) * Math.sin(theta));
                    p.velocity.set(0, 0, 0);
                });
            }
        }

        this.updatePhysics(deltaTime);
        this.updateExpandSpheres();
        if (this.magma) this.magma.update(this.time, this.phase);
        this._smoothCenterFromParticles(deltaTime);
        this.updateCamera();

        const mainInst = this.instancedMeshManager?.getMainMesh();
        const focusTargets = [this.roomGroup, mainInst].filter(Boolean);
        if (this.useAutoFocusDOF) this.updateAutoFocus(focusTargets);
        else if (this.bokehPass?.uniforms?.focus) this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);

        if (this.calloutSystem) this.calloutSystem.update(deltaTime, this.time, this.camera, { autoGenerate: false, maxCount: 8, margin: 200 });
    }

    handleTrackNumber(trackNumber, message) {
        const tn = Helpers.parseTrackNumber(trackNumber, message);
        
        // トラック5: 溶岩の速度制御
        if (tn === 5) {
            const args = message.args || [];
            const v1 = args[1] != null ? Number(args[1]) : NaN;
            const v0 = args[0] != null ? Number(args[0]) : NaN;
            let velocity = Number.isFinite(v1) ? v1 : Number.isFinite(v0) ? v0 : 64;
            if (this.magma) {
                // velocity 0-127 を速度倍率 0.5-5.0 くらいにマップするやで！
                const scale = 0.5 + (velocity / 127.0) * 4.5;
                this.magma.setSpeedScale(scale);
            }
            return;
        }

        if (tn !== 6) return;
        const args = message.args || [];
        const v1 = args[1] != null ? Number(args[1]) : NaN;
        const v0 = args[0] != null ? Number(args[0]) : NaN;
        let velocity = Number.isFinite(v1) ? v1 : Number.isFinite(v0) ? v0 : 127;
        if (!Number.isFinite(velocity) || velocity <= 0) return;
        if (this.trackEffects[6]) this.triggerExpandEffect(velocity);
    }

    initPostProcessing() {
        setupPostEffectsPipeline(this, { ssaoKernelSize: 48 });
    }
    onResize() { super.onResize(); resizePostEffectsPasses(this); }

    dispose() {
        this.initialized = false; this.scene.fog = null;
        if (this._voidBlackSoloLights) {
            for (const l of this._voidBlackSoloLights) {
                this.scene.remove(l);
                l.dispose?.();
            }
            this._voidBlackSoloLights = null;
        }
        if (this.promoWallFillLight) { this.scene.remove(this.promoWallFillLight); this.promoWallFillLight.dispose(); this.promoWallFillLight = null; }
        if (this.promoWallLightTarget) { this.scene.remove(this.promoWallLightTarget); this.promoWallLightTarget = null; }
        if (this.wallTitleGroup) {
            this.scene.remove(this.wallTitleGroup);
            this.wallTitleGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
            this.wallTitleGroup = null;
        }
        if (this._wallTitleMaterial) { this._wallTitleMaterial.dispose(); this._wallTitleMaterial = null; }
        if (this.atmosphere) { this.atmosphere.dispose(); this.atmosphere = null; }
        if (this.magma) { this.magma.dispose(); this.magma = null; }
        if (this.roomGroup) {
            this.scene.remove(this.roomGroup); const seenMats = new Set(); const seenTex = new Set();
            this.roomGroup.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material && !seenMats.has(o.material)) {
                    seenMats.add(o.material); const m = o.material;
                    for (const t of [m.map, m.bumpMap, m.normalMap, m.roughnessMap, m.aoMap]) { if (t && !seenTex.has(t)) { seenTex.add(t); t.dispose(); } }
                    m.dispose();
                }
            });
            this.roomGroup = null;
        }
        this.ceilingMesh = null;
        if (this.studio) { this.studio.dispose(); this.studio = null; }
        if (this.ssaoPass && this.composer) { const idx = this.composer.passes.indexOf(this.ssaoPass); if (idx !== -1) this.composer.passes.splice(idx, 1); this.ssaoPass = null; }
        if (this.saoPass && this.composer) { const idx = this.composer.passes.indexOf(this.saoPass); if (idx !== -1) this.composer.passes.splice(idx, 1); this.saoPass = null; }
        if (this.aoDepthTexture) { this.aoDepthTexture.dispose(); this.aoDepthTexture = null; }
        disposePresentationOutputPass(this);
        this.expandSpheres.forEach((e) => {
            if (e.light) this.scene.remove(e.light);
            if (e.mesh) { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
        });
        this.expandSpheres = [];
        if (this.instancedMeshManager) { this.instancedMeshManager.dispose(); this.instancedMeshManager = null; }
        this.particles = []; this.grid?.clear();
        disposeStudioRoomEnvironmentMap({ pmremGenerator: this.pmremGenerator, envMapTexture: this._roomEnvTexture }, this.scene);
        this.pmremGenerator = null; this._roomEnvTexture = null; this._roomEnvPresentation = null;
        this.bloomPass = null;
        super.dispose();
    }
}
