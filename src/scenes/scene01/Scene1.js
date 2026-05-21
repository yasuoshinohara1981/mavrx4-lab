/**
 * Scene1: コンクリート空間（床＋壁＋StudioBox 相当の天井発光）
 * メインオブジェクト：トラック9で金属片（args[2]=デュレーションmsでサイズ、velocityで金属トーンの明るさ）
 * トラック5：赤シリンダ（args[2]=デュレ、ノート番号は args[0]）。トラック6：部屋中心付近スフィア（args[2]=デュレ、track9SpawnDuringDuration でデュレ中に間隔スポーン可）
 * 天井＋シャドウ Spot は StudioBox.attachCeilingSpotRig。埋め Spot のみこのシーン内。
 * 床・壁は StudioBox と同じタイル目地＋床の赤十字・番号。ポスト・フォグ・大気チリは lib/presentation を参照。
 * 北壁：extruded 3D タイトル（Helvetiker）＋英語説明、艶・環境反射
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import {
    StudioBox,
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
    STUDIO_ROOM_HALF_W,
    STUDIO_ROOM_HALF_D,
    STUDIO_FLOOR_TOP_Y,
    STUDIO_CEILING_Y,
    STUDIO_ROOM_SCENE_FOG_COLOR
} from '../../lib/presentation/index.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';
import { generateFleshVeinTextures } from '../../lib/FleshVeinTextures.js';
import { Scene1Particle } from './Scene1Particle.js';

// 分割したモジュールのインポート
import * as Helpers from './scene1.helpers.js';
import * as Motion from './scene1.motion.js';
import * as Room from './scene1.room.js';
import * as Shards from './scene1.shards.js';
import * as Cylinders from './scene1.cylinders.js';
import * as Track9 from './scene1.track9.js';
import * as Atmosphere from './scene1.atmosphere.js';

export class Scene1 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenomist';
        this.initialized = false;
        this.sceneNumber = 1;
        this.kitNo = 1;
        this.sharedResourceManager = sharedResourceManager;

        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        /** 北壁の extruded 3D タイトル（Helvetiker / 艶・反射） */
        this.wallTitleGroup = null;
        this._wallTitleMaterial = null;

        this.cubeRenderTarget = null;
        this.cubeCamera = null;

        this.atmosphere = null;

        /** トラック9で生える金属片 — GPU インスタンス（1 InstancedMesh） */
        this.shards = [];
        this.maxShards = 2000;
        this.shardCylinderVisualScale = 1.5;
        this.sceneLightingScale = 0.32;
        this.shardLifetimeMs = 180000;
        this.shardFadeOutMs = 1800;
        this.cylinderFadeOutMs = 1800;
        this.shardGrowInMs = 420;
        this.cylinderGrowInMs = 420;
        this._cylinderOpacityAttr = null;
        this.shardGroup = null;
        this.shardInstMesh = null;
        this._shardOpacityAttr = null;
        this._shardFreeSlots = [];
        this._metalShardMaterial = null;
        this._shardMatrixTemp = new THREE.Matrix4();
        this._shardQuatTemp = new THREE.Quaternion();
        this._shardScaleTemp = new THREE.Vector3();
        this._shardPosTemp = new THREE.Vector3();
        this._spawnWorldPosTemp = new THREE.Vector3();
        this._lastShardPos = new THREE.Vector3(0, 550, 0);
        this._snakeDir = new THREE.Vector3(0, 0.12, 1).normalize();
        this._trailHeadPos = new THREE.Vector3(0, 550, 0);
        this._trailHeadDir = new THREE.Vector3(0, 0.06, 1).normalize();
        this._trailHeadPosShard = new THREE.Vector3(0, 550, 0);
        this._trailHeadDirShard = new THREE.Vector3(0, 0.06, 1).normalize();
        this._trailHeadPosCylinder = new THREE.Vector3(0, 550, 0);
        this._trailHeadDirCylinder = new THREE.Vector3(0.1, 0.04, 1).normalize();
        this._trailCenter = new THREE.Vector3(0, 1200, 0);
        this._trailSpeed = 720;
        this._trailSpeedShard = 760;
        this._trailSpeedCylinder = 1040;
        this._trailCurlFreq = 0.00135;
        this._trailCurlFreqShard = 0.00165;
        this._trailCurlFreqCylinder = 0.0068;
        this._trailCurlStrength = 2.6;
        this._trailCurlStrengthShard = 4.2;
        this._trailCurlStrengthCylinder = 11.5;
        this._trailCenterPull = 0.7;
        this._trailCenterPullCylinder = 0;
        this._cylinderCurlFieldOffset = new THREE.Vector3(831.2, -1949.5, 722.4);
        this._curlCylPosScratch = new THREE.Vector3();
        this._trailCurlEpsCylinder = 5.2;
        this._trailYawAmp = 0.42;
        this._trailPitchAmp = 0.28;
        this._trailRollAmp = 0.36;
        this._spawnFocusWorld = new THREE.Vector3(0, 550, 0);
        this._cameraFocusSmoothed = new THREE.Vector3(0, 550, 0);
        this._lastSpawnTickTrack5 = null;
        this._snakeIndex = 0;
        this._shardSeed = Math.random() * 1000;
        this._shardHeatColor = new THREE.Color();
        this._cylinderTintTemp = new THREE.Color();
        this._instanceWhite = new THREE.Color(0xffffff);
        this._instanceBlack = new THREE.Color(0x000000);
        this._track9SphereColorAtMax = new THREE.Color(0xd5d9df);
        this._track9SphereEmissiveAtMax = new THREE.Color(0x2a2d32);
        this._shardMetalDark = new THREE.Color(0x5a5a5a);
        this._shardMetalMid = new THREE.Color(0x9e9e9e);
        this._shardMetalBright = new THREE.Color(0xd0d0d0);

        this.pulses = [];
        this.pulseColor = new THREE.Color(1, 0, 0);
        this.targetPulseColor = new THREE.Color(1, 0, 0);
        this.colorIndex = 0;
        this.colors = [
            new THREE.Color(1, 0, 0),
            new THREE.Color(0, 1, 0),
            new THREE.Color(0, 0, 1),
            new THREE.Color(1, 1, 1),
            new THREE.Color(1, 0, 1),
            new THREE.Color(0, 1, 1)
        ];
        this.lightIntensity = 0;
        this.targetLightIntensity = 0;
        this.pulsePointLight = null;
        this.fillPointLight = null;

        this.pmremGenerator = null;
        this._roomEnvTexture = null;

        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = true;
        this.sceneFogDensity = 0.00005;
        /** フォグ色は {@link STUDIO_ROOM_SCENE_FOG_COLOR} と同期 */
        this.sceneFogColor = STUDIO_ROOM_SCENE_FOG_COLOR;
        this.useSSAO = true;
        this.useFilmGrain = true;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        this.ssaoNearKernelRadius = 9.2;
        this.ssaoNearMinDistance = 0.018;
        this.ssaoNearMaxDistance = 0.165;
        this.ssaoFarAttenuation = 0.62;
        this.useAutoFocusDOF = false;
        this.outputPass = null;

        this.trackEffects = {
            1: true, 2: false, 3: false, 4: false, 5: true, 6: true, 7: true, 8: true, 9: true
        };
        this.setScreenshotText(this.title);

        if (this.calloutSystem) {
            this.calloutSystem.setUse3DCallouts(true);
            this.calloutSystem.setLabels(['CONCRETE', 'PBR', 'AO', 'ACES']);
        }

        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;

        this.trackValues = { 5: 0, 6: 0, 7: 0 };
        this.smoothTrack7Color = 0;
        this.cableHomeY = 550;
        this.cableBlobParticle = null;

        this.ambientParticleCount = 2000;
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientMinLiving = 180;

        this.cylinderInstMesh = null;
        this.cylinders = [];
        this.maxCylinders = 640;
        this.cylinderLifetimeMs = 180000;
        this._cylinderFreeSlots = [];
        this._redCylinderMaterial = null;
        this._cylinderMatrixTemp = new THREE.Matrix4();
        this._cylinderQuatTemp = new THREE.Quaternion();
        this._cylinderRollQuat = new THREE.Quaternion();
        this._cylinderTiltXQuat = new THREE.Quaternion();
        this._cylinderHelixPhase = 0;
        this._cylinderHelixTwistPerSpawn = 0.055;
        this._cylinderScaleTemp = new THREE.Vector3();
        this._cylinderPosTemp = new THREE.Vector3();
        this._cylinderDirTemp = new THREE.Vector3();
        this._cylinderSideTemp = new THREE.Vector3();
        this._cylinderFallbackAxis = new THREE.Vector3(1, 0, 0);
        this._cylinderAxisUp = new THREE.Vector3(0, 1, 0);
        this._lastCylinderWorldPos = new THREE.Vector3(0, 550, 0);
        this._cylinderPathDir = new THREE.Vector3(0, 0.1, 1).normalize();
        this._lastSpawnTickTrack6 = null;
        this.redBurstParticleCount = 5000;
        this.redBurstInstMesh = null;
        this.redBurstSharedGeo = null;
        this.redBurstMaterial = null;
        this._redBurstPositions = null;
        this._redBurstVelocities = null;
        this._redBurstColors = null;
        this._redBurstRotQuats = null;
        this._redBurstScales = null;
        this._redBurstActive = false;
        this._redBurstAgeSec = 0;
        this._redBurstLifeSec = 1.35;
        this.redBurstCurlStrength = 95;
        this.redBurstCurlFreq = 0.0022;
        this._redBurstPosTemp = new THREE.Vector3();
        this._redBurstQuatTemp = new THREE.Quaternion();
        this._redBurstScaleTemp = new THREE.Vector3();
        this._redBurstMatrixTemp = new THREE.Matrix4();
        this._redBurstColorTemp = new THREE.Color();
        this._redBurstCurlTemp = new THREE.Vector3();

        this._jitterSide = new THREE.Vector3();
        this._jitterUp = new THREE.Vector3();

        this.obsidianCount = 1000;
        this.obsidianInstMesh = null;
        this.obsidianGeometry = null;
        this.obsidianMaterial = null;
        this.obsidianBumpMap = null;
        this._obsidianPositions = null;
        this._obsidianVelocities = null;
        this._obsidianRotQuats = null;
        this._obsidianScales = null;
        this._obsidianPosTemp = new THREE.Vector3();
        this._obsidianQuatTemp = new THREE.Quaternion();
        this._obsidianScaleTemp = new THREE.Vector3();
        this._obsidianMatrixTemp = new THREE.Matrix4();
        this.obsidianSpawnRadius = 1200;
        this.obsidianCurlStrength = 180;
        this.obsidianCurlFreq = 0.0056;
        this.obsidianMotionScale = 6.0;

        this.track9SphereGroup = null;
        this.track9Spheres = [];
        this.maxTrack9Spheres = 280;
        this.track9SpawnDuringDuration = true;
        this.track9DurationSpawnIntervalMs = 52;
        this._track9SpawnWindowEndMs = 0;
        this._track9SpawnWindowVelocity = 127;
        this._track9LastDurationSpawnMs = 0;
        this.track9SharedGeo = null;
        this._track9SphereMaterial = null;
        this._track9FleshTextures = null;
        this.track9PhysicsGrid = new Map();
        this.track9GridSize = 240;
        this._track9Gravity = new THREE.Vector3(0, -9, 0);
        this._track9SpawnPos = new THREE.Vector3();
        this._track9WorldCenter = new THREE.Vector3(0, 0, 0);
        this._track9Diff = new THREE.Vector3();
        this._track9SphereDrift = new THREE.Vector3();
        this._track9SubSteps = 2;
        this._track9BirthGrowSec = 0.42;
        this._track9SphereVisualScale = 0.65;

        this.promoWallFillLight = null;
        this.promoWallLightTarget = null;
        this.airNoiseVolume = null;
        this.airNoiseMaterial = null;
        this._wallCenterY = this.floorTopY + (this.ceilingY - this.floorTopY) * 0.5;
    }

    static TICK_LOOP = 36864;
    static METERS_PER_TICK_SHARD = 2.45;
    static METERS_PER_TICK_CYLINDER = 2.45;

    // ヘルパーメソッドの委譲
    _fadeOpacity01(elapsedMs, lifeMs, fadeOutMs) { return Helpers.fadeOpacity01(elapsedMs, lifeMs, fadeOutMs); }
    _growScale01(elapsedMs, growMs) { return Helpers.growScale01(elapsedMs, growMs); }
    _growInMsFromDuration(durationMs, baseGrowMs) { return Helpers.growInMsFromDuration(durationMs, baseGrowMs); }
    normalizeMidiVelocity(v) { return Helpers.normalizeMidiVelocity(v); }
    velocityToMetalShardColor(velocity, target, seedForVariation = 0) {
        Helpers.velocityToMetalShardColor(velocity, target, this._shardMetalDark, this._shardMetalMid, this._shardMetalBright);
        const n = (Motion.shardNoise(seedForVariation * 0.41, 2.1, 0.7) - 0.5) * 0.07;
        target.r = THREE.MathUtils.clamp(target.r + n, 0.08, 1);
        target.g = THREE.MathUtils.clamp(target.g + n, 0.08, 1);
        target.b = THREE.MathUtils.clamp(target.b + n, 0.08, 1);
    }
    _setHeatmapColor01(t, i3, out) { Helpers.setHeatmapColor01(t, i3, out); }

    // モーション関連の委譲
    _shardNoise(x, y, z) { return Motion.shardNoise(x, y, z); }
    _updateTrailHeadMotion(deltaTime) { Motion.updateTrailHeadMotion(this, deltaTime); }
    _updateCameraFocusFromSpawns() { Motion.updateCameraFocusFromSpawns(this); }
    updateCamera() { Motion.updateCamera(this); }
    sampleNoisePosition() { return Motion.sampleNoisePosition(this); }
    _applySequenceAwareJitter(pos, deltaTick, forwardDir, seedA, seedB) { Motion.applySequenceAwareJitter(this, pos, deltaTick, forwardDir, seedA, seedB); }

    // 部屋・ライト関連の委譲
    buildRoom() { Room.buildRoom(this); }
    _initWallMatteBlack3DText() { return Room.initWallMatteBlack3DText(this); }
    setupLights() { Room.setupLights(this); }

    // 金属片関連の委譲
    initMetalShardsSystem() { Shards.initMetalShardsSystem(this); }
    spawnMetalShardFromTrack5(velocity, durationMs = 180) { Shards.spawnMetalShardFromTrack5(this, velocity, durationMs); }
    _clearShardSlot(slotIndex) { Shards.clearShardSlot(this, slotIndex); }
    pruneExpiredShards() { Shards.pruneExpiredShards(this); }
    _updateFadeOpacity() {
        const now = performance.now();
        Shards.updateShardFadeOpacity(this, now);
        Cylinders.updateCylinderFadeOpacity(this, now);
    }

    // シリンダー関連の委譲
    initRedCylinderSystem() { Cylinders.initRedCylinderSystem(this); }
    spawnRedCylinderFromTrack6(velocity, durationMs = 180, noteNumber = 64) { Cylinders.spawnRedCylinderFromTrack6(this, velocity, durationMs, noteNumber); }
    _clearCylinderSlot(slotIndex) { Cylinders.clearCylinderSlot(this, slotIndex); }
    pruneExpiredCylinders() { Cylinders.pruneExpiredCylinders(this); }
    initRedCylinderBurstParticles() { Cylinders.initRedCylinderBurstParticles(this); }
    triggerRedCylinderBurst(worldPos, velocity = 127, durationMs = 180) { Cylinders.triggerRedCylinderBurst(this, worldPos, velocity, durationMs); }
    _updateRedCylinderBurstParticles(deltaTime) { Cylinders.updateRedCylinderBurstParticles(this, deltaTime); }

    // トラック9関連の委譲
    initTrack9SpawnSpheres() { Track9.initTrack9SpawnSpheres(this); }
    _tickTrack9DurationSpawn() { Track9.tickTrack9DurationSpawn(this); }
    spawnTrack9SphereFromWorldCenter(velocity) { Track9.spawnTrack9SphereFromWorldCenter(this, velocity); }
    _updateTrack9SpherePhysics(deltaTime) { Track9.updateTrack9SpherePhysics(this, deltaTime); }

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
    initObsidianDrifters() { Atmosphere.initObsidianDrifters(this); }
    _updateObsidianDrifters(deltaTime) { Atmosphere.updateObsidianDrifters(this, deltaTime); }
    setupAirNoiseVolume() {
        // StudioAtmosphere 内で構築されるため、ここでは何もしないか、
        // 必要に応じてマテリアルのプロパティを上書きする
    }

    // 残りのメソッド（OSC ハンドリング、初期化、廃棄など）
    static parseTrackNumber(trackNumber, message) {
        if (trackNumber !== undefined && trackNumber !== null && trackNumber !== '') {
            const num = typeof trackNumber === 'string' ? parseInt(trackNumber, 10) : Number(trackNumber);
            if (!Number.isNaN(num)) return num;
        }
        const addr = message && message.address;
        if (typeof addr === 'string') {
            const m = addr.match(/\/track\/(\d+)/i);
            if (m) return parseInt(m[1], 10);
        }
        return null;
    }

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 750;
        cameraParticle.maxDistance = 4850;
        cameraParticle.maxDistanceReset = 4500;
        cameraParticle.minY = -200;
        cameraParticle.maxY = 4500;
        cameraParticle.initializePosition?.();
    }

    switchCameraRandom() {
        super.switchCameraRandom();
        const cp = this.cameraParticles[this.currentCameraIndex];
        if (cp) {
            const d = cp.position.length();
            if (d < cp.minDistance) {
                cp.position.normalize().multiplyScalar(cp.minDistance + 500);
            }
        }
    }

    generateFleshTextures() {
        return generateFleshVeinTextures(512);
    }

    triggerPulse(velocity = 127) {
        const speed = 0.3 + (velocity / 127.0) * 1.0;
        this.pulses.push({ progress: 0.0, speed });
        const flashIntensity = (velocity / 127.0) * 2.8;
        if (this.pulsePointLight) {
            this.pulsePointLight.intensity = flashIntensity;
            this.pulsePointLight.color.copy(this.pulseColor);
        }
        this.targetLightIntensity = flashIntensity * 2.4;
    }

    setupEnvironment() {
        const env = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = env.pmremGenerator;
        this._roomEnvTexture = env.envMapTexture;
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();
        this.useSSAO = false;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });

        if (this.camera.fov < 35 || this.camera.fov > 50) this.camera.fov = 42;
        this.camera.near = 12; this.camera.far = 12000; this.camera.updateProjectionMatrix();
        this.camera.position.set(0, 1000, 4500); this.camera.lookAt(0, 400, 0);
        this._trailCenter.set(0, this.floorTopY + (this.ceilingY - this.floorTopY) * 0.33, 0);
        this._trailHeadPos.set(0, this._trailCenter.y, 0);
        this._trailHeadDir.set(0, 0.06, 1).normalize();
        this._trailHeadPosShard.copy(this._trailHeadPos);
        this._trailHeadDirShard.copy(this._trailHeadDir);
        this._trailHeadPosCylinder.copy(this._trailHeadPos).add(new THREE.Vector3(140, 40, -120));
        this._trailHeadDirCylinder.set(0.35 + Math.random() * 0.4, 0.25 + Math.random() * 0.35, 0.75 + Math.random() * 0.25).normalize();
        this._lastShardPos.copy(this._trailHeadPosShard);
        this._lastCylinderWorldPos.copy(this._trailHeadPosCylinder);
        this._cylinderHelixPhase = 0;

        this.setupEnvironment();
        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
        this.cubeCamera = new THREE.CubeCamera(10, 12000, this.cubeRenderTarget);
        this.cubeCamera.position.set(0, 600, 0); this.scene.add(this.cubeCamera);

        this.studio = new StudioBox(this.scene, studioBoxOptionsForStudioRoom(this.sceneLightingScale, this._roomEnvTexture));
        if (this.studio.studioBox) this.studio.studioBox.visible = false;

        this.buildRoom();
        this.studio.attachCeilingSpotRig(this.roomGroup, { ...ceilingSpotRigOptionsForStudioRoom(this.sceneLightingScale) });
        this.ceilingMesh = this.studio.ceilingSpotRig.ceilingMesh;
        if (this.ceilingMesh) this.ceilingMesh.visible = true;

        await this._initWallMatteBlack3DText();
        const floorMat = this.roomGroup.children[0].material;
        const wallMat = this.roomGroup.children[1].material;
        applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);

        this.setupLights();
        this.cableBlobParticle = new Scene1Particle(0, this.cableHomeY, 0);
        this.cableBlobParticle.maxSpeed = 7.0; this.cableBlobParticle.maxForce = 1.5; this.cableBlobParticle.friction = 0.015;

        this.initMetalShardsSystem();
        this.initRedCylinderSystem();
        this.initRedCylinderBurstParticles();
        this.createAmbientFloatingParticles();
        this.initTrack9SpawnSpheres();
        if (this.cableBlobParticle && this.shardGroup) this.shardGroup.position.copy(this.cableBlobParticle.position);
        if (this.cableBlobParticle) {
            this._spawnFocusWorld.copy(this.cableBlobParticle.position);
            this._cameraFocusSmoothed.copy(this._spawnFocusWorld);
        }
        if (this.calloutSystem) this.calloutSystem.setScene(this.scene);
        this.setupCameraParticleDistances();
        this.initPostProcessing();
        this.setParticleCount(this.maxShards + 8 + this.ambientParticleCount + this.maxCylinders + this.maxTrack9Spheres);
        this.initialized = true;
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;
        this._updateTrailHeadMotion(deltaTime);
        this._updateFadeOpacity();
        this.pruneExpiredShards();
        this.pruneExpiredCylinders();
        this._updateRedCylinderBurstParticles(deltaTime);
        if (this.atmosphere) {
            const p = this.shardGroup?.position ?? this._cameraFocusSmoothed ?? new THREE.Vector3(0, this.floorTopY + 600, 0);
            this.atmosphere.update(deltaTime, this.time, p);
        }
        this._tickTrack9DurationSpawn();
        this._updateTrack9SpherePhysics(deltaTime);

        const targetTrack7 = this.trackEffects[7] ? this.trackValues[7] || 0 : 0;
        const colorLerpSpeed = targetTrack7 > 0 ? 3.0 : 0.35;
        this.smoothTrack7Color += (targetTrack7 - this.smoothTrack7Color) * deltaTime * colorLerpSpeed;
        const t7 = this.smoothTrack7Color;

        if (this.trackEffects[7] && t7 > 0.02) {
            const hue = (t7 * 0.82 + this.time * 0.16) % 1;
            this.targetPulseColor.setHSL(hue, 0.9, 0.52);
        } else {
            this.targetPulseColor.copy(this.colors[this.colorIndex]);
        }
        this.pulseColor.lerp(this.targetPulseColor, 0.5);
        this.lightIntensity += (this.targetLightIntensity - this.lightIntensity) * 0.15;
        if (this.pulsePointLight) {
            this.pulsePointLight.intensity = this.lightIntensity;
            this.pulsePointLight.color.copy(this.pulseColor);
            if (this.shardGroup) this.pulsePointLight.position.copy(this.shardGroup.position);
        }
        this.targetLightIntensity += (0.0 - this.targetLightIntensity) * 0.1;

        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const p = this.pulses[i]; p.progress += deltaTime * p.speed;
            if (p.progress > 1.2) this.pulses.splice(i, 1);
        }

        if (this.cubeCamera && Math.floor(this.time * 60) % 8 === 0) this.cubeCamera.update(this.renderer, this.scene);

        if (this.cableBlobParticle && this.shardGroup) {
            const home = new THREE.Vector3(0, this.cableHomeY, 0);
            const distToHome = this.cableBlobParticle.position.distanceTo(home);
            const maxRadius = 950;
            if (distToHome > maxRadius) {
                const pullStrength = (distToHome - maxRadius) * 0.11;
                const steer = home.clone().sub(this.cableBlobParticle.position).normalize().multiplyScalar(pullStrength);
                this.cableBlobParticle.addForce(steer);
            }
            if (this.cableBlobParticle.velocity.length() < 0.55) {
                const gentleForce = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.32);
                this.cableBlobParticle.addForce(gentleForce);
            }
            this.cableBlobParticle.update(deltaTime);
            this.shardGroup.position.copy(this.cableBlobParticle.position);
            const heartbeat = Math.pow(Math.sin(this.time * 1.0), 8.0);
            const baseScale = 1.0 + Math.sin(this.time * 0.055) * 0.045;
            const scale = baseScale + heartbeat * 0.035;
            this.shardGroup.scale.setScalar(scale);
            this.shardGroup.rotation.y += deltaTime * 0.1;
            this.shardGroup.rotation.x += deltaTime * 0.055;
            this.shardGroup.rotation.z = Math.sin(this.time * 0.38) * 0.14;
        }

        if (this.cubeCamera && this.shardGroup) {
            const p = this.shardGroup.position;
            this.cubeCamera.position.set(p.x, 600 + p.y * 0.25, p.z);
        }

        this._updateCameraFocusFromSpawns();
        {
            const both = this.shards.length > 0 && this.cylinders.length > 0 && this.shardInstMesh && this.cylinderInstMesh;
            const smoothK = both ? 3.25 : 5.2;
            const a = 1 - Math.exp(-Math.min(deltaTime, 0.12) * smoothK);
            this._cameraFocusSmoothed.lerp(this._spawnFocusWorld, a);
        }
        this.updateCamera();
        const focusTargets = [this.roomGroup, this.shardGroup];
        if (this.cylinderInstMesh) focusTargets.push(this.cylinderInstMesh);
        if (this.track9SphereGroup) focusTargets.push(this.track9SphereGroup);
        if (this.ambientDust) { const dm = this.ambientDust.getMainMesh(); if (dm) focusTargets.push(dm); }
        if (this.useAutoFocusDOF) this.updateAutoFocus(focusTargets);
        else if (this.bokehPass?.uniforms?.focus) this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        updateSsaoDistanceAttenuation(this, this._cameraFocusSmoothed ?? this._spawnFocusWorld);

        if (this.calloutSystem) this.calloutSystem.update(deltaTime, this.time, this.camera, { autoGenerate: false, maxCount: 8, margin: 200 });
    }

    handleTrackNumber(trackNumber, message) {
        const tn = Scene1.parseTrackNumber(trackNumber, message);
        if (tn === null) return;
        const args = message.args || [];
        const velocity = args[1] !== undefined ? args[1] : 127;
        const value = velocity / 127.0;

        if (tn === 5) {
            this.trackValues[5] = value;
            const durRaw = args[2] !== undefined ? Number(args[2]) : 180;
            const durationMs = Number.isFinite(durRaw) ? Math.max(1, durRaw) : 180;
            const noteRaw = args[0] !== undefined ? Number(args[0]) : 64;
            const noteNumber = Number.isFinite(noteRaw) ? noteRaw : 64;
            if (velocity > 0) this.spawnRedCylinderFromTrack6(velocity, durationMs, noteNumber);
        } else if (tn === 6) {
            this.trackValues[6] = value;
            const durRaw = args[2] !== undefined ? Number(args[2]) : 180;
            const durationMs = Number.isFinite(durRaw) ? Math.max(1, durRaw) : 180;
            if (velocity > 0) {
                this._track9SpawnWindowVelocity = velocity;
                if (this.track9SpawnDuringDuration) {
                    this._track9SpawnWindowEndMs = performance.now() + durationMs;
                    this._track9LastDurationSpawnMs = performance.now();
                }
                this.spawnTrack9SphereFromWorldCenter(velocity);
            } else { this._track9SpawnWindowEndMs = 0; }
        } else if (tn === 7) {
            this.trackValues[7] = value;
            if (velocity > 0) this.colorIndex = (this.colorIndex + 1) % this.colors.length;
        } else if (tn === 9) {
            if (velocity > 0) {
                const durRaw = args[2] !== undefined ? Number(args[2]) : 180;
                const durationMs = Number.isFinite(durRaw) ? durRaw : 180;
                this.spawnMetalShardFromTrack5(velocity, durationMs);
            }
        }
    }

    toggleEffect(trackNumber) {
        if (trackNumber === 7) {
            this.colorIndex = (this.colorIndex + 1) % this.colors.length;
            this.targetPulseColor.copy(this.colors[this.colorIndex]);
            this.pulseColor.copy(this.targetPulseColor);
        }
        super.toggleEffect(trackNumber);
    }

    initPostProcessing() { setupPostEffectsPipeline(this, {}); }
    onResize() { super.onResize(); resizePostEffectsPasses(this); }
    render() { this.renderer.setClearColor(0x231a14); super.render(); }

    dispose() {
        this.initialized = false; this.scene.fog = null;
        if (this.ssaoPass) { if (this.composer) { const idx = this.composer.passes.indexOf(this.ssaoPass); if (idx !== -1) this.composer.passes.splice(idx, 1); } this.ssaoPass.enabled = false; this.ssaoPass = null; }
        if (this.saoPass) { if (this.composer) { const idx = this.composer.passes.indexOf(this.saoPass); if (idx !== -1) this.composer.passes.splice(idx, 1); } this.saoPass.enabled = false; this.saoPass = null; }
        if (this.aoDepthTexture) { this.aoDepthTexture.dispose(); this.aoDepthTexture = null; }
        disposePresentationOutputPass(this);
        if (this.studio) { this.studio.dispose(); this.studio = null; }
        if (this.wallTitleGroup) {
            this.scene.remove(this.wallTitleGroup);
            this.wallTitleGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
            this.wallTitleGroup = null;
        }
        if (this._wallTitleMaterial) { this._wallTitleMaterial.dispose(); this._wallTitleMaterial = null; }
        if (this.shardGroup) {
            this.scene.remove(this.shardGroup); this.shards = [];
            if (this.shardInstMesh) { if (this.shardInstMesh.geometry) this.shardInstMesh.geometry.dispose(); this.shardInstMesh.dispose(); this.shardInstMesh = null; }
            this._shardOpacityAttr = null; this._shardFreeSlots = []; this._metalShardMaterial = null; this.shardGroup = null;
        }
        if (this.cylinderInstMesh) {
            this.scene.remove(this.cylinderInstMesh); this.cylinderInstMesh.dispose(); this.cylinderInstMesh = null;
            this.cylinders = []; this._cylinderFreeSlots = []; this._redCylinderMaterial = null;
        }
        if (this.redBurstInstMesh) { this.scene.remove(this.redBurstInstMesh); this.redBurstInstMesh.dispose(); this.redBurstInstMesh = null; }
        if (this.redBurstSharedGeo) { this.redBurstSharedGeo.dispose(); this.redBurstSharedGeo = null; }
        if (this.redBurstMaterial) { this.redBurstMaterial.dispose(); this.redBurstMaterial = null; }
        this._redBurstPositions = null; this._redBurstVelocities = null; this._redBurstColors = null; this._redBurstRotQuats = null; this._redBurstScales = null; this._redBurstActive = false;
        if (this.obsidianInstMesh) { this.scene.remove(this.obsidianInstMesh); this.obsidianInstMesh.dispose(); this.obsidianInstMesh = null; }
        if (this.obsidianGeometry) { this.obsidianGeometry.dispose(); this.obsidianGeometry = null; }
        if (this.obsidianMaterial) { this.obsidianMaterial.dispose(); this.obsidianMaterial = null; }
        if (this.obsidianBumpMap) { this.obsidianBumpMap.dispose(); this.obsidianBumpMap = null; }
        this._obsidianPositions = null; this._obsidianVelocities = null; this._obsidianRotQuats = null; this._obsidianScales = null;
        if (this.atmosphere) { this.atmosphere.dispose(); this.atmosphere = null; }
        if (this.track9SphereGroup) {
            this.scene.remove(this.track9SphereGroup);
            for (const sp of this.track9Spheres) { if (sp.mesh && sp.mesh.material) sp.mesh.material.dispose(); }
            this.track9Spheres = [];
            if (this.track9SharedGeo) { this.track9SharedGeo.dispose(); this.track9SharedGeo = null; }
            if (this._track9SphereMaterial) {
                if (this._track9SphereMaterial.map) this._track9SphereMaterial.map.dispose();
                if (this._track9SphereMaterial.bumpMap) this._track9SphereMaterial.bumpMap.dispose();
                this._track9SphereMaterial.dispose(); this._track9SphereMaterial = null;
            }
            this._track9FleshTextures = null; this.track9SphereGroup = null;
        }
        if (this.promoWallFillLight) { this.scene.remove(this.promoWallFillLight); this.promoWallFillLight.dispose(); this.promoWallFillLight = null; }
        this.ceilingMesh = null;
        if (this.promoWallLightTarget) { this.scene.remove(this.promoWallLightTarget); this.promoWallLightTarget = null; }
        if (this.cubeCamera) { this.scene.remove(this.cubeCamera); this.cubeCamera = null; }
        if (this.cubeRenderTarget) { this.cubeRenderTarget.dispose(); this.cubeRenderTarget = null; }
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
        disposeStudioRoomEnvironmentMap({ pmremGenerator: this.pmremGenerator, envMapTexture: this._roomEnvTexture }, this.scene);
        this.pmremGenerator = null; this._roomEnvTexture = null;
        if (this.calloutSystem) this.calloutSystem.setScene(null);
        super.dispose();
    }
}
