import * as THREE from 'three';

/**
 * Scene1 共有ユーティリティ・シェーダー補助
 */

/**
 * 寿命終盤：フェード区間で不透明度 1→0（線形）
 */
export function fadeOpacity01(elapsedMs, lifeMs, fadeOutMs) {
    const fade = Math.min(fadeOutMs, lifeMs * 0.35);
    const t0 = Math.max(0, lifeMs - fade);
    if (elapsedMs <= t0) return 1;
    if (elapsedMs >= lifeMs) return 0;
    const t = (elapsedMs - t0) / (lifeMs - t0);
    const eased = t * t * (3 - 2 * t);
    return 1 - eased;
}

/**
 * スポーン時のグロウスケール計算
 */
export function growScale01(elapsedMs, growMs) {
    const g = Math.max(1, Number(growMs) || 1);
    const t = THREE.MathUtils.clamp(elapsedMs / g, 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * デュレーションに基づくグロウ時間の計算
 */
export function growInMsFromDuration(durationMs, baseGrowMs) {
    const d = Math.max(1, Number(durationMs) || 180);
    const k = THREE.MathUtils.clamp(d / 700, 0.35, 2.1);
    return baseGrowMs * k;
}

/**
 * MIDI ベロシティの正規化
 */
export function normalizeMidiVelocity(v) {
    if (v === undefined || v === null) return 127;
    const n = Number(v);
    if (!Number.isFinite(n)) return 127;
    if (n >= 0 && n <= 1) return Math.round(n * 127);
    return THREE.MathUtils.clamp(Math.round(n), 0, 127);
}

/**
 * ベロシティから金属片の色を計算
 */
export function velocityToMetalShardColor(velocity, target, shardMetalDark, shardMetalMid, shardMetalBright) {
    const t = THREE.MathUtils.clamp(velocity / 127, 0, 1);
    if (t < 0.5) target.copy(shardMetalDark).lerp(shardMetalMid, t / 0.5);
    else target.copy(shardMetalMid).lerp(shardMetalBright, (t - 0.5) / 0.5);
    
    // バリエーション用のノイズは呼び出し側で付与するか、ここで簡易的に付与
    const n = (Math.random() - 0.5) * 0.07;
    target.r = THREE.MathUtils.clamp(target.r + n, 0.08, 1);
    target.g = THREE.MathUtils.clamp(target.g + n, 0.08, 1);
    target.b = THREE.MathUtils.clamp(target.b + n, 0.08, 1);
}

/**
 * ヒートマップ色の設定
 */
export function setHeatmapColor01(t, i3, out) {
    const x = THREE.MathUtils.clamp(t, 0, 1);
    let r, g, b;
    if (x < 0.25) {
        const u = x / 0.25;
        r = 0.1; g = u; b = 1.0;
    } else if (x < 0.5) {
        const u = (x - 0.25) / 0.25;
        r = 0.1; g = 1.0; b = 1.0 - u;
    } else if (x < 0.75) {
        const u = (x - 0.5) / 0.25;
        r = u; g = 1.0; b = 0.0;
    } else {
        const u = (x - 0.75) / 0.25;
        r = 1.0; g = 1.0 - u; b = 0.0;
    }
    out[i3] = r;
    out[i3 + 1] = g;
    out[i3 + 2] = b;
}

/**
 * InstancedMesh 用：インスタンスごとの不透明度属性の付与
 */
export function attachInstanceOpacityAttribute(geometry, count) {
    const a = new Float32Array(count);
    a.fill(0);
    const attr = new THREE.InstancedBufferAttribute(a, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceOpacity', attr);
    return attr;
}

/**
 * インスタンス不透明度シェーダーの適用
 */
export function applyInstanceOpacityShader(material) {
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
 * 赤シリンダ専用シェーダーの適用
 */
export function applyRedCylinderShader(material) {
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
