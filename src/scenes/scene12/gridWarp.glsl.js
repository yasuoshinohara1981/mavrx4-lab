/**
 * scene12 GPU grid warp — 頂点シェーダに注入する GLSL チャンク集
 *
 * 目的:
 *   Scene12.js の CPU 版 `_gridWarp` / `_getMorphOffset` / `_pulseZ` / `_implodeXYZ`
 *   を頂点シェーダへ 1:1 移植する。CPU 側は「pulse/morph の *パラメータ* を
 *   uniform に詰めるだけ」になり、パーティクル数に対して定数コストになる。
 *
 * ⚠️ 数式は Scene12.js の JS 実装を「正」とするミラー。JS を変えたら必ずこちらも合わせること。
 *    （ライン/波形/マーカーは CPU の _gridWarp を使い続けるため、式がズレると描画が割れる）
 *
 * uniform 契約（Scene12 側 _syncWarpUniforms が毎フレーム更新）:
 *   uWarpAmp            : float  … _warpAmp()
 *   uTime              : float  … this.time
 *   uBreath            : float  … this.idleBreathAmp
 *   uGridCenterY       : float  … this.gridCenterY
 *   uGridCenterZ       : float  … this.gridCenterZ
 *   uGridFieldW        : float  … this.gridFieldW
 *   uGridFieldH        : float  … this.gridFieldH
 *   uMorphRadius       : float  … this.morphRadius
 *   uMorphShapeA       : int    … morphShapes[morphCurrentIdx] を数値化
 *   uMorphShapeB       : int    … morphShapes[morphNextIdx]    を数値化
 *   uMorphT            : float  … smoothstep 前の morphT（GLSL 内で smooth 化）
 *   uNoiseScale        : float  … _particleNoiseScale（スケール用。位置には使わない）
 *   uWarpCount         : int    … 有効な warpPulse 数
 *   uWarpPulses[N]     : vec4   … (x, y, dir*amp, radius)  … env は life から別途
 *   uWarpEnv[N]        : float  … (life/maxLife)^2
 *   uImpCount          : int    … 有効な implodePulse 数
 *   uImpPulses[N]      : vec4   … (x, y, amp, radius)
 *   uImpEnv[N]         : float  … (life/maxLife)^2
 *
 * 形状ID: FLAT=0, SPHERE=1, CYLINDER=2, WAVE=3, TORUS=4
 */

export const GRID_WARP_MAX_WARP_PULSES = 16;   // Scene12.warpPulseMax
export const GRID_WARP_MAX_IMP_PULSES = 8;     // Scene12.implodePulseMax

/** 形状名 → GLSL 用ID（JS 側と共有） */
export const MORPH_SHAPE_ID = {
    FLAT: 0,
    SPHERE: 1,
    CYLINDER: 2,
    WAVE: 3,
    TORUS: 4,
};

/**
 * 頂点シェーダ冒頭に prepend する宣言＋関数群。
 * `#define` でプリプロセッサに配列長を焼き込む。
 */
