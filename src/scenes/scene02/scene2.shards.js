import * as THREE from 'three';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { Scene2Particle } from './Scene2Particle.js';
import { setRandomBlueGrayParticleColor, setHeatmapColorFromUnit } from './scene2.helpers.js';
import { generateRockPBRTextures } from '../../lib/RockPBRTextures.js';

/**
 * Scene2 パーティクル（立方体インスタンス）関連のロジック
 */

/**
 * 立方体インスタンスの作成
 */
export function createSpheres(scene) {
    const n = scene.sphereCount;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    {
        const nv = geo.attributes.position.count;
        const white = new Float32Array(nv * 3);
        white.fill(1);
        geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
    }
    
    // メインパーティクル用に岩石テクスチャを生成
    const rockTex = generateRockPBRTextures(512, { seed: 789, maxAnisotropy: 4 });

    /** ヒートマップ時は緑アルbedo／透過を使わない（頂点色 × map で暖色が消えるのを防ぐ） */
    const mat = scene.useHeatmapParticleColors
        ? new THREE.MeshStandardMaterial({
            color: 0xd8d8d8,
            roughness: 0.52,
            metalness: 0.04,
            envMapIntensity: 0.52,
            fog: true,
            vertexColors: false // ヒートマップを使わないので頂点色は不要
        })
        : new THREE.MeshPhysicalMaterial({
            color: 0xd0d0d0,
            map: rockTex.map,
            normalMap: rockTex.normalMap,
            roughnessMap: rockTex.roughnessMap,
            aoMap: rockTex.aoMap,
            roughness: 0.38,
            metalness: 0.18,
            clearcoat: 0.38,
            clearcoatRoughness: 0.22,
            envMapIntensity: 0.72,
            specularIntensity: 0.62,
            transmission: 0.0, // 透過を完全にオフにして緑っぽさを排除
            thickness: 0.0,
            ior: 1.6,
            attenuationColor: new THREE.Color(0xffffff), // 無彩色に
            attenuationDistance: 1.0,
            emissive: new THREE.Color(0x000000), // エミッシブもオフ
            emissiveIntensity: 0.0,
            fog: true,
            vertexColors: false // 頂点色は使わずベースカラーのみ
        });
    if (scene.scene?.environment) mat.envMap = scene.scene.environment;

    scene.instancedMeshManager = new InstancedMeshManager(scene.scene, geo, mat, n);
    const mainMesh = scene.instancedMeshManager.getMainMesh();
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;

    for (let i = 0; i < n; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = Math.pow(Math.random(), 1.5) * scene.spawnRadius;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        let worldR;
        const sizeRand = Math.random();
        if (sizeRand < 0.7) worldR = 10 + Math.random() * 10;
        else if (sizeRand < 0.95) worldR = 20 + Math.random() * 12;
        else worldR = 32 + Math.random() * 14;

        const scale = new THREE.Vector3(worldR, worldR, worldR);
        const radius = Math.max(scale.x, scale.y, scale.z) * 0.5;
        const p = new Scene2Particle(x, y, z, radius, scale);
        p.angularVelocity.multiplyScalar(2.0);
        scene.particles.push(p);

        if (scene.useHeatmapParticleColors) {
            setHeatmapColorFromUnit(0, scene._colorTmp);
        } else {
            setRandomBlueGrayParticleColor(scene._colorTmp);
        }
        scene.instancedMeshManager.setColorAt(i, scene._colorTmp);
        scene.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
    }
    scene.instancedMeshManager.markColorsNeedsUpdate();
    scene.instancedMeshManager.markNeedsUpdate();
    scene.setParticleCount(n);
}

/**
 * 物理演算の更新
 */
