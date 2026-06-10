/**
 * Scene09: mathym | Xenofog
 *
 * mavrx4/scene09(data.scan) の「うねりグリッド＋赤い菱形マーカー◇＋コールアウト」を
 * ラボの岩色チャコール立方体（InstancedMesh）へ移植した版。
 *
 * 方針A:
 *  - 11モード運動はやめ、立方体をグリッド格子点に固定配置（1立方体 = 1格子点）。
 *  - 毎フレーム _gridWarp の式で床(XZ平面)をうねらせ、立方体の粒でウネリグリッドを表現。
 *  - 立方体の質感（岩色チャコール・metalness・IBL・回転 updateRotation）はそのまま維持。
 *  - DOF/SSAO/Bloom/Fog/カメラ・track12 の expand エフェクトは維持。
 *  - 赤い印・コールアウトはうねる立方体面（床グリッド）に乗せて追従。
 *
 * OSC:
 *  - track1: 赤い菱形マーカー◇スポーン ＋（trackEffects[1] ON時）カメラランダマイズ
 *  - track5: コールアウト（床の立方体面に投影）
 *  - track12: 立方体の expand エフェクト（維持。handleTrackNumber で処理）
 *  - track2/3/4・/phase・/tick は super.handleOSC に委譲
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
    setupStudioRoomPromoWallFillLight,
    STUDIO_FLOOR_TOP_Y,
    STUDIO_CEILING_Y
} from '../../lib/presentation/index.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { Scene02Particle } from '../scene02/Scene02Particle.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';
export class Scene09 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenofog';
        this.initialized = false;
        this.sceneNumber = 9;
        this.kitNo = 22;
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
        /** 既定は背景色に近い（遠景が背景に溶ける） */
        this.sceneFogColor = 0x000000;
        this.useSSAO = true;
        this.useFilmGrain = true;
        // 被写体（立方体）にピントを合わせる（他シーンと同じ質感）
        this.useAutoFocusDOF = true;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        this.ssaoNearKernelRadius = 9.2;
        this.ssaoNearMinDistance = 0.018;
        this.ssaoNearMaxDistance = 0.165;
        this.ssaoFarAttenuation = 0.62;
        this.outputPass = null;

        this.trackEffects = {
            1: true,
            2: true,
            3: false,
            4: false,
            5: true,
            6: true,
            7: true,
            8: true,
            9: true,
            12: true
        };
        // track2 は色反転エフェクト（ストロボは使わない）。false で SceneBase の色反転分岐に入る。
        this.useTrack2Strobe = false;
        this.setScreenshotText(this.title);

        this.instancedMeshManager = null;
        this.particles = [];
        this.expandSpheres = [];
        this.useWallCollision = false;

        // 撮影用スタジオ（StudioBox：壁・床・天井スポット）。
        // false でスタジオごとオフ（壁・床・光る天井を全部消し、最小ライトだけの空間にする）。
        this.useStudioBox = false;
        this.studio = null;
        this.promoWallLightTarget = null;
        this.promoWallFillLight = null;

        this._tmpV = new THREE.Vector3();
        this._mat = new THREE.Matrix4();
        this._quat = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
        this._centerSmoothed = new THREE.Vector3(0, STUDIO_FLOOR_TOP_Y + 600, 0);
        this._colorTmp = new THREE.Color();

        // ===== うねりグリッド（mavrx4/scene09 data.scan から移植）=====
        // 立方体をグリッド格子点に配置し、毎フレーム _gridWarp で床(XZ平面)をうねらせる。
        // 1立方体 = 1格子点。立方体の岩質感・回転・IBL はそのまま維持。

        // ---- 正面に垂直展開する格子（XY平面の壁）----
        // 立方体が正面に縦の壁を作り、その壁が手前/奥(Z方向)にうねる。
        // StudioBox(部屋 10000角=半径5000、床上面 STUDIO_FLOOR_TOP_Y=-498、天井5500)の中に収める。
        // 横幅は ±4600(部屋±5000内ギリギリ)、縦は床-498から+5102(天井5500内ギリギリ)まで使う。
        this.gridFieldW = 18400.0;    // X方向の広さ（壁の横幅）±9200
        this.gridFieldH = 11200.0;    // Y方向の高さ（壁の縦幅）
        // 壁の下端を床(STUDIO_FLOOR_TOP_Y)に着ける：中心 = 床 + 高さ/2
        this.gridCenterY = STUDIO_FLOOR_TOP_Y + this.gridFieldH * 0.5;
        this.gridCenterZ = 0.0;       // 壁の基準Z（うねりはここを中心に手前/奥へ）
        this.gridCols = 100;          // X方向の格子点数
        this.gridRows = 100;          // Y方向の格子点数
        this.sphereCount = this.gridCols * this.gridRows;   // 立方体数＝格子点数（10000）

        // 各立方体の基準座標（うねり計算の元）。i番目 → (baseX, baseY)
        this.gridBaseX = null;        // Float32Array(sphereCount)
        this.gridBaseY = null;        // Float32Array(sphereCount)

        // クラスタリング/スナップ用にグリッド密度の別名を保持
        this.gridFineCols = this.gridCols * 2;
        this.gridFineRows = this.gridRows * 2;
        this.gridCoarseCols = this.gridCols;
        this.gridCoarseRows = this.gridRows;

        // グリッドうねりの音反応レベル（expandやtrackで増幅）
        this.gridWarpLevel = 0.0;

        // ===== track10: Z方向の押し出しパルス（衝撃波）=====
        // 常時うねりはやめ、track10 が来た時だけ壁(XY平面)の一点をランダムにZ方向へ
        // 押し出し、しばらくしてゆっくり戻る。グリッドも波形もこの押し出しに乗る。
        //  - velocity = 押し出しの強さ（Z変位の大きさ）
        //  - duration = 影響範囲の広さ（押し出しが及ぶ半径）
        //  - 方向 = 前後どちらかランダム（手前 Z+ / 奥 Z-）
        this.warpPulses = [];          // { x, y, dir, amp, radius, life, maxLife }[]
        this.warpPulseMax = 16;        // 同時アクティブ上限（古いものから消す）
        this.implodePulses = [];       // track9: XYZ引き込みパルス { x, y, amp, radius, life, maxLife }[]
        this.implodePulseMax = 8;
        this.pulseAmpMin = 200.0;      // velocity=0 の押し出し量
        this.pulseAmpMax = 2200.0;     // velocity=127 の押し出し量
        this.pulseRadiusMin = 1200.0;  // duration 0 の影響半径
        this.pulseRadiusPerSec = 5000.0; // duration 1秒あたり広がる半径
        this.pulseDecay = 0.9;         // 戻りの速さ（小さいほどゆっくり戻る）
        // 待機時のごく僅かな呼吸（完全静止だと寂しいので微揺れ）
        this.idleBreathAmp = 22.0;     // 待機時のZ微揺れ振幅

        // 形状モーフィング
        // 0:FLAT 1:SPHERE 2:CYLINDER 3:WAVE 4:TORUS — 24小節(9216ticks)ごとに遷移
        this.morphShapes = ['FLAT', 'SPHERE', 'CYLINDER', 'WAVE', 'TORUS'];
        this.morphCurrentIdx = 0;
        this.morphNextIdx = 1;
        this.morphT = 0.0;            // 0→1 で現形状→次形状へ補間
        this.morphTicksPerShape = 9216; // 24小節
        this.morphRadius = Math.min(this.gridFieldW, this.gridFieldH) * 0.42; // 球・シリンダー半径

        // ===== トラック別オシロ波形（mavrx4/scene09 から移植）=====
        // 1トラック=1本、最大12本をグリッドの上空に重ねる。ヒートマップ色のTube(蛇)。
        // 左壁(X=-4600)から右壁(X=+4600)まで部屋(10000角=半径5000)を横断する幅（壁から出てる感）
        // 壁グリッド幅(9200)に合わせて、波形も壁端から出るように揃える。
        this.waveFieldW = this.gridFieldW; // 波形の横幅（グリッドに合わせる）
        this.waveCenterY = this.gridCenterY;   // 波形をグリッドのど真ん中の高さに浮かべる
        this.trackCount = 12;         // track1〜12
        this.waveSegments = 160;      // 1本あたりの分解能（Tube生成用）
        this.waveLines = [];          // THREE.Mesh[]（Tube。index = track-1）
        this.wavePositions = [];      // Float32Array[]（波形の点列）
        this.waveTubeRadius = 6.0;    // チューブの太さ（床スケールに合わせて太め）
        this._waveCurvePts = [];      // 毎フレーム使い回す Vector3 配列（GC削減）
        this.wavePhase = 0.0;
        this.trackVoice = [];         // {env, freq, amp, decay, phase}[]
        this.busLevel = 0.0;          // 全トラックの鳴り合計

        // ---- track5: コールアウト ----
        this.calloutReady = false;
        this.calloutTextTick = 0;
        this.calloutTextInterval = 0.05;  // 表示中ずっと矢継ぎ早に流れる差し替え間隔

        // ---- track1: 赤い菱形マーカー◇（床グリッド上に積み上げ式）----
        this.crossMax = 256;
        this.crossGroup = null;
        this.crossPool = [];
        this._crossNext = 0;
        this.crossSize = 80;          // 菱形の半径

        // ---- track8: 波形の中心を貫く X軸シリンダー（duration=長さ / velocity=色と太さ）----
        // 波形群は Y=gridCenterY・Z≒0 を中心に左右(X)へ走る。その中心軸を串刺しにする横棒。
        this.track8Cylinders = [];    // { mesh, life, maxLife }[]（寿命で消す）
        this.track8MaxCount = 8;      // 同時発射の上限（古いものから消す）
        this.track8RadiusMin = 8.0;   // velocity=0 のときの太さ
        this.track8RadiusMax = 90.0;  // velocity=127 のときの太さ
        this.track8LenMin = 1200.0;   // duration 0 のときの最低長さ
        this.track8LenPerSec = 6000.0;// duration 1秒あたり伸びる長さ

        // ---- track8: グリッドパーティクルのスケールブースト（パーティクルごとの影響量）----
        this._cubeBoostMap = null;    // Float32Array (sphereCount) — 初期化は createSpheres 後
        this._cubeBoostDecay = 2.2;   // 1秒あたりの減衰速度
        this._cubeBoostRadius = Math.min(this.gridFieldW, this.gridFieldH) * 0.28; // 影響半径

        // ---- イベント間隔クラスタリング（短い間隔ほど前回位置の近くに出す）----
        this.lastEvtTime = {};
        this.lastEvtPos = {};
        this.clusterFarTime = 0.6;

        // ---- 擬似乱数（離散更新用シード）----
        this.seed = 0x9e3779b9 | 0;
        this._warpScratch = { x: 0, y: 0, z: 0 };
        this._scaleScratch = new THREE.Vector3();
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

    /** 壁を照らすフィルライト。Scene11 流に強度を抑えて「暗い部屋＋蛍光灯主役」にする。 */
    setupLights() {
        const { promoWallLightTarget, promoWallFillLight } = setupStudioRoomPromoWallFillLight(this.scene, {
            ceilingY: STUDIO_CEILING_Y
        });
        this.promoWallLightTarget = promoWallLightTarget;
        this.promoWallFillLight = promoWallFillLight;
        // 壁フィルを抑えて蛍光灯(45.0)を主光源に立たせる（明るすぎ防止。Scene11 と同方向）
        if (this.promoWallFillLight) this.promoWallFillLight.intensity *= 0.6;
    }

    /**
     * StudioBox（部屋＝壁・床）＋天井スポットリグ。
     * Scene11 と同系で「暗い部屋＋4隅の蛍光灯を強く光らせる」設定にする。
     */
    createStudioBox() {
        const L = this.sceneLightingScale;
        const studioOpts = {
            ...studioBoxOptionsForStudioRoom(L, this._roomEnvTexture),
            // 部屋はデフォルトサイズ(10000角)。オブジェクト側を部屋に収まるスケールにする。
            // 部屋全体を暗く（環境光を絞る）
            ambientIntensity: 0.015,
            // studioBox 本来のライト強度を抑える（Scene11 と同様。明るすぎ防止）
            lightIntensity: Math.max(3.0, 3.5 * L),
            // 4隅の蛍光灯を強く発光させて主光源にする（Scene11 と同様）
            fluorescentPointIntensity: 45.0,
            fluorescentPointDecay: 1.2
        };
        this.studio = new StudioBox(this.scene, studioOpts);
        // StudioBox 本体の「天井プレーン」が emissive で光る（StudioBox.js: 面マテリアル[2]）。
        // Scene11 は studioBox.visible=false で箱ごと隠すが、scene09 は壁・床を使うので
        // 天井マテリアルだけ自発光をオフにして「明るい天井」を消す（壁・床は残す）。
        const boxMats = this.studio.studioBox?.material;
        if (Array.isArray(boxMats) && boxMats[2]) {
            boxMats[2].emissive?.setRGB(0, 0, 0);
            boxMats[2].emissiveIntensity = 0.0;
            boxMats[2].needsUpdate = true;
        }
        // 天井スポットの自発光・照り返しキースポットを殺して、蛍光灯だけを主光源にする（Scene11 流）。
        const ceilBase = ceilingSpotRigOptionsForStudioRoom(L);
        this.studio.attachCeilingSpotRig(this.studio.studioBox, {
            includeCeilingPlane: false,
            ...ceilBase,
            emissiveIntensity: 0.0,   // 天井ライトの自発光オフ
            shadowDebugSpot: {
                ...ceilBase.shadowDebugSpot,
                intensity: 0.0        // 照り返しキースポットもオフ（部屋を明るくしてた主犯）
            }
        });
    }

    /**
     * チャコールグレー〜黒寄りのランダム（岩・鉱物っぽい微妙な色相ブレ）
     * @param {THREE.Color} out
     */
    _setRandomRockCharcoalColor(out) {
        const l = 0.07 + Math.random() * 0.26;
        const s = 0.015 + Math.random() * 0.09;
        const h = 0.52 + (Math.random() - 0.5) * 0.1;
        out.setHSL(h, s, l);
        out.offsetHSL((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.05);
        out.r += (Math.random() - 0.5) * 0.035;
        out.g += (Math.random() - 0.5) * 0.035;
        out.b += (Math.random() - 0.5) * 0.04;
        out.r = THREE.MathUtils.clamp(out.r, 0.02, 0.42);
        out.g = THREE.MathUtils.clamp(out.g, 0.02, 0.42);
        out.b = THREE.MathUtils.clamp(out.b, 0.02, 0.45);
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

    /**
     * 立方体をグリッド格子点に配置する（方針A・垂直壁版）。
     * 各立方体の基準座標(baseX, baseY)を gridBaseX/gridBaseY に保持し、
     * 毎フレーム _gridWarp で正面の壁(XY平面)を手前/奥(Z)へうねらせる。
     */
    createSpheres() {
        const cols = this.gridCols;
        const rows = this.gridRows;
        const n = this.sphereCount;

        const geo = new THREE.BoxGeometry(1, 1, 1);
        {
            const nv = geo.attributes.position.count;
            const white = new Float32Array(nv * 3);
            white.fill(1);
            geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
        }
        const textures = this.generateFleshTextures();
        /** チャコール色は頂点色、金属感は metalness + IBL（暗色メタル鉱石寄り） */
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            map: textures.map,
            bumpMap: textures.bumpMap,
            bumpScale: 0.34,
            roughness: 0.35,
            metalness: 0.68,
            clearcoat: 0.28,
            clearcoatRoughness: 0.32,
            envMapIntensity: 1.75,
            specularIntensity: 1.1,
            fog: true,
            vertexColors: true
        });
        if (this.scene?.environment) mat.envMap = this.scene.environment;

        this.instancedMeshManager = new InstancedMeshManager(this.scene, geo, mat, n);
        const mainMesh = this.instancedMeshManager.getMainMesh();
        mainMesh.castShadow = false;
        mainMesh.receiveShadow = false;

        this.gridBaseX = new Float32Array(n);
        this.gridBaseY = new Float32Array(n);

        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;

        let i = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // 格子点のXY座標（正面の壁。横=X、縦=Y、中央原点）
                const bx = -hw + (this.gridFieldW * c) / (cols - 1);
                const by = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
                this.gridBaseX[i] = bx;
                this.gridBaseY[i] = by;

                // 立方体サイズ（岩の欠片らしくランダム）。部屋スケールに対して粒を小さめに。
                let worldR;
                const sizeRand = Math.random();
                if (sizeRand < 0.7) worldR = 20 + Math.random() * 20;
                else if (sizeRand < 0.95) worldR = 40 + Math.random() * 30;
                else worldR = 65 + Math.random() * 35;

                const scale = new THREE.Vector3(worldR, worldR, worldR);
                const radius = Math.max(scale.x, scale.y, scale.z) * 0.5;
                const p = new Scene02Particle(bx, by, this.gridCenterZ, radius, scale);
                p.angularVelocity.multiplyScalar(2.0);
                this.particles.push(p);

                this._setRandomRockCharcoalColor(this._colorTmp);
                this.instancedMeshManager.setColorAt(i, this._colorTmp);
                this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
                i++;
            }
        }
        this.instancedMeshManager.markColorsNeedsUpdate();
        this.instancedMeshManager.markNeedsUpdate();
        this.setParticleCount(n);

        // track8 ブーストマップ（各パーティクルの現在ブースト量。0=等倍）
        this._cubeBoostMap = new Float32Array(n);
    }

    createGridLines() {
        const cols = this.gridCols;
        const rows = this.gridRows;
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const stride = 1; // 全格子線を引く

        // セグメント対応表（bx/byペア）
        this._gridLineSegs = [];
        for (let r = 0; r < rows; r += stride) {
            for (let c = 0; c < cols - 1; c++) {
                const bx0 = -hw + (this.gridFieldW * c) / (cols - 1);
                const bx1 = -hw + (this.gridFieldW * (c + 1)) / (cols - 1);
                const by = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
                this._gridLineSegs.push({ ax: bx0, ay: by, bx: bx1, by });
            }
        }
        for (let c = 0; c < cols; c += stride) {
            for (let r = 0; r < rows - 1; r++) {
                const bx = -hw + (this.gridFieldW * c) / (cols - 1);
                const by0 = this.gridCenterY - hh + (this.gridFieldH * r) / (rows - 1);
                const by1 = this.gridCenterY - hh + (this.gridFieldH * (r + 1)) / (rows - 1);
                this._gridLineSegs.push({ ax: bx, ay: by0, bx: bx, by: by1 });
            }
        }

        const maxSegs = this._gridLineSegs.length;
        const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1);
        this._gridLineMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0.7,
            roughness: 0.2,
        });
        this._gridLineMesh = new THREE.InstancedMesh(cylGeo, this._gridLineMat, maxSegs);
        this._gridLineMesh.count = maxSegs;
        this._gridLineMesh.frustumCulled = false;
        this._gridLineMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxSegs * 3), 3);
        this.scene.add(this._gridLineMesh);
        this._gridLineDummy = new THREE.Object3D();
        this._gridLineUp = new THREE.Vector3(0, 1, 0);
        this._gridLineCol = { r: 0, g: 0, b: 0 };
        this._gridLineColorTmp = new THREE.Color();
    }

    _updateGridLines() {
        if (!this._gridLineMesh || !this._gridLineSegs) return;
        const t = this.time;
        const amp = this._warpAmp();
        const dummy = this._gridLineDummy;
        const up = this._gridLineUp;
        const tmp0 = { x: 0, y: 0, z: 0 };
        const tmp1 = { x: 0, y: 0, z: 0 };
        const radius = 6.0; // シリンダーの太さ

        const heatMax = this.pulseAmpMax * 2.0;
        const col = this._gridLineCol;
        const colorTmp = this._gridLineColorTmp;

        for (let i = 0; i < this._gridLineSegs.length; i++) {
            const seg = this._gridLineSegs[i];
            this._gridWarp(seg.ax, seg.ay, amp, t, tmp0);
            this._gridWarp(seg.bx, seg.by, amp, t, tmp1);
            const dx = tmp1.x - tmp0.x, dy = tmp1.y - tmp0.y, dz = tmp1.z - tmp0.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
            dummy.position.set((tmp0.x + tmp1.x) * 0.5, (tmp0.y + tmp1.y) * 0.5, (tmp0.z + tmp1.z) * 0.5);
            dummy.quaternion.setFromUnitVectors(up, new THREE.Vector3(dx / dist, dy / dist, dz / dist));
            dummy.scale.set(radius, dist, radius);
            dummy.updateMatrix();
            this._gridLineMesh.setMatrixAt(i, dummy.matrix);
            // 端点のZ変位量（実変位ベース）でヒートマップ色を決定
            const dispZ = Math.abs(((tmp0.z + tmp1.z) * 0.5) - this.gridCenterZ);
            this._heatmapColor(dispZ / heatMax, col);
            colorTmp.setRGB(col.r, col.g, col.b);
            this._gridLineMesh.setColorAt(i, colorTmp);
        }
        this._gridLineMesh.instanceMatrix.needsUpdate = true;
        this._gridLineMesh.instanceColor.needsUpdate = true;
    }

    /** 現在の歪み強度（常時ゆるく + 鳴ってる時に増幅）。グリッドと赤い印で共有 */
    _warpAmp() {
        // 床スケール(9000)に合わせて大きめ。expand等で gridWarpLevel が乗る
        return 120 + this.gridWarpLevel * 220;
    }

    /**
     * track10: Z方向の押し出しパルス（衝撃波）を1発生成する。
     *  - velocity = 押し出しの強さ（Z変位の大きさ）
     *  - durationMs = 影響範囲の広さ（押し出しが及ぶ半径）
     *  - 方向 = 前後どちらかランダム（手前 Z+ / 奥 Z-）
     * 発生後はゆっくり減衰して壁が元の平らな状態に戻る。
     */
    _fireWarpPulse(velocity, durationMs) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const durSec = durationMs > 0 ? durationMs / 1000 : 0.6;
        // 発生位置：壁面上のランダムな一点
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const x = -hw + this._rand() * this.gridFieldW;
        const y = (this.gridCenterY - hh) + this._rand() * this.gridFieldH;
        // 方向：前後どちらかランダム（手前 Z+ / 奥 Z-）
        const dir = this._rand() < 0.5 ? 1 : -1;
        // 強さ：velocity で補間 / 範囲：duration に比例
        const amp = this.pulseAmpMin + (this.pulseAmpMax - this.pulseAmpMin) * v;
        const radius = this.pulseRadiusMin + this.pulseRadiusPerSec * durSec;
        // 寿命：押し出し量が大きいほど少しだけ長く残す（最低でも少し残る）
        const maxLife = 0.9 + durSec * 0.6 + v * 0.8;

        this.warpPulses.push({ x, y, dir, amp, radius, life: maxLife, maxLife });
        while (this.warpPulses.length > this.warpPulseMax) this.warpPulses.shift();
    }

    /** track10 パルスを毎フレーム減衰させる（ゆっくり戻る）。 */
    _updateWarpPulses(dt) {
        if (!this.warpPulses.length) return;
        for (let i = this.warpPulses.length - 1; i >= 0; i--) {
            const p = this.warpPulses[i];
            p.life -= dt;
            if (p.life <= 0) this.warpPulses.splice(i, 1);
        }
    }

    /**
     * 指定点(bx, by)における track10 パルス由来のZ押し出し量を合算して返す。
     * 各パルスはガウシアン分布（中心が一番強く、radius で減衰）＋寿命エンベロープ。
     * @param {number} bx 基準X / @param {number} by 基準Y
     * @returns {number} Z方向の押し出し量（前後どちらかランダムな符号込み）
     */
    _pulseZ(bx, by) {
        const pulses = this.warpPulses;
        if (!pulses.length) return 0;
        let z = 0;
        for (let i = 0; i < pulses.length; i++) {
            const p = pulses[i];
            const dx = bx - p.x;
            const dy = by - p.y;
            const d2 = dx * dx + dy * dy;
            // ガウシアン：中心が一番強く、radius で滑らかに減衰
            const falloff = Math.exp(-d2 / (p.radius * p.radius));
            if (falloff < 0.002) continue;
            // 寿命エンベロープ：立ち上がりは速く、戻りはゆっくり（イーズアウト）
            const k = p.life / p.maxLife;            // 1(発生)→0(消滅)
            const env = k * k;                        // 二乗でゆっくり戻る
            z += p.dir * p.amp * falloff * env;
        }
        return z;
    }

    // 正規化されたグリッド座標(nx: -1〜1, ny: -1〜1)から形状オフセット{dx,dy,dz}を計算
    _morphOffset(shape, nx, ny, bx, by) {
        const R = this.morphRadius;
        switch (shape) {
            case 'FLAT':
                return { dx: 0, dy: 0, dz: 0 };
            case 'SPHERE': {
                // 球面マッピング（nx/nyを経度/緯度に）
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
        // smoothstep で滑らかに補間
        const t = this.morphT * this.morphT * (3 - 2 * this.morphT);
        return {
            dx: a.dx + (b.dx - a.dx) * t,
            dy: a.dy + (b.dy - a.dy) * t,
            dz: a.dz + (b.dz - a.dz) * t,
        };
    }

    _updateMorph() {
        const totalTicks = this.morphShapes.length * this.morphTicksPerShape; // 46080
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

    // 指定点(bx, by)における implodePulse 由来のXYZ変位を out に加算する
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
            // XY：中心に向かって引き込む
            const dist = Math.sqrt(d2) || 1;
            out.x -= (dx / dist) * str * 0.5;
            out.y -= (dy / dist) * str * 0.5;
            // Z：奥(Z-)にへこむ
            out.z -= str;
        }
    }

    /**
     * うねりの変位を計算（_updateGridCubes と赤い印で共有）・垂直壁版。
     * 常時うねりはやめ、基本は平らな壁。track10 のパルス(_pulseZ)で局所的に
     * 手前/奥(Z)へ押し出され、しばらくしてゆっくり戻る。
     * 待機時はごく僅かに呼吸（idleBreathAmp）させて生き物感を残す。
     * 同じ式を使うことで、赤い印・波形・シリンダーが押し出される壁にピタッと乗る。
     * @param {number} bx 基準X / @param {number} by 基準Y
     * @param {number} amp うねり強度（_warpAmp。待機微揺れの増幅に使用） / @param {number} t 時刻
     * @param {{x:number,y:number,z:number}} out 結果（ワールド座標）を書き込むスクラッチ
     */
    _gridWarp(bx, by, amp, t, out) {
        // 横・縦はほぼ動かさない（壁の格子感を保つ）。待機時のごく僅かな呼吸だけ。
        const breath = this.idleBreathAmp;
        // 形状モーフィングオフセット
        const m = this._getMorphOffset(bx, by);
        out.x = bx + m.dx + Math.sin(bx * 0.0009 + by * 0.0007 + t * 0.5) * breath;
        out.y = by + m.dy + Math.cos(by * 0.0009 - bx * 0.0007 + t * 0.6) * breath;
        // Z：待機時のごく僅かな呼吸 ＋ track10 パルスの押し出し ＋ モーフZ
        const idleZ = Math.sin(bx * 0.0011 - by * 0.0009 + t * 0.7) * breath;
        out.z = this.gridCenterZ + idleZ + this._pulseZ(bx, by) + m.dz;
        // track9: XYZ引き込み（へこみ）
        this._implodeXYZ(bx, by, out);
        return out;
    }

    /**
     * グリッド立方体を毎フレーム更新：各立方体を _gridWarp の結果へ移動し、回転は維持。
     */
    // Z変位量(0〜1)をヒートマップ色(青→シアン→緑→黄→赤)に変換
    _heatmapColor(t, out) {
        const v = Math.max(0, Math.min(1, t));
        if (v < 0.25) {
            const s = v / 0.25;
            out.r = 0; out.g = s; out.b = 1;
        } else if (v < 0.5) {
            const s = (v - 0.25) / 0.25;
            out.r = 0; out.g = 1; out.b = 1 - s;
        } else if (v < 0.75) {
            const s = (v - 0.5) / 0.25;
            out.r = s; out.g = 1; out.b = 0;
        } else {
            const s = (v - 0.75) / 0.25;
            out.r = 1; out.g = 1 - s; out.b = 0;
        }
    }

    _updateGridCubes(dt) {
        if (!this.instancedMeshManager || !this.gridBaseX) return;
        const t = this.time;
        const amp = this._warpAmp();
        const n = this.particles.length;
        const w = this._warpScratch;
        const bm = this._cubeBoostMap;
        const decay = this._cubeBoostDecay * dt;

        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            const bx = this.gridBaseX[i], by = this.gridBaseY[i];
            this._gridWarp(bx, by, amp, t, w);
            p.position.set(w.x, w.y, w.z);
            p.updateRotation(dt);

            // track8 ブースト：個別減衰 → スケールに掛ける（bm[i]=0 なら等倍）
            if (bm && bm[i] > 0) {
                bm[i] = Math.max(0, bm[i] - decay);
                this._scaleScratch.copy(p.scale).multiplyScalar(1.0 + bm[i]);
                this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, this._scaleScratch);
            } else {
                this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
            }
        }
        this.instancedMeshManager.markNeedsUpdate();
    }

    /**
     * 赤い菱形マーカー◆をうねる壁に追従させる（X/Y/Zすべて壁と同じ歪みに乗せる）。
     * 各マーカーは _spawnCross で基準座標(baseX/baseY)を保持しているので、毎フレーム
     * グリッドと同じ式で変位を計算して位置を更新する。
     */
    _updateCrossesOnGround(dt = 0.016) {
        if (!this.crossPool.length) return;
        const t = this.time;
        const amp = this._warpAmp();
        const w = this._warpScratch;
        for (const cross of this.crossPool) {
            if (!cross.visible || cross.userData.baseX === undefined) continue;
            this._gridWarp(cross.userData.baseX, cross.userData.baseY, amp, t, w);
            // 壁面のすぐ手前(カメラ側=Z+)に浮かせる
            cross.position.set(w.x, w.y, w.z + 120);
            // ゆっくり自転させて立体の反射を効かせる
            const spin = cross.userData.spin || 0.4;
            cross.rotation.y += spin * dt;
            cross.rotation.x += spin * 0.4 * dt;
        }
    }

    triggerExpandEffect(velocity = 127) {
        const vFactor = velocity / 127.0;

        // gridWarpLevel を一時的に増幅（音に合わせて全体が盛り上がる）
        this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + vFactor * 1.5);

        // 中央付近に強いZ押し出しパルスを複数発射（手前に膨らむ）
        const pulseCount = 3;
        const hw = this.gridFieldW * 0.3;
        const hh = this.gridFieldH * 0.3;
        for (let i = 0; i < pulseCount; i++) {
            const x = (Math.random() - 0.5) * hw * 2;
            const y = this.gridCenterY + (Math.random() - 0.5) * hh * 2;
            // 強さ：velocity フル換算、範囲は短く絞る（duration=200ms相当）
            const v = vFactor;
            const amp = (this.pulseAmpMin + (this.pulseAmpMax - this.pulseAmpMin) * v) * 2.0;
            const durSec = 0.05;
            const radius = this.pulseRadiusMin + this.pulseRadiusPerSec * durSec;
            const maxLife = 2.0 + v * 1.5;
            // 手前固定（Z+方向）
            this.warpPulses.push({ x, y, dir: 1, amp, radius, life: maxLife, maxLife });
            while (this.warpPulses.length > this.warpPulseMax) this.warpPulses.shift();
        }
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
            p.minDistance = 8000;
            p.maxDistance = 20000;
            p.boxMin = null;
            p.boxMax = null;
            p.maxSpeed = 8.0;
        });
        // 壁を正面〜斜め前から見る（裏や真上に回り込まない）。
        const dist = 8000 + Math.random() * 12000;    // 8000〜20000
        const yaw = (Math.random() - 0.5) * Math.PI * 0.55;   // 左右に±約50度
        const pitch = (Math.random() - 0.1) * 0.5;            // ほぼ水平〜やや見下ろし
        cp.position.set(
            Math.sin(yaw) * Math.cos(pitch) * dist,
            this.gridCenterY + Math.sin(pitch) * dist,
            Math.cos(yaw) * Math.cos(pitch) * dist          // 常に手前(Z+)側
        );
        cp.applyRandomForce?.();
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.useSSAO = false;

        // 他シーン(Scene02/Scene10)と質感を合わせる：影あり＋PCFSoft
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });

        // スタジオ(部屋)はオフ。距離制約が無いので、巨大グリッド全体を引きで映す。
        this.camera.fov = 42;
        this.camera.near = 12;
        this.camera.far = 200000;  // 大きく引いた分、奥までクリップしないよう延長
        this.camera.updateProjectionMatrix();
        // 横9200×縦5600のグリッド全体が画角に収まるよう引く（やや寄せ気味）。
        this.camera.position.set(0, this.gridCenterY, 8500);
        this.camera.lookAt(0, this.gridCenterY, 0);
        this._centerSmoothed.set(0, this.gridCenterY, this.gridCenterZ);

        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;

        if (this.useStudioBox) {
            // StudioBox 本来のライティング（濃い影・キースポットのコントラスト）を活かす。
            // この場合 setupMinimalParticleLights() は呼ばない（影が薄れて質感がズレる）。
            this.setupLights();
            this.createStudioBox();
        } else {
            // 部屋オフ：StudioBox のライトが無くなるので最小ライトで照らす。
            this.setupMinimalParticleLights();
        }

        this.createSpheres();
        this._applyEnvMapToSphereMaterial();
        this.createGridLines();

        // チリパーティクル＋3DノイズFBMフォグ（オフ）
        // this.atmosphere = new StudioAtmosphere(this.scene, { ... });

        // ---- コールアウト（3Dワールドに浮かぶ立体ラベル）----
        if (this.calloutSystem) {
            this.calloutSystem.setScene(this.scene);
            this.calloutSystem.setUse3DCallouts(true);
            this.calloutSystem.setLabels([
                'SCAN_ID: 0x09', 'FREQ: 440.0Hz', 'AMP: -6.0dB', 'SYNC: LOCKED',
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

        this.setupCameraParticleDistances();
        this.initPostProcessing();
        this.initialized = true;
    }

    /** 決定論的PRNG（xorshift） */
    _rand() {
        let x = this.seed | 0;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        this.seed = x;
        return ((x >>> 0) % 1000000) / 1000000;
    }

    /** ヒートマップ色（t: 0=青 → シアン → 緑 → 黄 → 赤=1） */
    _heatColor(t) {
        t = Math.max(0, Math.min(1, t));
        const stops = [
            [0.0, 0.0, 1.0], // 青
            [0.0, 1.0, 1.0], // シアン
            [0.0, 1.0, 0.0], // 緑
            [1.0, 1.0, 0.0], // 黄
            [1.0, 0.0, 0.0], // 赤
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

    /**
     * トラック別波形：1トラック=1本、最大12本をグリッドの上空(waveCenterY)に重ねる。
     * 細いTubeGeometryで3D化＝蛇のような波形。色はヒートマップ(track1=青…track12=赤)。
     */
    _buildWaves() {
        const hw = this.waveFieldW * 0.5;
        const n = this.waveSegments;

        this._waveCurvePts = [];
        for (let i = 0; i < n; i++) this._waveCurvePts.push(new THREE.Vector3());

        // 波形の基準X座標（モーフィングでXが変わっても元のグリッドX参照用）
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
                blending: THREE.AdditiveBlending,  // 重なると明るく（ヒートマップ感）
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

    /**
     * track8: 波形の中心(Y=gridCenterY, Z=0)を貫く X軸シリンダーを発射する。
     *  - duration（durationMs）= シリンダーの長さ
     *  - velocity = 色（ヒートマップ青→赤）と太さ（半径）
     * 寿命(duration)経過でフェードアウトして消える。
     */
    _fireTrack8Cylinder(velocity, durationMs) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;

        // 太さ：velocity で補間
        const radius = this.track8RadiusMin + (this.track8RadiusMax - this.track8RadiusMin) * v;
        // 長さ：duration（秒）に比例（最低長さ＋秒あたり伸び）
        const durSec = durationMs > 0 ? durationMs / 1000 : 0.6;
        const length = this.track8LenMin + this.track8LenPerSec * durSec;
        // 色：velocity をヒートマップ（弱い=青→強い=赤）
        const color = this._heatColor(v);

        // Tube方式で作る（グリッドと同じうねりに乗せて曲げるため。直線シリンダーでは曲げられない）
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        this.scene.add(mesh);

        // 寿命は duration（最低でも少し残す）。走行は寿命に合わせて左→右へ進める。
        const maxLife = Math.max(0.5, durSec);
        const c = {
            mesh,
            life: maxLife,
            maxLife,
            radius,
            length,
            phase: this._rand() * 100,   // 独自うねりの位相（本ごとにずらす）
        };
        this.track8Cylinders.push(c);
        this._rebuildTrack8Geometry(c);  // 初期形状

        // 上限を超えたら古いものから消す
        while (this.track8Cylinders.length > this.track8MaxCount) {
            const old = this.track8Cylinders.shift();
            this._disposeTrack8Cylinder(old);
        }
    }

    /**
     * track8 シリンダー1本の Tube ジオメトリを現在の走行位置・うねりで作り直す。
     * 各点を _gridWarp（グリッドと同じうねり）に乗せ、さらに独自のうねりを足す。
     */
    _rebuildTrack8Geometry(c) {
        const SEG = 40;                                 // Tube 分解能
        const half = c.length * 0.5;
        // 走行：progress 0→1 で中心Xが左端(-fieldHalf)→右端(+fieldHalf)へ動く
        const fieldHalf = this.waveFieldW * 0.5;
        const progress = 1 - c.life / c.maxLife;        // 0(発射)→1(消滅)
        const centerX = -fieldHalf + this.waveFieldW * progress;
        const amp = this._warpAmp();
        const t = this.time;
        const w = this._warpScratch;

        const pts = [];
        for (let i = 0; i < SEG; i++) {
            const s = i / (SEG - 1);                     // 0→1（シリンダーに沿って）
            const x = centerX - half + c.length * s;    // 中心Xを基準に左右へ伸ばす
            // グリッドと同じうねり（波形中心の高さ gridCenterY 上で評価）
            this._gridWarp(x, this.gridCenterY, amp, t, w);
            // 独自のうねりを Z に上乗せ（グリッドうねり＋独自うねり）
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

    /** track8 シリンダーを毎フレーム：左→右へ走らせ、うねらせ、寿命で消す。 */
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
            // 走行＋うねりを反映してジオメトリを作り直す
            this._rebuildTrack8Geometry(c);
            // 寿命の後半でフェードアウト
            const tt = c.life / c.maxLife;                // 1→0
            c.mesh.material.opacity = 0.95 * Math.min(1, tt * 1.6);
        }
    }

    /** track8 シリンダー1本の破棄（geo/mat 解放＋シーンから除去）。 */
    _disposeTrack8Cylinder(c) {
        if (!c?.mesh) return;
        this.scene.remove(c.mesh);
        c.mesh.geometry?.dispose();
        c.mesh.material?.dispose();
    }

    /** 波形点列(Float32Array) から TubeGeometry を作る */
    _buildTubeGeometry(pos) {
        const n = this.waveSegments;
        for (let i = 0; i < n; i++) {
            this._waveCurvePts[i].set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        }
        const curve = new THREE.CatmullRomCurve3(this._waveCurvePts, false, 'catmullrom', 0.5);
        return new THREE.TubeGeometry(curve, n - 1, this.waveTubeRadius, 8, false);
    }

    /**
     * トラックイベントでそのトラックの波形を発音させる（オーディオリアクティブの核）。
     */
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

    /**
     * トラック別波形を毎フレーム更新：各トラックのエンベロープを減衰させ、
     * 鳴ってる波形ほど大きく不透明に。Tubeを作り直して蛇のようにくねらせる。
     */
    _updateWaves(dt) {
        if (!this.waveLines.length) return;
        this.wavePhase += dt;
        const maxSpan = 700;   // 波形の最大振れ幅（床スケールに合わせて大きめ）
        let bus = 0.0;

        for (let w = 0; w < this.trackCount; w++) {
            const pos = this.wavePositions[w];
            const line = this.waveLines[w];
            const vo = this.trackVoice[w];
            const n = this.waveSegments;

            vo.env *= Math.exp(-vo.decay * dt);
            vo.phase += vo.freq * dt;
            bus += vo.env;

            const idle = 18;   // 鳴ってない時のうっすら揺れ
            const amp = idle + vo.env * maxSpan;
            line.material.opacity = 0.18 + Math.min(0.8, vo.env) * 0.8;

            const baseZ = (w - this.trackCount / 2) * 40;
            // 周波数を抑えて山数を減らし、なめらかな大きいうねりにする
            const sFreq = 0.6 + (vo.freq - 1.0) * 0.45;   // 元の約半分の周波数
            // ---- 前後(Z)うねり：グリッドの _gridWarp と同じ大うねりをベースに乗せる ----
            // track8 シリンダー(_rebuildTrack8Geometry)と同じ発想で、グリッドのZ波を共有し、
            // その上に波形ごとの小さなゆらぎ(jitter)を足して「大体は揃うが各波形ごとにゆれる」。
            const warpAmp = this._warpAmp();              // グリッドと同じうねり強度
            const jitterAmp = 90 + this.busLevel * 120;   // 波形ごとの独自ゆらぎ（鳴ると増幅）
            const jPhase = this.time * 0.6 + w * 0.7;     // 波形ごとに位相をずらす
            const ww = this._warpScratch;
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                // ゆっくりした位相うねり（高周波成分は抑える）
                const organic =
                    Math.sin(t * 1.6 + this.time * 0.5 + w) * 0.30 +
                    Math.sin(t * 0.9 - this.time * 0.35 + w * 0.7) * 0.18;
                // 基音のみで構成（高周波の倍音は弱めて滑らかに）
                const wv =
                    Math.sin((t * sFreq + vo.phase + organic) * Math.PI * 2) * 0.92 +
                    Math.sin((t * sFreq * 2.0 + vo.phase * 1.3) * Math.PI * 2) * 0.06;
                const x = this._waveBaseX[i];
                const baseY = this.waveCenterY + wv * amp;
                // グリッドと同じ変形（モーフィング含む）をXYZフルで適用
                this._gridWarp(x, baseY, warpAmp, this.time, ww);
                // 各波形ごとの小さなゆらぎ(jitter)を上乗せ
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
        // 波形の鳴り合計をグリッドのうねりにも反映（音で床も波打つ）
        this.gridWarpLevel = Math.max(this.gridWarpLevel, this.busLevel * 0.6);
    }

    /**
     * 赤い立体菱形マーカー◆のメッシュプール（床グリッドに乗せる）。
     * 平面のLineではなく、八面体(立体菱形)＋発光する赤メタル質感にして立方体と馴染ませる。
     * IBL反射(envMap)も乗せるので、ガラス/宝石っぽい赤い印になる。
     * 積み上げ式（消さない）なのでプールは多め。
     */
    _buildCrossPool() {
        this.crossGroup = new THREE.Group();
        this.scene.add(this.crossGroup);

        const s = this.crossSize;                 // 八面体の半径（床スケール用に大きめ）
        const env = this.scene?.environment || null;
        // 共有ジオメトリ（八面体＝立体の菱形◆）。各マーカーで使い回す。
        const octGeo = new THREE.OctahedronGeometry(s, 0);
        const coreGeo = new THREE.IcosahedronGeometry(s * 0.32, 0);
        this._crossGeos = [octGeo, coreGeo];

        for (let i = 0; i < this.crossMax; i++) {
            const group = new THREE.Group();
            // 外殻：半透明の赤メタル（宝石っぽく反射＋発光）
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
            // 中心コア：強く光る不透明な芯（点光源っぽい存在感）
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

    _buildNodeEdges() {
        const maxEdges = 512;
        this._nodeEdgeMax = maxEdges;
        this._nodeEdgeThresh = 1200; // この距離以内のノード同士を接続
        this._nodeEdgeMat = new THREE.MeshPhysicalMaterial({
            color: 0xff2020,
            metalness: 0.9,
            roughness: 0.15,
            emissive: 0xff0000,
            emissiveIntensity: 0.4,
            envMap: this.scene?.environment || null,
            envMapIntensity: 1.2,
        });
        // 単位シリンダー（Y軸方向, 高さ1, 半径1）。スケールで長さ・太さを制御
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
        const radius = 4.0; // シリンダーの太さ
        let edgeCount = 0;

        for (let i = 0; i < crosses.length && edgeCount < maxEdges; i++) {
            const a = crosses[i].position;
            for (let j = i + 1; j < crosses.length && edgeCount < maxEdges; j++) {
                const b = crosses[j].position;
                const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > thresh) continue;

                // 中点
                dummy.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
                // Y軸をAB方向に向ける
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

    /** ランダムな格子点のXYワールド座標（壁面の基準座標）を返す（.x=横, .y=縦） */
    _randomGridPoint() {
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const ci = Math.floor(this._rand() * (this.gridFineCols + 1));
        const ri = Math.floor(this._rand() * (this.gridFineRows + 1));
        const x = -hw + (this.gridFieldW * ci) / this.gridFineCols;
        const y = this.gridCenterY - hh + (this.gridFieldH * ri) / this.gridFineRows;
        return new THREE.Vector3(x, y, 0);
    }

    /** 細グリッド交点にスナップ（XY壁面） */
    _snapToGrid(x, y) {
        const hw = this.gridFieldW * 0.5;
        const hh = this.gridFieldH * 0.5;
        const cellW = this.gridFieldW / this.gridFineCols;
        const cellH = this.gridFieldH / this.gridFineRows;
        let ci = Math.round((x + hw) / cellW);
        let ri = Math.round((y - (this.gridCenterY - hh)) / cellH);
        ci = Math.max(0, Math.min(this.gridFineCols, ci));
        ri = Math.max(0, Math.min(this.gridFineRows, ri));
        return new THREE.Vector3(-hw + ci * cellW, (this.gridCenterY - hh) + ri * cellH, 0);
    }

    /**
     * イベント間隔に応じた格子点を返す。
     * 前回からの間隔が短いほど前回位置の近傍（小さい半径）、長いほど壁全体。
     * @param {number} track トラック番号（track別に前回位置を保持）
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
            const ratio = gap / this.clusterFarTime;     // 0〜1
            const minR = this.gridFieldW / this.gridCoarseCols;   // 1セル
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
     * 赤い立体菱形マーカー◆を壁グリッド上に1つ点灯。
     * 積み上げ式：消さずに残す。プールが尽きたら一番古いものを再利用（FIFO）。
     */
    _spawnCross() {
        let cross = this.crossPool.find(c => !c.visible);
        if (!cross) {
            cross = this.crossPool[this._crossNext % this.crossPool.length];
            this._crossNext++;
        }
        const p = this._clusteredGridPoint(1);   // track1: 間隔が短いほど近接配置
        // 基準座標を保持（毎フレーム壁の歪みに追従させるため）。.x=横, .y=縦
        cross.userData.baseX = p.x;
        cross.userData.baseY = p.y;
        cross.position.set(p.x, p.y, this.gridCenterZ + 120);   // 初期位置。次フレームから壁に追従
        // 立体感を出すためランダムに傾ける＋ゆっくり自転させる
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

    setupCameraParticleDistance(cameraParticle) {
        // スタジオ無し。横9200×縦5600のグリッドをやや寄せ気味に映す距離感（部屋制約なし）。
        cameraParticle.minDistance = 50000;
        cameraParticle.maxDistance = 150000;
        cameraParticle.maxDistanceReset = 140000;
        cameraParticle.minY = STUDIO_FLOOR_TOP_Y;
        cameraParticle.maxY = 6500;
        cameraParticle.initializePosition?.();
    }

    updateCamera() {
        if (this.trackEffects[1] && this.cameraParticles[this.currentCameraIndex]) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            const basePos = cp.getPosition().clone();
            // 時間ベースのノイズで遠近をゆらゆら（複数周期を重ねて自然なゆらぎに）
            const t = this.time;
            const distNoise = Math.sin(t * 0.08) * 1800
                            + Math.sin(t * 0.031) * 2600
                            + Math.sin(t * 0.017) * 1200;
            const toCenter = this._centerSmoothed.clone().sub(basePos).normalize();
            basePos.addScaledVector(toCenter, distNoise);
            this.camera.position.copy(basePos);
            this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
            this.camera.matrixWorldNeedsUpdate = false;
            return;
        }
        this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
        this.camera.matrixWorldNeedsUpdate = false;
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;

        this.currentVisibleCount = this.sphereCount;
        this.setParticleCount(this.sphereCount);
        if (this.instancedMeshManager) {
            const mainMesh = this.instancedMeshManager.getMainMesh();
            if (mainMesh) {
                mainMesh.count = this.sphereCount;
                mainMesh.instanceMatrix.needsUpdate = true;
            }
        }

        // うねりレベルを徐々に減衰（expand等で上がったぶんを戻す）
        this.gridWarpLevel *= Math.exp(-0.8 * deltaTime);

        // ---- 形状モーフィング：actual_tick に従って形状補間 ----
        this._updateMorph();

        // ---- track10: Z押し出しパルスの寿命更新（ゆっくり戻る）----
        this._updateWarpPulses(deltaTime);
        // ---- track9: XYZへこみパルスの寿命更新 ----
        this._updateImplodePulses(deltaTime);

        // ---- チリパーティクル＋3Dノイズフォグ ----
        this.atmosphere?.update(deltaTime, this.time, this._centerSmoothed);

        // ---- グリッド立方体をうねらせる（位置 = _gridWarp、回転は維持）----
        this._updateGridCubes(deltaTime);

        // ---- グリッドライン（白線）をうねりに追従させる ----
        this._updateGridLines();

        // ---- 赤い立体菱形マーカー：積み上げ式（消さない）。うねる床に追従＋自転 ----
        this._updateCrossesOnGround(deltaTime);

        // ---- NodeGarden：visible なマーカー同士を近傍接続（常時オフ）----
        if (this._nodeEdgeMesh) this._nodeEdgeMesh.count = 0;

        // ---- トラック別オシロ波形：1トラック1本を上空に重ねる（音反応）----
        this._updateWaves(deltaTime);

        // ---- track8: 波形の中心を貫くシリンダーの寿命更新（フェードアウト＆破棄）----
        this._updateTrack8Cylinders(deltaTime);

        this.updateExpandSpheres();
        this.updateCamera();

        /**
         * オブジェクト(立方体グリッド)にピントを合わせる。
         * SceneBase.updateAutoFocus は画面中央レイキャスト方式だが、格子の中心は隙間で
         * 空振りしてピントが定位置に固定されがち。ここではグリッド中心(_centerSmoothed)
         * までのカメラ距離を直接フォーカスにして、確実にグリッド面へピントを合わせる。
         */
        if (this.useAutoFocusDOF && this.useDOF && this.bokehPass?.uniforms?.focus) {
            const targetFocus = this.camera.position.distanceTo(this._centerSmoothed);
            const u = this.bokehPass.uniforms.focus;
            u.value += (targetFocus - u.value) * 0.5;   // なめらかに追従
        } else if (this.bokehPass?.uniforms?.focus) {
            this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        }
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);

        // ---- コールアウト：表示中のテキストを高速で矢継ぎ早に差し替える ----
        if (this.calloutReady && this.calloutSystem) {
            this.calloutTextTick += deltaTime;
            if (this.calloutTextTick >= this.calloutTextInterval) {
                this.calloutTextTick = 0;
                for (const co of this.calloutSystem.callouts) {
                    if (co.textCharCount > 0) {
                        co.labelText = this._randomDataString();
                        co.textCharCount = co.labelText.length;  // 全文表示
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
        const tn = Scene09.parseTrackNumber(trackNumber, message);
        if (tn !== 12) return;
        const args = message.args || [];
        const v1 = args[1] != null ? Number(args[1]) : NaN;
        const v0 = args[0] != null ? Number(args[0]) : NaN;
        let velocity = Number.isFinite(v1) ? v1 : Number.isFinite(v0) ? v0 : 127;
        if (!Number.isFinite(velocity) || velocity <= 0) return;
        if (this.trackEffects[12]) this.triggerExpandEffect(velocity);
    }

    /**
     * OSCを直接横取りする（重要）。
     * ラボの SceneBase.handleOSC は track1 を「カメラ切替」として処理し return してしまうため、
     * このシーンでは handleOSC を上書きして track1/track5 を自前で処理する。
     * track2/3/4・/phase・/tick・track12(expand) は super.handleOSC に委譲する。
     */
    handleOSC(message) {
        const trackNumber = message?.trackNumber;
        const args = message?.args || [];
        const note = args.length > 0 ? Number(args[0]) : 60;
        const velocity = args.length > 1 ? Number(args[1]) : 100;
        const durationMs = args.length > 2 ? Number(args[2]) : 0;

        // --- 全トラックのノートを波形ボイスとして登録（オーディオリアクティブ）---
        if (trackNumber >= 1 && trackNumber <= this.trackCount) {
            this._addVoice(note, velocity, trackNumber);
        }

        // --- track1: 赤い菱形マーカー◇（クラスタリング配置）＋カメラランダマイズ ---
        //     マーカーは常に出す。カメラ切替はトグル（trackEffects[1]）ON時のみ。
        if (trackNumber === 1) {
            this._spawnCross();
            // うねりに少し勢いを足す
            this.gridWarpLevel = Math.min(2.0, this.gridWarpLevel + 0.25);
            if (this.trackEffects[1]) this.switchCameraRandom();
            return;
        }

        // --- track5: 立方体の上空に3Dコールアウトを1個 ---
        if (trackNumber === 5) {
            if (this.calloutReady && this.calloutSystem) {
                // 床の格子点を選び、うねりに乗せた座標の上空に浮かせる（3Dワールド配置）
                const p = this._clusteredGridPoint(5);
                const w = this._warpScratch;
                this._gridWarp(p.x, p.z, this._warpAmp(), this.time, w);
                const worldPos = new THREE.Vector3(w.x, w.y + 600 + this._rand() * 500, w.z);
                const duration = durationMs > 0 ? Math.max(4.0, durationMs / 1000) : (5.0 + this._rand() * 3.0);
                this.calloutSystem.createCallout({ worldPos, time: this.time, duration });
            }
            return;
        }

        // --- track8: グリッドパーティクルのスケールブースト（局所＋ノイズ）---
        if (trackNumber === 8) {
            if (this._cubeBoostMap && this.gridBaseX) {
                const v = velocity / 127.0;
                const maxBoost = 1.0 + v * 2.5;   // velocity 127 で 3.5倍まで
                // ブースト中心：クラスタリング済みのランダムグリッド点
                const cp = this._clusteredGridPoint(8);
                const cx = cp.x, cy = cp.y;        // _clusteredGridPoint は XY(壁面)で返す
                const r = this._cubeBoostRadius;
                const r2 = r * r;
                const n = this.particles.length;
                const noiseScale = 0.00035;
                for (let i = 0; i < n; i++) {
                    const bx = this.gridBaseX[i], by = this.gridBaseY[i];
                    const dx = bx - cx, dy = by - cy;
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 > r2 * 4) continue;   // 半径2倍超えは完全スキップ
                    // ガウシアン減衰
                    const gauss = Math.exp(-dist2 / (r2 * 0.5));
                    // FBMノイズで輪郭をギザギザに
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

        // --- track9: XYZへこみパルス（引き込み）---
        if (trackNumber === 9) {
            this._fireImplodePulse(velocity);
            return;
        }

        // --- track10: Z方向の押し出しパルス（衝撃波）---
        //     velocity=強さ / duration=範囲の広さ / 方向=前後ランダム。
        //     壁が押し出され、しばらくしてゆっくり戻る。波形もこの押し出しに乗る。
        if (trackNumber === 10) {
            this._fireWarpPulse(velocity, durationMs);
            return;
        }

        // それ以外（track2/3/4 のエフェクト、track6 expand、/phase、/tick など）は親に委譲
        super.handleOSC(message);
    }

    initPostProcessing() {
        // 他シーン(Scene02)と同じボケ味・ブルーム量に揃える。
        // パイプライン既定(focus:2100, aperture:0.0000012, maxblur:0.0028, bloom:0.14)は
        // 立方体が遠くボケすぎるので、Scene02 相当の控えめ被写界深度＋やや強めブルームに。
        setupPostEffectsPipeline(this, {
            dofFocus: 500,
            dofAperture: 0.0000003,
            dofMaxBlur: 0.003,
            bloomStrength: 0.2,
            bloomRadius: 0.1,
            bloomThreshold: 1.2
        });
        // track2 を全画面フラッシュ（ストロボ）にするためのパス
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
        this.particles = [];
        this.gridBaseX = null;
        this.gridBaseZ = null;

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

        // track8 シリンダーを破棄
        for (const c of this.track8Cylinders) this._disposeTrack8Cylinder(c);
        this.track8Cylinders = [];

        // track10 パルスをクリア
        this.warpPulses = [];

        // 赤い立体菱形マーカープールを破棄（ジオメトリは共有なのでマテリアルのみ個別解放）
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

        this.atmosphere?.dispose();
        this.atmosphere = null;

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
