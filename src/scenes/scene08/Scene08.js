/**
 * Scene08: コンクリート空間（床＋壁＋StudioBox 相当の天井発光）
 * メインオブジェクト：トラック9で金属片（args[2]=デュレーションmsでサイズ、velocityで金属トーンの明るさ）
 * トラック5：赤シリンダ（args[2]=デュレ、ノート番号は args[0]）。トラック6：部屋中心付近スフィア（args[2]=デュレ、track9SpawnDuringDuration でデュレ中に間隔スポーン可）
 * 天井＋シャドウ Spot は StudioBox.attachCeilingSpotRig。埋め Spot のみこのシーン内。
 * 床・壁は StudioBox と同じタイル目地＋床の赤十字・番号（Scene16 同型）。ポスト・フォグ・大気チリは lib/presentation を参照。
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
    AtmosphericDustField,
    applyStudioRoomToneAndBackdrop,
    setupStudioRoomEnvironmentMap,
    disposeStudioRoomEnvironmentMap,
    studioBoxOptionsForStudioRoom,
    ceilingSpotRigOptionsForStudioRoom,
    setupStudioRoomPromoWallFillLight,
    applyStudioRoomFloorWallEnvMaps
} from '../../lib/presentation/index.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { Scene05Particle } from '../scene05/Scene05Particle.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import helvetikerFontUrl from 'three/examples/fonts/helvetiker_regular.typeface.json?url';

export class Scene08 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenomist';
        this.initialized = false;
        this.sceneNumber = 8;
        this.kitNo = 21;
        this.sharedResourceManager = sharedResourceManager;

        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        /** 北壁の extruded 3D タイトル（Helvetiker / 艶・反射） */
        this.wallTitleGroup = null;
        this._wallTitleMaterial = null;

        this.cubeRenderTarget = null;
        this.cubeCamera = null;

        /** トラック9で生える金属片 — GPU インスタンス（1 InstancedMesh） */
        this.shards = [];
        /** この個数を超えたら古い順に削除（安全上限）。普段は shardLifetimeMs で消える */
        this.maxShards = 2000;
        /** トラック9金属片・トラック5シリンダのサイズ倍率（比率を保ったまま拡大） */
        this.shardCylinderVisualScale = 1.5;
        /** 1=標準。下げると照明・露出・環境反射をまとめて暗くする（フォグ色は setup で固定） */
        this.sceneLightingScale = 0.32;
        /** 各破片がこの時間（ms）経過したら削除 */
        this.shardLifetimeMs = 180000;
        /** 寿命終盤でフェードアウトする時間（ms） */
        this.shardFadeOutMs = 1800;
        this.cylinderFadeOutMs = 1800;
        /** 生成時に 0→目標サイズへ伸びる時間（ms） */
        this.shardGrowInMs = 420;
        this.cylinderGrowInMs = 420;
        this._cylinderOpacityAttr = null;
        this.shardGroup = null;
        this.shardInstMesh = null;
        this._shardOpacityAttr = null;
        /** インスタンススロットの空きスタック（0..maxShards-1） */
        this._shardFreeSlots = [];
        this._metalShardMaterial = null;
        this._shardMatrixTemp = new THREE.Matrix4();
        this._shardQuatTemp = new THREE.Quaternion();
        this._shardScaleTemp = new THREE.Vector3();
        this._shardPosTemp = new THREE.Vector3();
        this._spawnWorldPosTemp = new THREE.Vector3();
        this._lastShardPos = new THREE.Vector3(0, 550, 0);
        this._snakeDir = new THREE.Vector3(0, 0.12, 1).normalize();
        /** 残像ヘッド：金属片/赤シリンダーで別系統のカールノイズを使う */
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
        /** 金属片：部屋中央付近に留める引力 */
        this._trailCenterPull = 0.7;
        /** 赤シリンダー：センタープルは円環周回の主因なのでオフ（カールのみ） */
        this._trailCenterPullCylinder = 0;
        /** カール入力座標の固定オフセット（原点対称の渦を避ける） */
        this._cylinderCurlFieldOffset = new THREE.Vector3(831.2, -1949.5, 722.4);
        this._curlCylPosScratch = new THREE.Vector3();
        /** シリンダー用カールの数値微分ステップ（freq とセットで空間スケールに合わせる） */
        this._trailCurlEpsCylinder = 5.2;
        this._trailYawAmp = 0.42;
        this._trailPitchAmp = 0.28;
        this._trailRollAmp = 0.36;
        /** 直近スポーンしたオブジェクトのワールド座標（カメラ注視） */
        this._spawnFocusWorld = new THREE.Vector3(0, 550, 0);
        this._cameraFocusSmoothed = new THREE.Vector3(0, 550, 0);
        /** 旧 tick ベース生成の互換用カウンタ（色/形ノイズ種） */
        this._lastSpawnTickTrack5 = null;
        this._snakeIndex = 0;
        this._shardSeed = Math.random() * 1000;
        this._shardHeatColor = new THREE.Color();
        this._cylinderTintTemp = new THREE.Color();
        this._instanceWhite = new THREE.Color(0xffffff);
        this._instanceBlack = new THREE.Color(0x000000);
        /** トラック9スフィアの基準色（濃淡ランダムの中心） */
        this._track9SphereColorAtMax = new THREE.Color(0xd5d9df);
        this._track9SphereEmissiveAtMax = new THREE.Color(0x2a2d32);
        /** ニュートラルグレー（R 偏重を避け赤みを出さない） */
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
        /** false でシーンの FogExp2 をオフ */
        this.useSceneFog = true;
        /** FogExp2 の密度（小さいほど薄い）— 以前 0.00017 より控えめ */
        this.sceneFogDensity = 0.00009;
        /** 既定は {@link THREE.Scene#background} と同系色（遠景が背景に溶ける） */
        this.sceneFogColor = 0x151820;
        // フォグと併用。コーナーで過暗化しにくいよう minDistance・kernel を控えめに
        this.useSSAO = true;
        this.useFilmGrain = true;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        /** SSAO を強め（kernel / 距離バンド / 遠景での減衰を緩める） */
        this.ssaoNearKernelRadius = 9.2;
        this.ssaoNearMinDistance = 0.018;
        this.ssaoNearMaxDistance = 0.165;
        this.ssaoFarAttenuation = 0.62;
        // Scene08 は固定DOFを優先（オートフォーカスで効きが薄く見えるのを防ぐ）
        this.useAutoFocusDOF = false;
        /** composer では最後に必須：renderer.toneMapping / 出力色空間を画面に適用 */
        this.outputPass = null;

        this.trackEffects = {
            1: true,
            2: false,
            3: false,
            4: false,
            5: true,
            6: true,
            7: true,
            8: true,
            9: true
        };
        this.setScreenshotText(this.title);

        if (this.calloutSystem) {
            this.calloutSystem.setUse3DCallouts(true);
            this.calloutSystem.setLabels(['CONCRETE', 'PBR', 'AO', 'ACES']);
        }

        /** StudioBox と同スケール（内寸の目安） */
        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;

        /** Scene16 と同様：OSC のトラック強度（5/6=力, 7=色相系） */
        this.trackValues = { 5: 0, 6: 0, 7: 0 };
        this.smoothTrack7Color = 0;
        this.cableHomeY = 550;
        this.cableBlobParticle = null;

        /** Scene13 風：大気チリ（{@link AtmosphericDustField}） */
        this.ambientParticleCount = 2000;
        this.ambientDust = null;
        /** 破片・シリンダ・トラック9スポーンに同期して出し、寿命で消す */
        this.ambientParticleLifetimeMs = 11000;
        this.ambientParticleFadeOutMs = 1400;
        this.ambientParticlesPerShard = 10;
        this.ambientParticlesPerCylinder = 12;
        this.ambientParticlesPerTrack9 = 16;
        this.ambientMinLiving = 180;

        /** 赤いシリンダ（InstancedMesh、scene 直下ワールド座標。OSC はトラック5） */
        this.cylinderInstMesh = null;
        this.cylinders = [];
        this.maxCylinders = 640;
        /** 赤シリンダー：長さはベロシティ、半径（細さ）はデュレーション */
        this.cylinderLifetimeMs = 180000;
        this._cylinderFreeSlots = [];
        this._redCylinderMaterial = null;
        this._cylinderMatrixTemp = new THREE.Matrix4();
        this._cylinderQuatTemp = new THREE.Quaternion();
        this._cylinderRollQuat = new THREE.Quaternion();
        /** 進行方向に直交する横軸（side）周りのチルト用 */
        this._cylinderTiltXQuat = new THREE.Quaternion();
        /** DNA 螺旋の「塩基対」みたいに、スポーンごとに進行方向周りの位相が一定ずつ進む */
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
        /** OSC actual_tick ベースのスポーン予約（シリンダ＝トラック5） */
        this._lastSpawnTickTrack6 = null;
        /** シリンダー生成時の石バースト（インスタンシング5000粒） */
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

        /** 常時漂う黒曜石風のチャコール四角形（カールノイズ） */
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

        /** トラック9：ワールド中心付近スポーンの物理スフィア（チャコール調） */
        this.track9SphereGroup = null;
        this.track9Spheres = [];
        this.maxTrack9Spheres = 280;
        /** true: args[2] のデュレーション（ms）が終わるまで一定間隔でスポーン。false: ノートオンで1回のみ */
        this.track9SpawnDuringDuration = true;
        /** デュレーション中スポーンの間隔（ms）。下限はフレーム間隔程度 */
        this.track9DurationSpawnIntervalMs = 52;
        this._track9SpawnWindowEndMs = 0;
        this._track9SpawnWindowVelocity = 127;
        this._track9LastDurationSpawnMs = 0;
        this.track9SharedGeo = null;
        this._track9SphereMaterial = null;
        this._track9FleshTextures = null;
        this.track9PhysicsGrid = new Map();
        this.track9GridSize = 240;
        /** 弱め＝床に吸われにくく漂いやすい（ドリフト加速度と併用） */
        this._track9Gravity = new THREE.Vector3(0, -9, 0);
        this._track9SpawnPos = new THREE.Vector3();
        /** トラック9：アンビエントBoxと同じ部屋内の基準高さ（ワールド中心＝XZ=0） */
        this._track9WorldCenter = new THREE.Vector3(0, 0, 0);
        this._track9Diff = new THREE.Vector3();
        /** スフィア漂い用の加速度（毎フレーム計算） */
        this._track9SphereDrift = new THREE.Vector3();
        this._track9SubSteps = 2;
        /** スポーン直後、半径が 0→目標まで伸びる時間（秒） */
        this._track9BirthGrowSec = 0.42;
        /** メッシュ・物理半径の全体倍率（見た目の大きさ） */
        this._track9SphereVisualScale = 0.65;

        /** 南壁レーザー用スポットの注視点 */
        this.promoWallFillLight = null;
        this.promoWallLightTarget = null;
        /** 壁周りレーザースキャン（1 小節＝TICK_LOOP/96 tick で一周） */
        this.laserScanMesh = null;
        this._laserScanMaterial = null;
        /** フォグの偏りを作るための薄いノイズ空気ボリューム */
        this.airNoiseVolume = null;
        this.airNoiseMaterial = null;
        this._wallCenterY = this.floorTopY + (this.ceilingY - this.floorTopY) * 0.5;
        this._laserHalfW = this.roomHalfW - 240;
        this._laserHalfD = this.roomHalfD - 240;
    }

    /** 96小節ループ想定（Scene16 と同系）。actual_tick の差分で歩幅を決める */
    static TICK_LOOP = 36864;
    static METERS_PER_TICK_SHARD = 2.45;
    static METERS_PER_TICK_CYLINDER = 2.45;
    /**
     * InstancedMesh 用：インスタンスごとの不透明度（instanceOpacity 属性）
     * depthWrite を有効にして、回転時の描画順由来の浮き感を抑える。
     */
    static _attachInstanceOpacityAttribute(geometry, count) {
        const a = new Float32Array(count);
        a.fill(0);
        const attr = new THREE.InstancedBufferAttribute(a, 1);
        attr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('instanceOpacity', attr);
        return attr;
    }

    static _applyInstanceOpacityShader(material) {
        material.transparent = true;
        material.depthWrite = true;
        material.onBeforeCompile = (shader) => {
            shader.vertexShader = 'attribute float instanceOpacity;\nvarying float vInstanceOpacity;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                'vInstanceOpacity = instanceOpacity;\n#include <begin_vertex>'
            );
            shader.fragmentShader = 'varying float vInstanceOpacity;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <opaque_fragment>',
                `#include <opaque_fragment>
                gl_FragColor.a *= vInstanceOpacity;`
            );
        };
    }

    /**
     * 赤シリンダ専用：インスタンス不透明度＋ビュー空間でプロシージャルな法線摂動（画像テクスチャなし）
     */
    static _applyRedCylinderShader(material) {
        material.transparent = true;
        material.depthWrite = true;
        material.onBeforeCompile = (shader) => {
            shader.vertexShader =
                'attribute float instanceOpacity;\nvarying float vInstanceOpacity;\nvarying vec3 vCylinderWPos;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                'vInstanceOpacity = instanceOpacity;\n#include <begin_vertex>'
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
    vCylinderWPos = worldPosition.xyz;
#else
    {
        vec4 wp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        vCylinderWPos = wp.xyz;
    }
#endif
`
            );
            shader.fragmentShader =
                'varying float vInstanceOpacity;\nvarying vec3 vCylinderWPos;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
float cylinderSurfH( vec3 v ) {
    float t = 0.0035;
    float h = sin( v.x * t * 1.7 + v.y * t * 2.1 ) * cos( v.z * t * 1.9 );
    h += sin( dot( v * ( t * 2.3 ), vec3( 1.1, 0.7, 2.3 ) ) ) * 0.38;
    h += sin( dot( v * ( t * 14.0 ), vec3( 1.7, 2.1, 0.9 ) ) ) * 0.12;
    h += sin( dot( v * ( t * 41.0 ), vec3( 0.9, 1.3, 1.7 ) ) ) * 0.045;
    return h;
}
`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `#include <normal_fragment_maps>
{
    vec3 vp = ( viewMatrix * vec4( vCylinderWPos, 1.0 ) ).xyz;
    float e = 1.35;
    float dx = cylinderSurfH( vp + vec3( e, 0.0, 0.0 ) ) - cylinderSurfH( vp - vec3( e, 0.0, 0.0 ) );
    float dy = cylinderSurfH( vp + vec3( 0.0, e, 0.0 ) ) - cylinderSurfH( vp - vec3( 0.0, e, 0.0 ) );
    float dz = cylinderSurfH( vp + vec3( 0.0, 0.0, e ) ) - cylinderSurfH( vp - vec3( 0.0, 0.0, e ) );
    vec3 grad = vec3( dx, dy, dz );
    normal = normalize( normal - grad * 0.1 );
}
`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <opaque_fragment>',
                `#include <opaque_fragment>
                gl_FragColor.a *= vInstanceOpacity;`
            );
        };
    }

    /** 寿命終盤：フェード区間で不透明度 1→0（線形） */
    _fadeOpacity01(elapsedMs, lifeMs, fadeOutMs) {
        const fade = Math.min(fadeOutMs, lifeMs * 0.35);
        const t0 = Math.max(0, lifeMs - fade);
        if (elapsedMs <= t0) return 1;
        if (elapsedMs >= lifeMs) return 0;
        const t = (elapsedMs - t0) / (lifeMs - t0);
        // 線形よりも緩やかに落とす（ふわっと透明化）
        const eased = t * t * (3 - 2 * t);
        return 1 - eased;
    }

    _growScale01(elapsedMs, growMs) {
        const g = Math.max(1, Number(growMs) || 1);
        const t = THREE.MathUtils.clamp(elapsedMs / g, 0, 1);
        return t * t * (3 - 2 * t);
    }

    _growInMsFromDuration(durationMs, baseGrowMs) {
        const d = Math.max(1, Number(durationMs) || 180);
        // duration が長いほど生まれる速度をゆっくりにする（短音は素早く立ち上がる）
        const k = THREE.MathUtils.clamp(d / 700, 0.35, 2.1);
        return baseGrowMs * k;
    }

    _updateFadeOpacity() {
        const now = performance.now();
        if (this._shardOpacityAttr && this.shards.length) {
            const arr = this._shardOpacityAttr.array;
            let dirty = false;
            let matrixDirty = false;
            for (const s of this.shards) {
                const age = now - s.spawnTime;
                const op = this._fadeOpacity01(age, this.shardLifetimeMs, this.shardFadeOutMs);
                const i = s.slotIndex;
                if (Math.abs(arr[i] - op) > 1e-4) {
                    arr[i] = op;
                    dirty = true;
                }
                const grow = this._growScale01(age, s.growInMs ?? this.shardGrowInMs);
                if (grow < 0.999 && s.baseScaleVec && s.localPos && s.localQuat) {
                    this._shardScaleTemp.copy(s.baseScaleVec).multiplyScalar(grow);
                    this._shardMatrixTemp.compose(s.localPos, s.localQuat, this._shardScaleTemp);
                    this.shardInstMesh.setMatrixAt(i, this._shardMatrixTemp);
                    matrixDirty = true;
                }
            }
            if (dirty) this._shardOpacityAttr.needsUpdate = true;
            if (matrixDirty && this.shardInstMesh) this.shardInstMesh.instanceMatrix.needsUpdate = true;
        }
        if (this._cylinderOpacityAttr && this.cylinders.length) {
            const arr = this._cylinderOpacityAttr.array;
            let dirty = false;
            let matrixDirty = false;
            for (const c of this.cylinders) {
                const age = now - c.spawnTime;
                const op = this._fadeOpacity01(age, this.cylinderLifetimeMs, this.cylinderFadeOutMs);
                const i = c.slotIndex;
                if (Math.abs(arr[i] - op) > 1e-4) {
                    arr[i] = op;
                    dirty = true;
                }
                const grow = this._growScale01(age, c.growInMs ?? this.cylinderGrowInMs);
                if (grow < 0.999 && c.baseRadius != null && c.baseLength != null && c.localPos && c.localQuat) {
                    this._cylinderScaleTemp.set(c.baseRadius * grow, c.baseLength * grow, c.baseRadius * grow);
                    this._cylinderMatrixTemp.compose(c.localPos, c.localQuat, this._cylinderScaleTemp);
                    this.cylinderInstMesh.setMatrixAt(i, this._cylinderMatrixTemp);
                    matrixDirty = true;
                }
            }
            if (dirty) this._cylinderOpacityAttr.needsUpdate = true;
            if (matrixDirty && this.cylinderInstMesh) this.cylinderInstMesh.instanceMatrix.needsUpdate = true;
        }
    }

    /**
     * @param {number} nowTick
     * @param {number|null} prevTick 前回スポーン時の tick
     * @returns {number} 同一 tick 連打は小さめステップだが詰まりすぎないよう離す
     */
    _tickDelta(nowTick, prevTick) {
        const n = Math.floor(Number.isFinite(nowTick) ? nowTick : 0);
        if (prevTick === null || prevTick === undefined) return 1;
        let d = n - Math.floor(prevTick);
        const loop = Scene08.TICK_LOOP;
        if (d < -loop * 0.5) d += loop;
        if (d > loop * 0.5) d -= loop;
        if (d <= 0) return 1.12;
        return d;
    }

    /**
     * 直前スポーンからの tick 差が大きいほどランダム幅が増える
     */
    _applySequenceAwareJitter(pos, deltaTick, forwardDir, seedA, seedB) {
        const gap = Math.max(0, deltaTick - 0.22);
        const t = THREE.MathUtils.clamp(Math.log1p(gap) / Math.log1p(72), 0, 1);
        const amp = THREE.MathUtils.lerp(14, 420, t);
        const worldUp = new THREE.Vector3(0, 1, 0);
        this._jitterSide.crossVectors(worldUp, forwardDir);
        if (this._jitterSide.lengthSq() < 1e-8) {
            this._jitterSide.crossVectors(new THREE.Vector3(1, 0, 0), forwardDir);
        }
        this._jitterSide.normalize();
        this._jitterUp.crossVectors(forwardDir, this._jitterSide);
        this._jitterUp.normalize();
        const a1 = (this._shardNoise(seedA, seedB, 0.11) - 0.5) * 2;
        const a2 = (this._shardNoise(seedB, seedA, 0.22) - 0.5) * 2;
        const a3 = (this._shardNoise(seedA * 0.31, seedB * 0.29, 0.33) - 0.5) * 2;
        pos.addScaledVector(this._jitterSide, a1 * amp * 0.52);
        pos.addScaledVector(this._jitterUp, a2 * amp * 0.44);
        pos.addScaledVector(worldUp, a3 * amp * 0.26);
    }

    /**
     * ベロシティ（0〜127）→ シリンダ長。弱打ち〜強打ちで差を付ける
     */
    _cylinderLengthFromVelocityMidi(vMidi) {
        const v = THREE.MathUtils.clamp(Number(vMidi) || 0, 0, 127);
        const tLin = v / 127;
        const tLog = Math.log1p(v) / Math.log1p(127);
        const t = THREE.MathUtils.lerp(tLog, tLin, 0.72);
        const lenMin = 88;
        const lenMax = 340;
        return THREE.MathUtils.lerp(lenMin, lenMax, t);
    }

    /**
     * デュレーション（ms）→ 半径（細さ）。極短・極長で差が出過ぎないよう log で圧縮
     */
    _cylinderRadiusFromDurationMs(durationMs) {
        const d = Math.max(8, Number(durationMs) || 180);
        const dMin = 20;
        const dMax = 2400;
        const tLin = THREE.MathUtils.clamp((d - dMin) / (dMax - dMin), 0, 1);
        const tLog = THREE.MathUtils.clamp(Math.log(d / dMin) / Math.log(dMax / dMin), 0, 1);
        const t = THREE.MathUtils.lerp(tLog, tLin, 0.85);
        const radMin = 10;
        const radMax = 34;
        return THREE.MathUtils.lerp(radMin, radMax, t);
    }

    /** 床・壁タイルの目地分割（小さいほど1枚が大きく見える）。drawGroutLines と一致させる */
    static TILE_OVERLAY_DIVISIONS = 26;

    /** OSC の trackNumber が数値化できない／未設定のときは address から拾う */
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

    /** Scene16 と同じカメラ距離 */
    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 750;
        cameraParticle.maxDistance = 4850;
        cameraParticle.maxDistanceReset = 4500;
        cameraParticle.minY = -200;
        cameraParticle.maxY = 4500;
        cameraParticle.initializePosition?.();
    }

    /**
     * 金属片（トラック9）とシリンダ（トラック5）の「最後に生えた」インスタンスのワールド位置を注視にする。
     * 両方そろっているときはスポーン時刻の新しさで重み付けブレンドし、どちらか一方だけを追う切替で迷わないようにする。
     */
    _updateCameraFocusFromSpawns() {
        const hasS = this.shards.length > 0 && this.shardInstMesh && this.shardGroup;
        const hasC = this.cylinders.length > 0 && this.cylinderInstMesh;

        if (!hasS && !hasC) {
            if (this.cableBlobParticle) {
                this._spawnFocusWorld.copy(this.cableBlobParticle.position);
            }
            return;
        }

        const now = performance.now();

        if (hasS) {
            const s = this.shards[this.shards.length - 1];
            this.shardInstMesh.getMatrixAt(s.slotIndex, this._shardMatrixTemp);
            this._shardPosTemp.setFromMatrixPosition(this._shardMatrixTemp);
            this.shardGroup.updateMatrixWorld(true);
            this.shardGroup.localToWorld(this._shardPosTemp);
        }
        if (hasC) {
            const c = this.cylinders[this.cylinders.length - 1];
            this.cylinderInstMesh.getMatrixAt(c.slotIndex, this._cylinderMatrixTemp);
            this._cylinderPosTemp.setFromMatrixPosition(this._cylinderMatrixTemp);
        }

        if (hasS && hasC) {
            const eps = 80;
            const ageS = Math.max(0, now - this.shards[this.shards.length - 1].spawnTime);
            const ageC = Math.max(0, now - this.cylinders[this.cylinders.length - 1].spawnTime);
            const wS = 1 / (eps + ageS);
            const wC = 1 / (eps + ageC);
            const inv = 1 / (wS + wC);
            this._spawnFocusWorld.copy(this._shardPosTemp).multiplyScalar(wS * inv);
            this._spawnFocusWorld.addScaledVector(this._cylinderPosTemp, wC * inv);
        } else if (hasS) {
            this._spawnFocusWorld.copy(this._shardPosTemp);
        } else {
            this._spawnFocusWorld.copy(this._cylinderPosTemp);
        }
    }

    updateCamera() {
        if (this.cameraParticles[this.currentCameraIndex]) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            const cameraPos = cp.getPosition();
            const dist = cameraPos.length();
            if (dist < cp.minDistance) {
                cameraPos.normalize().multiplyScalar(cp.minDistance);
            }
            this.camera.position.copy(cameraPos);
            this.camera.lookAt(
                this._cameraFocusSmoothed.x,
                this._cameraFocusSmoothed.y,
                this._cameraFocusSmoothed.z
            );
            this.camera.matrixWorldNeedsUpdate = false;
        }
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

    /** Scene12 と同系：肉質テクスチャ（カラー＋バンプ）。トラック9スフィア用。 */
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

    buildRoom() {
        /** Scene16 / StudioBox デフォルトと同じ canvas タイル（目地・床は赤十字＋番号テキスト） */
        const floorTpl = StudioBox.createFloorTileTextures();
        const wallTpl = StudioBox.createWallTileTextures();
        const L = this.sceneLightingScale ?? 1;
        const studioRough = 0.8;
        const floorConcreteMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: floorTpl.map,
            bumpMap: floorTpl.bumpMap,
            bumpScale: 1.0,
            roughness: studioRough * 0.3,
            metalness: 0.2,
            envMapIntensity: 1.0 * 1.3 * (0.55 + 0.45 * L),
            fog: true
        });
        const wallConcreteMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: wallTpl.map,
            bumpMap: wallTpl.bumpMap,
            bumpScale: 1.0,
            roughness: studioRough * 0.5,
            metalness: 0.1,
            envMapIntensity: 1.0 * (0.55 + 0.45 * L),
            fog: true
        });

        this.roomGroup = new THREE.Group();
        const hw = this.roomHalfW;
        const hd = this.roomHalfD;
        const floorTopY = this.floorTopY;
        const ceilingY = this.ceilingY;
        const wallH = ceilingY - floorTopY;
        const wallCenterY = floorTopY + wallH * 0.5;
        const slab = 24;

        const floorGeo = new THREE.BoxGeometry(hw * 2, slab, hd * 2, 1, 1, 1);
        const floor = new THREE.Mesh(floorGeo, floorConcreteMat);
        floor.position.set(0, floorTopY - slab * 0.5, 0);
        floor.receiveShadow = true;
        floor.castShadow = false;
        this.roomGroup.add(floor);

        const mkWall = (w, height, d, px, py, pz) => {
            const geo = new THREE.BoxGeometry(w, height, d, 1, 1, 1);
            const mesh = new THREE.Mesh(geo, wallConcreteMat);
            mesh.position.set(px, py, pz);
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            this.roomGroup.add(mesh);
        };

        mkWall(slab, wallH, hd * 2, -hw - slab * 0.5, wallCenterY, 0);
        mkWall(slab, wallH, hd * 2, hw + slab * 0.5, wallCenterY, 0);
        mkWall(hw * 2, wallH, slab, 0, wallCenterY, -hd - slab * 0.5);
        mkWall(hw * 2, wallH, slab, 0, wallCenterY, hd + slab * 0.5);

        /** 天井は StudioEmissiveCeilingSpotRig（setup 内で生成） */

        this.scene.add(this.roomGroup);
    }

    /**
     * 北壁（カメラ側から見て奥）に Helvetiker 風 extruded テキスト。厚み＋ベベル。艶・環境反射強め。
     */
    _initWallMatteBlack3DText() {
        if (this.wallTitleGroup) return Promise.resolve();

        return new Promise((resolve) => {
            const loader = new FontLoader();
            loader.load(
                helvetikerFontUrl,
                (font) => {
                    const mat = new THREE.MeshStandardMaterial({
                        color: 0x101318,
                        roughness: 0.22,
                        metalness: 0.22,
                        envMapIntensity: 1.05,
                        clearcoat: 0.88,
                        clearcoatRoughness: 0.14,
                        flatShading: false,
                        fog: true
                    });
                    this._wallTitleMaterial = mat;

                    const group = new THREE.Group();
                    const hd = this.roomHalfD;
                    const wallH = this.ceilingY - this.floorTopY;
                    const wallCenterY = this.floorTopY + wallH * 0.5;
                    /** 内壁は z = -roomHalfD 付近。手前に少し浮かせて Z-fight 回避 */
                    const zText = -hd + 95;

                    /** height = Z 方向の押し出し量。ベベルで縁が立体的に見える */
                    const addLine = (text, size, extrudeDepth, y) => {
                        const bt = Math.max(3, size * 0.05);
                        const bs = Math.max(2.2, size * 0.038);
                        const geo = new TextGeometry(text, {
                            font,
                            size,
                            height: extrudeDepth,
                            curveSegments: 12,
                            bevelEnabled: true,
                            bevelThickness: bt,
                            bevelSize: bs,
                            bevelOffset: 0,
                            bevelSegments: 4
                        });
                        geo.computeBoundingBox();
                        const mesh = new THREE.Mesh(geo, mat);
                        const bb = geo.boundingBox;
                        mesh.position.set(-0.5 * (bb.max.x + bb.min.x), y, 0);
                        /** 壁に落ちるギザ影・コーナー付近の縞を減らすためテキストは影を落とさない */
                        mesh.castShadow = false;
                        mesh.receiveShadow = true;
                        group.add(mesh);
                        return bb.max.y - bb.min.y;
                    };

                    let y = 180;
                    const titleH = addLine('mathym | Xenomist', 280, 118, y);
                    y -= titleH * 1.05 + 140;

                    const bodyLines = [
                        'Real-time WebGL (Three.js). Live OSC / MIDI maps tracks to GPU effects:',
                        'instanced debris, cylinders, spheres; PBR concrete room, HDR environment.',
                        'Pipeline: SSAO, bloom, DOF, ACES tone map, film grain. Procedural noise fields,',
                        'audio-reactive spawn, instancing, and camera focus driven by scene activity.'
                    ];
                    for (const line of bodyLines) {
                        const h = addLine(line, 68, 34, y);
                        y -= h * 1.12 + 28;
                    }

                    group.position.set(0, wallCenterY + wallH * 0.02, zText);
                    this.wallTitleGroup = group;
                    this.scene.add(group);
                    resolve();
                },
                undefined,
                () => {
                    resolve();
                }
            );
        });
    }

    _shardNoise(x, y, z) {
        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return n - Math.floor(n);
    }

    _sampleCurlNoiseVector(pos, time, freq = 0.001, eps = 7.5) {
        const px = pos.x * freq;
        const py = pos.y * freq;
        const pz = pos.z * freq;
        const t = time * 0.16;
        const e = eps * freq;
        const n = (x, y, z) => this._shardNoise(x + t * 0.71, y - t * 0.53, z + t * 0.37);
        const dx = n(px + e, py, pz) - n(px - e, py, pz);
        const dy = n(px, py + e, pz) - n(px, py - e, pz);
        const dz = n(px, py, pz + e) - n(px, py, pz - e);
        return new THREE.Vector3(dy - dz, dz - dx, dx - dy);
    }

    /** 多オクターブ＋座標オフセットで単純な中心周りの渦を避ける */
    _sampleCurlNoiseVectorCylinderBlend(pos, time, freq, eps) {
        const p = this._curlCylPosScratch.copy(pos).add(this._cylinderCurlFieldOffset);
        const a = this._sampleCurlNoiseVector(p, time, freq, eps);
        const b = this._sampleCurlNoiseVector(p, time + 19.3, freq * 2.15, eps * 0.92);
        const c = this._sampleCurlNoiseVector(p, time + 41.7, freq * 0.48, eps * 1.06);
        if (a.lengthSq() > 1e-12) a.normalize();
        if (b.lengthSq() > 1e-12) b.normalize();
        if (c.lengthSq() > 1e-12) c.normalize();
        a.multiplyScalar(0.48);
        b.multiplyScalar(0.32);
        c.multiplyScalar(0.2);
        a.add(b).add(c);
        if (a.lengthSq() > 1e-12) a.normalize();
        return a;
    }

    _sampleCurlNoiseVectorInto(out, x, y, z, time, freq = 0.001, eps = 7.5, seed = 0) {
        const px = x * freq;
        const py = y * freq;
        const pz = z * freq;
        const t = time * 0.16;
        const e = eps * freq;
        const n = (xx, yy, zz) => this._shardNoise(
            xx + t * (0.71 + seed * 0.13),
            yy - t * (0.53 - seed * 0.09),
            zz + t * (0.37 + seed * 0.11)
        );
        const dx = n(px + e, py, pz) - n(px - e, py, pz);
        const dy = n(px, py + e, pz) - n(px, py - e, pz);
        const dz = n(px, py, pz + e) - n(px, py, pz - e);
        out.set(dy - dz, dz - dx, dx - dy);
        return out;
    }

    _composeTrailNoiseQuat(seed) {
        const t = this.time;
        const nX = this._shardNoise(seed * 0.61, t * 0.11, 2.3) * 2 - 1;
        const nY = this._shardNoise(3.7, seed * 0.47, t * 0.09) * 2 - 1;
        const nZ = this._shardNoise(t * 0.08, 6.1, seed * 0.53) * 2 - 1;
        return new THREE.Quaternion().setFromEuler(
            new THREE.Euler(nX * this._trailPitchAmp, nY * this._trailYawAmp, nZ * this._trailRollAmp, 'YXZ')
        );
    }

    /**
     * @param {object|boolean|null} [yVary] truthy のとき赤シリンダー用軌道（フル3Dカール。Y を yTarget で潰さない）
     */
    _updateTrailHeadSingle(pos, dir, deltaTime, timeOffset, speed, curlFreq, curlStrength, yVary = null) {
        const dt = Math.min(Math.max(deltaTime, 0), 0.05);
        const isCylinderTrail = !!yVary;
        const curl = isCylinderTrail
            ? this._sampleCurlNoiseVectorCylinderBlend(
                  pos,
                  this.time + timeOffset,
                  curlFreq,
                  this._trailCurlEpsCylinder ?? 7.5
              )
            : this._sampleCurlNoiseVector(pos, this.time + timeOffset, curlFreq);
        if (curl.lengthSq() > 1e-9) curl.normalize();

        dir.addScaledVector(curl, curlStrength * dt);
        const pullMag = isCylinderTrail ? (this._trailCenterPullCylinder ?? 0) : this._trailCenterPull;
        if (pullMag > 1e-6) {
            const toCenter = this._trailCenter.clone().sub(pos);
            if (isCylinderTrail) toCenter.y = 0;
            const centerDist = Math.max(1, toCenter.length());
            if (toCenter.lengthSq() > 1e-12) {
                toCenter.normalize();
                const centerPull = pullMag * THREE.MathUtils.clamp(centerDist / 2400, 0.08, 1.0);
                dir.addScaledVector(toCenter, centerPull * dt);
            }
        }
        // シリンダーは Y 成分もカール任せ（減衰・yTarget lerp 禁止＝横円環の主因だった）
        if (!isCylinderTrail) dir.y *= 0.92;
        dir.normalize();

        pos.addScaledVector(dir, speed * dt);

        const xLim = this.roomHalfW * 0.55;
        const zLim = this.roomHalfD * 0.55;
        pos.x = THREE.MathUtils.clamp(pos.x, -xLim, xLim);
        pos.z = THREE.MathUtils.clamp(pos.z, -zLim, zLim);
        const yMin = this.floorTopY + 130;
        const yMax = this.ceilingY * 0.43;

        if (isCylinderTrail) {
            pos.y = THREE.MathUtils.clamp(pos.y, yMin, yMax);
        } else {
            const base =
                (this._shardNoise((this.time + timeOffset) * 0.08, 9.1, 4.2) - 0.5) * 620;
            const yTarget = this._trailCenter.y + base;
            pos.y = THREE.MathUtils.clamp(
                THREE.MathUtils.lerp(pos.y, yTarget, 0.38 * dt * 60),
                yMin,
                yMax
            );
        }
    }

    _updateTrailHeadMotion(deltaTime) {
        this._updateTrailHeadSingle(
            this._trailHeadPosShard,
            this._trailHeadDirShard,
            deltaTime,
            0.0,
            this._trailSpeedShard ?? this._trailSpeed,
            this._trailCurlFreqShard ?? this._trailCurlFreq,
            this._trailCurlStrengthShard ?? this._trailCurlStrength
        );
        this._updateTrailHeadSingle(
            this._trailHeadPosCylinder,
            this._trailHeadDirCylinder,
            deltaTime,
            37.0,
            this._trailSpeedCylinder ?? this._trailSpeed,
            this._trailCurlFreqCylinder ?? this._trailCurlFreq,
            this._trailCurlStrengthCylinder ?? this._trailCurlStrength,
            true
        );

        this._trailHeadPos.copy(this._trailHeadPosShard);
        this._trailHeadDir.copy(this._trailHeadDirShard);
        this._lastShardPos.copy(this._trailHeadPosShard);
        this._lastCylinderWorldPos.copy(this._trailHeadPosCylinder);
    }

    /** 0–127 以外に OSC が 0–1 float を送る場合も正規化 */
    normalizeMidiVelocity(v) {
        if (v === undefined || v === null) return 127;
        const n = Number(v);
        if (!Number.isFinite(n)) return 127;
        if (n >= 0 && n <= 1) return Math.round(n * 127);
        return THREE.MathUtils.clamp(Math.round(n), 0, 127);
    }

    /** トラック9：従来のチャコール調を保ちつつ近い範囲で濃淡ランダム */
    _applyTrack9SphereRandomTint(material) {
        material.color.copy(this._track9SphereColorAtMax);
        material.color.offsetHSL(0, (Math.random() - 0.5) * 0.035, (Math.random() - 0.5) * 0.07);
        material.emissive.copy(this._track9SphereEmissiveAtMax);
        material.emissive.offsetHSL(0, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.09);
        material.emissiveIntensity = THREE.MathUtils.clamp(0.17 + (Math.random() - 0.5) * 0.08, 0.12, 0.24);
    }

    /** 赤シリンダー：基準 #cc4624 付近で濃淡（instanceColor フル色、マテは白） */
    _randomCylinderTintNearBase(out) {
        out.setHex(0xcc4624);
        out.offsetHSL(0, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.11);
    }

    /** ベロシティでスチール〜シルバーの金属トーン（暗→明） */
    velocityToMetalShardColor(velocity, target, seedForVariation = 0) {
        const t = THREE.MathUtils.clamp(velocity / 127, 0, 1);
        if (t < 0.5) target.copy(this._shardMetalDark).lerp(this._shardMetalMid, t / 0.5);
        else target.copy(this._shardMetalMid).lerp(this._shardMetalBright, (t - 0.5) / 0.5);
        const n = (this._shardNoise(seedForVariation * 0.41, 2.1, 0.7) - 0.5) * 0.07;
        target.r = THREE.MathUtils.clamp(target.r + n, 0.08, 1);
        target.g = THREE.MathUtils.clamp(target.g + n, 0.08, 1);
        target.b = THREE.MathUtils.clamp(target.b + n, 0.08, 1);
    }

    /** 部屋内のノイズベース目標座標（金属片の「生える場所」のひとつ） */
    sampleNoisePosition() {
        const s = this._shardSeed + this._snakeIndex * 0.019;
        const u = this._shardNoise(s * 0.002, 2.3, 4.1) * 2 - 1;
        const v = this._shardNoise(1.1, s * 0.002, 2.3) * 2 - 1;
        const w = this._shardNoise(1.1, 2.3, s * 0.002) * 2 - 1;
        const hw = this.roomHalfW * 0.58;
        const hd = this.roomHalfD * 0.58;
        const ymin = this.floorTopY + 140;
        const ymax = this.ceilingY * 0.44;
        return new THREE.Vector3(u * hw, ymin + (w * 0.5 + 0.5) * (ymax - ymin), v * hd);
    }

    _allocShardSlot() {
        if (this.shards.length >= this.maxShards) {
            const old = this.shards.shift();
            this._clearShardSlot(old.slotIndex);
            return old.slotIndex;
        }
        return this._shardFreeSlots.pop();
    }

    /**
     * 常時移動する残像ヘッド位置に金属片を生成（OSC はトラック9）。
     * durationMs: デュレーション（ms）でスケール。velocity: 金属色の明るさ。
     */
    spawnMetalShardFromTrack5(velocity, durationMs = 180) {
        if (!this.shardGroup || !this._metalShardMaterial || !this.shardInstMesh) return;

        const vMidi = this.normalizeMidiVelocity(velocity);

        const si = this._snakeIndex;
        const newPos = this._spawnWorldPosTemp;
        newPos.copy(this._trailHeadPosShard);
        const headRight = new THREE.Vector3().crossVectors(this._trailHeadDirShard, new THREE.Vector3(0, 1, 0));
        if (headRight.lengthSq() > 1e-8) {
            headRight.normalize();
            const lateral = (this._shardNoise(si * 0.63, this.time * 0.11, 1.9) - 0.5) * 130;
            newPos.addScaledVector(headRight, lateral);
        }
        const vertical = (this._shardNoise(2.7, si * 0.29, this.time * 0.09) - 0.5) * 95;
        newPos.y += vertical;
        newPos.x = THREE.MathUtils.clamp(newPos.x, -this.roomHalfW * 0.62, this.roomHalfW * 0.62);
        newPos.z = THREE.MathUtils.clamp(newPos.z, -this.roomHalfD * 0.62, this.roomHalfD * 0.62);
        newPos.y = THREE.MathUtils.clamp(newPos.y, this.floorTopY + 90, this.ceilingY * 0.46);

        const fwd = this._trailHeadDirShard.clone().normalize();
        const qSnake = new THREE.Quaternion();
        const zAxis = new THREE.Vector3(0, 0, 1);
        if (Math.abs(zAxis.dot(fwd)) > 0.998) {
            qSnake.setFromAxisAngle(new THREE.Vector3(1, 0, 0), fwd.z < 0 ? Math.PI : 0);
        } else {
            qSnake.setFromUnitVectors(zAxis, fwd);
        }
        const roll = (this._shardNoise(si, 7.1, this.time * 0.05) - 0.5) * Math.PI * 0.32;
        const qRoll = new THREE.Quaternion().setFromAxisAngle(fwd, roll);
        const qN = this._composeTrailNoiseQuat(si * 0.71 + this.time * 0.13);
        const qFinal = qSnake.clone().multiply(qRoll).multiply(qN);

        this._lastShardPos.copy(newPos);
        this._snakeIndex++;

        const dur = Math.max(1, Number(durationMs) || 180);
        const durN = THREE.MathUtils.clamp(dur / 750, 0.06, 1.65);
        const s = this.shardCylinderVisualScale ?? 1;
        const r =
            (18 + 118 * durN) *
            (0.94 + 0.06 * this._shardNoise(si * 0.7, 0.2, 0.1)) *
            s;

        const slotIndex = this._allocShardSlot();
        if (slotIndex === undefined) return;

        this.velocityToMetalShardColor(vMidi, this._shardHeatColor, si);
        this.shardInstMesh.setColorAt(slotIndex, this._shardHeatColor);
        if (this.shardInstMesh.instanceColor) {
            this.shardInstMesh.instanceColor.needsUpdate = true;
        }

        this._shardPosTemp.copy(newPos);
        this.shardGroup.updateMatrixWorld(true);
        this.shardGroup.worldToLocal(this._shardPosTemp);
        const shapeSeed = this._shardNoise(si * 0.37, 6.9, 2.4);
        const ex = 0.62 + 0.95 * this._shardNoise(shapeSeed, si * 0.19, 1.7);
        const ey = 0.62 + 0.95 * this._shardNoise(si * 0.11, shapeSeed, 2.9);
        const ez = 0.62 + 0.95 * this._shardNoise(3.1, si * 0.23, shapeSeed);
        const invAvg = 3 / (ex + ey + ez);
        const sx = r * ex * invAvg;
        const sy = r * ey * invAvg;
        const sz = r * ez * invAvg;
        this._shardScaleTemp.set(sx * 0.02, sy * 0.02, sz * 0.02);
        this._shardMatrixTemp.compose(this._shardPosTemp, qFinal, this._shardScaleTemp);
        this.shardInstMesh.setMatrixAt(slotIndex, this._shardMatrixTemp);
        this.shardInstMesh.instanceMatrix.needsUpdate = true;
        if (this._shardOpacityAttr) {
            this._shardOpacityAttr.array[slotIndex] = 1;
            this._shardOpacityAttr.needsUpdate = true;
        }

        this.shards.push({
            slotIndex,
            spawnTime: performance.now(),
            localPos: this._shardPosTemp.clone(),
            localQuat: qFinal.clone(),
            baseScaleVec: new THREE.Vector3(sx, sy, sz),
            growInMs: this._growInMsFromDuration(dur, this.shardGrowInMs)
        });
                this.ambientDust?.spawnBurst(newPos, this.ambientParticlesPerShard);
    }

    /** 非表示：スケール0（ドローコスト抑制） */
    _clearShardSlot(slotIndex) {
        if (!this.shardInstMesh || slotIndex < 0 || slotIndex >= this.maxShards) return;
        this._shardPosTemp.set(0, -1e6, 0);
        this._shardQuatTemp.identity();
        this._shardScaleTemp.set(0, 0, 0);
        this._shardMatrixTemp.compose(this._shardPosTemp, this._shardQuatTemp, this._shardScaleTemp);
        this.shardInstMesh.setMatrixAt(slotIndex, this._shardMatrixTemp);
        if (this._shardOpacityAttr) {
            this._shardOpacityAttr.array[slotIndex] = 0;
            this._shardOpacityAttr.needsUpdate = true;
        }
        this.shardInstMesh.instanceMatrix.needsUpdate = true;
    }

    /** 寿命超えの破片を削除（毎フレーム） */
    pruneExpiredShards() {
        if (!this.shards.length || !this.shardGroup) return;
        const now = performance.now();
        const life = this.shardLifetimeMs;
        let matrixDirty = false;
        for (let i = this.shards.length - 1; i >= 0; i--) {
            const s = this.shards[i];
            if (now - s.spawnTime > life) {
                this._clearShardSlot(s.slotIndex);
                this._shardFreeSlots.push(s.slotIndex);
                this.shards.splice(i, 1);
                matrixDirty = true;
            }
        }
        while (this.shards.length > this.maxShards) {
            const old = this.shards.shift();
            this._clearShardSlot(old.slotIndex);
            this._shardFreeSlots.push(old.slotIndex);
            matrixDirty = true;
        }
        if (matrixDirty && this.shardInstMesh) {
            this.shardInstMesh.instanceMatrix.needsUpdate = true;
        }
    }

    initMetalShardsSystem() {
        this.shardGroup = new THREE.Group();
        this.shardGroup.position.set(0, 0, 0);
        this.scene.add(this.shardGroup);

        const envTex = this.cubeRenderTarget ? this.cubeRenderTarget.texture : this.scene.environment;
        /** 共有1マテ（個体差は instanceColor）。金属色用に metalness 高め */
        this._metalShardMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.88,
            roughness: 0.32,
            envMap: envTex,
            envMapIntensity: 0.92 * (0.55 + 0.45 * (this.sceneLightingScale ?? 1)),
            emissive: 0x000000,
            emissiveIntensity: 0,
            opacity: 1,
            fog: true
        });
        Scene08._applyInstanceOpacityShader(this._metalShardMaterial);

        const shardGeo = new THREE.TetrahedronGeometry(1, 0);
        this._shardOpacityAttr = Scene08._attachInstanceOpacityAttribute(shardGeo, this.maxShards);
        this.shardInstMesh = new THREE.InstancedMesh(shardGeo, this._metalShardMaterial, this.maxShards);
        this.shardInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.shardInstMesh.frustumCulled = false;
        this.shardInstMesh.castShadow = true;
        this.shardInstMesh.receiveShadow = true;
        this.shardGroup.add(this.shardInstMesh);

        this._shardFreeSlots = [];
        const hideColor = new THREE.Color(0x000000);
        for (let i = this.maxShards - 1; i >= 0; i--) {
            this._shardFreeSlots.push(i);
        }
        for (let i = 0; i < this.maxShards; i++) {
            this._clearShardSlot(i);
            this.shardInstMesh.setColorAt(i, hideColor);
        }
        if (this.shardInstMesh.instanceColor) {
            this.shardInstMesh.instanceColor.needsUpdate = true;
        }
        this.shardInstMesh.instanceMatrix.needsUpdate = true;
    }

    initRedCylinderSystem() {
        /** 個体色は instanceColor（濃淡）。親グループなし＝ワールド座標で行列（cable 追従なし） */
        this._redCylinderMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0x000000,
            emissiveIntensity: 0,
            metalness: 0,
            roughness: 0.52,
            /** フォグ無効だと壁・床と霞のかかり方が違い、浮いて見えやすい */
            fog: true,
            opacity: 1
        });
        Scene08._applyRedCylinderShader(this._redCylinderMaterial);

        const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 6);
        this._cylinderOpacityAttr = Scene08._attachInstanceOpacityAttribute(cylGeo, this.maxCylinders);
        this.cylinderInstMesh = new THREE.InstancedMesh(cylGeo, this._redCylinderMaterial, this.maxCylinders);
        this.cylinderInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.cylinderInstMesh.frustumCulled = false;
        this.cylinderInstMesh.castShadow = true;
        this.cylinderInstMesh.receiveShadow = true;
        this.scene.add(this.cylinderInstMesh);

        this._cylinderFreeSlots = [];
        for (let i = this.maxCylinders - 1; i >= 0; i--) {
            this._cylinderFreeSlots.push(i);
        }
        for (let i = 0; i < this.maxCylinders; i++) {
            this._clearCylinderSlot(i);
            this.cylinderInstMesh.setColorAt(i, this._instanceWhite);
        }
        if (this.cylinderInstMesh.instanceColor) {
            this.cylinderInstMesh.instanceColor.needsUpdate = true;
        }
        this.cylinderInstMesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * 赤いシリンダ（OSC トラック5）。常時移動する残像ヘッド位置で生成。
     * ベロシティ→長さ、デュレーション→半径（細さ）。デュレーションは伸び立ち上がりにも使用。
     */
    spawnRedCylinderFromTrack6(velocity, durationMs = 180, noteNumber = 64) {
        if (!this.cylinderInstMesh || !this._redCylinderMaterial) return;

        const vMidi = this.normalizeMidiVelocity(velocity);
        const dur = Math.max(1, Number(durationMs) || 180);
        const s = this.shardCylinderVisualScale ?? 1;
        const length = THREE.MathUtils.clamp(this._cylinderLengthFromVelocityMidi(vMidi), 72, 355) * s;
        const radius = THREE.MathUtils.clamp(this._cylinderRadiusFromDurationMs(dur), 8, 38) * s;

        const slotIndex = this._allocCylinderSlot();

        const ci = this.cylinders.length;
        const wu = new THREE.Vector3(0, 1, 0);
        this._cylinderPosTemp.copy(this._trailHeadPosCylinder);
        const cside = new THREE.Vector3().crossVectors(this._trailHeadDirCylinder, wu);
        if (cside.lengthSq() > 1e-8) {
            cside.normalize();
            const lateral = (this._shardNoise(ci * 0.37, this.time * 0.09, 2.2) - 0.5) * 180;
            this._cylinderPosTemp.addScaledVector(cside, lateral);
        }
        this._cylinderPosTemp.y += (this._shardNoise(3.4, ci * 0.21, this.time * 0.07) - 0.5) * 140;
        const cylXLimit = this.roomHalfW * 0.62;
        const cylZLimit = this.roomHalfD * 0.62;
        this._cylinderPosTemp.x = THREE.MathUtils.clamp(
            this._cylinderPosTemp.x,
            -cylXLimit,
            cylXLimit
        );
        this._cylinderPosTemp.z = THREE.MathUtils.clamp(
            this._cylinderPosTemp.z,
            -cylZLimit,
            cylZLimit
        );
        this._cylinderPosTemp.y = THREE.MathUtils.clamp(
            this._cylinderPosTemp.y,
            this.floorTopY + 120,
            this.ceilingY * 0.46
        );
        this._lastCylinderWorldPos.copy(this._cylinderPosTemp);

        this._cylinderSideTemp.crossVectors(this._trailHeadDirCylinder, this._cylinderAxisUp);
        if (this._cylinderSideTemp.lengthSq() < 1e-8) {
            this._cylinderSideTemp.crossVectors(this._trailHeadDirCylinder, this._cylinderFallbackAxis);
        }
        this._cylinderSideTemp.normalize();
        // 長軸は進行方向に垂直。進行方向周りの回転は螺旋位相のみ（角度ノイズなし）
        this._cylinderDirTemp.crossVectors(this._cylinderSideTemp, this._trailHeadDirCylinder).normalize();
        this._cylinderQuatTemp.setFromUnitVectors(this._cylinderAxisUp, this._cylinderDirTemp);
        // 進行方向に直交する横軸（side ≒ トラベル基準の X）周りのノイズ回転
        const tiltXRad =
            (this._shardNoise(ci * 0.13, this.time * 0.03, 1.07) - 0.5) * 0.55;
        this._cylinderTiltXQuat.setFromAxisAngle(this._cylinderSideTemp, tiltXRad);
        this._cylinderQuatTemp.premultiply(this._cylinderTiltXQuat);
        const rollRad = this._cylinderHelixPhase;
        this._cylinderRollQuat.setFromAxisAngle(this._trailHeadDirCylinder, rollRad);
        this._cylinderHelixPhase += this._cylinderHelixTwistPerSpawn;
        this._cylinderHelixPhase =
            THREE.MathUtils.euclideanModulo(this._cylinderHelixPhase + Math.PI, Math.PI * 2) - Math.PI;
        this._cylinderQuatTemp.premultiply(this._cylinderRollQuat);

        this._cylinderScaleTemp.set(radius * 0.02, length * 0.02, radius * 0.02);
        this._cylinderMatrixTemp.compose(this._cylinderPosTemp, this._cylinderQuatTemp, this._cylinderScaleTemp);
        this.cylinderInstMesh.setMatrixAt(slotIndex, this._cylinderMatrixTemp);
        this.cylinderInstMesh.instanceMatrix.needsUpdate = true;
        if (this._cylinderOpacityAttr) {
            this._cylinderOpacityAttr.array[slotIndex] = 1;
            this._cylinderOpacityAttr.needsUpdate = true;
        }
        this._randomCylinderTintNearBase(this._cylinderTintTemp);
        this.cylinderInstMesh.setColorAt(slotIndex, this._cylinderTintTemp);
        if (this.cylinderInstMesh.instanceColor) {
            this.cylinderInstMesh.instanceColor.needsUpdate = true;
        }

        this.cylinders.push({
            slotIndex,
            spawnTime: performance.now(),
            localPos: this._cylinderPosTemp.clone(),
            localQuat: this._cylinderQuatTemp.clone(),
            baseRadius: radius,
            baseLength: length,
            growInMs: this._growInMsFromDuration(dur, this.cylinderGrowInMs)
        });
        this.triggerRedCylinderBurst(this._lastCylinderWorldPos, velocity, durationMs);
                this.ambientDust?.spawnBurst(this._lastCylinderWorldPos, this.ambientParticlesPerCylinder);
    }

    _allocCylinderSlot() {
        if (this.cylinders.length >= this.maxCylinders) {
            const old = this.cylinders.shift();
            this._clearCylinderSlot(old.slotIndex);
            return old.slotIndex;
        }
        return this._cylinderFreeSlots.pop();
    }

    _clearCylinderSlot(slotIndex) {
        if (!this.cylinderInstMesh || slotIndex < 0 || slotIndex >= this.maxCylinders) return;
        this._cylinderPosTemp.set(0, -1e6, 0);
        this._cylinderQuatTemp.identity();
        this._cylinderScaleTemp.set(0, 0, 0);
        this._cylinderMatrixTemp.compose(this._cylinderPosTemp, this._cylinderQuatTemp, this._cylinderScaleTemp);
        this.cylinderInstMesh.setMatrixAt(slotIndex, this._cylinderMatrixTemp);
        if (this._cylinderOpacityAttr) {
            this._cylinderOpacityAttr.array[slotIndex] = 0;
            this._cylinderOpacityAttr.needsUpdate = true;
        }
        this.cylinderInstMesh.setColorAt(slotIndex, this._instanceWhite);
        if (this.cylinderInstMesh.instanceColor) {
            this.cylinderInstMesh.instanceColor.needsUpdate = true;
        }
    }

    pruneExpiredCylinders() {
        if (!this.cylinders.length || !this.cylinderInstMesh) return;
        const now = performance.now();
        const life = this.cylinderLifetimeMs;
        let matrixDirty = false;
        for (let i = this.cylinders.length - 1; i >= 0; i--) {
            const c = this.cylinders[i];
            if (now - c.spawnTime > life) {
                this._clearCylinderSlot(c.slotIndex);
                this._cylinderFreeSlots.push(c.slotIndex);
                this.cylinders.splice(i, 1);
                matrixDirty = true;
            }
        }
        while (this.cylinders.length > this.maxCylinders) {
            const old = this.cylinders.shift();
            this._clearCylinderSlot(old.slotIndex);
            this._cylinderFreeSlots.push(old.slotIndex);
            matrixDirty = true;
        }
        if (matrixDirty && this.cylinderInstMesh) {
            this.cylinderInstMesh.instanceMatrix.needsUpdate = true;
        }
    }

    initRedCylinderBurstParticles() {
        if (this.redBurstInstMesh) return;
        const n = this.redBurstParticleCount;
        this._redBurstPositions = new Float32Array(n * 3);
        this._redBurstVelocities = new Float32Array(n * 3);
        this._redBurstColors = new Float32Array(n * 3);
        this._redBurstRotQuats = new Float32Array(n * 4);
        this._redBurstScales = new Float32Array(n);
        this.redBurstSharedGeo = new THREE.DodecahedronGeometry(1, 0);
        this.redBurstMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.0,
            roughness: 0.96,
            emissive: 0x080808,
            emissiveIntensity: 0.05,
            vertexColors: true,
            transparent: true,
            opacity: 0.0,
            depthWrite: false,
            blending: THREE.NormalBlending,
            fog: true
        });
        this.redBurstInstMesh = new THREE.InstancedMesh(this.redBurstSharedGeo, this.redBurstMaterial, n);
        this.redBurstInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.redBurstInstMesh.frustumCulled = false;
        this.redBurstInstMesh.visible = false;
        const hidePos = new THREE.Vector3(0, -1e6, 0);
        const hideQuat = new THREE.Quaternion();
        const hideScale = new THREE.Vector3(0, 0, 0);
        for (let i = 0; i < n; i++) {
            this._redBurstMatrixTemp.compose(hidePos, hideQuat, hideScale);
            this.redBurstInstMesh.setMatrixAt(i, this._redBurstMatrixTemp);
            this.redBurstInstMesh.setColorAt(i, new THREE.Color(0, 0, 0));
        }
        this.redBurstInstMesh.instanceMatrix.needsUpdate = true;
        if (this.redBurstInstMesh.instanceColor) this.redBurstInstMesh.instanceColor.needsUpdate = true;
        this.scene.add(this.redBurstInstMesh);
    }

    triggerRedCylinderBurst(worldPos, velocity = 127, durationMs = 180) {
        if (!this.redBurstInstMesh || !this._redBurstPositions || !this._redBurstVelocities) return;
        const n = this.redBurstParticleCount;
        const vMidi = this.normalizeMidiVelocity(velocity) / 127;
        const durN = THREE.MathUtils.clamp((Number(durationMs) || 180) / 900, 0.35, 2.2);
        const baseSpeed = 130 + vMidi * 520;
        const spread = 12 + vMidi * 56;
        for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            const dx = Math.sin(ph) * Math.cos(th);
            const dy = Math.cos(ph);
            const dz = Math.sin(ph) * Math.sin(th);
            const r = Math.random() * spread;
            this._redBurstPositions[i3] = worldPos.x + dx * r;
            this._redBurstPositions[i3 + 1] = worldPos.y + dy * r;
            this._redBurstPositions[i3 + 2] = worldPos.z + dz * r;
            const sp = baseSpeed * (0.45 + Math.random() * 1.2);
            this._redBurstVelocities[i3] = dx * sp;
            this._redBurstVelocities[i3 + 1] = dy * sp + 35;
            this._redBurstVelocities[i3 + 2] = dz * sp;
            const qi = i * 4;
            this._redBurstQuatTemp.setFromEuler(
                new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 'XYZ')
            );
            this._redBurstRotQuats[qi] = this._redBurstQuatTemp.x;
            this._redBurstRotQuats[qi + 1] = this._redBurstQuatTemp.y;
            this._redBurstRotQuats[qi + 2] = this._redBurstQuatTemp.z;
            this._redBurstRotQuats[qi + 3] = this._redBurstQuatTemp.w;
            this._redBurstScales[i] = 1.3 + Math.random() * 3.9;
        }
        this._redBurstAgeSec = 0;
        this._redBurstLifeSec = THREE.MathUtils.clamp(0.9 * durN, 0.38, 1.95);
        this._redBurstActive = true;
        this.redBurstInstMesh.visible = true;
        this.redBurstMaterial.opacity = 0.95;
    }

    _setHeatmapColor01(t, i3, out) {
        const x = THREE.MathUtils.clamp(t, 0, 1);
        let r; let g; let b;
        if (x < 0.25) {
            const u = x / 0.25;
            r = 0.1;
            g = u;
            b = 1.0;
        } else if (x < 0.5) {
            const u = (x - 0.25) / 0.25;
            r = 0.1;
            g = 1.0;
            b = 1.0 - u;
        } else if (x < 0.75) {
            const u = (x - 0.5) / 0.25;
            r = u;
            g = 1.0;
            b = 0.0;
        } else {
            const u = (x - 0.75) / 0.25;
            r = 1.0;
            g = 1.0 - u;
            b = 0.0;
        }
        out[i3] = r;
        out[i3 + 1] = g;
        out[i3 + 2] = b;
    }

    _updateRedCylinderBurstParticles(deltaTime) {
        if (!this._redBurstActive || !this.redBurstInstMesh || !this._redBurstPositions || !this._redBurstVelocities || !this._redBurstColors) return;
        const dt = Math.min(deltaTime, 0.05);
        this._redBurstAgeSec += dt;
        const n = this.redBurstParticleCount;
        const drag = Math.exp(-dt * 2.4);
        const gravity = 170;
        const curlFreq = this.redBurstCurlFreq;
        const curlStr = this.redBurstCurlStrength;
        const tt = this.time;
        for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const px = this._redBurstPositions[i3];
            const py = this._redBurstPositions[i3 + 1];
            const pz = this._redBurstPositions[i3 + 2];
            const seed = this._shardNoise(i * 0.173, 4.37, 9.11);
            const jitterAmp = 220;
            const sx = px + (seed - 0.5) * jitterAmp;
            const sy = py + (this._shardNoise(i * 0.127, 7.91, 2.13) - 0.5) * jitterAmp;
            const sz = pz + (this._shardNoise(i * 0.097, 1.77, 5.59) - 0.5) * jitterAmp;
            this._sampleCurlNoiseVectorInto(
                this._redBurstCurlTemp,
                sx,
                sy,
                sz,
                tt + seed * 6.0,
                curlFreq * 1.7,
                12.0,
                seed
            );
            const turbX = (this._shardNoise(sx * 0.0061, sy * 0.0043, tt * 0.73 + seed * 3.1) - 0.5) * 2.0;
            const turbY = (this._shardNoise(sy * 0.0057, sz * 0.0047, tt * 0.89 + seed * 1.7) - 0.5) * 2.0;
            const turbZ = (this._shardNoise(sz * 0.0063, sx * 0.0041, tt * 0.67 + seed * 2.9) - 0.5) * 2.0;
            const curlX = this._redBurstCurlTemp.x + turbX * 0.62;
            const curlY = this._redBurstCurlTemp.y + turbY * 0.62;
            const curlZ = this._redBurstCurlTemp.z + turbZ * 0.62;
            this._redBurstVelocities[i3] *= drag;
            this._redBurstVelocities[i3 + 1] = this._redBurstVelocities[i3 + 1] * drag - gravity * dt;
            this._redBurstVelocities[i3 + 2] *= drag;
            this._redBurstVelocities[i3] += curlX * curlStr * dt;
            this._redBurstVelocities[i3 + 1] += curlY * curlStr * dt;
            this._redBurstVelocities[i3 + 2] += curlZ * curlStr * dt;
            this._redBurstPositions[i3] += this._redBurstVelocities[i3] * dt;
            this._redBurstPositions[i3 + 1] += this._redBurstVelocities[i3 + 1] * dt;
            this._redBurstPositions[i3 + 2] += this._redBurstVelocities[i3 + 2] * dt;
            const sp = Math.sqrt(
                this._redBurstVelocities[i3] * this._redBurstVelocities[i3] +
                this._redBurstVelocities[i3 + 1] * this._redBurstVelocities[i3 + 1] +
                this._redBurstVelocities[i3 + 2] * this._redBurstVelocities[i3 + 2]
            );
            const ageT = THREE.MathUtils.clamp(this._redBurstAgeSec / this._redBurstLifeSec, 0, 1);
            const heat = THREE.MathUtils.clamp((sp / 520) * (1.0 - ageT * 0.6), 0, 1);
            this._setHeatmapColor01(heat, i3, this._redBurstColors);
            const qi = i * 4;
            this._redBurstQuatTemp.set(
                this._redBurstRotQuats[qi],
                this._redBurstRotQuats[qi + 1],
                this._redBurstRotQuats[qi + 2],
                this._redBurstRotQuats[qi + 3]
            );
            this._redBurstQuatTemp.normalize();
            this._redBurstPosTemp.set(
                this._redBurstPositions[i3],
                this._redBurstPositions[i3 + 1],
                this._redBurstPositions[i3 + 2]
            );
            const s = this._redBurstScales[i];
            this._redBurstScaleTemp.set(s, s, s);
            this._redBurstMatrixTemp.compose(this._redBurstPosTemp, this._redBurstQuatTemp, this._redBurstScaleTemp);
            this.redBurstInstMesh.setMatrixAt(i, this._redBurstMatrixTemp);
            this._redBurstColorTemp.setRGB(
                this._redBurstColors[i3],
                this._redBurstColors[i3 + 1],
                this._redBurstColors[i3 + 2]
            );
            this.redBurstInstMesh.setColorAt(i, this._redBurstColorTemp);
        }
        this.redBurstInstMesh.instanceMatrix.needsUpdate = true;
        if (this.redBurstInstMesh.instanceColor) this.redBurstInstMesh.instanceColor.needsUpdate = true;
        const t = THREE.MathUtils.clamp(this._redBurstAgeSec / this._redBurstLifeSec, 0, 1);
        this.redBurstMaterial.opacity = 1 - t * t * (3 - 2 * t);
        if (t >= 1) {
            this._redBurstActive = false;
            this.redBurstInstMesh.visible = false;
            this.redBurstMaterial.opacity = 0.0;
        }
    }

    _generateObsidianBumpTexture(size = 256) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 1800; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 0.4 + Math.random() * 1.8;
            const v = Math.floor(80 + Math.random() * 130);
            ctx.fillStyle = `rgba(${v},${v},${v},0.32)`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = 0; i < 120; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const rr = 6 + Math.random() * 18;
            const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
            g.addColorStop(0, 'rgba(255,255,255,0.24)');
            g.addColorStop(1, 'rgba(128,128,128,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, rr, 0, Math.PI * 2);
            ctx.fill();
        }
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.LinearSRGBColorSpace;
        return t;
    }

    initObsidianDrifters() {
        if (this.obsidianInstMesh) return;
        const n = this.obsidianCount;
        this._obsidianPositions = new Float32Array(n * 3);
        this._obsidianVelocities = new Float32Array(n * 3);
        this._obsidianRotQuats = new Float32Array(n * 4);
        this._obsidianScales = new Float32Array(n * 3);
        this.obsidianGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.obsidianBumpMap = this._generateObsidianBumpTexture(256);
        this.obsidianMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2b2f,
            metalness: 0.58,
            roughness: 0.22,
            bumpMap: this.obsidianBumpMap,
            bumpScale: 0.85,
            envMap: this.scene.environment,
            envMapIntensity: 0.36,
            emissive: 0x0b0b0d,
            emissiveIntensity: 0.08,
            fog: true
        });
        this.obsidianInstMesh = new THREE.InstancedMesh(this.obsidianGeometry, this.obsidianMaterial, n);
        this.obsidianInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.obsidianInstMesh.frustumCulled = false;
        this.obsidianInstMesh.castShadow = false;
        this.obsidianInstMesh.receiveShadow = false;
        this.scene.add(this.obsidianInstMesh);

        const rad = this.obsidianSpawnRadius;
        for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const qi = i * 4;
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            const rr = Math.pow(Math.random(), 1.35) * rad;
            this._obsidianPositions[i3] = Math.sin(ph) * Math.cos(th) * rr;
            this._obsidianPositions[i3 + 1] = (Math.random() - 0.5) * rad * 1.15 + 380;
            this._obsidianPositions[i3 + 2] = Math.sin(ph) * Math.sin(th) * rr;
            this._obsidianVelocities[i3] = (Math.random() - 0.5) * 65;
            this._obsidianVelocities[i3 + 1] = (Math.random() - 0.5) * 35;
            this._obsidianVelocities[i3 + 2] = (Math.random() - 0.5) * 65;
            this._obsidianQuatTemp.setFromEuler(
                new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 'XYZ')
            );
            this._obsidianRotQuats[qi] = this._obsidianQuatTemp.x;
            this._obsidianRotQuats[qi + 1] = this._obsidianQuatTemp.y;
            this._obsidianRotQuats[qi + 2] = this._obsidianQuatTemp.z;
            this._obsidianRotQuats[qi + 3] = this._obsidianQuatTemp.w;
            const base = 5 + Math.random() * 20;
            this._obsidianScales[i3] = base * (0.2 + Math.random() * 2.8);
            this._obsidianScales[i3 + 1] = base * (0.2 + Math.random() * 2.8);
            this._obsidianScales[i3 + 2] = base * (0.2 + Math.random() * 2.8);
            this._obsidianPosTemp.set(this._obsidianPositions[i3], this._obsidianPositions[i3 + 1], this._obsidianPositions[i3 + 2]);
            this._obsidianScaleTemp.set(this._obsidianScales[i3], this._obsidianScales[i3 + 1], this._obsidianScales[i3 + 2]);
            this._obsidianMatrixTemp.compose(this._obsidianPosTemp, this._obsidianQuatTemp, this._obsidianScaleTemp);
            this.obsidianInstMesh.setMatrixAt(i, this._obsidianMatrixTemp);
        }
        this.obsidianInstMesh.instanceMatrix.needsUpdate = true;
    }

    _updateObsidianDrifters(deltaTime) {
        if (!this.obsidianInstMesh || !this._obsidianPositions || !this._obsidianVelocities) return;
        const n = this.obsidianCount;
        const dt = Math.min(deltaTime, 0.05);
        const simDt = dt * this.obsidianMotionScale;
        const drag = Math.exp(-simDt * 0.35);
        const curlF = this.obsidianCurlFreq;
        const curlS = this.obsidianCurlStrength;
        const t = this.time * 12.0;
        const bound = this.obsidianSpawnRadius * 1.25;
        for (let i = 0; i < n; i++) {
            const i3 = i * 3;
            const qi = i * 4;
            const px = this._obsidianPositions[i3];
            const py = this._obsidianPositions[i3 + 1];
            const pz = this._obsidianPositions[i3 + 2];
            const fx = px * curlF;
            const fy = py * curlF;
            const fz = pz * curlF;
            const cx = -Math.cos(fz * 1.4 - t * 0.95);
            const cy = -Math.cos(fx * 1.2 + t * 1.05);
            const cz = -Math.cos(fy * 1.5 + t * 0.85);
            this._obsidianVelocities[i3] = this._obsidianVelocities[i3] * drag + cx * curlS * simDt;
            this._obsidianVelocities[i3 + 1] = this._obsidianVelocities[i3 + 1] * drag + cy * curlS * simDt;
            this._obsidianVelocities[i3 + 2] = this._obsidianVelocities[i3 + 2] * drag + cz * curlS * simDt;
            this._obsidianPositions[i3] += this._obsidianVelocities[i3] * simDt;
            this._obsidianPositions[i3 + 1] += this._obsidianVelocities[i3 + 1] * simDt;
            this._obsidianPositions[i3 + 2] += this._obsidianVelocities[i3 + 2] * simDt;
            if (this._obsidianPositions[i3] > bound) this._obsidianPositions[i3] = -bound;
            if (this._obsidianPositions[i3] < -bound) this._obsidianPositions[i3] = bound;
            if (this._obsidianPositions[i3 + 1] > this.ceilingY * 0.52) this._obsidianPositions[i3 + 1] = this.floorTopY + 220;
            if (this._obsidianPositions[i3 + 1] < this.floorTopY + 160) this._obsidianPositions[i3 + 1] = this.ceilingY * 0.48;
            if (this._obsidianPositions[i3 + 2] > bound) this._obsidianPositions[i3 + 2] = -bound;
            if (this._obsidianPositions[i3 + 2] < -bound) this._obsidianPositions[i3 + 2] = bound;
            this._obsidianQuatTemp.set(
                this._obsidianRotQuats[qi],
                this._obsidianRotQuats[qi + 1],
                this._obsidianRotQuats[qi + 2],
                this._obsidianRotQuats[qi + 3]
            );
            this._obsidianQuatTemp.normalize();
            this._obsidianPosTemp.set(this._obsidianPositions[i3], this._obsidianPositions[i3 + 1], this._obsidianPositions[i3 + 2]);
            this._obsidianScaleTemp.set(this._obsidianScales[i3], this._obsidianScales[i3 + 1], this._obsidianScales[i3 + 2]);
            this._obsidianMatrixTemp.compose(this._obsidianPosTemp, this._obsidianQuatTemp, this._obsidianScaleTemp);
            this.obsidianInstMesh.setMatrixAt(i, this._obsidianMatrixTemp);
        }
        this.obsidianInstMesh.instanceMatrix.needsUpdate = true;
    }

    createAmbientFloatingParticles() {
        this.ambientDust = new AtmosphericDustField(this.scene, {
            roomHalfW: this.roomHalfW,
            roomHalfD: this.roomHalfD,
            floorTopY: this.floorTopY,
            ceilingY: this.ceilingY,
            count: this.ambientParticleCount,
            lifetimeMs: this.ambientParticleLifetimeMs,
            fadeOutMs: this.ambientParticleFadeOutMs,
            minLivingBurst: this.ambientMinLiving
        });
    }

    /** トラック9：generateFleshTextures の map/bump ＋ color で明るめグレー寄せ */
    initTrack9SpawnSpheres() {
        this.track9SphereGroup = new THREE.Group();
        this.scene.add(this.track9SphereGroup);
        this._track9FleshTextures = this.generateFleshTextures();
        const env = this.scene.environment;
        this._track9SphereMaterial = new THREE.MeshStandardMaterial({
            map: this._track9FleshTextures.map,
            bumpMap: this._track9FleshTextures.bumpMap,
            bumpScale: 3.0,
            color: 0xd5d9df,
            metalness: 0.22,
            roughness: 0.44,
            envMap: env,
            envMapIntensity: 0.68 * (0.55 + 0.45 * (this.sceneLightingScale ?? 1)),
            emissive: 0x2a2d32,
            emissiveIntensity: 0.2,
            fog: true
        });
        this.track9SharedGeo = new THREE.SphereGeometry(1, 28, 28);
    }

    /**
     * track9SpawnDuringDuration がオンのとき、デュレーション窓が生きている間に一定間隔でスポーン（OSC トラック6）。
     * ノートオン時の1発目は handleTrackNumber 側で行う。
     */
    _tickTrack9DurationSpawn() {
        if (!this.track9SpawnDuringDuration) return;
        const now = performance.now();
        if (now >= this._track9SpawnWindowEndMs) return;
        const intv = Math.max(16, Number(this.track9DurationSpawnIntervalMs) || 52);
        if (now - this._track9LastDurationSpawnMs < intv) return;
        this._track9LastDurationSpawnMs = now;
        this.spawnTrack9SphereFromWorldCenter(this._track9SpawnWindowVelocity);
    }

    /**
     * ワールド中心（XZ=0）＋部屋内の代表高さ付近にスフィアを出す（OSC はトラック6）。velocity で半径と初速。
     */
    spawnTrack9SphereFromWorldCenter(velocity) {
        if (!this.track9SphereGroup || !this.track9SharedGeo || !this._track9SphereMaterial) return;

        const vMidi = this.normalizeMidiVelocity(velocity);
        const radius = THREE.MathUtils.clamp(22 + (vMidi / 127) * 76, 16, 102);

        const yMin = this.floorTopY + 220;
        const yMax = this.ceilingY * 0.4;
        const midY = (yMin + yMax) * 0.5;
        this._track9WorldCenter.set(0, midY, 0);
        this._track9SpawnPos.copy(this._track9WorldCenter);
        this._track9SpawnPos.x += (Math.random() - 0.5) * 160;
        this._track9SpawnPos.y += (Math.random() - 0.5) * 260;
        this._track9SpawnPos.z += (Math.random() - 0.5) * 160;

        const sphereMat = this._track9SphereMaterial.clone();
        this._applyTrack9SphereRandomTint(sphereMat);
        const mesh = new THREE.Mesh(this.track9SharedGeo, sphereMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const position = this._track9SpawnPos.clone();
        const vel = new THREE.Vector3();
        vel.subVectors(this._track9SpawnPos, this._track9WorldCenter);
        if (vel.lengthSq() < 1e-10) {
            vel.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
        }
        vel.normalize();
        const speed = 92 + (vMidi / 127) * 260;
        vel.multiplyScalar(speed);

        const angularVelocity = new THREE.Vector3(
            (Math.random() - 0.5) * 2.8,
            (Math.random() - 0.5) * 2.8,
            (Math.random() - 0.5) * 2.8
        );

        mesh.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        mesh.position.copy(position);
        const vs = this._track9SphereVisualScale;
        mesh.scale.setScalar(radius * 0.015 * vs);

        this.track9SphereGroup.add(mesh);
        this.track9Spheres.push({
            mesh,
            position,
            velocity: vel,
            radius,
            radiusNow: radius * 0.015 * vs,
            birthAge: 0,
            angularVelocity,
            driftSeed: Math.random() * 4000 + this.track9Spheres.length * 0.37
        });
        this.ambientDust?.spawnBurst(position, this.ambientParticlesPerTrack9);

        while (this.track9Spheres.length > this.maxTrack9Spheres) {
            const old = this.track9Spheres.shift();
            this.track9SphereGroup.remove(old.mesh);
            if (old.mesh.material) old.mesh.material.dispose();
        }
    }

    _updateTrack9SpherePhysics(deltaTime) {
        if (!this.track9Spheres.length) return;
        const growSec = this._track9BirthGrowSec;
        const vs = this._track9SphereVisualScale;
        for (const sp of this.track9Spheres) {
            sp.birthAge = (sp.birthAge ?? 0) + deltaTime;
            const t = Math.min(1, sp.birthAge / growSec);
            const u = t * t * (3 - 2 * t);
            sp.radiusNow = sp.radius * vs * Math.max(u, 0.015);
        }

        const sub = this._track9SubSteps;
        const dt = deltaTime / sub;
        const grav = this._track9Gravity;
        const drift = this._track9SphereDrift;
        const diff = this._track9Diff;
        const margin = 140;
        const tPhys = this.time;

        for (let s = 0; s < sub; s++) {
            this.track9PhysicsGrid.clear();
            this.track9Spheres.forEach((sp, i) => {
                const gx = Math.floor(sp.position.x / this.track9GridSize);
                const gy = Math.floor(sp.position.y / this.track9GridSize);
                const gz = Math.floor(sp.position.z / this.track9GridSize);
                const key = (gx + 120) + (gy + 120) * 240 + (gz + 120) * 240 * 240;
                if (!this.track9PhysicsGrid.has(key)) this.track9PhysicsGrid.set(key, []);
                this.track9PhysicsGrid.get(key).push(i);
            });

            this.track9Spheres.forEach((sp) => {
                const ds = sp.driftSeed ?? 0;
                const ampXZ = 24;
                const ampY = 13;
                drift.set(
                    (this._shardNoise(ds * 0.11, tPhys * 0.52, 0.07) - 0.5) * 2 * ampXZ,
                    (this._shardNoise(ds * 0.19 + 2.1, tPhys * 0.46, 0.11) - 0.5) * 2 * ampY + 6,
                    (this._shardNoise(ds * 0.13 + 7.1, tPhys * 0.49, 0.09) - 0.5) * 2 * ampXZ
                );
                sp.velocity.addScaledVector(grav, dt);
                sp.velocity.addScaledVector(drift, dt);
                sp.position.addScaledVector(sp.velocity, dt);
                sp.velocity.multiplyScalar(0.9984);

                const r = sp.radiusNow;
                const x0 = -this.roomHalfW + margin + r;
                const x1 = this.roomHalfW - margin - r;
                const z0 = -this.roomHalfD + margin + r;
                const z1 = this.roomHalfD - margin - r;
                const y0 = this.floorTopY + 90 + r;
                const y1 = this.ceilingY * 0.46 - r;

                if (sp.position.x < x0) {
                    sp.position.x = x0;
                    sp.velocity.x *= -0.5;
                } else if (sp.position.x > x1) {
                    sp.position.x = x1;
                    sp.velocity.x *= -0.5;
                }
                if (sp.position.z < z0) {
                    sp.position.z = z0;
                    sp.velocity.z *= -0.5;
                } else if (sp.position.z > z1) {
                    sp.position.z = z1;
                    sp.velocity.z *= -0.5;
                }
                if (sp.position.y < y0) {
                    sp.position.y = y0;
                    sp.velocity.y *= -0.52;
                    const roll = 0.08 / Math.max(r * 0.04, 0.5);
                    sp.angularVelocity.z += -sp.velocity.x * roll * dt;
                    sp.angularVelocity.x += sp.velocity.z * roll * dt;
                    sp.velocity.x *= 0.96;
                    sp.velocity.z *= 0.96;
                } else if (sp.position.y > y1) {
                    sp.position.y = y1;
                    sp.velocity.y *= -0.48;
                }
            });

            this.track9Spheres.forEach((a, i) => {
                const gx = Math.floor(a.position.x / this.track9GridSize);
                const gy = Math.floor(a.position.y / this.track9GridSize);
                const gz = Math.floor(a.position.z / this.track9GridSize);
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oy = -1; oy <= 1; oy++) {
                        for (let oz = -1; oz <= 1; oz++) {
                            const key = (gx + ox + 120) + (gy + oy + 120) * 240 + (gz + oz + 120) * 240 * 240;
                            const neighbors = this.track9PhysicsGrid.get(key);
                            if (!neighbors) continue;
                            neighbors.forEach((j) => {
                                if (i >= j) return;
                                const b = this.track9Spheres[j];
                                diff.subVectors(a.position, b.position);
                                const distSq = diff.lengthSq();
                                const minD = a.radiusNow + b.radiusNow;
                                if (distSq >= minD * minD || distSq < 1e-10) return;
                                const dist = Math.sqrt(distSq);
                                const overlap = (minD - dist) * 0.55;
                                const nx = diff.x / dist;
                                const ny = diff.y / dist;
                                const nz = diff.z / dist;
                                a.position.x += nx * overlap * 0.5;
                                a.position.y += ny * overlap * 0.5;
                                a.position.z += nz * overlap * 0.5;
                                b.position.x -= nx * overlap * 0.5;
                                b.position.y -= ny * overlap * 0.5;
                                b.position.z -= nz * overlap * 0.5;
                                const rvx = a.velocity.x - b.velocity.x;
                                const rvy = a.velocity.y - b.velocity.y;
                                const rvz = a.velocity.z - b.velocity.z;
                                const dot = rvx * nx + rvy * ny + rvz * nz;
                                if (dot < 0) {
                                    const imp = -(1 + 0.65) * dot * 0.5;
                                    const ix = nx * imp;
                                    const iy = ny * imp;
                                    const iz = nz * imp;
                                    a.velocity.x += ix;
                                    a.velocity.y += iy;
                                    a.velocity.z += iz;
                                    b.velocity.x -= ix;
                                    b.velocity.y -= iy;
                                    b.velocity.z -= iz;
                                }
                            });
                        }
                    }
                }
            });

            this.track9Spheres.forEach((sp) => {
                sp.angularVelocity.multiplyScalar(0.994);
                sp.mesh.rotation.x += sp.angularVelocity.x * dt;
                sp.mesh.rotation.y += sp.angularVelocity.y * dt;
                sp.mesh.rotation.z += sp.angularVelocity.z * dt;
            });
        }

        this.track9Spheres.forEach((sp) => {
            sp.mesh.position.copy(sp.position);
            sp.mesh.scale.setScalar(sp.radiusNow);
        });
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

    /** Scene16 と同型。sceneLightingScale で一括に暗くできる */
    setupLights() {
        this.fillPointLight = null;
        this.pulsePointLight = null;

        const { promoWallLightTarget, promoWallFillLight } = setupStudioRoomPromoWallFillLight(this.scene, {
            ceilingY: this.ceilingY
        });
        this.promoWallLightTarget = promoWallLightTarget;
        this.promoWallFillLight = promoWallFillLight;
    }

    setupAirNoiseVolume() {
        const volumeGeo = new THREE.BoxGeometry(this.roomHalfW * 2.6, this.ceilingY * 1.3, this.roomHalfD * 2.6);
        this.airNoiseMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uDensity: { value: 0.036 },
                uColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                varying vec3 vWorldPos;
                uniform float uTime;
                uniform float uDensity;
                uniform vec3 uColor;

                float hash13(vec3 p) {
                    p = fract(p * 0.1031);
                    p += dot(p, p.yzx + 33.33);
                    return fract((p.x + p.y) * p.z);
                }

                float noise3(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);

                    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
                    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
                    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
                    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
                    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
                    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
                    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
                    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

                    float nx00 = mix(n000, n100, f.x);
                    float nx10 = mix(n010, n110, f.x);
                    float nx01 = mix(n001, n101, f.x);
                    float nx11 = mix(n011, n111, f.x);
                    float nxy0 = mix(nx00, nx10, f.y);
                    float nxy1 = mix(nx01, nx11, f.y);
                    return mix(nxy0, nxy1, f.z);
                }

                float fbm(vec3 p) {
                    float a = 0.5;
                    float s = 0.0;
                    for (int i = 0; i < 4; i++) {
                        s += a * noise3(p);
                        p = p * 2.03 + vec3(17.1, 3.7, 11.9);
                        a *= 0.5;
                    }
                    return s;
                }

                void main() {
                    vec3 p = vWorldPos * 0.0012 + vec3(0.0, uTime * 0.02, uTime * 0.012);
                    float n = fbm(p);
                    float vertical = smoothstep(-500.0, 2500.0, vWorldPos.y);
                    float alpha = uDensity * (0.22 + n * 0.34) * vertical;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.NormalBlending
        });

        this.airNoiseVolume = new THREE.Mesh(volumeGeo, this.airNoiseMaterial);
        this.airNoiseVolume.position.set(0, this.floorTopY + (this.ceilingY - this.floorTopY) * 0.55, 0);
        this.scene.add(this.airNoiseVolume);
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        /** スポットのみだと SSAO が全体を潰して真っ暗に見える */
        this.useSSAO = false;

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });

        if (this.camera.fov < 35 || this.camera.fov > 50) {
            this.camera.fov = 42;
        }
        this.camera.near = 12;
        this.camera.far = 12000;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, 1000, 4500);
        this.camera.lookAt(0, 400, 0);
        this._trailCenter.set(0, this.floorTopY + (this.ceilingY - this.floorTopY) * 0.33, 0);
        this._trailHeadPos.set(0, this._trailCenter.y, 0);
        this._trailHeadDir.set(0, 0.06, 1).normalize();
        this._trailHeadPosShard.copy(this._trailHeadPos);
        this._trailHeadDirShard.copy(this._trailHeadDir);
        this._trailHeadPosCylinder.copy(this._trailHeadPos).add(new THREE.Vector3(140, 40, -120));
        this._trailHeadDirCylinder
            .set(0.35 + Math.random() * 0.4, 0.25 + Math.random() * 0.35, 0.75 + Math.random() * 0.25)
            .normalize();
        this._lastShardPos.copy(this._trailHeadPosShard);
        this._lastCylinderWorldPos.copy(this._trailHeadPosCylinder);
        this._cylinderHelixPhase = 0;

        this.setupEnvironment();

        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
        });
        this.cubeCamera = new THREE.CubeCamera(10, 12000, this.cubeRenderTarget);
        this.cubeCamera.position.set(0, 600, 0);
        this.scene.add(this.cubeCamera);

        this.studio = new StudioBox(
            this.scene,
            studioBoxOptionsForStudioRoom(this.sceneLightingScale, this._roomEnvTexture)
        );
        if (this.studio.studioBox) {
            this.studio.studioBox.visible = false;
        }

        this.buildRoom();

        this.studio.attachCeilingSpotRig(this.roomGroup, {
            ...ceilingSpotRigOptionsForStudioRoom(this.sceneLightingScale)
        });
        this.ceilingMesh = this.studio.ceilingSpotRig.ceilingMesh;

        await this._initWallMatteBlack3DText();

        const floorMat = this.roomGroup.children[0].material;
        const wallMat = this.roomGroup.children[1].material;
        applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);

        this.setupLights();

        this.cableBlobParticle = new Scene05Particle(0, this.cableHomeY, 0);
        this.cableBlobParticle.maxSpeed = 7.0;
        this.cableBlobParticle.maxForce = 1.5;
        this.cableBlobParticle.friction = 0.015;

        this.initMetalShardsSystem();
        this.initRedCylinderSystem();
        this.initRedCylinderBurstParticles();
        this.createAmbientFloatingParticles();
        this.initTrack9SpawnSpheres();
        if (this.cableBlobParticle && this.shardGroup) {
            this.shardGroup.position.copy(this.cableBlobParticle.position);
        }
        // シリンダーは scene 原点固定。cable に親追従させると全体が剛体移動し、カール軌道が見えなくなる
        if (this.cableBlobParticle) {
            this._spawnFocusWorld.copy(this.cableBlobParticle.position);
            this._cameraFocusSmoothed.copy(this._spawnFocusWorld);
        }

        if (this.calloutSystem) {
            this.calloutSystem.setScene(this.scene);
        }

        this.setupCameraParticleDistances();
        this.initPostProcessing();
        this.setParticleCount(this.maxShards + 8 + this.ambientParticleCount + this.maxCylinders + this.maxTrack9Spheres);
        this._initLaserScan();
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
        if (this.ambientDust) {
            this.ambientDust.update(deltaTime, this.time);
            if (this.ambientDust.livingCount < this.ambientMinLiving) {
                const p =
                    this.shardGroup?.position ??
                    this._cameraFocusSmoothed ??
                    new THREE.Vector3(0, this.floorTopY + 600, 0);
                this.ambientDust.spawnBurst(p, this.ambientMinLiving - this.ambientDust.livingCount);
            }
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
            if (this.shardGroup) {
                this.pulsePointLight.position.copy(this.shardGroup.position);
            }
        }
        this.targetLightIntensity += (0.0 - this.targetLightIntensity) * 0.1;

        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const p = this.pulses[i];
            p.progress += deltaTime * p.speed;
            if (p.progress > 1.2) {
                this.pulses.splice(i, 1);
            }
        }

        if (this.cubeCamera && Math.floor(this.time * 60) % 8 === 0) {
            this.cubeCamera.update(this.renderer, this.scene);
        }

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
                const gentleForce = new THREE.Vector3(
                    Math.random() - 0.5,
                    Math.random() - 0.5,
                    Math.random() - 0.5
                )
                    .normalize()
                    .multiplyScalar(0.32);
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
            const both =
                this.shards.length > 0 &&
                this.cylinders.length > 0 &&
                this.shardInstMesh &&
                this.cylinderInstMesh;
            const smoothK = both ? 3.25 : 5.2;
            const a = 1 - Math.exp(-Math.min(deltaTime, 0.12) * smoothK);
            this._cameraFocusSmoothed.lerp(this._spawnFocusWorld, a);
        }
        this.updateCamera();
        const focusTargets = [this.roomGroup, this.shardGroup];
        if (this.cylinderInstMesh) focusTargets.push(this.cylinderInstMesh);
        if (this.track9SphereGroup) focusTargets.push(this.track9SphereGroup);
        if (this.ambientDust) {
            const dm = this.ambientDust.getMainMesh();
            if (dm) focusTargets.push(dm);
        }
        if (this.useAutoFocusDOF) {
            this.updateAutoFocus(focusTargets);
        } else if (this.bokehPass?.uniforms?.focus) {
            this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        }
        updateSsaoDistanceAttenuation(this, this._cameraFocusSmoothed ?? this._spawnFocusWorld);

        if (this.calloutSystem) {
            this.calloutSystem.update(deltaTime, this.time, this.camera, {
                autoGenerate: false,
                maxCount: 8,
                margin: 200
            });
        }

        this._updateWallLaserScan();
    }

    _initLaserScan() {
        if (this.laserScanMesh) return;
        this._laserScanMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0a0a,
            emissive: 0xff0033,
            emissiveIntensity: 32,
            metalness: 0,
            roughness: 0.22,
            fog: true,
            side: THREE.DoubleSide
        });
        const geo = new THREE.PlaneGeometry(1, 1);
        this.laserScanMesh = new THREE.Mesh(geo, this._laserScanMaterial);
        this.laserScanMesh.frustumCulled = false;
        this.laserScanMesh.renderOrder = 2;
        this.scene.add(this.laserScanMesh);
    }

    _laserMeasurePhase() {
        const tpm = Scene08.TICK_LOOP / 96;
        if (this.actualTick != null && Number.isFinite(Number(this.actualTick))) {
            const t = Number(this.actualTick);
            const mod = ((Math.floor(t) % tpm) + tpm) % tpm;
            return mod / tpm;
        }
        const beat = this.time * 0.52;
        return beat - Math.floor(beat);
    }

    _updateWallLaserScan() {
        if (!this.laserScanMesh) return;

        const hw = this.roomHalfW;
        const hd = this.roomHalfD;
        const inset = 44;
        const iw = hw - inset;
        const id = hd - inset;
        const edgeX = 2 * iw;
        const edgeZ = 2 * id;
        const P = 2 * edgeX + 2 * edgeZ;
        const phase = this._laserMeasurePhase();
        const s = phase * P;
        const beamW = Math.min(2200, edgeX * 0.48, edgeZ * 0.48);
        const y = this._wallCenterY;

        let x;
        let z;
        let rotY;
        let segLen;

        if (s < edgeX) {
            x = -iw + s;
            z = -id;
            rotY = 0;
            segLen = edgeX;
        } else if (s < edgeX + edgeZ) {
            const u = s - edgeX;
            x = iw;
            z = -id + u;
            rotY = Math.PI / 2;
            segLen = edgeZ;
        } else if (s < edgeX + edgeZ + edgeX) {
            const u = s - edgeX - edgeZ;
            x = iw - u;
            z = id;
            rotY = Math.PI;
            segLen = edgeX;
        } else {
            const u = s - edgeX - edgeZ - edgeX;
            x = -iw;
            z = id - u;
            rotY = -Math.PI / 2;
            segLen = edgeZ;
        }

        const w = Math.min(beamW, segLen * 0.98);
        const h = 56;
        this.laserScanMesh.scale.set(w, h, 1);
        this.laserScanMesh.position.set(x, y, z);
        this.laserScanMesh.rotation.set(0, rotY, 0);
    }

    handleTrackNumber(trackNumber, message) {
        const tn = Scene08.parseTrackNumber(trackNumber, message);
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
            if (velocity > 0) {
                this.spawnRedCylinderFromTrack6(velocity, durationMs, noteNumber);
            }
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
            } else {
                this._track9SpawnWindowEndMs = 0;
            }
        } else if (tn === 7) {
            this.trackValues[7] = value;
            if (velocity > 0) {
                this.colorIndex = (this.colorIndex + 1) % this.colors.length;
            }
        } else if (tn === 9) {
            /** args[2]: デュレーション（ms）。未指定は 180 */
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

    initPostProcessing() {
        setupPostEffectsPipeline(this, {});
    }

    onResize() {
        super.onResize();
        resizePostEffectsPasses(this);
    }

    render() {
        this.renderer.setClearColor(0x151820);
        super.render();
    }

    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        if (this.ssaoPass) {
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.ssaoPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            this.ssaoPass.enabled = false;
            this.ssaoPass = null;
        }
        if (this.saoPass) {
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.saoPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            this.saoPass.enabled = false;
            this.saoPass = null;
        }
        if (this.aoDepthTexture) {
            this.aoDepthTexture.dispose();
            this.aoDepthTexture = null;
        }

        disposePresentationOutputPass(this);
        if (this.studio) {
            this.studio.dispose();
            this.studio = null;
        }

        if (this.wallTitleGroup) {
            this.scene.remove(this.wallTitleGroup);
            this.wallTitleGroup.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
            });
            this.wallTitleGroup = null;
        }
        if (this._wallTitleMaterial) {
            this._wallTitleMaterial.dispose();
            this._wallTitleMaterial = null;
        }

        if (this.shardGroup) {
            this.scene.remove(this.shardGroup);
            this.shards = [];
            if (this.shardInstMesh) {
                if (this.shardInstMesh.geometry) this.shardInstMesh.geometry.dispose();
                this.shardInstMesh.dispose();
                this.shardInstMesh = null;
            }
            this._shardOpacityAttr = null;
            this._shardFreeSlots = [];
            this._metalShardMaterial = null;
            this.shardGroup = null;
        }

        if (this.cylinderInstMesh) {
            this.scene.remove(this.cylinderInstMesh);
            this.cylinderInstMesh.dispose();
            this.cylinderInstMesh = null;
            this.cylinders = [];
            this._cylinderFreeSlots = [];
            this._redCylinderMaterial = null;
        }
        if (this.redBurstInstMesh) {
            this.scene.remove(this.redBurstInstMesh);
            this.redBurstInstMesh.dispose();
            this.redBurstInstMesh = null;
        }
        if (this.redBurstSharedGeo) {
            this.redBurstSharedGeo.dispose();
            this.redBurstSharedGeo = null;
        }
        if (this.redBurstMaterial) {
            this.redBurstMaterial.dispose();
            this.redBurstMaterial = null;
        }
        this._redBurstPositions = null;
        this._redBurstVelocities = null;
        this._redBurstColors = null;
        this._redBurstRotQuats = null;
        this._redBurstScales = null;
        this._redBurstActive = false;
        if (this.obsidianInstMesh) {
            this.scene.remove(this.obsidianInstMesh);
            this.obsidianInstMesh.dispose();
            this.obsidianInstMesh = null;
        }
        if (this.obsidianGeometry) {
            this.obsidianGeometry.dispose();
            this.obsidianGeometry = null;
        }
        if (this.obsidianMaterial) {
            this.obsidianMaterial.dispose();
            this.obsidianMaterial = null;
        }
        if (this.obsidianBumpMap) {
            this.obsidianBumpMap.dispose();
            this.obsidianBumpMap = null;
        }
        this._obsidianPositions = null;
        this._obsidianVelocities = null;
        this._obsidianRotQuats = null;
        this._obsidianScales = null;

        if (this.ambientDust) {
            this.ambientDust.dispose();
            this.ambientDust = null;
        }

        if (this.track9SphereGroup) {
            this.scene.remove(this.track9SphereGroup);
            for (const sp of this.track9Spheres) {
                if (sp.mesh && sp.mesh.material) sp.mesh.material.dispose();
            }
            this.track9Spheres = [];
            if (this.track9SharedGeo) {
                this.track9SharedGeo.dispose();
                this.track9SharedGeo = null;
            }
            if (this._track9SphereMaterial) {
                if (this._track9SphereMaterial.map) this._track9SphereMaterial.map.dispose();
                if (this._track9SphereMaterial.bumpMap) this._track9SphereMaterial.bumpMap.dispose();
                this._track9SphereMaterial.dispose();
                this._track9SphereMaterial = null;
            }
            this._track9FleshTextures = null;
            this.track9SphereGroup = null;
        }

        if (this.promoWallFillLight) {
            this.scene.remove(this.promoWallFillLight);
            this.promoWallFillLight.dispose();
            this.promoWallFillLight = null;
        }
        this.ceilingMesh = null;

        if (this.promoWallLightTarget) {
            this.scene.remove(this.promoWallLightTarget);
            this.promoWallLightTarget = null;
        }

        if (this.laserScanMesh) {
            this.scene.remove(this.laserScanMesh);
            if (this.laserScanMesh.geometry) this.laserScanMesh.geometry.dispose();
            if (this._laserScanMaterial) {
                this._laserScanMaterial.dispose();
                this._laserScanMaterial = null;
            }
            this.laserScanMesh = null;
        }

        if (this.airNoiseVolume) {
            this.scene.remove(this.airNoiseVolume);
            if (this.airNoiseVolume.geometry) this.airNoiseVolume.geometry.dispose();
            this.airNoiseVolume = null;
        }
        if (this.airNoiseMaterial) {
            this.airNoiseMaterial.dispose();
            this.airNoiseMaterial = null;
        }

        if (this.cubeCamera) {
            this.scene.remove(this.cubeCamera);
            this.cubeCamera = null;
        }
        if (this.cubeRenderTarget) {
            this.cubeRenderTarget.dispose();
            this.cubeRenderTarget = null;
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

        disposeStudioRoomEnvironmentMap(
            { pmremGenerator: this.pmremGenerator, envMapTexture: this._roomEnvTexture },
            this.scene
        );
        this.pmremGenerator = null;
        this._roomEnvTexture = null;

        if (this.calloutSystem) {
            this.calloutSystem.setScene(null);
        }

        super.dispose();
    }
}
