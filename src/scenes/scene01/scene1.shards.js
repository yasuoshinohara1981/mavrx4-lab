import * as THREE from 'three';
import {
    fadeOpacity01,
    growScale01,
    growInMsFromDuration,
    normalizeMidiVelocity,
    velocityToMetalShardColor,
    applyInstanceOpacityShader,
    attachInstanceOpacityAttribute
} from './scene1.helpers.js';
import { shardNoise, composeTrailNoiseQuat } from './scene1.motion.js';

/**
 * Scene1 金属片（Metal Shards）関連のロジック
 */

/**
 * 金属片システムの初期化
 */
export function initMetalShardsSystem(scene) {
    scene.shardGroup = new THREE.Group();
    scene.shardGroup.position.set(0, 0, 0);
    scene.scene.add(scene.shardGroup);

    const envTex = scene.cubeRenderTarget ? scene.cubeRenderTarget.texture : scene.scene.environment;
    scene._metalShardMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.88,
        roughness: 0.32,
        envMap: envTex,
        envMapIntensity: 0.92 * (0.55 + 0.45 * (scene.sceneLightingScale ?? 1)),
        emissive: 0x000000,
        emissiveIntensity: 0,
        opacity: 1,
        fog: true
    });
    applyInstanceOpacityShader(scene._metalShardMaterial);

    const shardGeo = new THREE.TetrahedronGeometry(1, 0);
    scene._shardOpacityAttr = attachInstanceOpacityAttribute(shardGeo, scene.maxShards);
    scene.shardInstMesh = new THREE.InstancedMesh(shardGeo, scene._metalShardMaterial, scene.maxShards);
    scene.shardInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.shardInstMesh.frustumCulled = false;
    scene.shardInstMesh.castShadow = true;
    scene.shardInstMesh.receiveShadow = true;
    scene.shardGroup.add(scene.shardInstMesh);

    scene._shardFreeSlots = [];
    const hideColor = new THREE.Color(0x000000);
    for (let i = scene.maxShards - 1; i >= 0; i--) {
        scene._shardFreeSlots.push(i);
    }
    for (let i = 0; i < scene.maxShards; i++) {
        clearShardSlot(scene, i);
        scene.shardInstMesh.setColorAt(i, hideColor);
    }
    if (scene.shardInstMesh.instanceColor) {
        scene.shardInstMesh.instanceColor.needsUpdate = true;
    }
    scene.shardInstMesh.instanceMatrix.needsUpdate = true;
}

/**
 * 金属片のスポーン
 */
export function spawnMetalShardFromTrack5(scene, velocity, durationMs = 180) {
    if (!scene.shardGroup || !scene._metalShardMaterial || !scene.shardInstMesh) return;

    const vMidi = normalizeMidiVelocity(velocity);
    const si = scene._snakeIndex;
    const newPos = scene._spawnWorldPosTemp;
    newPos.copy(scene._trailHeadPosShard);
    
    const headRight = new THREE.Vector3().crossVectors(scene._trailHeadDirShard, new THREE.Vector3(0, 1, 0));
    if (headRight.lengthSq() > 1e-8) {
        headRight.normalize();
        const lateral = (shardNoise(si * 0.63, scene.time * 0.11, 1.9) - 0.5) * 130;
        newPos.addScaledVector(headRight, lateral);
    }
    const vertical = (shardNoise(2.7, si * 0.29, scene.time * 0.09) - 0.5) * 95;
    newPos.y += vertical;
    newPos.x = THREE.MathUtils.clamp(newPos.x, -scene.roomHalfW * 0.62, scene.roomHalfW * 0.62);
    newPos.z = THREE.MathUtils.clamp(newPos.z, -scene.roomHalfD * 0.62, scene.roomHalfD * 0.62);
    newPos.y = THREE.MathUtils.clamp(newPos.y, scene.floorTopY + 90, scene.ceilingY * 0.46);

    const fwd = scene._trailHeadDirShard.clone().normalize();
    const qSnake = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    if (Math.abs(zAxis.dot(fwd)) > 0.998) {
        qSnake.setFromAxisAngle(new THREE.Vector3(1, 0, 0), fwd.z < 0 ? Math.PI : 0);
    } else {
        qSnake.setFromUnitVectors(zAxis, fwd);
    }
    const roll = (shardNoise(si, 7.1, scene.time * 0.05) - 0.5) * Math.PI * 0.32;
    const qRoll = new THREE.Quaternion().setFromAxisAngle(fwd, roll);
    const qN = composeTrailNoiseQuat(si * 0.71 + scene.time * 0.13, scene.time, scene._trailPitchAmp, scene._trailYawAmp, scene._trailRollAmp);
    const qFinal = qSnake.clone().multiply(qRoll).multiply(qN);

    scene._lastShardPos.copy(newPos);
    scene._snakeIndex++;

    const dur = Math.max(1, Number(durationMs) || 180);
    const durN = THREE.MathUtils.clamp(dur / 750, 0.06, 1.65);
    const s = scene.shardCylinderVisualScale ?? 1;
    const r = (18 + 118 * durN) * (0.94 + 0.06 * shardNoise(si * 0.7, 0.2, 0.1)) * s;

    const slotIndex = allocShardSlot(scene);
    if (slotIndex === undefined) return;

    velocityToMetalShardColor(vMidi, scene._shardHeatColor, scene._shardMetalDark, scene._shardMetalMid, scene._shardMetalBright);
    scene.shardInstMesh.setColorAt(slotIndex, scene._shardHeatColor);
    if (scene.shardInstMesh.instanceColor) {
        scene.shardInstMesh.instanceColor.needsUpdate = true;
    }

    scene._shardPosTemp.copy(newPos);
    scene.shardGroup.updateMatrixWorld(true);
    scene.shardGroup.worldToLocal(scene._shardPosTemp);
    const shapeSeed = shardNoise(si * 0.37, 6.9, 2.4);
    const ex = 0.62 + 0.95 * shardNoise(shapeSeed, si * 0.19, 1.7);
    const ey = 0.62 + 0.95 * shardNoise(si * 0.11, shapeSeed, 2.9);
    const ez = 0.62 + 0.95 * shardNoise(3.1, si * 0.23, shapeSeed);
    const invAvg = 3 / (ex + ey + ez);
    const sx = r * ex * invAvg;
    const sy = r * ey * invAvg;
    const sz = r * ez * invAvg;
    scene._shardScaleTemp.set(sx * 0.02, sy * 0.02, sz * 0.02);
    scene._shardMatrixTemp.compose(scene._shardPosTemp, qFinal, scene._shardScaleTemp);
    scene.shardInstMesh.setMatrixAt(slotIndex, scene._shardMatrixTemp);
    scene.shardInstMesh.instanceMatrix.needsUpdate = true;
    if (scene._shardOpacityAttr) {
        scene._shardOpacityAttr.array[slotIndex] = 1;
        scene._shardOpacityAttr.needsUpdate = true;
    }

    scene.shards.push({
        slotIndex,
        spawnTime: performance.now(),
        localPos: scene._shardPosTemp.clone(),
        localQuat: qFinal.clone(),
        baseScaleVec: new THREE.Vector3(sx, sy, sz),
        growInMs: growInMsFromDuration(dur, scene.shardGrowInMs)
    });
    scene.ambientDust?.spawnBurst(newPos, scene.ambientParticlesPerShard);
}