export const gridWarpVertexHead = `
#define GW_MAX_WARP ${GRID_WARP_MAX_WARP_PULSES}
#define GW_MAX_IMP  ${GRID_WARP_MAX_IMP_PULSES}

// three の common chunk より前に注入されるため PI を自前定義（既定義なら無害な再定義回避）
#ifndef PI
#define PI 3.141592653589793
#endif

attribute vec2 aBaseXY;      // グリッド基準座標（gridBaseX, gridBaseY）
attribute float aBoost;      // track8 スケールブースト（0=なし）
attribute vec3 aRotSeed;     // 初期回転角（x,y,z ラジアン）
attribute vec3 aAngVel;      // 基礎角速度（x,y,z ラジアン/秒 相当）
attribute float aIndexF;     // インスタンス連番（pulse反応の位相ばらつき用）

uniform float uWarpAmp;
uniform float uTime;
uniform float uBreath;
uniform float uGridCenterY;
uniform float uGridCenterZ;
uniform float uGridFieldW;
uniform float uGridFieldH;
uniform float uMorphRadius;
uniform int   uMorphShapeA;
uniform int   uMorphShapeB;
uniform float uMorphT;
uniform float uNoiseScale;

uniform int  uWarpCount;
uniform vec4 uWarpPulses[GW_MAX_WARP];  // (x, y, dir*amp, radius)
uniform float uWarpEnv[GW_MAX_WARP];    // (life/maxLife)^2

uniform int  uImpCount;
uniform vec4 uImpPulses[GW_MAX_IMP];    // (x, y, amp, radius)
uniform float uImpEnv[GW_MAX_IMP];      // (life/maxLife)^2

varying float vWarpDisp;  // Z 変位量（frag でヒートマップに使える。今は未使用でも保持）

// ---- _morphOffset の GLSL 版（1形状ぶん） ----
// 戻り: dx, dy, dz（基準座標 bx,by からのオフセット）
vec3 gwMorphOffset(int shape, float nx, float ny, float bx, float by) {
    float R = uMorphRadius;
    if (shape == ${MORPH_SHAPE_ID.SPHERE}) {
        float theta = nx * PI;
        float phi = (ny * 0.5 + 0.5) * PI;
        return vec3(
            R * sin(phi) * sin(theta) - bx,
            R * cos(phi) - (by - uGridCenterY),
            R * sin(phi) * cos(theta) - R * 0.15
        );
    } else if (shape == ${MORPH_SHAPE_ID.CYLINDER}) {
        float theta2 = nx * PI;
        return vec3(
            R * sin(theta2) - bx,
            0.0,
            R * cos(theta2) - R * 0.15
        );
    } else if (shape == ${MORPH_SHAPE_ID.WAVE}) {
        float wz = sin(nx * PI * 2.0) * R * 0.5
                 + sin(ny * PI * 2.0) * R * 0.3;
        return vec3(0.0, 0.0, wz);
    } else if (shape == ${MORPH_SHAPE_ID.TORUS}) {
        float R2 = R * 0.38;
        float theta3 = nx * PI;
        float phi3 = ny * PI * 2.0;
        float rx = (R + R2 * cos(phi3)) * sin(theta3) - bx;
        float ry = R2 * sin(phi3) - (by - uGridCenterY);
        float rz = (R + R2 * cos(phi3)) * cos(theta3) - R * 0.15;
        return vec3(rx, ry, rz);
    }
    // FLAT
    return vec3(0.0);
}

// ---- _getMorphOffset の GLSL 版（current/next を smoothstep 補間） ----
vec3 gwGetMorphOffset(float bx, float by) {
    float nx = bx / (uGridFieldW * 0.5);
    float ny = (by - uGridCenterY) / (uGridFieldH * 0.5);
    vec3 a = gwMorphOffset(uMorphShapeA, nx, ny, bx, by);
    vec3 b = gwMorphOffset(uMorphShapeB, nx, ny, bx, by);
    float t = uMorphT * uMorphT * (3.0 - 2.0 * uMorphT);
    return mix(a, b, t);
}

// ---- _pulseZ の GLSL 版 ----
float gwPulseZ(float bx, float by) {
    float z = 0.0;
    for (int i = 0; i < GW_MAX_WARP; i++) {
        if (i >= uWarpCount) break;
        vec4 p = uWarpPulses[i];      // (x, y, dir*amp, radius)
        float dx = bx - p.x;
        float dy = by - p.y;
        float d2 = dx * dx + dy * dy;
        float radius = p.w;
        float falloff = exp(-d2 / (radius * radius));
        if (falloff < 0.002) continue;
        z += p.z * falloff * uWarpEnv[i];  // p.z = dir*amp
    }
    return z;
}

// ---- _implodeXYZ の GLSL 版（out を加算で更新） ----
void gwImplodeXYZ(float bx, float by, inout vec3 outPos) {
    for (int i = 0; i < GW_MAX_IMP; i++) {
        if (i >= uImpCount) break;
        vec4 p = uImpPulses[i];       // (x, y, amp, radius)
        float dx = bx - p.x;
        float dy = by - p.y;
        float d2 = dx * dx + dy * dy;
        float radius = p.w;
        float falloff = exp(-d2 / (radius * radius));
        if (falloff < 0.002) continue;
        float str = p.z * falloff * uImpEnv[i];  // p.z = amp
        float dist = max(sqrt(d2), 1.0);
        outPos.x -= (dx / dist) * str * 0.5;
        outPos.y -= (dy / dist) * str * 0.5;
        outPos.z -= str;
    }
}

// ---- _gridWarp の GLSL 版（垂直壁版）。戻り: ワールド変位後座標 ----
vec3 gwGridWarp(float bx, float by) {
    float breath = uBreath;
    vec3 m = gwGetMorphOffset(bx, by);
    vec3 o;
    o.x = bx + m.x + sin(bx * 0.0009 + by * 0.0007 + uTime * 0.5) * breath;
    o.y = by + m.y + cos(by * 0.0009 - bx * 0.0007 + uTime * 0.6) * breath;
    float idleZ = sin(bx * 0.0011 - by * 0.0009 + uTime * 0.7) * breath;
    o.z = uGridCenterZ + idleZ + gwPulseZ(bx, by) + m.z;
    gwImplodeXYZ(bx, by, o);
    return o;
}

// ---- 回転乱れ用: このキューブが受ける pulse/implode の実効Z変位（morph除外） ----
// CPU版 _pulseDispForRotation の GLSL ミラー。回転角速度ブーストの駆動に使う。
float gwPulseDispForRotation(float bx, float by) {
    float z = gwPulseZ(bx, by);
    for (int i = 0; i < GW_MAX_IMP; i++) {
        if (i >= uImpCount) break;
        vec4 p = uImpPulses[i];
        float dx = bx - p.x, dy = by - p.y;
        float d2 = dx * dx + dy * dy;
        float falloff = exp(-d2 / (p.w * p.w));
        if (falloff < 0.002) continue;
        z -= p.z * falloff * uImpEnv[i];
    }
    return z;
}

// 軸回りの回転行列（Rodrigues 不要、Euler XYZ を順に合成）
mat3 gwRotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
mat3 gwRotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
mat3 gwRotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,-s,0., s,c,0., 0.,0.,1.); }

// ---- 各キューブの回転行列を time + pulse/boost から決定論的に生成 ----
// 積分状態を持たず「初期角 + 角速度*time + pulse/boostによる追加回転」で近似。
// CPU版の angularVelocity 加速（pulse: cos(i*2.399), boost: cos(i*1.618)）を time 依存項として再現。
mat3 gwRotationMatrix(float bx, float by) {
    float t = uTime;
    // 基礎自転: 初期角 + 角速度*t（CPU版 updateRotation の dt*60 スケールに合わせ *60）
    vec3 ang = aRotSeed + aAngVel * t * 60.0;

    // pulse反応: 効いてる間だけ角速度が上乗せ → 追加回転量は「強度 * t」の一次で近似
    float pulseMax = uWarpAmp; // スケール基準（CPUの pulseAmpMax*2 とは厳密一致しないが視覚的近似）
    float disp = abs(gwPulseDispForRotation(bx, by));
    float impulse = disp / max(1.0, pulseMax * 8.0);
    float ia = mod(aIndexF * 2.399, 6.28318);
    ang.x += cos(ia) * impulse * t * 1.4;
    ang.y += sin(ia) * impulse * t * 1.4;
    ang.z += cos(ia + 1.1) * impulse * t * 0.7;

    // boost反応（track8）
    float ba = mod(aIndexF * 1.618, 6.28318);
    ang.x += cos(ba) * aBoost * t * 2.0;
    ang.y += sin(ba) * aBoost * t * 2.0;

    return gwRotX(ang.x) * gwRotY(ang.y) * gwRotZ(ang.z);
}
`;

