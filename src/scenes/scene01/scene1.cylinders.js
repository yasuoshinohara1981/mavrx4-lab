import * as THREE from 'three';
import {
    fadeOpacity01,
    growScale01,
    growInMsFromDuration,
    normalizeMidiVelocity,
    setHeatmapColor01,
    applyRedCylinderShader,
    attachInstanceOpacityAttribute
} from './scene1.helpers.js';
import { shardNoise, sampleCurlNoiseVectorInto } from './scene1.motion.js';

/**
 * Scene1 赤シリンダー（Red Cylinders）関連のロジック
 */

/**
 * シリンダーシステムの初期化
 */
export function initRedCylinderSystem(scene) {
    scene._redCylinderMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x000000,
        emissiveIntensity: 0,
        metalness: 0,
        roughness: 0.52,
        fog: true,
        opacity: 1
    });
    applyRedCylinderShader(scene._redCylinderMaterial);

    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 6);
    scene._cylinderOpacityAttr = attachInstanceOpacityAttribute(cylGeo, scene.maxCylinders);
    scene.cylinderInstMesh = new THREE.InstancedMesh(cylGeo, scene._redCylinderMaterial, scene.maxCylinders);
    scene.cylinderInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.cylinderInstMesh.frustumCulled = false;
    scene.cylinderInstMesh.castShadow = true;
    scene.cylinderInstMesh.receiveShadow = true;
    scene.scene.add(scene.cylinderInstMesh);

    scene._cylinderFreeSlots = [];
    for (let i = scene.maxCylinders - 1; i >= 0; i--) {
        scene._cylinderFreeSlots.push(i);
    }
    for (let i = 0; i < scene.maxCylinders; i++) {
        clearCylinderSlot(scene, i);
        scene.cylinderInstMesh.setColorAt(i, scene._instanceWhite);
    }
    if (scene.cylinderInstMesh.instanceColor) {
        scene.cylinderInstMesh.instanceColor.needsUpdate = true;
    }
    scene.cylinderInstMesh.instanceMatrix.needsUpdate = true;
}

/**
 * シリンダーのスポーン
 */
