import * as THREE from 'three';

/**
 * Scene2 共有ユーティリティ・シェーダー補助
 */

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
 * チャコールグレー〜黒寄りのランダム（岩・鉱物っぽい微妙な色相ブレ）
 */
export function setRandomRockCharcoalColor(out) {
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

/**
 * ブルーグレー〜無彩グレー〜黒付近のランダム（Box パーティクル用）
 */
export function setRandomBlueGrayParticleColor(out) {
    const roll = Math.random();
    if (roll < 0.4) {
        const h = 0.54 + Math.random() * 0.11;
        const s = 0.05 + Math.random() * 0.16;
        const l = 0.07 + Math.random() * 0.3;
        out.setHSL(h, s, l);
    } else if (roll < 0.75) {
        const l = 0.05 + Math.random() * 0.34;
        out.setHSL(0, 0, l);
    } else {
        const h = 0.52 + Math.random() * 0.14;
        const s = Math.random() * 0.07;
        const l = 0.012 + Math.random() * 0.09;
        out.setHSL(h, s, l);
    }
    out.offsetHSL((Math.random() - 0.5) * 0.018, (Math.random() - 0.5) * 0.035, (Math.random() - 0.5) * 0.04);
    out.r += (Math.random() - 0.5) * 0.028;
    out.g += (Math.random() - 0.5) * 0.028;
    out.b += (Math.random() - 0.5) * 0.032;
    out.r = THREE.MathUtils.clamp(out.r, 0.01, 0.48);
    out.g = THREE.MathUtils.clamp(out.g, 0.01, 0.46);
    out.b = THREE.MathUtils.clamp(out.b, 0.012, 0.52);
}

/**
 * エメラルド／ベリル系のランダム（明るめ黄緑〜ジュエリー緑）
 */
export function setRandomEmeraldColor(out) {
    const h = 0.36 + Math.random() * 0.14;
    const s = 0.5 + Math.random() * 0.35;
    const l = 0.42 + Math.random() * 0.28;
    out.setHSL(h, s, l);
    out.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06);
    out.r += (Math.random() - 0.5) * 0.04;
    out.g += (Math.random() - 0.5) * 0.05;
    out.b += (Math.random() - 0.5) * 0.04;
    out.r = THREE.MathUtils.clamp(out.r, 0.08, 0.62);
    out.g = THREE.MathUtils.clamp(out.g, 0.35, 0.98);
    out.b = THREE.MathUtils.clamp(out.b, 0.12, 0.72);
}

/**
 * 力の強さ t（0=弱 1=強）を青系→黄→赤のヒートマップにする。
 * HSL で直接指定（MeshPhysical の緑 map と掛け算しても暖色が潰れにくい）。
 */
export function setHeatmapColorFromUnit(t, out) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    const te = t * t * (3 - 2 * t);
    const h = 0.58 * (1 - te);
    const s = 0.78 + 0.18 * te;
    const l = 0.12 + 0.38 * te;
    out.setHSL(h, s, l);
}

/**
 * OSC の trackNumber が数値化できない／未設定のときは address から拾う
 */
export function parseTrackNumber(trackNumber, message) {
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
