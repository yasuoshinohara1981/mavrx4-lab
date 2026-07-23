/**
 * Scene12: mathym | Xenodub
 *
 * Scene09（うねりグリッド＋赤い菱形マーカー◇＋コールアウト）を
 * Scene12のStudioBox部屋ライティング・質感に統合した版。
 *
 * 方針:
 *  - Scene12の buildRoom / setupLights / createAmbientFloatingParticles はそのまま維持。
 *  - Scene09のグリッド立方体・グリッドライン・形状モーフィング・warpPulses/implodePulses
 *    赤マーカー・波形・コールアウト・track08ブースト・triggerExpandEffect を移植。
 *  - sceneNumber: 12, title: 'mathym | Xenodub', kitNo: 4 はScene12の値を維持。
 *  - DOFパラメータはScene09の値ベース、filmGrainはScene12の 0.65 を優先。
 *  - useTrack2Strobe: false (Scene09と同じ)
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import {
    StudioBox,
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
    STUDIO_FLOOR_TOP_Y
} from '../../lib/presentation/index.js';
import * as Room from '../scene10/Scene10.room.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { Scene02Particle } from '../scene02/Scene02Particle.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';
import { StudioFluorescentLamp } from '../../lib/StudioFluorescentLamp.js';
import { generateFleshVeinTextures } from '../../lib/FleshVeinTextures.js';
import {
    gridWarpVertexHead,
    gridWarpBeginVertex,
    gridWarpBeginNormal,
    gridWarpProjectVertex,
    GRID_WARP_MAX_WARP_PULSES,
    GRID_WARP_MAX_IMP_PULSES,
    MORPH_SHAPE_ID
} from './gridWarp.glsl.js';

export class Scene12 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenodub';
        this.initialized = false;
        this.sceneNumber = 12;
        this.kitNo = 4;
        this.sharedResourceManager = sharedResourceManager;

        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this.sceneLightingScale = 0.32;
        this._roomEnvPresentation = null;
        /** @type {THREE.Light[] | null} */
        this._minimalLights = null;

        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = false;
        this.sceneFogDensity = 0.000012;
        this.atmosphere = null;
        this.sceneFogColor = 0x000000;
        this.useSSAO = true;
        this.useFilmGrain = true;
        this.useAutoFocusDOF = true;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        this.ssaoNearKernelRadius = 5.5;
        this.ssaoNearMinDistance = 0.006;
        this.ssaoNearMaxDistance = 0.08;
        this.ssaoFarAttenuation = 0.38;
        this.outputPass = null;

        this.trackEffects = {
            1: true,
            2: true,
            3: true,   // デフォルトON: ダイナミックエフェクト（下記 handleOSC track3）
            4: true,   // デフォルトON: ダイナミックエフェクト（下記 handleOSC track4）
            5: true,
            6: true,
            7: true,
            8: true,
            9: true,
            12: true
        };
        // track2 は色反転エフェクト（ストロボは使わない）
        this.useTrack2Strobe = false;
        this.track2FlashMs = 60;   // track2色反転の瞬間フラッシュ時間(ms)。duration依存をやめて固定短時間に

        // 3Dコールアウト描画のON/OFF（重い場合は false で止める）
        this.use3DCallouts = false;
        this.setScreenshotText(this.title);

        this.instancedMeshManager = null;
        this.particles = [];
        this.expandSpheres = [];
        this.useWallCollision = false;

        // Scene11と同じ標準部屋サイズ
        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;

        // ===== 真っ暗空間モード（試験用フラグ） =====
        // true: 天井ライト・壁/床・四隅蛍光灯を描画しない → 背景真っ黒
        this.blackVoidMode = false;
        // シャドウ描画（blackVoidModeとは独立。部屋を出しつつ影だけ切れる）
        this.enableShadows = true;

        // StudioBox
        this.useStudioBox = false;
        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.promoWallLightTarget = null;
        this.promoWallFillLight = null;

        // ライティング関連（Scene12固有）
        this.fillPointLight = null;
        this.pulsePointLight = null;
        this.strobeCameraSpot = null;
        this._strobeCameraSpotTarget = null;
        this._strobeCameraSpotPeak = 450.0;
        this._totalSphereGlow = 0;
        this.collectiveGlowLight = null;

        // チリパーティクルパラメータ
        this.ambientParticleCount = 1000;
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientMinLiving = 180;

        this._tmpV = new THREE.Vector3();
        this._mat = new THREE.Matrix4();
        this._quat = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
        this._colorTmp = new THREE.Color();

        // ===== うねりグリッド =====
        // 部屋: roomHalfW=5000, ceilingY=5500, floorTopY=-498
        this.gridFieldW = 7000.0;
        this.gridFieldH = 4200.0;
        this.gridCenterY = STUDIO_FLOOR_TOP_Y + this.gridFieldH * 0.5 + 500;  // 部屋中央より少し上
        this.gridCenterZ = 0.0;
        // ライン/波形/マーカー用のグリッド解像度。フィールド比(7000:4200≒1.667)に合わせて横長セル。
        // キューブと 1:1（ライン交点ごとにキューブ1個）。ライン点数=キューブ点数。
        // 真っ暗モードで負荷が減ったぶんキューブ数を約2倍(≒1万)に。128 × 78 = 9,984。
        // ※ライン更新はCPUなのでここを上げるとCPU負荷も増える点に注意。
        this.gridCols = 128;
        this.gridRows = 78;

        // ===== キューブ本体の解像度 =====
        // ライン1マスにキューブ1個（1:1）。キューブ解像度 = ライン解像度で格子点が完全一致する。
        this.cubeGridMultiple = 1;
        this.cubeCols = this.gridCols;   // 129
        this.cubeRows = this.gridRows;   // 77
        this.sphereCount = this.cubeCols * this.cubeRows;

        this.gridBaseX = null;
        this.gridBaseY = null;

        this.gridFineCols = this.gridCols * 2;
        this.gridFineRows = this.gridRows * 2;
        this.gridCoarseCols = this.gridCols;
        this.gridCoarseRows = this.gridRows;

        this.gridWarpLevel = 0.0;

        // ===== track10: Z方向押し出しパルス =====
        this.warpPulses = [];
        this.warpPulseMax = 16;
        this.implodePulses = [];
        this.implodePulseMax = 8;
        this.pulseAmpMin = 100.0;
        this.pulseAmpMax = 1100.0;
        this.pulseRadiusMin = 600.0;
        this.pulseRadiusPerSec = 2500.0;
        this.pulseDecay = 0.9;
        this.idleBreathAmp = 22.0;

        // 形状モーフィング
        this.morphShapes = ['FLAT', 'SPHERE', 'CYLINDER', 'WAVE', 'TORUS'];
        this.morphCurrentIdx = 0;
        this.morphNextIdx = 1;
        this.morphT = 0.0;
        this.morphTicksPerShape = 9216;
        this.morphRadius = Math.min(this.gridFieldW, this.gridFieldH) * 0.42;

        // ===== トラック別オシロ波形 =====
        this.waveFieldW = this.gridFieldW;
        this.waveCenterY = this.gridCenterY;
        this.trackCount = 12;
        this.waveSegments = 96;   // 160 → 96（毎フレームTube再生成の頂点数を削減）
        this.waveLines = [];
        this.wavePositions = [];
        this.waveTubeRadius = 2.5;
        this._waveCurvePts = [];
        this.wavePhase = 0.0;
        this.trackVoice = [];
        this.busLevel = 0.0;

        // ---- track5: コールアウト ----
        this.calloutReady = false;
        this.calloutTextTick = 0;
        this.calloutTextInterval = 0.05;

        // ---- track1: 赤い菱形マーカー◇ ----
        this.crossMax = 256;
        this.crossGroup = null;
        this.crossPool = [];
        this._crossNext = 0;
        this.crossSize = 40;

        // ---- track8: 波形の中心を貫くX軸シリンダー ----
        this.track8Cylinders = [];
        this.track8MaxCount = 8;
        this.track8RadiusMin = 8.0;
        this.track8RadiusMax = 90.0;
        this.track8LenMin = 1200.0;
        this.track8LenPerSec = 6000.0;

        // ---- track8: グリッドパーティクルのスケールブースト ----
        this._cubeBoostMap = null;
        this._cubeBoostDecay = 2.2;
        this._cubeBoostRadius = Math.min(this.gridFieldW, this.gridFieldH) * 0.28;

        // ---- actual_tick連動のグリッド増加 ----
        this._tickGrowActive = false;   // OSCの/actual_tickを一度でも観測したらtrue
        this._visibleRows = this.gridRows;

        // ---- track9: ブルーム・ブロッサム（拡大する発光リング + 放射クロス + 中心グロー）----
        this.useBlossomFloorRing = false;  // false: 床に広がる発光リングを出さない（クロス花火・グローは残す）
        this._blossomRings = [];        // { mesh, mat, life, maxLife, maxScale } のプール
        this._blossomRingPool = [];     // 使い回しメッシュ
        this._blossomRingMax = 6;
        this._blossomGlowLight = null;  // 一時発光ポイントライト
        this._blossomGlowLevel = 0.0;   // 0〜1 発光量（減衰）

        // ヒートマップ色相ランダムウォーク
        this._heatHue = 0.0;       // 現在の色相オフセット（0〜1）
        this._heatHueVel = 0.0;    // 色相変化速度
        this._heatHueTarget = Math.random(); // 次の目標色相

        // ---- イベント間隔クラスタリング ----
        this.lastEvtTime = {};
        this.lastEvtPos = {};
        this._lastExpandPos = null;
        this.clusterFarTime = 0.6;

        // ---- 擬似乱数（xorshift） ----
        this.seed = 0x9e3779b9 | 0;
        this._warpScratch = { x: 0, y: 0, z: 0 };
        this._scaleScratch = new THREE.Vector3();
        this._dofCamDir = new THREE.Vector3();
        this._dofToTarget = new THREE.Vector3();

        // _centerSmoothed 初期値はgridCenterY基準
        this._centerSmoothed = new THREE.Vector3(0, this.gridCenterY, 0);

        // ===== パーティクル基準サイズのLFOノイズ =====
        // actual_tick と phase を使ってゆっくり大きさを変化させる
        this._particleNoiseScale = 1.0;  // 現在のノイズ係数（1.0=基準）

        // ===== GPU頂点変位（キューブ本体のwarpをシェーダで実行） =====
        // true: warp計算を頂点シェーダで行う（パーティクル数に対してCPU定数コスト）
        // false: 旧CPU実装（_updateGridCubesCPU）。見た目比較・フォールバック用。
        this.useGPUWarp = true;
        this._gpuWarpUniforms = null;   // メインマテリアルのuniform参照
        this._gpuWarpUniformsDepth = null; // customDepthMaterialのuniform参照
        this._boostAttr = null;         // aBoost InstancedBufferAttribute
        // warp後の中心Z（uGridCenterZ）はJS版と同じ this.gridCenterZ を使う
    }

    // ===== Scene12固有: buildRoom / setupLights / createAmbientFloatingParticles =====

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
            minLivingBurst: this.ambientMinLiving,
            // グリッドが広大（far=200000）なのでボリュームをカメラ範囲全体に広げてエッジを隠す
            airNoiseVolumeScale: 15.0
        });
    }

    // ===== Scene09由来: ライティング補完（useStudioBox=falseの場合の最小ライト） =====

    setupMinimalParticleLights() {
        this._minimalLights = [];
        const amb = new THREE.AmbientLight(0x444444, 0.45);
        this.scene.add(amb);
        this._minimalLights.push(amb);
        const hem = new THREE.HemisphereLight(0xc8d0e0, 0x0a0c10, 0.55);
        this.scene.add(hem);
        this._minimalLights.push(hem);
        const pt = new THREE.PointLight(0xffffff, 2.5, 14000, 0.4);
        pt.position.set(0, 2400, 0);
        this.scene.add(pt);
        this._minimalLights.push(pt);
    }

    createStudioBox() {
        const L = this.sceneLightingScale;
        const studioOpts = {
            ...studioBoxOptionsForStudioRoom(L, this._roomEnvTexture),
            ambientIntensity: 0.015,
            lightIntensity: Math.max(3.0, 3.5 * L),
            fluorescentPointIntensity: 45.0,
            fluorescentPointDecay: 1.2
        };
        this.studio = new StudioBox(this.scene, studioOpts);
        const boxMats = this.studio.studioBox?.material;
        if (Array.isArray(boxMats) && boxMats[2]) {
            boxMats[2].emissive?.setRGB(0, 0, 0);
            boxMats[2].emissiveIntensity = 0.0;
            boxMats[2].needsUpdate = true;
        }
        const ceilBase = ceilingSpotRigOptionsForStudioRoom(L);
        this.studio.attachCeilingSpotRig(this.studio.studioBox, {
            includeCeilingPlane: false,
            ...ceilBase,
            emissiveIntensity: 0.0,
            shadowDebugSpot: {
                ...ceilBase.shadowDebugSpot,
                intensity: 0.0
            }
        });
    }

    /** 天井四隅に蛍光灯を配置 */
    _repositionFluorescentLamps() {
        // StudioBoxのlampを全部無効化
        for (const lamp of (this.studio?.fluorescentLights || [])) {
            if (lamp.group) lamp.group.visible = false;
            if (lamp.pointLight) lamp.pointLight.intensity = 0;
        }
        // 既存をクリア
        if (this._cornerLamps) {
            for (const lamp of this._cornerLamps) lamp.dispose?.();
        }
        this._cornerLamps = [];

        const tubeHeight = (this.ceilingY - this.floorTopY) * 0.55;
        // 管の中心を床から tubeHeight/2 の高さに置く
        const lampY = this.floorTopY + tubeHeight * 0.5;
        const cx = this.roomHalfW - 400;
        const cz = this.roomHalfD - 400;
        const corners = [[cx, lampY, cz], [-cx, lampY, cz], [cx, lampY, -cz], [-cx, lampY, -cz]];

        corners.forEach(([x, y, z], i) => {
            const lamp = new StudioFluorescentLamp(this.scene, {
                position: { x, y, z },
                color: 0xfff8e8,
                emissiveIntensity: 10.5,
                radius: 28,
                height: tubeHeight,
                pointIntensity: 45.0,
                distance: this.roomHalfW * 2.8,
                decay: 1.2
            });
            this._cornerLamps.push(lamp);
        });
    }

    /** StudioBox PointLight等のビジュアルを隠す */
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

    // ===== Scene09由来: テクスチャ・マテリアル =====

    /**
     * チャコールグレー〜黒寄りのランダム（岩・鉱物っぽい微妙な色相ブレ）
     */
    _setRandomRockCharcoalColor(out) {
        const l = 0.12 + Math.random() * 0.22;
        out.setHSL(0, 0, l);
    }

    _applyEnvMapToSphereMaterial() {
        const m = this.instancedMeshManager?.getMainMesh()?.material;
        const env = this.scene?.environment;
        if (m && env) {
            m.envMap = env;
            m.needsUpdate = true;
        }
    }

    /**
     * キャンバス生成の map / bump（岩肌っぽい暗いムラと凹凸）
     */
    generateFleshTextures() {
        const size = 512;
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size;
        colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');
        cCtx.fillStyle = '#2a2a2a';
        cCtx.fillRect(0, 0, size, size);

        for (let i = 0; i < 60; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 5 + Math.random() * 30;
            const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
            const grayVal = 55 + Math.random() * 55;
            grad.addColorStop(0, `rgba(${grayVal}, ${grayVal}, ${grayVal}, 0.35)`);
            grad.addColorStop(1, 'rgba(40, 40, 40, 0)');
            cCtx.fillStyle = grad;
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
        }

        for (let i = 0; i < 200; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 0.5 + Math.random() * 1.5;
            cCtx.fillStyle = Math.random() > 0.5 ? 'rgba(20, 22, 24, 0.45)' : 'rgba(90, 92, 96, 0.35)';
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
        }

        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size;
        bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, size, size);

        bCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        for (let i = 0; i < 30; i++) {
            bCtx.lineWidth = 1 + Math.random() * 2;
            let x = Math.random() * size;
            let y = Math.random() * size;
            bCtx.beginPath();
            bCtx.moveTo(x, y);
            for (let j = 0; j < 8; j++) {
                x += (Math.random() - 0.5) * 60;
                y += (Math.random() - 0.5) * 60;
                bCtx.lineTo(x, y);
            }
            bCtx.stroke();
        }

        for (let i = 0; i < 100; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 5 + Math.random() * 20;
            const grad = bCtx.createRadialGradient(x, y, 0, x, y, r);
            const isUp = Math.random() > 0.3;
            const val = isUp ? 255 : 0;
            grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.5)`);
            grad.addColorStop(1, 'rgba(128, 128, 128, 0)');
            bCtx.fillStyle = grad;
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }

        const colorTex = new THREE.CanvasTexture(colorCanvas);
        colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
        const bumpTex = new THREE.CanvasTexture(bumpCanvas);
        bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;

        return { map: colorTex, bumpMap: bumpTex };
    }

    // ===== Scene09由来: グリッド立方体 =====

    createSpheres() {
        // GPU warp のときはキューブ専用の高解像度、CPU版のときは従来のグリッド解像度
        const cols = this.useGPUWarp ? this.cubeCols : this.gridCols;
        const rows = this.useGPUWarp ? this.cubeRows : this.gridRows;
        this.sphereCount = cols * rows;
        const n = this.sphereCount;

        const geo = new THREE.BoxGeometry(1, 1, 1);
        {
            const nv = geo.attributes.position.count;
            const white = new Float32Array(nv * 3);
            white.fill(1);
            geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
        }
        const flesh = generateFleshVeinTextures(512, { seed: 903 });
        const mat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            map: flesh.map,
            bumpMap: flesh.bumpMap,
            bumpScale: 4.0,
            metalness: 0.5,
            roughness: 0.3,
            fog: true,
            vertexColors: true
        });
        if (this.scene?.environment) mat.envMap = this.scene.environment;

        // GPU warp を使う場合、頂点シェーダに warp/scale を注入する
        if (this.useGPUWarp) {
            this._installGPUWarpMaterial(mat, geo);
        }

        this.instancedMeshManager = new InstancedMeshManager(this.scene, geo, mat, n);
        const mainMesh = this.instancedMeshManager.getMainMesh();
        mainMesh.castShadow = this.enableShadows;
        mainMesh.receiveShadow = this.enableShadows;
        if (this.useGPUWarp && this._gpuDepthMaterial) {
            mainMesh.customDepthMaterial = this._gpuDepthMaterial;
        }

        this.gridBaseX = new Float32Array(n);
        this.gridBaseY = new Float32Array(n);

        // GPU warp 用の per-instance 属性
        // aBaseXY: グリッド基準座標 / aBoost: track8スケールブースト（0で初期化）
        const baseXY = new Float32Array(n * 2);
        const boostArr = new Float32Array(n); // 0 で初期化
        // 頂点に「基準スケール」を内包させるため、インスタンスごとの半径も保持する。
        // GPU版では position*gwScale で描くので、各キューブの基準半径を頂点側に持たせる必要がある
        // → 均一半径のBoxGeometryを共有しつつ、半径差はインスタンス属性 aRadius で表現する。
        const radiusArr = new Float32Array(n);
        // 回転を完全GPU化: 初期回転角(aRotSeed) と 基礎角速度(aAngVel) と 連番(aIndexF)
        const rotSeedArr = new Float32Array(n * 3);
        const angVelArr = new Float32Array(n * 3);
        const indexArr = new Float32Array(n);

        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;

        let i = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const bx = -hw + (this.gridFieldW * c) / (cols - 1);
                const by = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
                this.gridBaseX[i] = bx;
                this.gridBaseY[i] = by;

                let worldR;
                const sizeRand = Math.random();
                if (sizeRand < 0.7) worldR = 20 + Math.random() * 20;
                else if (sizeRand < 0.95) worldR = 40 + Math.random() * 30;
                else worldR = 65 + Math.random() * 35;

                const scale = new THREE.Vector3(worldR, worldR, worldR);
                const radius = Math.max(scale.x, scale.y, scale.z) * 0.5;
                const p = new Scene02Particle(bx, by, this.gridCenterZ, radius, scale);
                p.angularVelocity.multiplyScalar(1.1);   // 2.5→1.1 キューブ回転をさらに落ち着かせる
                this.particles.push(p);

                baseXY[i * 2] = bx;
                baseXY[i * 2 + 1] = by;
                radiusArr[i] = worldR;

                // 回転: 初期角と角速度を属性へ（GPU側で time*角速度 として積分する）
                rotSeedArr[i * 3] = p.rotation.x;
                rotSeedArr[i * 3 + 1] = p.rotation.y;
                rotSeedArr[i * 3 + 2] = p.rotation.z;
                angVelArr[i * 3] = p.angularVelocity.x;
                angVelArr[i * 3 + 1] = p.angularVelocity.y;
                angVelArr[i * 3 + 2] = p.angularVelocity.z;
                indexArr[i] = i;

                this._setRandomRockCharcoalColor(this._colorTmp);
                this.instancedMeshManager.setColorAt(i, this._colorTmp);

                if (this.useGPUWarp) {
                    // GPU版: instanceMatrix は恒等（位置/回転/スケール全部シェーダ）
                    this.instancedMeshManager.setMatrixAt(i, this._zeroPos, this._identityEuler, this._unitScale);
                } else {
                    this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
                }
                i++;
            }
        }
        this.instancedMeshManager.markColorsNeedsUpdate();
        this.instancedMeshManager.markNeedsUpdate();
        this.setParticleCount(n);

        this._cubeBoostMap = new Float32Array(n);
        this._gridPulseCache = new Float32Array(n);

        if (this.useGPUWarp) {
            geo.setAttribute('aBaseXY', new THREE.InstancedBufferAttribute(baseXY, 2));
            this._boostAttr = new THREE.InstancedBufferAttribute(boostArr, 1);
            this._boostAttr.setUsage(THREE.DynamicDrawUsage);
            geo.setAttribute('aBoost', this._boostAttr);
            // aRadius: 各インスタンスの基準半径（頂点スケールに乗る）
            geo.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radiusArr, 1));
            // 回転（完全GPU化）
            geo.setAttribute('aRotSeed', new THREE.InstancedBufferAttribute(rotSeedArr, 3));
            geo.setAttribute('aAngVel', new THREE.InstancedBufferAttribute(angVelArr, 3));
            geo.setAttribute('aIndexF', new THREE.InstancedBufferAttribute(indexArr, 1));
        }
    }

    /**
     * メインマテリアル(mat)と影用depthMaterialに GPU warp を注入する。
     * uniform 参照を保持し、毎フレーム _syncWarpUniforms で更新する。
     */
    _installGPUWarpMaterial(mat, geo) {
        // シェーダ再利用のためのキャッシュキー（GPU warp 版として一意に）
        mat.customProgramCacheKey = () => 'scene12-gpu-warp';

        const makeUniforms = () => ({
            uWarpAmp: { value: 0 },
            uTime: { value: 0 },
            uBreath: { value: this.idleBreathAmp },
            uGridCenterY: { value: this.gridCenterY },
            uGridCenterZ: { value: this.gridCenterZ },
            uGridFieldW: { value: this.gridFieldW },
            uGridFieldH: { value: this.gridFieldH },
            uMorphRadius: { value: this.morphRadius },
            uMorphShapeA: { value: 0 },
            uMorphShapeB: { value: 1 },
            uMorphT: { value: 0 },
            uNoiseScale: { value: 1.0 },
            uWarpCount: { value: 0 },
            uWarpPulses: { value: Array.from({ length: GRID_WARP_MAX_WARP_PULSES }, () => new THREE.Vector4()) },
            uWarpEnv: { value: new Float32Array(GRID_WARP_MAX_WARP_PULSES) },
            uImpCount: { value: 0 },
            uImpPulses: { value: Array.from({ length: GRID_WARP_MAX_IMP_PULSES }, () => new THREE.Vector4()) },
            uImpEnv: { value: new Float32Array(GRID_WARP_MAX_IMP_PULSES) },
        });

        // hasNormal=true: メインマテリアル（beginnormal_vertex で gwRotMat 生成＋法線回転）
        // hasNormal=false: depthマテリアル（法線chunk無し → begin_vertex 内で gwRotMat 生成）
        const injectVertex = (shader, uniforms, hasNormal) => {
            for (const k in uniforms) shader.uniforms[k] = uniforms[k];
            shader.vertexShader =
                'attribute float aRadius;\n' +
                gridWarpVertexHead + '\n' +
                shader.vertexShader;

            if (hasNormal) {
                // 法線chunkで gwRotMat 生成＋法線回転
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <beginnormal_vertex>',
                    gridWarpBeginNormal
                );
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    gridWarpBeginVertex
                );
            } else {
                // depth: gwRotMat を begin_vertex 内で生成してから使う
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    'mat3 gwRotMat = gwRotationMatrix(aBaseXY.x, aBaseXY.y);\n' + gridWarpBeginVertex
                );
            }
            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                gridWarpProjectVertex
            );
        };

        const mainUniforms = makeUniforms();
        mat.onBeforeCompile = (shader) => {
            injectVertex(shader, mainUniforms, true);
            mat.userData.shader = shader;
        };
        this._gpuWarpUniforms = mainUniforms;

        // 影用 depth material にも同じ warp を注入（影が本体とズレないように）
        const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        const depthUniforms = makeUniforms();
        depthMaterial.onBeforeCompile = (shader) => {
            injectVertex(shader, depthUniforms, false);
            depthMaterial.userData.shader = shader;
        };
        this._gpuWarpUniformsDepth = depthUniforms;
        this._gpuDepthMaterial = depthMaterial;

        // これらは createSpheres のループで参照する恒等トランスフォーム
        this._zeroPos = new THREE.Vector3(0, 0, 0);
        this._identityEuler = new THREE.Euler(0, 0, 0);
        this._unitScale = new THREE.Vector3(1, 1, 1);
    }

    createGridLines() {
        const cols = this.gridCols;
        const rows = this.gridRows;
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const stride = 1;

        this._gridLineSegs = [];
        for (let r = 0; r < rows; r += stride) {
            for (let c = 0; c < cols - 1; c++) {
                const bx0 = -hw + (this.gridFieldW * c) / (cols - 1);
                const bx1 = -hw + (this.gridFieldW * (c + 1)) / (cols - 1);
                const by = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
                this._gridLineSegs.push({ ax: bx0, ay: by, bx: bx1, by, ai: r * cols + c, bi: r * cols + c + 1 });
            }
        }
        for (let c = 0; c < cols; c += stride) {
            for (let r = 0; r < rows - 1; r++) {
                const bx = -hw + (this.gridFieldW * c) / (cols - 1);
                const by0 = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
                const by1 = this.gridCenterY - hh + (this.gridFieldH * (r + 1)) / (rows - 1);
                this._gridLineSegs.push({ ax: bx, ay: by0, bx: bx, by: by1, ai: r * cols + c, bi: (r + 1) * cols + c });
            }
        }

        const maxSegs = this._gridLineSegs.length;
        const positions = new Float32Array(maxSegs * 6);
        const colors = new Float32Array(maxSegs * 6);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this._gridLineMat = new THREE.LineBasicMaterial({
            vertexColors: true,
        });
        this._gridLineMesh = new THREE.LineSegments(geo, this._gridLineMat);
        this._gridLineMesh.frustumCulled = false;
        this.scene.add(this._gridLineMesh);
        this._gridLineCol = { r: 0, g: 0, b: 0 };
        this._gridLineColorTmp = new THREE.Color();
    }

    _updateGridLines() {
        if (!this._gridLineMesh || !this._gridLineSegs) return;
        const t = this.time;
        const amp = this._warpAmp();
        const heatMax = this.pulseAmpMax * 1.0;  // 2.0→1.0（正規化の分母を下げて赤に届きやすく）
        const col = this._gridLineCol;
        const pc = this._gridPulseCache;
        const geo = this._gridLineMesh.geometry;
        const pos = geo.attributes.position.array;
        const clr = geo.attributes.color.array;

        // === 最適化: 全格子点の warp を「1点1回だけ」計算してキャッシュ ===
        // 旧実装はセグメント両端ごとに warp（=格子点を平均2回ずつ計算、morph三角関数が主犯）。
        // さらに morph オフセットも格子点ごと事前計算し、warp をインライン展開して関数呼び出しと
        // morph 重複計算を排除する（_gridWarp 経由だと _getMorphOffset が毎回走るため）。
        const cols = this.gridCols;
        const rows = this.gridRows;
        const nPts = cols * rows;
        let cache = this._gridPointCache;
        if (!cache || cache.length !== nPts * 3) {
            cache = this._gridPointCache = new Float32Array(nPts * 3);
        }
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const breath = this.idleBreathAmp;
        const gcy = this.gridCenterY;
        const gcz = this.gridCenterZ;
        const mo = this._morphScratch || (this._morphScratch = { x: 0, y: 0, z: 0 });
        let k = 0;
        for (let r = 0; r < rows; r++) {
            const by = gcy - hh + (this.gridFieldH * r) / (rows - 1);
            for (let c = 0; c < cols; c++) {
                const bx = -hw + (this.gridFieldW * c) / (cols - 1);
                // morph（形状オフセット）— _getMorphOffset を1回だけ
                const m = this._getMorphOffset(bx, by);
                // idle 呼吸（時間依存）
                const ox = bx + m.dx + Math.sin(bx * 0.0009 + by * 0.0007 + t * 0.5) * breath;
                const oy = by + m.dy + Math.cos(by * 0.0009 - bx * 0.0007 + t * 0.6) * breath;
                const idleZ = Math.sin(bx * 0.0011 - by * 0.0009 + t * 0.7) * breath;
                let oz = gcz + idleZ + this._pulseZ(bx, by) + m.dz;
                // implode（out を破壊更新するので scratch に組んで反映）
                mo.x = ox; mo.y = oy; mo.z = oz;
                this._implodeXYZ(bx, by, mo);
                cache[k] = mo.x; cache[k + 1] = mo.y; cache[k + 2] = mo.z;
                k += 3;
            }
        }

        // セグメントはキャッシュをインデックス参照するだけ（warp 計算なし）
        for (let i = 0; i < this._gridLineSegs.length; i++) {
            const seg = this._gridLineSegs[i];
            const ca = seg.ai * 3, cb = seg.bi * 3;
            const base = i * 6;

            pos[base + 0] = cache[ca];     pos[base + 1] = cache[ca + 1]; pos[base + 2] = cache[ca + 2];
            pos[base + 3] = cache[cb];     pos[base + 4] = cache[cb + 1]; pos[base + 5] = cache[cb + 2];

            const dispZ = pc ? (pc[seg.ai] + pc[seg.bi]) * 0.5 : 0;
            this._heatmapColor(dispZ / heatMax, col);
            clr[base + 0] = col.r; clr[base + 1] = col.g; clr[base + 2] = col.b;
            clr[base + 3] = col.r; clr[base + 4] = col.g; clr[base + 5] = col.b;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
    }

    /** 現在の歪み強度 */
    _warpAmp() {
        return 120 + this.gridWarpLevel * 220;
    }

    // ===== Scene09由来: warpPulses / implodePulses =====

    _fireWarpPulse(velocity, durationMs) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const durSec = durationMs > 0 ? durationMs / 1000 : 0.6;
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const x = -hw + this._rand() * this.gridFieldW;
        const y = (this.gridCenterY - hh) + this._rand() * this.gridFieldH;
        const dir = this._rand() < 0.5 ? 1 : -1;
        const amp = this.pulseAmpMin + (this.pulseAmpMax - this.pulseAmpMin) * v;
        const radius = this.pulseRadiusMin + this.pulseRadiusPerSec * durSec;
        const maxLife = 0.9 + durSec * 0.6 + v * 0.8;

        this.warpPulses.push({ x, y, dir, amp, radius, life: maxLife, maxLife });
        while (this.warpPulses.length > this.warpPulseMax) this.warpPulses.shift();
    }

    _updateWarpPulses(dt) {
        if (!this.warpPulses.length) return;
        for (let i = this.warpPulses.length - 1; i >= 0; i--) {
            const p = this.warpPulses[i];
            p.life -= dt;
            if (p.life <= 0) this.warpPulses.splice(i, 1);
        }
    }

    _pulseZ(bx, by) {
        const pulses = this.warpPulses;
        if (!pulses.length) return 0;
        let z = 0;
        for (let i = 0; i < pulses.length; i++) {
            const p = pulses[i];
            const dx = bx - p.x;
            const dy = by - p.y;
            const d2 = dx * dx + dy * dy;
            const falloff = Math.exp(-d2 / (p.radius * p.radius));
            if (falloff < 0.002) continue;
            const k = p.life / p.maxLife;
            const env = k * k;
            z += p.dir * p.amp * falloff * env;
        }
        return z;
    }

    // ===== Scene09由来: 形状モーフィング =====

    _morphOffset(shape, nx, ny, bx, by) {
        const R = this.morphRadius;
        switch (shape) {
            case 'FLAT':
                return { dx: 0, dy: 0, dz: 0 };
            case 'SPHERE': {
                const theta = nx * Math.PI;
                const phi = (ny * 0.5 + 0.5) * Math.PI;
                return {
                    dx: R * Math.sin(phi) * Math.sin(theta) - bx,
                    dy: R * Math.cos(phi) - (by - this.gridCenterY),
                    dz: R * Math.sin(phi) * Math.cos(theta) - R * 0.15,
                };
            }
            case 'CYLINDER': {
                const theta2 = nx * Math.PI;
                return {
                    dx: R * Math.sin(theta2) - bx,
                    dy: 0,
                    dz: R * Math.cos(theta2) - R * 0.15,
                };
            }
            case 'WAVE': {
                const wz = Math.sin(nx * Math.PI * 2) * R * 0.5
                         + Math.sin(ny * Math.PI * 2) * R * 0.3;
                return { dx: 0, dy: 0, dz: wz };
            }
            case 'TORUS': {
                const R2 = R * 0.38;
                const theta3 = nx * Math.PI;
                const phi3 = ny * Math.PI * 2;
                const rx = (R + R2 * Math.cos(phi3)) * Math.sin(theta3) - bx;
                const ry = R2 * Math.sin(phi3) - (by - this.gridCenterY);
                const rz = (R + R2 * Math.cos(phi3)) * Math.cos(theta3) - R * 0.15;
                return { dx: rx, dy: ry, dz: rz };
            }
            default:
                return { dx: 0, dy: 0, dz: 0 };
        }
    }

    _getMorphOffset(bx, by) {
        const nx = (bx / (this.gridFieldW * 0.5));
        const ny = ((by - this.gridCenterY) / (this.gridFieldH * 0.5));
        const a = this._morphOffset(this.morphShapes[this.morphCurrentIdx], nx, ny, bx, by);
        const b = this._morphOffset(this.morphShapes[this.morphNextIdx], nx, ny, bx, by);
        const t = this.morphT * this.morphT * (3 - 2 * this.morphT);
        return {
            dx: a.dx + (b.dx - a.dx) * t,
            dy: a.dy + (b.dy - a.dy) * t,
            dz: a.dz + (b.dz - a.dz) * t,
        };
    }

    _updateMorph() {
        const totalTicks = this.morphShapes.length * this.morphTicksPerShape;
        const tick = ((this.actualTick % totalTicks) + totalTicks) % totalTicks;
        const shapeIdx = Math.floor(tick / this.morphTicksPerShape);
        const localTick = tick % this.morphTicksPerShape;
        this.morphCurrentIdx = shapeIdx % this.morphShapes.length;
        this.morphNextIdx = (shapeIdx + 1) % this.morphShapes.length;
        this.morphT = localTick / this.morphTicksPerShape;
    }

    _fireImplodePulse(velocity) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const x = -hw + this._rand() * this.gridFieldW;
        const y = (this.gridCenterY - hh) + this._rand() * this.gridFieldH;
        const amp = 800 + (3000 - 800) * v;
        const radius = 1000 + 2000 * v;
        const maxLife = 1.5 + v * 2.0;
        this.implodePulses.push({ x, y, amp, radius, life: maxLife, maxLife });
        while (this.implodePulses.length > this.implodePulseMax) this.implodePulses.shift();
    }

    _updateImplodePulses(dt) {
        for (let i = this.implodePulses.length - 1; i >= 0; i--) {
            this.implodePulses[i].life -= dt;
            if (this.implodePulses[i].life <= 0) this.implodePulses.splice(i, 1);
        }
    }

    _implodeXYZ(bx, by, out) {
        for (let i = 0; i < this.implodePulses.length; i++) {
            const p = this.implodePulses[i];
            const dx = bx - p.x;
            const dy = by - p.y;
            const d2 = dx * dx + dy * dy;
            const falloff = Math.exp(-d2 / (p.radius * p.radius));
            if (falloff < 0.002) continue;
            const k = p.life / p.maxLife;
            const env = k * k;
            const str = p.amp * falloff * env;
            const dist = Math.sqrt(d2) || 1;
            out.x -= (dx / dist) * str * 0.5;
            out.y -= (dy / dist) * str * 0.5;
            out.z -= str;
        }
    }

    /**
     * うねりの変位を計算（垂直壁版）
     */
    _gridWarp(bx, by, amp, t, out) {
        const breath = this.idleBreathAmp;
        const m = this._getMorphOffset(bx, by);
        out.x = bx + m.dx + Math.sin(bx * 0.0009 + by * 0.0007 + t * 0.5) * breath;
        out.y = by + m.dy + Math.cos(by * 0.0009 - bx * 0.0007 + t * 0.6) * breath;
        const idleZ = Math.sin(bx * 0.0011 - by * 0.0009 + t * 0.7) * breath;
        out.z = this.gridCenterZ + idleZ + this._pulseZ(bx, by) + m.dz;
        this._implodeXYZ(bx, by, out);
        return out;
    }

    // Z変位量(0〜1)を固定ヒートマップ色に変換（力なし=青 → 力が加わると赤へ）
    _heatmapColor(t, out) {
        let v = Math.max(0, Math.min(1, t));
        // 低い力を強く効かせる（ゲイン＋ガンマ）。少しの変位でも一気に暖色へ跳ねる
        v = Math.min(1, v * 2.6);          // ゲイン: 弱い力を底上げ
        v = Math.pow(v, 0.55);             // ガンマ<1: 低域をさらに持ち上げてマッピングをキツく
        // 青(0.60) → シアン → 緑 → 黄 → 赤(0.0)。_heatHue は使わない（七色回転を止める）
        const hue = (1.0 - v) * 0.60;
        const l = 0.22 + v * 0.45;
        const s = 0.75 + v * 0.25;
        this._gridLineColorTmp.setHSL(hue, s, l);
        out.r = this._gridLineColorTmp.r;
        out.g = this._gridLineColorTmp.g;
        out.b = this._gridLineColorTmp.b;
    }

    /**
     * actual_tick と phase を使ったゆっくりしたノイズ係数を更新する。
     * 基準サイズを 0.6〜1.4 の範囲でゆらす。
     */
    _updateParticleNoiseScale() {
        // actual_tick を正規化（96小節ループ = 384*96 ticks）
        const loopTicks = 384 * 96;
        const tickNorm = ((this.actualTick || 0) % loopTicks) / loopTicks;
        // phase は 0〜1
        const ph = this.phase || 0;

        // 複数周期のsin/cosを合成してゆっくり変化するノイズ感を出す
        const a = Math.sin(tickNorm * Math.PI * 4 + ph * Math.PI * 2) * 0.28;
        const b = Math.sin(tickNorm * Math.PI * 11 + ph * Math.PI * 0.7) * 0.12;
        const c = Math.cos(tickNorm * Math.PI * 7 - ph * Math.PI * 1.3) * 0.08;
        // 基準を 0.72 に下げ、振れ幅を上方向に寄せる（0.24〜1.20 の範囲）
        this._particleNoiseScale = 0.72 + a + b + c;
    }

    _updateGridCubes(dt) {
        if (this.useGPUWarp) {
            this._updateGridCubesGPU(dt);
        } else {
            this._updateGridCubesCPU(dt);
        }
    }

    /**
     * GPU版（完全GPU）:
     *   - 位置warp / 回転 / スケール : すべて頂点シェーダ（uniform更新のみ）
     *   - CPU がやるのは uniform 同期と boost 属性の減衰反映だけ。
     * → パーティクル数に対して CPU コストがほぼ定数（boost属性の配列走査のみ）。
     */
    _updateGridCubesGPU(dt) {
        if (!this.instancedMeshManager) return;
        this._syncWarpUniforms();

        // track8 boost の減衰と aBoost 属性への反映のみ
        const bm = this._cubeBoostMap;
        const attr = this._boostAttr;
        if (bm && attr) {
            const arr = attr.array;
            const decay = this._cubeBoostDecay * dt;
            let dirty = false;
            const n = bm.length;
            for (let i = 0; i < n; i++) {
                let v = bm[i];
                if (v > 0) { v = Math.max(0, v - decay); bm[i] = v; }
                if (arr[i] !== v) { arr[i] = v; dirty = true; }
            }
            if (dirty) attr.needsUpdate = true;
        }
        // instanceMatrix は恒等のまま（位置/回転/スケール全部シェーダ）
    }

    /**
     * メイン/影マテリアルの uniform を JS の状態から同期する。
     * ここが「パーティクル数に依らない定数コスト」の心臓部。
     */
    _syncWarpUniforms() {
        const u = this._gpuWarpUniforms;
        if (!u) return;
        const ud = this._gpuWarpUniformsDepth;

        const amp = this._warpAmp();
        const morphA = MORPH_SHAPE_ID[this.morphShapes[this.morphCurrentIdx]] ?? 0;
        const morphB = MORPH_SHAPE_ID[this.morphShapes[this.morphNextIdx]] ?? 0;

        const set = (uni) => {
            uni.uWarpAmp.value = amp;
            uni.uTime.value = this.time;
            uni.uBreath.value = this.idleBreathAmp;
            uni.uGridCenterY.value = this.gridCenterY;
            uni.uGridCenterZ.value = this.gridCenterZ;
            uni.uGridFieldW.value = this.gridFieldW;
            uni.uGridFieldH.value = this.gridFieldH;
            uni.uMorphRadius.value = this.morphRadius;
            uni.uMorphShapeA.value = morphA;
            uni.uMorphShapeB.value = morphB;
            uni.uMorphT.value = this.morphT;
            uni.uNoiseScale.value = this._particleNoiseScale;

            // warpPulses → (x, y, dir*amp, radius) + env=(life/maxLife)^2
            const wp = this.warpPulses;
            const wc = Math.min(wp.length, GRID_WARP_MAX_WARP_PULSES);
            uni.uWarpCount.value = wc;
            for (let i = 0; i < wc; i++) {
                const p = wp[i];
                uni.uWarpPulses.value[i].set(p.x, p.y, p.dir * p.amp, p.radius);
                const k = p.life / p.maxLife;
                uni.uWarpEnv.value[i] = k * k;
            }

            // implodePulses → (x, y, amp, radius) + env
            const ip = this.implodePulses;
            const ic = Math.min(ip.length, GRID_WARP_MAX_IMP_PULSES);
            uni.uImpCount.value = ic;
            for (let i = 0; i < ic; i++) {
                const p = ip[i];
                uni.uImpPulses.value[i].set(p.x, p.y, p.amp, p.radius);
                const k = p.life / p.maxLife;
                uni.uImpEnv.value[i] = k * k;
            }
        };

        set(u);
        if (ud) set(ud);
    }

    _updateGridCubesCPU(dt) {
        if (!this.instancedMeshManager || !this.gridBaseX) return;
        const t = this.time;
        const amp = this._warpAmp();
        const n = this.particles.length;
        const w = this._warpScratch;
        const bm = this._cubeBoostMap;
        const pc = this._gridPulseCache;
        const decay = this._cubeBoostDecay * dt;
        const pulseMax = this.pulseAmpMax * 2.0;
        const rotImpactScale = 0.0008;
        const angFriction = Math.exp(-1.8 * dt);
        const noiseScale = this._particleNoiseScale;
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            const bx = this.gridBaseX[i], by = this.gridBaseY[i];
            this._gridWarp(bx, by, amp, t, w);
            p.position.set(w.x, w.y, w.z);

            let pulseDisp = 0;
            if (this.warpPulses.length > 0 || this.implodePulses.length > 0) {
                pulseDisp = Math.abs(w.z - this.gridCenterZ - this._getMorphOffset(bx, by).dz);
            }
            if (pc) pc[i] = pulseDisp;

            const impulse = pulseDisp / pulseMax;
            if (impulse > 0.001) {
                const angle = (i * 2.399) % (Math.PI * 2);
                p.angularVelocity.x += Math.cos(angle) * impulse * rotImpactScale;
                p.angularVelocity.y += Math.sin(angle) * impulse * rotImpactScale;
                p.angularVelocity.z += Math.cos(angle + 1.1) * impulse * rotImpactScale * 0.5;
            }
            if (bm && bm[i] > 0.05) {
                const ba = (i * 1.618) % (Math.PI * 2);
                p.angularVelocity.x += Math.cos(ba) * bm[i] * rotImpactScale * 2.0;
                p.angularVelocity.y += Math.sin(ba) * bm[i] * rotImpactScale * 2.0;
            }
            p.angularVelocity.multiplyScalar(angFriction);

            p.updateRotation(dt);

            // ノイズ係数（時間変化）を基準スケールに乗算、boostは更にその上に乗算
            if (bm && bm[i] > 0) {
                bm[i] = Math.max(0, bm[i] - decay);
                this._scaleScratch.copy(p.scale).multiplyScalar(noiseScale * (1.0 + bm[i]));
                this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, this._scaleScratch);
            } else {
                this._scaleScratch.copy(p.scale).multiplyScalar(noiseScale);
                this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, this._scaleScratch);
            }
        }
        this.instancedMeshManager.markNeedsUpdate();
    }

    /**
     * 赤い菱形マーカー◆をうねる壁に追従させる
     */
    _updateCrossesOnGround(dt = 0.016) {
        if (!this.crossPool.length) return;
        const t = this.time;
        const amp = this._warpAmp();
        const w = this._warpScratch;
        const crossHue = 0.0;
        this._gridLineColorTmp.setHSL(crossHue, 1.0, 0.5);
        const emissiveColor = this._gridLineColorTmp.clone().setHSL(0.0, 1.0, 0.4);

        // gridBoostをbaseX/baseYから最近傍グリッドインデックスで取得するヘルパー
        // _cubeBoostMap はキューブ解像度(GPU時=cubeCols/Rows)なのでそれに合わせる
        const cols = this.useGPUWarp ? this.cubeCols : this.gridCols;
        const rows = this.useGPUWarp ? this.cubeRows : this.gridRows;
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const bm = this._cubeBoostMap;

        for (const cross of this.crossPool) {
            if (!cross.visible || cross.userData.baseX === undefined) continue;
            this._gridWarp(cross.userData.baseX, cross.userData.baseY, amp, t, w);
            cross.position.set(w.x, w.y, w.z + 120);
            const spin = cross.userData.spin || 0.4;
            cross.rotation.y += spin * dt;
            cross.rotation.x += spin * 0.4 * dt;
            if (cross.userData.shellMat) {
                cross.userData.shellMat.color.copy(this._gridLineColorTmp);
                cross.userData.shellMat.emissive.copy(emissiveColor);
            }
            if (cross.userData.coreMat) {
                cross.userData.coreMat.color.copy(this._gridLineColorTmp);
            }

            // track8 boostをcrossのscaleに乗算
            if (bm && this.gridBaseX) {
                const ci = Math.round((cross.userData.baseX + hw) / this.gridFieldW * (cols - 1));
                const ri = Math.round((cross.userData.baseY - (this.gridCenterY - hh)) / this.gridFieldH * (rows - 1));
                const idx = Math.max(0, Math.min(rows - 1, ri)) * cols + Math.max(0, Math.min(cols - 1, ci));
                const boost = bm[idx] || 0;
                const s = this._particleNoiseScale * (1.0 + boost);
                cross.scale.setScalar(s);
            }
        }
    }

    triggerExpandEffect(velocity = 127) {
        const vFactor = velocity / 127.0;

        this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + vFactor * 1.5);

        const pulseCount = 3;
        const hw = this.gridFieldW * 0.3;
        const hh = this.gridFieldH * 0.3;
        let lastX = 0, lastY = this.gridCenterY;
        for (let i = 0; i < pulseCount; i++) {
            const x = (Math.random() - 0.5) * hw * 2;
            const y = this.gridCenterY + (Math.random() - 0.5) * hh * 2;
            lastX = x; lastY = y;
            const v = vFactor;
            const amp = (this.pulseAmpMin + (this.pulseAmpMax - this.pulseAmpMin) * v) * 2.0;
            const durSec = 0.05;
            const radius = this.pulseRadiusMin + this.pulseRadiusPerSec * durSec;
            const maxLife = 2.0 + v * 1.5;
            this.warpPulses.push({ x, y, dir: 1, amp, radius, life: maxLife, maxLife });
            while (this.warpPulses.length > this.warpPulseMax) this.warpPulses.shift();
        }
        this._lastExpandPos = { x: lastX, y: lastY };
    }

    updateExpandSpheres() {
        const now = Date.now();
        for (let i = this.expandSpheres.length - 1; i >= 0; i--) {
            const effect = this.expandSpheres[i];
            const progress = (now - effect.startTime) / effect.duration;
            if (progress >= 1.0) {
                if (effect.light) this.scene.remove(effect.light);
                if (effect.mesh) {
                    this.scene.remove(effect.mesh);
                    effect.mesh.geometry.dispose();
                    effect.mesh.material.dispose();
                }
                this.expandSpheres.splice(i, 1);
            } else {
                if (effect.light) effect.light.intensity = effect.maxIntensity * (1.0 - Math.pow(progress, 0.5));
                if (effect.mesh) effect.mesh.scale.setScalar(1.0 - progress);
            }
        }
    }

    switchCameraRandom() {
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex && this.cameraParticles.length > 1) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
        const cp = this.cameraParticles[this.currentCameraIndex];
        if (!cp) return;
        this.cameraParticles.forEach((p) => {
            p.minDistance = 3000;   // 2000 → 3000（グリッド拡大に合わせてカメラを引く）
            p.maxDistance = 6800;   // 4500 → 6800
            p.boxMin = null;
            p.boxMax = null;
            p.maxSpeed = 8.0;
        });
        const dist = 4500 + Math.random() * 4500;   // 3000+3000 → 4500+4500
        const yaw = (Math.random() - 0.5) * Math.PI * 0.55;
        const pitch = (Math.random() - 0.1) * 0.5;
        cp.position.set(
            Math.sin(yaw) * Math.cos(pitch) * dist,
            this.gridCenterY + Math.sin(pitch) * dist,
            Math.cos(yaw) * Math.cos(pitch) * dist
        );
        cp.applyRandomForce?.();
    }

    // ===== Scene09由来: カメラ =====

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 3000;   // 2000 → 3000
        cameraParticle.maxDistance = 6800;   // 4500 → 6800
        cameraParticle.maxDistanceReset = 6000;   // 4000 → 6000
        cameraParticle.minY = STUDIO_FLOOR_TOP_Y + 200;
        cameraParticle.maxY = this.ceilingY - 200;
        cameraParticle.initializePosition?.();
    }

    updateCamera() {
        if (this.trackEffects[1] && this.cameraParticles[this.currentCameraIndex]) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            const basePos = cp.getPosition().clone();
            const t = this.time;
            const distNoise = Math.sin(t * 0.08) * 400
                            + Math.sin(t * 0.031) * 600
                            + Math.sin(t * 0.017) * 300;
            const toCenter = this._centerSmoothed.clone().sub(basePos).normalize();
            basePos.addScaledVector(toCenter, distNoise);
            // 部屋境界でクランプ
            basePos.x = THREE.MathUtils.clamp(basePos.x, -(this.roomHalfW - 200), this.roomHalfW - 200);
            basePos.y = THREE.MathUtils.clamp(basePos.y, this.floorTopY + 200, this.ceilingY - 200);
            basePos.z = THREE.MathUtils.clamp(basePos.z, -(this.roomHalfD - 200), this.roomHalfD - 200);
            this.camera.position.copy(basePos);
            this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
            this.camera.matrixWorldNeedsUpdate = false;
            return;
        }
        this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
        this.camera.matrixWorldNeedsUpdate = false;
    }

    // ===== Scene09由来: 波形 =====

    /** ヒートマップ色（t: 0=青 → シアン → 緑 → 黄 → 赤=1） */
    _heatColor(t) {
        t = Math.max(0, Math.min(1, t));
        const stops = [
            [0.0, 0.0, 1.0],
            [0.0, 1.0, 1.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
        ];
        const seg = t * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(seg));
        const f = seg - i;
        const a = stops[i], b = stops[i + 1];
        return new THREE.Color(
            a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            a[2] + (b[2] - a[2]) * f
        );
    }

    _buildWaves() {
        const hw = this.waveFieldW * 0.5;
        const n = this.waveSegments;

        this._waveCurvePts = [];
        for (let i = 0; i < n; i++) this._waveCurvePts.push(new THREE.Vector3());

        this._waveBaseX = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            this._waveBaseX[i] = -hw + (this.waveFieldW * i) / (n - 1);
        }

        for (let w = 0; w < this.trackCount; w++) {
            const pos = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                pos[i * 3 + 0] = this._waveBaseX[i];
                pos[i * 3 + 1] = this.waveCenterY;
                pos[i * 3 + 2] = (w - this.trackCount / 2) * 40;
            }
            const color = this._heatColor(w / (this.trackCount - 1));
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const geo = this._buildTubeGeometry(pos);
            const mesh = new THREE.Mesh(geo, mat);
            this.scene.add(mesh);

            this.waveLines.push(mesh);
            this.wavePositions.push(pos);

            this.trackVoice.push({
                env: 0.0,
                freq: 1.5 + w * 0.5,
                amp: 0.5,
                decay: 1.8,
                phase: this._rand(),
            });
        }
    }

    _fireTrack8Cylinder(velocity, durationMs) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const radius = this.track8RadiusMin + (this.track8RadiusMax - this.track8RadiusMin) * v;
        const durSec = durationMs > 0 ? durationMs / 1000 : 0.6;
        const length = this.track8LenMin + this.track8LenPerSec * durSec;
        const color = this._heatColor(v);

        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        this.scene.add(mesh);

        const maxLife = Math.max(0.5, durSec);
        const c = {
            mesh,
            life: maxLife,
            maxLife,
            radius,
            length,
            phase: this._rand() * 100,
        };
        this.track8Cylinders.push(c);
        this._rebuildTrack8Geometry(c);

        while (this.track8Cylinders.length > this.track8MaxCount) {
            const old = this.track8Cylinders.shift();
            this._disposeTrack8Cylinder(old);
        }
    }

    _rebuildTrack8Geometry(c) {
        const SEG = 40;
        const half = c.length * 0.5;
        const fieldHalf = this.waveFieldW * 0.5;
        const progress = 1 - c.life / c.maxLife;
        const centerX = -fieldHalf + this.waveFieldW * progress;
        const amp = this._warpAmp();
        const t = this.time;
        const w = this._warpScratch;

        const pts = [];
        for (let i = 0; i < SEG; i++) {
            const s = i / (SEG - 1);
            const x = centerX - half + c.length * s;
            this._gridWarp(x, this.gridCenterY, amp, t, w);
            const ownZ =
                Math.sin(s * 5.0 * Math.PI + t * 4.0 + c.phase) * (60 + amp * 0.5) +
                Math.sin(s * 2.0 * Math.PI - t * 2.5 + c.phase * 0.7) * 40;
            pts.push(new THREE.Vector3(w.x, w.y, w.z + ownZ));
        }
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
        const geo = new THREE.TubeGeometry(curve, SEG - 1, c.radius, 16, false);
        c.mesh.geometry.dispose();
        c.mesh.geometry = geo;
    }

    _updateTrack8Cylinders(dt) {
        if (!this.track8Cylinders.length) return;
        for (let i = this.track8Cylinders.length - 1; i >= 0; i--) {
            const c = this.track8Cylinders[i];
            c.life -= dt;
            if (c.life <= 0) {
                this._disposeTrack8Cylinder(c);
                this.track8Cylinders.splice(i, 1);
                continue;
            }
            this._rebuildTrack8Geometry(c);
            const tt = c.life / c.maxLife;
            c.mesh.material.opacity = 0.95 * Math.min(1, tt * 1.6);
        }
    }

    _disposeTrack8Cylinder(c) {
        if (!c?.mesh) return;
        this.scene.remove(c.mesh);
        c.mesh.geometry?.dispose();
        c.mesh.material?.dispose();
    }

    _buildTubeGeometry(pos) {
        const n = this.waveSegments;
        for (let i = 0; i < n; i++) {
            this._waveCurvePts[i].set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        }
        const curve = new THREE.CatmullRomCurve3(this._waveCurvePts, false, 'catmullrom', 0.5);
        return new THREE.TubeGeometry(curve, n - 1, this.waveTubeRadius, 5, false);   // 放射分割 8→5
    }

    _addVoice(note, velocity, track) {
        const idx = track - 1;
        if (idx < 0 || idx >= this.trackVoice.length) return;
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const vo = this.trackVoice[idx];
        vo.freq = 1.0 + (note % 24) * 0.18 + idx * 0.12;
        vo.env = 0.5 + v * 0.7;
        vo.decay = 2.4 - v * 1.4;
        vo.phase = this._rand();
    }

    _updateWaves(dt) {
        if (!this.waveLines.length) return;
        this.wavePhase += dt;
        const maxSpan = 700;
        let bus = 0.0;

        for (let w = 0; w < this.trackCount; w++) {
            const pos = this.wavePositions[w];
            const line = this.waveLines[w];
            const vo = this.trackVoice[w];
            const n = this.waveSegments;

            vo.env *= Math.exp(-vo.decay * dt);
            vo.phase += vo.freq * dt;
            bus += vo.env;

            const idle = 18;
            const amp = idle + vo.env * maxSpan;
            line.material.opacity = 0.18 + Math.min(0.8, vo.env) * 0.8;

            const baseZ = (w - this.trackCount / 2) * 40;
            const sFreq = 0.6 + (vo.freq - 1.0) * 0.45;
            const warpAmp = this._warpAmp();
            const jitterAmp = 90 + this.busLevel * 120;
            const jPhase = this.time * 0.6 + w * 0.7;
            const ww = this._warpScratch;
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const organic =
                    Math.sin(t * 1.6 + this.time * 0.5 + w) * 0.30 +
                    Math.sin(t * 0.9 - this.time * 0.35 + w * 0.7) * 0.18;
                const wv =
                    Math.sin((t * sFreq + vo.phase + organic) * Math.PI * 2) * 0.92 +
                    Math.sin((t * sFreq * 2.0 + vo.phase * 1.3) * Math.PI * 2) * 0.06;
                const x = this._waveBaseX[i];
                const baseY = this.waveCenterY + wv * amp;
                this._gridWarp(x, baseY, warpAmp, this.time, ww);
                const jitter =
                    Math.sin(t * 1.4 * Math.PI * 2 + jPhase) * 0.7 +
                    Math.sin(t * 0.6 * Math.PI * 2 - jPhase * 0.8) * 0.3;
                pos[i * 3 + 0] = ww.x;
                pos[i * 3 + 1] = ww.y;
                pos[i * 3 + 2] = ww.z + baseZ + jitter * jitterAmp;
            }
            const newGeo = this._buildTubeGeometry(pos);
            line.geometry.dispose();
            line.geometry = newGeo;
        }
        this.busLevel += (Math.min(2.0, bus) - this.busLevel) * Math.min(1, 8 * dt);
        this.gridWarpLevel = Math.max(this.gridWarpLevel, this.busLevel * 0.6);
    }

    // ===== Scene09由来: 赤い菱形マーカー =====

    _buildCrossPool() {
        this.crossGroup = new THREE.Group();
        this.scene.add(this.crossGroup);

        const s = this.crossSize;
        const env = this.scene?.environment || null;
        const octGeo = new THREE.OctahedronGeometry(s, 0);
        const coreGeo = new THREE.IcosahedronGeometry(s * 0.32, 0);
        this._crossGeos = [octGeo, coreGeo];

        for (let i = 0; i < this.crossMax; i++) {
            const group = new THREE.Group();
            const shellMat = new THREE.MeshPhysicalMaterial({
                color: 0xff1418,
                metalness: 0.6,
                roughness: 0.18,
                clearcoat: 0.9,
                clearcoatRoughness: 0.12,
                envMap: env,
                envMapIntensity: 1.6,
                emissive: 0xff0008,
                emissiveIntensity: 0.9,
                transparent: true,
                opacity: 0.0,
                depthWrite: false,
                fog: true
            });
            const shell = new THREE.Mesh(octGeo, shellMat);
            const coreMat = new THREE.MeshBasicMaterial({
                color: 0xff5050,
                transparent: true,
                opacity: 0.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const core = new THREE.Mesh(coreGeo, coreMat);
            group.add(shell);
            group.add(core);
            group.visible = false;
            group.userData.shellMat = shellMat;
            group.userData.coreMat = coreMat;
            this.crossGroup.add(group);
            this.crossPool.push(group);
        }
    }

    // ===== track9: ブルーム・ブロッサム =====

    /** 拡大リング用のメッシュプールと中心グローライトを構築 */
    _buildBlossomRings() {
        this._blossomGroup = new THREE.Group();
        this.scene.add(this._blossomGroup);

        // 平たいリング（地面と平行に寝かせる）。useBlossomFloorRing=false ならメッシュを作らない
        if (this.useBlossomFloorRing) {
            const ringGeo = new THREE.RingGeometry(0.86, 1.0, 96, 1);
            for (let i = 0; i < this._blossomRingMax; i++) {
                const mat = new THREE.MeshBasicMaterial({
                    color: 0xffb3e6,
                    transparent: true,
                    opacity: 0.0,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    fog: false
                });
                const mesh = new THREE.Mesh(ringGeo, mat);
                mesh.rotation.x = -Math.PI / 2;   // 地面に寝かせる
                mesh.visible = false;
                this._blossomGroup.add(mesh);
                this._blossomRingPool.push({ mesh, mat, life: 0, maxLife: 1, maxScale: 1 });
            }
        }

        // 中心の一時発光ライト（ドリームカラー）
        this._blossomGlowLight = new THREE.PointLight(0xffc0f0, 0.0, 9000, 1.6);
        this._blossomGlowLight.position.set(0, this.gridCenterY + 300, this.gridCenterZ);
        this.scene.add(this._blossomGlowLight);
    }

    /**
     * track9: 中心から発光リングが花開くように広がり、放射状にクロスが散る派手な演出。
     * グリッド全体も波打たせ、色相を大きく蹴って画面が一瞬パッと明るくなる。
     */
    _fireBloomBurst(velocity, durationMs) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;

        const cx = 0;
        const cy = this.gridCenterY;
        // 1) 拡大リングを2〜3枚、少し時間差で開かせる（useBlossomFloorRing=false なら出さない）
        if (this.useBlossomFloorRing) {
            const ringCount = 2 + (v > 0.6 ? 1 : 0);
            for (let r = 0; r < ringCount; r++) {
                const slot = this._blossomRingPool.find(s => !s.mesh.visible)
                    || this._blossomRingPool[r % this._blossomRingPool.length];
                slot.mesh.visible = true;
                slot.mesh.position.set(cx, this.floorTopY + 40, this.gridCenterZ);
                slot.mesh.scale.setScalar(120);
                slot.life = slot.maxLife = 0.9 + v * 0.7 + r * 0.12;
                slot.maxScale = (1600 + v * 2600) * (1 + r * 0.35);
                // リングごとにドリームカラーを少しずらす（ピンク〜水色）
                slot.mat.color.setHSL((0.9 - r * 0.18 + this._heatHue) % 1.0, 0.55, 0.72);
                slot.mat.opacity = 0.9;
            }
        }

        // 2) 中心グローをドリームカラーで焚く
        this._blossomGlowLevel = Math.min(1.0, this._blossomGlowLevel + 0.7 + v * 0.5);
        if (this._blossomGlowLight) {
            this._blossomGlowLight.color.setHSL((0.9 + this._heatHue) % 1.0, 0.5, 0.7);
        }

        // 3) 放射状にクロス◆を撒く（花火）
        const spokes = 6 + Math.floor(v * 6);
        const spread = Math.min(this.gridFieldW, this.gridFieldH) * 0.32;
        for (let s = 0; s < spokes; s++) {
            const ang = (s / spokes) * Math.PI * 2 + this._rand() * 0.4;
            const rad = spread * (0.4 + this._rand() * 0.6);
            const bx = cx + Math.cos(ang) * rad;
            const by = cy + Math.sin(ang) * rad;
            this._spawnCrossAt(bx, by);
        }

        // 4) グリッド全体を波打たせ＋色相を大きく蹴る
        this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + 0.6 + v * 0.8);
        this.busLevel = Math.min(2.0, this.busLevel + 0.5 + v * 0.6);
        this._fireWarpPulse(velocity, durationMs);
        this._heatHue = (this._heatHue + 0.22 + this._rand() * 0.3) % 1.0;
    }

    /** 任意座標を最寄りの格子点座標へスナップする（マーカーを交差点に正確に乗せる） */
    _snapToGridPoint(bx, by, out) {
        const cols = this.useGPUWarp ? this.cubeCols : this.gridCols;
        const rows = this.useGPUWarp ? this.cubeRows : this.gridRows;
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        // 連続座標 → 最寄り格子インデックス（キューブ生成時と同じ式の逆算）
        let c = Math.round((bx + hw) / this.gridFieldW * (cols - 1));
        let r = Math.round((by - (this.gridCenterY - hh)) / this.gridFieldH * (rows - 1));
        c = Math.max(0, Math.min(cols - 1, c));
        r = Math.max(0, Math.min(rows - 1, r));
        // 格子インデックス → 格子点座標（キューブ生成時と完全に同じ式）
        out.x = -hw + (this.gridFieldW * c) / (cols - 1);
        out.y = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
        return out;
    }

    /** 座標指定でクロス◆を出す（_spawnCrossの座標指定版） */
    _spawnCrossAt(bx, by) {
        let cross = this.crossPool.find(c => !c.visible);
        if (!cross) {
            cross = this.crossPool[this._crossNext % this.crossPool.length];
            this._crossNext++;
        }
        // 交差点にピッタリ乗せるため、最寄り格子点へスナップ
        const snapped = this._snapToGridPoint(bx, by, this._warpScratch);
        bx = snapped.x;
        by = snapped.y;
        cross.userData.baseX = bx;
        cross.userData.baseY = by;
        cross.position.set(bx, by, this.gridCenterZ + 120);
        cross.rotation.set(this._rand() * Math.PI, this._rand() * Math.PI, this._rand() * Math.PI);
        cross.userData.spin = 0.3 + this._rand() * 0.6;
        cross.visible = true;
        if (cross.userData.shellMat) cross.userData.shellMat.opacity = 0.85;
        if (cross.userData.coreMat) cross.userData.coreMat.opacity = 0.95;
    }

    /** track9演出の毎フレーム更新（リング拡大フェード + グローライト減衰） */
    _updateBloomBurst(dt) {
        for (const slot of this._blossomRingPool) {
            if (!slot.mesh.visible) continue;
            slot.life -= dt;
            if (slot.life <= 0) {
                slot.mesh.visible = false;
                slot.mat.opacity = 0;
                continue;
            }
            const k = slot.life / slot.maxLife;       // 1→0
            const grow = 1.0 - k;                     // 0→1
            const scale = 120 + (slot.maxScale - 120) * (1 - k * k);  // イーズアウト拡大
            slot.mesh.scale.setScalar(scale);
            slot.mat.opacity = 0.9 * k * k;           // 広がりながらフェード
        }

        // 中心グローライト
        if (this._blossomGlowLight) {
            this._blossomGlowLevel *= Math.exp(-3.2 * dt);
            this._blossomGlowLight.intensity = this._blossomGlowLevel * (600 + this.busLevel * 300);
        }
    }

    _buildNodeEdges() {
        const maxEdges = 512;
        this._nodeEdgeMax = maxEdges;
        this._nodeEdgeThresh = 1200;
        this._nodeEdgeMat = new THREE.MeshPhysicalMaterial({
            color: 0xff2020,
            metalness: 0.9,
            roughness: 0.15,
            emissive: 0xff0000,
            emissiveIntensity: 0.4,
            envMap: this.scene?.environment || null,
            envMapIntensity: 1.2,
        });
        const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
        this._nodeEdgeMesh = new THREE.InstancedMesh(geo, this._nodeEdgeMat, maxEdges);
        this._nodeEdgeMesh.count = 0;
        this._nodeEdgeMesh.frustumCulled = false;
        this.scene.add(this._nodeEdgeMesh);
        this._nodeEdgeDummy = new THREE.Object3D();
    }

    _updateNodeEdges() {
        if (!this._nodeEdgeMesh) return;
        const crosses = this.crossPool.filter(c => c.visible);
        if (crosses.length < 2) {
            this._nodeEdgeMesh.count = 0;
            return;
        }
        const thresh = this._nodeEdgeThresh;
        const maxEdges = this._nodeEdgeMax;
        const dummy = this._nodeEdgeDummy;
        const radius = 4.0;
        let edgeCount = 0;

        for (let i = 0; i < crosses.length && edgeCount < maxEdges; i++) {
            const a = crosses[i].position;
            for (let j = i + 1; j < crosses.length && edgeCount < maxEdges; j++) {
                const b = crosses[j].position;
                const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > thresh) continue;

                dummy.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
                dummy.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    new THREE.Vector3(dx / dist, dy / dist, dz / dist)
                );
                dummy.scale.set(radius, dist, radius);
                dummy.updateMatrix();
                this._nodeEdgeMesh.setMatrixAt(edgeCount, dummy.matrix);
                edgeCount++;
            }
        }
        this._nodeEdgeMesh.count = edgeCount;
        this._nodeEdgeMesh.instanceMatrix.needsUpdate = true;
    }

    /** ランダムな格子点のXYワールド座標を返す */
    _randomGridPoint() {
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        // マーカーはキューブ格子(cubeCols/Rows)の交点に乗せる（線のfine格子ではなくキューブ交差点に一致させる）
        const cols = this.useGPUWarp ? this.cubeCols : this.gridCols;
        const rows = this.useGPUWarp ? this.cubeRows : this.gridRows;
        const ci = Math.floor(this._rand() * cols);
        const ri = Math.floor(this._rand() * rows);
        const x = -hw + (this.gridFieldW * ci) / (cols - 1);
        const y = this.gridCenterY - hh + (this.gridFieldH * ri) / (rows - 1);
        return new THREE.Vector3(x, y, 0);
    }

    /** キューブ格子の交点にスナップ（マーカーを交差点に正確に乗せる） */
    _snapToGrid(x, y) {
        const p = this._snapToGridPoint(x, y, this._warpScratch);
        return new THREE.Vector3(p.x, p.y, 0);
    }

    /**
     * イベント間隔に応じた格子点を返す
     */
    _clusteredGridPoint(track) {
        const now = this.time;
        const last = this.lastEvtTime[track];
        const lastPos = this.lastEvtPos[track];

        let p;
        if (last === undefined || lastPos === undefined || (now - last) >= this.clusterFarTime) {
            p = this._randomGridPoint();
        } else {
            const gap = Math.max(0, now - last);
            const ratio = gap / this.clusterFarTime;
            const minR = this.gridFieldW / this.gridCoarseCols;
            const maxR = this.gridFieldW * 0.5;
            const radius = minR + (maxR - minR) * ratio;
            const ang = this._rand() * Math.PI * 2;
            const dist = this._rand() * radius;
            const x = lastPos.x + Math.cos(ang) * dist;
            const y = lastPos.y + Math.sin(ang) * dist;
            p = this._snapToGrid(x, y);
        }

        this.lastEvtTime[track] = now;
        this.lastEvtPos[track] = p.clone();
        return p;
    }

    /**
     * 赤い立体菱形マーカー◆を壁グリッド上に1つ点灯
     */
    _spawnCross() {
        let cross = this.crossPool.find(c => !c.visible);
        if (!cross) {
            cross = this.crossPool[this._crossNext % this.crossPool.length];
            this._crossNext++;
        }
        const p = this._clusteredGridPoint(1);
        cross.userData.baseX = p.x;
        cross.userData.baseY = p.y;
        cross.position.set(p.x, p.y, this.gridCenterZ + 120);
        cross.rotation.set(this._rand() * Math.PI, this._rand() * Math.PI, this._rand() * Math.PI);
        cross.userData.spin = 0.3 + this._rand() * 0.6;
        cross.visible = true;
        if (cross.userData.shellMat) cross.userData.shellMat.opacity = 0.85;
        if (cross.userData.coreMat) cross.userData.coreMat.opacity = 0.95;
    }

    /** ランダムなデータ文字列を1つ生成（高速切替テキスト用） */
    _randomDataString() {
        const keys = ['FREQ', 'AMP', 'CH', 'BUF', 'PTR', 'SEQ', 'CRC', 'HZ',
            'DBM', 'PKT', 'IDX', 'RMS', 'CLK', 'SR', 'GAIN', 'TMP', 'VREF', 'ERR'];
        const k = keys[Math.floor(this._rand() * keys.length)];
        const r = this._rand();
        let val;
        if (r < 0.4) {
            val = '0x' + Math.floor(this._rand() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
        } else if (r < 0.7) {
            val = (this._rand() * 1000).toFixed(this._rand() < 0.5 ? 1 : 3);
        } else {
            val = '0b' + Math.floor(this._rand() * 256).toString(2).padStart(8, '0');
        }
        return `${k}:${val}`;
    }

    /** 決定論的PRNG（xorshift） */
    _rand() {
        let x = this.seed | 0;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        this.seed = x;
        return ((x >>> 0) % 1000000) / 1000000;
    }

    // ===== setup =====

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.useSSAO = false;   // 重いのでOFF

        // シャドウは enableShadows で独立制御（部屋を出しつつ影だけ切れる）
        this.renderer.shadowMap.enabled = this.enableShadows;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });
        if (this.blackVoidMode) {
            // 背景を真っ黒に。環境マップ由来の背景も消す
            this.scene.background = new THREE.Color(0x000000);
            this.scene.fog = null;
        }

        this.camera.fov = 42;
        this.camera.near = 12;
        this.camera.far = 15000;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, this.gridCenterY, 6000);   // 4000 → 6000（引き）
        this.camera.lookAt(0, this.gridCenterY, 0);
        this._centerSmoothed.set(0, this.gridCenterY, this.gridCenterZ);

        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;
        if (this.blackVoidMode) {
            // env設定が背景を書き換えることがあるので、背景だけ黒に確定（映り込み用のenvironmentは残す）
            this.scene.background = new THREE.Color(0x000000);
        }

        // Scene08と同じ設定
        const L = this.sceneLightingScale;
        this.studio = new StudioBox(this.scene, {
            ...studioBoxOptionsForStudioRoom(L, this._roomEnvTexture),
            useLights: false
        });
        if (this.studio.studioBox) this.studio.studioBox.visible = false;

        if (!this.blackVoidMode) {
            this.buildRoom();

            this.studio.attachCeilingSpotRig(this.roomGroup, {
                ...ceilingSpotRigOptionsForStudioRoom(L)
            });

            if (this.roomGroup?.children.length >= 2) {
                const floorMat = this.roomGroup.children[0].material;
                const wallMat = this.roomGroup.children[1].material;
                applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);
            }

            this.setupLights();

            // 蛍光灯をScene12の部屋四隅・天井近くに配置し直す
            this._repositionFluorescentLamps();
        } else {
            // 真っ暗モード: 部屋/天井ライト/蛍光灯なし。
            // キューブが見えるよう最小限のライト（Ambient+Hemi+Point）だけ足す（disposeは_minimalLights経路で片付く）
            this.setupMinimalParticleLights();
        }

        // airNoiseVolume（空気ノイズ質感）だけ有効、チリは0で無効
        this.createAmbientFloatingParticles();

        this.createSpheres();
        this._applyEnvMapToSphereMaterial();
        this.createGridLines();

        // ---- コールアウト ---- (use3DCallouts=false なら丸ごとスキップ＝描画も更新も走らない)
        if (this.use3DCallouts && this.calloutSystem) {
            this.calloutSystem.setScene(this.scene);
            this.calloutSystem.setUse3DCallouts(true);
            this.calloutSystem.scale3D = 2;
            this.calloutSystem.setLabels([
                'SCAN_ID: 0x0C', 'FREQ: 440.0Hz', 'AMP: -6.0dB', 'SYNC: LOCKED',
                'CH_01: ACTIVE', 'BIT_RATE: 24/96', 'PHASE: 0.000', 'DATA: STREAM',
                'NODE: 0x18F', 'SIG: STABLE', 'LAT: 0.4ms', 'CRC: OK',
                'BUF: 0xFF3A', 'GAIN: +3.2dB', 'SR: 96000', 'CLK: 24.576M',
                'PTR: 0x00A4', 'SEQ: 1024', 'MOD: PCM', 'DIV: 0x08',
                'TEMP: 31.4C', 'VREF: 1.024V', 'ERR: 0', 'FLAG: 0b1011',
                'ADDR: 0x7FE0', 'CNT: 65535', 'HZ: 13.75', 'DBM: -42',
                'PKT: 0xC1', 'CHKSUM: 0x5E', 'IDX: 0x3F', 'RMS: 0.707',
            ]);
            this.calloutReady = true;
        }

        this._buildCrossPool();
        this._buildNodeEdges();
        this._buildWaves();
        this._buildBlossomRings();   // track9: ブルーム・ブロッサム

        this.setupCameraParticleDistances();
        this.initPostProcessing();

        // 1フレーム目からGPUキューブ(uNoiseScale/uMorph等)とCPUクロス◆の warp を一致させるため、
        // actual_tick=0 状態の値を先に計算してGPU uniformへ同期しておく（開始直後のズレ防止）。
        this._updateParticleNoiseScale();
        this._updateMorph();
        this._syncWarpUniforms();

        this.initialized = true;
    }

    // ===== onUpdate =====

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;

        // （actual_tick連動のグリッド増加は開始直後のズレ原因だったため一旦撤去。全行表示に戻す）
        const rows = this.useGPUWarp ? this.cubeRows : this.gridRows;
        this._visibleRows = rows;   // 常に全行表示

        this.currentVisibleCount = this.sphereCount;
        this.setParticleCount(this.sphereCount);
        if (this.instancedMeshManager) {
            const mainMesh = this.instancedMeshManager.getMainMesh();
            if (mainMesh) {
                mainMesh.count = this.sphereCount;
                mainMesh.instanceMatrix.needsUpdate = true;
            }
        }

        this.gridWarpLevel *= Math.exp(-0.8 * deltaTime);

        // 色相ランダムウォークは無効。ただし track4 のキック分は毎フレーム 0 へ緩やかに減衰復帰させる
        // （キック直後は色相がジャンプし、数フレームかけてベース色相へ戻る）
        this._heatHue *= Math.exp(-0.6 * deltaTime);

        this._updateParticleNoiseScale();
        this._updateMorph();
        this._updateWarpPulses(deltaTime);
        this._updateImplodePulses(deltaTime);

        this.atmosphere?.update(deltaTime, this.time, this._centerSmoothed);

        this._updateGridCubes(deltaTime);
        this._updateGridLines();
        this._updateCrossesOnGround(deltaTime);
        this._updateBloomBurst(deltaTime);   // track9: ブルーム・ブロッサム

        // NodeEdge: count=0で常時オフ
        if (this._nodeEdgeMesh) this._nodeEdgeMesh.count = 0;

        this._updateWaves(deltaTime);
        this._updateTrack8Cylinders(deltaTime);

        this.updateExpandSpheres();
        this.updateCamera();

        // DOFフォーカス（視線射影距離方式）
        if (this.useAutoFocusDOF && this.useDOF && this.bokehPass?.uniforms?.focus) {
            this._dofCamDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            this._dofToTarget.copy(this._centerSmoothed).sub(this.camera.position);
            const targetFocus = Math.max(100, this._dofToTarget.dot(this._dofCamDir));
            const u = this.bokehPass.uniforms.focus;
            u.value += (targetFocus - u.value) * 0.5;
        } else if (this.bokehPass?.uniforms?.focus) {
            this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        }
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);

        // コールアウト：表示中のテキストを高速で矢継ぎ早に差し替える
        if (this.calloutReady && this.calloutSystem) {
            this.calloutTextTick += deltaTime;
            if (this.calloutTextTick >= this.calloutTextInterval) {
                this.calloutTextTick = 0;
                for (const co of this.calloutSystem.callouts) {
                    if (co.textCharCount > 0) {
                        co.labelText = this._randomDataString();
                        co.textCharCount = co.labelText.length;
                    }
                }
            }
            this.calloutSystem.update(deltaTime, this.time, this.camera, {
                autoGenerate: false,
                maxCount: 8,
                margin: 200
            });
        }
    }

    // ===== OSC =====

    static parseTrackNumber(trackNumber, message) {
        if (trackNumber !== undefined && trackNumber !== null && trackNumber !== '') {
            const num = typeof trackNumber === 'string' ? parseInt(trackNumber, 10) : Number(trackNumber);
            if (!Number.isNaN(num)) return num;
        }
        const addr = message && message.address;
        if (typeof addr === 'string') {
            let m = addr.match(/\/track\/(\d+)/i);
            if (!m) m = addr.match(/\/track(\d+)(?:\/|$)/i);
            if (m) return parseInt(m[1], 10);
        }
        return null;
    }

    handleTrackNumber(trackNumber, message) {
        const tn = Scene12.parseTrackNumber(trackNumber, message);
        if (tn !== 12) return;
        const args = message.args || [];
        const v1 = args[1] != null ? Number(args[1]) : NaN;
        const v0 = args[0] != null ? Number(args[0]) : NaN;
        let velocity = Number.isFinite(v1) ? v1 : Number.isFinite(v0) ? v0 : 127;
        if (!Number.isFinite(velocity) || velocity <= 0) return;
        if (this.trackEffects[12]) this.triggerExpandEffect(velocity);
    }

    handleOSC(message) {
        const trackNumber = message?.trackNumber;
        const args = message?.args || [];
        const note = args.length > 0 ? Number(args[0]) : 60;
        const velocity = args.length > 1 ? Number(args[1]) : 100;
        const durationMs = args.length > 2 ? Number(args[2]) : 0;

        // 全トラックのノートを波形ボイスとして登録
        if (trackNumber >= 1 && trackNumber <= this.trackCount) {
            this._addVoice(note, velocity, trackNumber);
        }

        // track1: 赤い菱形マーカー◇ + カメラランダマイズ
        if (trackNumber === 1) {
            this._spawnCross();
            this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + 0.25);
            if (this.trackEffects[1]) this.switchCameraRandom();
            return;
        }

        // track5: コールアウト
        if (trackNumber === 5) {
            if (this.calloutReady && this.calloutSystem) {
                let bx, by;
                if (this._lastExpandPos) {
                    const spread = this.gridFieldW * 0.12;
                    bx = this._lastExpandPos.x + (this._rand() - 0.5) * spread * 2;
                    by = this._lastExpandPos.y + (this._rand() - 0.5) * spread * 2;
                } else {
                    const p = this._clusteredGridPoint(5);
                    bx = p.x; by = p.y;
                }
                const yOffset = 80 + this._rand() * 120;
                const scratch = { x: 0, y: 0, z: 0 };
                this._gridWarp(bx, by, this._warpAmp(), this.time, scratch);
                const worldPos = new THREE.Vector3(scratch.x, scratch.y + yOffset, scratch.z);
                const duration = durationMs > 0 ? Math.max(4.0, durationMs / 1000) : (5.0 + this._rand() * 3.0);
                const self = this;
                const cbx = bx, cby = by, cyOffset = yOffset;
                this.calloutSystem.createCallout({
                    worldPos,
                    time: this.time,
                    duration,
                    refreshWorldPos: () => {
                        const w2 = { x: 0, y: 0, z: 0 };
                        self._gridWarp(cbx, cby, self._warpAmp(), self.time, w2);
                        return new THREE.Vector3(w2.x, w2.y + cyOffset, w2.z);
                    }
                });
            }
            return;
        }

        // track8: グリッドパーティクルのスケールブースト
        if (trackNumber === 8) {
            if (this._cubeBoostMap && this.gridBaseX) {
                const v = velocity / 127.0;
                const maxBoost = 1.0 + v * 6.0;
                const cp = this._clusteredGridPoint(8);
                const cx = cp.x, cy = cp.y;
                const r = this._cubeBoostRadius;
                const r2 = r * r;
                const n = this.particles.length;
                const noiseScale = 0.00035;
                for (let i = 0; i < n; i++) {
                    const bx = this.gridBaseX[i], by = this.gridBaseY[i];
                    const dx = bx - cx, dy = by - cy;
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 > r2 * 4) continue;
                    const gauss = Math.exp(-dist2 / (r2 * 0.5));
                    const nx = bx * noiseScale + 17.3;
                    const ny = by * noiseScale + 5.1;
                    const noise = 0.6 + 0.8 * (
                        Math.sin(nx * 2.1 + ny * 1.7) * 0.5 +
                        Math.sin(nx * 4.3 - ny * 3.1) * 0.25 +
                        Math.sin(nx * 8.9 + ny * 6.7) * 0.125
                    );
                    const boost = maxBoost * gauss * noise;
                    if (boost > this._cubeBoostMap[i]) {
                        this._cubeBoostMap[i] = boost;
                    }
                }
            }
            return;
        }


        // track9: ブルーム・ブロッサム（拡大発光リング + 放射クロス + 中心グロー + 色相フラッシュ）
        if (trackNumber === 9) {
            if (this.trackEffects[9]) {
                this._fireBloomBurst(velocity, durationMs);
            }
            return;
        }

        // track3: インプロージョン（吸い込み）+ 全体を一瞬たわませる衝撃波
        // → グリッドが「キュッ」と凹んで戻る、拍にハマる派手な動き。既存のimplode/warpを使うので軽い。
        if (trackNumber === 3) {
            if (this.trackEffects[3]) {
                this._fireImplodePulse(velocity);
                this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + (velocity / 127) * 0.9);
                // 波形バスも一気に持ち上げてグリッド全体を揺らす
                this.busLevel = Math.min(2.0, this.busLevel + (velocity / 127) * 0.8);
            }
            return;
        }

        // track4: 二連ウォープパルス（正逆両方向）で"パルス爆発"＋色相を一気に振る
        // → 表と裏に押し出しが同時に走って弾ける。_heatHue を蹴ってライン/波形の色が跳ねる。
        if (trackNumber === 4) {
            if (this.trackEffects[4]) {
                this._fireWarpPulse(velocity, durationMs);
                this._fireWarpPulse(Math.min(127, velocity * 0.8), durationMs * 0.6);
                this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + (velocity / 127) * 1.2);
                // 色相をランダムに蹴る（ドリームコア寄りの色変化を演出）
                this._heatHue = (this._heatHue + 0.13 + this._rand() * 0.22) % 1.0;
            }
            return;
        }

        // track10: Z方向押し出しパルス
        if (trackNumber === 10) {
            this._fireWarpPulse(velocity, durationMs);
            return;
        }

        // track2: 色反転（Scene12は duration 依存ではなく「瞬間的」に反転してすぐ戻す）
        if (trackNumber === 2) {
            if (this.trackEffects[2] && this.colorInversion && this.colorInversion.initialized) {
                if (durationMs === 0 && args.length === 0) {
                    // 引数なしはトグル（キーパッド等）— 従来通り
                    this.colorInversion.setEnabled(!this.colorInversion.isEnabled());
                    this.colorInversion.endTime = 0;
                } else {
                    // ノート受信時は duration を無視して固定の極短時間だけ反転（瞬間フラッシュ）
                    this.colorInversion.apply(velocity, this.track2FlashMs);
                }
            }
            return;
        }

        // それ以外（/phase、/tick など）は親に委譲
        super.handleOSC(message);
    }

    // ===== initPostProcessing =====
    // Scene12の filmGrainIntensity: 0.65 + Scene09のDOF/bloom値をマージ

    initPostProcessing() {
        setupPostEffectsPipeline(this, {
            filmGrainIntensity: 0.08,  // くすみの原因なのでさらに控えめに（0.2→0.08）
            filmGrainGrayscale: false,
            // DOFをシャープ寄りに（ボケ・滲みを弱める）
            dofFocus: 2100,
            dofAperture: 0.0000008,    // 0.0000012 → 0.0000008（ピント面を広げてボケ始めを遠ざける）
            dofMaxBlur: 0.0016,        // 0.0028 → 0.0016（ボケ最大半径を縮めて全体シャープに）
            // bloomはほぼ切る（滲みを最小限に）
            bloomStrength: 0.05,       // 0.16 → 0.05（ほぼ消す）
            bloomRadius: 0.6,          // 0.7 → 0.6
            bloomThreshold: 0.75       // 0.6 → 0.75（かなり明るい所だけ僅かに滲む）
        });
        if (this.filmPass?.uniforms?.uColorNoise) {
            this.filmPass.uniforms.uColorNoise.value = 0.03;  // 0.1 → 0.03（色ノイズによる濁り除去）
        }
        attachStrobeFlashPass(this);
        this.applyTrackEffectsToPostPasses();
    }

    onResize() {
        super.onResize();
        resizePostEffectsPasses(this);
    }

    // ===== dispose =====

    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        if (this.studio) {
            this.studio.dispose();
            this.studio = null;
        }

        if (this._minimalLights) {
            for (const light of this._minimalLights) {
                this.scene.remove(light);
                light.dispose?.();
            }
            this._minimalLights = null;
        }

        if (this.atmosphere) {
            this.atmosphere.dispose();
            this.atmosphere = null;
        }

        if (this.promoWallFillLight) {
            this.scene.remove(this.promoWallFillLight);
            this.promoWallFillLight.dispose?.();
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

        if (this._cornerLamps) {
            for (const lamp of this._cornerLamps) lamp.dispose?.();
            this._cornerLamps = null;
        }

        if (this.collectiveGlowLight) {
            this.scene.remove(this.collectiveGlowLight);
            this.collectiveGlowLight = null;
        }

        // track9: ブルーム・ブロッサムの片付け
        if (this._blossomGroup) {
            this.scene.remove(this._blossomGroup);
            for (const slot of this._blossomRingPool) {
                slot.mesh.geometry?.dispose();
                slot.mat?.dispose();
            }
            this._blossomRingPool = [];
            this._blossomGroup = null;
        }
        if (this._blossomGlowLight) {
            this.scene.remove(this._blossomGlowLight);
            this._blossomGlowLight = null;
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

        this.expandSpheres.forEach((e) => {
            if (e.light) this.scene.remove(e.light);
            if (e.mesh) {
                this.scene.remove(e.mesh);
                e.mesh.geometry.dispose();
                e.mesh.material.dispose();
            }
        });
        this.expandSpheres = [];

        if (this.instancedMeshManager) {
            this.instancedMeshManager.dispose();
            this.instancedMeshManager = null;
        }
        if (this._gpuDepthMaterial) {
            this._gpuDepthMaterial.dispose();
            this._gpuDepthMaterial = null;
        }
        this._gpuWarpUniforms = null;
        this._gpuWarpUniformsDepth = null;
        this._boostAttr = null;
        this.particles = [];
        this.gridBaseX = null;
        this.gridBaseY = null;

        // トラック別波形を破棄
        for (const line of this.waveLines) {
            if (line.geometry) line.geometry.dispose();
            if (line.material) line.material.dispose();
            if (this.scene) this.scene.remove(line);
        }
        this.waveLines = [];
        this.wavePositions = [];
        this.trackVoice = [];
        this._waveCurvePts = [];

        // track8シリンダーを破棄
        for (const c of this.track8Cylinders) this._disposeTrack8Cylinder(c);
        this.track8Cylinders = [];

        // track10パルスをクリア
        this.warpPulses = [];

        // 赤い立体菱形マーカープールを破棄
        for (const marker of this.crossPool) {
            if (marker.userData.shellMat) marker.userData.shellMat.dispose();
            if (marker.userData.coreMat) marker.userData.coreMat.dispose();
        }
        if (this._crossGeos) {
            for (const g of this._crossGeos) g.dispose();
            this._crossGeos = null;
        }
        if (this.crossGroup && this.scene) this.scene.remove(this.crossGroup);
        this.crossGroup = null;
        this.crossPool = [];

        if (this._gridLineMesh) {
            this.scene.remove(this._gridLineMesh);
            this._gridLineMesh.geometry.dispose();
            this._gridLineMat?.dispose();
            this._gridLineMesh = null;
        }

        if (this._nodeEdgeMesh) {
            this.scene.remove(this._nodeEdgeMesh);
            this._nodeEdgeMesh.geometry.dispose();
            this._nodeEdgeMat?.dispose();
            this._nodeEdgeMesh = null;
        }

        // コールアウトを片付ける
        if (this.calloutSystem) {
            this.calloutSystem.callouts = [];
            this.calloutSystem.lastCalloutTime = 0;
        }

        disposeStudioRoomEnvironmentMap(
            { pmremGenerator: this.pmremGenerator, envMapTexture: this._roomEnvTexture },
            this.scene
        );
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;
        this.bloomPass = null;

        super.dispose();
    }
}
