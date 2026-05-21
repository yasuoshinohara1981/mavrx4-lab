import * as THREE from 'three';

/**
 * Scene1 カメラ・トレイル・ノイズ関連のロジック
 */

/**
 * 簡易ノイズ関数
 */
export function shardNoise(x, y, z) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * カールノイズベクトルのサンプリング
 */
export function sampleCurlNoiseVector(pos, time, freq = 0.001, eps = 7.5) {
    const px = pos.x * freq;
    const py = pos.y * freq;
    const pz = pos.z * freq;
    const t = time * 0.16;
    const e = eps * freq;
    const n = (x, y, z) => shardNoise(x + t * 0.71, y - t * 0.53, z + t * 0.37);
    const dx = n(px + e, py, pz) - n(px - e, py, pz);
    const dy = n(px, py + e, pz) - n(px, py - e, pz);
    const dz = n(px, py, pz + e) - n(px, py, pz - e);
    return new THREE.Vector3(dy - dz, dz - dx, dx - dy);
}

/**
 * シリンダー用のブレンドされたカールノイズ
 */
export function sampleCurlNoiseVectorCylinderBlend(pos, time, freq, eps, cylinderCurlFieldOffset) {
    const p = pos.clone().add(cylinderCurlFieldOffset);
    const a = sampleCurlNoiseVector(p, time, freq, eps);
    const b = sampleCurlNoiseVector(p, time + 19.3, freq * 2.15, eps * 0.92);
    const c = sampleCurlNoiseVector(p, time + 41.7, freq * 0.48, eps * 1.06);
    if (a.lengthSq() > 1e-12) a.normalize();
    if (b.lengthSq() > 1e-12) b.normalize();
    if (c.lengthSq() > 1e-12) c.normalize();
    a.multiplyScalar(0.48);
    b.multiplyScalar(0.32);
    c.multiplyScalar(0.2);
    a.add(b).add(c);
    if (a.lengthSq() > 1e-12) a.normalize();
    return a;
}

/**
 * 出力先ベクトルを指定したカールノイズサンプリング
 */
export function sampleCurlNoiseVectorInto(out, x, y, z, time, freq = 0.001, eps = 7.5, seed = 0) {
    const px = x * freq;
    const py = y * freq;
    const pz = z * freq;
    const t = time * 0.16;
    const e = eps * freq;
    const n = (xx, yy, zz) => shardNoise(
        xx + t * (0.71 + seed * 0.13),
        yy - t * (0.53 - seed * 0.09),
        zz + t * (0.37 + seed * 0.11)
    );
    const dx = n(px + e, py, pz) - n(px - e, py, pz);
    const dy = n(px, py + e, pz) - n(px, py - e, pz);
    const dz = n(px, py, pz + e) - n(px, py, pz - e);
    out.set(dy - dz, dz - dx, dx - dy);
    return out;
}

/**
 * トレイル用のノイズ回転（Quaternion）の生成
 */
export function composeTrailNoiseQuat(seed, time, pitchAmp, yawAmp, rollAmp) {
    const t = time;
    const nX = shardNoise(seed * 0.61, t * 0.11, 2.3) * 2 - 1;
    const nY = shardNoise(3.7, seed * 0.47, t * 0.09) * 2 - 1;
    const nZ = shardNoise(t * 0.08, 6.1, seed * 0.53) * 2 - 1;
    return new THREE.Quaternion().setFromEuler(
        new THREE.Euler(nX * pitchAmp, nY * yawAmp, nZ * rollAmp, 'YXZ')
    );
}

/**
 * 単一のトレイルヘッドの更新
 */
