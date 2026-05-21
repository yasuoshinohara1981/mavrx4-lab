import * as THREE from 'three';

/**
 * 天井 emissive + オプション Spot。シーンからは **StudioBox**（`ceilingSpotRig` / `attachCeilingSpotRig`）経由で使うのを推奨。
 */

/** Studio 部屋用に調整済みのデフォルト（必要なら options で上書き） */
const DEFAULT_SHADOW_DEBUG_SPOT = {
    intensity: 2_350_000,
    distance: 24_000,
    angle: Math.PI / 2.35,
    penumbra: 0.44,
    decay: 2,
    spotYOffsetFromCeiling: -380,
    targetYOffsetFromFloor: 520,
    castShadow: true,
    shadowMapSize: 2048,
    shadowBias: -0.00032,
    shadowNormalBias: 0.06,
    cameraNear: 120,
    cameraFar: 16_000,
    color: 0xffffff
};

/**
 * 天井の発光プレーン（emissive）＋オプションでシャドウ用 SpotLight。
 * emissive は当該メッシュの見た目のみで、THREE.Light として他オブジェクトを照らすわけではない。
 */
export class StudioEmissiveCeilingSpotRig {
    /**
     * @param {THREE.Scene} scene
     * @param {object} [options]
     * @param {THREE.Object3D} [options.parent] 天井メッシュの親（既定: scene）
     * @param {THREE.Object3D} [options.spotParent] Spot と target の親（既定: scene）
     * @param {boolean} [options.includeCeilingPlane=true] false なら天井メッシュは作らず Spot のみ（StudioBox 本体に天井がある場合）
     * @param {number} [options.roomHalfW]
     * @param {number} [options.roomHalfD]
     * @param {number} [options.ceilingY]
     * @param {number} [options.floorTopY]
     * @param {number} [options.sceneLightingScale=1] emissiveIntensity 未指定時に 8.5 * scale を使う
     * @param {number} [options.emissiveIntensity] 明示時は scale より優先
     * @param {number} [options.emissiveColor=0xffffff]
     * @param {number} [options.envMapIntensity=1]
     * @param {boolean} [options.fog=true]
     * @param {object|null} [options.shadowDebugSpot] `{ enabled: true, ... }` で Spot 追加。falsey なら Spot なし
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.parent = options.parent || scene;
        this.spotParent = options.spotParent || scene;
        this.ceilingMesh = null;
        this.spotLight = null;
        this.target = null;
        this.includeCeilingPlane = options.includeCeilingPlane !== false;

        const roomHalfW = options.roomHalfW ?? 5000;
        const roomHalfD = options.roomHalfD ?? 5000;
        const ceilingY = options.ceilingY ?? 5500;
        const floorTopY = options.floorTopY ?? -498;
        const L = options.sceneLightingScale ?? 1;
        const emissiveIntensity =
            options.emissiveIntensity !== undefined ? options.emissiveIntensity : 8.5 * L;
        const envMapIntensity = options.envMapIntensity !== undefined ? options.envMapIntensity : 1;

        if (this.includeCeilingPlane) {
            const ceilingGeo = new THREE.PlaneGeometry(roomHalfW * 2, roomHalfD * 2);
            ceilingGeo.rotateX(Math.PI / 2);
            const ceilingMat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                side: THREE.DoubleSide,
                roughness: 0.8,
                metalness: 0,
                emissive: options.emissiveColor ?? 0xffffff,
                emissiveIntensity,
                envMapIntensity,
                fog: options.fog !== false
            });
            this.ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
            this.ceilingMesh.position.set(0, ceilingY, 0);
            this.ceilingMesh.receiveShadow = false;
            this.ceilingMesh.castShadow = false;
            this.parent.add(this.ceilingMesh);
        }

        const sd = options.shadowDebugSpot;
        if (sd && sd.enabled) {
            const { enabled: _e, ...spotOpts } = sd;
            const cfg = { ...DEFAULT_SHADOW_DEBUG_SPOT, ...spotOpts };

            this.target = new THREE.Object3D();
            this.target.position.set(
                cfg.targetX ?? 0,
                floorTopY + (cfg.targetYOffsetFromFloor ?? 520),
                cfg.targetZ ?? 0
            );
            this.spotParent.add(this.target);

            this.spotLight = new THREE.SpotLight(
                cfg.color ?? 0xffffff,
                cfg.intensity,
                cfg.distance,
                cfg.angle,
                cfg.penumbra,
                cfg.decay
            );
            this.spotLight.position.set(
                cfg.spotX ?? 0,
                ceilingY + (cfg.spotYOffsetFromCeiling ?? -380),
                cfg.spotZ ?? 0
            );
            this.spotLight.target = this.target;
            this.spotLight.castShadow = cfg.castShadow !== false;
            if (this.spotLight.castShadow) {
                const sh = this.spotLight.shadow;
                sh.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
                sh.bias = cfg.shadowBias;
                sh.normalBias = cfg.shadowNormalBias;
                const cam = sh.camera;
                cam.near = cfg.cameraNear;
                cam.far = cfg.cameraFar;
                cam.updateProjectionMatrix();
            }
            this.spotParent.add(this.spotLight);
        }
    }

    dispose() {
        if (this.spotLight) {
            this.spotParent.remove(this.spotLight);
            this.spotLight.dispose();
            this.spotLight = null;
        }
        if (this.target) {
            this.spotParent.remove(this.target);
            this.target = null;
        }
        if (this.ceilingMesh) {
            this.parent.remove(this.ceilingMesh);
            this.ceilingMesh.geometry.dispose();
            this.ceilingMesh.material.dispose();
            this.ceilingMesh = null;
        }
    }
}
