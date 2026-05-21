/**
 * 研究室・ラボ風の偏りのある汚れ（シミ・カスレ・ノイズ）をキャンバスで生成。
 * map / bump（高さ）/ 法線 / 粗さ / AO を返す。
 */
import * as THREE from 'three';
import { drawGroutLines, drawRedCrossesAndLabels } from './studioBoxGrout.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 0–1 の擬似 FBM */
function fbm2(rnd, x, y, oct) {
    let v = 0;
    let a = 0.5;
    let xf = x;
    let yf = y;
    for (let o = 0; o < oct; o++) {
        const ix = Math.floor(xf);
        const iy = Math.floor(yf);
        const fx = xf - ix;
        const fy = yf - iy;
        const u = fx * fx * (3 - 2 * fx);
        const v2 = fy * fy * (3 - 2 * fy);
        const r = () => rnd();
        const n00 = rnd();
        const n10 = rnd();
        const n01 = rnd();
        const n11 = rnd();
        const nx0 = n00 * (1 - u) + n10 * u;
        const nx1 = n01 * (1 - u) + n11 * u;
        v += (nx0 * (1 - v2) + nx1 * v2) * a;
        xf *= 2.1;
        yf *= 2.07;
        a *= 0.52;
    }
    return v;
}

function heightToNormalCanvas(heightCanvas, strength = 3.2) {
    const w = heightCanvas.width;
    const h = heightCanvas.height;
    const sctx = heightCanvas.getContext('2d');
    const src = sctx.getImageData(0, 0, w, h);
    const d = src.data;
    const getH = (x, y) => {
        const xi = clamp(Math.floor(x), 0, w - 1);
        const yi = clamp(Math.floor(y), 0, h - 1);
        const i = (yi * w + xi) * 4;
        return d[i] / 255;
    };

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const img = octx.createImageData(w, h);
    const o = img.data;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4;
            const dx = (getH(x + 1, y) - getH(x - 1, y)) * strength;
            const dy = (getH(x, y + 1) - getH(x, y - 1)) * strength;
            let nx = -dx;
            let ny = -dy;
            let nz = 1;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;
            o[i] = (nx * 0.5 + 0.5) * 255;
            o[i + 1] = (ny * 0.5 + 0.5) * 255;
            o[i + 2] = (nz * 0.5 + 0.5) * 255;
            o[i + 3] = 255;
        }
    }
    octx.putImageData(img, 0, 0);
    return out;
}

/**
 * @param {number} size
 * @param {{ variant?: 'wall'|'floor'|'ceiling'|'sphere', seed?: number, stainContrast?: number, stainEdgeBias?: number, stainCornerBias?: boolean, stainBiasMul?: number }} [options]
 * @returns {{ map: THREE.CanvasTexture, bumpMap: THREE.CanvasTexture, normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture, aoMap: THREE.CanvasTexture, heightCanvas: HTMLCanvasElement }}
 */
