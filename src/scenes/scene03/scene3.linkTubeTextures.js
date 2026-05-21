import * as THREE from 'three';

function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * ゴムチューブ風：すり減り・微細ゴミ・擦り傷のプロシージャル normal + roughness（＋任意 bump）
 * @param {number} [res=256]
 * @param {number} [seed=9043]
 */
export function generateLinkTubeWornTextures(res = 256, seed = 9043) {
    const rnd = mulberry32(seed);
    const g = 48;
    const grid = new Float32Array(g * g);
    for (let i = 0; i < g * g; i++) grid[i] = rnd();

    function sampleGrid(u, v) {
        u = ((u % 1) + 1) % 1;
        v = ((v % 1) + 1) % 1;
        const gx = u * (g - 1);
        const gy = v * (g - 1);
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const x1 = Math.min(x0 + 1, g - 1);
        const y1 = Math.min(y0 + 1, g - 1);
        const tx = gx - x0;
        const ty = gy - y0;
        const s = (i, j) => grid[j * g + i];
        const a = s(x0, y0);
        const b = s(x1, y0);
        const c = s(x0, y1);
        const d = s(x1, y1);
        const ux = tx * tx * (3 - 2 * tx);
        const uy = ty * ty * (3 - 2 * ty);
        return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    }

    const h = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            const u = x / res;
            const v = y / res;
            let z = 0;
            let amp = 0.55;
            let freq = 1;
            for (let o = 0; o < 5; o++) {
                z += sampleGrid(u * freq, v * freq) * amp;
                freq *= 2.07;
                amp *= 0.48;
            }
            h[y * res + x] = z;
        }
    }

    let mn = h[0];
    let mx = h[0];
    for (let i = 1; i < h.length; i++) {
        mn = Math.min(mn, h[i]);
        mx = Math.max(mx, h[i]);
    }
    const inv = mx - mn > 1e-6 ? 1 / (mx - mn) : 1;
    for (let i = 0; i < h.length; i++) h[i] = (h[i] - mn) * inv;

    for (let s = 0; s < 140; s++) {
        let x = rnd() * res;
        let y = rnd() * res;
        const len = 12 + rnd() * 38;
        const wid = 0.35 + rnd() * 1.1;
        const dig = 0.04 + rnd() * 0.09;
        let ang = rnd() * Math.PI * 2;
        for (let k = 0; k < len; k++) {
            const xi = (x | 0) % res;
            const yi = (y | 0) % res;
            if (xi >= 0 && yi >= 0 && xi < res && yi < res) {
                const idx = yi * res + xi;
                h[idx] = THREE.MathUtils.clamp(h[idx] - dig, 0, 1);
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oy = -1; oy <= 1; oy++) {
                        const xx = xi + ox;
                        const yy = yi + oy;
                        if (xx >= 0 && yy >= 0 && xx < res && yy < res) {
                            const ii = yy * res + xx;
                            const w = 1 - (Math.abs(ox) + Math.abs(oy)) * 0.28;
                            h[ii] = THREE.MathUtils.clamp(h[ii] - dig * wid * 0.35 * w, 0, 1);
                        }
                    }
                }
            }
            ang += (rnd() - 0.5) * 0.45;
            x += Math.cos(ang) * 0.9;
            y += Math.sin(ang) * 0.9;
        }
    }

    const blur = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            let s = 0;
            let c = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = THREE.MathUtils.clamp(x + dx, 0, res - 1);
                    const yy = THREE.MathUtils.clamp(y + dy, 0, res - 1);
                    s += h[yy * res + xx];
                    c++;
                }
            }
            blur[y * res + x] = s / c;
        }
    }
    for (let i = 0; i < h.length; i++) h[i] = blur[i];

    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = res;
    normalCanvas.height = res;
    const nctx = normalCanvas.getContext('2d');
    const nImg = nctx.createImageData(res, res);
    const nd = nImg.data;
    const strength = 3.2;
    for (let y = 1; y < res - 1; y++) {
        for (let x = 1; x < res - 1; x++) {
            const i = y * res + x;
            const dx = (h[i + 1] - h[i - 1]) * strength;
            const dy = (h[i + res] - h[i - res]) * strength;
            let nx = -dx;
            let ny = -dy;
            let nz = 1;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const p = i * 4;
            nd[p] = Math.floor(nx * 127 + 128);
            nd[p + 1] = Math.floor(ny * 127 + 128);
            nd[p + 2] = Math.floor(nz * 127 + 128);
            nd[p + 3] = 255;
        }
    }
    nctx.putImageData(nImg, 0, 0);

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = res;
    roughCanvas.height = res;
    const rctx = roughCanvas.getContext('2d');
    const rImg = rctx.createImageData(res, res);
    const rd = rImg.data;
    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            const v = h[y * res + x];
            const r = THREE.MathUtils.clamp(0.42 + v * 0.52 + (rnd() - 0.5) * 0.06, 0, 1);
            const b = Math.floor(r * 255);
            const p = (y * res + x) * 4;
            rd[p] = b;
            rd[p + 1] = b;
            rd[p + 2] = b;
            rd[p + 3] = 255;
        }
    }
    rctx.putImageData(rImg, 0, 0);

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = res;
    bumpCanvas.height = res;
    const bctx = bumpCanvas.getContext('2d');
    const bImg = bctx.createImageData(res, res);
    const bd = bImg.data;
    for (let i = 0; i < res * res; i++) {
        const v = Math.floor(h[i] * 255);
        const p = i * 4;
        bd[p] = v;
        bd[p + 1] = v;
        bd[p + 2] = v;
        bd[p + 3] = 255;
    }
    bctx.putImageData(bImg, 0, 0);

    const repeatU = 3.2;
    const repeatV = 2.4;

    const normalMap = new THREE.CanvasTexture(normalCanvas);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(repeatU, repeatV);
    normalMap.colorSpace = THREE.NoColorSpace;
    normalMap.needsUpdate = true;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.repeat.set(repeatU, repeatV);
    roughnessMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.needsUpdate = true;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(repeatU, repeatV);
    bumpMap.colorSpace = THREE.LinearSRGBColorSpace;
    bumpMap.needsUpdate = true;

    function dispose() {
        normalMap.dispose();
        roughnessMap.dispose();
        bumpMap.dispose();
    }

    return { normalMap, roughnessMap, bumpMap, dispose };
}