export function spawnRedCylinderFromTrack6(scene, velocity, durationMs = 180, noteNumber = 64) {
    if (!scene.cylinderInstMesh || !scene._redCylinderMaterial) return;

    const vMidi = normalizeMidiVelocity(velocity);
    const dur = Math.max(1, Number(durationMs) || 180);
    const s = scene.shardCylinderVisualScale ?? 1;
    const length = THREE.MathUtils.clamp(cylinderLengthFromVelocityMidi(vMidi), 72, 355) * s;
    const radius = THREE.MathUtils.clamp(cylinderRadiusFromDurationMs(dur), 8, 38) * s;

    const slotIndex = allocCylinderSlot(scene);
    const ci = scene.cylinders.length;
    const wu = new THREE.Vector3(0, 1, 0);
    scene._cylinderPosTemp.copy(scene._trailHeadPosCylinder);
    
    const cside = new THREE.Vector3().crossVectors(scene._trailHeadDirCylinder, wu);
    if (cside.lengthSq() > 1e-8) {
        cside.normalize();
        const lateral = (shardNoise(ci * 0.37, scene.time * 0.09, 2.2) - 0.5) * 180;
        scene._cylinderPosTemp.addScaledVector(cside, lateral);
    }
    scene._cylinderPosTemp.y += (shardNoise(3.4, ci * 0.21, scene.time * 0.07) - 0.5) * 140;
    const cylXLimit = scene.roomHalfW * 0.62;
    const cylZLimit = scene.roomHalfD * 0.62;
    scene._cylinderPosTemp.x = THREE.MathUtils.clamp(scene._cylinderPosTemp.x, -cylXLimit, cylXLimit);
    scene._cylinderPosTemp.z = THREE.MathUtils.clamp(scene._cylinderPosTemp.z, -cylZLimit, cylZLimit);
    scene._cylinderPosTemp.y = THREE.MathUtils.clamp(scene._cylinderPosTemp.y, scene.floorTopY + 120, scene.ceilingY * 0.46);
    scene._lastCylinderWorldPos.copy(scene._cylinderPosTemp);

    scene._cylinderSideTemp.crossVectors(scene._trailHeadDirCylinder, scene._cylinderAxisUp);
    if (scene._cylinderSideTemp.lengthSq() < 1e-8) {
        scene._cylinderSideTemp.crossVectors(scene._trailHeadDirCylinder, scene._cylinderFallbackAxis);
    }
    scene._cylinderSideTemp.normalize();
    scene._cylinderDirTemp.crossVectors(scene._cylinderSideTemp, scene._trailHeadDirCylinder).normalize();
    scene._cylinderQuatTemp.setFromUnitVectors(scene._cylinderAxisUp, scene._cylinderDirTemp);
    
    const tiltXRad = (shardNoise(ci * 0.13, scene.time * 0.03, 1.07) - 0.5) * 0.55;
    scene._cylinderTiltXQuat.setFromAxisAngle(scene._cylinderSideTemp, tiltXRad);
    scene._cylinderQuatTemp.premultiply(scene._cylinderTiltXQuat);
    
    const rollRad = scene._cylinderHelixPhase;
    scene._cylinderRollQuat.setFromAxisAngle(scene._trailHeadDirCylinder, rollRad);
    scene._cylinderHelixPhase += scene._cylinderHelixTwistPerSpawn;
    scene._cylinderHelixPhase = THREE.MathUtils.euclideanModulo(scene._cylinderHelixPhase + Math.PI, Math.PI * 2) - Math.PI;
    scene._cylinderQuatTemp.premultiply(scene._cylinderRollQuat);

    scene._cylinderScaleTemp.set(radius * 0.02, length * 0.02, radius * 0.02);
    scene._cylinderMatrixTemp.compose(scene._cylinderPosTemp, scene._cylinderQuatTemp, scene._cylinderScaleTemp);
    scene.cylinderInstMesh.setMatrixAt(slotIndex, scene._cylinderMatrixTemp);
    scene.cylinderInstMesh.instanceMatrix.needsUpdate = true;
    if (scene._cylinderOpacityAttr) {
        scene._cylinderOpacityAttr.array[slotIndex] = 1;
        scene._cylinderOpacityAttr.needsUpdate = true;
    }
    randomCylinderTintNearBase(scene._cylinderTintTemp);
    scene.cylinderInstMesh.setColorAt(slotIndex, scene._cylinderTintTemp);
    if (scene.cylinderInstMesh.instanceColor) {
        scene.cylinderInstMesh.instanceColor.needsUpdate = true;
    }

    scene.cylinders.push({
        slotIndex,
        spawnTime: performance.now(),
        localPos: scene._cylinderPosTemp.clone(),
        localQuat: scene._cylinderQuatTemp.clone(),
        baseRadius: radius,
        baseLength: length,
        growInMs: growInMsFromDuration(dur, scene.cylinderGrowInMs)
    });
    scene.triggerRedCylinderBurst(scene._lastCylinderWorldPos, velocity, durationMs);
    scene.ambientDust?.spawnBurst(scene._lastCylinderWorldPos, scene.ambientParticlesPerCylinder);
}

/**
 * スロットの割り当て
 */
export function allocCylinderSlot(scene) {
    if (scene.cylinders.length >= scene.maxCylinders) {
        const old = scene.cylinders.shift();
        clearCylinderSlot(scene, old.slotIndex);
        return old.slotIndex;
    }
    return scene._cylinderFreeSlots.pop();
}

/**
 * スロットのクリア
 */
export function clearCylinderSlot(scene, slotIndex) {
    if (!scene.cylinderInstMesh || slotIndex < 0 || slotIndex >= scene.maxCylinders) return;
    scene._cylinderPosTemp.set(0, -1e6, 0);
    scene._cylinderQuatTemp.identity();
    scene._cylinderScaleTemp.set(0, 0, 0);
    scene._cylinderMatrixTemp.compose(scene._cylinderPosTemp, scene._cylinderQuatTemp, scene._cylinderScaleTemp);
    scene.cylinderInstMesh.setMatrixAt(slotIndex, scene._cylinderMatrixTemp);
    if (scene._cylinderOpacityAttr) {
        scene._cylinderOpacityAttr.array[slotIndex] = 0;
        scene._cylinderOpacityAttr.needsUpdate = true;
    }
    scene.cylinderInstMesh.setColorAt(slotIndex, scene._instanceWhite);
    if (scene.cylinderInstMesh.instanceColor) {
        scene.cylinderInstMesh.instanceColor.needsUpdate = true;
    }
}

/**
 * 期限切れのシリンダーの削除
 */
