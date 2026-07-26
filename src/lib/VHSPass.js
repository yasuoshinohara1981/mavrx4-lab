/**
 * VHS（家庭用ビデオテープ）ルックを1枚のフルスクリーンパスで再現する。
 *
 * VHSらしさの正体は「輝度はそれなりに解像するのに、色信号だけ帯域が極端に狭い」こと。
 * したがって YIQ 空間へ変換し、**クロマ（I/Q）だけ横方向に大きくぼかし＋右へ遅延**させるのが要。
 * そこへ走査線・インターレース・トラッキングノイズ・ドロップアウト・樽型歪みを重ねる。
 *
 * 前フレーム残像（テープのモーションブラー）だけはシェーダー単体では作れないので、
 * {@link VHSPass} が内部で1枚 RenderTarget を持ち、自前で ping-pong する。
 */

import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import {
    ShaderMaterial,
    UniformsUtils,
    Vector2,
    WebGLRenderTarget,
    LinearFilter,
    RGBAFormat,
    HalfFloatType,
    NoBlending
} from 'three';

const VHSShader = {
    uniforms: {
        tDiffuse: { value: null },
        tPrev: { value: null },          // 前フレーム（残像用）
        resolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uFrame: { value: 0 },

        // --- クロマ（色信号）劣化：VHSらしさの本体 ---
        uChromaBlur: { value: 1.0 },     // 色を横にぼかす量（px相当）の倍率
        uChromaDelay: { value: 1.0 },    // 色が右へズレる量の倍率
        uChromaBoost: { value: 1.15 },   // にじんだ色の彩度を少し戻す

        // --- 走査線 / インターレース ---
        uScanline: { value: 0.12 },      // 横縞の濃さ
        // 走査線の本数（画面高さあたり）。解像度/DPIに依存させないための明示指定。
        // 少ない=太い / 多い=細い。実機NTSCは可視240本ぶんの縞だが、太く見えるので既定は細め
        uScanCount: { value: 540 },
        uInterlace: { value: 0.10 },     // フレーム交互のライン明暗差

        // --- ライン単位の横ジッター ---
        uLineJitter: { value: 1.0 },     // 走査線ごとのランダム横ずれ量の倍率

        // --- トラッキングノイズ（画面を上から下へ流れる乱れた帯）---
        uTracking: { value: 0.0 },       // 0=なし、1=全開（OSCで叩く）
        uTrackingY: { value: 1.2 },      // 帯の位置（uv.y。1.0超で画面外＝見えない）
        uTrackingWidth: { value: 0.022 },// 帯の太さ（画面高さ比。0.02＝画面の2%＝細い線）
        uHeadSwitch: { value: 0.7 },     // 画面最下部の常時ノイズ帯の強さ
        uHeadSwitchWidth: { value: 0.02 },// 最下部ノイズ帯の太さ（画面高さ比）

        // --- テープの傷（ドロップアウト）---
        uDropout: { value: 0.5 },        // 白い水平線の出やすさ

        // --- リンギング（過剰シャープの白フチ）---
        uRinging: { value: 0.35 },

        // --- 残像（前フレーム混合）---
        uGhost: { value: 0.16 },

        // --- ブラウン管っぽさ ---
        uBarrel: { value: 0.030 },       // 樽型歪み
        uVignette: { value: 0.28 },      // 四隅の落ち込み

        // --- 垂直ロール（時々画面が縦にガクッとずれる）---
        uRoll: { value: 0.0 },

        // --- グレイン（テープのざらつき）。専用パスを立てずここで済ませる＝1パス節約 ---
        uGrain: { value: 0.0 },        // 輝度ノイズ量
        uGrainColor: { value: 0.0 },   // 色ノイズ量

        // --- OSD（▶ PLAY / カウンタ等）。合成もここで行う＝さらに1パス節約 ---
        tOsd: { value: null },
        uOsdOpacity: { value: 0.0 },

        // --- 全体の適用量（0で完全バイパス相当）---
        uAmount: { value: 1.0 }
    },

    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tPrev;
        uniform vec2 resolution;
        uniform float uTime;
        uniform float uFrame;

        uniform float uChromaBlur;
        uniform float uChromaDelay;
        uniform float uChromaBoost;
        uniform float uScanline;
        uniform float uScanCount;
        uniform float uInterlace;
        uniform float uLineJitter;
        uniform float uTracking;
        uniform float uTrackingY;
        uniform float uTrackingWidth;
        uniform float uHeadSwitch;
        uniform float uHeadSwitchWidth;
        uniform float uDropout;
        uniform float uRinging;
        uniform float uGhost;
        uniform float uBarrel;
        uniform float uVignette;
        uniform float uRoll;
        uniform float uAmount;
        uniform float uGrain;
        uniform float uGrainColor;
        uniform sampler2D tOsd;
        uniform float uOsdOpacity;

        varying vec2 vUv;

        // RGB <-> YIQ（NTSCのコンポジット空間。VHSはこの I/Q 帯域が狭い）
        const mat3 RGB2YIQ = mat3(
            0.299,  0.596,  0.211,
            0.587, -0.274, -0.523,
            0.114, -0.322,  0.312
        );
        const mat3 YIQ2RGB = mat3(
            1.0,    1.0,    1.0,
            0.956, -0.272, -1.106,
            0.621, -0.647,  1.703
        );

        // sin を使わない安価なハッシュ（sin 版は 1 画素あたり何度も呼ぶと effectively 重い）
        float hash11(float x) {
            float p = fract(x * 0.1031);
            p *= p + 33.33;
            p *= p + p;
            return fract(p);
        }
        float hash21(vec2 v) {
            vec3 p = fract(vec3(v.xyx) * vec3(0.1031, 0.1030, 0.0973));
            p += dot(p, p.yzx + 33.33);
            return fract((p.x + p.y) * p.z);
        }

        /**
         * ざらついた横スジ状ノイズ。
         * x をランダム幅のブロックへ量子化して、細かい砂目 + 粗いブロックを重ねる。
         * 一様乱数のままだと「均一な砂嵐」で綺麗すぎるので、
         * コントラストを持ち上げて白飛び/黒潰れの塊を作る。
         */
        float streakNoise(float x, float lineId, float t) {
            // 粗いブロック（横に伸びた塊）
            float bw = 0.012 + hash11(lineId * 1.7 + t) * 0.075;
            float blk = hash21(vec2(floor(x / bw), lineId + t * 3.0));
            // 中間の粒
            float mid = hash21(vec2(floor(x * 90.0), lineId * 0.7 + t * 5.0));
            // 細かい砂目
            float fine = hash21(vec2(floor(x * 420.0), lineId + t * 11.0));
            float n = blk * 0.55 + mid * 0.28 + fine * 0.17;
            // コントラストを強くして塊感を出す（一様乱数の"綺麗さ"を壊す）
            n = clamp((n - 0.42) * 2.6 + 0.5, 0.0, 1.0);
            n = n * n * (3.0 - 2.0 * n);
            return n;
        }

        void main() {
            vec2 px = vec2(1.0) / max(resolution, vec2(1.0));
            vec2 uv = vUv;

            // --- ブラウン管の樽型歪み ---
            {
                vec2 c = uv - 0.5;
                float r2 = dot(c, c);
                uv = 0.5 + c * (1.0 + uBarrel * r2 * uAmount);
            }

            // --- 垂直ロール（テープの同期ずれ）---
            uv.y = fract(uv.y + uRoll);

            // 走査線ID：解像度ではなく uScanCount 基準（DPIで太さが変わらない）
            float scanN = max(uScanCount, 1.0);
            float line = floor(uv.y * scanN);

            // --- 走査線ごとの横ジッター（テープのブレ）---
            // 同じ走査線内は同じズレ量＝横筋状にガタつく
            float jitterAmt = uLineJitter * uAmount;
            if (jitterAmt > 0.0001) {
                float n = hash21(vec2(line, floor(uTime * 24.0)));
                float slow = sin(uv.y * 90.0 + uTime * 2.3) * 0.5 + 0.5;
                uv.x += (n - 0.5) * px.x * 2.2 * jitterAmt * (0.35 + slow * 0.65);
            }

            // --- トラッキングノイズ帯（画面を上から下へ流れる乱れ）＋ 最下部ヘッドスイッチ ---
            // 帯の縁をノイズでギザギザに崩す（真っ直ぐな帯は"綺麗すぎ"に見える）。
            // ゆらぎ量は帯の太さに比例させる（細い帯なのに縁だけ大きく揺れると帯が消える）
            float bw = max(uTrackingWidth, 0.0015);
            float edgeWob = ((hash21(vec2(line, floor(uTime * 18.0))) - 0.5) * 0.5
                          + sin(uv.y * 220.0 + uTime * 7.0) * 0.12) * bw;
            float bandDist = abs(uv.y - uTrackingY + edgeWob);
            float band = uTracking * smoothstep(bw, bw * 0.08, bandDist);
            float hw = max(uHeadSwitchWidth, 0.0015);
            float headBand = uHeadSwitch * smoothstep(hw, hw * 0.1, uv.y + edgeWob * 0.6) * uAmount;
            float disturb = max(band, headBand);
            if (disturb > 0.001) {
                // 帯の中では走査線がブロック単位で大きく横に引きずられる
                float tq = floor(uTime * 40.0);
                float blockW = 0.05 + hash11(line * 2.3 + tq) * 0.25;
                float chunk = hash21(vec2(floor(uv.x / blockW), line + tq));
                float n = hash21(vec2(line, tq));
                uv.x += ((n - 0.5) * 0.06 + (chunk - 0.5) * 0.07) * disturb;
                uv.y += (hash11(line + tq) - 0.5) * px.y * 3.0 * disturb;
            }

            uv = clamp(uv, vec2(0.0005), vec2(0.9995));

            // --- 輝度（Y）はこの位置からそのまま取る ---
            vec3 base = texture2D(tDiffuse, uv).rgb;
            float Y = (RGB2YIQ * base).x;

            // --- クロマ（I/Q）は横方向に大きくぼかし、さらに右へ遅延させる ---
            // = 色が輪郭からハミ出して滲む、VHS最大の特徴。
            // タップ数は 5 に抑える（9タップは1画素13サンプル＝フルスクリーンで致命的に重い）。
            // 間隔を広げれば少ないタップでも滲み幅は同じだけ稼げる。
            float cBlur = px.x * 11.0 * uChromaBlur * uAmount;
            float cDelay = px.x * 3.2 * uChromaDelay * uAmount;
            float cx = uv.x - cDelay;
            vec3 s0 = texture2D(tDiffuse, vec2(clamp(cx - cBlur * 2.0, 0.0005, 0.9995), uv.y)).rgb;
            vec3 s1 = texture2D(tDiffuse, vec2(clamp(cx - cBlur,       0.0005, 0.9995), uv.y)).rgb;
            vec3 s2 = texture2D(tDiffuse, vec2(clamp(cx,               0.0005, 0.9995), uv.y)).rgb;
            vec3 s3 = texture2D(tDiffuse, vec2(clamp(cx + cBlur,       0.0005, 0.9995), uv.y)).rgb;
            vec3 s4 = texture2D(tDiffuse, vec2(clamp(cx + cBlur * 2.0, 0.0005, 0.9995), uv.y)).rgb;
            // 三角窓 (1,2,3,2,1)/9
            vec2 I_Q = (
                (RGB2YIQ * s0).yz * 1.0 +
                (RGB2YIQ * s1).yz * 2.0 +
                (RGB2YIQ * s2).yz * 3.0 +
                (RGB2YIQ * s3).yz * 2.0 +
                (RGB2YIQ * s4).yz * 1.0
            ) * (1.0 / 9.0);
            I_Q *= uChromaBoost;

            vec3 color = YIQ2RGB * vec3(Y, I_Q);

            // --- リンギング（過剰シャープの白フチ）：輝度のアンシャープマスク ---
            // 追加サンプルは取らず、クロマ用に取った隣接サンプル（s1/s3）の輝度を流用する
            if (uRinging > 0.0001) {
                float yl = (RGB2YIQ * s1).x;
                float yr = (RGB2YIQ * s3).x;
                color += uRinging * uAmount * (Y - (yl + yr) * 0.5);
            }

            // --- 前フレーム残像（テープのモーションブラー）---
            if (uGhost > 0.0001) {
                vec3 prev = texture2D(tPrev, clamp(uv + vec2(px.x * 1.5, 0.0), vec2(0.0005), vec2(0.9995))).rgb;
                color = mix(color, max(color, prev * 0.96), uGhost * uAmount);
            }

            // --- 走査線＋インターレース（フレーム交互に奇偶ラインの明暗が入れ替わる）---
            // uScanCount 本ぶんの縞。解像度に依存しないので画面サイズ/DPIで太さが変わらない。
            // pow で暗い部分を細く尖らせる（サインそのままだと縞の半分が暗部＝太く見える）
            float sw = 0.5 + 0.5 * sin(uv.y * scanN * 6.2831853);
            float scan = 1.0 - uScanline * uAmount * pow(sw, 3.0);
            float parity = mod(line + uFrame, 2.0);
            float inter = 1.0 - uInterlace * uAmount * parity;
            color *= scan * inter;

            // --- ドロップアウト（テープの傷）---
            // 実機の傷は「白い線」だけでなく、破線状に途切れ、直後に黒い影が付く。
            // 均一な白帯は綺麗すぎるので、幅の違う複数セグメント＋輝度ムラで汚す
            if (uDropout > 0.0001) {
                float seed = floor(uTime * 12.0);
                float lineSel = hash11(line * 0.137 + seed);
                if (lineSel > 1.0 - 0.014 * uDropout * uAmount) {
                    float xs = hash11(line + seed * 3.1);
                    float w = 0.03 + hash11(line + seed * 7.7) * 0.22;
                    // 破線化：セグメント内をさらにランダムに間引く
                    float seg = step(xs, uv.x) * step(uv.x, xs + w);
                    float dash = hash21(vec2(floor((uv.x - xs) * (14.0 + hash11(line) * 40.0)), line + seed));
                    float hit = seg * step(0.34, dash);
                    // 輝度ムラ（一定の白ではなく、ちらつく）
                    float lum = 0.62 + hash21(vec2(floor(uv.x * 220.0), line + seed)) * 0.38;
                    color = mix(color, vec3(lum) * vec3(0.97, 0.99, 1.04), hit * 0.9);
                }
                // 傷の1ライン下に黒い影（ヘッドが浮いた直後の落ち込み）
                float upLine = line - 1.0;
                float upSel = hash11(upLine * 0.137 + seed);
                if (upSel > 1.0 - 0.014 * uDropout * uAmount) {
                    float xs = hash11(upLine + seed * 3.1);
                    float w = 0.03 + hash11(upLine + seed * 7.7) * 0.22;
                    float seg = step(xs, uv.x) * step(uv.x, xs + w);
                    color *= 1.0 - seg * 0.35;
                }
            }

            // --- 乱れ帯の中：横スジ状のざらついたノイズ＋色抜け ---
            if (disturb > 0.001) {
                float tq = floor(uTime * 60.0);
                float n = streakNoise(uv.x, line, tq);
                // 彩度を落としてから白黒ノイズを乗せる（実機の乱れは色が最初に死ぬ）
                float lum = dot(color, vec3(0.299, 0.587, 0.114));
                color = mix(color, vec3(lum), disturb * 0.75);
                color = mix(color, vec3(n), disturb * 0.55);
                // ブロック単位で明るく飛ぶ帯（ヘッドの当たりムラ）
                float flare = step(0.82, hash21(vec2(floor(uv.x * 9.0), line + tq)));
                color += disturb * (0.05 + flare * 0.16);
            }

            // --- ビネット（ブラウン管の四隅落ち）---
            {
                vec2 c = (vUv - 0.5) * 2.0;
                float v = 1.0 - uVignette * uAmount * dot(c, c) * 0.45;
                color *= clamp(v, 0.0, 1.0);
            }

            // --- グレイン（専用パスを立てずここで。1パスぶん節約）---
            if (uGrain > 0.0001 || uGrainColor > 0.0001) {
                vec2 gp = vUv * resolution;
                float t = floor(uTime * 24.0);   // 24コマ/秒でノイズを更新（映画的なざらつき）
                float g = hash21(gp + vec2(t, t * 1.7)) - 0.5;
                // 暗部ほどノイズが目立つ実写フィルムの特性に寄せる
                float lum = dot(color, vec3(0.299, 0.587, 0.114));
                float w = mix(1.0, 0.45, clamp(lum, 0.0, 1.0));
                color += g * uGrain * w;
                if (uGrainColor > 0.0001) {
                    vec3 gc = vec3(
                        hash21(gp + vec2(t + 11.0, 3.0)),
                        hash21(gp + vec2(t + 23.0, 7.0)),
                        hash21(gp + vec2(t + 37.0, 13.0))
                    ) - 0.5;
                    color += gc * uGrainColor * w;
                }
            }

            // --- OSD（▶ PLAY / SP / カウンタ / 日付）を加算合成。これも同一パス内で済ませる ---
            // 横3タップで滲ませていたが、OSDは画面の数%しか占めないのに
            // 全画素で3サンプル払うことになるので1タップにする（にじみは
            // テクスチャ側の shadowBlur で既に付いている）
            if (uOsdOpacity > 0.0001) {
                vec4 o = texture2D(tOsd, vUv);
                color += o.rgb * o.a * uOsdOpacity;
            }

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

export class VHSPass extends Pass {
    /**
     * @param {object} [options] VHSShader の uniform 名から `u` を外したキーで初期値を渡せる
     *   （例: `{ chromaBlur: 1.4, ghost: 0.2 }`）
     */
    constructor(options = {}) {
        super();

        this.material = new ShaderMaterial({
            uniforms: UniformsUtils.clone(VHSShader.uniforms),
            vertexShader: VHSShader.vertexShader,
            fragmentShader: VHSShader.fragmentShader,
            blending: NoBlending,
            depthTest: false,
            depthWrite: false
        });
        this.fsQuad = new FullScreenQuad(this.material);

        // options のキー（chromaBlur など）を uniform（uChromaBlur）へ流す
        for (const [k, v] of Object.entries(options)) {
            const name = 'u' + k.charAt(0).toUpperCase() + k.slice(1);
            if (this.material.uniforms[name]) this.material.uniforms[name].value = v;
        }

        // 残像用の前フレーム保持
        this.prevRT = new WebGLRenderTarget(1, 1, {
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            format: RGBAFormat,
            type: HalfFloatType,
            depthBuffer: false,
            stencilBuffer: false
        });
        this._prevValid = false;
        this._frame = 0;
        this._dbSize = new Vector2(1, 1);   // 実描画バッファサイズの一時受け
        // 残像バッファの解像度倍率。残像はボケた効果なので低解像度で十分。
        // 1.0 にすると Retina で描画バッファ相当（=CSS比4倍の画素）を毎フレーム
        // 転送することになり、帯域だけで一気に重くなる
        this.ghostScale = options.ghostScale ?? 0.5;

        // --- トラッキングノイズの走り（OSCから叩く）---
        this._trackRunT = -1;      // 0未満＝走ってない
        this._trackRunDur = 0.9;
        this._trackRunAmp = 0;
        // --- 垂直ロール ---
        this._rollT = -1;
        this._rollDur = 0.22;
        this._rollAmp = 0;

        this.setSize(window.innerWidth, window.innerHeight);
    }

    /** @param {string} name `chromaBlur` のようなキー（`u` 無し）で uniform を設定 */
    set(name, value) {
        const key = 'u' + name.charAt(0).toUpperCase() + name.slice(1);
        if (this.material.uniforms[key]) this.material.uniforms[key].value = value;
    }

    /**
     * トラッキングノイズの帯を1回走らせる（画面の上から下へ流れる）。
     * @param {number} [amp=1] 強さ 0〜1
     * @param {number} [durSec=0.9] 走り抜ける秒数（短いほど速い）
     */
    triggerTracking(amp = 1, durSec = 0.9) {
        this._trackRunAmp = Math.max(this._trackRunAmp * 0.5, Math.min(1, Math.max(0, amp)));
        this._trackRunDur = Math.max(0.15, durSec);
        this._trackRunT = 0;
    }

    /**
     * 垂直ロール（同期ずれ）を1回起こす。
     * @param {number} [amp=0.25] ずれ量（0〜1で画面高さ比）
     * @param {number} [durSec=0.22] 戻るまでの秒数
     */
    triggerRoll(amp = 0.25, durSec = 0.22) {
        this._rollAmp = Math.min(1, Math.max(0, amp));
        this._rollDur = Math.max(0.05, durSec);
        this._rollT = 0;
    }

    /** 毎フレーム呼ぶ（時間・進行中の乱れを進める） */
    update(deltaTime, elapsed) {
        const u = this.material.uniforms;
        u.uTime.value = elapsed;

        // トラッキング帯：uv.y 1.15→-0.15 へ動かす。
        // uv.y は 1 が画面上端なので、見た目は「上から下へ流れる」
        if (this._trackRunT >= 0) {
            this._trackRunT += deltaTime;
            const t = this._trackRunT / this._trackRunDur;
            if (t >= 1) {
                this._trackRunT = -1;
                u.uTracking.value = 0;
                u.uTrackingY.value = 1.2;
            } else {
                u.uTrackingY.value = 1.15 - t * 1.3;
                // 出入りでフェード（帯が唐突に消えない）
                u.uTracking.value = this._trackRunAmp * Math.sin(Math.PI * Math.min(1, t * 1.15));
            }
        }

        // 垂直ロール：ガクッとずれて素早く戻る
        if (this._rollT >= 0) {
            this._rollT += deltaTime;
            const t = this._rollT / this._rollDur;
            if (t >= 1) {
                this._rollT = -1;
                u.uRoll.value = 0;
            } else {
                u.uRoll.value = this._rollAmp * (1 - t) * (1 - t);
            }
        }
    }

    setSize(width, height) {
        // 実サイズは render() で readBuffer に合わせ直すので、ここは無効化のみでよい
        this.prevRT.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
        this._prevValid = false;
    }

    render(renderer, writeBuffer, readBuffer /* , deltaTime, maskActive */) {
        const u = this.material.uniforms;
        // resolution は「実際の描画バッファ」のサイズ。CSSピクセルを渡すと Retina 等で
        // px 換算が2倍ズレて、色にじみ量が意図の倍になる
        renderer.getDrawingBufferSize(this._dbSize);
        u.resolution.value.copy(this._dbSize);

        // 残像RTは readBuffer の ghostScale 倍で持つ（ボケた効果なので低解像度で十分＝軽い）
        const ghostOn = u.uGhost.value > 0.0001 && u.uAmount.value > 0.0001;
        if (ghostOn) {
            const s = Math.min(1, Math.max(0.125, this.ghostScale));
            const rw = Math.max(1, Math.round(readBuffer.width * s));
            const rh = Math.max(1, Math.round(readBuffer.height * s));
            if (this.prevRT.width !== rw || this.prevRT.height !== rh) {
                this.prevRT.setSize(rw, rh);
                this._prevValid = false;
            }
        }

        u.tDiffuse.value = readBuffer.texture;
        // 初回は前フレームが無いので入力自身を渡す（残像だけ1フレーム効かない）
        u.tPrev.value = this._prevValid ? this.prevRT.texture : readBuffer.texture;
        u.uFrame.value = this._frame;
        this._frame = (this._frame + 1) % 2;

        if (this.renderToScreen) {
            renderer.setRenderTarget(null);
            this.fsQuad.render(renderer);
        } else {
            renderer.setRenderTarget(writeBuffer);
            if (this.clear) renderer.clear();
            this.fsQuad.render(renderer);
        }

        // 次フレームの残像ソースとして、今回の「入力」を prevRT へ保存する。
        // 出力を保存すると残像が指数的に焼き付いてスミアになるので、必ず入力側を持つ。
        // readBuffer は次フレームで上書きされるため、明示コピーが必要。
        // 残像OFF時はこのコピーパスを丸ごと省く（フルスクリーンパス1枚ぶん節約）
        if (ghostOn) this._storePrev(renderer, readBuffer);
        else this._prevValid = false;
    }

    /** readBuffer の内容を prevRT へ保存（残像ソース） */
    _storePrev(renderer, readBuffer) {
        if (!this._copyQuad) {
            this._copyMat = new ShaderMaterial({
                uniforms: { tDiffuse: { value: null } },
                vertexShader: VHSShader.vertexShader,
                fragmentShader: /* glsl */ `
                    uniform sampler2D tDiffuse;
                    varying vec2 vUv;
                    void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
                `,
                blending: NoBlending,
                depthTest: false,
                depthWrite: false
            });
            this._copyQuad = new FullScreenQuad(this._copyMat);
        }
        this._copyMat.uniforms.tDiffuse.value = readBuffer.texture;
        const state = renderer.getRenderTarget();
        renderer.setRenderTarget(this.prevRT);
        this._copyQuad.render(renderer);
        renderer.setRenderTarget(state);
        this._prevValid = true;
    }

    dispose() {
        this.material?.dispose();
        this.fsQuad?.dispose();
        this._copyMat?.dispose();
        this._copyQuad?.dispose();
        this.prevRT?.dispose();
    }
}