/**
 * スロットの割り当て
 */
export function allocShardSlot(scene) {
    if (scene.shards.length >= scene.maxShards) {
        const old = scene.shards.shift();
        clearShardSlot(scene, old.slotIndex);
        return old.slotIndex;
    }
    return scene._shardFreeSlots.pop();
}

/**
 * スロットのクリア
 */
export function clearShardSlot(scene, slotIndex) {
    if (!scene.shardInstMesh || slotIndex < 0 || slotIndex >= scene.maxShards) return;
    scene._shardPosTemp.set(0, -1e6, 0);
    scene._shardQuatTemp.identity();
    scene._shardScaleTemp.set(0, 0, 0);
    scene._shardMatrixTemp.compose(scene._shardPosTemp, scene._shardQuatTemp, scene._shardScaleTemp);
    scene.shardInstMesh.setMatrixAt(slotIndex, scene._shardMatrixTemp);
    if (scene._shardOpacityAttr) {
        scene._shardOpacityAttr.array[slotIndex] = 0;
        scene._shardOpacityAttr.needsUpdate = true;
    }
    scene.shardInstMesh.instanceMatrix.needsUpdate = true;
}

/**
 * 期限切れの金属片の削除
 */
export function pruneExpiredShards(scene) {
    if (!scene.shards.length || !scene.shardGroup) return;
    const now = performance.now();
    const life = scene.shardLifetimeMs;
    let matrixDirty = false;
    for (let i = scene.shards.length - 1; i >= 0; i--) {
        const s = scene.shards[i];
        if (now - s.spawnTime > life) {
            clearShardSlot(scene, s.slotIndex);
            scene._shardFreeSlots.push(s.slotIndex);
            scene.shards.splice(i, 1);
            matrixDirty = true;
        }
    }
    while (scene.shards.length > scene.maxShards) {
        const old = scene.shards.shift();
        clearShardSlot(scene, old.slotIndex);
        scene._shardFreeSlots.push(old.slotIndex);
        matrixDirty = true;
    }
    if (matrixDirty && scene.shardInstMesh) {
        scene.shardInstMesh.instanceMatrix.needsUpdate = true;
    }
}

/**
 * 金属片のフェード・グロウ更新
 */
export function updateShardFadeOpacity(scene, now) {
    if (scene._shardOpacityAttr && scene.shards.length) {
        const arr = scene._shardOpacityAttr.array;
        let dirty = false;
        let matrixDirty = false;
        for (const s of scene.shards) {
            const age = now - s.spawnTime;
            const op = fadeOpacity01(age, scene.shardLifetimeMs, scene.shardFadeOutMs);
            const i = s.slotIndex;
            if (Math.abs(arr[i] - op) > 1e-4) {
                arr[i] = op;
                dirty = true;
            }
            const grow = growScale01(age, s.growInMs ?? scene.shardGrowInMs);
            if (grow < 0.999 && s.baseScaleVec && s.localPos && s.localQuat) {
                scene._shardScaleTemp.copy(s.baseScaleVec).multiplyScalar(grow);
                scene._shardMatrixTemp.compose(s.localPos, s.localQuat, scene._shardScaleTemp);
                scene.shardInstMesh.setMatrixAt(i, scene._shardMatrixTemp);
                matrixDirty = true;
            }
        }
        if (dirty) scene._shardOpacityAttr.needsUpdate = true;
        if (matrixDirty && scene.shardInstMesh) scene.shardInstMesh.instanceMatrix.needsUpdate = true;
    }
}
