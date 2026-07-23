/**
 * Scene09: mathym | Orbital (電子の確率雲)
 *
 * 量子力学の「電子は点ではなく、どこにいるか確率的にしか分からない雲」を
 * パーティクルで可視化する。水素様原子の波動関数 ψ_nlm の確率密度 |ψ|² に従って
 * 数千個のパーティクルを 3D 配置し、生物的にうねり・脈動させる。
 *
 * 質感は Scene08 を踏襲：
 *  - メタル破片マテリアル（metalness 0.88 / roughness 0.32 / clearcoat / envMap）
 *  - SSAO（濃いめ）＋ 固定 DOF ＋ FilmGrain ＋ Bloom
 *  - StudioRoom 環境マップ（IBL）＋ 部屋ライティング
 *
 * 有機性は Scene12 を踏襲：
 *  - ランダムサイズのパーティクル（70%小・25%中・5%大）
 *  - actual_tick / phase でゆっくり脈打つ呼吸（_particleNoiseScale）
 *  - 各パーティクルの自転（updateRotation）
 *  - 軌道間の滑らかなモーフィング（雲がうねって形を変える）
 *
 * OSC:
 *  - track1: カメラランダマイズ ＋ 雲に揺らぎ
 *  - track2/3/4: 色反転・色収差・グリッチ（親に委譲）
 *  - track5: コールアウト（計測ラベル）＋ 次の軌道へ遷移
 *  - track7: 励起（雲が一時的に膨張してうねる）
 *  - track8: 局所密度ブースト（一部のパーティクルが膨らみ発光）
 *  - track9: 全体パルス（雲が脈動）
 *  - /phase・/tick・/kit は親に委譲
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

export class Scene09 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Orbital';
        this.initialized = false;
        this.sceneNumber = 9;
        this.kitNo = 22;
        this.sharedResourceManager = sharedResourceManager;

        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this.sceneLightingScale = 0.62;
        this._roomEnvPresentation = null;
        this._minimalLights = null;

        // ---- ポストエフェクト（Scene08 踏襲）----
        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = true;
        this.sceneFogDensity = 0.000018;
        this.sceneFogColor = 0x0a0a10;
        this.useSSAO = true;
        this.useFilmGrain = true;
        this.useAutoFocusDOF = false;   // Scene08 と同じく固定 DOF
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        // SSAO は弱めにして「粒の周りの黒ハロ（アニメ風の黒縁）」を抑える。
        // 小さい粒が密集すると大きい kernelRadius が隙間を黒く塗りつぶしてしまうため。
        this.ssaoNearKernelRadius = 3.2;
        this.ssaoNearMinDistance = 0.004;
        this.ssaoNearMaxDistance = 0.04;
        this.ssaoFarAttenuation = 0.45;
        this.outputPass = null;
        this.atmosphere = null;

        this.trackEffects = {
            1: true,
            2: true,   // 色反転（委譲）
            3: false,  // 色収差（委譲）
            4: false,  // グリッチ（委譲）
            5: true,
            6: true,
            7: true,
            8: true,
            9: true
        };
        this.useTrack2Strobe = false;
        this.setScreenshotText(this.title);

        // ---- 部屋（Scene12/Scene10 と同じ標準部屋）----
        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;
        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.promoWallLightTarget = null;
        this.promoWallFillLight = null;
        this.fillPointLight = null;
        this.pulsePointLight = null;
        this._cornerLamps = null;

        // チリパーティクル（空気感）
        this.ambientParticleCount = 1400;
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientMinLiving = 120;

        // ---- 電子確率雲のパラメータ ----
        this.particleCount2 = 5000;             // パーティクル総数
        this.cloudRadius = 1100;                // 雲の代表スケール
        this.cloudCenterY = STUDIO_FLOOR_TOP_Y + 2600; // 雲の中心高さ（部屋中央やや上）
        this.instancedMeshManager = null;
        this.particles = [];
        this.basePositions = null;              // Float32Array(n*3) 各粒子の基準位置（雲内）
        this.baseRadii = null;                  // Float32Array(n) 各粒子の基準サイズ
        this.densityVal = null;                 // Float32Array(n) その位置の確率密度(0-1)
        this._boostMap = null;                  // Float32Array(n) track8 ブースト

        // 軌道タイプ（確率密度関数）。phase（曲の区切り）でモーフ遷移する。
        // 'S' 球, 'P' ダンベル, 'D' 四つ葉, 'HYBRID' sp3 風
        this.orbitals = ['S', 'P', 'D', 'HYBRID'];
        this.orbitalCurrentIdx = 0;
        this.orbitalNextIdx = 1;
        this.orbitalT = 0.0;                    // 0→1 現軌道→次軌道へ補間
        this._lastPhase = -1;                   // phase 切り替え検知用

        // 励起（track7）：雲が一時的に膨張
        this.excitation = 0.0;                  // 0=基底, >0 で膨張＆うねり増
        // 全体パルス（track9）：脈動
        this.pulse = 0.0;

        // 呼吸（actual_tick による連続的なゆっくりした基準サイズの揺らぎ）
        this._particleNoiseScale = 1.0;
        // phase（曲の区切り）に応じた雰囲気係数。前半=静か/締まった、後半=広がり/活発。
        // 0〜1 で滑らかに追従させる（phase が進むほど 1 に近づく）。
        this._phaseMood = 0.0;

        // うねり強度（音反応）
        this.warpLevel = 0.0;

        // ===== 赤いワイヤーフレームのメタボール膜 =====
        // 雲を覆う Icosphere（ワイヤー）。中の代表パーティクルが内側から押して歪ませる。
        this.membrane = null;
        this.membraneMat = null;
        this.membraneRadius = this.cloudRadius * 1.5;   // 膜の基準半径（雲全体＝粒の分布を包むサイズ。反発壁と一致）
        this.MEMBRANE_INFLUENCERS = 20;                  // 膜を押す代表点の数
        // 代表点（ワールド座標）を渡す uniform 用配列
        this._influencers = [];
        for (let i = 0; i < this.MEMBRANE_INFLUENCERS; i++) this._influencers.push(new THREE.Vector3());
        this._influencerIdx = null;                      // 代表に選ぶパーティクルの index 配列

        // ===== ピンボール：膜の中で粒が反発しながら漂い続ける =====
        // 各粒は「絶対オフセット位置」を速度で自由に動かし、膜内壁で反発する。
        // バネで基準に引き戻さない（＝ピンボールのように飛び続ける）。
        this._pinVel = null;        // Float32Array(n*3) 速度
        this._pinOff = null;        // Float32Array(n*3) 基準位置からのオフセット（自由運動）
        this.pinFriction = 0.55;    // 速度の摩擦（/秒、強め＝すぐ減速）
        this.pinRestitution = 0.45; // 膜内壁での反発係数（跳ねにくい）
        this.pinDrift = 0.2;        // 常時かかる微弱なランダム力（track6無しでも漂う）
        this.pinKickMin = 120;      // track6 の最小キック速度
        this.pinKickMax = 480;      // track6 の最大キック速度

        // スクラッチ
        this._tmpV = new THREE.Vector3();
        this._scaleScratch = new THREE.Vector3();
        this._colorTmp = new THREE.Color();
        this._emissiveTmp = new THREE.Color();
        this._dofCamDir = new THREE.Vector3();
        this._dofToTarget = new THREE.Vector3();
        this._centerSmoothed = new THREE.Vector3(0, this.cloudCenterY, 0);
        // 注視点：ランダムなパーティクルをゆっくり追従
        this._lookTarget = new THREE.Vector3(0, this.cloudCenterY, 0);
        this._lookTargetIdx = 0;       // 追従中のパーティクルindex
        this._lookSwitchTimer = 0;     // 次に切り替えるまでの残り秒

        // 決定論的 PRNG
        this.seed = 0x9e3779b9 | 0;
    }

    /** 決定論的PRNG（xorshift） */
    _rand() {
        let x = this.seed | 0;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        this.seed = x;
        return ((x >>> 0) % 1000000) / 1000000;
    }

    // ===== 部屋・ライティング（Scene12 流）=====

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
            airNoiseVolumeScale: 8.0
        });
    }

    /** 天井四隅に蛍光灯を配置（Scene12 と同じ） */
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

        for (const [x, y, z] of corners) {
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
        }
    }

    // ===== 電子確率雲 =====

    /**
     * 軌道タイプ shape における、ある方向(単位ベクトル dir)・半径比 rNorm での
     * 角度方向の確率密度（0〜1）を返す。動径方向は別途指数で減衰させる。
     * @param {string} shape 'S'|'P'|'D'|'HYBRID'
     * @param {number} nx,ny,nz 単位方向
     */
    _angularDensity(shape, nx, ny, nz) {
        switch (shape) {
            case 'S':
                // 球対称：方向によらず一定
                return 1.0;
            case 'P':
                // p_z 軌道：cos²θ（縦のダンベル）
                return nz * nz;
            case 'D':
                // d_z²風：(3cos²θ - 1)² を正規化（四つ葉＋ドーナツ）
                {
                    const c = 3 * nz * nz - 1;
                    return (c * c) / 4;
                }
            case 'HYBRID':
                // sp3 風：4方向（正四面体）に伸びる雲
                {
                    const d1 = nx + ny + nz;
                    const d2 = nx - ny - nz;
                    const d3 = -nx + ny - nz;
                    const d4 = -nx - ny + nz;
                    const m = Math.max(d1, d2, d3, d4) / 1.732; // /√3
                    return Math.max(0, m) ** 2;
                }
            default:
                return 1.0;
        }
    }

    /**
     * 軌道タイプ shape に従って確率密度サンプリングで雲内の1点を生成する。
     * 動径は r·exp(-r) 系（水素様）の山なりにし、角度は _angularDensity でリジェクション。
     * @param {string} shape
     * @param {THREE.Vector3} out 結果（雲ローカル座標。中心原点）
     * @returns {number} その点の確率密度(0〜1)
     */
    _sampleOrbital(shape, out) {
        const R = this.cloudRadius;
        for (let tries = 0; tries < 24; tries++) {
            // 動径：中心寄りに凝集させた分布（塊感）。3回混ぜて中央に寄せ、
            // さらに pow で内側へ引き込む（外周にバラけ過ぎない）。
            const u = (this._rand() + this._rand() + this._rand()) / 3;
            const rNorm = Math.pow(u, 1.5);        // 0〜1（内側に凝集）
            const r = rNorm * R * 1.15;

            // 方向：一様球面サンプリング
            const theta = this._rand() * Math.PI * 2;
            const cosPhi = this._rand() * 2 - 1;
            const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
            const nx = sinPhi * Math.cos(theta);
            const ny = sinPhi * Math.sin(theta);
            const nz = cosPhi;

            const ang = this._angularDensity(shape, nx, ny, nz);
            // 動径エンベロープ（水素様 r²·exp(-r) を簡略化した山）。
            // 山を内側に寄せて中心の塊を濃くする。
            const radial = rNorm * Math.exp(-rNorm * 3.0) * 8.0;
            const density = ang * radial;

            // リジェクション：density が高いほど採用されやすい
            if (this._rand() < density) {
                out.set(nx * r, ny * r, nz * r);
                return Math.min(1, density);
            }
        }
        // フォールバック：薄い外周にばらまく
        const theta = this._rand() * Math.PI * 2;
        const cosPhi = this._rand() * 2 - 1;
        const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
        const r = R * (0.8 + this._rand() * 0.4);
        out.set(sinPhi * Math.cos(theta) * r, sinPhi * Math.sin(theta) * r, cosPhi * r);
        return 0.1;
    }

    /** Scene08 と同系：肉質テクスチャ（カラー＋バンプ）。黒チャコール粒用。 */
    generateFleshTextures() {
        const size = 512;
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size;
        colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');
        cCtx.fillStyle = '#888888';
        cCtx.fillRect(0, 0, size, size);
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 20 + Math.random() * 60;
            const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
            const grayVal = 120 + Math.random() * 80;
            grad.addColorStop(0, `rgba(${grayVal}, ${grayVal}, ${grayVal}, 0.5)`);
            grad.addColorStop(1, 'rgba(136, 136, 136, 0)');
            cCtx.fillStyle = grad;
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
        }
        cCtx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
        for (let i = 0; i < 30; i++) {
            cCtx.lineWidth = 0.8 + Math.random() * 2.0;
            let x = Math.random() * size;
            let y = Math.random() * size;
            cCtx.beginPath();
            cCtx.moveTo(x, y);
            let angle = Math.random() * Math.PI * 2;
            for (let j = 0; j < 40; j++) {
                angle += (Math.random() - 0.5) * 1.2;
                x += Math.cos(angle) * 8;
                y += Math.sin(angle) * 8;
                cCtx.lineTo(x, y);
            }
            cCtx.stroke();
        }
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size;
        bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, size, size);
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 1 + Math.random() * 3;
            const isBump = Math.random() > 0.5;
            bCtx.fillStyle = isBump ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 10 + Math.random() * 30;
            const grad = bCtx.createRadialGradient(x, y, 0, x, y, r);
            const val = Math.random() > 0.5 ? 255 : 0;
            grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.4)`);
            grad.addColorStop(1, 'rgba(128, 128, 128, 0)');
            bCtx.fillStyle = grad;
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }
        const colorTex = new THREE.CanvasTexture(colorCanvas);
        colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
        colorTex.colorSpace = THREE.SRGBColorSpace;
        const bumpTex = new THREE.CanvasTexture(bumpCanvas);
        bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
        bumpTex.colorSpace = THREE.LinearSRGBColorSpace;
        return { map: colorTex, bumpMap: bumpTex };
    }

    /**
     * パーティクル群（電子確率雲）を生成する。
     * Scene08 の track9 スフィア質感（黒チャコール＋しっとりツヤ）を踏襲。
     */
    createCloud() {
        const n = this.particleCount2;

        // 質感は Scene08 の track9 スフィア（黒チャコール＋しっとりツヤ）。
        // 形は角張った多角形（破片感）。
        const geo = new THREE.DodecahedronGeometry(1, 0);
        {
            const nv = geo.attributes.position.count;
            const white = new Float32Array(nv * 3);
            white.fill(1);
            geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
        }

        // 肉質テクスチャ（カラー＋バンプ）。Scene08 の generateFleshTextures を踏襲。
        const flesh = this.generateFleshTextures();
        this._fleshTextures = flesh;
        const env = this.scene?.environment || null;
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,                 // 白基準。実際の明るさは vertexColors で決める
            map: flesh.map,
            bumpMap: flesh.bumpMap,
            bumpScale: 0.5,
            roughness: 0.22,
            metalness: 0.22,
            clearcoat: 0.88,                 // しっとりした濡れ感のツヤ
            clearcoatRoughness: 0.14,
            envMap: env,
            envMapIntensity: 1.05 * (0.55 + 0.45 * (this.sceneLightingScale ?? 1)),
            emissive: 0x000000,              // 発光なし（ずっとカッコいい黒のまま）
            emissiveIntensity: 0.0,
            flatShading: true,               // 多角形の面をパキッと（破片感）
            vertexColors: true,
            fog: true
        });
        this._cloudMat = mat;

        this.instancedMeshManager = new InstancedMeshManager(this.scene, geo, mat, n);
        const mainMesh = this.instancedMeshManager.getMainMesh();
        // 影は使わない（粒同士の影は重い割に見えない）。シャドウマップ描画コストを丸ごと削減。
        // 立体感は SSAO ＋ envMap の陰影で出す。
        mainMesh.castShadow = false;
        mainMesh.receiveShadow = false;

        this.basePositions = new Float32Array(n * 3);
        this.baseRadii = new Float32Array(n);
        this.densityVal = new Float32Array(n);
        this._boostMap = new Float32Array(n);
        // 形のランダム化：軸ごとの非均等スケール倍率（細長い・潰れた・歪な粒に見せる）
        this._shapeAspect = new Float32Array(n * 3);

        const shape = this.orbitals[this.orbitalCurrentIdx];
        const p3 = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
            const density = this._sampleOrbital(shape, p3);
            this.basePositions[i * 3] = p3.x;
            this.basePositions[i * 3 + 1] = p3.y;
            this.basePositions[i * 3 + 2] = p3.z;
            this.densityVal[i] = density;

            // ランダムサイズ（70%小・25%中・5%大）。小さい粒はグッと小さく、メリハリを出す。
            let worldR;
            const sizeRand = this._rand();
            if (sizeRand < 0.75) worldR = 2 + this._rand() * 5;        // 小（75%）: 2〜7
            else if (sizeRand < 0.97) worldR = 18 + this._rand() * 22; // 中（22%）: 18〜40
            else worldR = 45 + this._rand() * 25;                      // 大（3%）:  45〜70
            worldR *= 0.8 + density * 0.8;
            this.baseRadii[i] = worldR;

            // 形のランダム化：軸ごとに 0.5〜1.6 倍の非均等スケール。
            // 多角形の破片感：軸ごとに 0.7〜1.25 倍の歪み（細長い・潰れた粒がバラける）。
            const ax = 0.7 + this._rand() * 0.55;
            const ay = 0.7 + this._rand() * 0.55;
            const az = 0.7 + this._rand() * 0.55;
            this._shapeAspect[i * 3] = ax;
            this._shapeAspect[i * 3 + 1] = ay;
            this._shapeAspect[i * 3 + 2] = az;

            const scale = new THREE.Vector3(worldR * ax, worldR * ay, worldR * az);
            const wx = p3.x;
            const wy = this.cloudCenterY + p3.y;
            const wz = p3.z;
            const particle = new Scene02Particle(wx, wy, wz, worldR * 0.5, scale);
            particle.angularVelocity.set(0, 0, 0);   // 普段は自転しない（track7 励起時だけ回す）
            this.particles.push(particle);

            // 色：明るいグレー〜チャコールの間でランダマイズ（白基準 color に乗算）。
            // 明度 0.12(濃いチャコール)〜0.45(中グレー) のレンジ。
            const v = 0.12 + this._rand() * 0.33;
            this._colorTmp.setRGB(v, v, v);
            // ほんのり色相のブレ（青寄り↔赤寄り）を足してメカ感を残す
            this._colorTmp.offsetHSL((this._rand() - 0.5) * 0.03, (this._rand() - 0.5) * 0.05, 0);
            this.instancedMeshManager.setColorAt(i, this._colorTmp);
            this.instancedMeshManager.setMatrixAt(i, particle.position, particle.rotation, particle.scale);
        }
        this.instancedMeshManager.markColorsNeedsUpdate();
        this.instancedMeshManager.markNeedsUpdate();
        this.setParticleCount(n);

        // 膜を押す代表点：大きいパーティクル上位 MEMBRANE_INFLUENCERS 個を選ぶ
        const order = Array.from({ length: n }, (_, i) => i)
            .sort((a, b) => this.baseRadii[b] - this.baseRadii[a]);
        this._influencerIdx = order.slice(0, this.MEMBRANE_INFLUENCERS);

        // ピンボール物理用の配列（基準位置からのオフセットと速度）
        this._pinVel = new Float32Array(n * 3);
        this._pinOff = new Float32Array(n * 3);
        // 速度起因の角速度（慣性で減衰する自転）
        this._pinAngVel = new Float32Array(n * 3); // 各粒の角速度ベクトル(rx,ry,rz)
    }

    /**
     * 赤いワイヤーフレームのメタボール膜を作る。
     * 雲を覆う Icosphere をワイヤー表示し、頂点シェーダーで
     *  ① 時間でうねる粗いノイズ
     *  ② 代表パーティクル（_influencers）に内側から押されて外へ膨らむ（メタボール）
     * を合成して変形する。
     */
    _buildMembrane() {
        const geo = new THREE.IcosahedronGeometry(this.membraneRadius, 11); // 高ポリ（細かいワイヤー＋うねり用）

        const uniforms = {
            uTime: { value: 0 },
            uCenter: { value: new THREE.Vector3(0, this.cloudCenterY, 0) },
            uInfluencers: { value: this._influencers },
            uInfluencerCount: { value: this.MEMBRANE_INFLUENCERS },
            uPushRadius: { value: this.cloudRadius * 0.5 },
            uPushAmount: { value: this.cloudRadius * 0.45 },
            uNoiseAmp: { value: this.membraneRadius * 0.12 },
            uAlpha: { value: 0.0 },
        };
        this._membraneUniforms = uniforms;

        const vertexShader = /* glsl */`
            uniform float uTime;
            uniform vec3 uCenter;
            uniform vec3 uInfluencers[${this.MEMBRANE_INFLUENCERS}];
            uniform int uInfluencerCount;
            uniform float uPushRadius;
            uniform float uPushAmount;
            uniform float uNoiseAmp;

            varying float vHeat; // 0=静止(青) 1=最大膨張(赤)

            float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
            float noise(vec3 p){
                vec3 i = floor(p); vec3 f = fract(p);
                f = f*f*(3.0-2.0*f);
                float n000=hash(i+vec3(0,0,0)), n100=hash(i+vec3(1,0,0));
                float n010=hash(i+vec3(0,1,0)), n110=hash(i+vec3(1,1,0));
                float n001=hash(i+vec3(0,0,1)), n101=hash(i+vec3(1,0,1));
                float n011=hash(i+vec3(0,1,1)), n111=hash(i+vec3(1,1,1));
                float nx00=mix(n000,n100,f.x), nx10=mix(n010,n110,f.x);
                float nx01=mix(n001,n101,f.x), nx11=mix(n011,n111,f.x);
                return mix(mix(nx00,nx10,f.y), mix(nx01,nx11,f.y), f.z);
            }

            void main() {
                vec3 worldPos = position + uCenter;
                vec3 nrm = normalize(position);

                float ns = noise(position * 0.0025 + vec3(uTime * 0.15));
                float ns2 = noise(position * 0.006 - vec3(uTime * 0.1));
                float wob = (ns - 0.5) * 2.0 * uNoiseAmp + (ns2 - 0.5) * uNoiseAmp * 0.5;

                float push = 0.0;
                for (int k = 0; k < ${this.MEMBRANE_INFLUENCERS}; k++) {
                    if (k >= uInfluencerCount) break;
                    float d = distance(worldPos, uInfluencers[k]);
                    float infl = exp(-(d*d) / (uPushRadius * uPushRadius));
                    push += infl;
                }
                push = min(push, 1.5) * uPushAmount;

                // ヒートマップ用：push量を 0-1 に正規化して渡す
                vHeat = clamp(push / uPushAmount, 0.0, 1.0);

                vec3 displaced = position + nrm * (wob + push);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
            }
        `;

        const fragmentShader = /* glsl */`
            uniform float uAlpha;
            varying float vHeat;

            // 青→シアン→緑→黄→赤 のヒートマップ
            vec3 heatmap(float t) {
                t = clamp(t, 0.0, 1.0);
                vec3 c0 = vec3(0.0, 0.1, 0.9);  // 青（静止）
                vec3 c1 = vec3(0.0, 0.8, 0.8);  // シアン
                vec3 c2 = vec3(0.0, 0.9, 0.1);  // 緑
                vec3 c3 = vec3(0.9, 0.8, 0.0);  // 黄
                vec3 c4 = vec3(1.0, 0.05, 0.0); // 赤（最大膨張）
                float s = t * 4.0;
                int seg = int(s);
                float f = fract(s);
                if (seg == 0) return mix(c0, c1, f);
                if (seg == 1) return mix(c1, c2, f);
                if (seg == 2) return mix(c2, c3, f);
                return mix(c3, c4, f);
            }

            void main() {
                vec3 col = heatmap(vHeat);
                float alpha = (0.55 + vHeat * 0.35) * uAlpha;
                gl_FragColor = vec4(col, alpha);
            }
        `;

        const mat = new THREE.ShaderMaterial({
            uniforms,
            vertexShader,
            fragmentShader,
            wireframe: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false
        });
        this.membraneMat = mat;

        this.membrane = new THREE.Mesh(geo, mat);
        this.membrane.position.set(0, this.cloudCenterY, 0);
        this.membrane.frustumCulled = false;
        this.membrane.visible = true;  // uAlpha=0 から始まるのでvisible=trueで問題なし
        this.scene.add(this.membrane);

        // ---- 膜の頂点に置く「赤く光る節点」（細胞の核っぽいアクセント）----
        this._buildMembraneNodes(geo);
    }

    /**
     * 膜の頂点からいくつか選んで、赤く光る小球（節点）を置く。
     * 毎フレーム、頂点シェーダーと同じ変位計算を CPU でも行い、膜のうねり・
     * メタボール変形にピタッと追従させる。
     * @param {THREE.BufferGeometry} membraneGeo 膜のジオメトリ（元頂点を参照）
     */
    _buildMembraneNodes(membraneGeo) {
        const COUNT = 20;
        const posAttr = membraneGeo.attributes.position;
        const vcount = posAttr.count;
        // 元頂点をランダムに COUNT 個選ぶ（重複は気にしない程度でOK）
        this._nodeBasePos = [];
        for (let k = 0; k < COUNT; k++) {
            const vi = Math.floor(this._rand() * vcount);
            this._nodeBasePos.push(new THREE.Vector3(
                posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)
            ));
        }

        // フォトリアルな赤い節点（金属＋clearcoat＋IBL反射）。形は多角形（破片感）。
        const geo = new THREE.DodecahedronGeometry(this.cloudRadius * 0.018, 0);
        const env = this.scene?.environment || null;
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0xcc1020,
            metalness: 0.55,
            roughness: 0.12,
            clearcoat: 1.0,
            clearcoatRoughness: 0.06,
            envMap: env,
            envMapIntensity: 1.6,
            emissive: 0x330006,
            emissiveIntensity: 0.6,
            flatShading: true,
            fog: true
        });
        this._nodeMat = mat;
        this._nodeMesh = new THREE.InstancedMesh(geo, mat, COUNT);
        this._nodeMesh.frustumCulled = false;
        this._nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this._nodeMesh);
        this._nodeDummy = new THREE.Object3D();
    }

    /** 頂点シェーダーと同じ hash/noise（節点を膜変形に追従させるため CPU で再現）。 */
    _membraneHash(x, y, z) {
        const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return s - Math.floor(s);
    }
    _membraneNoise(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        let fx = x - ix, fy = y - iy, fz = z - iz;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
        const h = (a, b, c) => this._membraneHash(ix + a, iy + b, iz + c);
        const nx00 = h(0,0,0) + (h(1,0,0) - h(0,0,0)) * fx;
        const nx10 = h(0,1,0) + (h(1,1,0) - h(0,1,0)) * fx;
        const nx01 = h(0,0,1) + (h(1,0,1) - h(0,0,1)) * fx;
        const nx11 = h(0,1,1) + (h(1,1,1) - h(0,1,1)) * fx;
        const ny0 = nx00 + (nx10 - nx00) * fy;
        const ny1 = nx01 + (nx11 - nx01) * fy;
        return ny0 + (ny1 - ny0) * fz;
    }

    /** 膜の代表点 uniform を更新し、赤い節点を膜変形に追従させる。 */
    _updateMembrane(dt) {
        if (!this.membrane || !this._influencerIdx) return;
        for (let k = 0; k < this._influencerIdx.length; k++) {
            const p = this.particles[this._influencerIdx[k]];
            if (p) this._influencers[k].copy(p.position);
        }
        this._membraneUniforms.uTime.value = this.time;
        // 膜は全体スケールでは膨らませない（広がり防止）。
        // 中の粒が押す部分だけ頂点シェーダーで局所的に膨らむ＝メタボール感。

        // ---- 赤い節点：頂点シェーダーと同じ変位を CPU 再現して膜に追従 ----
        if (this._nodeMesh && this._nodeBasePos) {
            const cx = 0, cy = this.cloudCenterY, cz = 0;
            const u = this._membraneUniforms;
            const pushR = u.uPushRadius.value;
            const pushAmt = u.uPushAmount.value;
            const noiseAmp = u.uNoiseAmp.value;
            const t = this.time;
            for (let k = 0; k < this._nodeBasePos.length; k++) {
                const pos = this._nodeBasePos[k];          // 膜ローカルの元頂点
                const len = pos.length() || 1;
                const nrm = this._tmpV.copy(pos).multiplyScalar(1 / len);
                // ワールド座標（膜中心 = cloudCenterY）
                const wx = pos.x + cx, wy = pos.y + cy, wz = pos.z + cz;

                // ① 粗いノイズ（シェーダーと同係数）
                const ns = this._membraneNoise(pos.x * 0.0025 + t * 0.15, pos.y * 0.0025 + t * 0.15, pos.z * 0.0025 + t * 0.15);
                const ns2 = this._membraneNoise(pos.x * 0.006 - t * 0.1, pos.y * 0.006 - t * 0.1, pos.z * 0.006 - t * 0.1);
                const wob = (ns - 0.5) * 2 * noiseAmp + (ns2 - 0.5) * noiseAmp * 0.5;

                // ② 代表点の押し出し
                let push = 0;
                for (let m = 0; m < this._influencers.length; m++) {
                    const inf = this._influencers[m];
                    const dx = wx - inf.x, dy = wy - inf.y, dz = wz - inf.z;
                    const d2 = dx * dx + dy * dy + dz * dz;
                    push += Math.exp(-d2 / (pushR * pushR));
                }
                push = Math.min(push, 1.5) * pushAmt;

                const disp = wob + push + noiseAmp * 0.05;
                this._nodeDummy.position.set(
                    wx + nrm.x * disp,
                    wy + nrm.y * disp,
                    wz + nrm.z * disp
                );
                this._nodeDummy.scale.setScalar(1);
                this._nodeDummy.updateMatrix();
                this._nodeMesh.setMatrixAt(k, this._nodeDummy.matrix);
            }
            this._nodeMesh.instanceMatrix.needsUpdate = true;
        }
    }

    /**
     * 軌道モーフィングを phase（曲のビートシート：0〜8 の9区切り）で切り替える。
     * phase が変わった瞬間に、その phase に対応する軌道タイプへ雲を再サンプリングして寄せる。
     * → 曲の展開（区切り）と軌道の形がフル同期する。
     */
    _updateOrbitalMorph() {
        const ph = Math.floor(this.phase || 0);
        if (ph !== this._lastPhase) {
            this._lastPhase = ph;
            const idx = ph % this.orbitals.length;
            this.orbitalCurrentIdx = idx;
            this._resampleTargets(this.orbitals[idx]);
            this._randomizePhaseParams();
        }
        // ワイヤーフレーム膜：phase4以降でじわりフェードイン
        if (this.membrane && this._membraneUniforms) {
            const alphaTarget = ph >= 4 ? 1.0 : 0.0;
            const u = this._membraneUniforms.uAlpha;
            u.value += (alphaTarget - u.value) * 0.008;
        }
    }

    /**
     * phase切り替わりのたびに各種パラメータをランダム化して予測不可能性を生む。
     * ランダム化対象：
     *   - エフェクトON/OFF（Bloom / SSAO / DOF / FilmGrain / ヒートマップ膜スキン）
     *   - パーティクルサイズ（baseRadiiスケール）
     *   - ピンボール力（pinDrift / pinFriction / pinRestitution）
     *   - うねり振幅（warpBase）
     *   - 膜のpush量・ノイズ振幅
     *   - Bloom強度・半径
     */
    _randomizePhaseParams() {
        const r = () => Math.random();

        // ---- エフェクトON/OFF ----


        // ---- パーティクルサイズ全体スケール ----
        if (this.baseRadii) {
            // 0.55〜1.6 倍でリスケール（大きい時は目立つ、小さい時は繊細）
            const sizeScale = 0.55 + r() * 1.05;
            if (!this._baseRadiiOriginal) {
                // 初回だけ元のサイズを保存
                this._baseRadiiOriginal = new Float32Array(this.baseRadii);
            }
            for (let i = 0; i < this.baseRadii.length; i++) {
                this.baseRadii[i] = this._baseRadiiOriginal[i] * sizeScale;
            }
        }

        // ---- ピンボール力 ----
        this.pinDrift       = r() * 2.5;              // 0〜2.5（大半は静か、たまに活発）
        this.pinFriction    = 0.15 + r() * 0.75;      // 0.15〜0.9
        this.pinRestitution = 0.2  + r() * 0.65;      // 0.2〜0.85

        // ---- うねり振幅ベース ----
        this._warpBase = 8 + r() * 80;                // 8〜88（_updateCloud で mood と合成）

        // ---- 膜パラメータ ----
        if (this._membraneUniforms) {
            this._membraneUniforms.uNoiseAmp.value  = this.membraneRadius * (0.04 + r() * 0.18);
            this._membraneUniforms.uPushAmount.value = this.cloudRadius   * (0.25 + r() * 0.45);
            this._membraneUniforms.uPushRadius.value = this.cloudRadius   * (0.3  + r() * 0.4);
        }
    }

    /**
     * 全パーティクルの基準位置を新しい軌道へ再サンプリングする。
     * 位置は急に飛ばさず、目標として保持して onUpdate で滑らかに寄せる。
     */
    _resampleTargets(shape) {
        const n = this.particles.length;
        if (!this._targetPositions) this._targetPositions = new Float32Array(n * 3);
        const p3 = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
            const density = this._sampleOrbital(shape, p3);
            this._targetPositions[i * 3] = p3.x;
            this._targetPositions[i * 3 + 1] = p3.y;
            this._targetPositions[i * 3 + 2] = p3.z;
            this.densityVal[i] = density;
        }
    }

    /**
     * 時間の要素（必須）：
     *  - actual_tick による連続的なゆっくりした基準サイズの呼吸（振幅は控えめ）
     *  - phase（0〜8の区切り）による「雰囲気」係数 _phaseMood の更新
     *    （前半=静か/締まった黒、後半=広がって活発）
     */
    _updateParticleNoiseScale(dt) {
        // ---- actual_tick：連続呼吸（雲全体の一律サイズ変化は控えめに）----
        const loopTicks = 384 * 96;
        const tickNorm = ((this.actualTick || 0) % loopTicks) / loopTicks;
        const a = Math.sin(tickNorm * Math.PI * 4) * 0.06;
        const b = Math.sin(tickNorm * Math.PI * 11) * 0.03;
        this._particleNoiseScale = 0.95 + a + b;   // 0.86〜1.04 程度（振幅小）

        // ---- phase：曲の進行度（0〜8 → 0〜1）に向けて雰囲気を滑らかに追従 ----
        const phaseNorm = THREE.MathUtils.clamp((this.phase || 0) / 8, 0, 1);
        const k = Math.min(1, (dt ?? 0.016) * 1.2);
        this._phaseMood += (phaseNorm - this._phaseMood) * k;
    }

    /**
     * 確率雲を毎フレーム更新：基準位置へ滑らかに寄せ、うねり・呼吸・脈動・自転・
     * track8 ブーストを反映し、密度に応じて発光させる。
     */
    _updateCloud(dt) {
        if (!this.instancedMeshManager || !this.particles.length) return;
        const t = this.time;
        const n = this.particles.length;
        const noiseScale = this._particleNoiseScale;
        const bp = this.basePositions;
        const tp = this._targetPositions;
        const bm = this._boostMap;
        const dv = this.densityVal;
        const decay = 2.2 * dt;
        const angFriction = Math.exp(-3.0 * dt);   // 自転の摩擦を強めてすぐ落ち着かせる

        // 励起・脈動の減衰
        this.excitation *= Math.exp(-0.7 * dt);
        this.pulse *= Math.exp(-3.0 * dt);
        this.warpLevel *= Math.exp(-0.8 * dt);

        // phase の雰囲気：後半ほど雲がじわっと広がる（曲の展開と同期）。
        const mood = this._phaseMood;
        // 膨張係数：基底1.0 ＋ phase進行で少し広がる ＋ 励起（じわ膨張）＋脈動。
        // ※ excitation は「四方八方に弾ける」のではなく、ゆっくり膨らむだけに使う。
        const expand = 1.0 + mood * 0.25 + this.excitation * 0.6 + this.pulse * 0.25;
        // うねり強度：phase 進行に応じたゆったりした基底のみ。
        // track7(excitation)/track1(warpLevel) でうねりを爆発させない（中心から弾けるのを止める）。
        const warpAmp = (this._warpBase ?? 22) + mood * 55;

        // 目標位置へ寄せる補間係数（モーフ遷移時はゆっくり）
        const lerpK = tp ? Math.min(1, dt * 1.5) : 0;

        // ピンボール物理の係数。反発する壁は「雲全体を包むサイズ」にする。
        // ※膜(membraneRadius)は見た目用に小さいので、それを壁にすると粒が狭所に閉じ込められ
        //   ぐるぐる回るだけに見えてしまう。壁は雲の外周まで広げて、粒が広く漂えるようにする。
        const pv = this._pinVel, po = this._pinOff, pav = this._pinAngVel;
        const pinFric = Math.exp(-this.pinFriction * dt);    // 速度摩擦（弱め＝転がり続ける）
        const angFric = Math.exp(-1.8 * dt);                 // 角速度の慣性減衰
        const wallR = this.cloudRadius * 1.5;                // 反発する内壁半径（雲全体を包む）
        const wallR2 = wallR * wallR;
        const restitution = this.pinRestitution;
        const drift = this.pinDrift;                         // 常時の微弱ドリフト力

        for (let i = 0; i < n; i++) {
            const p = this.particles[i];

            // モーフ目標へ基準位置を寄せる
            if (tp) {
                bp[i * 3] += (tp[i * 3] - bp[i * 3]) * lerpK;
                bp[i * 3 + 1] += (tp[i * 3 + 1] - bp[i * 3 + 1]) * lerpK;
                bp[i * 3 + 2] += (tp[i * 3 + 2] - bp[i * 3 + 2]) * lerpK;
            }

            const bx = bp[i * 3], by = bp[i * 3 + 1], bz = bp[i * 3 + 2];

            // ---- ピンボール物理：オフセットを速度で自由に動かす（バネで戻さない）----
            if (pv && po) {
                // 常時の微弱ドリフト力（track6 無しでもゆっくり漂い続ける）。
                // i と時間で疑似ランダムな方向に少しずつ加速。
                if (drift > 0) {
                    pv[i * 3]     += Math.sin(t * 0.7 + i * 1.3) * drift * dt;
                    pv[i * 3 + 1] += Math.cos(t * 0.6 + i * 2.1) * drift * dt;
                    pv[i * 3 + 2] += Math.sin(t * 0.8 + i * 0.7) * drift * dt;
                }

                // 速度でオフセット移動
                let ox = po[i * 3] + pv[i * 3] * dt;
                let oy = po[i * 3 + 1] + pv[i * 3 + 1] * dt;
                let oz = po[i * 3 + 2] + pv[i * 3 + 2] * dt;

                // 膜の内壁で反発（粒の現在位置 = 基準+オフセット が膜中心からwallRを超えたら跳ね返す）
                const rx = bx + ox, ry = by + oy, rz = bz + oz;
                const rr2 = rx * rx + ry * ry + rz * rz;
                if (rr2 > wallR2) {
                    const rr = Math.sqrt(rr2) || 1;
                    const nx = rx / rr, ny = ry / rr, nz = rz / rr;   // 中心→粒の法線
                    const vdot = pv[i * 3] * nx + pv[i * 3 + 1] * ny + pv[i * 3 + 2] * nz;
                    if (vdot > 0) {
                        pv[i * 3] -= (1 + restitution) * vdot * nx;
                        pv[i * 3 + 1] -= (1 + restitution) * vdot * ny;
                        pv[i * 3 + 2] -= (1 + restitution) * vdot * nz;
                    }
                    const over = rr - wallR;
                    ox -= nx * over; oy -= ny * over; oz -= nz * over;
                }

                // 摩擦のみ（基準へ戻すバネは無し＝キックした分はちゃんと残って漂う）
                pv[i * 3] *= pinFric; pv[i * 3 + 1] *= pinFric; pv[i * 3 + 2] *= pinFric;

                po[i * 3] = ox; po[i * 3 + 1] = oy; po[i * 3 + 2] = oz;
            }

            // うねり：各点を時間で揺らす（有機的な雲のゆらめき）。ゆったり遅めに。
            const ux = Math.sin(by * 0.002 + bz * 0.0015 + t * 0.08 + i * 0.13) * warpAmp;
            const uy = Math.cos(bx * 0.002 - bz * 0.0017 + t * 0.07 + i * 0.21) * warpAmp;
            const uz = Math.sin(bx * 0.0018 - by * 0.0016 + t * 0.09 + i * 0.07) * warpAmp;

            // 位置 = 基準位置 ＋ うねり ＋ ピンボール物理オフセット（expand は位置に掛けない）
            const offX = po ? po[i * 3] : 0;
            const offY = po ? po[i * 3 + 1] : 0;
            const offZ = po ? po[i * 3 + 2] : 0;
            const wx = bx + ux + offX;
            const wy = this.cloudCenterY + by + uy + offY;
            const wz = bz + uz + offZ;
            p.position.set(wx, wy, wz);

            // 速度の大きさから角速度を駆動（慣性で減衰）
            if (pav) {
                const vx = pv[i * 3], vy = pv[i * 3 + 1], vz = pv[i * 3 + 2];
                const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
                if (speed > 0.1) {
                    // 速度ベクトルに垂直な軸で回転させる（クロス積風に近似）
                    const invS = 1 / speed;
                    const scale = speed * 0.00018; // 速度→角速度の変換係数
                    pav[i * 3]     += (-vz * invS) * scale;
                    pav[i * 3 + 1] += ( vx * invS) * scale;
                    pav[i * 3 + 2] += (-vy * invS) * scale;
                }
                // 慣性減衰
                pav[i * 3]     *= angFric;
                pav[i * 3 + 1] *= angFric;
                pav[i * 3 + 2] *= angFric;
                // 回転に積算
                p.rotation.x += pav[i * 3]     * dt;
                p.rotation.y += pav[i * 3 + 1] * dt;
                p.rotation.z += pav[i * 3 + 2] * dt;
            }

            // サイズ：基準 × 呼吸ノイズ × (1 + track8ブースト) × 密度脈動
            let boost = 0;
            if (bm[i] > 0) {
                bm[i] = Math.max(0, bm[i] - decay);
                boost = bm[i];
            }
            // 膨張(expand)は「位置」ではなく「サイズ」に掛ける＝粒自体がデカくなる（散らない）。
            const breath = 1.0 + this.pulse * dv[i] * 0.3;   // 脈動の振幅を控えめに
            const s = this.baseRadii[i] * noiseScale * breath * expand * (1.0 + boost);
            // 軸ごとの非均等スケールで形をランダム化（インスタンシングのまま歪な粒に）
            const sa = this._shapeAspect;
            this._scaleScratch.set(s * sa[i * 3], s * sa[i * 3 + 1], s * sa[i * 3 + 2]);
            this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, this._scaleScratch);
        }
        this.instancedMeshManager.markNeedsUpdate();

        // 発光はしない：ずっとカッコいい黒（チャコール）のまま固定。
        // 脈動で赤紫に色づくのを止める（emissiveIntensity は 0 固定）。
    }

    // ===== カメラ =====

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 3800;
        cameraParticle.maxDistance = 7500;
        cameraParticle.maxDistanceReset = 6800;
        cameraParticle.minY = STUDIO_FLOOR_TOP_Y + 200;
        cameraParticle.maxY = this.ceilingY - 200;
        cameraParticle.initializePosition?.();
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
            p.minDistance = 3800;
            p.maxDistance = 7500;
            p.boxMin = null;
            p.boxMax = null;
            p.maxSpeed = 8.0;
        });
        const dist = 4200 + Math.random() * 3000;
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.3) * 0.9;
        cp.position.set(
            Math.sin(yaw) * Math.cos(pitch) * dist,
            this.cloudCenterY + Math.sin(pitch) * dist,
            Math.cos(yaw) * Math.cos(pitch) * dist
        );
        cp.applyRandomForce?.();
    }

    updateCamera() {
        const dt = 0.016; // 概算。_updateLookTarget に deltaTime を渡せないので固定近似

        // 注視点：ランダムなパーティクルをゆっくり追従（4〜9秒ごとに切り替え）
        this._lookSwitchTimer -= dt;
        if (this._lookSwitchTimer <= 0 && this.particles.length > 0) {
            this._lookTargetIdx = Math.floor(Math.random() * this.particles.length);
            this._lookSwitchTimer = 4 + Math.random() * 5;
        }
        const targetP = this.particles[this._lookTargetIdx];
        if (targetP) {
            // なめらかに追従（lerp係数 0.012 ＝ ゆっくり）
            this._lookTarget.lerp(targetP.position, 0.012);
        }

        if (this.trackEffects[1] && this.cameraParticles[this.currentCameraIndex]) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            const basePos = cp.getPosition().clone();
            const t = this.time;
            const distNoise = Math.sin(t * 0.08) * 350 + Math.sin(t * 0.031) * 500 + Math.sin(t * 0.017) * 250;
            const toCenter = this._lookTarget.clone().sub(basePos).normalize();
            basePos.addScaledVector(toCenter, distNoise);
            basePos.x = THREE.MathUtils.clamp(basePos.x, -(this.roomHalfW - 200), this.roomHalfW - 200);
            basePos.y = THREE.MathUtils.clamp(basePos.y, this.floorTopY + 200, this.ceilingY - 200);
            basePos.z = THREE.MathUtils.clamp(basePos.z, -(this.roomHalfD - 200), this.roomHalfD - 200);
            this.camera.position.copy(basePos);
            this.camera.lookAt(this._lookTarget.x, this._lookTarget.y, this._lookTarget.z);
            this.camera.matrixWorldNeedsUpdate = false;
            return;
        }
        this.camera.lookAt(this._lookTarget.x, this._lookTarget.y, this._lookTarget.z);
        this.camera.matrixWorldNeedsUpdate = false;
    }

    // ===== setup =====

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

        this.camera.fov = 42;
        this.camera.near = 12;
        this.camera.far = 15000;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, this.cloudCenterY, 3800);
        this.camera.lookAt(0, this.cloudCenterY, 0);
        this._centerSmoothed.set(0, this.cloudCenterY, 0);

        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;

        const L = this.sceneLightingScale;
        this.studio = new StudioBox(this.scene, {
            ...studioBoxOptionsForStudioRoom(L, this._roomEnvTexture),
            useLights: false
        });
        if (this.studio.studioBox) this.studio.studioBox.visible = false;

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
        this.createAmbientFloatingParticles();

        this.createCloud();
        this._buildMembrane();

        this.setupCameraParticleDistances();
        this.initPostProcessing();
        this.initialized = true;
    }

    // ===== onUpdate =====

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;

        this.currentVisibleCount = this.particleCount2;
        this.setParticleCount(this.particleCount2);

        this._updateParticleNoiseScale(deltaTime);
        this._updateOrbitalMorph();
        this._updateCloud(deltaTime);
        this._updateMembrane(deltaTime);

        this.atmosphere?.update(deltaTime, this.time, this._centerSmoothed);

        this.updateCamera();

        // 固定 DOF（Scene08 流：オートフォーカスは使わない）
        if (this.bokehPass?.uniforms?.focus) {
            this._dofCamDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            this._dofToTarget.copy(this._centerSmoothed).sub(this.camera.position);
            const targetFocus = Math.max(100, this._dofToTarget.dot(this._dofCamDir));
            const u = this.bokehPass.uniforms.focus;
            u.value += (targetFocus - u.value) * 0.06;
        }
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);

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

    handleOSC(message) {
        const tn = Scene09.parseTrackNumber(message?.trackNumber, message);
        const args = message?.args || [];
        const velocity = args.length > 1 ? Number(args[1]) : 100;
        const durationMs = args.length > 2 ? Number(args[2]) : 0;

        // track1: カメラランダマイズ＋雲に揺らぎ
        if (tn === 1) {
            this.warpLevel = Math.min(2.0, this.warpLevel + 0.4);
            if (this.trackEffects[1]) this.switchCameraRandom();
            return;
        }

        // track6: ピンボールキック（全粒に弱いランダム力を与え、膜内で反発させる）
        if (tn === 6) {
            if (this._pinVel) {
                const v = Math.max(0, Math.min(127, velocity)) / 127;
                const kick = this.pinKickMin + (this.pinKickMax - this.pinKickMin) * v;
                const pv = this._pinVel;
                const n = this.particles.length;
                for (let i = 0; i < n; i++) {
                    // 各粒にランダム方向の速度インパルスを加算（粒ごとに強さもばらつかせる）
                    const k = kick * (0.5 + this._rand());
                    const tx = this._rand() * 2 - 1;
                    const ty = this._rand() * 2 - 1;
                    const tz = this._rand() * 2 - 1;
                    const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
                    pv[i * 3] += (tx / len) * k;
                    pv[i * 3 + 1] += (ty / len) * k;
                    pv[i * 3 + 2] += (tz / len) * k;
                }
            }
            return;
        }

        // track7: 励起（雲が膨張してうねる）
        if (tn === 7) {
            const v = Math.max(0, Math.min(127, velocity)) / 127;
            this.excitation = Math.min(2.0, this.excitation + 0.5 + v * 1.2);
            this.warpLevel = Math.min(2.0, this.warpLevel + 0.5);
            return;
        }

        // track8: 局所密度ブースト。振幅は控えめ＋空間ノイズで「ところどころ膨らむ」斑模様に。
        if (tn === 8) {
            if (this._boostMap && this.basePositions) {
                const v = velocity / 127.0;
                // 振幅を小さく（最大でも +0.9 倍程度。元は +4.0 倍で激しすぎた）
                const maxBoost = 0.25 + v * 0.65;
                // ブースト中心：ランダムなパーティクル位置（雲ローカル）
                const ci = Math.floor(this._rand() * this.particles.length);
                const cx = this.basePositions[ci * 3];
                const cy = this.basePositions[ci * 3 + 1];
                const cz = this.basePositions[ci * 3 + 2];
                const r = this.cloudRadius * 0.55;
                const r2 = r * r;
                // この発火ごとにノイズ位相をずらす（毎回違う斑模様に）
                const np = this._rand() * 100;
                const n = this.particles.length;
                for (let i = 0; i < n; i++) {
                    const px = this.basePositions[i * 3];
                    const py = this.basePositions[i * 3 + 1];
                    const pz = this.basePositions[i * 3 + 2];
                    const dx = px - cx, dy = py - cy, dz = pz - cz;
                    const d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 > r2 * 4) continue;
                    const gauss = Math.exp(-d2 / (r2 * 0.5));
                    // 3D空間ノイズ（位置ベースのうねり）で「膨らむ場所」を斑にする。
                    // 0未満は膨らまない＝ところどころだけ盛り上がる。
                    const ns = 0.004;
                    const noise =
                        Math.sin(px * ns + np) * 0.5 +
                        Math.sin(py * ns * 1.7 - np * 0.6) * 0.3 +
                        Math.sin(pz * ns * 2.3 + np * 1.3) * 0.2;
                    const patch = Math.max(0, noise);        // 0〜1、斑（まだら）
                    const boost = maxBoost * gauss * patch;
                    if (boost > this._boostMap[i]) this._boostMap[i] = boost;
                }
            }
            return;
        }

        // track9: 全体パルス（雲が脈動）
        if (tn === 9) {
            const v = Math.max(0, Math.min(127, velocity)) / 127;
            this.pulse = Math.min(1.5, this.pulse + 0.5 + v * 0.7);
            return;
        }

        // track2/3/4 のエフェクト、/phase、/tick、/kit などは親に委譲
        super.handleOSC(message);
    }

    handleTrackNumber(trackNumber, message) {
        // handleOSC 側で完結しているので何もしない
    }

    // ===== initPostProcessing（Scene08/Scene12 流）=====

    initPostProcessing() {
        setupPostEffectsPipeline(this, {
            dofFocus: 3800,
            dofAperture: 0.0000012,
            dofMaxBlur: 0.0026,
            bloomStrength: 0.10,
            bloomRadius: 0.32,
            bloomThreshold: 0.82,
            // SSAO は弱め（粒の黒ハロ＝アニメ風縁取りを抑える）
            ssaoKernelRadius: this.ssaoNearKernelRadius,
            ssaoMinDistance: this.ssaoNearMinDistance,
            ssaoMaxDistance: this.ssaoNearMaxDistance,
            filmGrainIntensity: 0.15,
            filmGrainGrayscale: false
        });
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
                    for (const tex of [m.map, m.bumpMap, m.normalMap, m.roughnessMap, m.aoMap]) {
                        if (tex && !seenTex.has(tex)) {
                            seenTex.add(tex);
                            tex.dispose();
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

        // SSAO パス＋深度テクスチャ
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

        // 赤いメタボール膜
        if (this.membrane) {
            this.scene.remove(this.membrane);
            this.membrane.geometry.dispose();
            this.membraneMat?.dispose();
            this.membrane = null;
            this.membraneMat = null;
        }
        // 赤い節点
        if (this._nodeMesh) {
            this.scene.remove(this._nodeMesh);
            this._nodeMesh.geometry.dispose();
            this._nodeMat?.dispose();
            this._nodeMesh = null;
            this._nodeMat = null;
        }
        this._nodeBasePos = null;
        this._influencerIdx = null;

        // 確率雲
        if (this.instancedMeshManager) {
            this.instancedMeshManager.dispose();
            this.instancedMeshManager = null;
        }
        // 肉質テクスチャを解放
        if (this._fleshTextures) {
            for (const tex of Object.values(this._fleshTextures)) {
                tex?.dispose?.();
            }
            this._fleshTextures = null;
        }
        this._cloudMat = null;
        this.particles = [];
        this.basePositions = null;
        this.baseRadii = null;
        this.densityVal = null;
        this._boostMap = null;
        this._targetPositions = null;
        this._pinVel = null;
        this._pinOff = null;
        this._shapeAspect = null;

        // コールアウトを片付ける
        if (this.calloutSystem) {
            for (const c of this.calloutSystem.callouts) {
                if (c.mesh3D) this.calloutSystem.disposeCallout3DMesh(c);
            }
            this.calloutSystem.callouts = [];
            this.calloutSystem.lastCalloutTime = 0;
        }
        this.calloutReady = false;

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