export function updatePhysics(scene, deltaTime) {
    const subSteps = 2;
    const dt = deltaTime / subSteps;
    const halfSize = 4950;
    const tempVec = new THREE.Vector3();
    const visibleCount = Math.min(scene.currentVisibleCount || 0, scene.particles.length);
    const heatSmooth = scene.heatmapColorSmoothing ?? 0.45;
    const heatGamma = scene.heatmapResponseGamma ?? 0.4;
    const heatVelBlend = scene.heatmapVelocityBlend ?? 0;

    if (scene.useHeatmapParticleColors) {
        for (let i = 0; i < visibleCount; i++) {
            scene.particles[i].frameForceMax = 0;
        }
    }

    for (let s = 0; s < subSteps; s++) {
        scene.grid.clear();
        for (let i = 0; i < visibleCount; i++) {
            const p = scene.particles[i];
            const gx = Math.floor(p.position.x / scene.gridSize);
            const gy = Math.floor(p.position.y / scene.gridSize);
            const gz = Math.floor(p.position.z / scene.gridSize);
            const key = (gx + 100) + (gy + 100) * 200 + (gz + 100) * 40000;
            if (!scene.grid.has(key)) scene.grid.set(key, []);
            scene.grid.get(key).push(i);
        }

            const magmaPos = scene.magma?.position ?? new THREE.Vector3(0, 900, 0);
            const magmaRadius = scene.magma?.radius ?? 0;

            for (let idx = 0; idx < visibleCount; idx++) {
                const p = scene.particles[idx];

                // マグマとの衝突判定
                const diffToMagma = tempVec.copy(p.position).sub(magmaPos);
                const distToMagma = diffToMagma.length();
                if (magmaRadius > 0) {
                    const minDist = magmaRadius + p.radius + 20; // 余裕を持たせる
                    if (distToMagma < minDist) {
                        const pushForce = (minDist - distToMagma) * 0.5;
                        p.addForce(diffToMagma.clone().normalize().multiplyScalar(pushForce));
                        // 速度を外向きに反射させる
                        const dot = p.velocity.dot(diffToMagma);
                        if (dot < 0) {
                            p.velocity.addScaledVector(diffToMagma, -dot * 1.5);
                        }
                    }
                }

                if (scene.currentMode === scene.MODE_DRIFT_FIELD) {
                    // マグマの周りを漂うフィールド
                    const tt = scene.time;
                    const noiseScale = 0.001;
                    const fx = Math.sin(p.position.y * noiseScale + tt * 0.37) * Math.cos(p.position.z * noiseScale + tt * 0.21);
                    const fy = Math.sin(p.position.z * noiseScale + tt * 0.29) * Math.cos(p.position.x * noiseScale + tt * 0.18);
                    const fz = Math.sin(p.position.x * noiseScale + tt * 0.33) * Math.cos(p.position.y * noiseScale + tt * 0.24);
                    
                    // マグマへの緩やかな引力
                    const pull = diffToMagma.clone().normalize().multiplyScalar(-0.05);
                    p.addForce(tempVec.set(fx, fy, fz).multiplyScalar(38 * p.strayFactor).add(pull));

                } else if (scene.currentMode === scene.MODE_UPTHRUST) {
                    // マグマから噴き出すような上昇気流
                    p.velocity.multiplyScalar(0.97);
                    const horizontalPull = diffToMagma.clone();
                    horizontalPull.y = 0;
                    const distH = horizontalPull.length();
                    const inward = horizontalPull.normalize().multiplyScalar(-distH * 0.001); // 中心に寄せる
                    tempVec.set(inward.x, 18 * p.strayFactor, inward.z);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_HELIX_RAIL) {
                    // マグマを中心とした垂直螺旋
                    const R = (magmaRadius + 250) * p.strayRadiusOffset;
                    const theta = idx * 0.12 + p.phaseOffset * 0.4 + scene.time * 0.5;
                    const ty = ((theta * 0.42 * 180) % 2500) - 1000 + magmaPos.y;
                    const tx = magmaPos.x + Math.cos(theta) * R;
                    const tz = magmaPos.z + Math.sin(theta) * R;
                    
                    const springK = 0.05 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_LEMNISCATE) {
                    // マグマを貫く8の字軌道（クロス）
                    const t = scene.time * 0.6 + idx * 0.0012 + p.phaseOffset;
                    const a = (magmaRadius + 450) * p.strayRadiusOffset;
                    const tx = magmaPos.x + (a * Math.sin(t)) / (1 + Math.sin(t) * Math.sin(t));
                    const ty = magmaPos.y + a * 0.5 * Math.sin(t) * Math.cos(t);
                    const tz = magmaPos.z + a * 0.6 * Math.sin(2 * t);
                    
                    const springK = 0.015 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_HONEYCOMB) {
                    // マグマを囲む多層リング（円環状）
                    const ringIdx = idx % 5;
                    const angle = (idx / scene.sphereCount) * Math.PI * 2 + scene.time * 0.2;
                    const R = (magmaRadius + 150 + ringIdx * 180) * p.strayRadiusOffset;
                    const tx = magmaPos.x + Math.cos(angle) * R;
                    const tz = magmaPos.z + Math.sin(angle) * R;
                    const ty = magmaPos.y + (ringIdx - 2) * 120 + Math.sin(scene.time + idx) * 30;
                    
                    const springK = 0.02 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_BEAT_INTERFERENCE) {
                    // マグマの上下で交差する波（クロス）
                    const t = scene.time * 0.8;
                    const R = (magmaRadius + 400) * p.strayRadiusOffset;
                    const angle = (idx / scene.sphereCount) * Math.PI * 2;
                    const side = idx % 2 === 0 ? 1 : -1;
                    
                    const tx = magmaPos.x + Math.cos(angle) * R;
                    const tz = magmaPos.z + Math.sin(angle) * R;
                    const ty = magmaPos.y + side * (Math.sin(t + angle * 4) * 400);
                    
                    const springK = 0.015 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_BINARY_ROTATE) {
                    // マグマを軸にした二重回転リング（円環状）
                    const t = scene.time * 0.5;
                    const R = (magmaRadius + 350) * p.strayRadiusOffset;
                    const orbitIdx = idx % 2;
                    const speed = orbitIdx === 0 ? 1 : -1.2;
                    const angle = (idx / (scene.sphereCount/2)) * Math.PI * 2 + t * speed;
                    
                    const tx = magmaPos.x + Math.cos(angle) * R;
                    const tz = magmaPos.z + Math.sin(angle) * R;
                    const ty = magmaPos.y + Math.cos(t * 0.5 + orbitIdx * Math.PI) * 250;
                    
                    const springK = 0.025 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_DNA_HELIX) {
                    // マグマを包む二重螺旋（円環＋垂直）
                    const strand = idx % 2;
                    const along = (idx / scene.sphereCount);
                    const theta = along * Math.PI * 8 + scene.time * 1.0;
                    const R = (magmaRadius + 200) * p.strayRadiusOffset;
                    const tx = magmaPos.x + Math.cos(theta + strand * Math.PI) * R;
                    const tz = magmaPos.z + Math.sin(theta + strand * Math.PI) * R;
                    const ty = magmaPos.y + (along - 0.5) * 2000;
                    
                    const springK = 0.02 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_TOROIDAL_VORTEX) {
                    // マグマを囲むドーナツ状の渦（円環状）
                    const diff = tempVec.copy(p.position).sub(magmaPos);
                    const rXZ = Math.sqrt(diff.x * diff.x + diff.z * diff.z) + 1e-4;
                    const targetR = magmaRadius + 400;
                    
                    // 円環への引き寄せ
                    const pullR = (targetR - rXZ) * 0.05;
                    const pullY = (magmaPos.y - p.position.y) * 0.05;
                    
                    // 回転
                    const tangent = new THREE.Vector3(-diff.z, 0, diff.x).normalize().multiplyScalar(15);
                    
                    p.addForce(tangent.add(new THREE.Vector3(diff.x / rXZ * pullR, pullY, diff.z / rXZ * pullR)));

                } else if (scene.currentMode === scene.MODE_TRIPLE_WELL) {
                    // マグマを中心とした三方向へのクロス放射
                    const t = scene.time * 0.5;
                    const dirIdx = idx % 3;
                    const angle = (dirIdx / 3) * Math.PI * 2 + t * 0.2;
                    const dist = ((idx / 3) / (scene.sphereCount / 3)) * 1200;
                    
                    const tx = magmaPos.x + Math.cos(angle) * dist;
                    const ty = magmaPos.y + Math.sin(t + idx * 0.01) * 250;
                    const tz = magmaPos.z + Math.sin(angle) * dist;
                    
                    const springK = 0.01 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_PRECESS_ORBIT) {
                    // マグマを巡る歳差運動軌道（球体状）
                    const t = scene.time * 0.5 + idx * 0.01;
                    const R = (magmaRadius + 500) * p.strayRadiusOffset;
                    const phi = Math.acos(Math.sin(t * 0.3));
                    const theta = t;
                    
                    const tx = magmaPos.x + R * Math.sin(phi) * Math.cos(theta);
                    const ty = magmaPos.y + R * Math.sin(phi) * Math.sin(theta);
                    const tz = magmaPos.z + R * Math.cos(phi);
                    
                    const springK = 0.02 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (scene.currentMode === scene.MODE_SPHERE_SHELL) {
                    const center = scene.magma?.position ?? new THREE.Vector3(0, 900, 0);
                    const baseR = (magmaRadius + 400) * p.strayRadiusOffset;
                    const timeScale = scene.time * 0.3 + p.phaseOffset;
                    const r = baseR + Math.sin(timeScale * 1.5) * 100;
                    
                    const theta = (idx * 0.13 + scene.time * 0.2) % (Math.PI * 2);
                    const phi = (idx * 0.07 + scene.time * 0.15) % Math.PI;
                    
                    const tx = center.x + r * Math.sin(phi) * Math.cos(theta);
                    const ty = center.y + r * Math.cos(phi);
                    const tz = center.z + r * Math.sin(phi) * Math.sin(theta);
                    
                    const shellSpringK = 0.015 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * shellSpringK, (ty - p.position.y) * shellSpringK, (tz - p.position.z) * shellSpringK);
                    p.addForce(tempVec);
                } else if (scene.currentMode === scene.MODE_SPHERE_VORTEX) {
                    const center = scene.magma?.position ?? new THREE.Vector3(0, 900, 0);
                    const diff = tempVec.copy(p.position).sub(center);
                    const dist = diff.length() + 1e-4;
                    
                    // 球体への引き寄せ
                    const targetR = (magmaRadius + 300) * p.strayRadiusOffset;
                const pull = (targetR - dist) * 0.02 * p.strayFactor;
                p.addForce(diff.clone().normalize().multiplyScalar(pull));
                
                // 渦巻き（軸回転）
                const orbitSpeed = 0.8 * p.strayFactor;
                const axis = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(scene.time * 0.2) * 0.5);
                const tangent = new THREE.Vector3().crossVectors(axis, diff).normalize();
                p.addForce(tangent.multiplyScalar(orbitSpeed * 15));
                
                // 極方向への移動
                const up = axis.clone().multiplyScalar(Math.cos(scene.time * 0.5 + p.phaseOffset) * 5 * p.strayFactor);
                p.addForce(up);
            } else {
                const tx = p.targetOffset.x;
                const ty = p.targetOffset.y + 200;
                const tz = p.targetOffset.z;
                const defSpringK = 0.0005 * p.strayFactor;
                tempVec.set((tx - p.position.x) * defSpringK, (ty - p.position.y) * defSpringK, (tz - p.position.z) * defSpringK);
                p.addForce(tempVec);
            }

            if (scene.useHeatmapParticleColors) {
                const fl = p.force.length();
                const capped = Math.min(fl, p.maxForce);
                if (capped > p.frameForceMax) p.frameForceMax = capped;
            }

            p.update();
            p.velocity.multiplyScalar(0.95);

            if (scene.useWallCollision) {
                if (p.position.x > halfSize) { p.position.x = halfSize; p.velocity.x *= -0.3; }
                if (p.position.x < -halfSize) { p.position.x = -halfSize; p.velocity.x *= -0.3; }
                if (p.position.y > 4500) {
                    if (scene.currentMode === scene.MODE_HELIX_RAIL) {
                        p.position.y = -450; p.velocity.y *= 0.1;
                    } else {
                        p.position.y = 4500; p.velocity.y *= -0.3;
                    }
                }
                if (p.position.y < -450) {
                    p.position.y = -450; p.velocity.y *= -0.1;
                    const rollFactor = 0.05 / (p.radius / 30);
                    p.angularVelocity.z = -p.velocity.x * rollFactor;
                    p.angularVelocity.x = p.velocity.z * rollFactor;
                    p.velocity.x *= 0.98; p.velocity.z *= 0.98;
                }
                if (p.position.z > halfSize) { p.position.z = halfSize; p.velocity.z *= -0.3; }
                if (p.position.z < -halfSize) { p.position.z = -halfSize; p.velocity.z *= -0.3; }
            }
            p.updateRotation(dt);
        }
    }

    if (scene.instancedMeshManager) {
        if (scene.useHeatmapParticleColors) {
            let globalForceMax = 0;
            for (let i = 0; i < visibleCount; i++) {
                const f = scene.particles[i].frameForceMax;
                if (f > globalForceMax) globalForceMax = f;
            }
            const denom = Math.max(globalForceMax, 1e-5);

            for (let i = 0; i < visibleCount; i++) {
                const p = scene.particles[i];
                const rel = Math.min(1, p.frameForceMax / denom);
                const vRel = Math.min(1, p.velocity.length() / Math.max(p.maxSpeed, 1e-6));
                let target = rel * (1 - heatVelBlend) + vRel * heatVelBlend;
                target = Math.pow(THREE.MathUtils.clamp(target, 0, 1), heatGamma);
                p.heatVisual += (target - p.heatVisual) * heatSmooth;
                setHeatmapColorFromUnit(p.heatVisual, scene._colorTmp);
                scene.instancedMeshManager.setColorAt(i, scene._colorTmp);
            }
            scene.instancedMeshManager.markColorsNeedsUpdate();
        }
        for (let i = 0; i < visibleCount; i++) {
            const p = scene.particles[i];
            scene.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
        }
        scene.instancedMeshManager.markNeedsUpdate();
    }
}

