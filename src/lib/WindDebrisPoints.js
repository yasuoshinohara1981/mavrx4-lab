/**
 * 風に乗るゴミ・塵っぽいパーティクル（Points）。カメラ近傍にスポーンし直しつつワールド風向きで流す。
 */

import * as THREE from 'three';

export class WindDebrisPoints {
    /**
     * @param {THREE.Camera} camera
     * @param {object} [options]
     * @param {number} [options.count=1000]
     * @param {THREE.Vector3} [options.windDirection] ワールド風向き（正規化不要）
     * @param {number} [options.windSpeed=72]
     * @param {number} [options.minSpawnRadius=720]
     * @param {number} [options.maxSpawnRadius=2600]
     * @param {number} [options.cullDistance=4200]
     * @param {number} [options.pointSize=2.4]
     * @param {number} [options.opacity=0.38]
     * @param {number} [options.maxForwardDot=20000] 視線前方に乗る距離の上限（旧5200だと大きい部屋の中央付近で全粒子が即リスポーンしていた）
     * @param {boolean} [options.depthTest=true] false にすると DOF/奥行きと干渉しにくい
     */
    constructor(camera, options = {}) {
        this.camera = camera;
        this.count = Math.max(1, options.count ?? 1000);
        const pointSize = options.pointSize ?? 2.4;
        const opacity = options.opacity ?? 0.38;
        this.windDirection = (options.windDirection || new THREE.Vector3(0.92, 0.06, -0.38)).clone().normalize();
        this.windSpeed = options.windSpeed ?? 72;
        this.minSpawnRadius = options.minSpawnRadius ?? 720;
        this.maxSpawnRadius = options.maxSpawnRadius ?? 2600;
        this.cullDistance = options.cullDistance ?? 4200;
        this.maxForwardDot = options.maxForwardDot ?? 20000;
        this.minForwardDot = options.minForwardDot ?? -900;

        this._positions = new Float32Array(this.count * 3);
        this._vel = new Float32Array(this.count * 3);
        this._phase = new Float32Array(this.count);
        this._chaos = new Float32Array(this.count);

        this._v3 = new THREE.Vector3();
        this._forward = new THREE.Vector3();

        const geo = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', posAttr);

        /** 夕焼け・砂埃っぽい（白っぽさを避ける） */
        const dustPalette = [
            [0.82, 0.38, 0.28],
            [0.62, 0.42, 0.52],
            [0.74, 0.52, 0.22],
            [0.68, 0.34, 0.46],
            [0.78, 0.48, 0.34],
            [0.44, 0.4, 0.52],
            [0.58, 0.48, 0.32],
            [0.72, 0.42, 0.38]
        ];

        const colors = new Float32Array(this.count * 3);
        for (let i = 0; i < this.count; i++) {
            const p = dustPalette[(Math.random() * dustPalette.length) | 0];
            const j = (Math.random() - 0.5) * 0.1;
            const lift = 1.1;
            colors[i * 3] = THREE.MathUtils.clamp((p[0] + j) * lift, 0.15, 1);
            colors[i * 3 + 1] = THREE.MathUtils.clamp((p[1] + j) * lift, 0.15, 1);
            colors[i * 3 + 2] = THREE.MathUtils.clamp((p[2] + j) * lift, 0.15, 1);
            this._phase[i] = Math.random() * Math.PI * 2;
            this._chaos[i] = 0.35 + Math.random() * 0.95;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        for (let i = 0; i < this.count; i++) {
            this._spawnIndex(i, true);
        }

        const mat = new THREE.PointsMaterial({
            size: pointSize,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity,
            depthWrite: false,
            depthTest: options.depthTest !== false,
            blending: THREE.NormalBlending,
            // FogExp2 だと遠景と同色になり粒子が消える（カメラ近でも距離で乗る）
            fog: false
        });

        this.mesh = new THREE.Points(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1;
        this.mesh.name = 'WindDebrisPoints';
    }

    /**
     * @param {number} i
     * @param {boolean} initial
     */
    _spawnIndex(i, initial = false) {
        const cam = this.camera;
        cam.getWorldDirection(this._forward);

        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const t = Math.pow(Math.random(), 0.55);
        const r = THREE.MathUtils.lerp(this.minSpawnRadius, this.maxSpawnRadius, t);

        let lx = r * Math.sin(phi) * Math.cos(theta);
        let ly = r * Math.sin(phi) * Math.sin(theta) * 0.42;
        let lz = -r * Math.cos(phi) * 0.85 - 200;

        if (initial && Math.random() < 0.5) {
            lx = (Math.random() - 0.5) * 2800;
            ly = (Math.random() - 0.5) * 1100;
            lz = -500 - Math.random() * 2400;
        }

        this._v3.set(lx, ly, lz).applyQuaternion(cam.quaternion).add(cam.position);

        const o = i * 3;
        this._positions[o] = this._v3.x;
        this._positions[o + 1] = this._v3.y;
        this._positions[o + 2] = this._v3.z;

        const w = this.windDirection;
        const c = this._chaos[i];
        this._vel[o] = w.x * this.windSpeed * c + (Math.random() - 0.5) * 18;
        this._vel[o + 1] = w.y * this.windSpeed * c + (Math.random() - 0.5) * 12;
        this._vel[o + 2] = w.z * this.windSpeed * c + (Math.random() - 0.5) * 18;
    }

    /**
     * @param {number} dt
     */
    update(dt) {
        if (!this.mesh || !this.camera) return;
        const cam = this.camera;
        const pos = this._positions;
        const vel = this._vel;
        const ph = this._phase;
        const t = performance.now() * 0.001;

        cam.getWorldDirection(this._forward);

        for (let i = 0; i < this.count; i++) {
            const o = i * 3;
            const px = pos[o];
            const py = pos[o + 1];
            const pz = pos[o + 2];

            const turbX = Math.sin(t * 1.7 + ph[i] * 3.1) * 14 * dt;
            const turbY = Math.cos(t * 2.2 + ph[i] * 1.9) * 9 * dt;
            const turbZ = Math.sin(t * 1.4 + ph[i] * 2.7) * 12 * dt;

            pos[o] = px + vel[o] * dt + turbX;
            pos[o + 1] = py + vel[o + 1] * dt + turbY;
            pos[o + 2] = pz + vel[o + 2] * dt + turbZ;

            this._v3.set(pos[o] - cam.position.x, pos[o + 1] - cam.position.y, pos[o + 2] - cam.position.z);
            const dist = this._v3.length();
            const forwardDot = this._v3.dot(this._forward);

            if (dist > this.cullDistance || forwardDot < this.minForwardDot || forwardDot > this.maxForwardDot) {
                this._spawnIndex(i, false);
            }
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
            this.mesh = null;
        }
    }
}
