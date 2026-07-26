/**
 * Scene14: dreamcore
 *
 * Scene12 を土台にコピーし、部屋・StudioBox・ライト・蛍光灯・グリッド系メイン
 * オブジェクトを全部そぎ落として作ったドリームコアシーン。
 *
 * 中身:
 *   - ちょっと大きめのパステル球体パーティクル（テクスチャ + バンプで質感付き）
 *   - Scene01 と同じ「空間ハッシュグリッド」による相互衝突判定
 *   - ゆっくり churning する浮遊クラウド（球状コンテナ内で漂う）
 *   - ポスト処理（DOF / Bloom / FilmGrain / Strobe）と薄い空気ノイズ
 *   - OSC: /phase 等は親委譲、track2 は色反転、ノートで局所バースト
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
    STUDIO_FLOOR_TOP_Y
} from '../../lib/presentation/index.js';
import { StudioAtmosphere } from '../../lib/StudioAtmosphere.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { Scene14Particle } from './Scene14Particle.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VHSPass } from '../../lib/VHSPass.js';
import { VHSOverlay } from '../../lib/VHSOverlay.js';
import { SoftDofPass } from '../../lib/SoftDofPass.js';

export class Scene14 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'In My Dream(Last Night)';
        this.initialized = false;
        this.sceneNumber = 14;
        this.kitNo = 4;
        this.sharedResourceManager = sharedResourceManager;

        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;
        this.sceneLightingScale = 0.32;
        /** @type {THREE.Light[] | null} */
        this._minimalLights = null;

        // ===== パフォーマンスモード（録画時など）=====
        // URL に `?perf=1` を付けると軽量設定で起動する。
        // このシーンはパーティクル数ではなく **画素数（ポスト処理の段数）** が支配的なので、
        // 粒が40個でも重い＝落とすべきはジオメトリではなくフルスクリーンパス。
        this.perfMode = new URLSearchParams(window.location.search).get('perf') === '1';
        // `?prof=1` で内訳を1秒ごとに console へ出す（どこがボトルネックかを推測せず実測する）
        this.profile = new URLSearchParams(window.location.search).get('prof') === '1';
        this._prof = { physics: 0, grid: 0, collide: 0, pads: 0, upload: 0, dof: 0, frames: 0, t: 0 };

        // ===== ポスト処理 =====
        this.useDOF = true;
        this.useBloom = true;
        // SSAO は「シーン全体をもう2回描き直す」（beauty + normal）ため単独で最も重い。
        // ブルーム＋グレイン＋VHSのクロマにじみが乗った後はほぼ見えないので常時OFF。
        // ライブ・フルスクリーン前提なのでここは戻さない（見たければ true に）
        this.useSSAO = false;
        // 専用グレインパス（SensorFilmGrainPass）とその手前の FilmLookPass は使わない。
        // このフラグを true にすると両方が composer に足され、
        // intensity=0 でも **効果ゼロのフルスクリーンパスが2枚** 走ってしまう。
        // グレインは VHSPass 内で処理する（useVHSGrain）
        this.useFilmGrain = false;
        this.useVHSGrain = true;     // テープのざらつき（VHSPass内で合成）

        // ===== VHSルック（テープ劣化＋OSD文字）=====
        this.useVHS = true;
        this.useVHSOverlay = true;   // ▶ PLAY / SP / カウンタ / 日付
        this.vhsPass = null;
        this.vhsOverlay = null;
        this.vhsParams = {
            chromaBlur: 1.25,    // 色にじみ（VHSらしさの本体）。上げると色が輪郭からハミ出す
            chromaDelay: 1.0,    // 色が右へズレる量
            chromaBoost: 1.18,   // にじんだ色の彩度を戻す
            scanline: 0.10,      // 走査線の濃さ
            scanCount: 1100,     // 走査線の本数（多い=細い / 少ない=太い。DPI非依存）
            interlace: 0.05,     // インターレース（フレーム交互の明暗）
            lineJitter: 1.0,     // 走査線ごとの横ブレ
            trackingWidth: 0.016,   // 流れる乱れ帯の太さ（画面高さ比。0.016＝画面の1.6%）
            headSwitch: 0.45,       // 画面最下部の常時ノイズ帯
            headSwitchWidth: 0.014, // 最下部ノイズ帯の太さ
            // テープの傷（チラチラする白い横線）の出やすさ。0.5 は多すぎたので控えめに
            dropout: 0.16,
            ringing: 0.35,       // 過剰シャープの白フチ
            // 残像（前フレーム混合）は VHS 要素の中で一番見えにくいのに、
            // 追加サンプル1回＋前フレーム保存用のコピーパス1枚を食う。既定でOFF。
            // 欲しければ 0.16 くらいを入れる
            ghost: 0,
            barrel: 0.030,       // ブラウン管の樽型歪み
            vignette: 0.26,      // 四隅の落ち込み
            amount: 1.0          // 全体の適用量
        };
        this.vhsOverlayParams = { opacity: 0.8, mode: 'PLAY', tape: 'SP', dateText: 'JAN 01 1998' };
        // グレインは専用パス（SensorFilmGrainPass）を使わず VHSPass 内で処理する＝1パス節約
        this.vhsGrain = 0.055;
        this.vhsGrainColor = 0.028;
        // OSC: どのトラックでトラッキングノイズ／垂直ロールを走らせるか
        this.vhsTrackingTrack = 5;   // このトラックのノートで乱れ帯が上→下へ走る
        this.vhsRollTrack = 6;       // このトラックのノートで画面が縦にガクッとずれる
        // ロールは毎ノート効くと画面が揺れ続けて目が疲れるので間引く
        this.vhsRollCooldown = 4.5;  // 前回から最低これだけ秒数を空ける
        this.vhsRollChance = 0.3;    // クールダウン明けでもこの確率でしか揺れない
        this.vhsRollAmpScale = 0.5;  // 揺れ幅そのものも控えめに
        this._lastVhsRollT = -999;
        // OSC が来ていなくても、たまに自前で乱れ帯を流す
        // （track5 を送っていないと帯が一切出ないので、それだと存在に気づけない）
        this.vhsAutoTracking = true;
        this.vhsAutoTrackingMin = 5.0;    // 次に流れるまでの最短秒
        this.vhsAutoTrackingMax = 16.0;   // 最長秒
        this._vhsAutoT = 3.0;             // 次の発火までの残り秒

        this._windowFrameMat = null;
        this.useAutoFocusDOF = true;
        // DOF の設定（SoftDofPass に渡す）。BokehPass 時代と同じ数値
        this.dofSettings = {
            focus: 2100,
            aperture: 0.0000042,   // 被写界深度を浅く（ボケ量を稼ぐ）
            maxblur: 0.0060        // ボケの最大半径（UV比）
        };
        // 深度RTの解像度倍率。ボケ量の判定にしか使わないので粗くてよい＝深度再描画が1/4
        this.dofDepthScale = 0.5;
        // SSAO パラメータ（scene12系のnear/far制御）
        this.ssaoNearKernelRadius = 12.0;
        this.ssaoNearMinDistance = 0.012;
        this.ssaoNearMaxDistance = 0.18;
        this.ssaoFarAttenuation = 0.4;
        this.ssaoResScale = 0.5;     // SSAOレンダー解像度（0.5=半分＝激軽）
        this.bloomPass = null;
        this.outputPass = null;

        // ===== 部屋：各面それぞれ違うドリームコア色（グレーテクスチャに color で着色）=====
        // BoxGeometryのマテリアル順 [+X,-X,+Y,-Y,+Z,-Z] = [右,左,天井,床,前,後]
        // 各壁・床は「一色」（ドリームコア：くすんだダスティピンク＋セージ＋淡ラベンダー）
        // 各壁・床は「一色」（明るくクリーンなパステル：ソフトピンク＆ミント＋淡い床）
        // ビビッド：アルベドをしっかり発色（薄さは照明＋ヘイズで作る）
        this.wallColors = {
            right: 0xff4fa2,   // ビビッドピンク
            left: 0x4fd48c,    // ビビッドグリーン（目の基準）
            ceil: 0xf25cc0,    // ビビッドピンク（天井）
            floor: 0xeeba62,   // ゴールド／木（床）
            front: 0xff5f8e,   // ローズ
            back: 0x5fd49e     // ミント
        };
        // ニョキッと生える時に先端が光るネオン発光の強さ（ブルームで拾う）
        // 1.0以下＝クリップしない（白飛びゼロ）。ネオンの色をそのまま残す
        this.padGlowBoost = 0.85;
        this.padGlowRef = 360;     // このpop量で最大発光
        this.padPopBase = 1050;    // pop量のベース（大きいほど長く飛び出す）
        this.padPopScale = 1.0;    // phase によって上書きされる倍率（ピークで大きくなる）
        this._padGlowAttr = null;
        this._padGlowColorAttr = null;   // per-instanceの発光色（ヒートマップ）
        this._popCol = new THREE.Color();
        this._lastPopIdx = -1;           // 直前に押し出したパッド
        this._lastNote = 60;             // 直前のnote（シーケンス近接判定）
        this.seqSpread = 20;             // これ以内のnote差なら"近い"クラスタ

        // キューブ色のノイズ用パレット（偏り：ピンク/ミント多め＋寒色ちょい）
        this.cubeHuePalette = [
            0.95, 0.95, 0.92,         // pink ×3
            0.06,                     // peach
            0.15, 0.15,               // yellow ×2（空の色）
            0.35, 0.42,               // mint / green
            0.55, 0.58, 0.58, 0.62,   // sky blue ×3 / periwinkle（青しっかり）
            0.75                      // lavender
        ];
        this.cubeNoiseScale = 0.0011;   // 小さいほど色の塊が大きい
        this.poolMode = true;           // プール配色（淡いミント壁）
        this.floorTileColor = 0x87c9f0; // 床＝青空ブルー（壁ベースと同系）
        this._floorFaceIndex = 3;       // faces順 [右,左,天井,床,前,後] の床
        // 本物のラウンドキューブ（パッド）を敷き詰めるための保持
        this._roomBaseMesh = null;   // 継ぎ目（溝）用のダークな下地箱
        this._roomBaseMat = null;
        this._padMesh = null;        // 6面ぶんのパッドを1つのInstancedMeshで
        this._padGeo = null;
        this._padMat = null;
        this._padTex = null;         // キューブの汚れテクスチャ
        this.usePadTexture = false;  // 色マップ（汚れ）はOFF＝色を濁らせない
        this.usePadBump = true;      // バンプ（表面の凹凸）はON＝ちゃちさ解消。per-instanceで柄がランダム
        // タイル1枚の大きさ。小さいほど枚数が増える（360で約1700インスタンス）。
        // 影・SSAO・DOF で何度も描き直されるので、perfMode では大きくして枚数を減らす
        this.roomPadFace = this.perfMode ? 520 : 360;
        this.roomPadDepth = 1200;    // 奥（壁の中）へ伸びる長さ＝なが〜いキューブ
        this.padPushSpread = 0.9;    // 押し出し方向の角度ランダムさ（0=法線ぴったり, 大きいほど散る）
        this.floorPushBoost = 2.6;   // 床（上向き）の吹き上げ倍率（重力に逆らって力強く）
        this.roomPadGap = 14;        // パッド同士の隙間（溝）を詰める
        // track7〜12でパッドを内側へポップさせるためのデータ
        this._pads = null;           // {pos,n,m(回転+スケール),face,col,row,cols,rows}
        this._padPop = null;         // 現在の飛び出し量
        this._padTarget = null;      // ホールド中の目標量
        this._padHold = null;        // ホールド残り時間
        this._padActive = false;     // 1つでも動いてたら毎フレーム更新
        this._padTmpM = new THREE.Matrix4();
        this._padTmpV = new THREE.Vector3();

        // ===== 空気（暖色のヘイズ＝アンバー／ピーチで奥をふんわり暖かく）=====
        this.useSceneFog = true;
        this.sceneFogColor = 0xdcecf2;   // 淡い水色白のヘイズ（ドリームコア統一）
        this.sceneFogDensity = 0.00001;  // 【切り分け】ほぼ無効にして彩度への影響を除外

        // 空気ノイズ（チリは出さず、空気の質感だけ薄く）
        this.atmosphere = null;
        this.ambientParticleCount = 0;

        // シャドウ（球体に柔らかい影が出ると質感が上がる）
        this.enableShadows = true;

        // カメラの注視点（クラウド中心）
        this.centerY = STUDIO_FLOOR_TOP_Y + 1600;
        this._center = new THREE.Vector3(0, this.centerY, 0);
        this._centerSmoothed = new THREE.Vector3(0, this.centerY, 0);

        // ゆるいオートオービット用（部屋の内側を漂うように）
        this.orbitRadius = 3150;   // さらに引き（部屋拡大に合わせて）
        this.orbitSpeed = 0.05;
        this.orbitBob = 450;
        this.cameraFov = 58;       // 画角も広げて引き感アップ
        // track1 カメラランダマイズで動的に変わる視点パラメータ
        this._orbitPhase = 0;
        this._camRadius = this.orbitRadius;
        this._camHeightOff = 0;
        // 注視対象（オブジェクトにフォーカスが当たってるように見せる）
        this._focusIdx = -1;
        this._focusRepickT = 0;
        this.focusRepickInterval = 4.5;   // この秒数ごとに注視対象を選び直す
        // カメラワークのショット（particle=オブジェクト注視 / window=窓 / ceiling=天井 / drift=見回し）
        this._camShot = 'particle';
        this._camShotT = 0;
        this._camShotDur = 6;
        this._lookTarget = new THREE.Vector3(0, 0, 0);
        // track1カメラランダマイズの間引き：LFO疑似ノイズで「反応度」が数十秒〜数分周期でうねる。
        // 反応度が高い時期＝ほぼ毎ノート追従（ガッツリ）/ 低い時期＝ゆったり構える
        this.track1CooldownSlow = 7.0;    // ゆったり期の最小間隔（秒）
        this.track1CooldownFast = 0.6;    // ガッツリ追従期の最小間隔（秒）
        this.track1ChanceSlow = 0.35;     // ゆったり期の反応確率
        this.track1ChanceFast = 0.95;     // ガッツリ追従期の反応確率
        this._lastCamRandomizeT = -999;

        // ===== パステル球体パーティクル =====
        this.instancedMeshManager = null;
        this.particles = [];
        // 「死ぬ程速い」と確認できた構成に戻す（ポスト処理削減直後と同じ値）
        this.sphereCount = 500;
        this.sphereMinRadius = 95;
        this.sphereMaxRadius = 330;

        // ===== /phase 連動のビートマップ（9スロット）=====
        // ビートマップの各スロット(=phase 1〜9)に「粒の量」と「エフェクトの強さ」を割り当てる。
        // 4 と 6 がピーク（全部ON）、7〜8 で落ち着く、9 でアウトロ、1〜3 はビルドアップ。
        //   particles : sphereCount に対する比率
        //   vhs       : VHSルック全体の適用量（uAmount）
        //   bloom     : ブルーム強度
        //   dropout   : チラつく横線の出やすさ
        //   grain     : ざらつき
        //   tracking  : 自動トラッキングノイズの間隔（秒）。0 で出さない
        //   roll      : 垂直ロールの発生確率（0で無効）
        //   pads      : パッドの飛び出し量の倍率
        //   cam       : カメラランダマイズの反応しやすさ倍率
        //   mode      : 粒の増減のさせ方
        //                'grow' = phase 中ずっと actual_tick に合わせて増え続ける（1〜3）
        //                'hold' = その比率へ素早く合わせて維持（4〜6）
        //                'fade' = phase 中ずっと actual_tick に合わせて減り続ける（7〜9）
        this.phaseTable = [
            /* 1 intro    */ { particles: 0.10, mode: 'grow', vhs: 0.35, bloom: 0.16, dropout: 0.05, grain: 0.030, tracking: 0,  roll: 0,    pads: 0.45, cam: 0.35 },
            /* 2 build    */ { particles: 0.30, mode: 'grow', vhs: 0.50, bloom: 0.20, dropout: 0.08, grain: 0.040, tracking: 18, roll: 0,    pads: 0.60, cam: 0.5 },
            /* 3 build    */ { particles: 0.70, mode: 'grow', vhs: 0.70, bloom: 0.26, dropout: 0.12, grain: 0.050, tracking: 12, roll: 0.1,  pads: 0.8,  cam: 0.7 },
            /* 4 PEAK     */ { particles: 1.00, mode: 'hold', vhs: 1.00, bloom: 0.38, dropout: 0.20, grain: 0.060, tracking: 5,  roll: 0.35, pads: 1.25, cam: 1.0 },
            /* 5 break    */ { particles: 0.52, mode: 'hold', vhs: 0.60, bloom: 0.22, dropout: 0.10, grain: 0.045, tracking: 14, roll: 0.08, pads: 0.7,  cam: 0.55 },
            /* 6 PEAK     */ { particles: 1.00, mode: 'hold', vhs: 1.00, bloom: 0.38, dropout: 0.20, grain: 0.060, tracking: 5,  roll: 0.35, pads: 1.25, cam: 1.0 },
            /* 7 settle   */ { particles: 0.60, mode: 'fade', vhs: 0.78, bloom: 0.30, dropout: 0.13, grain: 0.052, tracking: 10, roll: 0.15, pads: 0.9,  cam: 0.7 },
            /* 8 settle   */ { particles: 0.30, mode: 'fade', vhs: 0.58, bloom: 0.24, dropout: 0.09, grain: 0.044, tracking: 15, roll: 0.05, pads: 0.7,  cam: 0.5 },
            /* 9 outro    */ { particles: 0.04, mode: 'fade', vhs: 0.40, bloom: 0.17, dropout: 0.05, grain: 0.034, tracking: 22, roll: 0,    pads: 0.5,  cam: 0.3 }
        ];
        // 1フェーズが何tickぶんか（96小節を9分割）。grow/fade の進み具合の基準に使う
        this.ticksPerPhase = Math.round((96 * 384) / 9);
        this._phaseStartTick = 0;    // 現在の phase に入った時の actual_tick
        this._phaseStartRatio = 0;   // 現在の phase に入った時の粒の比率（連続性のため）
        this._phaseStartTime = 0;    // tick 未受信時のフォールバック用
        this.usePhaseBeatmap = true;
        // 粒の増減はいきなり切り替えず、この速さ（個/秒）で目標へ寄せる
        this.phaseParticleRate = 60;
        // エフェクト値のスムージング（0〜1。小さいほどゆっくり変化）
        this.phaseLerp = 0.04;
        this._phaseApplied = -1;        // 最後に適用した phase
        this._phaseTargetCount = 1;     // 目標の粒数
        this._revealCount = 0;          // 現在出現している粒数
        this._phaseFx = null;           // 現在のエフェクト値（目標へ徐々に寄せる）
        this._phaseFxTarget = null;

        // /phase が来ないとき用のフォールバック：この秒数ごとに phase を1つ進める
        this.phaseFallbackSec = 24;
        this._phaseFallbackT = 0;
        this._phaseSeen = false;        // /phase を一度でも受け取ったか

        // スカイドームの1周に使う（96小節 = 1小節384tick）
        this.ticksPerLoop = 96 * 384;
        this.tickFallbackLoopSec = 192;   // OSC未受信時のフォールバック周期

        // ラウンドキューブを混ぜる（パーティクルの一部をキューブ形状に）
        // 全体の何割をキューブにするか。
        // 0＝パーティクルは全部球。大きいキューブは物理を持たない「置物」として別管理する
        // （this.staticCube* を参照）。戻したいときはここを 0.38 などにする
        this.cubeParticleRatio = 0;
        this.cubeParticleMin = 100;
        this.cubeParticleMax = 360;
        this._cubeParticleMesh = null;
        this._cubeParticleGeo = null;
        this._cubeParticleMat = null;

        // ===== 静的な大キューブ（床に置かれた「置物」）=====
        // 物理更新はせず、床の上に置いたまま動かない。球パーティクルはこれに衝突して跳ねる。
        this.staticCubeCount = 5;
        this.staticCubeMin = 520;    // 1辺の長さ（球の最大直径660と同じくらい〜少し上）
        this.staticCubeMax = 1000;
        this.staticCubeTilt = 0.05;  // わずかな傾き（rad）。0でキッチリ正立
        this._staticCubes = [];      // { pos, half(Vector3), rotY, cos, sin }
        this._staticCubeMesh = null;
        this._staticCubeGeo = null;
        this._staticCubeMat = null;
        this._scTmpV = new THREE.Vector3();
        this._scTmpN = new THREE.Vector3();
        this._pTmpM = new THREE.Matrix4();
        this._pTmpQ = new THREE.Quaternion();
        this._pTmpS = new THREE.Vector3();

        // ===== 箱型の部屋（StudioBox風）：この中で反発して漂う =====
        this.roomHalfX = 3500;
        this.roomHalfZ = 3500;
        this.roomHalfY = 2400;
        this.roomFloorY = this.centerY - this.roomHalfY;
        this.roomCeilY = this.centerY + this.roomHalfY;
        this.wallRestitution = 0.72;   // 壁の反発係数（1で完全弾性）

        // ===== 窓＋スカイドーム（Poly Haven のトーンマップ済みJPG＝ただの画像。ライティング計算なし）=====
        this.useSkyWindow = true;
        // 青空＋もこもこ入道雲（ドリームコア定番の空）。skyMirrorHorizon で下半分を空の鏡像にできる
        // 別候補: '/hdri/belfast_sunset_puresky_2k.jpg'（紫雲×金の夕焼け）
        //         '/hdri/the_sky_is_on_fire_2k.jpg'（燃える虹色雲）
        //         '/hdri/qwantani_dusk_2_puresky_2k.jpg'（ラベンダー→ピンクのパステルグラデ）
        //         '/hdri/industrial_sunset_puresky_2k.jpg' / '/hdri/kloppenheim_02_puresky_2k.jpg'
        this.skyImagePath = '/hdri/kloofendal_48d_partly_cloudy_puresky_2k.jpg';
        this.skyMirrorHorizon = true;    // 上半分（空）を下半分にミラーして地面・街を消す
        // ドームを部屋の後方（窓の向こう側）へ離して置く＝空が遠くなり、雲・太陽が小さく見える。
        // skyPushBack=0 で従来のドセンター（空がドアップ）。大きいほど空が縮んで見える
        this.skyPushBack = 12000;
        this.skyDomeRadius = 24000;      // 後方に離しても部屋全体を包める半径
        this.skyBrightness = 1.0;        // 画像の明るさ倍率（LDR画像なので1超は白飛び＋ブルーム過多に注意）
        // 太陽の方位合わせ：画像の u≒0.58（kloofendal の太陽）が窓（-Z方向）の正面に来る回転角。
        // ズレてたらここを ±0.1 刻みで微調整（+で空が左へ動く）
        this.skyRotationY = -1.07;
        // 96小節（actual_tick 1ループ）でちょうど1周させる。
        // = ループ頭で太陽が窓正面 → じわじわ流れて → ループ終わりに戻ってくる
        this.skySpinWithTick = true;
        // 太陽の高さ合わせ：kloofendal の太陽は仰角54°と高くて窓に入らないので、
        // ドームごとX軸で傾けて仰角≒15°（窓のド真ん中の高さ）まで下ろす。（+で太陽が上がる）
        this.skyTiltX = -0.68;
        this.windowFaceIndex = 5;        // faces順 [右,左,天井,床,前,後] → 後ろ壁（※後ろ壁のみ対応）
        this.windowTilesW = 15;          // 窓の幅（タイル数）＝壁の約8割（約5500）
        this.windowTilesH = 11;          // 窓の高さ（タイル数）＝壁の約8割（約4060）
        this.windowRowOffset = 0;        // 窓の縦位置（中央。上下1タイルずつ残る）
        this.windowFrameThickness = 70;  // 白い縁取りの太さ
        this._windowRect = null;         // _buildRoom で計算した窓の実座標
        this._skyDome = null;
        this._skyTexture = null;
        this._windowGroup = null;
        this._windowTex = null;          // 窓枠の汚し（ノーマル／ラフネス。色マップは使わない）
        this._roomBaseHiddenMat = null;  // 下地箱の窓面を消すための非表示マテリアル

        // 空間ハッシュグリッド（相互衝突用）。セルは最大直径より大きく取る
        this.grid = new Map();
        // セルは最大直径（キューブ 360*2=720）より大きく取る＝衝突漏れ防止
        this.gridSize = 740;

        // 動きのパラメータ（無重力ふわふわ＝風船。一定方向の渦はナシ）
        this.wanderStrength = 5.0;   // 空気中の横揺れ（重力が主なので弱め）
        this.wanderTurn = 1.1;       // 向きの変わりやすさ
        this.floatDrift = 3.0;       // ほんの少しの揺らぎ
        // ===== 全体のスピード（スローモーション倍率）=====
        // 1.0 = 実時間。小さいほど全部がゆっくりになる。
        // パーティクルの物理だけでなく、ニョキッと生えるパッドの伸縮にも掛かるので、
        // 「シーン全体の速さ」はこの1つで決まる。
        this.motionScale = 0.6;

        // ===== 重力（現実スケール）=====
        // 部屋は 7000 x 4800 x 7000 単位。1000単位 = 1m と解釈すると 7m x 4.8m の部屋、
        // 球は直径 19〜66cm（ボールプールの玉くらい）＝見た目のスケールと一致する。
        // ※ この値を上げると「同じ部屋がより狭い実空間」になる＝落下が速くなる。
        //   ゆっくりにしたいときは上げるのではなく motionScale を下げる方が素直
        //   （速度の閾値も自動で追従するため）。
        this.worldUnitsPerMeter = 1000;
        this.gravityMps2 = 9.81;
        // 速度は「1/60秒あたりの移動量」なので、加速度は 1コマ² あたりへ換算する。
        //   1コマ後の速度 = a_frame、n コマ後の落下距離 ≒ a_frame * n²/2
        //   実際は (1/2)*g*t² で n = 60t なので a_frame = g / 3600
        // → 9.81 m/s² は約 2.7 単位/コマ²。以前の 5.0 は実は重力1.8倍だった
        //   （＝ふわふわの原因は重力ではなく空気抵抗の方だった）
        this.gravity = (this.gravityMps2 * this.worldUnitsPerMeter) / 3600;
        this.floorRestitution = 0.34; // 床の反発（低め＝跳ねすぎず積もる）
        // 跳ね返りを真上に固定しないための散らし。上向き成分の何割を横へ振り替えるか
        this.bounceSpread = 0.38;
        // この速度以下の跳ね返りは強く減衰させて止める（細かい震えを消す）
        // 「この速度以下の跳ね返りは止める」閾値。
        // motionScale を下げると速度そのものが比例して小さくなるので、閾値も同じ比率で下げないと
        // 着地した瞬間に跳ねが全部殺されて、ぺたっと張り付いて止まってしまう
        this.bounceStopSpeed = 38 * this.motionScale;
        this.floorFriction = 0.9;     // 着地時に横方向へかける摩擦
        // 回転：常時回転せず、力が加わった時だけ回る（慣性）
        this.angularDamp = 0.90;     // 角速度の減衰（小さいほど早く止まる）
        this.spinStopSpeed = 12.0 * this.motionScale;   // これ以下の移動速度なら回転を素早く止める
        this.rollFactor = 0.0016;    // 着地時の転がり回転への変換係数
        this.spinImpulse = 0.004;    // 衝突の衝撃→回転インパルス係数

        // OSCノートのバースト
        this._pastelPulse = 0.0;
        this._glowLight = null;

        this._tmpVec = new THREE.Vector3();
        this._diff = new THREE.Vector3();
        this._colorTmp = new THREE.Color();

        // track2 色反転（瞬間フラッシュ）
        this.useTrack2Strobe = false;
        this.track2FlashMs = 60;

        // 3=色収差 / 4=グリッチ はOFF（4はワイヤーフレーム化に差し替え。
        // trackEffects[4]=true にすると SceneBase がグリッチパスを有効化して
        // 効果ゼロのまま毎フレーム1パス無駄に走るので、false のままにする）
        this.trackEffects = {
            1: true, 2: true, 3: false, 4: false, 5: true,
            6: true, 7: true, 8: true, 9: true, 12: true
        };

        this.setScreenshotText(this.title);

        this._dofCamDir = new THREE.Vector3();
        this._dofToTarget = new THREE.Vector3();
    }

    // ===== ライト（パステル球体が柔らかく見えるよう色味を足す） =====
    setupMinimalLights() {
        this._minimalLights = [];

        // 照明そのものをピンク寄りに（＝空の光。アルベドを洗ってエアリーにする）
        const amb = new THREE.AmbientLight(0xeef2f8, 0.16);   // 明るく照らしてピンクが小豆色に沈まないように
        this.scene.add(amb);
        this._minimalLights.push(amb);

        // 空=淡い水色白 / 地=淡ブルーのバウンス（緑被り防止・明るめ）
        const hem = new THREE.HemisphereLight(0xf2f6ff, 0xdde9f5, 0.22);
        this.scene.add(hem);
        this._minimalLights.push(hem);

        // 影用のキーライト（暖かいピンクのディレクショナル）。球同士の影がクッキリ出る
        const dir = new THREE.DirectionalLight(0xfbfcff, 1.7);
        dir.position.set(2600, this.centerY + 3600, 2200);
        dir.target.position.set(0, this.centerY, 0);
        this.scene.add(dir.target);
        dir.castShadow = this.enableShadows;
        if (dir.shadow) {
            // 影は「なんとなくの形が出てればOK」方針なので解像度を落とす。
            // 1024 ならクリア＆書き込みが 2048 の 1/4。テクセルが粗くなるぶん影は自然にボケる
            const sm = this.perfMode ? 512 : 1024;
            dir.shadow.mapSize.set(sm, sm);
            // フラストラムは「部屋の8隅をライト視点へ投影した実寸」でぴったり合わせる。
            //  - 小さすぎると、マップ外を参照した画素が ClampToEdge で縁の深度を拾い、
            //    何も無い所に偽の影が伸びる
            //  - 大きすぎるとテクセルが粗くなり、必要な bias が増えて
            //    影が接地点から剥がれる（ピーターパン現象＝影が浮く）
            // 外接球だと 15〜20% 余分に取ってしまうので、実投影で詰める
            this._fitShadowFrustum(dir);

            // テクセルが細かいほど必要な bias が小さくて済む＝影が接地点に貼り付く。
            // パッド（壁・床タイル）は castShadow=false なので、影の描画コストは
            // 球＋大キューブぶんだけ。解像度を上げても負荷は小さい
            const texel = (dir.shadow.camera.right - dir.shadow.camera.left) / sm;
            // normalBias は「テクセル1個ぶん」が目安。解像度を変えても自動で追従する
            dir.shadow.normalBias = texel * 1.0;
            dir.shadow.bias = -0.00004;
            // PCF は radius でカーネルの広がりを決める（PCFSoft では無視される）。
            // 低解像度＋radius でふんわりした輪郭にする
            dir.shadow.radius = 3.0;
        }
        this.scene.add(dir);
        this._minimalLights.push(dir);
        this._minimalLights.push(dir.target);   // dispose時にtargetも掃除

        // フィル：彩度の高い青(0x8fbfff)はピンクを灰紫に濁らせるので、ごく淡い水色白に
        const fill = new THREE.PointLight(0xdceeff, 0.9, 20000, 0.7);
        fill.position.set(-2400, this.centerY - 400, -1800);
        this.scene.add(fill);
        this._minimalLights.push(fill);

        // ノートで一瞬灯るドリームカラーのグロー
        this._glowLight = new THREE.PointLight(0xffc0f0, 0.0, 14000, 1.4);
        this._glowLight.position.set(0, this.centerY, 0);
        this.scene.add(this._glowLight);
        this._minimalLights.push(this._glowLight);
    }

    /**
     * ディレクショナルライトのシャドウ用オルソカメラを、部屋の内側にぴったり合わせる。
     *
     * 部屋の 8 隅をライトのビュー空間へ変換して min/max を取るので、
     * 外接球で見積もるより 15〜20% 詰まる＝同じ解像度でもテクセルが細かくなり、
     * 必要な bias が小さくなって影が接地点に貼り付く。
     * @param {THREE.DirectionalLight} dir
     */
    _fitShadowFrustum(dir) {
        const cy = this.centerY;
        const hx = this.roomHalfX, hy = this.roomHalfY, hz = this.roomHalfZ;

        // ライトのビュー行列を自前で組む（three が内部で作るものと同じ向き）
        const view = new THREE.Matrix4()
            .lookAt(dir.position, dir.target.position, THREE.Object3D.DEFAULT_UP)
            .setPosition(dir.position)
            .invert();

        const v = new THREE.Vector3();
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < 8; i++) {
            v.set(
                (i & 1) ? hx : -hx,
                cy + ((i & 2) ? hy : -hy),
                (i & 4) ? hz : -hz
            ).applyMatrix4(view);
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
        }

        // ビュー空間は -Z が前方。near/far は距離（正の値）なので符号を反転して入れ替える
        const pad = 60;   // 影の柔らかさ（PCF のにじみ）ぶんの余白
        const cam = dir.shadow.camera;
        cam.left = minX - pad;
        cam.right = maxX + pad;
        cam.bottom = minY - pad;
        cam.top = maxY + pad;
        cam.near = Math.max(1, -maxZ - pad);
        cam.far = -minZ + pad;
        cam.updateProjectionMatrix();
    }

    /** 天井の発光パネル（グリッドに沿うサイズ）＋下向きの照明 */
    _buildCeilingLight() {
        // 天井タイル(面2)のピッチに合わせて、整数タイル分の大きさにする
        const cf = this._faces && this._faces[2];
        let panelW, panelD;
        if (cf) {
            const tileW = cf.fw / cf.cols, tileD = cf.fh / cf.rows;
            const nW = Math.max(2, Math.round(cf.cols * 0.5));   // 横は半分くらいのタイル数
            const nD = Math.max(2, Math.round(cf.rows * 0.34));  // 奥は1/3くらい
            panelW = nW * tileW - this.roomPadGap;
            panelD = nD * tileD - this.roomPadGap;
        } else {
            panelW = this.roomHalfX * 0.85;
            panelD = this.roomHalfZ * 0.55;
        }
        const y = this.roomCeilY - 8;

        // 発光パネル（トーンマップ無効＝ブルームで白く光る）
        const geo = new THREE.PlaneGeometry(panelW, panelD);
        const mat = new THREE.MeshBasicMaterial({ color: 0xf4f9ff, toneMapped: false, fog: false });
        const panel = new THREE.Mesh(geo, mat);
        panel.rotation.x = Math.PI / 2;   // 下向き
        panel.position.set(0, y, 0);
        panel.renderOrder = 1;
        this.scene.add(panel);
        this._ceilingPanel = panel;
        this._ceilingPanelMat = mat;
        this._ceilingPanelGeo = geo;

        // パネルから下へ照らす暖白色ライト（部屋の主光源）
        const light = new THREE.PointLight(0xf4f8ff, 2.0, this.roomHalfY * 6, 1.1);
        light.position.set(0, y - 120, 0);
        this.scene.add(light);
        this._ceilingLight = light;
        this._minimalLights.push(light);
    }

    createAmbientFloatingParticles() {
        // particleCount<=0 だと内部の InstancedMeshManager が count>0 を要求して落ちるので生成しない
        if (!this.ambientParticleCount || this.ambientParticleCount <= 0) return;
        this.atmosphere = new StudioAtmosphere(this.scene, {
            roomHalfW: 5000,
            roomHalfD: 5000,
            floorTopY: STUDIO_FLOOR_TOP_Y,
            ceilingY: 5500,
            particleCount: this.ambientParticleCount,
            airNoiseVolumeScale: 15.0
        });
    }

    /** キューブ用の「古い汚れ」テクスチャ（map=汚れの陰り, bumpMap=表面の凹凸）を生成 */
    _generatePadTextures(size = 512) {
        // --- map: ほぼ白ベースにクールグレーの汚れ（instanceColorに掛かって古びる）---
        const cC = document.createElement('canvas');
        cC.width = cC.height = size;
        const c = cC.getContext('2d');
        c.fillStyle = '#f0f0f2';
        c.fillRect(0, 0, size, size);
        // 汚れブロブ（クールグレー）
        for (let i = 0; i < 46; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const rr = 20 + Math.random() * 80;
            const g = c.createRadialGradient(x, y, 0, x, y, rr);
            const a = 0.06 + Math.random() * 0.12;
            const col = Math.random() < 0.5 ? '96,96,110' : '120,116,128';
            g.addColorStop(0, `rgba(${col},${a})`);
            g.addColorStop(1, `rgba(${col},0)`);
            c.fillStyle = g;
            c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
        }
        // 擦り傷
        for (let i = 0; i < 120; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const len = 8 + Math.random() * 50, ang = Math.random() * Math.PI;
            c.strokeStyle = `rgba(70,68,78,${0.05 + Math.random() * 0.1})`;
            c.lineWidth = 0.5 + Math.random() * 1.4;
            c.beginPath(); c.moveTo(x, y);
            c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); c.stroke();
        }
        // 微ノイズ
        {
            const img = c.getImageData(0, 0, size, size), d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                const nz = (Math.random() - 0.5) * 12;
                d[i] += nz; d[i + 1] += nz; d[i + 2] += nz;
            }
            c.putImageData(img, 0, 0);
        }

        // --- bump: 中間グレー＋汚れ位置の凹み＋ノイズ ---
        const bC = document.createElement('canvas');
        bC.width = bC.height = size;
        const b = bC.getContext('2d');
        b.fillStyle = '#8a8a8a';
        b.fillRect(0, 0, size, size);
        for (let i = 0; i < 90; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const rr = 6 + Math.random() * 26;
            const g = b.createRadialGradient(x, y, 0, x, y, rr);
            const up = Math.random() > 0.5, val = up ? 200 : 60;
            g.addColorStop(0, `rgba(${val},${val},${val},0.5)`);
            g.addColorStop(1, 'rgba(138,138,138,0)');
            b.fillStyle = g;
            b.beginPath(); b.arc(x, y, rr, 0, Math.PI * 2); b.fill();
        }
        {
            const img = b.getImageData(0, 0, size, size), d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                const nz = (Math.random() - 0.5) * 26;
                d[i] += nz; d[i + 1] += nz; d[i + 2] += nz;
            }
            b.putImageData(img, 0, 0);
        }

        const map = new THREE.CanvasTexture(cC);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;   // per-instance UVオフセットで柄をランダム化
        const bumpMap = new THREE.CanvasTexture(bC);
        bumpMap.anisotropy = 4;
        bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
        return { map, bumpMap };
    }

    /** 古い室内プレイグラウンド風：各面を本物のラウンドキューブ（パッド）で敷き詰める */
    _buildRoom() {
        const w = this.roomHalfX * 2;
        const h = this.roomHalfY * 2;
        const d = this.roomHalfZ * 2;
        const hx = this.roomHalfX, hy = this.roomHalfY, hz = this.roomHalfZ;
        const cy = this.centerY;

        const bd = this.roomPadDepth;

        // --- 6面のパッド配置を計算 ---
        // face: { fc(中心), n(内向き法線), u,v(面内の2軸), fw,fh(面の寸法), color }
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        // n=内向き法線, u=面内の横軸。v は必ず n×u で作って「右手系」を保証する
        // （左手系だと鏡像になって法線が反転→内外反転・ギザギザ・床が裏返って見える）
        const faces = [
            { fc: V(hx, cy, 0),  n: V(-1, 0, 0), u: V(0, 0, 1), fw: d, fh: h, color: this.wallColors.right },
            { fc: V(-hx, cy, 0), n: V(1, 0, 0),  u: V(0, 0, 1), fw: d, fh: h, color: this.wallColors.left },
            { fc: V(0, cy + hy, 0), n: V(0, -1, 0), u: V(1, 0, 0), fw: w, fh: d, color: this.wallColors.ceil },
            { fc: V(0, cy - hy, 0), n: V(0, 1, 0),  u: V(1, 0, 0), fw: w, fh: d, color: this.wallColors.floor },
            { fc: V(0, cy, hz),  n: V(0, 0, -1), u: V(1, 0, 0), fw: w, fh: h, color: this.wallColors.front },
            { fc: V(0, cy, -hz), n: V(0, 0, 1),  u: V(1, 0, 0), fw: w, fh: h, color: this.wallColors.back }
        ];
        for (const f of faces) f.v = f.n.clone().cross(f.u);   // v = n × u で右手系に

        const face = this.roomPadFace;
        const gap = this.roomPadGap;
        const depth = this.roomPadDepth;

        // 正方形タイルで割る（正面から見ると正方形）
        const layout = faces.map(f => {
            const cols = Math.max(1, Math.round(f.fw / face));
            const rows = Math.max(1, Math.round(f.fh / face));
            return { f, cols, rows };
        });

        // --- 窓のタイル範囲と実座標を計算（後ろ壁 fi=5 のみ対応: u=+X, v=+Y）---
        this._windowRect = null;
        if (this.useSkyWindow) {
            const wl = layout[this.windowFaceIndex];
            const tileW = wl.f.fw / wl.cols;
            const tileH = wl.f.fh / wl.rows;
            const c0 = Math.round((wl.cols - this.windowTilesW) / 2);
            const r0 = Math.max(0, Math.round((wl.rows - this.windowTilesH) / 2) + this.windowRowOffset);
            const c1 = Math.min(wl.cols, c0 + this.windowTilesW);
            const r1 = Math.min(wl.rows, r0 + this.windowTilesH);
            // 世界座標での窓の開口（後ろ壁: u→x, v→y）
            this._windowRect = {
                c0, c1, r0, r1,
                x0: -wl.f.fw / 2 + tileW * c0,
                x1: -wl.f.fw / 2 + tileW * c1,
                y0: cy - wl.f.fh / 2 + tileH * r0,
                y1: cy - wl.f.fh / 2 + tileH * r1
            };
        }

        // --- 下地の箱（キューブの奥端の背後・トンネルの底になるダークな箱）---
        // キューブは壁面から奥(壁の外側)へ depth 伸びるので、下地箱も depth ぶん外へ広げて背後に置く
        const baseGeo = new THREE.BoxGeometry(w + 2 * bd, h + 2 * bd, d + 2 * bd);
        const baseMat = new THREE.MeshStandardMaterial({
            color: 0xb0a4ac,   // 目地/奥は中間トーン（黒味＝目が照明を推定する基準を少し残す）
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.BackSide,
            fog: true
        });
        // 窓がある場合：後ろ面（BoxGeometryのマテリアル順 [+X,-X,+Y,-Y,+Z,-Z] の index5 = -Z）を
        // 非表示にして、穴あき Shape の壁を別途貼る（→ _buildSkyWindow）
        let baseMatOrArr = baseMat;
        if (this._windowRect) {
            this._roomBaseHiddenMat = new THREE.MeshBasicMaterial({ visible: false });
            baseMatOrArr = [baseMat, baseMat, baseMat, baseMat, baseMat, this._roomBaseHiddenMat];
        }
        const baseMesh = new THREE.Mesh(baseGeo, baseMatOrArr);
        baseMesh.position.set(0, cy, 0);
        baseMesh.frustumCulled = false;
        baseMesh.receiveShadow = false;   // BackSide下地の影アクネを避ける（隙間の溝用なので影不要）
        this.scene.add(baseMesh);
        this._roomBaseMesh = baseMesh;
        this._roomBaseMat = baseMat;

        // 窓のあるタイル分を除いた総数
        const skipped = this._windowRect
            ? (this._windowRect.c1 - this._windowRect.c0) * (this._windowRect.r1 - this._windowRect.r0)
            : 0;
        const total = layout.reduce((s, l) => s + l.cols * l.rows, 0) - skipped;

        // --- パッド InstancedMesh（本物のラウンドキューブ）---
        // 風呂場タイル：盛り上がりを薄く（Rを小さく）してほぼフラット
        const padGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.035);
        const needTex = this.usePadTexture || this.usePadBump;
        const padTex = needTex ? this._generatePadTextures(1024) : null;
        this._padTex = padTex;
        if (padTex?.bumpMap) padTex.bumpMap.repeat.set(2.5, 2.5);   // 面あたり細かくタイル＝表面感
        const padMat = new THREE.MeshStandardMaterial({
            map: (padTex && this.usePadTexture) ? padTex.map : null,        // 色マップ（OFF＝濁らせない）
            bumpMap: (padTex && this.usePadBump) ? padTex.bumpMap : null,   // 凹凸（ON・深め）
            bumpScale: 14.0,   // 壁タイルの凹凸を深く（7.0→14.0）
            roughness: 0.72,     // 少し下げて柔らかいスペキュラを出す
            metalness: 0.0,
            envMap: this.scene?.environment || null,
            envMapIntensity: 0.35,   // 環境の映り込みで軽いsheen
            fog: true
        });
        // per-instance: aUvOff=テクスチャUVをずらして柄をランダム化 / aGlow=pop時の先端ネオン発光
        padMat.onBeforeCompile = (shader) => {
            shader.uniforms.uGlowBoost = { value: this.padGlowBoost };
            padMat.userData.shader = shader;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>',
                    '#include <common>\nattribute vec2 aUvOff;\nattribute float aGlow;\nattribute vec3 aGlowColor;\nvarying float vGlow;\nvarying vec3 vGlowCol;')
                .replace('#include <uv_vertex>',
                    '#include <uv_vertex>\n' +
                    '#ifdef USE_MAP\n vMapUv += aUvOff;\n#endif\n' +
                    '#ifdef USE_BUMPMAP\n vBumpMapUv += aUvOff;\n#endif\n' +
                    'vGlow = aGlow;\n vGlowCol = aGlowColor;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>',
                    '#include <common>\nuniform float uGlowBoost;\nvarying float vGlow;\nvarying vec3 vGlowCol;')
                .replace('#include <emissivemap_fragment>',
                    '#include <emissivemap_fragment>\n' +
                    'totalEmissiveRadiance += vGlow * uGlowBoost * vGlowCol;');
        };
        const mesh = new THREE.InstancedMesh(padGeo, padMat, total);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = this.enableShadows;   // 風船の影がキューブに落ちる

        const scl = new THREE.Vector3();
        const col = new THREE.Color();
        const pads = new Array(total);
        // per-instance 属性
        const uvOff = new Float32Array(total * 2);
        const glowArr = new Float32Array(total);   // 0 で初期化（pop時に上げる）
        const glowColArr = new Float32Array(total * 3).fill(1);   // 発光色（初期白）
        // 面ごとの (row,col)→パッド索引（衝突時のセル引き用）
        const grids = layout.map(l => new Int32Array(l.cols * l.rows).fill(-1));
        let i = 0;
        for (let fi = 0; fi < layout.length; fi++) {
            const { f, cols, rows } = layout[fi];
            const tileW = f.fw / cols;
            const tileH = f.fh / rows;
            const padW = tileW - gap;
            const padH = tileH - gap;
            for (let r = 0; r < rows; r++) {
                for (let cc = 0; cc < cols; cc++) {
                    // 窓の開口部はタイルを敷かない（grids は -1 のまま＝キック対象外）
                    if (this._isWindowTile(fi, cc, r)) continue;
                    const ou = -f.fw / 2 + tileW * (cc + 0.5);
                    const ov = -f.fh / 2 + tileH * (r + 0.5);
                    // 正面(+n面)を壁面(fc)に合わせ、本体は -n 方向（奥＝壁の外側）へ depth 伸ばす
                    // → 中心 = 面中心 + u*ou + v*ov - n*(depth/2)
                    const pos = f.fc.clone()
                        .addScaledVector(f.u, ou)
                        .addScaledVector(f.v, ov)
                        .addScaledVector(f.n, -depth * 0.5);
                    scl.set(padW, padH, depth);
                    // 回転+スケールのみ（平行移動はポップに応じて毎フレーム差し込む）
                    const rot = new THREE.Matrix4().makeBasis(f.u, f.v, f.n).scale(scl);
                    const m = rot.clone().setPosition(pos);
                    mesh.setMatrixAt(i, m);
                    // 床面だけ一色、それ以外はノイズで偏りのあるパッチ状の色（glowもこの色で光る）
                    if (fi === this._floorFaceIndex) col.set(this.floorTileColor);
                    else this._cubeNoiseColor(pos, col);
                    mesh.setColorAt(i, col);
                    // テクスチャの柄をランダムにずらす
                    uvOff[i * 2] = Math.random();
                    uvOff[i * 2 + 1] = Math.random();

                    pads[i] = { pos, n: f.n.clone(), m: rot, face: fi, col: cc, row: r, cols, rows };
                    grids[fi][r * cols + cc] = i;
                    i++;
                }
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // per-instance 属性をジオメトリへ
        padGeo.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(uvOff, 2));
        const glowAttr = new THREE.InstancedBufferAttribute(glowArr, 1);
        glowAttr.setUsage(THREE.DynamicDrawUsage);
        padGeo.setAttribute('aGlow', glowAttr);
        this._padGlowAttr = glowAttr;
        const glowColAttr = new THREE.InstancedBufferAttribute(glowColArr, 3);
        glowColAttr.setUsage(THREE.DynamicDrawUsage);
        padGeo.setAttribute('aGlowColor', glowColAttr);
        this._padGlowColorAttr = glowColAttr;

        this.scene.add(mesh);
        this._padMesh = mesh;
        this._padGeo = padGeo;
        this._padMat = padMat;

        // 衝突判定用に面情報を保持（fc,n,u,v,fw,fh,cols,rows,grid）
        this._faces = layout.map((l, idx) => ({
            fc: l.f.fc, n: l.f.n, u: l.f.u, v: l.f.v,
            fw: l.f.fw, fh: l.f.fh, cols: l.cols, rows: l.rows, grid: grids[idx]
        }));

        this._pads = pads;
        this._padPop = new Float32Array(total);
        this._padTarget = new Float32Array(total);
        this._padHold = new Float32Array(total);
        this._padActive = false;

        this._buildSkyWindow();
    }

    /** 指定タイルが窓の開口部か（後ろ壁 fi=5 のみ） */
    _isWindowTile(fi, cc, r) {
        const R = this._windowRect;
        return !!R && fi === this.windowFaceIndex && cc >= R.c0 && cc < R.c1 && r >= R.r0 && r < R.r1;
    }

    /** 窓：穴あき下地壁＋白い縁取りフレーム＋トンネル内張り（後ろ壁 -Z 専用） */
    _buildSkyWindow() {
        const R = this._windowRect;
        if (!R) return;
        const hz = this.roomHalfZ;
        const bd = this.roomPadDepth;
        const cy = this.centerY;
        const t = this.windowFrameThickness;
        const group = new THREE.Group();

        // --- 穴あきの下地壁（下地箱で非表示にした -Z 面の代わり。窓の分だけ穴）---
        const BW = this.roomHalfX + bd;
        const BH = this.roomHalfY + bd;
        const shape = new THREE.Shape();
        shape.moveTo(-BW, -BH); shape.lineTo(BW, -BH);
        shape.lineTo(BW, BH); shape.lineTo(-BW, BH); shape.closePath();
        const hole = new THREE.Path();
        hole.moveTo(R.x0, R.y0 - cy); hole.lineTo(R.x1, R.y0 - cy);
        hole.lineTo(R.x1, R.y1 - cy); hole.lineTo(R.x0, R.y1 - cy); hole.closePath();
        shape.holes.push(hole);
        const wallGeo = new THREE.ShapeGeometry(shape);
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0xb0a4ac,   // 下地箱と同トーン
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.FrontSide,   // 内向き（+Z 側から見る）
            fog: true
        });
        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.position.set(0, cy, -(hz + bd));
        group.add(wallMesh);

        // --- 白い縁取り（トンネル内張り＋部屋側のリップ）---
        // 色マップ（汚れ画像）は解像度が足りず「ちゃち」に見えるので使わない。
        // 代わりに **ノーマルマップ＋ラフネスマップ** で凹凸と艶ムラだけを与えて汚す
        // （＝色は純白のまま、光の当たり方だけが荒れる。塗装の劣化・古びた樹脂の質感）
        this._windowTex = this._generateGrungeNormalMaps(1024);
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            normalMap: this._windowTex.normalMap,
            normalScale: new THREE.Vector2(1.35, 1.35),
            roughnessMap: this._windowTex.roughnessMap,   // 艶のムラ＝汚れ・くすみに見える
            roughness: 1.0,     // roughnessMap と乗算されるので 1.0 で全域を活かす
            metalness: 0.0,
            emissive: 0xffffff,
            emissiveIntensity: 0.10,   // 白く見せる補助。強いと凹凸が飛ぶので控えめ
            fog: true
        });
        const cxw = (R.x0 + R.x1) / 2, cyw = (R.y0 + R.y1) / 2;
        const winW = R.x1 - R.x0, winH = R.y1 - R.y0;
        const addBox = (bw, bh, bdep, x, y, z) => {
            const geo = new THREE.BoxGeometry(bw, bh, bdep);
            // 汚しテクスチャは実寸に対して等倍でタイルさせる（枠の長短でムラの粗さが変わらない）
            const uv = geo.attributes.uv;
            const scaleU = Math.max(bw, bdep) / 700, scaleV = Math.max(bh, bdep) / 700;
            for (let i = 0; i < uv.count; i++) {
                uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
            }
            uv.needsUpdate = true;
            const mesh = new THREE.Mesh(geo, frameMat);
            mesh.position.set(x, y, z);
            group.add(mesh);
        };
        this._windowFrameMat = frameMat;   // ワイヤーフレーム切替で参照する
        // トンネル内張り（開口の内側に沿って奥の空まで白い筒）
        const L = bd + 4;
        const zc = -hz - bd / 2;
        addBox(winW, t, L, cxw, R.y1 - t / 2, zc);   // 上
        addBox(winW, t, L, cxw, R.y0 + t / 2, zc);   // 下
        addBox(t, winH, L, R.x0 + t / 2, cyw, zc);   // 左
        addBox(t, winH, L, R.x1 - t / 2, cyw, zc);   // 右
        // 部屋側の縁取りリップ（開口より一回り大きい白枠がタイル面から少し出っ張る）
        const lip = 44;
        addBox(winW + 2 * t, t, lip, cxw, R.y1 + t / 2, -hz + lip / 2);
        addBox(winW + 2 * t, t, lip, cxw, R.y0 - t / 2, -hz + lip / 2);
        addBox(t, winH + 2 * t, lip, R.x0 - t / 2, cyw, -hz + lip / 2);
        addBox(t, winH + 2 * t, lip, R.x1 + t / 2, cyw, -hz + lip / 2);

        this.scene.add(group);
        this._windowGroup = group;
    }

    /**
     * 「汚し」用のノーマルマップ＋ラフネスマップを生成する。
     * 色マップは一切作らない（＝アルベドは純白のまま）ので、色が濁らずに
     * 凹凸・艶ムラだけで経年劣化した質感を出せる。
     * @param {number} size テクスチャ解像度
     */
    _generateGrungeNormalMaps(size = 1024) {
        // --- ハイトマップをキャンバスに描く（後で微分してノーマルへ）---
        const hCanvas = document.createElement('canvas');
        hCanvas.width = hCanvas.height = size;
        const h = hCanvas.getContext('2d');
        h.fillStyle = '#808080';
        h.fillRect(0, 0, size, size);

        // 大きなうねり（塗装の波打ち・へこみ）
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const r = size * (0.05 + Math.random() * 0.16);
            const g = h.createRadialGradient(x, y, 0, x, y, r);
            const v = Math.random() > 0.5 ? 190 : 66;
            g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
            g.addColorStop(1, 'rgba(128,128,128,0)');
            h.fillStyle = g;
            h.beginPath(); h.arc(x, y, r, 0, Math.PI * 2); h.fill();
        }
        // 細かいブツブツ（塗装のザラつき・粉っぽさ）
        for (let i = 0; i < 2600; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const r = 1 + Math.random() * 4;
            const v = Math.random() > 0.5 ? 232 : 34;
            h.fillStyle = `rgba(${v},${v},${v},${0.10 + Math.random() * 0.22})`;
            h.beginPath(); h.arc(x, y, r, 0, Math.PI * 2); h.fill();
        }
        // 引っかき傷（細長い線。古びた樹脂・金属枠の擦れ）
        h.lineCap = 'round';
        for (let i = 0; i < 130; i++) {
            const x = Math.random() * size, y = Math.random() * size;
            const a = Math.random() * Math.PI * 2;
            const len = size * (0.02 + Math.random() * 0.20);
            const v = Math.random() > 0.5 ? 214 : 48;
            h.strokeStyle = `rgba(${v},${v},${v},${0.12 + Math.random() * 0.25})`;
            h.lineWidth = 0.7 + Math.random() * 2.2;
            h.beginPath();
            h.moveTo(x, y);
            h.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
            h.stroke();
        }
        // 垂れジミ（上から下へ流れた汚れの筋）
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * size;
            const y0 = Math.random() * size * 0.5;
            const len = size * (0.08 + Math.random() * 0.30);
            const w = 1.5 + Math.random() * 6;
            const g = h.createLinearGradient(0, y0, 0, y0 + len);
            g.addColorStop(0, 'rgba(96,96,96,0.30)');
            g.addColorStop(1, 'rgba(128,128,128,0)');
            h.fillStyle = g;
            h.fillRect(x, y0, w, len);
        }

        // --- ハイトを微分してノーマルマップへ（Sobel）---
        const hData = h.getImageData(0, 0, size, size).data;
        const nCanvas = document.createElement('canvas');
        nCanvas.width = nCanvas.height = size;
        const nCtx = nCanvas.getContext('2d');
        const nImg = nCtx.createImageData(size, size);
        const at = (x, y) => {
            const xi = (x + size) % size, yi = (y + size) % size;
            return hData[(yi * size + xi) * 4] / 255;
        };
        const strength = 5.5;   // 微分の効き（大きいほど凹凸が深い）
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
                const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
                // 法線 = normalize(-dx, -dy, 1) を 0..1 へエンコード
                const len = Math.hypot(dx, dy, 1) || 1;
                const o = (y * size + x) * 4;
                nImg.data[o]     = Math.round((-dx / len * 0.5 + 0.5) * 255);
                nImg.data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
                nImg.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
                nImg.data[o + 3] = 255;
            }
        }
        nCtx.putImageData(nImg, 0, 0);

        // --- ラフネスマップ＝ハイトを流用（凹んだ所がザラつく＝汚れが溜まって艶が消える）---
        const rCanvas = document.createElement('canvas');
        rCanvas.width = rCanvas.height = size;
        const rCtx = rCanvas.getContext('2d');
        rCtx.fillStyle = '#8a8a8a';   // ベースのラフネス（0.54 くらい）
        rCtx.fillRect(0, 0, size, size);
        rCtx.globalAlpha = 0.55;
        rCtx.drawImage(hCanvas, 0, 0);   // 凹凸のムラをそのまま艶ムラに
        rCtx.globalAlpha = 1.0;

        const normalMap = new THREE.CanvasTexture(nCanvas);
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        const roughnessMap = new THREE.CanvasTexture(rCanvas);
        roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
        // ノーマル/ラフネスは「データ」なので sRGB 変換をかけてはいけない
        normalMap.colorSpace = THREE.NoColorSpace;
        roughnessMap.colorSpace = THREE.NoColorSpace;
        return { normalMap, roughnessMap };
    }

    /**
     * 床に置かれた静的な大キューブを作る。
     * 物理更新の対象外なので行列は初期化時に一度だけ書けばよい（毎フレームのコストはゼロ）。
     * 回転は Y 軸のみ＋わずかな傾きにして、衝突判定を「Y回転だけのOBB」で安く済ませる。
     */
    _buildStaticCubes() {
        const n = this.staticCubeCount;
        if (!n || n <= 0) return;

        const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.045);
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            bumpMap: this._pastelTex?.bumpMap || null,
            bumpScale: 3.0,
            metalness: 0.0,
            roughness: 0.35,     // パーティクルより少しツヤっと（置物らしい存在感）
            fog: true
        });
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        mesh.castShadow = this.enableShadows;
        mesh.receiveShadow = this.enableShadows;
        mesh.frustumCulled = false;

        const col = new THREE.Color();
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const s = new THREE.Vector3();
        const pos = new THREE.Vector3();

        for (let i = 0; i < n; i++) {
            // 立方体ではなく少し縦横比を散らす（積み木っぽく）
            const base = this.staticCubeMin + Math.random() * (this.staticCubeMax - this.staticCubeMin);
            const sx = base * (0.8 + Math.random() * 0.4);
            const sy = base * (0.7 + Math.random() * 0.5);
            const sz = base * (0.8 + Math.random() * 0.4);

            // 床に接地させつつ、重ならない位置を探す（見つからなければ最後の候補で妥協）
            const mX = this.roomHalfX - sx * 0.5 - 260;
            const mZ = this.roomHalfZ - sz * 0.5 - 260;
            for (let tries = 0; tries < 40; tries++) {
                pos.set(
                    (Math.random() * 2 - 1) * mX,
                    this.roomFloorY + sy * 0.5,
                    (Math.random() * 2 - 1) * mZ
                );
                let ok = true;
                for (const c of this._staticCubes) {
                    // XZ 平面で余裕を持って離す（回転を考えて半径ベースでざっくり判定）
                    const rA = Math.max(sx, sz) * 0.75;
                    const rB = Math.max(c.half.x, c.half.z) * 1.5;
                    if (Math.hypot(pos.x - c.pos.x, pos.z - c.pos.z) < rA + rB) { ok = false; break; }
                }
                if (ok) break;
            }

            const rotY = Math.random() * Math.PI * 2;
            e.set(
                (Math.random() - 0.5) * this.staticCubeTilt,
                rotY,
                (Math.random() - 0.5) * this.staticCubeTilt
            );
            q.setFromEuler(e);
            s.set(sx, sy, sz);
            m.compose(pos, q, s);
            mesh.setMatrixAt(i, m);

            this._randomPastelColor(col);
            mesh.setColorAt(i, col);

            this._staticCubes.push({
                pos: pos.clone(),
                half: new THREE.Vector3(sx * 0.5, sy * 0.5, sz * 0.5),
                rotY,
                cos: Math.cos(rotY),
                sin: Math.sin(rotY)
            });
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.scene.add(mesh);
        this._staticCubeMesh = mesh;
        this._staticCubeGeo = geo;
        this._staticCubeMat = mat;
    }

    /**
     * 球パーティクル1個と静的キューブ群の衝突を解消する。
     * キューブの Y 回転だけをローカル座標へ持ち込んで AABB として扱う（軸並行にできるので安い）。
     * @param {object} p パーティクル
     */
    _resolveStaticCubeCollisions(p) {
        const cubes = this._staticCubes;
        if (!cubes.length) return;
        const r = p.radius;
        const L = this._scTmpV;

        for (let i = 0; i < cubes.length; i++) {
            const c = cubes[i];
            // ざっくり除外（外接球で早期リターン）
            const dx0 = p.position.x - c.pos.x;
            const dy0 = p.position.y - c.pos.y;
            const dz0 = p.position.z - c.pos.z;
            const reach = c.half.length() + r;
            if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > reach * reach) continue;

            // ワールド → キューブのローカル（-rotY で回す）
            const lx = dx0 * c.cos - dz0 * c.sin;
            const lz = dx0 * c.sin + dz0 * c.cos;
            const ly = dy0;

            // ローカルAABB上の最近点までのはみ出し量
            const ex = Math.abs(lx) - c.half.x;
            const ey = Math.abs(ly) - c.half.y;
            const ez = Math.abs(lz) - c.half.z;

            if (ex > r || ey > r || ez > r) continue;   // どの軸かで完全に離れている

            let nlx = 0, nly = 0, nlz = 0, pen = 0;
            if (ex > 0 || ey > 0 || ez > 0) {
                // 面の外側（角・辺を含む）：最近点からの実距離で判定
                const qx = Math.max(ex, 0), qy = Math.max(ey, 0), qz = Math.max(ez, 0);
                const dist = Math.hypot(qx, qy, qz);
                if (dist > r || dist < 1e-6) continue;
                pen = r - dist;
                nlx = (qx / dist) * Math.sign(lx);
                nly = (qy / dist) * Math.sign(ly);
                nlz = (qz / dist) * Math.sign(lz);
            } else {
                // 中心が箱の内側：一番浅い面へ押し出す
                const px = -ex, py = -ey, pz = -ez;   // 各面までの深さ
                if (px <= py && px <= pz) { pen = px + r; nlx = Math.sign(lx) || 1; }
                else if (py <= pz)        { pen = py + r; nly = Math.sign(ly) || 1; }
                else                      { pen = pz + r; nlz = Math.sign(lz) || 1; }
            }

            // 法線をワールドへ戻す（+rotY で回す）
            const nx = nlx * c.cos + nlz * c.sin;
            const nz = -nlx * c.sin + nlz * c.cos;
            const ny = nly;
            L.set(nx, ny, nz);
            const len = L.length() || 1;
            L.multiplyScalar(1 / len);

            // 押し出し＋反発
            p.position.addScaledVector(L, pen);
            const vn = p.velocity.dot(L);
            if (vn < 0) {
                if (L.y > 0.5) {
                    // 上面（ほぼ水平）に落ちた場合は床と同じ扱い＝
                    // 真上へ跳ね返し続けないよう散らしつつ、弱い衝突は強めに減衰させる
                    let up = -vn * this.floorRestitution;
                    if (up < this.bounceStopSpeed) up *= 0.35;
                    const spread = this.bounceSpread * (0.4 + Math.random() * 0.6);
                    const ang = Math.random() * Math.PI * 2;
                    const lateral = up * spread;
                    p.velocity.addScaledVector(L, -vn + up * (1 - spread * 0.5));
                    p.velocity.x += Math.cos(ang) * lateral;
                    p.velocity.z += Math.sin(ang) * lateral;
                    p.velocity.x *= this.floorFriction;
                    p.velocity.z *= this.floorFriction;
                } else {
                    // 側面：向きを少しだけ散らして、面に対して鏡のように揃わないようにする
                    p.velocity.addScaledVector(L, -vn * (1 + this.wallRestitution));
                    const j = this.bounceSpread * 0.5 * Math.abs(vn);
                    p.velocity.x += (Math.random() - 0.5) * j;
                    p.velocity.y += (Math.random() - 0.5) * j;
                    p.velocity.z += (Math.random() - 0.5) * j;
                }
            }
        }
    }

    /** スカイドーム：トーンマップ済みJPG（ただの画像）を内向き球に貼る。ライト計算・HDRなし＝軽量 */
    async _buildSkyDome() {
        if (!this.useSkyWindow) return;
        try {
            let tex = await new THREE.TextureLoader().loadAsync(this.skyImagePath);
            // 地面・街が写ってる画像は、上半分（空）を下半分へ鏡像コピーして「空だけ」にする
            if (this.skyMirrorHorizon && tex.image) {
                const img = tex.image;
                const cv = document.createElement('canvas');
                cv.width = img.width;
                cv.height = img.height;
                const ctx = cv.getContext('2d');
                const half = img.height / 2;
                ctx.drawImage(img, 0, 0);
                ctx.save();
                ctx.translate(0, img.height);
                ctx.scale(1, -1);   // 下半分＝上半分の垂直ミラー
                ctx.drawImage(img, 0, 0, img.width, half, 0, 0, img.width, half);
                ctx.restore();
                tex.dispose();
                tex = new THREE.CanvasTexture(cv);
            }
            tex.colorSpace = THREE.SRGBColorSpace;   // トーンマップ済みJPGはsRGB
            const geo = new THREE.SphereGeometry(this.skyDomeRadius, 32, 16);   // 窓越しにしか見えないので粗くてOK
            geo.scale(-1, 1, 1);   // 球の内側から正しい向きで見えるよう反転
            const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false });   // unlit＝ライト処理なし
            mat.color.setScalar(this.skyBrightness);
            const dome = new THREE.Mesh(geo, mat);
            // 後方（-Z＝窓の向こう）へ離すことで、窓から見える空の「ズーム感」を抑える
            dome.position.set(0, this.centerY, -(this.skyPushBack ?? 0));
            // Y=太陽の方位を窓へ / X=ドームごと傾けて太陽の高さを窓に合わせる
            dome.rotation.set(this.skyTiltX ?? 0, this.skyRotationY, 0);
            dome.renderOrder = 2;      // 部屋の後に描画＝壁に隠れる画素を深度で棄却してオーバードロー削減
            dome.frustumCulled = false;
            this.scene.add(dome);
            this._skyDome = dome;
            this._skyTexture = tex;
        } catch (e) {
            console.warn('Scene14: スカイドーム画像の読み込みに失敗:', this.skyImagePath, e);
        }
    }

    // ===== パッドのポップ（track7〜12）=====

    /** 1枚のパッドをキック（amp=飛び出し量, hold=保持秒, col=発光色） */
    _kickPad(i, amp, hold, col) {
        if (i < 0 || i >= this._padPop.length) return;
        this._padTarget[i] = Math.max(this._padTarget[i], amp);
        this._padHold[i] = Math.max(this._padHold[i], hold);
        if (col && this._padGlowColorAttr) {
            const ga = this._padGlowColorAttr.array;
            ga[i * 3] = col.r; ga[i * 3 + 1] = col.g; ga[i * 3 + 2] = col.b;
            this._padGlowColorAttr.needsUpdate = true;
        }
        this._padActive = true;
    }

    /** ヒートマップ色（0=青→シアン→緑→黄→1=赤） */
    _heatColor(t, out) {
        t = Math.max(0, Math.min(1, t));
        const stops = [[0, 0, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 0, 0]];
        const seg = t * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(seg));
        const f = seg - i;
        const a = stops[i], b = stops[i + 1];
        out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
        return out;
    }

    /** centerを中心に count 枚、同一面で近傍に広げてキック（col=発光色） */
    _kickCluster(center, count, amp, hold, col) {
        const p = this._pads[center];
        const F = this._faces[p.face];
        const cols = F.cols, rows = F.rows, grid = F.grid;
        this._kickPad(center, amp, hold, col);
        let placed = 1, ring = 1, guard = 0;
        while (placed < count && ring < 20 && guard < count * 20) {
            for (let a = 0; a < count && placed < count; a++) {
                guard++;
                const cc = THREE.MathUtils.clamp(p.col + Math.round((Math.random() * 2 - 1) * ring), 0, cols - 1);
                const rr = THREE.MathUtils.clamp(p.row + Math.round((Math.random() * 2 - 1) * ring), 0, rows - 1);
                const idx2 = grid[rr * cols + cc];
                if (idx2 >= 0) { this._kickPad(idx2, amp * (0.6 + Math.random() * 0.4), hold, col); placed++; }
            }
            ring++;
        }
    }

    /** 毎フレーム：エンベロープ更新＆InstancedMeshの平行移動だけ差し替え */
    _updatePads(dtRaw) {
        if (!this._padActive || !this._pads) return;
        const mesh = this._padMesh;
        const m = this._padTmpM;
        const v = this._padTmpV;
        // ニョキッと生える／引っ込む速さもシーン全体のスローモーション倍率に従わせる
        const dt = dtRaw * this.motionScale;
        const attack = Math.min(1, 16 * dt);
        const decay = Math.exp(-4.5 * dt);
        const glowArr = this._padGlowAttr ? this._padGlowAttr.array : null;
        const glowRef = this.padGlowRef;
        let anyAlive = false;
        for (let i = 0; i < this._pads.length; i++) {
            let pop = this._padPop[i];
            let hold = this._padHold[i];
            if (hold > 0) {
                hold -= dt;
                if (hold < 0) hold = 0;
                this._padHold[i] = hold;
                pop += (this._padTarget[i] - pop) * attack;
            } else {
                pop *= decay;
                if (pop < 0.5) pop = 0;
                if (pop === 0) this._padTarget[i] = 0;
            }
            this._padPop[i] = pop;
            if (pop > 0 || hold > 0) anyAlive = true;

            const p = this._pads[i];
            v.copy(p.pos).addScaledVector(p.n, pop);
            m.copy(p.m).setPosition(v);
            mesh.setMatrixAt(i, m);

            // 先端のネオン発光（pop量に比例）
            if (glowArr) glowArr[i] = Math.min(1, pop / glowRef);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (this._padGlowAttr) this._padGlowAttr.needsUpdate = true;
        this._padActive = anyAlive;
    }

    /** 柔らかいパステル質感の map / bumpMap をキャンバスから生成 */
    _generatePastelTextures() {
        const size = 512;

        // color: 純白ベース＋ごく薄いムラ。map はインスタンスカラーに「乗算」されるため、
        // ここがグレー寄りだと全パーティクルの彩度・明度が一律に下がる（＝くすみの主因）。
        const cCanvas = document.createElement('canvas');
        cCanvas.width = cCanvas.height = size;
        const c = cCanvas.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, size, size);
        for (let i = 0; i < 90; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 20 + Math.random() * 90;
            const grad = c.createRadialGradient(x, y, 0, x, y, r);
            const v = 242 + Math.floor(Math.random() * 13);
            grad.addColorStop(0, `rgba(${v},${v},${v},0.18)`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = grad;
            c.beginPath();
            c.arc(x, y, r, 0, Math.PI * 2);
            c.fill();
        }

        // bump: 中間グレー基調に、ハッキリした凹凸（コントラスト強め）
        const bCanvas = document.createElement('canvas');
        bCanvas.width = bCanvas.height = size;
        const b = bCanvas.getContext('2d');
        b.fillStyle = '#808080';
        b.fillRect(0, 0, size, size);
        // 粗めの大きな凹凸（やたら細かくならないよう大きめのブロブ・少なめ）
        for (let i = 0; i < 110; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 24 + Math.random() * 70;
            const grad = b.createRadialGradient(x, y, 0, x, y, r);
            const up = Math.random() > 0.5;
            const val = up ? 235 : 30;   // コントラスト強く
            grad.addColorStop(0, `rgba(${val},${val},${val},0.7)`);
            grad.addColorStop(1, 'rgba(128,128,128,0)');
            b.fillStyle = grad;
            b.beginPath();
            b.arc(x, y, r, 0, Math.PI * 2);
            b.fill();
        }

        const map = new THREE.CanvasTexture(cCanvas);
        map.colorSpace = THREE.SRGBColorSpace;   // Canvas由来はsRGB。未指定だとリニア解釈で色が濁る
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        const bumpMap = new THREE.CanvasTexture(bCanvas);
        bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
        return { map, bumpMap };
    }

    /** パーティクル色をランダムに返す（ビビッドピンク / ミントブルー / 白 ＋ 原色の黄・赤） */
    _randomPastelColor(out) {
        const r = Math.random();
        if (r < 0.15) {
            // 白（ほぼ純白・ごくうっすら水色）
            const h = 0.52;
            const s = 0.02 + Math.random() * 0.05;
            const l = 0.94 + Math.random() * 0.04;
            out.setHSL(h, s, l);
            return out;
        }
        if (r < 0.50) {
            // ピンク（主役）：マゼンタ寄り(青成分あり)の鮮ピンク。赤寄りだと小豆色になる
            const h = 0.87 + Math.random() * 0.04;   // 0.87〜0.91（フューシャ/マゼンタ）
            const s = 0.95 + Math.random() * 0.05;   // 彩度 almost全開
            const l = 0.62 + Math.random() * 0.08;
            out.setHSL(h, s, l);
            return out;
        }
        if (r < 0.72) {
            // ミントブルー（アクア/シアン帯。緑には振らない）
            const h = 0.47 + Math.random() * 0.05;   // 0.47〜0.52
            const s = 0.85 + Math.random() * 0.15;
            const l = 0.62 + Math.random() * 0.08;
            out.setHSL(h, s, l);
            return out;
        }
        if (r < 0.86) {
            // 原色イエロー（明度低いとマスタードになるので l 高め）
            const h = 0.15 + Math.random() * 0.02;
            const s = 1.0;
            const l = 0.56 + Math.random() * 0.05;
            out.setHSL(h, s, l);
            return out;
        }
        // 原色レッド
        const h = (0.99 + Math.random() * 0.02) % 1;   // 0.99〜0.01（真紅まわり）
        const s = 1.0;
        const l = 0.52 + Math.random() * 0.05;
        out.setHSL(h, s, l);
        return out;
    }

    // ===== キューブ色：ノイズで偏りのあるパッチ状ランダム =====

    _hash3(x, y, z) {
        const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
        return n - Math.floor(n);
    }

    /** トライリニア補間の値ノイズ（0〜1、空間的に滑らか＝隣は似た値） */
    _valueNoise(x, y, z) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        const xf = x - xi, yf = y - yi, zf = z - zi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
        const L = (a, b, t) => a + (b - a) * t;
        const c000 = this._hash3(xi, yi, zi), c100 = this._hash3(xi + 1, yi, zi);
        const c010 = this._hash3(xi, yi + 1, zi), c110 = this._hash3(xi + 1, yi + 1, zi);
        const c001 = this._hash3(xi, yi, zi + 1), c101 = this._hash3(xi + 1, yi, zi + 1);
        const c011 = this._hash3(xi, yi + 1, zi + 1), c111 = this._hash3(xi + 1, yi + 1, zi + 1);
        const x00 = L(c000, c100, u), x10 = L(c010, c110, u), x01 = L(c001, c101, u), x11 = L(c011, c111, u);
        return L(L(x00, x10, v), L(x01, x11, v), w);
    }

    /** キューブ1個の色：位置ノイズで色相を決める（＝色の塊/偏り）＋少し寒色も混ぜる */
    _cubeNoiseColor(pos, out) {
        const sc = this.cubeNoiseScale;
        let n = this._valueNoise(pos.x * sc, pos.y * sc, pos.z * sc);
        const n2 = this._valueNoise(pos.x * sc * 2.3 + 11, pos.y * sc * 2.3 + 7, pos.z * sc * 2.3 + 3);
        n = n * 0.65 + n2 * 0.35;   // fbm風（0〜1、滑らか）

        // プールモード：青空ブルーがベース / 白 / ピンクのタイル（緑ミントは使わない）
        if (this.poolMode) {
            let h, s, l;
            if (n < 0.30) {          // 白（ほぼ純白）はそのまま
                h = 0.55; s = 0.03 + n2 * 0.04; l = 0.90 + Math.random() * 0.04;
            } else if (n < 0.78) {   // 青空ブルー（ベース色）
                h = 0.565 + (n - 0.54) * 0.05; s = 0.60 + n2 * 0.2; l = 0.70 + Math.random() * 0.05;
            } else {                 // ピンク（アクセント）
                h = 0.89 + (n - 0.89) * 0.05; s = 0.6 + n2 * 0.2; l = 0.74 + Math.random() * 0.05;
            }
            out.setHSL((h + 1) % 1, s, l);
            return out;
        }

        const pal = this.cubeHuePalette;
        const idx = Math.min(pal.length - 1, Math.floor(n * pal.length));
        const baseH = pal[idx];
        const h = baseH + (Math.random() - 0.5) * 0.03;   // 微ジッター
        const s = 0.82 + Math.random() * 0.16;
        // 黄(0.10〜0.19)は明度を上げないと"黄"に見えない（低いとマスタード/オリーブ）
        const isYellow = baseH > 0.10 && baseH < 0.19;
        const l = isYellow ? (0.66 + Math.random() * 0.06) : (0.56 + Math.random() * 0.10);
        out.setHSL((h + 1) % 1, s, l);
        return out;
    }

    /** キューブ用：派手めドリームコアのランダム色（風船と同系パレット、少し柔らかめ） */
    _randomCubePastel(out) {
        const hues = [
            0.95, 0.92, 0.88, 0.98,  // hot pink / magenta / candy
            0.02, 0.07,              // coral / peach
            0.14,                    // lemon
            0.48, 0.55,              // aqua / sky
            0.62, 0.72               // periwinkle / lavender
        ];
        const h = hues[Math.floor(Math.random() * hues.length)] + (Math.random() - 0.5) * 0.03;
        const s = 0.62 + Math.random() * 0.24;   // パステルを保ちつつ発色アップ
        const l = 0.66 + Math.random() * 0.12;
        out.setHSL((h + 1) % 1, s, l);
        return out;
    }

    createParticles() {
        const n = this.sphereCount;
        this.particles = [];

        // 影パス＋本描画で2回引かれるので、球のポリゴンは軽めに（32x24→16x12）
        const geo = new THREE.SphereGeometry(1, 20, 14);
        const tex = this._generatePastelTextures();
        this._pastelTex = tex;
        tex.bumpMap.repeat.set(1, 1);   // 粗い凹凸（タイルせず大きめ）
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: tex.map,
            bumpMap: tex.bumpMap,
            bumpScale: 8.0,             // 粗めでハッキリ
            metalness: 0.0,             // 金属味を消して色を締める
            roughness: 0.8,
            emissive: 0x000000,       // emissiveで黒が浮くのをやめて色を締める
            emissiveIntensity: 0.0,
            vertexColors: true,
            fog: true
        });
        if (this.scene?.environment) {
            mat.envMap = this.scene.environment;
            mat.envMapIntensity = 0.1;   // 中立の映り込みで色が薄まるのを抑える
        }
        this._sphereMat = mat;

        // 頂点カラー白（インスタンスカラーが素直に乗るように）
        {
            const nv = geo.attributes.position.count;
            const white = new Float32Array(nv * 3);
            white.fill(1);
            geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
        }

        // --- 1st pass: パーティクル生成＆形状(球/キューブ)を決める ---
        let ns = 0, nc = 0;
        for (let i = 0; i < n; i++) {
            const isCube = Math.random() < this.cubeParticleRatio;
            // べき乗バイアス（小さめ多め・たまにデカ玉）で広い幅を自然に活かす
            const t = Math.pow(Math.random(), 1.35);
            const radius = isCube
                ? this.cubeParticleMin + t * (this.cubeParticleMax - this.cubeParticleMin)
                : this.sphereMinRadius + t * (this.sphereMaxRadius - this.sphereMinRadius);

            const x = THREE.MathUtils.lerp(-this.roomHalfX + radius, this.roomHalfX - radius, Math.random());
            const y = THREE.MathUtils.lerp(this.roomFloorY + radius, this.roomCeilY - radius, Math.random());
            const z = THREE.MathUtils.lerp(-this.roomHalfZ + radius, this.roomHalfZ - radius, Math.random());

            const p = new Scene14Particle(x, y, z, radius);
            this._randomPastelColor(p.baseColor);
            p.isCube = isCube;
            p.meshIndex = isCube ? nc++ : ns++;
            this.particles.push(p);
        }

        // --- 球メッシュ ---
        this.instancedMeshManager = new InstancedMeshManager(this.scene, geo, mat, Math.max(1, ns));
        const mainMesh = this.instancedMeshManager.getMainMesh();
        mainMesh.castShadow = this.enableShadows;
        mainMesh.receiveShadow = this.enableShadows;

        // --- 小ラウンドキューブメッシュ（球と見分くよう角をしっかり残す）---
        const cubeGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.08);
        // 球はマットなので、キューブはツヤっとしたセラミック/キャンディにして質感をハッキリ差別化
        const cubeMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            bumpMap: tex.bumpMap,   // うっすらバンプ（球と共有の粗テクスチャ）
            bumpScale: 2.5,
            metalness: 0.0,
            roughness: 0.22,
            fog: true
        });
        if (this.scene?.environment) {
            cubeMat.envMap = this.scene.environment;
            cubeMat.envMapIntensity = 0.4;   // 映り込みで白っぽく薄まるのを抑える
        }
        this._cubeParticleGeo = cubeGeo;
        this._cubeParticleMat = cubeMat;
        this._cubeParticleMesh = new THREE.InstancedMesh(cubeGeo, cubeMat, Math.max(1, nc));
        this._cubeParticleMesh.castShadow = this.enableShadows;
        this._cubeParticleMesh.receiveShadow = this.enableShadows;
        this._cubeParticleMesh.frustumCulled = false;
        this.scene.add(this._cubeParticleMesh);

        // --- 初期の色＆行列を各メッシュへ ---
        const m = this._pTmpM, q = this._pTmpQ, s = this._pTmpS;
        for (const p of this.particles) {
            if (p.isCube) {
                this._cubeParticleMesh.setColorAt(p.meshIndex, p.baseColor);
                q.setFromEuler(p.rotation); s.setScalar(p.radius);
                m.compose(p.position, q, s);
                this._cubeParticleMesh.setMatrixAt(p.meshIndex, m);
            } else {
                this.instancedMeshManager.setColorAt(p.meshIndex, p.baseColor);
                this.instancedMeshManager.setMatrixAt(p.meshIndex, p.position, p.rotation, p.radius);
            }
        }
        this.instancedMeshManager.markColorsNeedsUpdate();
        this.instancedMeshManager.markNeedsUpdate();
        this._cubeParticleMesh.instanceMatrix.needsUpdate = true;
        if (this._cubeParticleMesh.instanceColor) this._cubeParticleMesh.instanceColor.needsUpdate = true;
        this.setParticleCount(n);

        // phase 連動：最初は全部隠して、phase に応じて天井から降らせて増やす
        if (this.usePhaseBeatmap) {
            this._revealCount = 0;
            this._phaseApplied = -1;
            this._hideParticlesFrom(0);
        }
    }

    // ===== setup =====
    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.renderer.shadowMap.enabled = this.enableShadows;
        // PCFSoft は固定の広いカーネルで1画素あたりのサンプル数が多い。
        // このシーンは壁・床のパッドが画面を埋め尽くすので、影の受け側が全画面 ≒
        // 影のサンプリングコストがそのまま全画面に乗る。
        // 「なんとなくの形が出てればOK」方針なので PCF（3x3・radiusでボケ量を制御）にする
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity,
            sceneFogColor: this.sceneFogColor
        });
        // 露出を締めて白飛びを抑える（この関数が内部で ×1.96 して明るくしすぎるため上書き）。
        // 数値を下げるほど色が濃く沈む。ドリームコアの発色重視で 0.72 前後。
        // トーンマップOFF＝彩度を一切圧縮しない（全体の発色を最大化）
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.05;

        // 環境マップ：生成はするが scene.environment としては使わない。
        // （中立グレーのIBLが全マテリアルに乗って"全体の彩度が下がる"主因なので切る）
        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;
        this.scene.environment = null;   // ← 彩度を殺すIBLを無効化

        // パステルの箱部屋を背景兼コンテナに（solid背景は使わない）
        this.scene.background = null;
        this._buildRoom();
        await this._buildSkyDome();   // 窓の外の朝焼け/夕焼け（HDRI球）
        if (this.useSceneFog) {
            this.scene.fog = new THREE.FogExp2(this.sceneFogColor, this.sceneFogDensity);
        }

        // カメラ初期化
        this.camera.fov = this.cameraFov;
        this.camera.near = 12;
        // スカイドーム（後方に離した分＋半径）が収まる描画距離
        this.camera.far = Math.max(20000, (this.skyPushBack ?? 0) + this.skyDomeRadius + 4000);
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, this.centerY, this.orbitRadius);
        this.camera.lookAt(0, this.centerY, 0);
        this._centerSmoothed.copy(this._center);

        this.setupMinimalLights();
        this._buildCeilingLight();
        this.createAmbientFloatingParticles();
        this.createParticles();
        this._buildStaticCubes();   // createParticles の後（_pastelTex を流用するため）

        this.initPostProcessing();

        this.initialized = true;
    }

    /** 現在アクティブ（表示中）のパーティクル数 */
    _activeN() {
        return this.usePhaseBeatmap
            ? Math.min(this._revealCount, this.particles.length)
            : this.particles.length;
    }

    /** 現在の phase（1〜9）。/phase 未受信ならフォールバックで自動進行 */
    _currentPhaseSlot(dt) {
        if (this.phase > 0) {
            this._phaseSeen = true;
            // /phase が 0 基点で来ても 1 基点で来ても 1〜9 に収まるようにする
            const p = Math.floor(this.phase);
            return ((p - 1) % 9 + 9) % 9 + 1;
        }
        // OSC が来ていないときは一定間隔で回して動作確認できるようにする
        this._phaseFallbackT += dt;
        const step = Math.floor(this._phaseFallbackT / this.phaseFallbackSec);
        return (step % 9) + 1;
    }

    /**
     * 現在の phase に入ってからの進み具合（0〜1）。
     * `/actual_tick` があればそれを基準にし、無ければ経過時間でフォールバックする。
     */
    _phaseProgress() {
        if (this.actualTick > 0) {
            const d = this.actualTick - this._phaseStartTick;
            // ループが頭に戻って tick が巻き戻ったら進捗もリセット扱いにする
            if (d < 0) return 0;
            return Math.min(1, d / Math.max(1, this.ticksPerPhase));
        }
        return Math.min(1, (this.time - this._phaseStartTime) / Math.max(0.1, this.phaseFallbackSec));
    }

    /**
     * /phase（ビートマップの9スロット）に応じて「粒の量」と「エフェクトの強さ」を切り替える。
     * 4 と 6 がピークで全部ON、7〜8 で落ち着き、1〜3 はビルドアップ。
     *
     * 粒の量は phase ごとに段差で切り替えるのではなく、
     *   1〜3 (grow) : phase 中ずっと actual_tick に合わせて増え続ける
     *   4〜6 (hold) : その比率へ寄せて維持
     *   7〜9 (fade) : phase 中ずっと actual_tick に合わせて減り続ける
     * とすることで、ビルドアップと余韻が曲の進行にそのまま乗る。
     */
    _updatePhaseBeatmap(dt) {
        if (!this.usePhaseBeatmap || !this.particles.length) return;
        const total = this.particles.length;
        const slot = this._currentPhaseSlot(dt);
        const cfg = this.phaseTable[slot - 1];

        // --- phase が切り替わった瞬間だけ基準点を作り直す ---
        if (slot !== this._phaseApplied) {
            this._phaseApplied = slot;
            this._phaseFxTarget = cfg;
            if (!this._phaseFx) this._phaseFx = { ...cfg };
            // grow/fade の出発点（今の比率から続けるので段差にならない）
            this._phaseStartRatio = this._revealCount / total;
            this._phaseStartTick = this.actualTick;
            this._phaseStartTime = this.time;
            // 段階的にONにしていく系（真偽値・トラック連動）は即時反映でよい
            this.vhsAutoTracking = cfg.tracking > 0;
            if (cfg.tracking > 0) {
                this.vhsAutoTrackingMin = cfg.tracking * 0.7;
                this.vhsAutoTrackingMax = cfg.tracking * 1.6;
            }
            this.vhsRollChance = cfg.roll;
            this.padPopScale = cfg.pads;
            // カメラランダマイズの反応しやすさ（ピークほど良く動く）
            this.track1ChanceSlow = 0.35 * cfg.cam;
            this.track1ChanceFast = 0.95 * cfg.cam;
        }

        // --- モードごとに目標比率を決める ---
        const mode = cfg.mode || 'hold';
        let ratio;
        if (mode === 'grow' || mode === 'fade') {
            // phase の進み具合（tick基準）で、開始時の比率から cfg.particles へ連続的に動かす
            ratio = THREE.MathUtils.lerp(this._phaseStartRatio, cfg.particles, this._phaseProgress());
        } else {
            ratio = cfg.particles;
        }
        this._phaseTargetCount = Math.max(mode === 'fade' ? 0 : 1, Math.round(total * ratio));

        // --- 粒の数を目標へ滑らかに寄せる（いきなり数百個現れないように）---
        const target = this._phaseTargetCount;
        if (target !== this._revealCount) {
            const maxStep = Math.max(1, Math.round(this.phaseParticleRate * dt));
            let next = this._revealCount;
            if (target > next) {
                next = Math.min(target, next + maxStep);
                // 増えた分は天井からスポーン（降ってくる）
                for (let i = this._revealCount; i < next; i++) this._respawnFromTop(this.particles[i]);
            } else {
                next = Math.max(target, next - maxStep);
            }
            this._revealCount = next;
            // 実際に出ている個数だけ描画・行列転送する（未出現ぶんのコストをゼロにする）
            this._applyDrawCounts(next);
            this.setParticleCount(next);   // HUDにも現在数を反映
        }

        // --- エフェクトの強さを目標へ滑らかに寄せる（切り替わりでガクッとしない）---
        const fx = this._phaseFx, tgt = this._phaseFxTarget;
        if (!fx || !tgt) return;
        const k = this.phaseLerp;
        fx.vhs += (tgt.vhs - fx.vhs) * k;
        fx.bloom += (tgt.bloom - fx.bloom) * k;
        fx.dropout += (tgt.dropout - fx.dropout) * k;
        fx.grain += (tgt.grain - fx.grain) * k;

        const u = this.vhsPass?.material?.uniforms;
        if (u) {
            u.uAmount.value = fx.vhs;
            u.uDropout.value = fx.dropout;
            if (this.useVHSGrain) {
                u.uGrain.value = fx.grain;
                u.uGrainColor.value = fx.grain * 0.5;
            }
        }
        if (this.bloomPass) this.bloomPass.strength = fx.bloom;
    }

    /** パーティクルを天井付近のランダム位置から落とし直す */
    _respawnFromTop(p) {
        const mX = Math.max(0, this.roomHalfX - p.radius - 40);
        const mZ = Math.max(0, this.roomHalfZ - p.radius - 40);
        p.position.set(
            (Math.random() * 2 - 1) * mX * 0.8,
            this.roomCeilY - p.radius - 20 - Math.random() * 320,
            (Math.random() * 2 - 1) * mZ * 0.8
        );
        p.velocity.set((Math.random() - 0.5) * 80, -60 - Math.random() * 100, (Math.random() - 0.5) * 80);
        p.angularVelocity.set(0, 0, 0);
    }

    /**
     * 未出現ぶんを「描画しない」ようにする。
     *
     * スケール0の行列を入れても InstancedMesh は全インスタンスの頂点シェーダーを回し、
     * instanceMatrix も全件アップロードされるため、粒が1個でも1000個ぶんのコストがかかる。
     * `mesh.count` を絞れば描画・行列転送とも実際に出ている個数だけになる。
     *
     * meshIndex はパーティクル生成順に連番で振っているので、
     * 「先頭 start 個」に含まれる球／キューブの index は必ず 0 から連続する。
     * よってそれぞれの個数をそのまま count にできる。
     */
    _applyDrawCounts(activeN) {
        let ns = 0, nc = 0;
        for (let i = 0; i < activeN; i++) {
            if (this.particles[i].isCube) nc++; else ns++;
        }
        const sphereMesh = this.instancedMeshManager?.getMainMesh();
        if (sphereMesh) sphereMesh.count = ns;
        if (this._cubeParticleMesh) this._cubeParticleMesh.count = nc;
    }

    /** start 以降のパーティクルを非表示化（描画数を絞る） */
    _hideParticlesFrom(start) {
        this._applyDrawCounts(start);
    }

    // ===== 物理: 浮遊 + 相互衝突（Scene01方式の空間ハッシュグリッド） =====
    _updateParticles(dt) {
        if (!this.instancedMeshManager || !this.particles.length) return;
        const n = this._activeN();
        if (!n) return;
        const tmp = this._tmpVec;
        const diff = this._diff;

        // 箱の内壁（キューブ面は壁面と面一なので、ごく小さいマージン＋球の半径でクランプ）
        const pad = 2;   // タイル面に接地させる（浮き防止。20→2）
        const minX = -this.roomHalfX + pad, maxX = this.roomHalfX - pad;
        const minZ = -this.roomHalfZ + pad, maxZ = this.roomHalfZ - pad;
        const floorY = this.roomFloorY + pad, ceilY = this.roomCeilY - pad;
        const rest = this.wallRestitution;
        // 60fps 基準のコマ数 × スローモーション倍率。
        // 極端な dt（タブ復帰・処理落ち）で吹き飛ばないよう挟む
        const step = THREE.MathUtils.clamp(dt * 60 * this.motionScale, 0.1, 2.5);
        const prof = this.profile ? this._prof : null;
        let t0 = prof ? performance.now() : 0;

        // --- 力を加えて物理更新 ---
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];

            // 純粋な物理：自発的な力は一切加えない（重力＋衝突のみ）
            // step は 60fps 基準のコマ数。fps が変わっても落下の速さが変わらないようにする
            p.update(step);

            // 重力（下向き）
            p.velocity.y -= this.gravity * step;

            // 箱型の部屋の壁で反発（半径ぶん内側でクランプ→速度を反転）
            const r = p.radius;
            if (p.position.x < minX + r) { p.position.x = minX + r; if (p.velocity.x < 0) p.velocity.x *= -rest; }
            else if (p.position.x > maxX - r) { p.position.x = maxX - r; if (p.velocity.x > 0) p.velocity.x *= -rest; }
            if (p.position.z < minZ + r) { p.position.z = minZ + r; if (p.velocity.z < 0) p.velocity.z *= -rest; }
            else if (p.position.z > maxZ - r) { p.position.z = maxZ - r; if (p.velocity.z > 0) p.velocity.z *= -rest; }
            // 床：反発を弱く＋横方向に転がり摩擦をかけて溜まる（積もる）
            if (p.position.y < floorY + r) {
                p.position.y = floorY + r;
                if (p.velocity.y < 0) {
                    // 真上に跳ね返し続けると「その場で永久にポンポンする」不自然な絵になるので、
                    // 跳ね返りの向きを少し散らして横へ逃がす（実物の球も微妙な回転と床の凹凸で散る）。
                    const vin = -p.velocity.y;                       // 入射速度（正の値）
                    let up = vin * this.floorRestitution;
                    // 弱い衝突ほど強めに減衰させて、細かいバウンドを素早く収束させる
                    if (up < this.bounceStopSpeed) up *= 0.35;
                    // 上向き成分の一部を横方向のランダムな向きへ振り替える
                    const spread = this.bounceSpread * (0.4 + Math.random() * 0.6);
                    const ang = Math.random() * Math.PI * 2;
                    const lateral = up * spread;
                    p.velocity.y = up * (1 - spread * 0.5);
                    p.velocity.x += Math.cos(ang) * lateral;
                    p.velocity.z += Math.sin(ang) * lateral;
                    // 跳ね上がりが小さすぎるなら止める（微細バウンドの震えを消す）
                    if (p.velocity.y < this.bounceStopSpeed * 0.5) p.velocity.y = 0;
                }
                p.velocity.x *= this.floorFriction;
                p.velocity.z *= this.floorFriction;
                // 着地時：横方向の速度を転がり回転に変換（自然な慣性）
                const rf = this.rollFactor / (r / 60);
                p.angularVelocity.z += -p.velocity.x * rf;
                p.angularVelocity.x += p.velocity.z * rf;
            } else if (p.position.y > ceilY - r) {
                p.position.y = ceilY - r;
                if (p.velocity.y > 0) p.velocity.y *= -rest;
            }

            // 床に置かれた大キューブとの衝突（静的なので押し返すだけ）
            this._resolveStaticCubeCollisions(p);

            // 角速度の減衰＋「移動速度に連動」：ほぼ止まってる粒子は回転も素早く止める
            p.angularVelocity.multiplyScalar(this.angularDamp);
            const sp = p.velocity.length();
            if (sp < this.spinStopSpeed) {
                // 遅いほど強く回転を殺す（速度0で即停止に近づく）
                p.angularVelocity.multiplyScalar(sp / this.spinStopSpeed * 0.6);
            }
            p.updateRotation(dt);
        }

        if (prof) { prof.physics += performance.now() - t0; t0 = performance.now(); }

        // --- 空間ハッシュグリッド構築 ---
        const grid = this.grid;
        grid.clear();
        const gs = this.gridSize;
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            const gx = Math.floor(p.position.x / gs);
            const gy = Math.floor(p.position.y / gs);
            const gz = Math.floor(p.position.z / gs);
            const key = (gx + 512) + (gy + 512) * 1024 + (gz + 512) * 1048576;
            let cell = grid.get(key);
            if (!cell) { cell = []; grid.set(key, cell); }
            cell.push(i);
        }

        if (prof) { prof.grid += performance.now() - t0; t0 = performance.now(); }

        // --- 近傍セルで相互衝突を解消 ---
        const restitution = 0.55;
        for (let i = 0; i < n; i++) {
            const a = this.particles[i];
            const gx = Math.floor(a.position.x / gs);
            const gy = Math.floor(a.position.y / gs);
            const gz = Math.floor(a.position.z / gs);
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    for (let oz = -1; oz <= 1; oz++) {
                        const key = (gx + ox + 512) + (gy + oy + 512) * 1024 + (gz + oz + 512) * 1048576;
                        const cell = grid.get(key);
                        if (!cell) continue;
                        for (let c = 0; c < cell.length; c++) {
                            const j = cell[c];
                            if (i >= j) continue;
                            const b = this.particles[j];
                            diff.subVectors(a.position, b.position);
                            const distSq = diff.lengthSq();
                            const minDist = a.radius + b.radius;
                            if (distSq < minDist * minDist && distSq > 1e-6) {
                                const d = Math.sqrt(distSq);
                                const overlap = (minDist - d) * 0.5;
                                const nrm = diff.multiplyScalar(1 / d);
                                tmp.copy(nrm).multiplyScalar(overlap);
                                a.position.add(tmp);
                                b.position.sub(tmp);

                                const rvx = a.velocity.x - b.velocity.x;
                                const rvy = a.velocity.y - b.velocity.y;
                                const rvz = a.velocity.z - b.velocity.z;
                                const dot = rvx * nrm.x + rvy * nrm.y + rvz * nrm.z;
                                if (dot < 0) {
                                    const jimp = -(1 + restitution) * dot * 0.5;
                                    a.velocity.addScaledVector(nrm, jimp);
                                    b.velocity.addScaledVector(nrm, -jimp);
                                    // 衝撃の強さに比例した回転インパルス（自然な慣性）
                                    const spin = Math.min(0.06, -dot * this.spinImpulse);
                                    a.angularVelocity.x += (Math.random() - 0.5) * spin;
                                    a.angularVelocity.y += (Math.random() - 0.5) * spin;
                                    a.angularVelocity.z += (Math.random() - 0.5) * spin;
                                    b.angularVelocity.x += (Math.random() - 0.5) * spin;
                                    b.angularVelocity.y += (Math.random() - 0.5) * spin;
                                    b.angularVelocity.z += (Math.random() - 0.5) * spin;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (prof) { prof.collide += performance.now() - t0; t0 = performance.now(); }

        // --- 飛び出したパッド（壁・床）で風船を押し出す ---
        if (this._padActive) this._pushBalloonsFromPads();

        if (prof) { prof.pads += performance.now() - t0; t0 = performance.now(); }

        // --- インスタンス行列へ反映（球 / 小キューブに振り分け）---
        const cubeMesh = this._cubeParticleMesh;
        const m = this._pTmpM, q = this._pTmpQ, s = this._pTmpS;
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            if (p.isCube) {
                q.setFromEuler(p.rotation); s.setScalar(p.radius);
                m.compose(p.position, q, s);
                cubeMesh.setMatrixAt(p.meshIndex, m);
            } else {
                this.instancedMeshManager.setMatrixAt(p.meshIndex, p.position, p.rotation, p.radius);
            }
        }
        this.instancedMeshManager.markNeedsUpdate();
        if (cubeMesh) cubeMesh.instanceMatrix.needsUpdate = true;

        if (prof) prof.upload += performance.now() - t0;
    }

    /** `?prof=1` のとき、1秒ごとに1フレームあたりの内訳(ms)を出す */
    _reportProfile(dt) {
        const p = this._prof;
        p.frames++;
        p.t += dt;
        if (p.t < 1) return;
        const f = p.frames || 1;
        const ms = (v) => (v / f).toFixed(2);
        const info = this.renderer?.info;
        const dpr = this.renderer?.getPixelRatio?.() ?? 1;
        const w = Math.round(window.innerWidth * dpr);
        const h = Math.round(window.innerHeight * dpr);
        const passes = this.composer?.passes?.length ?? 0;
        const sm = this._minimalLights?.find(l => l.isDirectionalLight)?.shadow?.mapSize;
        console.log(
            `[Scene14 prof] ${f}fps | particles=${this._activeN()} | ` +
            `physics=${ms(p.physics)} grid=${ms(p.grid)} collide=${ms(p.collide)} ` +
            `pads=${ms(p.pads)} upload=${ms(p.upload)} dofFocus=${ms(p.dof)} ` +
            `| CPU合計=${ms(p.physics + p.grid + p.collide + p.pads + p.upload + p.dof)}ms ` +
            `(残りがGPU/描画待ち)\n` +
            `   GPU側の材料: buffer=${w}x${h}(dpr=${dpr}) passes=${passes} ` +
            `shadowMap=${sm ? sm.x : '-'} ` +
            `drawCalls=${info?.render?.calls ?? '-'} tris=${info?.render?.triangles ?? '-'} ` +
            `| キー: F=影 / V=DOF / B=Bloom / N=VHS を個別にON/OFFして比べる`
        );
        p.physics = p.grid = p.collide = p.pads = p.upload = p.dof = 0;
        p.frames = 0;
        p.t = 0;
    }

    /**
     * GPU側の重い要素を実行中に個別ON/OFFする（`?prof=1` 時のみ有効）。
     * CPUが 0.35ms しか使っていない＝残り全部がGPU待ちなので、
     * どのパスが効いているかは「切って fps を見る」のが唯一確実な切り分け方。
     * @param {string} key 'shadow' | 'dof' | 'bloom' | 'vhs'
     */
    toggleGpuFeature(key) {
        switch (key) {
            case 'shadow': {
                this.enableShadows = !this.enableShadows;
                this.renderer.shadowMap.enabled = this.enableShadows;
                // shadowMap.enabled の切替はシェーダー再コンパイルが必要
                this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
                console.log(`[Scene14] shadows = ${this.enableShadows}`);
                break;
            }
            case 'dof':
                if (this.bokehPass) {
                    this.bokehPass.enabled = !this.bokehPass.enabled;
                    console.log(`[Scene14] DOF = ${this.bokehPass.enabled}`);
                }
                break;
            case 'bloom':
                if (this.bloomPass) {
                    this.bloomPass.enabled = !this.bloomPass.enabled;
                    console.log(`[Scene14] bloom = ${this.bloomPass.enabled}`);
                }
                break;
            case 'vhs':
                if (this.vhsPass) {
                    this.vhsPass.enabled = !this.vhsPass.enabled;
                    console.log(`[Scene14] VHS = ${this.vhsPass.enabled}`);
                }
                break;
        }
    }

    /** 飛び出したパッドと風船の衝突：パッド前面より内側に押し出す */
    _pushBalloonsFromPads() {
        const faces = this._faces;
        const pops = this._padPop;
        if (!faces || !pops) return;
        const reach = 2200;   // これ以上壁から離れてたらどのパッドも届かない（最大pop相当）
        const parts = this.particles;
        const nAct = this._activeN();
        for (let pi = 0; pi < nAct; pi++) {
            const p = parts[pi];
            const r = p.radius;
            for (let fi = 0; fi < faces.length; fi++) {
                const F = faces[fi];
                const dx = p.position.x - F.fc.x;
                const dy = p.position.y - F.fc.y;
                const dz = p.position.z - F.fc.z;
                // 壁からの内向き距離
                const dn = dx * F.n.x + dy * F.n.y + dz * F.n.z;
                if (dn > reach + r || dn < -50) continue;
                // 面内座標 → セル
                const ou = dx * F.u.x + dy * F.u.y + dz * F.u.z;
                const ov = dx * F.v.x + dy * F.v.y + dz * F.v.z;
                const cc = Math.floor((ou + F.fw * 0.5) / (F.fw / F.cols));
                const rr = Math.floor((ov + F.fh * 0.5) / (F.fh / F.rows));
                if (cc < 0 || cc >= F.cols || rr < 0 || rr >= F.rows) continue;
                const idx = F.grid[rr * F.cols + cc];
                if (idx < 0) continue;
                const pop = pops[idx];
                if (pop <= 0.5) continue;
                // 前面は rest で壁面(dn=0)、pop で内側へ pop。風船表面がそれより内側に来るよう押す
                const need = pop + r;
                if (dn < need) {
                    const pen = need - dn;
                    p.position.addScaledVector(F.n, pen);
                    const vn = p.velocity.dot(F.n);
                    if (vn < 0) p.velocity.addScaledVector(F.n, -vn * 1.4);
                    // 押し出しの勢い：法線方向をベースにやや角度をランダムに散らす
                    // （真上にぽーんと真っ直ぐ飛ばず、それぞれバラけた角度で受け取る）
                    const spread = this.padPushSpread;
                    let dxr = F.n.x + (Math.random() - 0.5) * spread;
                    let dyr = F.n.y + (Math.random() - 0.5) * spread;
                    let dzr = F.n.z + (Math.random() - 0.5) * spread;
                    const dl = Math.hypot(dxr, dyr, dzr) || 1;
                    let push = Math.min(pen, 260) * 0.8;
                    // 床（上向き）は重力に逆らって強く吹き上げる
                    if (F.n.y > 0.5) push *= this.floorPushBoost;
                    p.velocity.x += (dxr / dl) * push;
                    p.velocity.y += (dyr / dl) * push;
                    p.velocity.z += (dzr / dl) * push;
                }
            }
        }
    }

    // ===== onUpdate =====
    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;

        this._updatePhaseBeatmap(deltaTime);
        this._updateParticles(deltaTime);
        this._updatePads(deltaTime);

        // ノートバーストのグロー減衰
        this._pastelPulse *= Math.exp(-2.6 * deltaTime);
        if (this._glowLight) {
            this._glowLight.intensity = this._pastelPulse * 900;
        }

        this.atmosphere?.update(deltaTime, this.time, this._centerSmoothed);

        this.updateCamera(deltaTime);

        // DOFフォーカス：画面中央に一番近いパーティクルにピントを合わせる
        const _dofT0 = this.profile ? performance.now() : 0;
        if (this.useAutoFocusDOF && this.useDOF && this.bokehPass?.uniforms?.focus) {
            const cam = this.camera.position;
            const fwd = this._dofCamDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
            const to = this._dofToTarget;
            let bestScore = -Infinity;
            let bestDist = -1;
            const nDof = this._activeN();
            for (let i = 0; i < nDof; i++) {
                const pp = this.particles[i].position;
                to.set(pp.x - cam.x, pp.y - cam.y, pp.z - cam.z);
                const proj = to.dot(fwd);
                if (proj <= 60) continue;              // 後ろ or 近すぎ
                const len = to.length() || 1;
                const cos = proj / len;                // 視線中心にどれだけ近いか
                if (cos < 0.5) continue;               // 画面外寄りは無視
                // 中央に近いほど高スコア（僅かに近距離を優先）
                const score = cos - proj * 0.00002;
                if (score > bestScore) { bestScore = score; bestDist = proj; }
            }
            let targetFocus;
            if (bestDist > 0) {
                targetFocus = bestDist;
            } else {
                to.copy(this._centerSmoothed).sub(cam);
                targetFocus = Math.max(100, to.dot(fwd));
            }
            const u = this.bokehPass.uniforms.focus;
            u.value += (targetFocus - u.value) * 0.12;   // ゆっくり寄せてカクつき防止
        } else if (this.bokehPass?.uniforms?.focus) {
            this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        }
        if (this.profile) this._prof.dof += performance.now() - _dofT0;
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);

        // VHS：時間・進行中のトラッキングノイズ／ロール・OSDカウンタを進める
        this.vhsPass?.update(deltaTime, this.time);
        this.vhsOverlay?.update(deltaTime);

        // OSC 待ちにせず、たまに自動で乱れ帯を流す
        if (this.vhsAutoTracking && this.vhsPass) {
            this._vhsAutoT -= deltaTime;
            if (this._vhsAutoT <= 0) {
                this.vhsPass.triggerTracking(0.5 + Math.random() * 0.5, 0.6 + Math.random() * 0.9);
                // ごく稀に垂直ロールも一緒に（テープが噛んだ感じ）。多いと目が疲れる
                if (Math.random() < 0.10) {
                    this.vhsPass.triggerRoll((0.08 + Math.random() * 0.10) * this.vhsRollAmpScale, 0.2);
                    this._lastVhsRollT = this.time;
                }
                this._vhsAutoT = this.vhsAutoTrackingMin
                    + Math.random() * (this.vhsAutoTrackingMax - this.vhsAutoTrackingMin);
            }
        }

        this._updateSkySpin();

        if (this.profile) this._reportProfile(deltaTime);
    }

    /** スカイドームを96小節（actual_tick 1ループ）でちょうど1周させる */
    _updateSkySpin() {
        if (!this.skySpinWithTick || !this._skyDome) return;
        // /actual_tick が来ていれば 96小節で1周。来ていなければ時間ベースにフォールバック
        const frac = this.actualTick > 0
            ? (this.actualTick % this.ticksPerLoop) / this.ticksPerLoop
            : (this.time % this.tickFallbackLoopSec) / this.tickFallbackLoopSec;
        this._skyDome.rotation.y = this.skyRotationY + frac * Math.PI * 2;
    }

    // ===== ゆるいオートオービットカメラ（track1でランダム視点に飛ぶ）=====
    updateCamera(deltaTime) {
        const a = this._orbitPhase + this.time * this.orbitSpeed;
        const bob = Math.sin(this.time * 0.12) * this.orbitBob;
        let y = this.centerY + this._camHeightOff + bob;
        y = THREE.MathUtils.clamp(y, this.roomFloorY + 250, this.roomCeilY - 250);
        this.camera.position.set(
            Math.sin(a) * this._camRadius,
            y,
            Math.cos(a) * this._camRadius
        );
        // ショット切り替え：オブジェクト注視だけでなく、窓・天井・見回しを織り交ぜる
        this._camShotT += deltaTime;
        if (this._camShotT > this._camShotDur) this._pickCameraShot();

        // ショットごとの注視ターゲットと追従スピード（小さいほどゆっくりパン）
        let rate = 0.035;
        const cam = this.camera.position;
        switch (this._camShot) {
            case 'ceiling':
                // ゆっくり天井を見上げる（カメラ寄りの天井点＝首をゆっくり上げる動き）
                this._lookTarget.set(cam.x * 0.45, this.roomCeilY + 500, cam.z * 0.45);
                rate = 0.012;
                break;
            case 'window': {
                // 窓の外の空へ視線を送る
                const R = this._windowRect;
                if (R) this._lookTarget.set((R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2, -this.roomHalfZ - 400);
                else this._lookTarget.copy(this._center);
                rate = 0.018;
                break;
            }
            case 'drift':
                // 部屋全体をゆったり見回す（中心のまわりをゆっくり漂う視線）
                this._lookTarget.set(
                    Math.sin(this.time * 0.11) * this.roomHalfX * 0.4,
                    this.centerY + Math.sin(this.time * 0.07) * this.roomHalfY * 0.45,
                    Math.cos(this.time * 0.09) * this.roomHalfZ * 0.4
                );
                rate = 0.02;
                break;
            default: {   // 'particle'：従来どおりオブジェクトへスムーズ追従
                this._focusRepickT += deltaTime;
                if (this._focusIdx < 0 || this._focusRepickT > this.focusRepickInterval) {
                    this._pickFocusParticle();
                    this._focusRepickT = 0;
                }
                const fp = this.particles[this._focusIdx]?.position;
                if (fp) this._lookTarget.copy(fp);
            }
        }
        this._centerSmoothed.lerp(this._lookTarget, rate);
        this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
        this.camera.matrixWorldNeedsUpdate = false;
    }

    /** 次のカメラショットを選ぶ（オブジェクト注視を軸に、窓・天井・見回しを織り交ぜる） */
    _pickCameraShot() {
        const r = Math.random();
        if (r < 0.40) {
            this._camShot = 'particle';
            this._camShotDur = 6 + Math.random() * 6;
            this._pickFocusParticle();
            this._focusRepickT = 0;
        } else if (r < 0.62 && this._windowRect) {
            this._camShot = 'window';
            this._camShotDur = 7 + Math.random() * 5;
        } else if (r < 0.80) {
            this._camShot = 'ceiling';
            this._camShotDur = 8 + Math.random() * 6;
        } else {
            this._camShot = 'drift';
            this._camShotDur = 7 + Math.random() * 6;
        }
        this._camShotT = 0;
    }

    /** カメラの注視対象を選ぶ（大きめ・カメラ前方の粒子を優先。出現済みの粒子のみ） */
    _pickFocusParticle() {
        const n = this._activeN();
        if (!n) return;
        const cam = this.camera.position;
        let best = this._focusIdx >= 0 ? this._focusIdx : 0;
        let bestScore = -Infinity;
        for (let k = 0; k < 10; k++) {
            const i = Math.floor(Math.random() * n);
            const p = this.particles[i];
            const dx = p.position.x - cam.x, dy = p.position.y - cam.y, dz = p.position.z - cam.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            // 大きくて・近すぎず遠すぎない粒子を優先
            const score = p.radius - Math.abs(dist - 2600) * 0.05;
            if (score > bestScore) { bestScore = score; best = i; }
        }
        this._focusIdx = best;
    }

    /** track1: 他シーンと同じくカメラをランダマイズ（視点を別の場所へ飛ばす） */
    randomizeCamera() {
        this._orbitPhase = Math.random() * Math.PI * 2;
        const maxR = Math.min(this.roomHalfX, this.roomHalfZ) - 260;
        this._camRadius = THREE.MathUtils.clamp(2500 + Math.random() * 900, 600, maxR);
        this._camHeightOff = (Math.random() - 0.4) * 1200;
        this.orbitSpeed = (0.03 + Math.random() * 0.05) * (Math.random() < 0.5 ? -1 : 1);
        this._pickCameraShot();   // 視点を飛ばす時にショット（注視対象/窓/天井/見回し）も選び直す
    }

    /** クラウド内のランダムな点から近傍粒子を外へ弾くバースト */
    _fireBurst(velocity) {
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const bx = THREE.MathUtils.lerp(-this.roomHalfX, this.roomHalfX, Math.random());
        const by = THREE.MathUtils.lerp(this.roomFloorY, this.roomCeilY, Math.random());
        const bz = THREE.MathUtils.lerp(-this.roomHalfZ, this.roomHalfZ, Math.random());

        const radius = 700 + v * 900;
        const r2 = radius * radius;
        const power = (600 + v * 1400);
        const tmp = this._tmpVec;
        const nAct = this._activeN();
        for (let i = 0; i < nAct; i++) {
            const p = this.particles[i];
            const dx = p.position.x - bx, dy = p.position.y - by, dz = p.position.z - bz;
            const dsq = dx * dx + dy * dy + dz * dz;
            if (dsq > r2) continue;
            const d = Math.sqrt(dsq) || 1;
            const fall = 1 - d / radius;
            tmp.set(dx / d, dy / d, dz / d).multiplyScalar(power * fall);
            p.velocity.add(tmp);
        }

        this._pastelPulse = Math.min(1.4, this._pastelPulse + 0.5 + v * 0.6);
        if (this._glowLight) {
            this._glowLight.position.set(bx, by, bz);
            this._colorTmp.setHSL(Math.random(), 0.5, 0.72);
            this._glowLight.color.copy(this._colorTmp);
        }
    }

    /**
     * track7〜12でパッド（キューブ）を飛び出させる。
     *  - velocity → 飛び出し量 & 発光色（ヒートマップ）
     *  - duration → 保持＆飛び出し量（velocityと合わせて"長さ"が変わる）
     *  - note(シーケンス) → 前のnoteに近いほど前回位置の近くを押し出す（クラスタ）
     *  - track7: 単発 → track12: 大量（番号が大きいほど枚数増）
     */
    _popByTrack(track, note, velocity, durationMs) {
        if (!this._pads) return;
        const nPads = this._pads.length;
        const v = Math.max(0, Math.min(127, velocity)) / 127;
        const durSec = durationMs > 0 ? durationMs / 1000 : (0.12 + v * 0.25);

        // 飛び出し量（＝長さ）：ベースをしっかり長く＋velocity/durationで更に伸びる
        // phase による倍率（ピークほど大きくニョキる）
        const amp = (this.padPopBase + v * 520) * (0.85 + Math.min(1.6, durSec) * 0.9)
            * (this.padPopScale ?? 1);
        const hold = Math.max(0.08, Math.min(2.0, durSec));

        // 発光色＝velocityのヒートマップ
        this._heatColor(v, this._popCol);

        // 中心パッドを選ぶ（天井=面2は除外）
        const pickRandom = () => {
            let idx = 0;
            for (let g = 0; g < 20; g++) { idx = Math.floor(Math.random() * nPads); if (this._pads[idx].face !== 2) break; }
            return idx;
        };

        // シーケンス近接：前のnoteに近いほど前回パッドの近くを中心にする
        let center = -1;
        if (this._lastPopIdx >= 0 && this._pads[this._lastPopIdx].face !== 2) {
            const closeness = Math.max(0, 1 - Math.abs(note - this._lastNote) / this.seqSpread);
            if (closeness > 0 && Math.random() < 0.4 + closeness * 0.6) {
                const p = this._pads[this._lastPopIdx];
                const F = this._faces[p.face];
                const rad = Math.max(1, Math.round((1 - closeness) * 7));
                const cc = THREE.MathUtils.clamp(p.col + Math.round((Math.random() * 2 - 1) * rad), 0, F.cols - 1);
                const rr = THREE.MathUtils.clamp(p.row + Math.round((Math.random() * 2 - 1) * rad), 0, F.rows - 1);
                const idx2 = F.grid[rr * F.cols + cc];
                if (idx2 >= 0 && this._pads[idx2].face !== 2) center = idx2;
            }
        }
        if (center < 0) center = pickRandom();

        // track7〜12：番号が大きいほど押し出す枚数が増える
        let count;
        if (track === 7) count = 1;
        else if (track === 8) count = 2 + Math.floor(Math.random() * 2);
        else if (track === 9) count = 4 + Math.floor(Math.random() * 4);
        else if (track === 10) count = 8 + Math.floor(Math.random() * 6);
        else if (track === 11) count = 16 + Math.floor(Math.random() * 12);
        else count = 34 + Math.floor(Math.random() * 24);

        this._kickCluster(center, count, amp, hold, this._popCol);

        this._lastPopIdx = center;
        this._lastNote = note;
    }

    // ===== OSC =====
    handleOSC(message) {
        const trackNumber = message?.trackNumber;
        const args = message?.args || [];
        const velocity = args.length > 1 ? Number(args[1]) : 100;
        const durationMs = args.length > 2 ? Number(args[2]) : 0;

        // track1: カメラランダマイズ（LFO疑似ノイズで反応度がうねる間引き）
        if (trackNumber === 1) {
            if (this.trackEffects[1]) {
                // 2つの非整数比サインを重ねた疑似ノイズ（約1〜3分周期）。1=ガッツリ追従 / 0=ゆったり
                const m = THREE.MathUtils.clamp(
                    0.5 + 0.32 * Math.sin(this.time * 0.031) + 0.22 * Math.sin(this.time * 0.011 + 2.4),
                    0, 1
                );
                const cooldown = THREE.MathUtils.lerp(this.track1CooldownSlow, this.track1CooldownFast, m);
                const chance = THREE.MathUtils.lerp(this.track1ChanceSlow, this.track1ChanceFast, m);
                const since = this.time - this._lastCamRandomizeT;
                if (since >= cooldown && Math.random() < chance) {
                    this.randomizeCamera();
                    this._lastCamRandomizeT = this.time;
                }
            }
            return;
        }

        // track2: 他シーンと同じく一瞬の色反転（瞬間フラッシュ）
        if (trackNumber === 2) {
            if (this.trackEffects[2] && this.colorInversion && this.colorInversion.initialized) {
                if (durationMs === 0 && args.length === 0) {
                    this.colorInversion.setEnabled(!this.colorInversion.isEnabled());
                    this.colorInversion.endTime = 0;
                } else {
                    this.colorInversion.apply(velocity, this.track2FlashMs);
                }
            }
            return;
        }

        const note = args.length > 0 ? Number(args[0]) : 60;

        // VHS: 指定トラックでトラッキングノイズ帯 / 垂直ロールを走らせる
        if (trackNumber === this.vhsTrackingTrack && this.vhsPass) {
            if (this.trackEffects[trackNumber] !== false) {
                const v = Math.max(0, Math.min(127, velocity)) / 127;
                // velocity=強さ、durationが長いほどゆっくり流れる
                const dur = durationMs > 0 ? Math.min(2.0, durationMs / 1000 + 0.35) : 0.75;
                this.vhsPass.triggerTracking(0.45 + v * 0.55, dur);
            }
            return;
        }
        if (trackNumber === this.vhsRollTrack && this.vhsPass) {
            // 毎ノート揺らすと目が疲れるので、クールダウン＋確率で間引く
            if (this.trackEffects[trackNumber] !== false) {
                const since = this.time - this._lastVhsRollT;
                if (since >= this.vhsRollCooldown && Math.random() < this.vhsRollChance) {
                    const v = Math.max(0, Math.min(127, velocity)) / 127;
                    this.vhsPass.triggerRoll(
                        (0.06 + v * 0.22) * this.vhsRollAmpScale,
                        0.16 + v * 0.16
                    );
                    this._lastVhsRollT = this.time;
                }
            }
            return;
        }

        // track7〜12: ラウンドキューブ（パッド）が部屋の内側へ飛び出す
        // マッピング: pitch=どのパッド/面, velocity=飛び出し量, duration=保持時間
        if (trackNumber >= 7 && trackNumber <= 12) {
            this._popByTrack(trackNumber, note, velocity, durationMs);
            return;
        }

        // 粒子が吹き飛ぶのは「壁・床の押し出し(track7〜12)」だけ。
        // 空中バースト(_fireBurst)は"何も無い所で飛ぶ"ので廃止。

        // /phase、/tick などは親に委譲
        super.handleOSC(message);
    }

    // ===== initPostProcessing =====
    initPostProcessing() {
        setupPostEffectsPipeline(this, {
            // グレインは VHSPass 内で処理するので専用パスは立てない（0 で attach 自体が走らない）。
            // FilmLookPass の色収差も VHS のクロマ遅延と役割が重複するので不要
            filmGrainIntensity: 0,
            filmGrainGrayscale: false,
            // DOF は three の BokehPass を使わず SoftDofPass を自前で挿す（下で attach）。
            // BokehPass は1画素41サンプル固定でピント面でも撃つため、実測で最重量だった
            dof: false,
            bloomStrength: 0.32,     // 強め（全体のグロー感アップ）
            bloomRadius: 0.75,
            bloomThreshold: 0.80,

            // SSAO：軽量化のため kernelSize を下げる（+ 下で半解像度化）
            ssaoKernelSize: 8,
            ssaoKernelRadius: 16,
            ssaoMinDistance: 0.010,
            ssaoMaxDistance: 0.20
        });
        this._attachSoftDof();       // 軽量DOF（BokehPass の代わり）
        // ストロボは useTrack2Strobe のときだけ載せる（false なら常に uFlash=0 で
        // 何もしないフルスクリーンパスが1枚無駄に走る）
        if (this.useTrack2Strobe) attachStrobeFlashPass(this);
        this._attachVHSPasses();     // VHSルック（テープ劣化＋グレイン＋OSDを1パスで）
        this.applyTrackEffectsToPostPasses();
        this._applySsaoResScale();   // SSAOを半解像度で軽く
    }

    /**
     * 軽量DOF（{@link SoftDofPass}）を挿す。
     * `this.bokehPass` に入れるので、オートフォーカス側のコードは変更不要。
     */
    _attachSoftDof() {
        if (!this.composer || !this.useDOF || this.bokehPass) return;
        this.dofParams = { ...this.dofParams, ...this.dofSettings };
        this.bokehPass = new SoftDofPass(this.scene, this.camera, {
            focus: this.dofSettings.focus,
            aperture: this.dofSettings.aperture,
            maxblur: this.dofSettings.maxblur,
            depthScale: this.dofDepthScale
        });
        this.bokehPass.setSize(window.innerWidth, window.innerHeight);
        this.composer.addPass(this.bokehPass);
    }

    /**
     * VHSルック（テープ劣化）をパイプライン末尾に足す。
     * グレインとOSD文字は VHSPass のシェーダー内で処理するので、
     * 追加されるフルスクリーンパスは **1枚だけ**（＋残像ONのときコピー1枚）。
     */
    _attachVHSPasses() {
        if (!this.composer || !this.useVHS || this.vhsPass) return;

        this.vhsPass = new VHSPass({
            ...this.vhsParams,
            // グレインは専用パスを立てず VHSPass 内で乗せる
            grain: this.useVHSGrain ? this.vhsGrain : 0,
            grainColor: this.useVHSGrain ? this.vhsGrainColor : 0
        });
        this.vhsPass.setSize(window.innerWidth, window.innerHeight);
        this.composer.addPass(this.vhsPass);

        // OSDはテクスチャを VHSPass に渡すだけ（パスは増えない）
        if (this.useVHSOverlay) {
            this.vhsOverlay = new VHSOverlay(this.vhsOverlayParams);
            this.vhsOverlay.bindTo(this.vhsPass);
        }
    }

    /** SSAOを画面より低解像度でレンダーして軽くする（見た目はほぼ変わらず激軽に） */
    _applySsaoResScale() {
        if (this.ssaoPass && this.ssaoResScale < 1 && typeof this.ssaoPass.setSize === 'function') {
            const w = Math.max(1, Math.floor(window.innerWidth * this.ssaoResScale));
            const h = Math.max(1, Math.floor(window.innerHeight * this.ssaoResScale));
            this.ssaoPass.setSize(w, h);
        }
    }

    onResize() {
        super.onResize();
        resizePostEffectsPasses(this);
        this._applySsaoResScale();   // resizeで全解像度に戻るので半解像度を再適用
        this.vhsPass?.setSize(window.innerWidth, window.innerHeight);
        // vhsOverlay はテクスチャ供給役でパスではないため resize 不要
    }

    // ===== dispose =====
    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        this._windowFrameMat = null;

        if (this._minimalLights) {
            for (const light of this._minimalLights) {
                this.scene.remove(light);
                light.dispose?.();
            }
            this._minimalLights = null;
        }
        this._glowLight = null;
        this._ceilingLight = null;
        if (this._ceilingPanel) {
            this.scene.remove(this._ceilingPanel);
            this._ceilingPanelGeo?.dispose();
            this._ceilingPanelMat?.dispose();
            this._ceilingPanel = null;
            this._ceilingPanelGeo = null;
            this._ceilingPanelMat = null;
        }

        if (this.atmosphere) {
            this.atmosphere.dispose();
            this.atmosphere = null;
        }

        if (this._roomBaseMesh) {
            this.scene.remove(this._roomBaseMesh);
            this._roomBaseMesh.geometry?.dispose();
            this._roomBaseMat?.dispose();
            this._roomBaseHiddenMat?.dispose();
            this._roomBaseMesh = null;
            this._roomBaseMat = null;
            this._roomBaseHiddenMat = null;
        }
        if (this._windowGroup) {
            this.scene.remove(this._windowGroup);
            const mats = new Set();
            this._windowGroup.traverse(o => {
                if (o.isMesh) {
                    o.geometry?.dispose();
                    if (o.material) mats.add(o.material);
                }
            });
            mats.forEach(m => m.dispose());
            this._windowGroup = null;
        }
        if (this._windowTex) {
            this._windowTex.normalMap?.dispose();
            this._windowTex.roughnessMap?.dispose();
            this._windowTex = null;
        }
        this._windowRect = null;
        if (this._skyDome) {
            this.scene.remove(this._skyDome);
            this._skyDome.geometry?.dispose();
            this._skyDome.material?.dispose();
            this._skyTexture?.dispose();
            this._skyDome = null;
            this._skyTexture = null;
        }
        if (this._padMesh) {
            this.scene.remove(this._padMesh);
            this._padMesh.dispose?.();
            this._padGeo?.dispose();
            this._padMat?.dispose();
            this._padMesh = null;
            this._padGeo = null;
            this._padMat = null;
        }
        if (this._padTex) {
            this._padTex.map?.dispose();
            this._padTex.bumpMap?.dispose();
            this._padTex = null;
        }
        this._pads = null;
        this._faces = null;
        this._padGlowAttr = null;
        this._padGlowColorAttr = null;
        this._lastPopIdx = -1;
        this._padPop = null;
        this._padTarget = null;
        this._padHold = null;
        this._padActive = false;

        if (this.instancedMeshManager) {
            this.instancedMeshManager.dispose();
            this.instancedMeshManager = null;
        }
        if (this._cubeParticleMesh) {
            this.scene.remove(this._cubeParticleMesh);
            this._cubeParticleMesh.dispose?.();
            this._cubeParticleGeo?.dispose();
            this._cubeParticleMat?.dispose();
            this._cubeParticleMesh = null;
            this._cubeParticleGeo = null;
            this._cubeParticleMat = null;
        }
        if (this._staticCubeMesh) {
            this.scene.remove(this._staticCubeMesh);
            this._staticCubeMesh.dispose?.();
            this._staticCubeGeo?.dispose();
            this._staticCubeMat?.dispose();
            this._staticCubeMesh = null;
            this._staticCubeGeo = null;
            this._staticCubeMat = null;
        }
        this._staticCubes = [];
        if (this._pastelTex) {
            this._pastelTex.map?.dispose();
            this._pastelTex.bumpMap?.dispose();
            this._pastelTex = null;
        }
        this._sphereMat = null;
        this.particles = [];
        this.grid.clear();

        if (this.vhsPass) {
            if (this.composer) {
                const i = this.composer.passes.indexOf(this.vhsPass);
                if (i !== -1) this.composer.passes.splice(i, 1);
            }
            this.vhsPass.dispose();
            this.vhsPass = null;
        }
        if (this.vhsOverlay) {
            // composer には登録していない（VHSPass 内で合成）ので、テクスチャの破棄だけ
            this.vhsOverlay.dispose();
            this.vhsOverlay = null;
        }

        // SoftDofPass は深度RTを持つので明示的に破棄する
        // （SceneBase.dispose は bokehPass を null にするだけで dispose を呼ばない）
        if (this.bokehPass) {
            if (this.composer) {
                const i = this.composer.passes.indexOf(this.bokehPass);
                if (i !== -1) this.composer.passes.splice(i, 1);
            }
            this.bokehPass.dispose?.();
            this.bokehPass = null;
        }

        disposePresentationOutputPass(this);

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