export function updateTrailHeadSingle(scene, pos, dir, deltaTime, timeOffset, speed, curlFreq, curlStrength, isCylinderTrail = false) {
    const dt = Math.min(Math.max(deltaTime, 0), 0.05);
    const curl = isCylinderTrail
        ? sampleCurlNoiseVectorCylinderBlend(
              pos,
              scene.time + timeOffset,
              curlFreq,
              scene._trailCurlEpsCylinder ?? 7.5,
              scene._cylinderCurlFieldOffset
          )
        : sampleCurlNoiseVector(pos, scene.time + timeOffset, curlFreq);
    if (curl.lengthSq() > 1e-9) curl.normalize();

    dir.addScaledVector(curl, curlStrength * dt);
    const pullMag = isCylinderTrail ? (scene._trailCenterPullCylinder ?? 0) : scene._trailCenterPull;
    if (pullMag > 1e-6) {
        const toCenter = scene._trailCenter.clone().sub(pos);
        if (isCylinderTrail) toCenter.y = 0;
        const centerDist = Math.max(1, toCenter.length());
        if (toCenter.lengthSq() > 1e-12) {
            toCenter.normalize();
            const centerPull = pullMag * THREE.MathUtils.clamp(centerDist / 2400, 0.08, 1.0);
            dir.addScaledVector(toCenter, centerPull * dt);
        }
    }
    if (!isCylinderTrail) dir.y *= 0.92;
    dir.normalize();

    pos.addScaledVector(dir, speed * dt);

    const xLim = scene.roomHalfW * 0.55;
    const zLim = scene.roomHalfD * 0.55;
    pos.x = THREE.MathUtils.clamp(pos.x, -xLim, xLim);
    pos.z = THREE.MathUtils.clamp(pos.z, -zLim, zLim);
    const yMin = scene.floorTopY + 130;
    const yMax = scene.ceilingY * 0.43;

    if (isCylinderTrail) {
        pos.y = THREE.MathUtils.clamp(pos.y, yMin, yMax);
    } else {
        const base = (shardNoise((scene.time + timeOffset) * 0.08, 9.1, 4.2) - 0.5) * 620;
        const yTarget = scene._trailCenter.y + base;
        pos.y = THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(pos.y, yTarget, 0.38 * dt * 60),
            yMin,
            yMax
        );
    }
}

/**
 * 全トレイルヘッドの更新
 */
export function updateTrailHeadMotion(scene, deltaTime) {
    updateTrailHeadSingle(
        scene,
        scene._trailHeadPosShard,
        scene._trailHeadDirShard,
        deltaTime,
        0.0,
        scene._trailSpeedShard ?? scene._trailSpeed,
        scene._trailCurlFreqShard ?? scene._trailCurlFreq,
        scene._trailCurlStrengthShard ?? scene._trailCurlStrength
    );
    updateTrailHeadSingle(
        scene,
        scene._trailHeadPosCylinder,
        scene._trailHeadDirCylinder,
        deltaTime,
        37.0,
        scene._trailSpeedCylinder ?? scene._trailSpeed,
        scene._trailCurlFreqCylinder ?? scene._trailCurlFreq,
        scene._trailCurlStrengthCylinder ?? scene._trailCurlStrength,
        true
    );

    scene._trailHeadPos.copy(scene._trailHeadPosShard);
    scene._trailHeadDir.copy(scene._trailHeadDirShard);
    scene._lastShardPos.copy(scene._trailHeadPosShard);
    scene._lastCylinderWorldPos.copy(scene._trailHeadPosCylinder);
}

/**
 * スポーン位置に基づくカメラ注視点の更新
 */