export function pruneExpiredCylinders(scene) {
    if (!scene.cylinders.length || !scene.cylinderInstMesh) return;
    const now = performance.now();
    const life = scene.cylinderLifetimeMs;
    let matrixDirty = false;
    for (let i = scene.cylinders.length - 1; i >= 0; i--) {
        const c = scene.cylinders[i];
        if (now - c.spawnTime > life) {
            clearCylinderSlot(scene, c.slotIndex);
            scene._cylinderFreeSlots.push(c.slotIndex);
            scene.cylinders.splice(i, 1);
            matrixDirty = true;
        }
    }
    while (scene.cylinders.length > scene.maxCylinders) {
        const old = scene.cylinders.shift();
        clearCylinderSlot(scene, old.slotIndex);
        scene._cylinderFreeSlots.push(old.slotIndex);
        matrixDirty = true;
    }
    if (matrixDirty && scene.cylinderInstMesh) {
        scene.cylinderInstMesh.instanceMatrix.needsUpdate = true;
    }
}

/**
 * シリンダーのフェード・グロウ更新
 */
export function updateCylinderFadeOpacity(scene, now) {
    if (scene._cylinderOpacityAttr && scene.cylinders.length) {
        const arr = scene._cylinderOpacityAttr.array;
        let dirty = false;
        let matrixDirty = false;
        for (const c of scene.cylinders) {
            const age = now - c.spawnTime;
            const op = fadeOpacity01(age, scene.cylinderLifetimeMs, scene.cylinderFadeOutMs);
            const i = c.slotIndex;
            if (Math.abs(arr[i] - op) > 1e-4) {
                arr[i] = op;
                dirty = true;
            }
            const grow = growScale01(age, c.growInMs ?? scene.cylinderGrowInMs);
            if (grow < 0.999 && c.baseRadius != null && c.baseLength != null && c.localPos && c.localQuat) {
                scene._cylinderScaleTemp.set(c.baseRadius * grow, c.baseLength * grow, c.baseRadius * grow);
                scene._cylinderMatrixTemp.compose(c.localPos, c.localQuat, scene._cylinderScaleTemp);
                scene.cylinderInstMesh.setMatrixAt(i, scene._cylinderMatrixTemp);
                matrixDirty = true;
            }
        }
        if (dirty) scene._cylinderOpacityAttr.needsUpdate = true;
        if (matrixDirty && scene.cylinderInstMesh) scene.cylinderInstMesh.instanceMatrix.needsUpdate = true;
    }
}

/**
 * シリンダーバーストパーティクルの初期化
 */
export function initRedCylinderBurstParticles(scene) {
    if (scene.redBurstInstMesh) return;
    const n = scene.redBurstParticleCount;
    scene._redBurstPositions = new Float32Array(n * 3);
    scene._redBurstVelocities = new Float32Array(n * 3);
    scene._redBurstColors = new Float32Array(n * 3);
    scene._redBurstRotQuats = new Float32Array(n * 4);
    scene._redBurstScales = new Float32Array(n);
    scene.redBurstSharedGeo = new THREE.DodecahedronGeometry(1, 0);
    scene.redBurstMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.96,
        emissive: 0x080808,
        emissiveIntensity: 0.05,
        vertexColors: true,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        fog: true
    });
    scene.redBurstInstMesh = new THREE.InstancedMesh(scene.redBurstSharedGeo, scene.redBurstMaterial, n);
    scene.redBurstInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.redBurstInstMesh.frustumCulled = false;
    scene.redBurstInstMesh.visible = false;
    const hidePos = new THREE.Vector3(0, -1e6, 0);
    const hideQuat = new THREE.Quaternion();
    const hideScale = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < n; i++) {
        scene._redBurstMatrixTemp.compose(hidePos, hideQuat, hideScale);
        scene.redBurstInstMesh.setMatrixAt(i, scene._redBurstMatrixTemp);
        scene.redBurstInstMesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    scene.redBurstInstMesh.instanceMatrix.needsUpdate = true;
    if (scene.redBurstInstMesh.instanceColor) scene.redBurstInstMesh.instanceColor.needsUpdate = true;
    scene.scene.add(scene.redBurstInstMesh);
}

/**
 * シリンダーバーストのトリガー
 */
