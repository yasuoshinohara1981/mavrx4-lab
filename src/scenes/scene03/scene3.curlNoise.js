/**
 * 3D 値ノイズ＋有限差分カール（発散ゼロに近い流れ場）
 */

import * as THREE from 'three';

/** ノイズ場の時間進行倍率（大きいほど流れが速い） */
export const NOISE_ANIM_TIME_SCALE = 2.65;

function _hash01(ix, iy, iz) {
    let n = ix * 374761393 + iy * 668265263 + iz * 1274126177;
    n = (n ^ (n >>> 13)) * 1274126177;
    return (n >>> 0) / 4294967296;
}

function _noise3(px, py, pz) {
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const z0 = Math.floor(pz);
    const fx = px - x0;
    const fy = py - y0;
    const fz = pz - z0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);

    const n000 = _hash01(x0, y0, z0);
    const n100 = _hash01(x0 + 1, y0, z0);
    const n010 = _hash01(x0, y0 + 1, z0);
    const n110 = _hash01(x0 + 1, y0 + 1, z0);
    const n001 = _hash01(x0, y0, z0 + 1);
    const n101 = _hash01(x0 + 1, y0, z0 + 1);
    const n011 = _hash01(x0, y0 + 1, z0 + 1);
    const n111 = _hash01(x0 + 1, y0 + 1, z0 + 1);

    const nx00 = n000 + u * (n100 - n000);
    const nx10 = n010 + u * (n110 - n010);
    const nx01 = n001 + u * (n101 - n001);
    const nx11 = n011 + u * (n111 - n011);
    const nxy0 = nx00 + v * (nx10 - nx00);
    const nxy1 = nx01 + v * (nx11 - nx01);
    return nxy0 + w * (nxy1 - nxy0);
}

/** スカラー場（オクターブ少なめ FBM） */
export function fbm3(px, py, pz, time = 0) {
    const ta = time * NOISE_ANIM_TIME_SCALE;
    let amp = 0.5;
    let sum = 0;
    let x = px * 0.00042 + ta * 0.07;
    let y = py * 0.00042 + ta * 0.05;
    let z = pz * 0.00042 - ta * 0.03;
    let norm = 0;
    for (let i = 0; i < 3; i++) {
        sum += amp * _noise3(x, y, z);
        norm += amp;
        x = x * 2.11 + 17.1;
        y = y * 2.09 + 9.7;
        z = z * 2.13 + 3.3;
        amp *= 0.5;
    }
    return sum / Math.max(norm, 1e-6);
}

/**
 * ベクトル場 F = (n1,n2,n3) のカールを中央差分で計算（divergence-free 気流）
 * @param {THREE.Vector3} p ワールド座標
 * @param {number} time
 * @param {THREE.Vector3} out
 */
export function curlNoiseWorld(p, time, out) {
    const e = 28;
    const px = p.x;
    const py = p.y;
    const pz = p.z;

    const n1 = (x, y, z) => fbm3(x + 13.7, y - 41.2, z + 8.1, time);
    const n2 = (x, y, z) => fbm3(x - 29.1, y + 11.4, z - 19.3, time);
    const n3 = (x, y, z) => fbm3(x + 5.2, y + 22.8, z + 33.1, time);

    const dN3_dy = (n3(px, py + e, pz) - n3(px, py - e, pz)) / (2 * e);
    const dN2_dz = (n2(px, py, pz + e) - n2(px, py, pz - e)) / (2 * e);
    const dN1_dz = (n1(px, py, pz + e) - n1(px, py, pz - e)) / (2 * e);
    const dN3_dx = (n3(px + e, py, pz) - n3(px - e, py, pz)) / (2 * e);
    const dN2_dx = (n2(px + e, py, pz) - n2(px - e, py, pz)) / (2 * e);
    const dN1_dy = (n1(px, py + e, pz) - n1(px, py - e, pz)) / (2 * e);

    out.x = dN3_dy - dN2_dz;
    out.y = dN1_dz - dN3_dx;
    out.z = dN2_dx - dN1_dy;
    return out;
}