export function generateLabGrungeTextures(size = 2048, options = {}) {
    const variant = options.variant ?? 'wall';
    const seed = options.seed ?? 42;
    const rnd = mulberry32(seed + variant.length * 997);
    const stainContrast = options.stainContrast ?? 1;
    const stainEdgeBias = options.stainEdgeBias ?? 0;
    const stainCornerBias = options.stainCornerBias === true;
    const stainBiasMul = options.stainBiasMul ?? 1;

    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = size;
    mapCanvas.height = size;
    const ctx = mapCanvas.getContext('2d');

    const hCanvas = document.createElement('canvas');
    hCanvas.width = size;
    hCanvas.height = size;
    const hCtx = hCanvas.getContext('2d');

    const rCanvas = document.createElement('canvas');
    rCanvas.width = size;
    rCanvas.height = size;
    const rCtx = rCanvas.getContext('2d');

    const aoCanvas = document.createElement('canvas');
    aoCanvas.width = size;
    aoCanvas.height = size;
    const aoCtx = aoCanvas.getContext('2d');

    const isSphere = variant === 'sphere';
    const baseR = variant === 'ceiling' ? 232 : isSphere ? 210 : 220;
    const baseG = variant === 'ceiling' ? 232 : isSphere ? 208 : 222;
    const baseB = variant === 'ceiling' ? 230 : isSphere ? 204 : 218;

    ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillRect(0, 0, size, size);
    hCtx.fillStyle = `rgb(200,200,200)`;
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = 'rgb(128,128,128)';
    rCtx.fillRect(0, 0, size, size);
    aoCtx.fillStyle = 'rgb(255,255,255)';
    aoCtx.fillRect(0, 0, size, size);

    let scale = 2.0;
    if (isSphere) scale = 2.05;
    else if (variant === 'floor') scale = 3.05;
    else if (variant === 'wall') scale = 2.92;
    else if (variant === 'ceiling') scale = 2.0;
    const stainBias =
        (variant === 'floor' ? 1.25 : variant === 'ceiling' ? 0.65 : isSphere ? 1.42 : 1.0) * stainBiasMul;

    const low = 256;
    const noiseC = document.createElement('canvas');
    noiseC.width = low;
    noiseC.height = low;
    const nctx = noiseC.getContext('2d');
    const nImg = nctx.createImageData(low, low);
    const nd = nImg.data;
    for (let y = 0; y < low; y++) {
        for (let x = 0; x < low; x++) {
            const nx = (x / low) * scale;
            const ny = (y / low) * scale;
            const n =
                fbm2(rnd, nx, ny, 4) * 0.55 + fbm2(rnd, nx * 2.3 + 10, ny * 2.1, 3) * 0.3;
            const t = clamp(n * stainBias, 0, 1);
            const i = (y * low + x) * 4;
            nd[i] = t * 255;
            nd[i + 1] = t * 255;
            nd[i + 2] = t * 255;
            nd[i + 3] = 255;
        }
    }
    nctx.putImageData(nImg, 0, 0);

    const tmp = document.createElement('canvas');
    tmp.width = size;
    tmp.height = size;
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(noiseC, 0, 0, low, low, 0, 0, size, size);
    const noiseRaw = tctx.getImageData(0, 0, size, size);
    const nr = noiseRaw.data;

    const albedoImg = tctx.createImageData(size, size);
    const ad = albedoImg.data;
    const hImg = tctx.createImageData(size, size);
    const hd = hImg.data;
    const rImg = tctx.createImageData(size, size);
    const rd = rImg.data;
    const aoImg = tctx.createImageData(size, size);
    const aod = aoImg.data;

    const darkR = isSphere ? 62 : 38;
    const darkG = isSphere ? 56 : 34;
    const darkB = isSphere ? 50 : 30;
    const drMul = isSphere ? 20 : 12;
    const dgMul = isSphere ? 17 : 10;
    const dbMul = isSphere ? 15 : 9;
    const roughMin = isSphere ? 78 : 95;
    const roughSpan = isSphere ? 135 : 110;
    const aoDark = isSphere ? 88 : 62;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const j = (y * size + x) * 4;
            let t = nr[j] / 255;
            if (stainEdgeBias !== 0) {
                const u = x / size - 0.5;
                const v = y / size - 0.5;
                const dist = Math.sqrt(u * u + v * v) * 1.414;
                t = clamp(t * (1 + stainEdgeBias * (dist - 0.22)), 0, 1);
            }
            t = clamp(t * stainContrast, 0, 1);
            const dr = (rnd() - 0.5) * drMul * t;
            const dg = (rnd() - 0.5) * dgMul * t;
            const db = (rnd() - 0.5) * dbMul * t;
            ad[j] = clamp(baseR + dr - t * darkR, 0, 255);
            ad[j + 1] = clamp(baseG + dg - t * darkG, 0, 255);
            ad[j + 2] = clamp(baseB + db - t * darkB, 0, 255);
            ad[j + 3] = 255;

            const hVal = clamp((isSphere ? 120 : 145) + t * (isSphere ? 110 : 85), 0, 255);
            hd[j] = hVal;
            hd[j + 1] = hVal;
            hd[j + 2] = hVal;
            hd[j + 3] = 255;

            const rough = clamp(roughMin + t * roughSpan, 40, 250);
            rd[j] = rough;
            rd[j + 1] = rough;
            rd[j + 2] = rough;
            rd[j + 3] = 255;

            const ao = clamp(255 - t * aoDark, isSphere ? 70 : 85, 255);
            aod[j] = ao;
            aod[j + 1] = ao;
            aod[j + 2] = ao;
            aod[j + 3] = 255;
        }
    }
    ctx.putImageData(albedoImg, 0, 0);
    hCtx.putImageData(hImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);
    aoCtx.putImageData(aoImg, 0, 0);

    const stainCount = Math.floor(
        (variant === 'floor' ? 195 : variant === 'wall' ? 205 : isSphere ? 240 : 140) * (size / 2048)
    );
    const stainFine =
        variant === 'wall' || variant === 'floor' ? 0.58 : 1;
    for (let s = 0; s < stainCount; s++) {
        let cx = rnd() * size;
        let cy = rnd() * size;
        if (stainCornerBias && (variant === 'wall' || variant === 'floor')) {
            if (rnd() < 0.5) {
                const margin = 0.24 * size;
                if (rnd() < 0.5) {
                    cx = rnd() < 0.5 ? rnd() * margin : size - rnd() * margin;
                    cy = rnd() * size;
                } else {
                    cx = rnd() * size;
                    cy = rnd() < 0.5 ? rnd() * margin : size - rnd() * margin;
                }
            }
        }
        let rx = (20 + rnd() * (variant === 'floor' ? 120 : isSphere ? 150 : 80)) * (size / 1024) * (isSphere ? 1.85 : 1);
        let ry = (15 + rnd() * (variant === 'floor' ? 90 : isSphere ? 130 : 70)) * (size / 1024) * (isSphere ? 1.85 : 1);
        rx *= stainFine;
        ry *= stainFine;
        const rot = rnd() * Math.PI * 2;
        const dark = 0.1 + rnd() * (isSphere ? 0.32 : 0.22);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
        grd.addColorStop(0, `rgba(35,32,28,${dark})`);
        grd.addColorStop(0.5, `rgba(55,50,45,${dark * 0.45})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        hCtx.save();
        hCtx.translate(cx, cy);
        hCtx.rotate(rot);
        const hg = hCtx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
        hg.addColorStop(0, 'rgba(120,120,120,0.5)');
        hg.addColorStop(1, 'rgba(200,200,200,0)');
        hCtx.fillStyle = hg;
        hCtx.beginPath();
        hCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        hCtx.fill();
        hCtx.restore();

        rCtx.save();
        rCtx.translate(cx, cy);
        rCtx.rotate(rot);
        const rg = rCtx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
        rg.addColorStop(0, 'rgba(60,60,60,0.65)');
        rg.addColorStop(1, 'rgba(128,128,128,0)');
        rCtx.fillStyle = rg;
        rCtx.beginPath();
        rCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        rCtx.fill();
        rCtx.restore();

        aoCtx.save();
        aoCtx.translate(cx, cy);
        aoCtx.rotate(rot);
        const ag = aoCtx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
        ag.addColorStop(0, 'rgba(0,0,0,0.45)');
        ag.addColorStop(1, 'rgba(255,255,255,0)');
        aoCtx.fillStyle = ag;
        aoCtx.beginPath();
        aoCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        aoCtx.fill();
        aoCtx.restore();
    }

    const scratchN = Math.floor(
        (isSphere ? 980 : variant === 'wall' || variant === 'floor' ? 1050 : 700) * (size / 2048)
    );
    for (let i = 0; i < scratchN; i++) {
        const x0 = rnd() * size;
        const y0 = rnd() * size;
        const len =
            (15 +
                rnd() *
                    (variant === 'floor' ? 62 : isSphere ? 110 : variant === 'wall' ? 42 : 70)) *
            (variant === 'wall' || variant === 'floor' ? 0.72 : 1);
        const ang = rnd() * Math.PI * 2;
        const x1 = x0 + Math.cos(ang) * len;
        const y1 = y0 + Math.sin(ang) * len;
        const a = (isSphere ? 0.07 : 0.04) + rnd() * (isSphere ? 0.14 : 0.1);
        ctx.strokeStyle = `rgba(40,38,35,${a})`;
        ctx.lineWidth = 0.4 + rnd() * 0.8;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        hCtx.strokeStyle = `rgba(170,170,170,${(isSphere ? 0.22 : 0.15) + rnd() * (isSphere ? 0.22 : 0.15)})`;
        hCtx.lineWidth = ctx.lineWidth;
        hCtx.beginPath();
        hCtx.moveTo(x0, y0);
        hCtx.lineTo(x1, y1);
        hCtx.stroke();
    }

    if (variant === 'wall') {
        for (let i = 0; i < 52; i++) {
            let x = rnd() * size;
            let y = rnd() * size;
            const len = 38 + rnd() * 220;
            ctx.strokeStyle = `rgba(45,42,38,${0.025 + rnd() * 0.05})`;
            ctx.lineWidth = 0.55 + rnd() * 1.35;
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let k = 0; k < 8; k++) {
                y += len / 8;
                x += (rnd() - 0.5) * 6;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }

    if (variant === 'floor') {
        drawGroutLines(ctx, size, { strokeStyle: '#7a7a7a', lineWidth: 0.6 });
        drawRedCrossesAndLabels(ctx, size);
        drawGroutLines(hCtx, size, { strokeStyle: '#505050', lineWidth: 0.8 });
    } else if (!isSphere) {
        drawGroutLines(ctx, size, { strokeStyle: '#9a9a9a', lineWidth: 0.45 });
        drawGroutLines(hCtx, size, { strokeStyle: '#505050', lineWidth: 0.55 });
    } else {
        // 球：タイル目地なしでシミ・カスレだけが見えるようにする
        for (let i = 0; i < 45; i++) {
            const x = rnd() * size;
            const y = rnd() * size;
            const r = 40 + rnd() * 220;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, `rgba(28,26,22,${0.04 + rnd() * 0.1})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const normalCanvas = heightToNormalCanvas(hCanvas, isSphere ? 4.4 : 3.5);

    const mkTex = (canvas, aniso) => {
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };

    const mkDataTex = (canvas, aniso) => {
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        t.colorSpace = THREE.NoColorSpace;
        return t;
    };

    const maxAniso = options.maxAnisotropy ?? 8;

    const bumpTex = new THREE.CanvasTexture(hCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.anisotropy = maxAniso;
    bumpTex.colorSpace = THREE.NoColorSpace;

    return {
        map: mkTex(mapCanvas, maxAniso),
        bumpMap: bumpTex,
        normalMap: mkDataTex(normalCanvas, maxAniso),
        roughnessMap: mkDataTex(rCanvas, maxAniso),
        aoMap: mkDataTex(aoCanvas, maxAniso),
        heightCanvas: hCanvas
    };
}
