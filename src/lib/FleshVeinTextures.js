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
 * Scene1 トラック9 スフィアと同系のプロシージャル「血管／組織」風 albedo + bump。
 *
 * @param {number} [size=512]
 * @param {{ seed?: number }} [options] `seed` 省略時は毎回非決定的（従来の Scene1 挙動に近い）
 * @returns {{ map: THREE.CanvasTexture, bumpMap: THREE.CanvasTexture }}
 */
export function generateFleshVeinTextures(size = 512, options = {}) {
    const seed = options.seed;
    const rnd = seed !== undefined ? mulberry32(seed) : Math.random;

    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const cCtx = colorCanvas.getContext('2d');
    cCtx.fillStyle = '#888888';
    cCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 100; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 20 + rnd() * 60;
        const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
        const grayVal = 120 + rnd() * 80;
        grad.addColorStop(0, `rgba(${grayVal}, ${grayVal}, ${grayVal}, 0.5)`);
        grad.addColorStop(1, 'rgba(136, 136, 136, 0)');
        cCtx.fillStyle = grad;
        cCtx.beginPath();
        cCtx.arc(x, y, r, 0, Math.PI * 2);
        cCtx.fill();
    }
    cCtx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
    for (let i = 0; i < 30; i++) {
        cCtx.lineWidth = 0.8 + rnd() * 2.0;
        let x = rnd() * size;
        let y = rnd() * size;
        cCtx.beginPath();
        cCtx.moveTo(x, y);
        let angle = rnd() * Math.PI * 2;
        for (let j = 0; j < 40; j++) {
            angle += (rnd() - 0.5) * 1.2;
            x += Math.cos(angle) * 8;
            y += Math.sin(angle) * 8;
            cCtx.lineTo(x, y);
        }
        cCtx.stroke();
    }

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d');
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 500; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 1 + rnd() * 3;
        const isBump = rnd() > 0.5;
        bCtx.fillStyle = isBump ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
        bCtx.beginPath();
        bCtx.arc(x, y, r, 0, Math.PI * 2);
        bCtx.fill();
    }
    for (let i = 0; i < 50; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 10 + rnd() * 30;
        const grad = bCtx.createRadialGradient(x, y, 0, x, y, r);
        const val = rnd() > 0.5 ? 255 : 0;
        grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.4)`);
        grad.addColorStop(1, 'rgba(128, 128, 128, 0)');
        bCtx.fillStyle = grad;
        bCtx.beginPath();
        bCtx.arc(x, y, r, 0, Math.PI * 2);
        bCtx.fill();
    }

    const colorTex = new THREE.CanvasTexture(colorCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;

    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.colorSpace = THREE.LinearSRGBColorSpace;

    return { map: colorTex, bumpMap: bumpTex };
}
