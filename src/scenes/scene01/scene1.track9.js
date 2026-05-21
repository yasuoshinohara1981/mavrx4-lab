import * as THREE from 'three';
import { normalizeMidiVelocity } from './scene1.helpers.js';

/**
 * Scene1 トラック9 スフィア（Track9 Spheres）関連のロジック
 */

/**
 * トラック9スフィアシステムの初期化
 */
export function initTrack9SpawnSpheres(scene) {
    scene.track9SphereGroup = new THREE.Group();
    scene.scene.add(scene.track9SphereGroup);
    scene._track9FleshTextures = scene.generateFleshTextures();
    const env = scene.scene.environment;
    scene._track9SphereMaterial = new THREE.MeshStandardMaterial({
        map: scene._track9FleshTextures.map,
        bumpMap: scene._track9FleshTextures.bumpMap,
        bumpScale: 3.0,
        color: 0xd5d9df,
        metalness: 0.22,
        roughness: 0.44,
        envMap: env,
        envMapIntensity: 0.68 * (0.55 + 0.45 * (scene.sceneLightingScale ?? 1)),
        emissive: 0x2a2d32,
        emissiveIntensity: 0.2,
        fog: true
    });
    scene.track9SharedGeo = new THREE.SphereGeometry(1, 28, 28);
}

/**
 * デュレーション中のスフィアスポーンの更新
 */
export function tickTrack9DurationSpawn(scene) {
    if (!scene.track9SpawnDuringDuration) return;
    const now = performance.now();
    if (now >= scene._track9SpawnWindowEndMs) return;
    const intv = Math.max(16, Number(scene.track9DurationSpawnIntervalMs) || 52);
    if (now - scene._track9LastDurationSpawnMs < intv) return;
    scene._track9LastDurationSpawnMs = now;
    scene.spawnTrack9SphereFromWorldCenter(scene._track9SpawnWindowVelocity);
}

/**
 * スフィアのスポーン
 */
export function spawnTrack9SphereFromWorldCenter(scene, velocity) {
    if (!scene.track9SphereGroup || !scene.track9SharedGeo || !scene._track9SphereMaterial) return;

    const vMidi = normalizeMidiVelocity(velocity);
    const radius = THREE.MathUtils.clamp(22 + (vMidi / 127) * 76, 16, 102);

    const yMin = scene.floorTopY + 220;
    const yMax = scene.ceilingY * 0.4;
    const midY = (yMin + yMax) * 0.5;
    scene._track9WorldCenter.set(0, midY, 0);
    scene._track9SpawnPos.copy(scene._track9WorldCenter);
    scene._track9SpawnPos.x += (Math.random() - 0.5) * 160;
    scene._track9SpawnPos.y += (Math.random() - 0.5) * 260;
    scene._track9SpawnPos.z += (Math.random() - 0.5) * 160;

    const sphereMat = scene._track9SphereMaterial.clone();
    applyTrack9SphereRandomTint(scene, sphereMat);
    const mesh = new THREE.Mesh(scene.track9SharedGeo, sphereMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const position = scene._track9SpawnPos.clone();
    const vel = new THREE.Vector3();
    vel.subVectors(scene._track9SpawnPos, scene._track9WorldCenter);
    if (vel.lengthSq() < 1e-10) {
        vel.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    }
    vel.normalize();
    const speed = 92 + (vMidi / 127) * 260;
    vel.multiplyScalar(speed);

    const angularVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2.8,
        (Math.random() - 0.5) * 2.8,
        (Math.random() - 0.5) * 2.8
    );

    mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
    );
    mesh.position.copy(position);
    const vs = scene._track9SphereVisualScale;
    mesh.scale.setScalar(radius * 0.015 * vs);

    scene.track9SphereGroup.add(mesh);
    scene.track9Spheres.push({
        mesh,
        position,
        velocity: vel,
        radius,
        radiusNow: radius * 0.015 * vs,
        birthAge: 0,
        angularVelocity,
        driftSeed: Math.random() * 4000 + scene.track9Spheres.length * 0.37
    });
    scene.ambientDust?.spawnBurst(position, scene.ambientParticlesPerTrack9);

    while (scene.track9Spheres.length > scene.maxTrack9Spheres) {
        const old = scene.track9Spheres.shift();
        scene.track9SphereGroup.remove(old.mesh);
        if (old.mesh.material) old.mesh.material.dispose();
    }
}

