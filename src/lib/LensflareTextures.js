/**
 * プロシージャルなレンズフレア用テクスチャを生成
 * 外部画像不要で軽量
 */

import * as THREE from 'three';

/**
 * 円形の放射状グラデーション（中心が白、外側が透明）
 * @param {number} size - キャンバスサイズ
 * @param {number} [softness=0.5] - エッジの柔らかさ (0〜1)
 * @returns {THREE.CanvasTexture}
 */
export function createFlareTexture(size = 128, softness = 0.5) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const r = cx * (1 - softness * 0.5);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

/**
 * 細長い楕円（ゴースト用）
 * @param {number} w - 幅
 * @param {number} h - 高さ
 * @returns {THREE.CanvasTexture}
 */
export function createGhostTexture(w = 64, h = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const cx = w / 2;
    const cy = h / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}