/**
 * 拡散エフェクトのトリガー
 */
export function triggerExpandEffect(scene, velocity = 127) {
    const center = new THREE.Vector3(
        (Math.random() - 0.5) * scene.spawnRadius * 0.4,
        (Math.random() - 0.5) * scene.spawnRadius * 0.4,
        (Math.random() - 0.5) * scene.spawnRadius * 0.4
    );
    const explosionRadius = 2000;
    const vFactor = velocity / 127.0;
    const explosionForce = 250.0 * vFactor;

    scene.particles.forEach((p) => {
        const diff = p.position.clone().sub(center);
        const dist = diff.length();
        if (dist < explosionRadius) {
            const strength = Math.pow(1.0 - dist / explosionRadius, 2.0) * explosionForce;
            p.addForce(diff.normalize().multiplyScalar(strength));
        }
    });
}

/**
 * 内部ユーティリティ：エメラルド内部のシラー・クラック風テクスチャ
 */
function generateEmeraldGemTextures() {
    const size = 512;
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size; colorCanvas.height = size;
    const cCtx = colorCanvas.getContext('2d');
    const baseGrad = cCtx.createLinearGradient(0, 0, size, size);
    baseGrad.addColorStop(0, '#145a42');
    baseGrad.addColorStop(0.45, '#228f68');
    baseGrad.addColorStop(1, '#186648');
    cCtx.fillStyle = baseGrad;
    cCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 55; i++) {
        const x = Math.random() * size; const y = Math.random() * size; const r = 6 + Math.random() * 36;
        const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
        const g = 165 + Math.random() * 75;
        const rCh = 45 + Math.random() * 55;
        grad.addColorStop(0, `rgba(${rCh}, ${g}, ${95 + Math.random() * 55}, 0.48)`);
        grad.addColorStop(1, 'rgba(24, 90, 65, 0)');
        cCtx.fillStyle = grad; cCtx.beginPath(); cCtx.arc(x, y, r, 0, Math.PI * 2); cCtx.fill();
    }
    for (let i = 0; i < 220; i++) {
        const x = Math.random() * size; const y = Math.random() * size; const r = 0.4 + Math.random() * 1.8;
        const deep = Math.random() > 0.5;
        cCtx.fillStyle = deep
            ? 'rgba(18, 72, 52, 0.42)'
            : `rgba(${70 + Math.random() * 50}, ${175 + Math.random() * 60}, ${110 + Math.random() * 50}, 0.4)`;
        cCtx.beginPath(); cCtx.arc(x, y, r, 0, Math.PI * 2); cCtx.fill();
    }
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size; bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d');
    bCtx.fillStyle = '#9ec4b0'; bCtx.fillRect(0, 0, size, size);
    bCtx.strokeStyle = 'rgba(28, 72, 52, 0.45)';
    for (let i = 0; i < 28; i++) {
        bCtx.lineWidth = 0.8 + Math.random() * 2.2;
        let x = Math.random() * size; let y = Math.random() * size;
        bCtx.beginPath(); bCtx.moveTo(x, y);
        for (let j = 0; j < 8; j++) { x += (Math.random() - 0.5) * 58; y += (Math.random() - 0.5) * 58; bCtx.lineTo(x, y); }
        bCtx.stroke();
    }
    for (let i = 0; i < 95; i++) {
        const x = Math.random() * size; const y = Math.random() * size; const r = 4 + Math.random() * 22;
        const grad = bCtx.createRadialGradient(x, y, 0, x, y, r);
        const val = Math.random() > 0.35 ? 240 : 45;
        grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.45)`);
        grad.addColorStop(1, 'rgba(128, 138, 132, 0)');
        bCtx.fillStyle = grad; bCtx.beginPath(); bCtx.arc(x, y, r, 0, Math.PI * 2); bCtx.fill();
    }
    const colorTex = new THREE.CanvasTexture(colorCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;
    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    return { map: colorTex, bumpMap: bumpTex };
}