export function triggerRedCylinderBurst(scene, worldPos, velocity = 127, durationMs = 180) {
    if (!scene.redBurstInstMesh || !scene._redBurstPositions || !scene._redBurstVelocities) return;
    const n = scene.redBurstParticleCount;
    const vMidi = normalizeMidiVelocity(velocity) / 127;
    const durN = THREE.MathUtils.clamp((Number(durationMs) || 180) / 900, 0.35, 2.2);
    const baseSpeed = 130 + vMidi * 520;
    const spread = 12 + vMidi * 56;
    for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const dx = Math.sin(ph) * Math.cos(th);
        const dy = Math.cos(ph);
        const dz = Math.sin(ph) * Math.sin(th);
        const r = Math.random() * spread;
        scene._redBurstPositions[i3] = worldPos.x + dx * r;
        scene._redBurstPositions[i3 + 1] = worldPos.y + dy * r;
        scene._redBurstPositions[i3 + 2] = worldPos.z + dz * r;
        const sp = baseSpeed * (0.45 + Math.random() * 1.2);
        scene._redBurstVelocities[i3] = dx * sp;
        scene._redBurstVelocities[i3 + 1] = dy * sp + 35;
        scene._redBurstVelocities[i3 + 2] = dz * sp;
        const qi = i * 4;
        scene._redBurstQuatTemp.setFromEuler(
            new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 'XYZ')
        );
        scene._redBurstRotQuats[qi] = scene._redBurstQuatTemp.x;
        scene._redBurstRotQuats[qi + 1] = scene._redBurstQuatTemp.y;
        scene._redBurstRotQuats[qi + 2] = scene._redBurstQuatTemp.z;
        scene._redBurstRotQuats[qi + 3] = scene._redBurstQuatTemp.w;
        scene._redBurstScales[i] = 1.3 + Math.random() * 3.9;
    }
    scene._redBurstAgeSec = 0;
    scene._redBurstLifeSec = THREE.MathUtils.clamp(0.9 * durN, 0.38, 1.95);
    scene._redBurstActive = true;
    scene.redBurstInstMesh.visible = true;
    scene.redBurstMaterial.opacity = 0.95;
}

/**
 * シリンダーバーストパーティクルの更新
 */
