/**
 * Scene1 床と同系のプロシージャル PBR（albedo / normal / roughness / ao）。
 * オプションで目地・赤十字オーバーレイを省略（ケーブル等に流用する場合）。
 */
import * as THREE from 'three';
import { drawGroutLines, drawGroutNumberLabels, drawRedCrossesAndLabels } from './studioBoxGrout.js';

export const TILE_OVERLAY_DIVISIONS = 26;

/**
 * @param {number} size
 * @param {number} [maxAnisotropy=8]
 * @param {{ tileOverlay?: boolean }} [options] tileOverlay 既定 true（床・壁用）。false で目地なし。
 * @returns {{ map: THREE.CanvasTexture, wallMap: THREE.CanvasTexture, normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture, aoMap: THREE.CanvasTexture }}
 */
export function generateConcretePBRTextures(size = 1024, maxAnisotropy = 8, options = {}) {
    const tileOverlay = options.tileOverlay !== false;

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const aCtx = albedoCanvas.getContext('2d');
    const hCanvas = document.createElement('canvas');
    hCanvas.width = size;
    hCanvas.height = size;
    const hCtx = hCanvas.getContext('2d');
    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d');
    const aoCanvas = document.createElement('canvas');
    aoCanvas.width = size;
    aoCanvas.height = size;
    const aoCtx = aoCanvas.getContext('2d');

    const rnd = (x, y) => {
        const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return s - Math.floor(s);
    };
    const smooth = (x, y) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const u = fx * fx * (3 - 2 * fx);
        const v = fy * fy * (3 - 2 * fy);
        const a = rnd(x0, y0);
        const b = rnd(x0 + 1, y0);
        const c = rnd(x0, y0 + 1);
        const d = rnd(x0 + 1, y0 + 1);
        return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };
    const fbm = (x, y, oct) => {
        let amp = 0.5;
        let f = 0;
        let xx = x;
        let yy = y;
        for (let o = 0; o < oct; o++) {
            f += smooth(xx, yy) * amp;
            xx *= 2.05;
            yy *= 2.03;
            amp *= 0.5;
        }
        return f;
    };

    const heightData = new Float32Array(size * size);
    const roughData = new Float32Array(size * size);
    const aoData = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const v = y / size;
            const nx = x * 0.018;
            const ny = y * 0.018;

            const w1x = fbm(ny * 0.88 + 12.3, nx * 0.62 + 4.1, 3) * 0.44;
            const w1y = fbm(nx * 0.88 + 2.7, ny * 0.62 + 8.9, 3) * 0.44;
            const qx = nx + w1x;
            const qy = ny + w1y;
            const w2x = fbm(qy * 0.58 + 1.1, qx * 0.51 + 6.0, 4) * 0.52;
            const w2y = fbm(qx * 0.58 + 7.1, qy * 0.51 + 2.3, 4) * 0.52;
            const wx = qx + w2x;
            const wy = qy + w2y;
            const w3x = fbm(wy * 0.72 + 3.0, wx * 0.66 + 0.4, 3) * 0.26;
            const w3y = fbm(wx * 0.72 + 5.0, wy * 0.66 + 8.0, 3) * 0.26;
            const warpX = wx + w3x;
            const warpY = wy + w3y;

            const nMod = 0.55 + 0.9 * fbm(nx * 0.36 + 9.5, ny * 0.34 - 2.0, 4);
            const coarse = fbm(warpX, warpY, 5) * 0.52 * nMod;
            const mid =
                fbm(warpX * 2.2 + 10, warpY * 2.1 - 4, 4) *
                0.28 *
                (0.75 + 0.5 * fbm(nx * 0.2, ny * 0.19, 2));
            const ripple =
                Math.sin(u * 40 + v * 12) * 0.04 * (0.65 + 0.7 * fbm(nx * 0.45, ny * 0.42, 2));
            const patch = fbm(nx * 0.52 + 1.9, ny * 0.5 - 0.7, 4) * 0.22;
            const patchMod = patch * (0.45 + 0.55 * fbm(warpX * 3.8, warpY * 3.8, 2));
            const grain = fbm(nx * 8.5 + 30, ny * 8.1 - 11, 3) * 0.058;
            const micro = fbm(wx * 18, wy * 17, 2) * 0.032;
            const h = coarse + mid + ripple + patchMod + grain + micro;
            heightData[y * size + x] = h;

            const rEnvelop = fbm(nx * 0.38 + 2.1, ny * 0.36 + 1.0, 3);
            const macroRough = fbm(
                nx * (0.46 + 0.15 * rEnvelop) + 19.2,
                ny * (0.44 + 0.12 * rEnvelop) + 6.8,
                4
            );
            const rVar =
                fbm(nx * 1.7 + 50 + macroRough * 0.85, ny * 1.6 - 20, 5) * 0.55 +
                fbm(nx * 5.1, ny * 4.8, 3) * 0.35 * (0.45 + 0.55 * fbm(nx * 0.9, ny * 0.85, 2)) +
                fbm(nx * 12 + 3, ny * 11.5 - 5, 2) * 0.14;
            const rMicro = fbm(nx * 38 + 4, ny * 37, 2) * 0.14;
            roughData[y * size + x] = THREE.MathUtils.clamp(
                0.1 + rVar * 0.58 + macroRough * 0.42 + rMicro * 0.65,
                0,
                1
            );

            const cx = u - 0.5;
            const cy = v - 0.5;
            const edge = 1 - Math.min(1, Math.sqrt(cx * cx + cy * cy) * 1.85);
            const contact = Math.pow(Math.max(0, edge), 1.35);
            const stain = fbm(nx * 0.8 + 100, ny * 0.7, 3);
            const aoGrain = (fbm(nx * 2.4, ny * 2.2, 3) - 0.5) * 0.11;
            const aoNested =
                (fbm(nx * 6.5, ny * 6.2, 3) - 0.5) * 0.09 * (0.4 + 0.6 * fbm(nx * 0.9, ny * 0.85, 2));
            aoData[y * size + x] = THREE.MathUtils.clamp(
                0.52 + contact * 0.28 + stain * 0.08 + aoGrain + aoNested,
                0,
                1
            );
        }
    }

    const aImg = aCtx.createImageData(size, size);
    const nImg = aCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const aoImg = aoCtx.createImageData(size, size);

    const baseCol = new THREE.Color(0x8e949e);
    const cold = new THREE.Color(0x7a808a);
    const stainCol = new THREE.Color(0x5c6068);
    const pixCol = new THREE.Color();

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const h = heightData[y * size + x];
            const hx = x < size - 1 ? heightData[y * size + x + 1] : h;
            const hxm = x > 0 ? heightData[y * size + x - 1] : h;
            const hy = y < size - 1 ? heightData[(y + 1) * size + x] : h;
            const hym = y > 0 ? heightData[(y - 1) * size + x] : h;
            let dx = (hxm - hx) * 4.2;
            let dy = (hym - hy) * 4.2;
            const nxP = x * 0.018;
            const nyP = y * 0.018;
            const px = nxP + (fbm(nyP * 2.35, nxP * 2.15 + 1.7, 2) - 0.5) * 0.52;
            const py = nyP + (fbm(nxP * 2.35, nyP * 2.15 + 4.2, 2) - 0.5) * 0.52;
            const det = (fbm(px * 14 + 40, py * 13.5, 3) - 0.5) * 0.5;
            const det2 = (fbm(px * 28 + 7, py * 27, 2) - 0.5) * 0.2;
            const det3 = (fbm(px * 52 + 3, py * 50, 2) - 0.5) * 0.12;
            dx += det + det2 + det3;
            dy += (fbm(px * 14.2 + 2, py * 13.7 + 55, 3) - 0.5) * 0.5;
            dy += (fbm(px * 28.1 + 90, py * 27.2, 2) - 0.5) * 0.2;
            dy += (fbm(px * 52 + 20, py * 50 + 10, 2) - 0.5) * 0.12;
            const dLen = Math.sqrt(dx * dx + dy * dy);
            if (dLen > 0.92) {
                const s = 0.92 / dLen;
                dx *= s;
                dy *= s;
            }
            const nz = Math.sqrt(Math.max(0.0001, 1 - dx * dx - dy * dy));
            const nx = dx * 0.5 + 0.5;
            const ny = dy * 0.5 + 0.5;
            const nzp = nz * 0.5 + 0.5;
            nImg.data[i] = Math.floor(nx * 255);
            nImg.data[i + 1] = Math.floor(ny * 255);
            nImg.data[i + 2] = Math.floor(nzp * 255);
            nImg.data[i + 3] = 255;

            const u = x / size;
            const v = y / size;
            const blot = fbm(x * 0.04, y * 0.04, 4);
            const drip = Math.sin(u * 90 + v * 22) * 0.5 + 0.5;
            const wear = fbm(x * 0.09 + 20, y * 0.11, 3);
            pixCol.copy(baseCol).lerp(cold, blot * 0.35);
            pixCol.lerp(stainCol, drip * 0.12 * wear);
            const toneNest =
                0.9 +
                0.2 *
                    fbm(x * 0.022 + 5.1, y * 0.021 - 2.4, 3) *
                    (0.45 + 0.55 * fbm(x * 0.075 + 1.2, y * 0.071 + 8.0, 2));
            pixCol.multiplyScalar((0.96 + h * 0.14) * toneNest);
            const speck = rnd(x * 0.37, y * 0.41);
            if (speck < 0.0009) {
                pixCol.multiplyScalar(0.86 + speck * 14);
            }

            aImg.data[i] = Math.floor(pixCol.r * 255);
            aImg.data[i + 1] = Math.floor(pixCol.g * 255);
            aImg.data[i + 2] = Math.floor(pixCol.b * 255);
            aImg.data[i + 3] = 255;

            const rg = roughData[y * size + x];
            const gCh = Math.floor(rg * 255);
            rImg.data[i] = 0;
            rImg.data[i + 1] = gCh;
            rImg.data[i + 2] = 0;
            rImg.data[i + 3] = 255;

            const ao = aoData[y * size + x];
            const ar = Math.floor(ao * 255);
            aoImg.data[i] = ar;
            aoImg.data[i + 1] = ar;
            aoImg.data[i + 2] = ar;
            aoImg.data[i + 3] = 255;
        }
    }

    aCtx.putImageData(aImg, 0, 0);
    const tileDiv = TILE_OVERLAY_DIVISIONS;
    let wallAlbedoCanvas;

    if (tileOverlay) {
        aCtx.save();
        aCtx.globalCompositeOperation = 'multiply';
        drawGroutLines(aCtx, size, {
            strokeStyle: '#6f757c',
            divisions: tileDiv,
            lineWidth: 1.65
        });
        aCtx.restore();
        drawRedCrossesAndLabels(aCtx, size, tileDiv);

        wallAlbedoCanvas = document.createElement('canvas');
        wallAlbedoCanvas.width = size;
        wallAlbedoCanvas.height = size;
        const wallACtx = wallAlbedoCanvas.getContext('2d');
        wallACtx.drawImage(albedoCanvas, 0, 0);
        wallACtx.save();
        wallACtx.globalCompositeOperation = 'multiply';
        drawGroutLines(wallACtx, size, {
            strokeStyle: '#5a6169',
            divisions: tileDiv,
            lineWidth: 1.2
        });
        wallACtx.restore();
        /** multiply で薄く潰れた番号を、壁用に source-over で濃く重ねて復活 */
        drawGroutNumberLabels(wallACtx, size, tileDiv, { fillAlpha: 0.52 });
    }

    hCtx.putImageData(nImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);
    aoCtx.putImageData(aoImg, 0, 0);

    const wrap = (canvasTex, linearColor = false) => {
        canvasTex.wrapS = canvasTex.wrapT = THREE.RepeatWrapping;
        canvasTex.colorSpace = linearColor ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        canvasTex.anisotropy = maxAnisotropy;
        canvasTex.needsUpdate = true;
    };

    const map = new THREE.CanvasTexture(albedoCanvas);
    wrap(map, false);

    let wallMap;
    if (tileOverlay) {
        wallMap = new THREE.CanvasTexture(wallAlbedoCanvas);
        wrap(wallMap, false);
    } else {
        wallMap = map;
    }

    const normalMap = new THREE.CanvasTexture(hCanvas);
    wrap(normalMap, true);

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    wrap(roughnessMap, true);

    const aoMap = new THREE.CanvasTexture(aoCanvas);
    wrap(aoMap, true);

    return { map, wallMap, normalMap, roughnessMap, aoMap };
}
