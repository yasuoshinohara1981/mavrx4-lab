/**
 * StudioBox の壁・床・天井に LabGrungeTextures の aoMap のみ適用する。
 * 画面空間 SSAO は巨大な平面で弱くなりがちなので、タイル UV 上のベイク系 AO で「部屋の隅」が乗るようにする。
 */
import * as THREE from 'three';
import { generateLabGrungeTextures } from './LabGrungeTextures.js';

/**
 * @param {import('./presentation/index.js').StudioBox} studio
 */
function ensureUv2ForAo(mesh) {
    const g = mesh?.geometry;
    if (!g?.attributes?.uv || g.attributes.uv2) return;
    g.setAttribute('uv2', g.attributes.uv.clone());
}

export function applyLabAoMapsToStudioRoom(studio) {
    if (!studio?.studioBox?.material || !studio?.studioFloor?.material) return;

    ensureUv2ForAo(studio.studioBox);
    ensureUv2ForAo(studio.studioFloor);

    const size = 1024;
    const wallPack = generateLabGrungeTextures(size, {
        variant: 'wall',
        seed: 101,
        stainCornerBias: true,
        maxAnisotropy: 8
    });
    const floorPack = generateLabGrungeTextures(size, {
        variant: 'floor',
        seed: 202,
        stainCornerBias: true,
        maxAnisotropy: 8
    });
    const ceilPack = generateLabGrungeTextures(size, {
        variant: 'ceiling',
        seed: 303,
        maxAnisotropy: 8
    });

    const wallMat = studio.studioBox.material[0];
    const ceilingMat = studio.studioBox.material[2];
    const floorMat = studio.studioFloor.material;

    const alignAo = (mat, aoTex) => {
        aoTex.wrapS = aoTex.wrapT = THREE.RepeatWrapping;
        if (mat.map) {
            aoTex.repeat.copy(mat.map.repeat);
            aoTex.offset.copy(mat.map.offset);
        } else {
            aoTex.repeat.set(1, 1);
        }
        aoTex.colorSpace = THREE.NoColorSpace;
        mat.aoMap = aoTex;
        mat.aoMapIntensity = 1.0;
        mat.needsUpdate = true;
    };

    alignAo(wallMat, wallPack.aoMap);
    alignAo(floorMat, floorPack.aoMap);
    alignAo(ceilingMat, ceilPack.aoMap);

    const disposeUnused = (pack) => {
        pack.map?.dispose();
        pack.bumpMap?.dispose();
        pack.normalMap?.dispose();
        pack.roughnessMap?.dispose();
    };
    disposeUnused(wallPack);
    disposeUnused(floorPack);
    disposeUnused(ceilPack);
}