export function updateCameraFocusFromSpawns(scene) {
    const hasS = scene.shards.length > 0 && scene.shardInstMesh && scene.shardGroup;
    const hasC = scene.cylinders.length > 0 && scene.cylinderInstMesh;

    if (!hasS && !hasC) {
        if (scene.cableBlobParticle) {
            scene._spawnFocusWorld.copy(scene.cableBlobParticle.position);
        }
        return;
    }

    const now = performance.now();

    if (hasS) {
        const s = scene.shards[scene.shards.length - 1];
        scene.shardInstMesh.getMatrixAt(s.slotIndex, scene._shardMatrixTemp);
        scene._shardPosTemp.setFromMatrixPosition(scene._shardMatrixTemp);
        scene.shardGroup.updateMatrixWorld(true);
        scene.shardGroup.localToWorld(scene._shardPosTemp);
    }
    if (hasC) {
        const c = scene.cylinders[scene.cylinders.length - 1];
        scene.cylinderInstMesh.getMatrixAt(c.slotIndex, scene._cylinderMatrixTemp);
        scene._cylinderPosTemp.setFromMatrixPosition(scene._cylinderMatrixTemp);
    }

    if (hasS && hasC) {
        const eps = 80;
        const ageS = Math.max(0, now - scene.shards[scene.shards.length - 1].spawnTime);
        const ageC = Math.max(0, now - scene.cylinders[scene.cylinders.length - 1].spawnTime);
        const wS = 1 / (eps + ageS);
        const wC = 1 / (eps + ageC);
        const inv = 1 / (wS + wC);
        scene._spawnFocusWorld.copy(scene._shardPosTemp).multiplyScalar(wS * inv);
        scene._spawnFocusWorld.addScaledVector(scene._cylinderPosTemp, wC * inv);
    } else if (hasS) {
        scene._spawnFocusWorld.copy(scene._shardPosTemp);
    } else {
        scene._spawnFocusWorld.copy(scene._cylinderPosTemp);
    }
}

/**
 * カメラ位置と向きの更新
 */
export function updateCamera(scene) {
    if (scene.cameraParticles[scene.currentCameraIndex]) {
        const cp = scene.cameraParticles[scene.currentCameraIndex];
        const cameraPos = cp.getPosition();
        const dist = cameraPos.length();
        if (dist < cp.minDistance) {
            cameraPos.normalize().multiplyScalar(cp.minDistance);
        }
        scene.camera.position.copy(cameraPos);
        scene.camera.lookAt(
            scene._cameraFocusSmoothed.x,
            scene._cameraFocusSmoothed.y,
            scene._cameraFocusSmoothed.z
        );
        scene.camera.matrixWorldNeedsUpdate = false;
    }
}

/**
 * 部屋内のノイズベース目標座標のサンプリング
 */
export function sampleNoisePosition(scene) {
    const s = scene._shardSeed + scene._snakeIndex * 0.019;
    const u = shardNoise(s * 0.002, 2.3, 4.1) * 2 - 1;
    const v = shardNoise(1.1, s * 0.002, 2.3) * 2 - 1;
    const w = shardNoise(1.1, 2.3, s * 0.002) * 2 - 1;
    const hw = scene.roomHalfW * 0.58;
    const hd = scene.roomHalfD * 0.58;
    const ymin = scene.floorTopY + 140;
    const ymax = scene.ceilingY * 0.44;
    return new THREE.Vector3(u * hw, ymin + (w * 0.5 + 0.5) * (ymax - ymin), v * hd);
}

/**
 * シーケンスに応じたジッターの適用
 */
export function applySequenceAwareJitter(scene, pos, deltaTick, forwardDir, seedA, seedB) {
    const gap = Math.max(0, deltaTick - 0.22);
    const t = THREE.MathUtils.clamp(Math.log1p(gap) / Math.log1p(72), 0, 1);
    const amp = THREE.MathUtils.lerp(14, 420, t);
    const worldUp = new THREE.Vector3(0, 1, 0);
    scene._jitterSide.crossVectors(worldUp, forwardDir);
    if (scene._jitterSide.lengthSq() < 1e-8) {
        scene._jitterSide.crossVectors(new THREE.Vector3(1, 0, 0), forwardDir);
    }
    scene._jitterSide.normalize();
    scene._jitterUp.crossVectors(forwardDir, scene._jitterSide);
    scene._jitterUp.normalize();
    const a1 = (shardNoise(seedA, seedB, 0.11) - 0.5) * 2;
    const a2 = (shardNoise(seedB, seedA, 0.22) - 0.5) * 2;
    const a3 = (shardNoise(seedA * 0.31, seedB * 0.29, 0.33) - 0.5) * 2;
    pos.addScaledVector(scene._jitterSide, a1 * amp * 0.52);
    pos.addScaledVector(scene._jitterUp, a2 * amp * 0.44);
    pos.addScaledVector(worldUp, a3 * amp * 0.26);
}