/**
 * スフィアの物理挙動の更新
 */
export function updateTrack9SpherePhysics(scene, deltaTime) {
    if (!scene.track9Spheres.length) return;
    const growSec = scene._track9BirthGrowSec;
    const vs = scene._track9SphereVisualScale;
    for (const sp of scene.track9Spheres) {
        sp.birthAge = (sp.birthAge ?? 0) + deltaTime;
        const t = Math.min(1, sp.birthAge / growSec);
        const u = t * t * (3 - 2 * t);
        sp.radiusNow = sp.radius * vs * Math.max(u, 0.015);
    }

    const sub = scene._track9SubSteps;
    const dt = deltaTime / sub;
    const grav = scene._track9Gravity;
    const drift = scene._track9SphereDrift;
    const diff = scene._track9Diff;
    const margin = 140;
    const tPhys = scene.time;

    for (let s = 0; s < sub; s++) {
        scene.track9PhysicsGrid.clear();
        scene.track9Spheres.forEach((sp, i) => {
            const gx = Math.floor(sp.position.x / scene.track9GridSize);
            const gy = Math.floor(sp.position.y / scene.track9GridSize);
            const gz = Math.floor(sp.position.z / scene.track9GridSize);
            const key = (gx + 120) + (gy + 120) * 240 + (gz + 120) * 240 * 240;
            if (!scene.track9PhysicsGrid.has(key)) scene.track9PhysicsGrid.set(key, []);
            scene.track9PhysicsGrid.get(key).push(i);
        });

        scene.track9Spheres.forEach((sp) => {
            const ds = sp.driftSeed ?? 0;
            const ampXZ = 24;
            const ampY = 13;
            const rNow = sp.radiusNow;
            const floorContactY = scene.floorTopY + 2 + rNow;
            const floorGap = Math.max(0, sp.position.y - floorContactY);
            // Fade vertical drift near the floor to avoid micro-bounces and shadow shimmer.
            const driftYScale = THREE.MathUtils.clamp(floorGap / 120, 0.12, 1.0);
            drift.set(
                (scene._shardNoise(ds * 0.11, tPhys * 0.52, 0.07) - 0.5) * 2 * ampXZ,
                ((scene._shardNoise(ds * 0.19 + 2.1, tPhys * 0.46, 0.11) - 0.5) * 2 * ampY + 2) * driftYScale,
                (scene._shardNoise(ds * 0.13 + 7.1, tPhys * 0.49, 0.09) - 0.5) * 2 * ampXZ
            );
            sp.velocity.addScaledVector(grav, dt);
            sp.velocity.addScaledVector(drift, dt);
            sp.position.addScaledVector(sp.velocity, dt);
            sp.velocity.multiplyScalar(0.9984);

            const r = sp.radiusNow;
            const x0 = -scene.roomHalfW + margin + r;
            const x1 = scene.roomHalfW - margin - r;
            const z0 = -scene.roomHalfD + margin + r;
            const z1 = scene.roomHalfD - margin - r;
            // Keep a tiny lift to avoid z-fighting, but treat floor contact as true ground touch.
            const floorContactLift = 2;
            const y0 = scene.floorTopY + floorContactLift + r;
            const y1 = scene.ceilingY * 0.46 - r;

            if (sp.position.x < x0) {
                sp.position.x = x0;
                sp.velocity.x *= -0.5;
            } else if (sp.position.x > x1) {
                sp.position.x = x1;
                sp.velocity.x *= -0.5;
            }
            if (sp.position.z < z0) {
                sp.position.z = z0;
                sp.velocity.z *= -0.5;
            } else if (sp.position.z > z1) {
                sp.position.z = z1;
                sp.velocity.z *= -0.5;
            }
            if (sp.position.y < y0) {
                sp.position.y = y0;
                sp.velocity.y *= -0.52;
                const roll = 0.08 / Math.max(r * 0.04, 0.5);
                sp.angularVelocity.z += -sp.velocity.x * roll * dt;
                sp.angularVelocity.x += sp.velocity.z * roll * dt;
                sp.velocity.x *= 0.96;
                sp.velocity.z *= 0.96;
                const horizontalSpeed = Math.hypot(sp.velocity.x, sp.velocity.z);
                if (Math.abs(sp.velocity.y) < 14 && horizontalSpeed < 18) {
                    sp.velocity.y = 0;
                    sp.velocity.x *= 0.88;
                    sp.velocity.z *= 0.88;
                    if (horizontalSpeed < 2.2) {
                        sp.velocity.x = 0;
                        sp.velocity.z = 0;
                    }
                }
            } else if (sp.position.y > y1) {
                sp.position.y = y1;
                sp.velocity.y *= -0.48;
            }
        });

        scene.track9Spheres.forEach((a, i) => {
            const gx = Math.floor(a.position.x / scene.track9GridSize);
            const gy = Math.floor(a.position.y / scene.track9GridSize);
            const gz = Math.floor(a.position.z / scene.track9GridSize);
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    for (let oz = -1; oz <= 1; oz++) {
                        const key = (gx + ox + 120) + (gy + oy + 120) * 240 + (gz + oz + 120) * 240 * 240;
                        const neighbors = scene.track9PhysicsGrid.get(key);
                        if (!neighbors) continue;
                        neighbors.forEach((j) => {
                            if (i >= j) return;
                            const b = scene.track9Spheres[j];
                            diff.subVectors(a.position, b.position);
                            const distSq = diff.lengthSq();
                            const minD = a.radiusNow + b.radiusNow;
                            if (distSq >= minD * minD || distSq < 1e-10) return;
                            const dist = Math.sqrt(distSq);
                            const overlap = (minD - dist) * 0.55;
                            const nx = diff.x / dist;
                            const ny = diff.y / dist;
                            const nz = diff.z / dist;
                            a.position.x += nx * overlap * 0.5;
                            a.position.y += ny * overlap * 0.5;
                            a.position.z += nz * overlap * 0.5;
                            b.position.x -= nx * overlap * 0.5;
                            b.position.y -= ny * overlap * 0.5;
                            b.position.z -= nz * overlap * 0.5;
                            const rvx = a.velocity.x - b.velocity.x;
                            const rvy = a.velocity.y - b.velocity.y;
                            const rvz = a.velocity.z - b.velocity.z;
                            const dot = rvx * nx + rvy * ny + rvz * nz;
                            if (dot < 0) {
                                const imp = -(1 + 0.65) * dot * 0.5;
                                const ix = nx * imp;
                                const iy = ny * imp;
                                const iz = nz * imp;
                                a.velocity.x += ix;
                                a.velocity.y += iy;
                                a.velocity.z += iz;
                                b.velocity.x -= ix;
                                b.velocity.y -= iy;
                                b.velocity.z -= iz;
                            }
                        });
                    }
                }
            }
        });

        scene.track9Spheres.forEach((sp) => {
            sp.angularVelocity.multiplyScalar(0.994);
            sp.mesh.rotation.x += sp.angularVelocity.x * dt;
            sp.mesh.rotation.y += sp.angularVelocity.y * dt;
            sp.mesh.rotation.z += sp.angularVelocity.z * dt;
        });
    }

    scene.track9Spheres.forEach((sp) => {
        sp.mesh.position.copy(sp.position);
        sp.mesh.scale.setScalar(sp.radiusNow);
    });
}

/**
 * 内部ユーティリティ：スフィアの色をランダムに設定
 */
function applyTrack9SphereRandomTint(scene, material) {
    material.color.copy(scene._track9SphereColorAtMax);
    material.color.offsetHSL(0, (Math.random() - 0.5) * 0.035, (Math.random() - 0.5) * 0.07);
    material.emissive.copy(scene._track9SphereEmissiveAtMax);
    material.emissive.offsetHSL(0, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.09);
    material.emissiveIntensity = THREE.MathUtils.clamp(0.17 + (Math.random() - 0.5) * 0.08, 0.12, 0.24);
}
