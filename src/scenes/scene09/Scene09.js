/**
 * Scene09: 部屋・ライト・フォグ・ポストは Scene21 と同型（Studio タイル部屋＋平行光シャドウ＋SSAO 等）。
 * メインの飛行オブジェクトのみ独自：岩色チャコール立方体 InstancedMesh・運動モード11種・OSC トラック6。
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import {
    StudioBox,
    setupPostEffectsPipeline,
    updateSsaoDistanceAttenuation,
    resizePostEffectsPasses,
    disposePresentationOutputPass,
    applyStudioRoomToneAndBackdrop,
    setupStudioRoomEnvironmentMap,
    disposeStudioRoomEnvironmentMap,
    studioBoxOptionsForStudioRoom,
    ceilingSpotRigOptionsForStudioRoom,
    setupStudioRoomPromoWallFillLight,
    applyStudioRoomFloorWallEnvMaps
} from '../../lib/presentation/index.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { Scene02Particle } from '../scene02/Scene02Particle.js';
export class Scene09 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Xenofog';
        this.initialized = false;
        this.sceneNumber = 9;
        this.kitNo = 22;
        this.sharedResourceManager = sharedResourceManager;

        /** Scene21 同型：非表示 StudioBox（蛍光灯メッシュ）＋自前 roomGroup */
        this.studio = null;
        this.roomGroup = null;
        this.ceilingMesh = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;

        /** Scene21 と同じ既定（ライト・床壁の env 係数の基準） */
        this.sceneLightingScale = 0.32;
        this._roomEnvPresentation = null;

        this.useDOF = true;
        this.useBloom = true;
        this.useSceneFog = true;
        this.sceneFogDensity = 0.00009;
        /** 既定は背景色に近い（遠景が背景に溶ける） */
        this.sceneFogColor = 0x151820;
        this.useSSAO = true;
        this.useFilmGrain = true;
        this.useAutoFocusDOF = false;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.saoPass = null;
        this.aoDepthTexture = null;
        this.ssaoNearKernelRadius = 9.2;
        this.ssaoNearMinDistance = 0.018;
        this.ssaoNearMaxDistance = 0.165;
        this.ssaoFarAttenuation = 0.62;
        this.outputPass = null;

        this.fillPointLight = null;
        this.pulsePointLight = null;
        this.promoWallFillLight = null;
        this.promoWallLightTarget = null;

        this.airNoiseVolume = null;
        this.airNoiseMaterial = null;

        this.trackEffects = {
            1: true,
            2: false,
            3: false,
            4: false,
            5: false,
            6: true,
            7: false,
            8: false,
            9: false
        };
        this.setScreenshotText(this.title);

        this.roomHalfW = 5000;
        this.roomHalfD = 5000;
        this.floorTopY = -498;
        this.ceilingY = 5500;

        /** Scene13 同等：インスタンス数 */
        this.sphereCount = 2500;
        this.spawnRadius = 1200;
        this.instancedMeshManager = null;
        this.particles = [];
        this.gridSize = 120;
        this.grid = new Map();
        this.expandSpheres = [];
        this.modeTimer = 0;
        this.modeInterval = 10.0;
        this.totalModeCount = 11;
        this.useGravity = false;
        this.spiralMode = false;
        this.torusMode = false;
        this.useWallCollision = true;
        this.currentVisibleCount = this.sphereCount;

        /** 以下 11 モードは旧実装から全面差し替え（番号のみ互換） */
        this.MODE_DRIFT_FIELD = 0;
        this.MODE_UPTHRUST = 1;
        this.MODE_HELIX_RAIL = 2;
        this.MODE_LEMNISCATE = 3;
        this.MODE_HONEYCOMB = 4;
        this.MODE_BEAT_INTERFERENCE = 5;
        this.MODE_BINARY_ROTATE = 6;
        this.MODE_DNA_HELIX = 7;
        this.MODE_TOROIDAL_VORTEX = 8;
        this.MODE_TRIPLE_WELL = 9;
        this.MODE_PRECESS_ORBIT = 10;

        this.currentMode = this.MODE_DRIFT_FIELD;
        this.modeHistory = new Set([this.MODE_DRIFT_FIELD]);

        this._tmpV = new THREE.Vector3();
        this._mat = new THREE.Matrix4();
        this._quat = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
        this._centerSmoothed = new THREE.Vector3(0, 900, 0);
        this._colorTmp = new THREE.Color();
    }

    buildRoom() {
        const floorTpl = StudioBox.createFloorTileTextures();
        const wallTpl = StudioBox.createWallTileTextures();
        const L = this.sceneLightingScale ?? 1;
        const studioRough = 0.8;
        const floorConcreteMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: floorTpl.map,
            bumpMap: floorTpl.bumpMap,
            bumpScale: 1.0,
            roughness: studioRough * 0.3,
            metalness: 0.2,
            envMapIntensity: 1.0 * 1.3 * (0.55 + 0.45 * L),
            fog: true
        });
        const wallConcreteMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: wallTpl.map,
            bumpMap: wallTpl.bumpMap,
            bumpScale: 1.0,
            roughness: studioRough * 0.5,
            metalness: 0.1,
            envMapIntensity: 1.0 * (0.55 + 0.45 * L),
            fog: true
        });

        this.roomGroup = new THREE.Group();
        const hw = this.roomHalfW;
        const hd = this.roomHalfD;
        const floorTopY = this.floorTopY;
        const ceilingY = this.ceilingY;
        const wallH = ceilingY - floorTopY;
        const wallCenterY = floorTopY + wallH * 0.5;
        const slab = 24;

        const floorGeo = new THREE.BoxGeometry(hw * 2, slab, hd * 2, 1, 1, 1);
        const floor = new THREE.Mesh(floorGeo, floorConcreteMat);
        floor.position.set(0, floorTopY - slab * 0.5, 0);
        floor.receiveShadow = true;
        floor.castShadow = false;
        this.roomGroup.add(floor);

        const mkWall = (w, height, d, px, py, pz) => {
            const geo = new THREE.BoxGeometry(w, height, d, 1, 1, 1);
            const mesh = new THREE.Mesh(geo, wallConcreteMat);
            mesh.position.set(px, py, pz);
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            this.roomGroup.add(mesh);
        };

        mkWall(slab, wallH, hd * 2, -hw - slab * 0.5, wallCenterY, 0);
        mkWall(slab, wallH, hd * 2, hw + slab * 0.5, wallCenterY, 0);
        mkWall(hw * 2, wallH, slab, 0, wallCenterY, -hd - slab * 0.5);
        mkWall(hw * 2, wallH, slab, 0, wallCenterY, hd + slab * 0.5);

        const ceilingGeo = new THREE.PlaneGeometry(hw * 2, hd * 2);
        ceilingGeo.rotateX(Math.PI / 2);
        const ceilingMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            roughness: 0.8,
            metalness: 0,
            emissive: 0xffffff,
            emissiveIntensity: 8.5 * (this.sceneLightingScale ?? 1),
            envMapIntensity: 1.0,
            fog: true
        });
        this.ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
        this.ceilingMesh.position.set(0, ceilingY, 0);
        this.ceilingMesh.receiveShadow = false;
        this.ceilingMesh.castShadow = false;
        this.roomGroup.add(this.ceilingMesh);

        this.scene.add(this.roomGroup);
    }

    /** Scene21 と同一 */
    setupLights() {
        this.fillPointLight = null;
        this.pulsePointLight = null;

        const { promoWallLightTarget, promoWallFillLight } = setupStudioRoomPromoWallFillLight(this.scene, {
            ceilingY: this.ceilingY
        });
        this.promoWallLightTarget = promoWallLightTarget;
        this.promoWallFillLight = promoWallFillLight;
    }

    setupAirNoiseVolume() {
        const volumeGeo = new THREE.BoxGeometry(this.roomHalfW * 2.6, this.ceilingY * 1.3, this.roomHalfD * 2.6);
        this.airNoiseMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uDensity: { value: 0.036 },
                uColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                varying vec3 vWorldPos;
                uniform float uTime;
                uniform float uDensity;
                uniform vec3 uColor;

                float hash13(vec3 p) {
                    p = fract(p * 0.1031);
                    p += dot(p, p.yzx + 33.33);
                    return fract((p.x + p.y) * p.z);
                }

                float noise3(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);

                    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
                    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
                    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
                    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
                    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
                    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
                    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
                    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

                    float nx00 = mix(n000, n100, f.x);
                    float nx10 = mix(n010, n110, f.x);
                    float nx01 = mix(n001, n101, f.x);
                    float nx11 = mix(n011, n111, f.x);
                    float nxy0 = mix(nx00, nx10, f.y);
                    float nxy1 = mix(nx01, nx11, f.y);
                    return mix(nxy0, nxy1, f.z);
                }

                float fbm(vec3 p) {
                    float a = 0.5;
                    float s = 0.0;
                    for (int i = 0; i < 4; i++) {
                        s += a * noise3(p);
                        p = p * 2.03 + vec3(17.1, 3.7, 11.9);
                        a *= 0.5;
                    }
                    return s;
                }

                void main() {
                    vec3 p = vWorldPos * 0.0012 + vec3(0.0, uTime * 0.02, uTime * 0.012);
                    float n = fbm(p);
                    float vertical = smoothstep(-500.0, 2500.0, vWorldPos.y);
                    float alpha = uDensity * (0.22 + n * 0.34) * vertical;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.NormalBlending
        });

        this.airNoiseVolume = new THREE.Mesh(volumeGeo, this.airNoiseMaterial);
        this.airNoiseVolume.position.set(0, this.floorTopY + (this.ceilingY - this.floorTopY) * 0.55, 0);
        this.scene.add(this.airNoiseVolume);
    }

    /**
     * チャコールグレー〜黒寄りのランダム（岩・鉱物っぽい微妙な色相ブレ）
     * @param {THREE.Color} out
     */
    _setRandomRockCharcoalColor(out) {
        const l = 0.07 + Math.random() * 0.26;
        const s = 0.015 + Math.random() * 0.09;
        const h = 0.52 + (Math.random() - 0.5) * 0.1;
        out.setHSL(h, s, l);
        out.offsetHSL((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.05);
        out.r += (Math.random() - 0.5) * 0.035;
        out.g += (Math.random() - 0.5) * 0.035;
        out.b += (Math.random() - 0.5) * 0.04;
        out.r = THREE.MathUtils.clamp(out.r, 0.02, 0.42);
        out.g = THREE.MathUtils.clamp(out.g, 0.02, 0.42);
        out.b = THREE.MathUtils.clamp(out.b, 0.02, 0.45);
    }

    _applyEnvMapToSphereMaterial() {
        const m = this.instancedMeshManager?.getMainMesh()?.material;
        const env = this.scene?.environment;
        if (m && env) {
            m.envMap = env;
            m.needsUpdate = true;
        }
    }

    /**
     * キャンバス生成の map / bump（岩肌っぽい暗いムラと凹凸）
     */
    generateFleshTextures() {
        const size = 512;
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size;
        colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');
        cCtx.fillStyle = '#2a2a2a';
        cCtx.fillRect(0, 0, size, size);

        for (let i = 0; i < 60; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 5 + Math.random() * 30;
            const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
            const grayVal = 55 + Math.random() * 55;
            grad.addColorStop(0, `rgba(${grayVal}, ${grayVal}, ${grayVal}, 0.35)`);
            grad.addColorStop(1, 'rgba(40, 40, 40, 0)');
            cCtx.fillStyle = grad;
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
        }

        for (let i = 0; i < 200; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 0.5 + Math.random() * 1.5;
            cCtx.fillStyle = Math.random() > 0.5 ? 'rgba(20, 22, 24, 0.45)' : 'rgba(90, 92, 96, 0.35)';
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
        }

        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size;
        bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, size, size);

        bCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        for (let i = 0; i < 30; i++) {
            bCtx.lineWidth = 1 + Math.random() * 2;
            let x = Math.random() * size;
            let y = Math.random() * size;
            bCtx.beginPath();
            bCtx.moveTo(x, y);
            for (let j = 0; j < 8; j++) {
                x += (Math.random() - 0.5) * 60;
                y += (Math.random() - 0.5) * 60;
                bCtx.lineTo(x, y);
            }
            bCtx.stroke();
        }

        for (let i = 0; i < 100; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 5 + Math.random() * 20;
            const grad = bCtx.createRadialGradient(x, y, 0, x, y, r);
            const isUp = Math.random() > 0.3;
            const val = isUp ? 255 : 0;
            grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.5)`);
            grad.addColorStop(1, 'rgba(128, 128, 128, 0)');
            bCtx.fillStyle = grad;
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }

        const colorTex = new THREE.CanvasTexture(colorCanvas);
        colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
        const bumpTex = new THREE.CanvasTexture(bumpCanvas);
        bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;

        return { map: colorTex, bumpMap: bumpTex };
    }

    createSpheres() {
        const n = this.sphereCount;
        const geo = new THREE.BoxGeometry(1, 1, 1);
        {
            const nv = geo.attributes.position.count;
            const white = new Float32Array(nv * 3);
            white.fill(1);
            geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
        }
        const textures = this.generateFleshTextures();
        /** チャコール色は頂点色、金属感は metalness + IBL（暗色メタル鉱石寄り） */
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            map: textures.map,
            bumpMap: textures.bumpMap,
            bumpScale: 0.34,
            roughness: 0.35,
            metalness: 0.68,
            clearcoat: 0.28,
            clearcoatRoughness: 0.32,
            envMapIntensity: 1.75,
            specularIntensity: 1.1,
            fog: true,
            vertexColors: true
        });
        if (this.scene?.environment) mat.envMap = this.scene.environment;

        this.instancedMeshManager = new InstancedMeshManager(this.scene, geo, mat, n);
        const mainMesh = this.instancedMeshManager.getMainMesh();
        mainMesh.castShadow = true;
        mainMesh.receiveShadow = true;

        for (let i = 0; i < n; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = Math.pow(Math.random(), 1.5) * this.spawnRadius;
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
            const p = new Scene02Particle(x, y, z, radius, scale);
            p.angularVelocity.multiplyScalar(2.0);
            this.particles.push(p);

            this._setRandomRockCharcoalColor(this._colorTmp);
            this.instancedMeshManager.setColorAt(i, this._colorTmp);
            this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
        }
        this.instancedMeshManager.markColorsNeedsUpdate();
        this.instancedMeshManager.markNeedsUpdate();
        this.setParticleCount(n);
    }

    updatePhysics(deltaTime) {
        const subSteps = 2;
        const dt = deltaTime / subSteps;
        const halfSize = 4950;
        const tempVec = new THREE.Vector3();
        const visibleCount = Math.min(this.currentVisibleCount || 0, this.particles.length);

        for (let s = 0; s < subSteps; s++) {
            this.grid.clear();
            for (let i = 0; i < visibleCount; i++) {
                const p = this.particles[i];
                const gx = Math.floor(p.position.x / this.gridSize);
                const gy = Math.floor(p.position.y / this.gridSize);
                const gz = Math.floor(p.position.z / this.gridSize);
                const key = (gx + 100) + (gy + 100) * 200 + (gz + 100) * 40000;
                if (!this.grid.has(key)) this.grid.set(key, []);
                this.grid.get(key).push(i);
            }

            for (let idx = 0; idx < visibleCount; idx++) {
                const p = this.particles[idx];

                if (this.currentMode === this.MODE_DRIFT_FIELD) {
                    const x = p.position.x;
                    const y = p.position.y;
                    const z = p.position.z;
                    const tt = this.time;
                    const fx =
                        Math.sin(y * 0.0011 + tt * 0.37) * Math.cos(z * 0.00085 + tt * 0.21);
                    const fy =
                        Math.sin(z * 0.001 + tt * 0.29) * Math.cos(x * 0.00092 + tt * 0.18);
                    const fz =
                        Math.sin(x * 0.00115 + tt * 0.33) * Math.cos(y * 0.00088 + tt * 0.24);
                    tempVec.set(fx, fy, fz).multiplyScalar(38 * p.strayFactor);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_UPTHRUST) {
                    p.velocity.multiplyScalar(0.97);
                    tempVec.set(0, 14 * p.strayFactor, 0);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_HELIX_RAIL) {
                    const R = 820 * p.strayRadiusOffset;
                    const pitch = 0.42;
                    const theta = idx * 0.12 + p.phaseOffset * 0.4 + this.time * 0.38;
                    const ty = (theta * pitch * 180) % 4200 - 400;
                    const tx = Math.cos(theta) * R;
                    const tz = Math.sin(theta) * R;
                    p.velocity.y *= 0.9;
                    const spiralSpringK = 0.048 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * spiralSpringK, 0, (tz - p.position.z) * spiralSpringK);
                    p.addForce(tempVec);
                    const hSpring = 0.035 * p.strayFactor;
                    tempVec.set(0, (ty - p.position.y) * hSpring, 0);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_LEMNISCATE) {
                    const t = this.time * 0.52 + idx * 0.0012 + p.phaseOffset;
                    const a = 900 * p.strayRadiusOffset;
                    const tx = (a * Math.sin(t)) / (1 + Math.sin(t) * Math.sin(t));
                    const ty = 700 + a * 0.5 * Math.sin(t) * Math.cos(t);
                    const tz = a * 0.55 * Math.sin(2 * t + 0.3);
                    const springK = 0.012 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_HONEYCOMB) {
                    const q = idx % 56;
                    const r = Math.floor(idx / 56) % 44;
                    const size = 95;
                    const tx = size * (1.5 * q) + p.targetOffset.x * 0.04;
                    const tz = size * (0.5 * Math.sqrt(3) * q + Math.sqrt(3) * r) + p.targetOffset.z * 0.04;
                    const ty = (q * 0.12 + r * 0.09) * 55 + 520 + p.targetOffset.y * 0.05;
                    const wallSpringK = 0.011 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * wallSpringK, (ty - p.position.y) * wallSpringK, (tz - p.position.z) * wallSpringK);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_BEAT_INTERFERENCE) {
                    const w1 = 1.07;
                    const w2 = 1.19;
                    const cols = Math.floor(Math.sqrt(this.sphereCount));
                    const spacing = 4200 / cols;
                    const tx = ((idx % cols) - cols * 0.5) * spacing + p.targetOffset.x * 0.06;
                    const tz = (Math.floor(idx / cols) - cols * 0.5) * spacing + p.targetOffset.z * 0.06;
                    const ty =
                        820 +
                        Math.sin(w1 * this.time + idx * 0.07) * 520 * p.strayRadiusOffset +
                        Math.sin(w2 * this.time + idx * 0.11) * 380 * p.strayRadiusOffset;
                    const waveSpringK = 0.01 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * waveSpringK, (ty - p.position.y) * waveSpringK, (tz - p.position.z) * waveSpringK);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_BINARY_ROTATE) {
                    const t = this.time * 0.24;
                    const cx = Math.cos(t) * 780;
                    const cz = Math.sin(t) * 780;
                    const c1x = cx;
                    const c1z = cz;
                    const c2x = -cx;
                    const c2z = -cz;
                    const soft = 120;
                    const d1 = Math.hypot(p.position.x - c1x, p.position.z - c1z) + soft;
                    const d2 = Math.hypot(p.position.x - c2x, p.position.z - c2z) + soft;
                    const pull = 52000 * p.strayFactor;
                    tempVec.set(
                        ((c1x - p.position.x) * pull) / (d1 * d1) + ((c2x - p.position.x) * pull) / (d2 * d2),
                        ((900 - p.position.y) * 0.022 * p.strayFactor),
                        ((c1z - p.position.z) * pull) / (d1 * d1) + ((c2z - p.position.z) * pull) / (d2 * d2)
                    );
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_DNA_HELIX) {
                    const strand = idx % 2;
                    const along = Math.floor(idx / 2);
                    const theta = along * 0.065 + this.time * 0.48 + p.phaseOffset;
                    const R = 340 * p.strayRadiusOffset;
                    const rise = along * 2.4 - 900;
                    const tx = Math.cos(theta + strand * Math.PI) * R;
                    const tz = Math.sin(theta + strand * Math.PI) * R;
                    const ty = rise + strand * 55 + 1100;
                    const pillarSpringK = 0.0115 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * pillarSpringK, (ty - p.position.y) * pillarSpringK, (tz - p.position.z) * pillarSpringK);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_TOROIDAL_VORTEX) {
                    const xz = Math.sqrt(p.position.x * p.position.x + p.position.z * p.position.z) + 1e-4;
                    const s = 0.016 * p.strayFactor;
                    const fx = -p.position.z * s;
                    const fz = p.position.x * s;
                    const fy = Math.sin((xz - 820) * 0.0031 + this.time * 0.5) * 0.45 * p.strayFactor;
                    tempVec.set(fx, fy, fz);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_TRIPLE_WELL) {
                    const wells = [
                        [0, 900, 0],
                        [-520, 750, 420],
                        [480, 820, -380]
                    ];
                    let fx = 0;
                    let fy = 0;
                    let fz = 0;
                    for (let w = 0; w < 3; w++) {
                        const dx = wells[w][0] - p.position.x;
                        const dy = wells[w][1] - p.position.y;
                        const dz = wells[w][2] - p.position.z;
                        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 90;
                        const pull = (420 * p.strayFactor) / d;
                        fx += (dx / d) * pull;
                        fy += (dy / d) * pull;
                        fz += (dz / d) * pull;
                    }
                    tempVec.set(fx, fy, fz);
                    p.addForce(tempVec);
                } else if (this.currentMode === this.MODE_PRECESS_ORBIT) {
                    const t = this.time * 0.44 + idx * 0.0011;
                    const pre = this.time * 0.1 + p.phaseOffset * 0.2;
                    const a = 640 * p.strayRadiusOffset;
                    const b = 400 * p.strayRadiusOffset;
                    const x0 = Math.cos(pre) * (a * Math.cos(t)) - Math.sin(pre) * (b * Math.sin(t));
                    const z0 = Math.sin(pre) * (a * Math.cos(t)) + Math.cos(pre) * (b * Math.sin(t));
                    const y0 = 920 + Math.sin(t * 2.1 + p.phaseOffset) * 220;
                    const springK = 0.012 * p.strayFactor;
                    tempVec.set((x0 - p.position.x) * springK, (y0 - p.position.y) * springK, (z0 - p.position.z) * springK);
                    p.addForce(tempVec);
                } else {
                    const tx = p.targetOffset.x;
                    const ty = p.targetOffset.y + 200;
                    const tz = p.targetOffset.z;
                    const defSpringK = 0.0005 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * defSpringK, (ty - p.position.y) * defSpringK, (tz - p.position.z) * defSpringK);
                    p.addForce(tempVec);
                }

                p.update();
                p.velocity.multiplyScalar(0.95);

                if (this.useWallCollision) {
                    if (p.position.x > halfSize) { p.position.x = halfSize; p.velocity.x *= -0.3; }
                    if (p.position.x < -halfSize) { p.position.x = -halfSize; p.velocity.x *= -0.3; }
                    if (p.position.y > 4500) {
                        if (this.currentMode === this.MODE_HELIX_RAIL) {
                            p.position.y = -450;
                            p.velocity.y *= 0.1;
                        } else {
                            p.position.y = 4500;
                            p.velocity.y *= -0.3;
                        }
                    }
                    if (p.position.y < -450) {
                        p.position.y = -450;
                        p.velocity.y *= -0.1;
                        const rollFactor = 0.05 / (p.radius / 30);
                        p.angularVelocity.z = -p.velocity.x * rollFactor;
                        p.angularVelocity.x = p.velocity.z * rollFactor;
                        p.velocity.x *= 0.98;
                        p.velocity.z *= 0.98;
                    }
                    if (p.position.z > halfSize) { p.position.z = halfSize; p.velocity.z *= -0.3; }
                    if (p.position.z < -halfSize) { p.position.z = -halfSize; p.velocity.z *= -0.3; }
                }
                p.updateRotation(dt);
            }
        }

        if (this.instancedMeshManager) {
            for (let i = 0; i < visibleCount; i++) {
                const p = this.particles[i];
                this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.scale);
            }
            this.instancedMeshManager.markNeedsUpdate();
        }
    }

    triggerExpandEffect(velocity = 127) {
        const center = new THREE.Vector3(
            (Math.random() - 0.5) * this.spawnRadius * 0.4,
            (Math.random() - 0.5) * this.spawnRadius * 0.4,
            (Math.random() - 0.5) * this.spawnRadius * 0.4
        );
        const explosionRadius = 2000;
        const vFactor = velocity / 127.0;
        const explosionForce = 250.0 * vFactor;

        this.particles.forEach((p) => {
            const diff = p.position.clone().sub(center);
            const dist = diff.length();
            if (dist < explosionRadius) {
                const strength = Math.pow(1.0 - dist / explosionRadius, 2.0) * explosionForce;
                p.addForce(diff.normalize().multiplyScalar(strength));
            }
        });
    }

    updateExpandSpheres() {
        const now = Date.now();
        for (let i = this.expandSpheres.length - 1; i >= 0; i--) {
            const effect = this.expandSpheres[i];
            const progress = (now - effect.startTime) / effect.duration;
            if (progress >= 1.0) {
                if (effect.light) this.scene.remove(effect.light);
                if (effect.mesh) {
                    this.scene.remove(effect.mesh);
                    effect.mesh.geometry.dispose();
                    effect.mesh.material.dispose();
                }
                this.expandSpheres.splice(i, 1);
            } else {
                if (effect.light) effect.light.intensity = effect.maxIntensity * (1.0 - Math.pow(progress, 0.5));
                if (effect.mesh) effect.mesh.scale.setScalar(1.0 - progress);
            }
        }
    }

    applyCameraModeForMovement() {
        const cp = this.cameraParticles[this.currentCameraIndex];
        if (!cp) return;
        const mode = this.currentMode;
        switch (mode) {
            case this.MODE_DRIFT_FIELD:
                cp.applyPreset('DEFAULT');
                break;
            case this.MODE_UPTHRUST:
                cp.applyPreset('LOOK_UP');
                break;
            case this.MODE_HELIX_RAIL:
                cp.applyPreset('SKY_HIGH');
                break;
            case this.MODE_LEMNISCATE:
                cp.applyPreset('WIDE_VIEW', { distance: 2900 });
                break;
            case this.MODE_HONEYCOMB:
                cp.applyPreset('FRONT_SIDE', { z: 1600, x: 3100 });
                break;
            case this.MODE_BEAT_INTERFERENCE:
                cp.applyPreset('DRONE_SURFACE', { y: -280 });
                break;
            case this.MODE_BINARY_ROTATE:
                cp.applyPreset('WIDE_VIEW', { distance: 3200 });
                break;
            case this.MODE_DNA_HELIX:
                cp.applyPreset('PILLAR_WALK');
                break;
            case this.MODE_TOROIDAL_VORTEX:
                cp.applyPreset('CHAOTIC');
                break;
            case this.MODE_TRIPLE_WELL:
                cp.applyPreset('WIDE_VIEW', { distance: 2100 });
                break;
            case this.MODE_PRECESS_ORBIT:
                cp.applyPreset('WIDE_VIEW', { distance: 2750 });
                break;
            default:
                cp.applyPreset('DEFAULT');
                break;
        }
    }

    switchCameraRandom() {
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
        const cp = this.cameraParticles[this.currentCameraIndex];
        this.cameraParticles.forEach((p) => {
            p.minDistance = 400;
            p.maxDistance = 2000;
            p.boxMin = null;
            p.boxMax = null;
            p.maxSpeed = 8.0;
        });
        const angle1 = Math.random() * Math.PI * 2;
        const angle2 = Math.random() * Math.PI;
        const dist = 1000 + Math.random() * 2000;
        cp.position.set(
            Math.cos(angle1) * Math.sin(angle2) * dist,
            Math.sin(angle1) * Math.sin(angle2) * dist + 500,
            Math.cos(angle2) * dist
        );
        cp.applyRandomForce();
    }

    _smoothCenterFromParticles(dt) {
        const n = Math.min(this.currentVisibleCount || 0, this.particles.length);
        if (n <= 0) return;
        this._tmpV.set(0, 0, 0);
        for (let i = 0; i < n; i++) {
            this._tmpV.add(this.particles[i].position);
        }
        this._tmpV.multiplyScalar(1 / n);
        const a = 1 - Math.exp(-Math.min(dt, 0.1) * 2.8);
        this._centerSmoothed.lerp(this._tmpV, a);
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.useSSAO = false;

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity ?? 0.00009,
            sceneFogColor: this.sceneFogColor
        });

        if (this.camera.fov < 35 || this.camera.fov > 50) {
            this.camera.fov = 42;
        }
        this.camera.near = 12;
        this.camera.far = 12000;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(0, 1000, 4500);
        this.camera.lookAt(0, 400, 0);

        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;

        this.studio = new StudioBox(
            this.scene,
            studioBoxOptionsForStudioRoom(this.sceneLightingScale, this._roomEnvTexture)
        );
        if (this.studio.studioBox) {
            this.studio.studioBox.visible = false;
        }

        this.buildRoom();
        this.studio.attachCeilingSpotRig(this.roomGroup, {
            includeCeilingPlane: false,
            ...ceilingSpotRigOptionsForStudioRoom(this.sceneLightingScale)
        });
        const floorMat = this.roomGroup.children[0].material;
        const wallMat = this.roomGroup.children[1].material;
        applyStudioRoomFloorWallEnvMaps(wallMat, floorMat);

        this.setupLights();

        this.setupAirNoiseVolume();

        this.createSpheres();
        this._applyEnvMapToSphereMaterial();

        if (this.calloutSystem) this.calloutSystem.setScene(this.scene);

        this.setupCameraParticleDistances();
        this.initPostProcessing();
        this.initialized = true;
    }

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 750;
        cameraParticle.maxDistance = 4850;
        cameraParticle.maxDistanceReset = 4500;
        cameraParticle.minY = -200;
        cameraParticle.maxY = 4500;
        cameraParticle.initializePosition?.();
    }

    updateCamera() {
        if (this.trackEffects[1] && this.cameraParticles[this.currentCameraIndex]) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            this.camera.position.copy(cp.getPosition());
            this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
            this.camera.matrixWorldNeedsUpdate = false;
            return;
        }
        this.camera.lookAt(this._centerSmoothed.x, this._centerSmoothed.y, this._centerSmoothed.z);
        this.camera.matrixWorldNeedsUpdate = false;
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;

        this.currentVisibleCount = this.sphereCount;
        this.setParticleCount(this.sphereCount);
        if (this.instancedMeshManager) {
            const mainMesh = this.instancedMeshManager.getMainMesh();
            if (mainMesh) {
                mainMesh.count = this.sphereCount;
                mainMesh.instanceMatrix.needsUpdate = true;
            }
        }

        this.modeTimer += deltaTime;
        if (this.modeTimer >= this.modeInterval) {
            this.modeTimer = 0;
            const weights = [1.0, 1.2, 1.5, 1.5, 1.0, 1.0, 1.2, 1.0, 0.8, 1.5, 1.05];
            const unvisitedModes = [];
            for (let i = 0; i < this.totalModeCount; i++) {
                if (!this.modeHistory.has(i)) unvisitedModes.push(i);
            }
            let nextMode = -1;
            if (unvisitedModes.length > 0) {
                let subTotalWeight = 0;
                unvisitedModes.forEach((m) => { subTotalWeight += weights[m]; });
                let random = Math.random() * subTotalWeight;
                for (const m of unvisitedModes) {
                    if (random < weights[m]) {
                        nextMode = m;
                        break;
                    }
                    random -= weights[m];
                }
                if (nextMode === -1) nextMode = unvisitedModes[0];
            } else {
                const totalWeight = weights.reduce((a, b) => a + b, 0);
                let random = Math.random() * totalWeight;
                for (let i = 0; i < weights.length; i++) {
                    if (random < weights[i]) {
                        nextMode = i;
                        break;
                    }
                    random -= weights[i];
                }
                if (nextMode === this.currentMode) {
                    nextMode = (nextMode + 1) % this.totalModeCount;
                }
            }
            this.currentMode = nextMode;
            this.modeHistory.add(nextMode);
            if (this.modeHistory.size >= this.totalModeCount) {
                this.modeHistory.clear();
                this.modeHistory.add(this.currentMode);
            }
            this.useGravity = false;
            this.spiralMode = this.currentMode === this.MODE_HELIX_RAIL;
            this.torusMode = false;
            this.applyCameraModeForMovement();
            if (this.currentMode === this.MODE_UPTHRUST) {
                this.particles.forEach((part) => {
                    if (part.velocity.y < 0) part.velocity.y *= 0.65;
                });
            } else if (this.currentMode === this.MODE_HELIX_RAIL) {
                this.particles.forEach((p) => {
                    const rr = Math.random() * this.spawnRadius;
                    const theta = Math.random() * Math.PI * 2;
                    const phi = Math.random() * Math.PI;
                    p.position.set(
                        rr * Math.sin(phi) * Math.cos(theta),
                        p.spiralHeightFactor * 5000 - 500,
                        rr * Math.sin(phi) * Math.sin(theta)
                    );
                    p.velocity.set(0, 0, 0);
                });
            }
        }

        this.updatePhysics(deltaTime);
        this.updateExpandSpheres();
        this._smoothCenterFromParticles(deltaTime);
        this.updateCamera();

        if (this.airNoiseMaterial?.uniforms?.uTime) {
            this.airNoiseMaterial.uniforms.uTime.value = this.time;
        }

        /** Scene21 と同型：固定 DOF（オートフォーカスでピント域が狭く見えるのを防ぐ） */
        const mainInst = this.instancedMeshManager?.getMainMesh();
        const focusTargets = [this.roomGroup, mainInst].filter(Boolean);
        if (this.useAutoFocusDOF) {
            this.updateAutoFocus(focusTargets);
        } else if (this.bokehPass?.uniforms?.focus) {
            this.bokehPass.uniforms.focus.value = this.dofParams.focus;
        }
        updateSsaoDistanceAttenuation(this, this._centerSmoothed);

        if (this.calloutSystem) {
            this.calloutSystem.update(deltaTime, this.time, this.camera, {
                autoGenerate: false,
                maxCount: 8,
                margin: 200
            });
        }
    }

    static parseTrackNumber(trackNumber, message) {
        if (trackNumber !== undefined && trackNumber !== null && trackNumber !== '') {
            const num = typeof trackNumber === 'string' ? parseInt(trackNumber, 10) : Number(trackNumber);
            if (!Number.isNaN(num)) return num;
        }
        const addr = message && message.address;
        if (typeof addr === 'string') {
            let m = addr.match(/\/track\/(\d+)/i);
            if (!m) m = addr.match(/\/track(\d+)(?:\/|$)/i);
            if (m) return parseInt(m[1], 10);
        }
        return null;
    }

    handleTrackNumber(trackNumber, message) {
        const tn = Scene09.parseTrackNumber(trackNumber, message);
        if (tn !== 6) return;
        const args = message.args || [];
        const v1 = args[1] != null ? Number(args[1]) : NaN;
        const v0 = args[0] != null ? Number(args[0]) : NaN;
        let velocity = Number.isFinite(v1) ? v1 : Number.isFinite(v0) ? v0 : 127;
        if (!Number.isFinite(velocity) || velocity <= 0) return;
        if (this.trackEffects[6]) this.triggerExpandEffect(velocity);
    }

    initPostProcessing() {
        setupPostEffectsPipeline(this, {});
    }

    onResize() {
        super.onResize();
        resizePostEffectsPasses(this);
    }

    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        if (this.airNoiseVolume) {
            this.scene.remove(this.airNoiseVolume);
            if (this.airNoiseVolume.geometry) this.airNoiseVolume.geometry.dispose();
            this.airNoiseVolume = null;
        }
        if (this.airNoiseMaterial) {
            this.airNoiseMaterial.dispose();
            this.airNoiseMaterial = null;
        }

        if (this.promoWallFillLight) {
            this.scene.remove(this.promoWallFillLight);
            this.promoWallFillLight.dispose();
            this.promoWallFillLight = null;
        }
        if (this.promoWallLightTarget) {
            this.scene.remove(this.promoWallLightTarget);
            this.promoWallLightTarget = null;
        }

        if (this.roomGroup) {
            this.scene.remove(this.roomGroup);
            const seenMats = new Set();
            const seenTex = new Set();
            this.roomGroup.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material && !seenMats.has(o.material)) {
                    seenMats.add(o.material);
                    const m = o.material;
                    for (const t of [m.map, m.bumpMap, m.normalMap, m.roughnessMap, m.aoMap]) {
                        if (t && !seenTex.has(t)) {
                            seenTex.add(t);
                            t.dispose();
                        }
                    }
                    m.dispose();
                }
            });
            this.roomGroup = null;
        }
        this.ceilingMesh = null;

        if (this.studio) {
            this.studio.dispose();
            this.studio = null;
        }

        if (this.ssaoPass && this.composer) {
            const idx = this.composer.passes.indexOf(this.ssaoPass);
            if (idx !== -1) this.composer.passes.splice(idx, 1);
            this.ssaoPass = null;
        }
        if (this.saoPass && this.composer) {
            const idx = this.composer.passes.indexOf(this.saoPass);
            if (idx !== -1) this.composer.passes.splice(idx, 1);
            this.saoPass = null;
        }
        if (this.aoDepthTexture) {
            this.aoDepthTexture.dispose();
            this.aoDepthTexture = null;
        }
        disposePresentationOutputPass(this);

        this.expandSpheres.forEach((e) => {
            if (e.light) this.scene.remove(e.light);
            if (e.mesh) {
                this.scene.remove(e.mesh);
                e.mesh.geometry.dispose();
                e.mesh.material.dispose();
            }
        });
        this.expandSpheres = [];

        if (this.instancedMeshManager) {
            this.instancedMeshManager.dispose();
            this.instancedMeshManager = null;
        }
        this.particles = [];
        this.grid?.clear();

        disposeStudioRoomEnvironmentMap(
            { pmremGenerator: this.pmremGenerator, envMapTexture: this._roomEnvTexture },
            this.scene
        );
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;

        this.bloomPass = null;
        super.dispose();
    }
}
