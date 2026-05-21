import * as THREE from 'three';

/**
 * 岩石・石材風のプロシージャル PBR テクスチャ（albedo / normal / roughness / ao）。
 */

function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fbm(rnd, x, y, oct) {
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

/**
 * @param {number} size
 * @param {object} [options]
 * @param {number} [options.seed=123]
 * @param {number} [options.maxAnisotropy=8]
 * @returns {{ map: THREE.CanvasTexture, normalMap: THREE.CanvasTexture, roughnessMap: THREE.CanvasTexture, aoMap: THREE.CanvasTexture }}
 */
export function generateRockPBRTextures(size = 1024, options = {}) {
    const seed = options.seed ?? 123;
    const maxAniso = options.maxAnisotropy ?? 8;
    const rnd = mulberry32(seed);

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const aCtx = albedoCanvas.getContext('2d');

    const heightCanvas = document.createElement('canvas');
    heightCanvas.width = size;
    heightCanvas.height = size;
    const hCtx = heightCanvas.getContext('2d');

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d');

    const aoCanvas = document.createElement('canvas');
    aoCanvas.width = size;
    aoCanvas.height = size;
    const aoCtx = aoCanvas.getContext('2d');

    const aImg = aCtx.createImageData(size, size);
    const hImg = hCtx.createImageData(size, size);
    const rImg = rCtx.createImageData(size, size);
    const aoImg = aoCtx.createImageData(size, size);

    const baseCol = new THREE.Color(0xffffff); // 0x333333 -> 0xffffff
    const rockCol1 = new THREE.Color(0xdddddd);
    const rockCol2 = new THREE.Color(0xeeeeee);
    const pixCol = new THREE.Color();

    const scale = 4.5;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const nx = (x / size) * scale;
            const ny = (y / size) * scale;

            // 高さマップ（岩の凹凸）
            const h = fbm(rnd, nx, ny, 6);
            const hVal = Math.floor(h * 255);
            hImg.data[i] = hVal;
            hImg.data[i + 1] = hVal;
            hImg.data[i + 2] = hVal;
            hImg.data[i + 3] = 255;

            // アルベド（色）
            const colorNoise = fbm(rnd, nx * 0.5 + 10, ny * 0.5 + 10, 4);
            pixCol.copy(baseCol).lerp(rockCol1, colorNoise);
            pixCol.lerp(rockCol2, fbm(rnd, nx * 2, ny * 2, 3) * 0.3);
            // 高さによる明暗
            pixCol.multiplyScalar(0.8 + h * 0.4);
            
            aImg.data[i] = Math.floor(pixCol.r * 255);
            aImg.data[i + 1] = Math.floor(pixCol.g * 255);
            aImg.data[i + 2] = Math.floor(pixCol.b * 255);
            aImg.data[i + 3] = 255;

            // ラフネス
            const r = 0.4 + fbm(rnd, nx * 3, ny * 3, 3) * 0.5;
            const rVal = Math.floor(r * 255);
            rImg.data[i] = rVal;
            rImg.data[i + 1] = rVal;
            rImg.data[i + 2] = rVal;
            rImg.data[i + 3] = 255;

            // AO
            const ao = 0.7 + h * 0.3;
            const aoVal = Math.floor(ao * 255);
            aoImg.data[i] = aoVal;
            aoImg.data[i + 1] = aoVal;
            aoImg.data[i + 2] = aoVal;
            aoImg.data[i + 3] = 255;
        }
    }

    aCtx.putImageData(aImg, 0, 0);
    hCtx.putImageData(hImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);
    aoCtx.putImageData(aoImg, 0, 0);

    // 高さマップから法線マップを生成
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = size;
    normalCanvas.height = size;
    const nCtx = normalCanvas.getContext('2d');
    const nImg = nCtx.createImageData(size, size);
    const strength = 5.0;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const getH = (px, py) => {
                const xi = (px + size) % size;
                const yi = (py + size) % size;
                return hImg.data[(yi * size + xi) * 4] / 255;
            };
            const dx = (getH(x - 1, y) - getH(x + 1, y)) * strength;
            const dy = (getH(x, y - 1) - getH(x, y + 1)) * strength;
            const nz = 1.0;
            const len = Math.sqrt(dx * dx + dy * dy + nz * nz);
            nImg.data[i] = Math.floor((dx / len * 0.5 + 0.5) * 255);
            nImg.data[i + 1] = Math.floor((dy / len * 0.5 + 0.5) * 255);
            nImg.data[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
            nImg.data[i + 3] = 255;
        }
    }
    nCtx.putImageData(nImg, 0, 0);

    const wrap = (tex, linear = false) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = maxAniso;
        tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    };

    const map = new THREE.CanvasTexture(albedoCanvas);
    wrap(map);
    const normalMap = new THREE.CanvasTexture(normalCanvas);
    wrap(normalMap, true);
    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    wrap(roughnessMap, true);
    const aoMap = new THREE.CanvasTexture(aoCanvas);
    wrap(aoMap, true);

    return { map, normalMap, roughnessMap, aoMap };
}
