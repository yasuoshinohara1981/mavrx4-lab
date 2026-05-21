import * as THREE from 'three';

/**
 * 蛍光灯：発光ガラス管 + 両端のマット黒ソケット風キャップ。
 * メッシュ・PointLight は **同一 Group** で回転させる。
 */
export class StudioFluorescentLamp {
    /**
     * @param {THREE.Scene} scene
     * @param {object} [options]
     * @param {THREE.Vector3 | { x?: number, y?: number, z?: number }} [options.position]
     * @param {number} [options.color=0xffffff]
     * @param {number} [options.emissiveIntensity=1]
     * @param {number} [options.radius=50]
     * @param {number} [options.height] 円柱の高さ（既定 10000）
     * @param {number} [options.pointIntensity] PointLight の intensity（未指定時は emissiveIntensity から算出）
     * @param {number} [options.distance] PointLight の distance
     * @param {number} [options.decay=2]
     * @param {number} [options.envMapIntensity=1]
     * @param {THREE.Euler | { x?: number, y?: number, z?: number, order?: string }} [options.rotation] Group に適用（円柱軸＝長手）
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        /** @type {THREE.Group | null} */
        this.group = null;
        this.pointLight = null;

        const color = options.color ?? 0xffffff;
        const emissiveIntensity = options.emissiveIntensity !== undefined ? options.emissiveIntensity : 1;
        const radius = options.radius ?? 50;
        const height = options.height ?? 10000;
        const halfH = height * 0.5;

        /** 両端ソケット：やや太めのショート円筒（マット黒）。*/
        const capH = THREE.MathUtils.clamp(radius * 1.2, 20, radius * 2.2);
        const capR = radius * 1.48;

        const socketMat = new THREE.MeshStandardMaterial({
            color: 0x090b0f,
            roughness: 0.94,
            metalness: 0.04,
            envMapIntensity: options.envMapIntensity !== undefined ? options.envMapIntensity * 0.12 : 0.12,
            fog: false
        });

        const tubeGeom = new THREE.CylinderGeometry(radius, radius, height, 12, 1, false);
        const tubeMat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity,
            envMapIntensity: options.envMapIntensity !== undefined ? options.envMapIntensity : 1.0,
            fog: true
        });
        const tube = new THREE.Mesh(tubeGeom, tubeMat);

        const capGeomA = new THREE.CylinderGeometry(capR, capR, capH, 12);
        const capGeomB = new THREE.CylinderGeometry(capR, capR, capH, 12);
        const capA = new THREE.Mesh(capGeomA, socketMat);
        const capB = new THREE.Mesh(capGeomB, socketMat.clone());
        const inset = capH * 0.06;
        capA.position.y = -halfH - capH * 0.5 + inset;
        capB.position.y = halfH + capH * 0.5 - inset;

        this.group = new THREE.Group();
        this.group.add(tube, capA, capB);

        const p = options.position;
        if (p) {
            if (p instanceof THREE.Vector3) {
                this.group.position.copy(p);
            } else {
                this.group.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
            }
        }

        const rot = options.rotation;
        if (rot instanceof THREE.Euler) {
            this.group.rotation.copy(rot);
        } else if (rot && typeof rot === 'object') {
            this.group.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
            if (typeof rot.order === 'string') this.group.rotation.order = rot.order;
        }

        const distance = options.distance ?? 20000;
        const decay = options.decay !== undefined ? options.decay : 2;
        const pointIntensity =
            options.pointIntensity !== undefined
                ? options.pointIntensity
                : Math.max(400, emissiveIntensity * 120);

        this.pointLight = new THREE.PointLight(color, pointIntensity, distance, decay);
        this.pointLight.position.copy(this.group.position);

        scene.add(this.group);
        scene.add(this.pointLight);

        /** @deprecated 互換参照 */
        this.mesh = tube;
    }

    dispose() {
        if (this.pointLight) {
            this.scene.remove(this.pointLight);
            this.pointLight = null;
        }
        if (this.group) {
            this.scene.remove(this.group);
            this.group.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    const m = o.material;
                    if (Array.isArray(m)) m.forEach((x) => x.dispose());
                    else m.dispose();
                }
            });
            this.group = null;
        }
        this.mesh = null;
    }
}
