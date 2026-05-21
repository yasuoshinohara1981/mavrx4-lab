import * as THREE from 'three';
import { InstancedMeshManager } from '../InstancedMeshManager.js';

function fadeOpacity01(elapsedMs, lifeMs, fadeOutMs) {
    if (elapsedMs <= 0) return 1;
    if (elapsedMs >= lifeMs) return 0;
    const tail = lifeMs - elapsedMs;
    if (tail >= fadeOutMs) return 1;
    return THREE.MathUtils.clamp(tail / fadeOutMs, 0, 1);
}

/**
 * 大気中のチリ（インスタンスボックス）。部屋内バウンド＋寿命フェード。フォグと合成しやすいよう fog 対応。
 */
export class AtmosphericDustField {
    /**
     * @param {import('three').Scene} scene
     * @param {object} options
     * @param {number} options.roomHalfW
     * @param {number} options.roomHalfD
     * @param {number} options.floorTopY
     * @param {number} options.ceilingY
     * @param {number} [options.count=2000]
     * @param {number} [options.particleColor=0xe8dc67]
     * @param {number} [options.opacity=0.62]
     * @param {number} [options.lifetimeMs=11000]
     * @param {number} [options.fadeOutMs=1400]
     * @param {number} [options.minLivingBurst=180]
     */
    constructor(scene, options) {
        this.scene = scene;
        this.roomHalfW = options.roomHalfW;
        this.roomHalfD = options.roomHalfD;
        this.floorTopY = options.floorTopY;
        this.ceilingY = options.ceilingY;
        this.particleCount = options.count ?? 2000;
        this.lifetimeMs = options.lifetimeMs ?? 11000;
        this.fadeOutMs = options.fadeOutMs ?? 1400;

        this.instManager = null;
        this.particles = [];
        this._living = [];
        this._freeSlots = [];
        this._hidePos = new THREE.Vector3(0, -1e6, 0);
        this._idRot = new THREE.Euler(0, 0, 0);

        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshBasicMaterial({
            color: options.particleColor ?? 0xe8dc67,
            transparent: true,
            opacity: options.opacity ?? 0.62,
            depthWrite: false,
            blending: THREE.NormalBlending,
            fog: true
        });

        this.instManager = new InstancedMeshManager(this.scene, boxGeo, mat, this.particleCount);
        const mainMesh = this.instManager.getMainMesh();
        mainMesh.castShadow = false;
        mainMesh.receiveShadow = false;
        mainMesh.renderOrder = -2;

        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                rotation: new THREE.Euler(),
                angVel: new THREE.Vector3(),
                scale: new THREE.Vector3(),
                baseScale: new THREE.Vector3(),
                phase: 0,
                spawnTime: null
            });
            this._freeSlots.push(i);
        }
        for (let i = 0; i < this.particleCount; i++) {
            this._clearSlot(i);
        }
        this.instManager.markNeedsUpdate();

        const seedY = this.floorTopY + (this.ceilingY - this.floorTopY) * 0.3;
        this.spawnBurst(new THREE.Vector3(0, seedY, 0), options.minLivingBurst ?? 180);
    }

    getMainMesh() {
        return this.instManager ? this.instManager.getMainMesh() : null;
    }

    get livingCount() {
        return this._living.length;
    }

    _clearSlot(slotIndex) {
        if (!this.instManager || slotIndex < 0 || slotIndex >= this.particleCount) return;
        const ap = this.particles[slotIndex];
        ap.spawnTime = null;
        ap.scale.set(0, 0, 0);
        this.instManager.setMatrixAt(slotIndex, this._hidePos, this._idRot, ap.scale);
    }

    /**
     * @param {THREE.Vector3} worldPos
     * @param {number} burstCount
     */
    spawnBurst(worldPos, burstCount) {
        if (!this.instManager || !burstCount || !this._freeSlots.length) return;
        const n = Math.min(Math.floor(burstCount), this._freeSlots.length);
        const bx = this.roomHalfW - 420;
        const bz = this.roomHalfD - 420;
        const yMin = this.floorTopY + 200;
        const yMax = this.ceilingY * 0.41;

        for (let k = 0; k < n; k++) {
            const i = this._freeSlots.pop();
            const ap = this.particles[i];
            const jr = 38 + Math.random() * 220;
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            const jx = jr * Math.sin(ph) * Math.cos(th);
            const jy = jr * Math.cos(ph) * 0.82;
            const jz = jr * Math.sin(ph) * Math.sin(th);
            ap.position.set(worldPos.x + jx, worldPos.y + jy, worldPos.z + jz);
            ap.position.x = THREE.MathUtils.clamp(ap.position.x, -bx, bx);
            ap.position.z = THREE.MathUtils.clamp(ap.position.z, -bz, bz);
            ap.position.y = THREE.MathUtils.clamp(ap.position.y, yMin, yMax);
            ap.velocity.set(
                (Math.random() - 0.5) * 150,
                (Math.random() - 0.5) * 95,
                (Math.random() - 0.5) * 150
            );
            ap.rotation.set(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            );
            ap.angVel.set(
                (Math.random() - 0.5) * 1.9,
                (Math.random() - 0.5) * 1.9,
                (Math.random() - 0.5) * 1.9
            );
            const sr = 0.55 + Math.random() * 2.6;
            ap.baseScale.set(
                sr * (0.34 + Math.random() * 1.05) * 0.28,
                sr * (0.34 + Math.random() * 1.05) * 0.28,
                sr * (0.34 + Math.random() * 1.05) * 0.28
            );
            ap.scale.copy(ap.baseScale);
            ap.phase = Math.random() * Math.PI * 2;
            ap.spawnTime = performance.now();
            this._living.push(i);
        }
    }

    /**
     * @param {number} deltaTime
     * @param {number} time
     */
    update(deltaTime, time) {
        if (!this.instManager || !this.particles.length) return;
        const bx = this.roomHalfW - 420;
        const bz = this.roomHalfD - 420;
        const yMin = this.floorTopY + 200;
        const yMax = this.ceilingY * 0.41;
        const t = time;
        const dt = deltaTime;
        const now = performance.now();
        const life = this.lifetimeMs;
        const fadeMs = this.fadeOutMs;

        for (let j = this._living.length - 1; j >= 0; j--) {
            const i = this._living[j];
            const ap = this.particles[i];
            if (ap.spawnTime == null) {
                this._living.splice(j, 1);
                continue;
            }
            const age = now - ap.spawnTime;
            if (age >= life) {
                this._clearSlot(i);
                this._freeSlots.push(i);
                this._living.splice(j, 1);
                continue;
            }
            const fadeOp = fadeOpacity01(age, life, fadeMs);
            ap.scale.copy(ap.baseScale).multiplyScalar(fadeOp);

            const ph = ap.phase;
            ap.velocity.x += (Math.sin(t * 0.62 + ph * 1.1) * 38 + (Math.sin(t * 1.28 + i * 0.07) - 0.5) * 16) * dt;
            ap.velocity.y += (Math.cos(t * 0.48 + ph * 0.9) * 26 + (Math.cos(t * 0.88 + i * 0.05) - 0.5) * 12) * dt;
            ap.velocity.z += (Math.sin(t * 0.55 + ph * 1.3 + 1.4) * 38 + (Math.sin(t * 1.08 + i * 0.09) - 0.5) * 16) * dt;
            ap.velocity.multiplyScalar(0.9989);
            if (ap.velocity.length() > 210) ap.velocity.normalize().multiplyScalar(210);

            ap.position.addScaledVector(ap.velocity, dt);

            if (ap.position.x > bx) {
                ap.position.x = bx;
                ap.velocity.x *= -0.72;
            } else if (ap.position.x < -bx) {
                ap.position.x = -bx;
                ap.velocity.x *= -0.72;
            }
            if (ap.position.z > bz) {
                ap.position.z = bz;
                ap.velocity.z *= -0.72;
            } else if (ap.position.z < -bz) {
                ap.position.z = -bz;
                ap.velocity.z *= -0.72;
            }
            if (ap.position.y > yMax) {
                ap.position.y = yMax;
                ap.velocity.y *= -0.68;
            } else if (ap.position.y < yMin) {
                ap.position.y = yMin;
                ap.velocity.y *= -0.68;
            }

            ap.rotation.x += ap.angVel.x * dt;
            ap.rotation.y += ap.angVel.y * dt;
            ap.rotation.z += ap.angVel.z * dt;

            this.instManager.setMatrixAt(i, ap.position, ap.rotation, ap.scale);
        }
        this.instManager.markNeedsUpdate();
    }

    dispose() {
        if (this.instManager) {
            this.instManager.dispose();
            this.instManager = null;
        }
        this.particles = [];
        this._living = [];
        this._freeSlots = [];
    }
}