/**
 * 完全GPU構成（位置・回転・スケール すべてシェーダ）:
 *   - 位置(warp) : gwGridWarp
 *   - 回転       : gwRotationMatrix（time + pulse/boost から決定論的に生成）
 *   - スケール    : aRadius * noiseScale * (1+boost)
 *
 * instanceMatrix は使わない（恒等）。頂点も法線も gwRotationMatrix で回す。
 * gwRotMat は begin_vertex で作り、beginnormal_vertex 置換で法線にも使う（同 main スコープ）。
 */
/**
 * beginnormal_vertex の置換: ここで回転行列 gwRotMat を生成し（chunk順で最初に来るため）、
 * 法線を回す。gwRotMat は同 main スコープなので後段 begin_vertex でも参照できる。
 * three r160 の元チャンクは objectNormal = vec3(normal); （+ morph/skin 分岐）。
 * キューブに morph/skin は無いので単純置換で足りる。
 */
export const gridWarpBeginNormal = `
    mat3 gwRotMat = gwRotationMatrix(aBaseXY.x, aBaseXY.y);
    vec3 objectNormal = gwRotMat * vec3( normal );
#ifdef USE_TANGENT
    vec3 objectTangent = gwRotMat * vec3( tangent.xyz );
#endif
`;

export const gridWarpBeginVertex = `
    vec3 gwPos = gwGridWarp(aBaseXY.x, aBaseXY.y);
    vWarpDisp = gwPos.z - uGridCenterZ;

    float gwScale = uNoiseScale * (1.0 + aBoost);

    // ローカル: スケール → 回転（gwRotMat は beginnormal_vertex 段で生成済み）
    vec3 transformed = gwRotMat * (position * (aRadius * gwScale));
`;

/**
 * project_vertex の置換。instanceMatrix は使わず、回転済み transformed を gwPos で平行移動。
 */
export const gridWarpProjectVertex = `
    vec4 mvPosition = vec4( transformed, 1.0 );

    mvPosition.xyz += gwPos;                        // warp 後のワールド位置へ平行移動

    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;
`;