export function updateRedCylinderBurstParticles(scene, deltaTime) {
    if (!scene._redBurstActive || !scene.redBurstInstMesh || !scene._redBurstPositions || !scene._redBurstVelocities || !scene._redBurstColors) return;
    const dt = Math.min(deltaTime, 0.05);
    scene._redBurstAgeSec += dt;
    const n = scene.redBurstParticleCount;
    const drag = Math.exp(-dt * 2.4);
    const gravity = 170;
    const curlFreq = scene.redBurstCurlFreq;
    const curlStr = scene.redBurstCurlStrength;
    const tt = scene.time;
    for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const px = scene._redBurstPositions[i3];
        const py = scene._redBurstPositions[i3 + 1];
        const pz = scene._redBurstPositions[i3 + 2];
        const seed = shardNoise(i * 0.173, 4.37, 9.11);
        const jitterAmp = 220;
        const sx = px + (seed - 0.5) * jitterAmp;
        const sy = py + (shardNoise(i * 0.127, 7.91, 2.13) - 0.5) * jitterAmp;
        const sz = pz + (shardNoise(i * 0.097, 1.77, 5.59) - 0.5) * jitterAmp;
        sampleCurlNoiseVectorInto(
            scene._redBurstCurlTemp,
            sx, sy, sz,
            tt + seed * 6.0,
            curlFreq * 1.7,
            12.0,
            seed
        );
        const turbX = (shardNoise(sx * 0.0061, sy * 0.0043, tt * 0.73 + seed * 3.1) - 0.5) * 2.0;
        const turbY = (shardNoise(sy * 0.0057, sz * 0.0047, tt * 0.89 + seed * 1.7) - 0.5) * 2.0;
        const turbZ = (shardNoise(sz * 0.0063, sx * 0.0041, tt * 0.67 + seed * 2.9) - 0.5) * 2.0;
        const curlX = scene._redBurstCurlTemp.x + turbX * 0.62;
        const curlY = scene._redBurstCurlTemp.y + turbY * 0.62;
        const curlZ = scene._redBurstCurlTemp.z + turbZ * 0.62;
        scene._redBurstVelocities[i3] *= drag;
        scene._redBurstVelocities[i3 + 1] = scene._redBurstVelocities[i3 + 1] * drag - gravity * dt;
        scene._redBurstVelocities[i3 + 2] *= drag;
        scene._redBurstVelocities[i3] += curlX * curlStr * dt;
        scene._redBurstVelocities[i3 + 1] += curlY * curlStr * dt;
        scene._redBurstVelocities[i3 + 2] += curlZ * curlStr * dt;
        scene._redBurstPositions[i3] += scene._redBurstVelocities[i3] * dt;
        scene._redBurstPositions[i3 + 1] += scene._redBurstVelocities[i3 + 1] * dt;
        scene._redBurstPositions[i3 + 2] += scene._redBurstVelocities[i3 + 2] * dt;
        const sp = Math.sqrt(
            scene._redBurstVelocities[i3] * scene._redBurstVelocities[i3] +
            scene._redBurstVelocities[i3 + 1] * scene._redBurstVelocities[i3 + 1] +
            scene._redBurstVelocities[i3 + 2] * scene._redBurstVelocities[i3 + 2]
        );
        const ageT = THREE.MathUtils.clamp(scene._redBurstAgeSec / scene._redBurstLifeSec, 0, 1);
        const heat = THREE.MathUtils.clamp((sp / 520) * (1.0 - ageT * 0.6), 0, 1);
        setHeatmapColor01(heat, i3, scene._redBurstColors);
        const qi = i * 4;
        scene._redBurstQuatTemp.set(
            scene._redBurstRotQuats[qi],
            scene._redBurstRotQuats[qi + 1],
            scene._redBurstRotQuats[qi + 2],
            scene._redBurstRotQuats[qi + 3]
        );
        scene._redBurstQuatTemp.normalize();
        scene._redBurstPosTemp.set(scene._redBurstPositions[i3], scene._redBurstPositions[i3 + 1], scene._redBurstPositions[i3 + 2]);
        const s = scene._redBurstScales[i];
        scene._redBurstScaleTemp.set(s, s, s);
        scene._redBurstMatrixTemp.compose(scene._redBurstPosTemp, scene._redBurstQuatTemp, scene._redBurstScaleTemp);
        scene.redBurstInstMesh.setMatrixAt(i, scene._redBurstMatrixTemp);
        scene._redBurstColorTemp.setRGB(
            scene._redBurstColors[i3],
            scene._redBurstColors[i3 + 1],
            scene._redBurstColors[i3 + 2]
        );
        scene.redBurstInstMesh.setColorAt(i, scene._redBurstColorTemp);
    }
    scene.redBurstInstMesh.instanceMatrix.needsUpdate = true;
    if (scene.redBurstInstMesh.instanceColor) scene.redBurstInstMesh.instanceColor.needsUpdate = true;
    const t = THREE.MathUtils.clamp(scene._redBurstAgeSec / scene._redBurstLifeSec, 0, 1);
    scene.redBurstMaterial.opacity = 1 - t * t * (3 - 2 * t);
    if (t >= 1) {
        scene._redBurstActive = false;
        scene.redBurstInstMesh.visible = false;
        scene.redBurstMaterial.opacity = 0.0;
    }
}

/**
 * 内部ユーティリティ：ベロシティからシリンダー長を計算
 */
function cylinderLengthFromVelocityMidi(vMidi) {
    const v = THREE.MathUtils.clamp(Number(vMidi) || 0, 0, 127);
    const tLin = v / 127;
    const tLog = Math.log1p(v) / Math.log1p(127);
    const t = THREE.MathUtils.lerp(tLog, tLin, 0.72);
    const lenMin = 88;
    const lenMax = 340;
    return THREE.MathUtils.lerp(lenMin, lenMax, t);
}

/**
 * 内部ユーティリティ：デュレーションからシリンダー半径を計算
 */
function cylinderRadiusFromDurationMs(durationMs) {
    const d = Math.max(8, Number(durationMs) || 180);
    const dMin = 20;
    const dMax = 2400;
    const tLin = THREE.MathUtils.clamp((d - dMin) / (dMax - dMin), 0, 1);
    const tLog = THREE.MathUtils.clamp(Math.log(d / dMin) / Math.log(dMax / dMin), 0, 1);
    const t = THREE.MathUtils.lerp(tLog, tLin, 0.85);
    const radMin = 10;
    const radMax = 34;
    return THREE.MathUtils.lerp(radMin, radMax, t);
}

/**
 * 内部ユーティリティ：シリンダーの色をランダムに設定
 */
function randomCylinderTintNearBase(out) {
    out.setHex(0xcc4624);
    out.offsetHSL(0, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.11);
}
