import * as THREE from 'three';

/**
 * 高さグレーを Sobel で接線空間ノーマル（RGB）に変換
 */
function _heightCanvasToNormalCanvas(heightCanvas, size, strength) {
    const ctx = heightCanvas.getContext('2d');
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    const hAt = (x, y) => {
        const xi = Math.max(0, Math.min(size - 1, x));
        const yi = Math.max(0, Math.min(size - 1, y));
        return d[(yi * size + xi) * 4] / 255;
    };
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const octx = out.getContext('2d');
    const outImg = octx.createImageData(size, size);
    const od = outImg.data;
    const s = strength;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 0.5 * s;
            const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * 0.5 * s;
            let nx = -dx;
            let ny = -dy;
            let nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            const i = (y * size + x) * 4;
            od[i] = nx * 0.5 + 0.5;
            od[i + 1] = ny * 0.5 + 0.5;
            od[i + 2] = nz * 0.5 + 0.5;
            od[i + 3] = 255;
        }
    }
    octx.putImageData(outImg, 0, 0);
    return out;
}

/**
 * 化粧品CM風スカイ：縦グラデ＋微細ノイズ（albedo）、高さから normal / roughness。
 * 写真は使わず Canvas のみ。
 *
 * @param {number} size
 * @param {{ preset?: 'pastel' | 'darkStudio' }} [options]
 * @returns {{ map: THREE.CanvasTexture, normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture }}
 */
export function createCosmeticSkyTextureSet(size = 2048, options = {}) {
    const preset = options.preset ?? 'pastel';
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const cctx = colorCanvas.getContext('2d');

    const grad = cctx.createLinearGradient(0, 0, 0, size);
    if (preset === 'darkStudio') {
        // 真っ黒にせず、ブロンズ〜燻し銅の縦グラデ（金属のベース色として読める明度）
        grad.addColorStop(0, '#2a221c');
        grad.addColorStop(0.38, '#3d3229');
        grad.addColorStop(0.72, '#342a22');
        grad.addColorStop(1, '#1e1814');
    } else {
        grad.addColorStop(0, '#eef2ff');
        grad.addColorStop(0.45, '#faf9fc');
        grad.addColorStop(1, '#fff2f6');
    }
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, size, size);

    const hCanvas = document.createElement('canvas');
    hCanvas.width = size;
    hCanvas.height = size;
    const hCtx = hCanvas.getContext('2d');
    hCtx.fillStyle = '#b8b8b8';
    hCtx.fillRect(0, 0, size, size);

    const speckle = (ctx, count, gmin, gmax, smin, smax, alphaScale) => {
        for (let i = 0; i < count; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const s = Math.random() * (smax - smin) + smin;
            const g = Math.floor(Math.random() * (gmax - gmin) + gmin);
            ctx.fillStyle = `rgba(${g}, ${g}, ${g}, ${alphaScale})`;
            ctx.fillRect(x, y, s, s);
        }
    };

    if (preset === 'darkStudio') {
        speckle(cctx, 9000, 45, 95, 0.35, 2.6, 0.1);
        speckle(cctx, 5500, 70, 130, 0.9, 5.2, 0.08);
        for (let i = 0; i < 7000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const s = Math.random() * 2.2 + 0.35;
            const r = Math.floor(55 + Math.random() * 75);
            const g = Math.floor(38 + Math.random() * 58);
            const b = Math.floor(22 + Math.random() * 42);
            cctx.fillStyle = `rgba(${r},${g},${b},${0.04 + Math.random() * 0.06})`;
            cctx.fillRect(x, y, s, s);
        }
    } else {
        speckle(cctx, 15000, 175, 235, 0.35, 2.4, 0.07);
        speckle(cctx, 9000, 145, 210, 1.0, 4.8, 0.065);
    }
    speckle(hCtx, 14000, 70, 185, 0.4, 2.4, 0.85);
    speckle(hCtx, 5000, 90, 160, 2, 9, 0.9);

    for (let i = 0; i < 28; i++) {
        const y = Math.random() * size;
        const w = Math.random() * 1.2 + 0.25;
        const len = size * (0.4 + Math.random() * 0.55);
        const x0 = Math.random() * (size - len);
        const g = Math.floor(Math.random() * 40 + 95);
        const lg = hCtx.createLinearGradient(x0, y, x0 + len, y);
        lg.addColorStop(0, `rgba(${g},${g},${g},0)`);
        lg.addColorStop(0.5, `rgba(${g - 8},${g - 8},${g - 8},0.22)`);
        lg.addColorStop(1, `rgba(${g},${g},${g},0)`);
        hCtx.fillStyle = lg;
        hCtx.fillRect(x0, y - w * 2, len, w * 4);
    }

    for (let i = 0; i < 14; i++) {
        const cx = Math.random() * size;
        const cy = Math.random() * size;
        const r = Math.random() * size * 0.08 + size * 0.015;
        const g0 = Math.floor(Math.random() * 35 + 80);
        const rg = hCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, `rgba(${g0},${g0},${g0},0.35)`);
        rg.addColorStop(1, 'rgba(180,180,180,0)');
        hCtx.fillStyle = rg;
        hCtx.beginPath();
        hCtx.arc(cx, cy, r, 0, Math.PI * 2);
        hCtx.fill();
    }

    if (preset === 'darkStudio') {
        speckle(cctx, 4500, 55, 105, 0.7, 3.4, 0.06);
        for (let i = 0; i < 3500; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const s = Math.random() * 3.8 + 0.8;
            const r = Math.floor(120 + Math.random() * 80);
            const g = Math.floor(85 + Math.random() * 55);
            const b = Math.floor(48 + Math.random() * 40);
            cctx.fillStyle = `rgba(${r},${g},${b},${0.03 + Math.random() * 0.05})`;
            cctx.fillRect(x, y, s, s);
        }
    } else {
        speckle(cctx, 4000, 210, 248, 0.8, 3.2, 0.04);
    }

    const normalCanvas = _heightCanvasToNormalCanvas(hCanvas, size, 7.2);

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rctx = roughCanvas.getContext('2d');
    const rimg = hCtx.getImageData(0, 0, size, size);
    const rd = rimg.data;
    const rout = rctx.createImageData(size, size);
    const od = rout.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const h = rd[(y * size + x) * 4] / 255;
            const g = 0.42 + 0.38 * (1.0 - Math.pow(Math.max(0, 1 - h), 0.9));
            const v = Math.floor(THREE.MathUtils.clamp(g, 0.12, 1) * 255);
            const i = (y * size + x) * 4;
            od[i] = v;
            od[i + 1] = v;
            od[i + 2] = v;
            od[i + 3] = 255;
        }
    }
    rctx.putImageData(rout, 0, 0);

    const map = new THREE.CanvasTexture(colorCanvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;

    const normalMap = new THREE.CanvasTexture(normalCanvas);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.colorSpace = THREE.LinearSRGBColorSpace;
    normalMap.anisotropy = 8;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.colorSpace = THREE.LinearSRGBColorSpace;
    roughnessMap.anisotropy = 8;

    return { map, normalMap, roughnessMap };
}
