/**
 * Scene13: synapse studio — スタジオ部屋の中に浮かぶ神経網
 *
 * 中身（オブジェクト）は Scene11「synapse / vitrine」から移植:
 *  - ハブ（神経核）＋普通ノードの InstancedMesh（歪んだニューロン体）
 *  - 壁アンカー（赤い潰れ半球）
 *  - 三次ベジェの繊維（幹＋樹状突起の枝分かれ）
 *  - 活動電位パルス（走る光点）
 *  - 構造的配線（距離だけで結ばない scale-free 風トポロジー）＋ 成長 ＋ OSC連動
 *
 * 部屋・描画の質感は Scene12「mathym | Xenodub」から移植:
 *  - StudioBox / 床・壁・天井スポットリグ / 四隅蛍光灯 / 環境マップ / トーンマップ
 *  - ポストエフェクト（DOF・Bloom・FilmGrain・ストロボ・色反転/色収差/グリッチ）
 *  - StudioAtmosphere（空気ノイズ）
 *  - ノード/アンカーは FleshVein テクスチャ＋envMap のマットな肉質に寄せて統合
 *
 * ※ Scene11 のヴィトリーヌ（白い枠＋目盛り＋壁グリッド）は「部屋」に相当するため破棄し、
 *   神経網を Scene12 のスタジオ部屋の中（centerY）へ浮かせる。
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import { RandomLFO } from '../../lib/RandomLFO.js';
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
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';
import { StudioFluorescentLamp } from '../../lib/StudioFluorescentLamp.js';
import { generateFleshVeinTextures } from '../../lib/FleshVeinTextures.js';

export class Scene13 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'synapse | studio 13';
        this.initialized = false;
        this.sceneNumber = 13;
        this.kitNo = 5;
        this.sharedResourceManager = sharedResourceManager;

        // ============================================================
        //  部屋・描画（Scene12から移植）
        // ============================================================
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
        this.useSSAO = true;      // setup内でfalse化（重い）
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
            1: true, 2: true, 3: true, 4: true,
            5: true, 6: true, 7: true, 8: true, 9: true, 12: true
        };
        this.useTrack2Strobe = false;
        this.track2FlashMs = 60;

        // 真っ暗空間モード（試験用）
        this.blackVoidMode = false;
        this.enableShadows = true;

        // StudioBox / 部屋
        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.promoWallLightTarget = null;
        this.promoWallFillLight = null;
        this.fillPointLight = null;
        this.pulsePointLight = null;
        this.networkKeyLight = null;    // 神経網を立体的に見せるキーライト
        this.networkFillLight = null;   // 反対側からの弱いフィル
        this._cornerLamps = null;
        this.collectiveGlowLight = null;

        // Scene12/11と同じ標準部屋サイズ
        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = STUDIO_FLOOR_TOP_Y;   // -498
        this.ceilingY = 5500;

        // チリ／空気ノイズ
        this.ambientParticleCount = 1000;
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientMinLiving = 180;

        // 神経網を浮かべる中心の高さ（部屋の床上・中央より少し上）
        this.centerY = STUDIO_FLOOR_TOP_Y + 2600;   // = 2102
        // 神経網ぜんたいの拡大率（box2100 → 実効 ≒ 5700。部屋スケールで映えるよう拡大）
        this.groupScale = 2.7;

        // DOFオートフォーカス用
        this._centerSmoothed = new THREE.Vector3(0, this.centerY, 0);
        this._dofCamDir = new THREE.Vector3();
        this._dofToTarget = new THREE.Vector3();

        // ============================================================
        //  神経網オブジェクト（Scene11から移植）
        // ============================================================
        // ---- 神経網の広がり（ヴィトリーヌ相当の論理サイズ。箱は描かない）----
        this.boxSize = 2100;
        this.half = this.boxSize / 2;
        this.homeBound = this.half * 0.9;
        this.posClamp = this.half * 0.97;

        // ---- ノード（ニューロン）----
        this.nodeCount = 500;
        this.hubCount = 32;
        this.hubRadius = this.half * 0.5;

        // ---- アンカー（壁の赤い端子、手前+Zを除く5面）----
        this.anchorCount = 90;

        // ---- 繊維（三次ベジェ＋枝分かれ）----
        this.segMain = 9;
        this.segBranch = 6;
        this.maxLineSegments = 48000;
        this.bendBase = 0.24;

        // ---- 信号パルス（活動電位）----
        this.pulsePool = 1000;

        // ---- 配色 ----
        // 繊維は肉質に寄せた腱（すじ）色。真っ白を避けてくすませる。パルスはアルゴリズム的色相。
        this.fiberColor = new THREE.Color(0xbaa091);
        this.pulseColor = new THREE.Color(0xbfeaff);
        this.pulseHue = 0.55;
        this.pulseSat = 0.75;
        this.pulseLight = 0.7;
        this.pulseHueDrift = 0.015;

        // ---- エナジー ----
        this.energy = 0.0;

        // ---- 成長 ----
        this.tickLoopLen = 96 * 384;   // = 36864
        this.minActive = 0;
        this.activeCount = 0;
        this.activeCountF = 0;
        this.targetActive = 0;

        // ---- 生きた揺らぎ ----
        this.bendLFO     = new RandomLFO(0.012, 0.05, 0.10, 0.30);
        this.bendWaveLFO = new RandomLFO(0.010, 0.04, 0.6, 1.6);

        // ---- 状態（typed array）----
        this.homeX = null; this.homeY = null; this.homeZ = null;
        this.wAmp = null; this.wSpd = null;
        this.wPhX = null; this.wPhY = null; this.wPhZ = null;
        this.dispX = null; this.dispY = null; this.dispZ = null;
        this.npx = null; this.npy = null; this.npz = null;
        this.scaleBase = null;
        this.isHub = null;
        this.nodeFlash = null;
        this.rotX0 = null; this.rotY0 = null; this.rotZ0 = null;
        this.spinX = null; this.spinY = null; this.spinZ = null;
        this.apx = null; this.apy = null; this.apz = null;
        this.anx = null; this.any = null; this.anz = null;
        this.anchorScaleArr = null;

        // ---- エッジ ----
        this.edges = [];
        this.edgeMain = null;
        this.adj = null;

        // ---- パルス（typed array）----
        this.plEdge = null;
        this.plT = null;
        this.plSpeed = null;
        this.plDir = null;
        this.plActive = null;
        this.plNext = 0;
        this.pulseAccum = 0;

        // ---- 描画物 ----
        this.synapseGroup = null;   // 神経網をまとめて centerY へ浮かせる親
        this.boxGroup = null;       // 外枠（ヴィトリーヌ）
        this.nodeMesh = null;
        this.hubMesh = null;
        this.nodeMat = null;
        this.anchorMesh = null;
        this.anchorMat = null;
        this.fiberLines = null;
        this.fiberPositions = null;
        this.fiberColors = null;
        this.pulsePoints = null;
        this.pulsePosAttr = null;
        this.glowTexture = null;
        this.fleshTex = null;        // FleshVein map/bumpMap（Scene12質感）
        this._segCount = 0;

        // ---- スクラッチ ----
        this._dummy = new THREE.Object3D();
        this._color = new THREE.Color();
        this._up = new THREE.Vector3(0, 1, 0);
        this._nrm = new THREE.Vector3();

        // 擬似乱数（xorshift）
        this.seed = 0x1a2b3c4d | 0;

        this.time = 0.0;
        this.setScreenshotText(this.title);
    }

    /** 決定論的PRNG（xorshift） */
    _rand() {
        let x = this.seed | 0;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        this.seed = x;
        return ((x >>> 0) % 1000000) / 1000000;
    }

    // カメラは原点を周回しつつ、視線は神経網の中心(_centerSmoothed)を向く（Scene12方式）
    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 3000;
        cameraParticle.maxDistance = 6800;
        cameraParticle.maxDistanceReset = 6000;
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

    // ============================================================
    //  setup
    // ============================================================

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.useSSAO = false;   // 重いのでOFF

        // ---- 部屋・トーン・背景（Scene12） ----
        this.renderer.shadowMap.enabled = this.enableShadows;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });
        if (this.blackVoidMode) {
            this.scene.background = new THREE.Color(0x000000);
            this.scene.fog = null;
        }

        // ---- カメラ（神経網を centerY で正面から） ----
        this.camera.fov = 45;
        this.camera.near = 12;
        this.camera.far = 15000;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, this.centerY, 6000);
        this.camera.lookAt(0, this.centerY, 0);
        this._centerSmoothed.set(0, this.centerY, 0);

        // ---- 環境マップ ----
        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;
        if (this.blackVoidMode) {
            this.scene.background = new THREE.Color(0x000000);
        }

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
            this._repositionFluorescentLamps();
        } else {
            this.setupMinimalParticleLights();
        }

        // 空気ノイズ質感
        this.createAmbientFloatingParticles();

        // ---- 神経網（Scene11のオブジェクト） ----
        this.synapseGroup = new THREE.Group();
        this.synapseGroup.position.set(0, this.centerY, 0);
        this.synapseGroup.scale.setScalar(this.groupScale);   // 部屋スケールに合わせて拡大
        this.scene.add(this.synapseGroup);

        this.glowTexture = this._makeGlowTexture();
        this.fleshTex = generateFleshVeinTextures(512, { seed: 903 });
        this._initNodes();
        this._initAnchors();
        this._buildTopology();
        this._initPulses();
        this._buildBox();          // 外枠（ヴィトリーヌ：白フレーム＋壁グリッド＋目盛り）
        this._buildNodeMesh();
        this._buildAnchorMesh();
        this._buildFiberLines();
        this._buildPulsePoints();

        // 神経網専用ライティング（部屋の光は遠く弱いので、網に陰影＝立体感を付ける）
        this.networkKeyLight = new THREE.PointLight(0xfff0e2, 45, 11000, 1.15);
        this.networkKeyLight.position.set(1400, this.centerY + 1600, 3200);
        this.scene.add(this.networkKeyLight);
        this.networkFillLight = new THREE.PointLight(0x9fb4d0, 16, 11000, 1.2);
        this.networkFillLight.position.set(-2200, this.centerY - 400, -1800);
        this.scene.add(this.networkFillLight);

        // 成長初期値
        this.minActive = this.hubCount + 6;
        this.activeCount = this.minActive;
        this.activeCountF = this.minActive;
        this.targetActive = this.minActive;

        this.setParticleCount(this.nodeCount);
        this.setupCameraParticleDistances();
        this.initPostProcessing();

        this.initialized = true;
    }

    // ============================================================
    //  部屋（Scene12から移植）
    // ============================================================

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
            airNoiseVolumeScale: 15.0
        });
    }

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

    /** 天井四隅に蛍光灯を配置 */
    _repositionFluorescentLamps() {
        for (const lamp of (this.studio?.fluorescentLights || [])) {
            if (lamp.group) lamp.group.visible = false;
            if (lamp.pointLight) lamp.pointLight.intensity = 0;
        }
        if (this._cornerLamps) {
            for (const lamp of this._cornerLamps) lamp.dispose?.();
        }
        this._cornerLamps = [];

        const tubeHeight = (this.ceilingY - this.floorTopY) * 0.55;
        const lampY = this.floorTopY + tubeHeight * 0.5;
        const cx = this.roomHalfW - 400;
        const cz = this.roomHalfD - 400;
        const corners = [[cx, lampY, cz], [-cx, lampY, cz], [cx, lampY, -cz], [-cx, lampY, -cz]];

        corners.forEach(([x, y, z]) => {
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

    // ============================================================
    //  テクスチャ生成
    // ============================================================

    /** ソフトなグロー円（パルス用） */
    _makeGlowTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
        g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
        g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // ============================================================
    //  外枠（ヴィトリーヌ：フレーム＋壁グリッド＋目盛り。Scene11から移植）
    // ============================================================

    _buildBox() {
        this.boxGroup = new THREE.Group();

        // フレーム（12辺・白）
        const boxGeo = new THREE.BoxGeometry(this.boxSize, this.boxSize, this.boxSize);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const frame = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.4, fog: true,
        }));
        boxGeo.dispose();
        this.boxGroup.add(frame);

        // 壁グリッド（5面、手前+Zは開口）
        const gridPos = this._buildWallGridPositions(8);
        const gridGeo = new THREE.BufferGeometry();
        gridGeo.setAttribute('position', new THREE.BufferAttribute(gridPos, 3));
        const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
            color: 0x25415a, transparent: true, opacity: 0.3,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
        }));
        this.boxGroup.add(grid);

        // 目盛り（12辺に内向きの刻み）
        const tickPos = this._buildTickPositions(12);
        const tickGeo = new THREE.BufferGeometry();
        tickGeo.setAttribute('position', new THREE.BufferAttribute(tickPos, 3));
        const ticks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
            color: 0xbfd4e6, transparent: true, opacity: 0.5, fog: true,
        }));
        this.boxGroup.add(ticks);

        this.synapseGroup.add(this.boxGroup);
    }

    /** 5面ぶんの内壁グリッド線分（手前=+Z面は含めない） */
    _buildWallGridPositions(div) {
        const H = this.half;
        const lines = [];
        const addWall = (fixedAxis, fixedVal) => {
            for (let k = 0; k <= div; k++) {
                const t = -H + (2 * H) * (k / div);
                for (let pass = 0; pass < 2; pass++) {
                    const p1 = [0, 0, 0], p2 = [0, 0, 0];
                    p1[fixedAxis] = fixedVal; p2[fixedAxis] = fixedVal;
                    const va = (fixedAxis + 1) % 3;
                    const vb = (fixedAxis + 2) % 3;
                    if (pass === 0) { p1[va] = t; p1[vb] = -H; p2[va] = t; p2[vb] = H; }
                    else { p1[va] = -H; p1[vb] = t; p2[va] = H; p2[vb] = t; }
                    lines.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
                }
            }
        };
        addWall(0, H); addWall(0, -H);
        addWall(1, H); addWall(1, -H);
        addWall(2, -H);
        return new Float32Array(lines);
    }

    /** 目盛り：12辺それぞれに沿って内向きの刻みを立てる（majorは3本ごとに長く） */
    _buildTickPositions(div) {
        const H = this.half;
        const minorLen = 16, majorLen = 34;
        const lines = [];
        for (let varyAxis = 0; varyAxis < 3; varyAxis++) {
            const fa = (varyAxis + 1) % 3;
            const fb = (varyAxis + 2) % 3;
            for (let sa = -1; sa <= 1; sa += 2) {
                for (let sb = -1; sb <= 1; sb += 2) {
                    for (let k = 1; k < div; k++) {
                        const t = -H + (2 * H) * (k / div);
                        const p = [0, 0, 0];
                        p[varyAxis] = t; p[fa] = sa * H; p[fb] = sb * H;
                        const inv = 1 / Math.SQRT2;
                        const len = (k % 3 === 0) ? majorLen : minorLen;
                        const q = [p[0], p[1], p[2]];
                        q[fa] += -sa * inv * len;
                        q[fb] += -sb * inv * len;
                        lines.push(p[0], p[1], p[2], q[0], q[1], q[2]);
                    }
                }
            }
        }
        return new Float32Array(lines);
    }

    // ============================================================
    //  神経網 初期化（Scene11から移植）
    // ============================================================

    /** ノード（ホーム位置・微揺れ・スケール・ハブ）の初期化 */
    _initNodes() {
        const n = this.nodeCount;
        this.homeX = new Float32Array(n); this.homeY = new Float32Array(n); this.homeZ = new Float32Array(n);
        this.wAmp = new Float32Array(n); this.wSpd = new Float32Array(n);
        this.wPhX = new Float32Array(n); this.wPhY = new Float32Array(n); this.wPhZ = new Float32Array(n);
        this.dispX = new Float32Array(n); this.dispY = new Float32Array(n); this.dispZ = new Float32Array(n);
        this.npx = new Float32Array(n); this.npy = new Float32Array(n); this.npz = new Float32Array(n);
        this.scaleBase = new Float32Array(n);
        this.isHub = new Uint8Array(n);
        this.nodeFlash = new Float32Array(n);
        this.rotX0 = new Float32Array(n); this.rotY0 = new Float32Array(n); this.rotZ0 = new Float32Array(n);
        this.spinX = new Float32Array(n); this.spinY = new Float32Array(n); this.spinZ = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const hub = i < this.hubCount;
            this.isHub[i] = hub ? 1 : 0;
            const R = hub ? this.hubRadius : this.homeBound;
            const th = this._rand() * Math.PI * 2;
            const ph = Math.acos(2 * this._rand() - 1);
            const r = hub ? (R * (0.2 + 0.8 * this._rand())) : (R * Math.cbrt(this._rand()));
            this.homeX[i] = Math.sin(ph) * Math.cos(th) * r;
            this.homeY[i] = Math.sin(ph) * Math.sin(th) * r;
            this.homeZ[i] = Math.cos(ph) * r;
            this.wAmp[i] = hub ? (6 + this._rand() * 8) : (10 + this._rand() * 14);
            this.wSpd[i] = 0.2 + this._rand() * 0.5;
            this.wPhX[i] = this._rand() * Math.PI * 2;
            this.wPhY[i] = this._rand() * Math.PI * 2;
            this.wPhZ[i] = this._rand() * Math.PI * 2;
            this.scaleBase[i] = hub ? (22 + this._rand() * 14) : (6 + this._rand() * 5);
            this.rotX0[i] = this._rand() * Math.PI * 2;
            this.rotY0[i] = this._rand() * Math.PI * 2;
            this.rotZ0[i] = this._rand() * Math.PI * 2;
            this.spinX[i] = (this._rand() - 0.5) * 0.3;
            this.spinY[i] = (this._rand() - 0.5) * 0.3;
            this.spinZ[i] = (this._rand() - 0.5) * 0.3;
            this.npx[i] = this.homeX[i]; this.npy[i] = this.homeY[i]; this.npz[i] = this.homeZ[i];
        }
    }

    /** アンカー（壁の赤い潰れ半球）初期化 */
    _initAnchors() {
        const m = this.anchorCount;
        this.apx = new Float32Array(m); this.apy = new Float32Array(m); this.apz = new Float32Array(m);
        this.anx = new Float32Array(m); this.any = new Float32Array(m); this.anz = new Float32Array(m);
        this.anchorScaleArr = new Float32Array(m);
        this._seedAnchorPositions();
    }

    _seedAnchorPositions() {
        const m = this.anchorCount;
        const H = this.half;
        const s = H * 0.88;
        for (let i = 0; i < m; i++) {
            const wall = i % 5;   // 0:+X 1:-X 2:+Y 3:-Y 4:-Z（+Z手前は開口）
            const u = (this._rand() * 2 - 1) * s;
            const v = (this._rand() * 2 - 1) * s;
            switch (wall) {
                case 0: this.apx[i] = H;  this.apy[i] = u;  this.apz[i] = v;  this.anx[i] = -1; this.any[i] = 0; this.anz[i] = 0; break;
                case 1: this.apx[i] = -H; this.apy[i] = u;  this.apz[i] = v;  this.anx[i] = 1;  this.any[i] = 0; this.anz[i] = 0; break;
                case 2: this.apx[i] = u;  this.apy[i] = H;  this.apz[i] = v;  this.anx[i] = 0;  this.any[i] = -1; this.anz[i] = 0; break;
                case 3: this.apx[i] = u;  this.apy[i] = -H; this.apz[i] = v;  this.anx[i] = 0;  this.any[i] = 1; this.anz[i] = 0; break;
                default: this.apx[i] = u; this.apy[i] = v;  this.apz[i] = -H; this.anx[i] = 0;  this.any[i] = 0; this.anz[i] = 1; break;
            }
            this.anchorScaleArr[i] = 10 + this._rand() * 10;
        }
    }

    /** 構造的な神経配線を構築（距離だけで結ばない） */
    _buildTopology() {
        this.edges = [];
        const seen = new Set();
        const n = this.nodeCount, hc = this.hubCount;
        const hx = this.homeX, hy = this.homeY, hz = this.homeZ;

        const key = (a, b, anchor) => anchor ? ('A' + a + '_' + b)
            : (a < b ? (a + '_' + b) : (b + '_' + a));
        const addEdge = (a, b, bAnchor) => {
            if (!bAnchor && a === b) return;
            const k = key(a, b, bAnchor);
            if (seen.has(k)) return;
            seen.add(k);
            this.edges.push({
                a, b, bAnchor,
                sign: this._rand() < 0.5 ? 1 : -1,
                phase: this._rand() * Math.PI * 2,
                branches: this._makeBranches(),
            });
        };

        const dist2Node = (i, j) => {
            const dx = hx[i] - hx[j], dy = hy[i] - hy[j], dz = hz[i] - hz[j];
            return dx * dx + dy * dy + dz * dz;
        };

        for (let i = hc; i < n; i++) {
            let b1 = -1, b2 = -1, b3 = -1, d1 = Infinity, d2 = Infinity, d3 = Infinity;
            for (let h = 0; h < hc; h++) {
                const d = dist2Node(i, h);
                if (d < d1) { d3 = d2; b3 = b2; d2 = d1; b2 = b1; d1 = d; b1 = h; }
                else if (d < d2) { d3 = d2; b3 = b2; d2 = d; b2 = h; }
                else if (d < d3) { d3 = d; b3 = h; }
            }
            if (b1 >= 0) addEdge(i, b1, false);
            if (b2 >= 0 && this._rand() < 0.75) addEdge(i, b2, false);
            if (b3 >= 0 && this._rand() < 0.4) addEdge(i, b3, false);

            let n1 = -1, n2 = -1, e1 = Infinity, e2 = Infinity;
            for (let j = hc; j < n; j++) {
                if (j === i) continue;
                const d = dist2Node(i, j);
                if (d < e1) { e2 = e1; n2 = n1; e1 = d; n1 = j; }
                else if (d < e2) { e2 = d; n2 = j; }
            }
            if (n1 >= 0 && this._rand() < 0.75) addEdge(i, n1, false);
            if (n2 >= 0 && this._rand() < 0.4) addEdge(i, n2, false);
        }

        for (let h = 0; h < hc; h++) {
            let b1 = -1, b2 = -1, d1 = Infinity, d2 = Infinity;
            for (let g = 0; g < hc; g++) {
                if (g === h) continue;
                const d = dist2Node(h, g);
                if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = g; }
                else if (d < d2) { d2 = d; b2 = g; }
            }
            if (b1 >= 0) addEdge(h, b1, false);
            if (b2 >= 0) addEdge(h, b2, false);
        }

        for (let k = 0; k < this.anchorCount; k++) {
            let nn = -1, dn = Infinity;
            for (let i = 0; i < n; i++) {
                const dx = hx[i] - this.apx[k], dy = hy[i] - this.apy[k], dz = hz[i] - this.apz[k];
                const d = dx * dx + dy * dy + dz * dz;
                if (d < dn) { dn = d; nn = i; }
            }
            if (nn >= 0) addEdge(nn, k, true);
        }

        this.edgeMain = new Float32Array(this.edges.length * 12);

        this.adj = [];
        for (let i = 0; i < n; i++) this.adj.push([]);
        for (let e = 0; e < this.edges.length; e++) {
            const ed = this.edges[e];
            this.adj[ed.a].push(e);
            if (!ed.bAnchor) this.adj[ed.b].push(e);
        }
    }

    /** 枝分かれ（樹状突起スパー）の記述子を0〜3本ぶん生成 */
    _makeBranches() {
        const r = this._rand();
        let count = 0;
        if (r > 0.35) count = 1;
        if (r > 0.68) count = 2;
        if (r > 0.88) count = 3;
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push({
                tSplit: 0.35 + this._rand() * 0.4,
                len: 0.28 + this._rand() * 0.4,
                curlA: this._rand() * 2 - 1,
                curlB: this._rand() * 2 - 1,
                bow: (this._rand() * 2 - 1) * 0.4,
            });
        }
        return out;
    }

    /** パルス配列の確保 */
    _initPulses() {
        const P = this.pulsePool;
        this.plEdge = new Int32Array(P);
        this.plT = new Float32Array(P);
        this.plSpeed = new Float32Array(P);
        this.plDir = new Uint8Array(P);
        this.plActive = new Uint8Array(P);
        this.plNext = 0;
        this.pulseAccum = 0;
    }

    // ============================================================
    //  描画物の生成（マテリアルはScene12質感に寄せる）
    // ============================================================

    /**
     * 歪んだニューロン体（soma）ジオメトリを生成。
     * 単位イコサ球の各頂点を、向きベースの低周波ノイズで凸凹させ、
     * 一部にスパイク（樹状突起の根っこ）を生やす。
     */
    _makeNeuronGeometry(detail, amp, spikeAmt, seed) {
        const geo = new THREE.IcosahedronGeometry(1, detail);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            let d = Math.sin(x * 3.1 + seed) * Math.cos(y * 2.7 - seed) * 0.5
                  + Math.sin(y * 4.3 + seed * 1.7) * Math.cos(z * 3.9 + seed) * 0.3
                  + Math.sin(z * 5.1 - seed) * Math.cos(x * 4.5 + seed * 2.1) * 0.2;
            // 高周波うねりは控えめに（detailを上げたぶん、細かいギザギザではなく滑らかな起伏に）
            d += (Math.sin(x * 9.7 - seed * 1.3) * Math.cos(z * 8.9 + seed) * 0.08
                + Math.sin(y * 11.3 + seed * 0.7) * Math.cos(x * 10.1 - seed) * 0.06
                + Math.sin(z * 12.7 + seed * 2.3) * Math.cos(y * 9.3 + seed) * 0.05);
            // スパイク（樹状突起の根）は頂点が増えたぶんしきい値を上げて本数を保ち、控えめに
            const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 13.1) * 43758.5453;
            const f = h - Math.floor(h);
            const spike = f > 0.988 ? (f - 0.988) * 12.0 * spikeAmt : 0;
            const r = 1 + amp * d + spike;
            pos.setXYZ(i, x * r, y * r, z * r);
        }
        geo.computeVertexNormals();
        return geo;
    }

    /**
     * ノード球（ハブ／普通で別ジオメトリの InstancedMesh）。
     * Scene12の質感（FleshVeinテクスチャ＋envMap＋マットなStandardMaterial）でソリッド描画。
     */
    _buildNodeMesh() {
        const mat = new THREE.MeshStandardMaterial({
            color: 0xa89a90,
            emissive: 0x0c0806,
            emissiveIntensity: 0.3,        // 常時発光は最小限（部屋の光で照らされて接地させる）
            map: this.fleshTex.map,
            bumpMap: this.fleshTex.bumpMap,
            bumpScale: 3.0,
            metalness: 0.5,                // scene12キューブ寄り：環境反射を拾って部屋に馴染ませる
            roughness: 0.4,
            envMapIntensity: 1.25,         // 環境マップの映り込みを強めて接地感UP
            fog: true
        });
        if (this.scene?.environment) mat.envMap = this.scene.environment;
        this.nodeMat = mat;

        const nodeGeo = this._makeNeuronGeometry(5, 0.16, 0.22, 1.3);
        this.nodeMesh = new THREE.InstancedMesh(nodeGeo, mat, this.nodeCount - this.hubCount);
        this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.nodeMesh.frustumCulled = false;
        this.nodeMesh.castShadow = this.enableShadows;
        this.nodeMesh.receiveShadow = this.enableShadows;
        this.synapseGroup.add(this.nodeMesh);

        const hubGeo = this._makeNeuronGeometry(6, 0.22, 0.3, 7.7);
        this.hubMesh = new THREE.InstancedMesh(hubGeo, mat, this.hubCount);
        this.hubMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.hubMesh.frustumCulled = false;
        this.hubMesh.castShadow = this.enableShadows;
        this.hubMesh.receiveShadow = this.enableShadows;
        this.synapseGroup.add(this.hubMesh);

        this._writeNodeInstances();
    }

    /** 潰れた歪み半球（ドーム）ジオメトリ */
    _makeAnchorGeometry() {
        const geo = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const bump = 0.18 * (Math.sin(x * 3.3) * Math.cos(z * 2.9)
                + 0.5 * Math.sin(z * 4.7 + 1.3) * Math.cos(x * 3.8));
            const r = 1 + bump;
            const ny = y * (0.4 + bump * 0.15);
            pos.setXYZ(i, x * r, ny, z * r);
        }
        geo.computeVertexNormals();
        return geo;
    }

    /** アンカー（赤い潰れ半球・壁向き・デカい InstancedMesh） */
    _buildAnchorMesh() {
        const geo = this._makeAnchorGeometry();
        const mat = new THREE.MeshStandardMaterial({
            color: 0xd42020, roughness: 0.55, metalness: 0.35,
            emissive: 0x2a0303, emissiveIntensity: 0.3,
            bumpMap: this.fleshTex.bumpMap, bumpScale: 0.6,
            envMapIntensity: 1.1,
            fog: true
        });
        if (this.scene?.environment) mat.envMap = this.scene.environment;
        this.anchorMat = mat;
        this.anchorMesh = new THREE.InstancedMesh(geo, mat, this.anchorCount);
        this.anchorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.anchorMesh.frustumCulled = false;
        this.anchorMesh.castShadow = this.enableShadows;
        this._writeAnchorInstances();
        this.synapseGroup.add(this.anchorMesh);
    }

    /** 繊維（温白の LineSegments） */
    _buildFiberLines() {
        const verts = this.maxLineSegments * 2;
        this.fiberPositions = new Float32Array(verts * 3);
        this.fiberColors = new Float32Array(verts * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.fiberPositions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.fiberColors, 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.55,
            blending: THREE.NormalBlending, depthWrite: false, fog: true,
        });
        this.fiberLines = new THREE.LineSegments(geo, mat);
        this.fiberLines.frustumCulled = false;
        this.synapseGroup.add(this.fiberLines);
    }

    /** 信号パルス（加算Points・走る光点） */
    _buildPulsePoints() {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(this.pulsePool * 3);
        this.pulsePosAttr = new THREE.BufferAttribute(positions, 3);
        geo.setAttribute('position', this.pulsePosAttr);
        geo.setDrawRange(0, 0);
        this.pulseColor.setHSL(this.pulseHue, this.pulseSat, this.pulseLight);
        const mat = new THREE.PointsMaterial({
            size: 13, map: this.glowTexture, color: this.pulseColor,
            transparent: true, opacity: 0.95, depthWrite: false,
            blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
        });
        this.pulsePoints = new THREE.Points(geo, mat);
        this.pulsePoints.frustumCulled = false;
        this.synapseGroup.add(this.pulsePoints);
    }

    // ============================================================
    //  更新ループ
    // ============================================================

    onUpdate(deltaTime) {
        if (!this.initialized || !this.homeX || !this.fiberLines) return;
        const dt = Math.min(deltaTime || 0.016, 0.05);
        this.time += dt;

        this.energy *= Math.exp(-1.7 * dt);
        const eBoost = Math.min(1, this.energy);

        for (let i = 0; i < this.nodeCount; i++) this.nodeFlash[i] *= Math.exp(-4.0 * dt);

        this._updateGrowth(dt);
        this._updateNodePositions(dt);
        this._writeNodeInstances();

        this.bendLFO.update(dt);
        this.bendWaveLFO.update(dt);
        this._rebuildFibers(eBoost);

        this._updatePulses(dt, eBoost);

        // パルス色相ドリフト
        this.pulseHue = (this.pulseHue + this.pulseHueDrift * dt) % 1;
        if (this.pulsePoints) {
            this.pulseColor.setHSL(this.pulseHue, this.pulseSat, this.pulseLight);
            this.pulsePoints.material.color.copy(this.pulseColor);
        }

        // エナジーで発光・不透明度・サイズを持ち上げ
        if (this.nodeMat) this.nodeMat.emissiveIntensity = 0.3 + eBoost * 1.9;
        if (this.fiberLines) this.fiberLines.material.opacity = 0.45 + eBoost * 0.4;
        if (this.pulsePoints) this.pulsePoints.material.size = 11 + eBoost * 6;

        // 空気ノイズ
        this.atmosphere?.update(deltaTime, this.time, this._centerSmoothed);

        // カメラ更新（SceneBase）
        this.updateCamera();

        // DOFオートフォーカス（視線射影距離方式・中心=神経網中心）
        if (this.useAutoFocusDOF && this.useDOF && this.bokehPass?.uniforms?.focus) {
            this._dofCamDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            this._dofToTarget.copy(this._centerSmoothed).sub(this.camera.position);
            const targetFocus = Math.max(100, this._dofToTarget.dot(this._dofCamDir));
            const u = this.bokehPass.uniforms.focus;
            u.value += (targetFocus - u.value) * 0.5;
        }
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);
    }

    _updateGrowth(dt) {
        const tick = this.actualTick || 0;
        const prog = (tick % this.tickLoopLen) / this.tickLoopLen;
        this.targetActive = this.minActive + prog * (this.nodeCount - this.minActive);
        this.activeCountF += (this.targetActive - this.activeCountF) * Math.min(1, 3.0 * dt);
        let c = Math.round(this.activeCountF);
        if (c < this.minActive) c = this.minActive;
        if (c > this.nodeCount) c = this.nodeCount;
        this.activeCount = c;
    }

    _edgeActive(ed) {
        if (ed.a >= this.activeCount) return false;
        if (!ed.bAnchor && ed.b >= this.activeCount) return false;
        return true;
    }

    _updateNodePositions(dt) {
        const n = this.nodeCount;
        const t = this.time;
        const decay = Math.exp(-2.2 * dt);
        const C = this.posClamp;
        for (let i = 0; i < n; i++) {
            this.dispX[i] *= decay; this.dispY[i] *= decay; this.dispZ[i] *= decay;
            const a = this.wAmp[i], s = this.wSpd[i];
            let x = this.homeX[i] + Math.sin(t * s + this.wPhX[i]) * a + this.dispX[i];
            let y = this.homeY[i] + Math.sin(t * s * 1.13 + this.wPhY[i]) * a + this.dispY[i];
            let z = this.homeZ[i] + Math.sin(t * s * 0.87 + this.wPhZ[i]) * a + this.dispZ[i];
            if (x > C) x = C; else if (x < -C) x = -C;
            if (y > C) y = C; else if (y < -C) y = -C;
            if (z > C) z = C; else if (z < -C) z = -C;
            this.npx[i] = x; this.npy[i] = y; this.npz[i] = z;
        }
    }

    _writeNodeInstances() {
        const n = this.nodeCount, hc = this.hubCount;
        const d = this._dummy;
        const t = this.time;
        for (let i = 0; i < n; i++) {
            d.position.set(this.npx[i], this.npy[i], this.npz[i]);
            d.rotation.set(
                this.rotX0[i] + this.spinX[i] * t,
                this.rotY0[i] + this.spinY[i] * t,
                this.rotZ0[i] + this.spinZ[i] * t
            );
            const sc = this.scaleBase[i] * (1.0 + this.nodeFlash[i] * 0.6);
            d.scale.set(sc, sc, sc);
            d.updateMatrix();
            if (i < hc) this.hubMesh.setMatrixAt(i, d.matrix);
            else this.nodeMesh.setMatrixAt(i - hc, d.matrix);
        }
        this.hubMesh.count = hc;
        this.nodeMesh.count = Math.max(0, this.activeCount - hc);
        this.nodeMesh.instanceMatrix.needsUpdate = true;
        this.hubMesh.instanceMatrix.needsUpdate = true;
    }

    _writeAnchorInstances() {
        const m = this.anchorCount;
        const d = this._dummy;
        for (let i = 0; i < m; i++) {
            d.position.set(this.apx[i], this.apy[i], this.apz[i]);
            this._nrm.set(this.anx[i], this.any[i], this.anz[i]);
            d.quaternion.setFromUnitVectors(this._up, this._nrm);
            const sc = this.anchorScaleArr[i];
            d.scale.set(sc, sc, sc);
            d.updateMatrix();
            this.anchorMesh.setMatrixAt(i, d.matrix);
        }
        this.anchorMesh.instanceMatrix.needsUpdate = true;
    }

    /** 繊維（幹＋枝）を全エッジぶん張り直す */
    _rebuildFibers(eBoost) {
        this._segCount = 0;
        const edges = this.edges;
        const em = this.edgeMain;
        const bendAmt = this.bendLFO.getValue();
        const bendWave = this.bendWaveLFO.getValue();
        const bright = 0.55 + eBoost * 0.3;   // ベースを落として白飛びを避ける

        for (let e = 0; e < edges.length; e++) {
            const ed = edges[e];
            if (!this._edgeActive(ed)) continue;
            const ax = this.npx[ed.a], ay = this.npy[ed.a], az = this.npz[ed.a];
            let bx, by, bz;
            if (ed.bAnchor) { bx = this.apx[ed.b]; by = this.apy[ed.b]; bz = this.apz[ed.b]; }
            else { bx = this.npx[ed.b]; by = this.npy[ed.b]; bz = this.npz[ed.b]; }

            // 線ごとに明るさをばらけさせる（一律の白を避けて有機的に）
            const eb = bright * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(ed.phase * 3.1 + this.time * 0.4)));

            this._computeMainControls(ax, ay, az, bx, by, bz, ed, bendAmt, bendWave, e);
            const o = e * 12;
            this._writeBezier(
                em[o], em[o + 1], em[o + 2],
                em[o + 3], em[o + 4], em[o + 5],
                em[o + 6], em[o + 7], em[o + 8],
                em[o + 9], em[o + 10], em[o + 11],
                this.segMain, eb
            );

            for (let bi = 0; bi < ed.branches.length; bi++) {
                this._writeBranch(e, ed.branches[bi], eb * 0.8);
            }
        }

        this.fiberLines.geometry.setDrawRange(0, this._segCount * 2);
        this.fiberLines.geometry.attributes.position.needsUpdate = true;
        this.fiberLines.geometry.attributes.color.needsUpdate = true;
    }

    _computeMainControls(x1, y1, z1, x2, y2, z2, ed, bendAmt, bendWave, e) {
        const ddx = x2 - x1, ddy = y2 - y1, ddz = z2 - z1;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 0.0001;
        const inv = 1 / dist;
        const dx = ddx * inv, dy = ddy * inv, dz = ddz * inv;
        let rx = 0, ry = 1, rz = 0;
        if (Math.abs(dy) > 0.9) { rx = 1; ry = 0; rz = 0; }
        let p1x = dy * rz - dz * ry, p1y = dz * rx - dx * rz, p1z = dx * ry - dy * rx;
        const p1l = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z) || 1;
        p1x /= p1l; p1y /= p1l; p1z /= p1l;
        const p2x = dy * p1z - dz * p1y, p2y = dz * p1x - dx * p1z, p2z = dx * p1y - dy * p1x;

        const wave = 0.55 + 0.45 * Math.sin(this.time * bendWave + ed.phase);
        const bend = dist * (this.bendBase + bendAmt) * 0.5 * wave * ed.sign;
        const b3d = bend * 0.4;
        const t13 = dist / 3, t23 = (2 * dist) / 3;

        const c1x = x1 + dx * t13 + p1x * bend + p2x * b3d;
        const c1y = y1 + dy * t13 + p1y * bend + p2y * b3d;
        const c1z = z1 + dz * t13 + p1z * bend + p2z * b3d;
        const c2x = x1 + dx * t23 - p1x * (bend * 0.72) + p2x * b3d;
        const c2y = y1 + dy * t23 - p1y * (bend * 0.72) + p2y * b3d;
        const c2z = z1 + dz * t23 - p1z * (bend * 0.72) + p2z * b3d;

        const o = e * 12;
        const em = this.edgeMain;
        em[o] = x1; em[o + 1] = y1; em[o + 2] = z1;
        em[o + 3] = c1x; em[o + 4] = c1y; em[o + 5] = c1z;
        em[o + 6] = c2x; em[o + 7] = c2y; em[o + 8] = c2z;
        em[o + 9] = x2; em[o + 10] = y2; em[o + 11] = z2;
    }

    _writeBranch(e, br, bright) {
        const o = e * 12;
        const em = this.edgeMain;
        const x1 = em[o], y1 = em[o + 1], z1 = em[o + 2];
        const x2 = em[o + 9], y2 = em[o + 10], z2 = em[o + 11];
        const ddx = x2 - x1, ddy = y2 - y1, ddz = z2 - z1;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 0.0001;
        const inv = 1 / dist;
        const dx = ddx * inv, dy = ddy * inv, dz = ddz * inv;
        let rx = 0, ry = 1, rz = 0;
        if (Math.abs(dy) > 0.9) { rx = 1; ry = 0; rz = 0; }
        let p1x = dy * rz - dz * ry, p1y = dz * rx - dx * rz, p1z = dx * ry - dy * rx;
        const p1l = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z) || 1;
        p1x /= p1l; p1y /= p1l; p1z /= p1l;
        const p2x = dy * p1z - dz * p1y, p2y = dz * p1x - dx * p1z, p2z = dx * p1y - dy * p1x;

        const s = this._sampleMain(e, br.tSplit);
        const sx = s[0], sy = s[1], sz = s[2];
        const L = dist * br.len;
        const ex = sx + dx * L * 0.5 + p1x * L * br.curlA + p2x * L * br.curlB;
        const ey = sy + dy * L * 0.5 + p1y * L * br.curlA + p2y * L * br.curlB;
        const ez = sz + dz * L * 0.5 + p1z * L * br.curlA + p2z * L * br.curlB;
        const mx = (sx + ex) * 0.5 + p1x * L * br.bow;
        const my = (sy + ey) * 0.5 + p1y * L * br.bow;
        const mz = (sz + ez) * 0.5 + p1z * L * br.bow;
        this._writeBezier(sx, sy, sz, mx, my, mz, mx, my, mz, ex, ey, ez, this.segBranch, bright);
    }

    _sampleMain(e, t) {
        const o = e * 12;
        const em = this.edgeMain;
        return this._sampleBezier(
            em[o], em[o + 1], em[o + 2], em[o + 3], em[o + 4], em[o + 5],
            em[o + 6], em[o + 7], em[o + 8], em[o + 9], em[o + 10], em[o + 11], t
        );
    }

    _sampleBezier(x0, y0, z0, c1x, c1y, c1z, c2x, c2y, c2z, x1, y1, z1, t) {
        const it = 1 - t;
        const w0 = it * it * it, w1 = 3 * it * it * t, w2 = 3 * it * t * t, w3 = t * t * t;
        return [
            w0 * x0 + w1 * c1x + w2 * c2x + w3 * x1,
            w0 * y0 + w1 * c1y + w2 * c2y + w3 * y1,
            w0 * z0 + w1 * c1z + w2 * c2z + w3 * z1,
        ];
    }

    _writeBezier(x0, y0, z0, c1x, c1y, c1z, c2x, c2y, c2z, x1, y1, z1, seg, bright) {
        const pos = this.fiberPositions, col = this.fiberColors;
        const cr = this.fiberColor.r * bright, cg = this.fiberColor.g * bright, cb = this.fiberColor.b * bright;
        let prevX = x0, prevY = y0, prevZ = z0;
        for (let s = 1; s <= seg; s++) {
            if (this._segCount >= this.maxLineSegments) return;
            const t = s / seg, it = 1 - t;
            const w0 = it * it * it, w1 = 3 * it * it * t, w2 = 3 * it * t * t, w3 = t * t * t;
            const cx = w0 * x0 + w1 * c1x + w2 * c2x + w3 * x1;
            const cy = w0 * y0 + w1 * c1y + w2 * c2y + w3 * y1;
            const cz = w0 * z0 + w1 * c1z + w2 * c2z + w3 * z1;
            const idx = this._segCount * 6;
            pos[idx] = prevX; pos[idx + 1] = prevY; pos[idx + 2] = prevZ;
            pos[idx + 3] = cx; pos[idx + 4] = cy; pos[idx + 5] = cz;
            col[idx] = cr; col[idx + 1] = cg; col[idx + 2] = cb;
            col[idx + 3] = cr; col[idx + 4] = cg; col[idx + 5] = cb;
            this._segCount++;
            prevX = cx; prevY = cy; prevZ = cz;
        }
    }

    // ============================================================
    //  信号パルス（活動電位）
    // ============================================================

    _spawnPulse(edgeIndex, dir, speed) {
        if (edgeIndex < 0 || edgeIndex >= this.edges.length) return;
        const p = this.plNext;
        this.plEdge[p] = edgeIndex;
        this.plT[p] = 0;
        this.plSpeed[p] = speed;
        this.plDir[p] = dir;
        this.plActive[p] = 1;
        this.plNext = (this.plNext + 1) % this.pulsePool;
    }

    _firePulsesFromNode(i, v) {
        const list = this.adj[i];
        if (!list) return;
        for (let e = 0; e < list.length; e++) {
            const ei = list[e];
            const ed = this.edges[ei];
            if (!this._edgeActive(ed)) continue;
            const dir = (ed.a === i) ? 0 : 1;
            this._spawnPulse(ei, dir, 0.7 + v * 0.9 + this._rand() * 0.4);
        }
    }

    _updatePulses(dt, eBoost) {
        this.pulseAccum += dt * (2.5 + eBoost * 22);
        while (this.pulseAccum >= 1) {
            this.pulseAccum -= 1;
            const e = Math.floor(this._rand() * this.edges.length) % this.edges.length;
            if (!this._edgeActive(this.edges[e])) continue;
            this._spawnPulse(e, this._rand() < 0.5 ? 0 : 1, 0.6 + this._rand() * 0.7);
        }

        const pos = this.pulsePosAttr.array;
        let draw = 0;
        for (let p = 0; p < this.pulsePool; p++) {
            if (!this.plActive[p]) continue;
            this.plT[p] += this.plSpeed[p] * dt;
            if (this.plT[p] >= 1) { this.plActive[p] = 0; continue; }
            const e = this.plEdge[p];
            if (!this._edgeActive(this.edges[e])) { this.plActive[p] = 0; continue; }
            const t = this.plDir[p] ? (1 - this.plT[p]) : this.plT[p];
            const s = this._sampleMain(e, t);
            pos[draw * 3] = s[0]; pos[draw * 3 + 1] = s[1]; pos[draw * 3 + 2] = s[2];
            draw++;
        }
        this.pulsePosAttr.needsUpdate = true;
        this.pulsePoints.geometry.setDrawRange(0, draw);
    }

    // ============================================================
    //  OSC（Scene11の挙動を維持）
    // ============================================================

    handleOSC(message) {
        const trackNumber = message?.trackNumber;
        const args = message?.args || [];
        const velocity = args.length > 1 ? Number(args[1]) : 100;
        const durationMs = args.length > 2 ? Number(args[2]) : 0;
        const v = Math.max(0, Math.min(127, velocity)) / 127;

        if (trackNumber >= 1 && trackNumber <= 12) {
            this.energy = Math.min(2.0, this.energy + 0.25 + v * 0.5);
            this._fireRandomNodes(3 + Math.floor(v * 5), v);
        }

        if (trackNumber === 5) { this._burst(v); return; }
        if (trackNumber === 6) { this._gather(v); return; }
        if (trackNumber === 7) { this._rewire(); return; }
        if (trackNumber === 8) { this.pulseHue = (this.pulseHue + 0.12 + v * 0.25) % 1; return; }

        // track2: 色反転（Scene12と同じ。duration依存ではなく「瞬間フラッシュ」）
        if (trackNumber === 2) {
            if (this.trackEffects[2] && this.colorInversion && this.colorInversion.initialized) {
                if (durationMs === 0 && args.length === 0) {
                    // 引数なしはトグル（キーパッド等）
                    this.colorInversion.setEnabled(!this.colorInversion.isEnabled());
                    this.colorInversion.endTime = 0;
                } else {
                    // ノート受信時は duration を無視して固定の極短時間だけ反転
                    this.colorInversion.apply(velocity, this.track2FlashMs);
                }
            }
            return;
        }

        super.handleOSC(message);
    }

    _fireRandomNodes(count, v) {
        if (!this.nodeFlash) return;
        const n = Math.max(1, this.activeCount);
        for (let c = 0; c < count; c++) {
            const i = Math.floor(this._rand() * n) % n;
            this.nodeFlash[i] = 1.0;
            this._firePulsesFromNode(i, v);
        }
    }

    _burst(v) {
        if (!this.homeX) return;
        const n = this.nodeCount;
        const impulse = 55 + v * 120;
        for (let i = 0; i < n; i++) {
            const d = Math.sqrt(this.homeX[i] ** 2 + this.homeY[i] ** 2 + this.homeZ[i] ** 2) || 1;
            this.dispX[i] += (this.homeX[i] / d) * impulse + (this._rand() - 0.5) * impulse * 0.5;
            this.dispY[i] += (this.homeY[i] / d) * impulse + (this._rand() - 0.5) * impulse * 0.5;
            this.dispZ[i] += (this.homeZ[i] / d) * impulse + (this._rand() - 0.5) * impulse * 0.5;
        }
        this.energy = Math.min(2.0, this.energy + 0.5);
    }

    _gather(v) {
        if (!this.homeX) return;
        const n = this.nodeCount;
        const pull = 50 + v * 100;
        for (let i = 0; i < n; i++) {
            const d = Math.sqrt(this.homeX[i] ** 2 + this.homeY[i] ** 2 + this.homeZ[i] ** 2) || 1;
            this.dispX[i] -= (this.homeX[i] / d) * pull;
            this.dispY[i] -= (this.homeY[i] / d) * pull;
            this.dispZ[i] -= (this.homeZ[i] / d) * pull;
        }
        this.energy = Math.min(2.0, this.energy + 0.4);
    }

    _rewire() {
        if (!this.homeX) return;
        this._seedAnchorPositions();
        this._writeAnchorInstances();
        this._buildTopology();
        this.plActive.fill(0);
        this.energy = Math.min(2.0, this.energy + 0.3);
    }

    // ============================================================
    //  ポスト処理（Scene12から移植）
    // ============================================================

    initPostProcessing() {
        setupPostEffectsPipeline(this, {
            filmGrainIntensity: 0.08,
            filmGrainGrayscale: false,
            dofFocus: 2100,
            dofAperture: 0.0000008,
            dofMaxBlur: 0.0016,
            bloomStrength: 0.11,
            bloomRadius: 0.65,
            bloomThreshold: 0.72
        });
        if (this.filmPass?.uniforms?.uColorNoise) {
            this.filmPass.uniforms.uColorNoise.value = 0.03;
        }
        attachStrobeFlashPass(this);
        this.applyTrackEffectsToPostPasses();
    }

    onResize() {
        super.onResize();
        resizePostEffectsPasses(this);
    }

    // ============================================================
    //  dispose
    // ============================================================

    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        // ---- 部屋・描画（Scene12） ----
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
        if (this.networkKeyLight) {
            this.scene.remove(this.networkKeyLight);
            this.networkKeyLight.dispose?.();
            this.networkKeyLight = null;
        }
        if (this.networkFillLight) {
            this.scene.remove(this.networkFillLight);
            this.networkFillLight.dispose?.();
            this.networkFillLight = null;
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

        // ---- 神経網（Scene11） ----
        const disposeObj = (obj) => {
            if (!obj) return;
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            if (obj.parent) obj.parent.remove(obj);
        };
        if (this.boxGroup) {
            this.boxGroup.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
            if (this.boxGroup.parent) this.boxGroup.parent.remove(this.boxGroup);
            this.boxGroup = null;
        }
        disposeObj(this.nodeMesh);
        disposeObj(this.hubMesh);
        disposeObj(this.anchorMesh);
        disposeObj(this.fiberLines);
        disposeObj(this.pulsePoints);
        if (this.synapseGroup && this.scene) this.scene.remove(this.synapseGroup);
        if (this.glowTexture) this.glowTexture.dispose();
        if (this.fleshTex) {
            this.fleshTex.map?.dispose();
            this.fleshTex.bumpMap?.dispose();
        }

        this.synapseGroup = null;
        this.nodeMesh = this.hubMesh = this.anchorMesh = this.fiberLines = this.pulsePoints = null;
        this.nodeMat = this.anchorMat = null;
        this.glowTexture = null;
        this.fleshTex = null;
        this.fiberPositions = this.fiberColors = null;
        this.pulsePosAttr = null;
        this.edgeMain = null; this.edges = []; this.adj = null;
        this.homeX = this.homeY = this.homeZ = null;
        this.wAmp = this.wSpd = this.wPhX = this.wPhY = this.wPhZ = null;
        this.dispX = this.dispY = this.dispZ = null;
        this.npx = this.npy = this.npz = null;
        this.scaleBase = this.isHub = this.nodeFlash = null;
        this.rotX0 = this.rotY0 = this.rotZ0 = null;
        this.spinX = this.spinY = this.spinZ = null;
        this.apx = this.apy = this.apz = null;
        this.anx = this.any = this.anz = null;
        this.anchorScaleArr = null;
        this.plEdge = this.plT = this.plSpeed = this.plDir = this.plActive = null;

        // 環境マップ・出力パス
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
