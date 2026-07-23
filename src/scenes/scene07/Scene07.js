/**
 * Scene07: AKIRA Fiber Core
 * 中央の白い巨大球体から、ランダムな太さのケーブルが重力で垂れ下がるシーン
 * AKIRAの「アキラ」の核をイメージ
 * トラック5で赤い光が中を駆け抜ける
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import {
    StudioBox,
    attachDepthOfField,
    attachFilmGrainPass,
    attachPresentationOutputPass,
    disposePresentationOutputPass
} from '../../lib/presentation/index.js';
import { generateLabGrungeTextures } from '../../lib/LabGrungeTextures.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import { FogNoisePass } from '../../lib/FogNoisePass.js';
import { generateConcretePBRTextures } from '../../lib/ConcretePBRTextures.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class Scene07 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'Xeno Lab: Nucleus';
        this.initialized = false;
        this.sceneNumber = 7;
        this.kitNo = 18;
        
        this.sharedResourceManager = sharedResourceManager;

        // 球体の質感フラグ
        // false = Git版ブルーグレー（インダストリアル）
        // true  = 陶器風の白（つるつる反射）
        this.useCeramicSphere = false;

        // ケーブル関連
        this.cables = [];
        this.cableCount = 60;
        this.cableGroup = new THREE.Group();

        // 中央の球体
        this.centralSphere = null;
        this.coreRadius = 1300; 
        this.coreCenterY = 1200; // 400 -> 1200 (球体を浮かせるやで！)
        this.detailGroup = new THREE.Group(); // 球体やケーブルの部品用
        this.clusterPositions = [];

        // 光の弾丸（ファイバーエフェクト）管理
        this.pulses = [];

        // 撮影用スタジオ
        this.studio = null;
        this._stabilizerSteelMaterial = null;
        this._stabilizerSteelTextures = null;
        this.coreGlowVividColor = new THREE.Color();
        this.innerVividEmissive = new THREE.Color();
        /** 外殻で共有する色（メイン球は白） */
        this.sphereSessionColor = new THREE.Color();
        /** チャコールグレー：部屋・入口・漂う粒子など（ケーブル・鉄骨以外） */
        this.charcoalHex = 0x3e4248;
        /** メイン核球のベース（白） */
        this.sphereMainHex = 0xffffff;
        /** 核からこぼれるスフィアの赤 */
        this.sphereRedHex = 0xd62828;
        /** 入口プレートのウェア用テクスチャ（dispose 用） */
        this._entrancePlateTextures = null;

        // エフェクト設定（Scene21 同系：SSAO・OutputPass・控えめ DOF でミニチュア感を抑える）
        this.useDOF = true;
        this.useBloom = true;
        this.useFilmGrain = true;
        this.useSSAO = true;
        this.bloomPass = null;
        this.ssaoPass = null;
        this.outputPass = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        /** Scene21 同型：SSAO の距離スケール */
        this.ssaoNearKernelRadius = 6.2;
        this.ssaoNearMinDistance = 0.008;
        this.ssaoNearMaxDistance = 0.14;
        this.ssaoFarAttenuation = 0.42;

        /** 空間を漂うインスタンスボックス（2000） */
        this.ambientParticleCount = 10000;
        this.ambientInstManager = null;
        this.ambientParticles = [];

        /** 核球体からこぼれるピンク球（インスタンス＋表面滑り＋離脱後は自由落下） */
        this.spillInstManager = null;
        this._spillSphereGeo = null;
        this.spillParticles = [];
        this.spillMaxCount = 9000;
        this.spillRadius = 26;
        /** StudioBox の床プレーン Y（床で転がる中心高さはこれ + spillRadius） */
        this.spillFloorSurfaceY = -498;
        /** 床面上の水平移動半径（スタジオ床の半分より少し内側） */
        this.spillFloorXZExtent = 4900;
        this.spillGravity = 3800;
        this.spillFloorFriction = 520;
        this.spillSpawnRate = 34;
        this.spillSpawnAccum = 0;
        this._spillG = new THREE.Vector3();
        this._spillCenter = new THREE.Vector3();
        this._spillTmpOff = new THREE.Vector3();
        this._spillTmpTangent = new THREE.Vector3();
        this._spillTmpN = new THREE.Vector3();
        this._spillTmpAxis = new THREE.Vector3();
        this._spillTmpQ = new THREE.Quaternion();
        this._spillScale = new THREE.Vector3(1, 1, 1);
        this._spillHidePos = new THREE.Vector3(0, -8e5, 0);
        this._spillHideScale = new THREE.Vector3(0.0001, 0.0001, 0.0001);
        this._spillIdentityQuat = new THREE.Quaternion();
        this._spillWorldUp = new THREE.Vector3(0, 1, 0);
        this._spillTmpH = new THREE.Vector3();
        /** スピアのインスタンス別ブルーム用（エミッシブ乗算、dispose で null） */
        this._spillBloomAttr = null;
        /** 生まれた直後のブルーム強さ（エミッシブ乗算のピーク） */
        this.spillBloomPeakMul = 5.2;
        /** 空中・球面でブルームがほぼ消えるまでの秒数 */
        this.spillBloomDecaySec = 2.6;

        this._fogNoiseConfig = null;
        /** Scene21 床と同系のコンクリPBR（目地なし）— ケーブル類に共有 */
        this._cableConcreteTextures = null;
        /** チューブ・終端リング用：球殻とは別パターンのラボ汚れ */
        this._cableLabGrungeTextures = null;
        this.fogNoisePass = null;
        this._composerRTPrimary = null;
        this._composerRTSecondary = null;

        // ストロボエフェクト管理
        this.strobeActive = false;
        this.strobeEndTime = 0;

        // カラー管理（トラック8で変化）
        this.pulseColor = new THREE.Color(1.0, 0.0, 0.0); // 初期値は赤
        this.targetPulseColor = new THREE.Color(1.0, 0.0, 0.0);
        this.colorIndex = 0; // トラック8が鳴る度に切り替えるためのインデックス
        this.colors = [
            new THREE.Color(1.0, 0.0, 0.0), // 赤
            new THREE.Color(0.0, 1.0, 0.0), // 緑
            new THREE.Color(0.0, 0.0, 1.0), // 青
            new THREE.Color(1.0, 1.0, 1.0), // 白
            new THREE.Color(1.0, 0.0, 1.0), // 紫
            new THREE.Color(0.0, 1.0, 1.0)  // 水色
        ];

        // 球体の発光管理（トラック5で変化）
        this.coreEmissiveIntensity = 0.1;
        this.targetCoreEmissiveIntensity = 0.1;

        // メインは SpotLight 1本（パルスで強度・色が乗る）
        this.spotLight = null;
        /** 常時スポットのベース強度 */
        this.spotBaseIntensity = 1.28;
        this.lightIntensity = 0.0;
        this.targetLightIntensity = 0.0;

        this.trackEffects = {
            1: true, 2: false, 3: false, 4: false, 5: true, 6: true, 7: false, 8: false, 9: false
        };

        this.setScreenshotText(this.title);

        // --- コールアウト管理（HUD 2D 描画） ---
        if (this.calloutSystem) {
            this.calloutSystem.setUse3DCallouts(false);
            this.calloutSystem.setLabels([
                "CORE_TEMP: NORMAL", "VOLTAGE: 1.2MV", "PRESSURE: 450kPa", 
                "SYNC_RATE: 98.2%", "FLOW_CTRL: ACTIVE", "CELL_STAT: STABLE",
                "NUCLEUS_ID: 0x18", "XENO_LINK: ESTABLISHED"
            ]);
        }
    }

    setupCameraParticleDistance(cameraParticle) {
        // 球体の半径が1300、中心高さが coreCenterY
        cameraParticle.minDistance = 3500; 
        cameraParticle.maxDistance = 6500; 
        
        // 高さのバリエーションも調整！
        cameraParticle.minY = 200; 
        cameraParticle.maxY = 5500; // 4500 -> 5500 (球体が上がった分、上も広げる)
    }

    /**
     * カメラの位置を更新（SceneBaseのオーバーライド）
     */
    updateCamera() {
        if (this.cameraParticles[this.currentCameraIndex]) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            const cameraPos = cp.getPosition();
            
            // --- 球体の内部に入らないように強制補正 ---
            const coreCenter = new THREE.Vector3(0, this.coreCenterY, 0);
            const distToCore = cameraPos.distanceTo(coreCenter);
            
            // 安全距離（半径1300 + 余裕分）
            const safeDistance = 2500; 
            
            if (distToCore < safeDistance) {
                const dir = cameraPos.clone().sub(coreCenter).normalize();
                cameraPos.copy(coreCenter.clone().add(dir.multiplyScalar(safeDistance)));
            }

            // 部屋の境界（StudioBox）を突き抜けないようにクランプ
            const roomLimit = 4800; 
            cameraPos.x = THREE.MathUtils.clamp(cameraPos.x, -roomLimit, roomLimit);
            cameraPos.z = THREE.MathUtils.clamp(cameraPos.z, -roomLimit, roomLimit);
            cameraPos.y = THREE.MathUtils.clamp(cameraPos.y, 150, 4800); 
            
            this.camera.position.copy(cameraPos);
            this.camera.lookAt(coreCenter);
            this.camera.matrixWorldNeedsUpdate = false;
        }
    }

    /**
     * カメラをランダムに切り替える（SceneBase de override）
     */
    switchCameraRandom() {
        super.switchCameraRandom();
        
        const cp = this.cameraParticles[this.currentCameraIndex];
        if (cp) {
            // ランダム切り替え時に、スタジオ内に収まるように位置を調整するやで！
            const rand = Math.random();
            const roomLimit = 4500;
            if (rand < 0.4) {
                // 引きの絵（部屋の隅っこ）
                const angle = Math.random() * Math.PI * 2;
                const dist = 3500 + Math.random() * 1000;
                cp.position.set(
                    Math.cos(angle) * dist,
                    1000 + Math.random() * 2000,
                    Math.sin(angle) * dist
                );
            } else if (rand < 0.7) {
                // ローアングル
                const angle = Math.random() * Math.PI * 2;
                const dist = 3000 + Math.random() * 1500;
                cp.position.set(
                    Math.cos(angle) * dist,
                    250 + Math.random() * 400,
                    Math.sin(angle) * dist
                );
            } else {
                // 俯瞰
                const angle = Math.random() * Math.PI * 2;
                const dist = 3500 + Math.random() * 1000;
                cp.position.set(
                    Math.cos(angle) * dist,
                    3500 + Math.random() * 1000,
                    Math.sin(angle) * dist
                );
            }
        }
    }

    setupEnvironment() {
        this.pmremGenerator = new PMREMGenerator(this.renderer);
        this.pmremGenerator.compileEquirectangularShader();
        const envScene = new RoomEnvironment();
        this._roomEnvTexture = this.pmremGenerator.fromScene(envScene, 0.045).texture;
        this.scene.environment = this._roomEnvTexture;
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.56;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if ('transmissionResolutionScale' in this.renderer) {
            this.renderer.transmissionResolutionScale = 1;
        }

        this.scene.background = new THREE.Color(0x18191c);
        /** FogNoisePass：チャコール系（遠景をしっかりかぶせる） */
        this._fogNoiseConfig = {
            color: new THREE.Color(0x2e3036),
            density: 0.00032,
            noiseAmp: 0.036,
            noiseScale: 0.00007,
            timeScale: 0.09
        };

        // 初期位置も十分に離す
        this.camera.position.set(0, 5000, 10000);
        this.camera.lookAt(0, this.coreCenterY, 0);
        if (this.camera.fov !== 60) {
            this.camera.fov = 60;
        }
        this.camera.near = 12;
        this.camera.far = 12000;
        this.camera.updateProjectionMatrix();

        // シャドウはこのスポットのみが投射。cast/receive はメッシュ単位（未設定は false）
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

        this.setupEnvironment();

        this.setupLights();
        // 2Dコールアウト：ワールド座標→スクリーン投影にシーン参照が必要
        if (this.calloutSystem) {
            this.calloutSystem.setScene(this.scene);
        }
        this.createStudioBox();
        this.createCore();
        this.createSphereDetails(); // 球体の部品追加
        this.createEntranceUnit(); // 先に入口ユニットを作って位置を確定させる！
        this.createCables(); // ケーブルは後から作って入口を避ける！
        this.createStabilizerPipes(); // 安定パイプを追加！
        this.createAmbientFloatingParticles();
        this.createPinkSpillSpheres();
        this.initPostProcessing();
        this.setParticleCount(this.cableCount + this.ambientParticleCount + this.spillMaxCount);
        this.initialized = true;
    }

    /**
     * Scene21 同系：金属ダストが空間を漂うインスタンスボックス
     */
    createAmbientFloatingParticles() {
        const count = this.ambientParticleCount;
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const envTex = this.scene.environment;
        const mat = new THREE.MeshStandardMaterial({
            color: this.charcoalHex,
            metalness: 0.48,
            roughness: 0.32,
            envMap: envTex,
            envMapIntensity: 0.34,
            emissive: 0x1c1d22,
            emissiveIntensity: 0.055,
            fog: true,
            vertexColors: true
        });

        this.ambientInstManager = new InstancedMeshManager(this.scene, boxGeo, mat, count);
        const mainMesh = this.ambientInstManager.getMainMesh();
        mainMesh.castShadow = false;
        mainMesh.receiveShadow = false;
        mainMesh.renderOrder = -2;

        const room = 4500;
        const bx = room - 380;
        const bz = room - 380;
        const yMin = 220;
        const yMax = 5200;

        this.ambientParticles = [];
        for (let i = 0; i < count; i++) {
            const x = (Math.random() * 2 - 1) * bx;
            const z = (Math.random() * 2 - 1) * bz;
            const y = yMin + Math.random() * (yMax - yMin);
            const position = new THREE.Vector3(x, y, z);
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 92,
                (Math.random() - 0.5) * 58,
                (Math.random() - 0.5) * 92
            );
            const rotation = new THREE.Euler(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            );
            const angVel = new THREE.Vector3(
                (Math.random() - 0.5) * 1.9,
                (Math.random() - 0.5) * 1.9,
                (Math.random() - 0.5) * 1.9
            );
            const sr = 0.65 + Math.random() * 3.0;
            const scale = new THREE.Vector3(
                sr * (0.35 + Math.random() * 1.6),
                sr * (0.35 + Math.random() * 1.6),
                sr * (0.35 + Math.random() * 1.6)
            );
            scale.multiplyScalar(0.52);
            const phase = Math.random() * Math.PI * 2;
            this.ambientParticles.push({
                position,
                velocity,
                rotation,
                angVel,
                scale,
                phase
            });
            this.ambientInstManager.setMatrixAt(i, position, rotation, scale);
            const lum = 0.2 + Math.random() * 0.16;
            this.ambientInstManager.setColorAt(i, new THREE.Color(lum, lum, lum));
        }
        this.ambientInstManager.markColorsNeedsUpdate();
        this.ambientInstManager.markNeedsUpdate();
    }

    _updateAmbientParticles(deltaTime) {
        if (!this.ambientInstManager || !this.ambientParticles.length) return;
        const room = 4500;
        const bx = room - 340;
        const bz = room - 340;
        const yMin = 200;
        const yMax = 5300;
        const t = this.time;
        const dt = deltaTime;

        for (let i = 0; i < this.ambientParticles.length; i++) {
            const ap = this.ambientParticles[i];
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

            this.ambientInstManager.setMatrixAt(i, ap.position, ap.rotation, ap.scale);
        }
        this.ambientInstManager.markNeedsUpdate();
    }

    /**
     * 核球の上から赤いスフィアを生成し、表面に沿って重力で滑らせる（球同士の当たり判定なし）
     */
    createPinkSpillSpheres() {
        const r = this.spillRadius;
        this._spillSphereGeo = new THREE.SphereGeometry(r, 12, 10);
        const n = this.spillMaxCount;
        const bloomArr = new Float32Array(n);
        bloomArr.fill(0);
        this._spillBloomAttr = new THREE.InstancedBufferAttribute(bloomArr, 1);
        this._spillBloomAttr.setUsage(THREE.DynamicDrawUsage);
        this._spillSphereGeo.setAttribute('instanceBloom', this._spillBloomAttr);

        const envTex = this.scene.environment;
        const mat = new THREE.MeshStandardMaterial({
            color: this.sphereRedHex,
            emissive: 0x3a0808,
            emissiveIntensity: 0.14,
            metalness: 0.08,
            roughness: 0.38,
            envMap: envTex,
            envMapIntensity: 0.55,
            fog: true
        });
        mat.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                attribute float instanceBloom;
                varying float vSpillBloomMul;`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                vSpillBloomMul = instanceBloom;`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                varying float vSpillBloomMul;`
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
                totalEmissiveRadiance *= vSpillBloomMul;`
            );
        };
        this.spillInstManager = new InstancedMeshManager(this.scene, this._spillSphereGeo, mat, n);
        const mesh = this.spillInstManager.getMainMesh();
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 1;

        for (let i = 0; i < n; i++) {
            this.spillParticles.push({
                active: false,
                onSurface: true,
                onFloor: false,
                birthTime: 0,
                p: new THREE.Vector3(),
                v: new THREE.Vector3(),
                q: new THREE.Quaternion()
            });
            this.spillInstManager.setMatrixAt(i, this._spillHidePos, this._spillIdentityQuat, this._spillHideScale);
        }
        this.spillInstManager.markNeedsUpdate();
    }

    _spawnOneSpillPinkSphere() {
        const idx = this.spillParticles.findIndex((x) => !x.active);
        const i = idx >= 0 ? idx : (Math.random() * this.spillMaxCount) | 0;
        const part = this.spillParticles[i];
        const bigR = this.coreRadius + this.spillRadius;
        const cap = 0.26;
        const theta = Math.random() * cap;
        const phi = Math.random() * Math.PI * 2;
        const st = Math.sin(theta);
        const dir = new THREE.Vector3(st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi));
        this._spillCenter.set(0, this.coreCenterY, 0);
        part.p.copy(this._spillCenter).addScaledVector(dir, bigR);
        part.v.set(0, 0, 0);
        part.q.identity();
        part.onSurface = true;
        part.onFloor = false;
        part.active = true;
        part.birthTime = this.time;
    }

    _updatePinkSpillSpheres(deltaTime) {
        if (!this.spillInstManager || !this.spillParticles.length) return;
        const dt = Math.min(deltaTime, 0.048);
        const steps = dt > 0.024 ? 2 : 1;
        const subDt = dt / steps;

        const rate = this.spillSpawnRate + Math.min(44, this.time * 0.38);
        this.spillSpawnAccum += rate * dt;
        while (this.spillSpawnAccum >= 1) {
            this.spillSpawnAccum -= 1;
            this._spawnOneSpillPinkSphere();
        }

        const G = this.spillGravity;
        const bigR = this.coreRadius + this.spillRadius;
        const smallR = this.spillRadius;
        this._spillCenter.set(0, this.coreCenterY, 0);
        const floorY = this.spillFloorSurfaceY + smallR;
        const xzLim = this.spillFloorXZExtent - smallR;
        const fric = this.spillFloorFriction;

        for (let s = 0; s < steps; s++) {
            for (let i = 0; i < this.spillMaxCount; i++) {
                const part = this.spillParticles[i];
                if (!part.active) continue;

                const p = part.p;
                const v = part.v;
                const q = part.q;

                if (part.onSurface) {
                    this._spillG.set(0, -G, 0);
                    this._spillTmpOff.copy(p).sub(this._spillCenter);
                    this._spillTmpOff.normalize();
                    const gn = this._spillG.dot(this._spillTmpOff);
                    this._spillTmpTangent.copy(this._spillG).sub(
                        this._spillTmpN.copy(this._spillTmpOff).multiplyScalar(gn)
                    );
                    v.addScaledVector(this._spillTmpTangent, subDt);
                    v.multiplyScalar(0.9984);
                    p.addScaledVector(v, subDt);

                    this._spillTmpOff.copy(p).sub(this._spillCenter);
                    this._spillTmpOff.normalize();
                    p.copy(this._spillCenter).addScaledVector(this._spillTmpOff, bigR);
                    const vn = v.dot(this._spillTmpOff);
                    v.sub(this._spillTmpN.copy(this._spillTmpOff).multiplyScalar(vn));

                    if (this._spillTmpOff.y < -0.052) {
                        part.onSurface = false;
                    }

                    const speed = v.length();
                    if (speed > 0.4) {
                        this._spillTmpAxis.crossVectors(this._spillTmpOff, v);
                        if (this._spillTmpAxis.lengthSq() > 1e-8) {
                            this._spillTmpAxis.normalize();
                            const ang = (speed * subDt) / smallR;
                            this._spillTmpQ.setFromAxisAngle(this._spillTmpAxis, ang);
                            q.multiply(this._spillTmpQ);
                        }
                    }
                } else if (part.onFloor) {
                    v.y = 0;
                    p.y = floorY;
                    const hsp = this._spillTmpH.set(v.x, 0, v.z);
                    const hlen = hsp.length();
                    if (hlen > 1e-6) {
                        const decel = Math.min(fric * subDt, hlen);
                        const f = (hlen - decel) / hlen;
                        v.x *= f;
                        v.z *= f;
                    }
                    p.x += v.x * subDt;
                    p.z += v.z * subDt;
                    const wallB = 0.38;
                    if (p.x > xzLim) {
                        p.x = xzLim;
                        v.x *= -wallB;
                    } else if (p.x < -xzLim) {
                        p.x = -xzLim;
                        v.x *= -wallB;
                    }
                    if (p.z > xzLim) {
                        p.z = xzLim;
                        v.z *= -wallB;
                    } else if (p.z < -xzLim) {
                        p.z = -xzLim;
                        v.z *= -wallB;
                    }
                    const hsp2 = this._spillTmpH.set(v.x, 0, v.z);
                    const hlen2 = hsp2.length();
                    if (hlen2 < 0.028) {
                        v.x = 0;
                        v.z = 0;
                    }
                    if (hlen2 > 0.05) {
                        this._spillTmpAxis.crossVectors(this._spillWorldUp, hsp2);
                        if (this._spillTmpAxis.lengthSq() > 1e-8) {
                            this._spillTmpAxis.normalize();
                            this._spillTmpQ.setFromAxisAngle(
                                this._spillTmpAxis,
                                (hlen2 * subDt) / smallR
                            );
                            q.multiply(this._spillTmpQ);
                        }
                    }
                } else {
                    this._spillG.set(0, -G, 0);
                    v.addScaledVector(this._spillG, subDt);
                    p.addScaledVector(v, subDt);
                    v.multiplyScalar(0.9994);

                    if (p.y <= floorY && v.y <= 0) {
                        part.onFloor = true;
                        p.y = floorY;
                        const vyAbs = Math.abs(v.y);
                        v.y = 0;
                        const slip = Math.hypot(v.x, v.z);
                        const boost = 0.88 + Math.min(2.2, vyAbs * 0.0024);
                        v.x *= boost;
                        v.z *= boost;
                        if (slip < 320 && vyAbs > 100) {
                            const kick = 160 + Math.min(480, vyAbs * 0.42);
                            v.x += (Math.random() - 0.5) * kick;
                            v.z += (Math.random() - 0.5) * kick;
                        }
                    }

                    const speed = v.length();
                    if (speed > 2) {
                        this._spillTmpAxis.crossVectors(this._spillWorldUp, v);
                        if (this._spillTmpAxis.lengthSq() > 1e-6) {
                            this._spillTmpAxis.normalize();
                            this._spillTmpQ.setFromAxisAngle(
                                this._spillTmpAxis,
                                (speed * subDt) / smallR
                            );
                            q.multiply(this._spillTmpQ);
                        }
                    }
                }
            }
        }

        const peak = this.spillBloomPeakMul;
        const decay = this.spillBloomDecaySec;
        const bloomArr = this._spillBloomAttr ? this._spillBloomAttr.array : null;

        for (let i = 0; i < this.spillMaxCount; i++) {
            const part = this.spillParticles[i];
            let bloomMul = 0;
            if (part.active && bloomArr) {
                if (part.onFloor) {
                    bloomMul = 0;
                } else {
                    const age = this.time - part.birthTime;
                    bloomMul = Math.max(0, peak * (1 - age / decay));
                }
                bloomArr[i] = bloomMul;
            } else if (bloomArr) {
                bloomArr[i] = 0;
            }

            if (part.active) {
                this.spillInstManager.setMatrixAt(i, part.p, part.q, this._spillScale);
            } else {
                this.spillInstManager.setMatrixAt(
                    i,
                    this._spillHidePos,
                    this._spillIdentityQuat,
                    this._spillHideScale
                );
            }
        }
        if (this._spillBloomAttr) {
            this._spillBloomAttr.needsUpdate = true;
        }
        this.spillInstManager.markNeedsUpdate();
    }

    onResize() {
        super.onResize();
        if (this.ssaoPass && typeof this.ssaoPass.setSize === 'function') {
            this.ssaoPass.setSize(window.innerWidth, window.innerHeight);
        }
        this._syncAODepthAndCameraUniforms(this.ssaoPass);
    }

    setupLights() {
        const pureWhite = 0xffffff;
        const coneAngle = Math.PI / 4.4;
        this.spotLight = new THREE.SpotLight(
            pureWhite,
            this.spotBaseIntensity,
            18000,
            coneAngle,
            0.38,
            1
        );
        this.spotLight.decay = 0;
        // 球体中心（核）を正面から当てる：位置は中心方向へ寄せ、ターゲットは球の中心
        const sphereCenter = new THREE.Vector3(0, this.coreCenterY, 0);
        this.spotLight.position.set(3400, 4800, 3600);
        this.spotLight.target.position.copy(sphereCenter);
        this.scene.add(this.spotLight);
        this.scene.add(this.spotLight.target);

        this.spotLight.castShadow = true;
        this.spotLight.shadow.mapSize.set(2048, 2048);
        this.spotLight.shadow.camera.near = 120;
        this.spotLight.shadow.camera.far = 20000;
        this.spotLight.shadow.bias = -0.00018;
        this.spotLight.shadow.radius = 3;
    }

    createStudioBox() {
        this.studio = new StudioBox(this.scene, {
            color: this.charcoalHex,
            envMap: this._roomEnvTexture,
            envMapIntensity: 0.34,
            lightIntensity: 3.6,
            /** 輪郭とSSAO用の極小フィル（メインはスポットのみ） */
            ambientIntensity: 0.085,
            grungeEnabled: true,
            maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
            grungeWallRepeat: { x: 6.9, y: 4.1 },
            grungeFloorRepeat: { x: 4.2, y: 8.4 },
            grungeWallOffset: { x: 0.21, y: 0.41 },
            grungeFloorOffset: { x: 0.63, y: 0.08 },
            grungeWallTexOptions: {
                stainContrast: 1.2,
                stainEdgeBias: 0.58,
                stainCornerBias: true,
                stainBiasMul: 1.32
            },
            grungeFloorTexOptions: {
                stainContrast: 1.26,
                stainEdgeBias: 0.68,
                stainCornerBias: true,
                stainBiasMul: 1.45
            }
        });
    }

    /**
     * 核まわり（球殻・取り付け部品）用：白陶器っぽい MeshPhysical（クリアコート弱め）
     */
    _createCeramicHullMaterial(overrides = {}) {
        return new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0xf6f5f3),
            metalness: 0.02,
            roughness: 0.32,
            clearcoat: 0.48,
            clearcoatRoughness: 0.17,
            envMap: this.scene.environment,
            envMapIntensity: 0.64,
            side: THREE.FrontSide,
            ...overrides
        });
    }

    /**
     * 入口プレート用：高さからノーマル＋ラフネス（角・直線スクラッチを汚す）
     */
    _generateEntrancePlateWearTextures(size = 512) {
        const S = size;
        const h = new Float32Array(S * S);
        const scratchH = [];
        const scratchV = [];
        for (let i = 0; i < 44; i++) {
            scratchH.push((((i * 137) % 251) / 250) * (S - 1));
            scratchV.push((((i * 193) % 241) / 240) * (S - 1));
        }
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const u = x / (S - 1);
                const v = y / (S - 1);
                const ed = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
                let val = 0.5;
                val -= Math.pow(1 - Math.min(ed * 9, 1), 2.1) * 0.42;
                val += Math.sin(x * 0.14 + y * 0.09) * 0.028;
                val += Math.sin(x * 0.038 - y * 0.052) * 0.052;
                val += Math.sin(x * 0.11) * Math.sin(y * 0.13) * 0.018;
                for (let k = 0; k < scratchH.length; k++) {
                    const ly = scratchH[k];
                    const d = Math.abs(y - ly);
                    if (d < 1.2) val -= 0.09 * (1 - d / 1.2);
                }
                for (let k = 0; k < scratchV.length; k++) {
                    const lx = scratchV[k];
                    const d = Math.abs(x - lx);
                    if (d < 1.2) val -= 0.09 * (1 - d / 1.2);
                }
                h[y * S + x] = Math.max(0, Math.min(1, val));
            }
        }
        const normData = new Uint8ClampedArray(S * S * 4);
        const roughData = new Uint8ClampedArray(S * S * 4);
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const xm = Math.max(0, x - 1);
                const xp = Math.min(S - 1, x + 1);
                const ym = Math.max(0, y - 1);
                const yp = Math.min(S - 1, y + 1);
                const idx = y * S + x;
                const dx = (h[y * S + xp] - h[y * S + xm]) * 0.5;
                const dy = (h[yp * S + x] - h[ym * S + x]) * 0.5;
                let nx = -dx * 4.2;
                let ny = -dy * 4.2;
                let nz = 1;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                nx /= len;
                ny /= len;
                nz /= len;
                const i4 = idx * 4;
                normData[i4] = (nx * 0.5 + 0.5) * 255;
                normData[i4 + 1] = (ny * 0.5 + 0.5) * 255;
                normData[i4 + 2] = (nz * 0.5 + 0.5) * 255;
                normData[i4 + 3] = 255;
                const u = x / (S - 1);
                const v = y / (S - 1);
                const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
                const rough = 0.38 + (1 - Math.min(edge * 8, 1)) * 0.48;
                const rv = Math.min(255, Math.max(0, rough * 255));
                roughData[i4] = 0;
                roughData[i4 + 1] = rv;
                roughData[i4 + 2] = 0;
                roughData[i4 + 3] = 255;
            }
        }
        const normCanvas = document.createElement('canvas');
        normCanvas.width = normCanvas.height = S;
        normCanvas.getContext('2d').putImageData(new ImageData(normData, S, S), 0, 0);
        const roughCanvas = document.createElement('canvas');
        roughCanvas.width = roughCanvas.height = S;
        roughCanvas.getContext('2d').putImageData(new ImageData(roughData, S, S), 0, 0);
        const maxA = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
        const normalMap = new THREE.CanvasTexture(normCanvas);
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        normalMap.repeat.set(2, 2);
        normalMap.colorSpace = THREE.NoColorSpace;
        normalMap.generateMipmaps = false;
        normalMap.minFilter = THREE.LinearFilter;
        normalMap.magFilter = THREE.LinearFilter;
        normalMap.anisotropy = maxA;
        const roughnessMap = new THREE.CanvasTexture(roughCanvas);
        roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
        roughnessMap.repeat.copy(normalMap.repeat);
        roughnessMap.colorSpace = THREE.NoColorSpace;
        roughnessMap.generateMipmaps = false;
        roughnessMap.minFilter = THREE.LinearFilter;
        roughnessMap.magFilter = THREE.LinearFilter;
        roughnessMap.anisotropy = maxA;
        return { normalMap, roughnessMap };
    }

    /** 外殻：白の単純メッシュ用（マップ・ディスプレイスメントなし） */
    _createSphereShellMaterial() {
        const m = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.08,
            roughness: 0.36,
            envMap: this.scene.environment,
            envMapIntensity: 0.52,
            fog: true,
            side: THREE.DoubleSide
        });
        m.userData.sphereCeramicShell = true;
        m.userData.sphereGlassShell = true;
        return m;
    }

    createCore() {
        this.centralSphere = new THREE.Group();
        this.centralSphere.position.y = this.coreCenterY;
        this.scene.add(this.centralSphere);

        const cableBaseMat = this._createCeramicHullMaterial(
            this.useCeramicSphere
                ? {
                    roughness: 0.22,
                    clearcoat: 0.58,
                    clearcoatRoughness: 0.11,
                    envMapIntensity: 0.7
                }
                : {
                    roughness: 0.32,
                    clearcoat: 0.48,
                    clearcoatRoughness: 0.17,
                    envMapIntensity: 0.64
                }
        );
        cableBaseMat.userData.sphereCeramicShell = true;

        const maxA = this.renderer.capabilities.getMaxAnisotropy();
        // 壁と同じ解像度＆低めの repeat でシミが画面上で大きく見えるようにする
        this._sphereLabGrungeTextures = generateLabGrungeTextures(2048, {
            variant: 'sphere',
            seed: 17,
            maxAnisotropy: maxA
        });
        const gr = 7.5;
        const gt = 9;
        ['map', 'normalMap', 'roughnessMap', 'aoMap'].forEach((key) => {
            const tex = this._sphereLabGrungeTextures[key];
            if (tex) tex.repeat.set(gr, gt);
        });
        cableBaseMat.normalMap = this._sphereLabGrungeTextures.normalMap;
        cableBaseMat.normalScale = new THREE.Vector2(0.92, 0.92);
        cableBaseMat.roughnessMap = this._sphereLabGrungeTextures.roughnessMap;
        cableBaseMat.aoMap = this._sphereLabGrungeTextures.aoMap;
        cableBaseMat.aoMapIntensity = 0.48;
        // 汚れアルベドは乗せず純白ベース（凹凸・粗さマップのみ）
        cableBaseMat.map = null;
        cableBaseMat.color.set(0xffffff);
        cableBaseMat.roughness = 0.46;
        cableBaseMat.metalness = 0.02;
        cableBaseMat.clearcoat = 0.08;
        cableBaseMat.clearcoatRoughness = 0.38;
        cableBaseMat.envMapIntensity = 0.48;
        cableBaseMat.needsUpdate = true;
        this.sharedWhiteShellMaterial = cableBaseMat;

        this._cableLabGrungeTextures = generateLabGrungeTextures(1024, {
            variant: 'wall',
            seed: 91,
            maxAnisotropy: maxA
        });
        const cabU = 26;
        const cabV = 4.2;
        ['map', 'normalMap', 'roughnessMap', 'aoMap', 'bumpMap'].forEach((key) => {
            const tex = this._cableLabGrungeTextures[key];
            if (tex && tex.repeat) tex.repeat.set(cabU, cabV);
        });

        // 外殻は白の SphereGeometry（歪み・ディスプレイスメントなし）
        this.sphereSessionColor.setHex(this.sphereMainHex);
        const shellMat = this._createSphereShellMaterial();
        const shellGeo = new THREE.SphereGeometry(this.coreRadius, 64, 64);
        this._ensureUv2(shellGeo);
        const outerShell = new THREE.Mesh(shellGeo, shellMat);
        outerShell.castShadow = true;
        outerShell.receiveShadow = true;
        this.centralSphere.add(outerShell);

        // --- 内側のインナー球体（光る核にするで！） ---
        const innerGeo = new THREE.SphereGeometry(this.coreRadius - 5, 64, 64); // -15 -> -5 (外殻にギリギリまで近づける)
        const innerBodyColor = new THREE.Color()
            .copy(this.sphereSessionColor)
            .lerp(new THREE.Color(0x000000), 0.58);
        this.innerVividEmissive.copy(this.sphereSessionColor);
        const innerMat = new THREE.MeshPhysicalMaterial({
            color: innerBodyColor,
            roughness: 0.42,
            metalness: 0,
            clearcoat: 0.12,
            clearcoatRoughness: 0.35,
            envMap: this.scene.environment,
            envMapIntensity: 0.18,
            emissive: this.innerVividEmissive,
            emissiveIntensity: 0.0
        });
        this.innerSphere = new THREE.Mesh(innerGeo, innerMat);
        this.innerSphere.receiveShadow = true;
        this.centralSphere.add(this.innerSphere);

        // さらに内側に、より強い光を放つコアを追加（ブルーム効果を狙う）
        const coreGlowGeo = new THREE.SphereGeometry(this.coreRadius - 10, 32, 32); // -30 -> -10 (さらに外側に広げる)
        this.coreGlowVividColor.copy(this.sphereSessionColor);
        const coreGlowMat = new THREE.MeshBasicMaterial({
            color: this.coreGlowVividColor.clone(),
            transparent: true,
            opacity: 0.0, 
            blending: THREE.AdditiveBlending 
        });
        this.coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMat);
        this.centralSphere.add(this.coreGlow);

        this.scene.add(this.detailGroup);
    }

    generateDirtyTextures(size = 512, baseColor = 0xffffff, isMatte = false) {
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size; colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');
        
        // ベースカラー
        const hex = '#' + new THREE.Color(baseColor).getHexString();
        cCtx.fillStyle = hex;
        cCtx.fillRect(0, 0, size, size);
        
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size; bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#808080'; // 中間グレー
        bCtx.fillRect(0, 0, size, size);
        
        // --- 「古びた金属」感を出すためのノイズ強化 ---
        // 1. 全体的なザラつき（微細なノイズ）
        for (let i = 0; i < (isMatte ? 10000 : 5000); i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = Math.random() * 1.5;
            const val = 128 + (Math.random() - 0.5) * 60; // バンプの凹凸を激しく
            bCtx.fillStyle = `rgb(${val}, ${val}, ${val})`;
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }

        // 2. 汚れ・腐食（大きめのシミ）
        const dirtCount = isMatte ? 1000 : 600; 
        for (let i = 0; i < dirtCount; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = Math.random() * (isMatte ? 15 : 8); // シミを大きく
            const alpha = Math.random() * 0.3; 
            
            cCtx.fillStyle = `rgba(30, 30, 30, ${alpha})`;
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
            
            const val = 128 + (Math.random() - 0.5) * 100; // 凹凸を深く
            bCtx.fillStyle = `rgb(${val}, ${val}, ${val})`;
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }

        // 3. ひっかき傷（金属の劣化感）
        for (let i = 0; i < 150; i++) { 
            const x = Math.random() * size;
            const y = Math.random() * size;
            const len = 10 + Math.random() * 60;
            const angle = Math.random() * Math.PI * 2;
            
            bCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)';
            bCtx.lineWidth = 1.0;
            bCtx.beginPath();
            bCtx.moveTo(x, y);
            bCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
            bCtx.stroke();
        }

        // ケーブル用のかすれた線（プラスチック感）
        if (!isMatte) {
            for (let i = 0; i < 100; i++) {
                const x = Math.random() * size;
                const y = Math.random() * size;
                const len = 20 + Math.random() * 100;
                const angle = Math.random() * Math.PI * 2;
                
                cCtx.strokeStyle = `rgba(100, 100, 100, 0.1)`;
                cCtx.lineWidth = 1;
                cCtx.beginPath();
                cCtx.moveTo(x, y);
                cCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
                cCtx.stroke();
                
                bCtx.strokeStyle = `rgb(100, 100, 100)`;
                bCtx.beginPath();
                bCtx.moveTo(x, y);
                bCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
                bCtx.stroke();
            }
        }
        
        const map = new THREE.CanvasTexture(colorCanvas);
        const bumpMap = new THREE.CanvasTexture(bumpCanvas);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
        
        return { map, bumpMap };
    }

    /**
     * 鉄骨用：黄×黒の縞（画像は横帯＝y が進むと交互。Box のデフォ UV で各面に素直に乗る）
     */
    generateRepaintedYellowSteelTextures(size = 1024) {
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size;
        colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');

        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size;
        bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');

        const rnd = () => Math.random();
        const yR = 255;
        const yG = 214;
        const yB = 0;
        const kR = 18;
        const kG = 18;
        const kB = 20;
        // 横帯（画像の y が進むと黄/黒が交互）— stripeH 大きいほど帯が太い
        const stripeH = 128;
        const imgData = cCtx.createImageData(size, size);
        const d = imgData.data;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const band = Math.floor(y / stripeH) % 2;
                const i = (y * size + x) * 4;
                if (band === 0) {
                    d[i] = yR;
                    d[i + 1] = yG;
                    d[i + 2] = yB;
                } else {
                    d[i] = kR;
                    d[i + 1] = kG;
                    d[i + 2] = kB;
                }
                d[i + 3] = 255;
            }
        }
        cCtx.putImageData(imgData, 0, 0);
        // soft-light 等は黄と黒の差を潰してストライプが消えるので載せない

        // --- bump: 明るさから高さ＋微細ノイズ ---
        const out = cCtx.getImageData(0, 0, size, size);
        const od = out.data;
        const bumpImg = bCtx.createImageData(size, size);
        const bd = bumpImg.data;
        for (let i = 0; i < od.length; i += 4) {
            const L = 0.299 * od[i] + 0.587 * od[i + 1] + 0.114 * od[i + 2];
            const pi = i >> 2;
            const px = pi % size;
            const py = (pi / size) | 0;
            const wobble = Math.sin(px * 0.031) * Math.sin(py * 0.027) * 8;
            let h = 65 + (L / 255) * 165 + wobble;
            h = Math.max(35, Math.min(245, h));
            bd[i] = bd[i + 1] = bd[i + 2] = h;
            bd[i + 3] = 255;
        }
        bCtx.putImageData(bumpImg, 0, 0);
        for (let n = 0; n < 1200; n++) {
            const x = rnd() * size;
            const y = rnd() * size;
            const r = rnd() * 0.85;
            const v = 128 + (rnd() - 0.5) * 28;
            bCtx.fillStyle = `rgb(${v},${v},${v})`;
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }

        const map = new THREE.CanvasTexture(colorCanvas);
        const bumpMap = new THREE.CanvasTexture(bumpCanvas);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
        // 黄黒の細線がミップで灰色に平均化されないようミップオフ＋シャープフィルタ
        map.generateMipmaps = false;
        bumpMap.generateMipmaps = false;
        map.minFilter = THREE.LinearFilter;
        map.magFilter = THREE.LinearFilter;
        bumpMap.minFilter = THREE.LinearFilter;
        bumpMap.magFilter = THREE.LinearFilter;
        // V に縞（太め）：repeat.v を抑えて一帯あたりの幅を出す
        map.repeat.set(5, 20);
        bumpMap.repeat.set(5, 20);
        map.colorSpace = THREE.SRGBColorSpace;
        bumpMap.colorSpace = THREE.NoColorSpace;
        const maxA = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
        map.anisotropy = maxA;
        bumpMap.anisotropy = maxA;

        return { map, bumpMap };
    }

    _ensureUv2(geometry) {
        const uv = geometry.attributes.uv;
        if (uv && !geometry.attributes.uv2) {
            geometry.setAttribute('uv2', uv.clone());
        }
    }

    /** sRGB ベースの相対輝度 0〜1（Three r160 の Color#getLuminance 非対応のため自前） */
    _srgbLuminance(hex) {
        const c = new THREE.Color(hex);
        return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    }

    /**
     * チューブ本体・床側終端リング・中間リング／ジョイント用。
     * 球殻の陶器っぽさとは別にマット絶縁被覆＋細かい汚れの質感。cableColor は白/黒などベース色。
     */
    _applyCableSleeveMaterial(material, cableColor = 0xffffff) {
        const tex = this._cableLabGrungeTextures;
        if (!tex) return;
        material.map = null;
        material.normalMap = tex.normalMap;
        material.normalScale = new THREE.Vector2(0.52, 0.4);
        material.roughnessMap = tex.roughnessMap;
        material.aoMap = tex.aoMap;
        material.aoMapIntensity = 0.36;
        const isDark = this._srgbLuminance(cableColor) < 0.22;
        material.color.set(cableColor);
        material.roughness = isDark ? 0.78 : 0.74;
        material.metalness = 0.02;
        material.clearcoat = 0;
        material.clearcoatRoughness = 0.55;
        material.envMapIntensity = isDark ? 0.26 : 0.17;
        material.sheen = isDark ? 0.22 : 0.36;
        material.sheenRoughness = 0.64;
        material.sheenColor.set(cableColor);
        material.specularIntensity = isDark ? 0.65 : 0.82;
        material.needsUpdate = true;
    }

    _initCableConcreteTexturesIfNeeded() {
        if (this._cableConcreteTextures) return;
        const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
        this._cableConcreteTextures = generateConcretePBRTextures(1024, maxAniso, { tileOverlay: false });
        ['map', 'normalMap', 'roughnessMap', 'aoMap'].forEach((key) => {
            const t = this._cableConcreteTextures[key];
            if (t) {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
            }
        });
    }

    /**
     * Scene21 床と同じプロシージャル PBR をケーブルに載せる（map / normal / roughness / ao）
     */
    _applyCableConcreteToMaterial(material, glowing) {
        const tex = this._cableConcreteTextures;
        if (!tex) return;
        material.map = tex.map;
        material.normalMap = tex.normalMap;
        material.normalScale = new THREE.Vector2(0.38, 0.38);
        material.roughnessMap = tex.roughnessMap;
        material.roughness = glowing ? 0.88 : 0.93;
        material.metalness = glowing ? 0.78 : 0.0;
        material.aoMap = tex.aoMap;
        material.aoMapIntensity = glowing ? 0.46 : 0.78;
        material.bumpMap = null;
        material.envMap = this.scene.environment;
        material.envMapIntensity = glowing ? 2.0 : 0.0;
        // 非発光は emissive が乗るとテクスの汚れが全部飛ぶので必ずオフ
        if (!glowing) {
            material.emissive.setHex(0x000000);
            material.emissiveIntensity = 0;
        }
    }

    _stripCableConcreteTextureRefs() {
        const t = this._cableConcreteTextures;
        if (!t) return;
        const strip = (m) => {
            if (!m) return;
            if (m.map === t.map) m.map = null;
            if (m.normalMap === t.normalMap) m.normalMap = null;
            if (m.roughnessMap === t.roughnessMap) m.roughnessMap = null;
            if (m.aoMap === t.aoMap) m.aoMap = null;
        };
        this.cables.forEach((c) => strip(c.mesh.material));
        if (this.detailGroup) {
            this.detailGroup.traverse((o) => {
                if (o.isMesh) strip(o.material);
            });
        }
    }

    /** 球体表面のランダムギズモ群は省略（ケーブル根本・入口ランプ等のみ detailGroup に載せる） */
    createSphereDetails() {
        this.clusterPositions = [];
    }

    /**
     * ケーブル中間のリング／ジョイント（床・壁の終端リングとは別）
     */
    createCableRings(curve, cableRadius, sleeveColor = 0xffffff) {
        const mat = this.sharedWhiteShellMaterial.clone();
        this._applyCableSleeveMaterial(mat, sleeveColor);
        const ringCount = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < ringCount; i++) {
            const t = 0.1 + Math.random() * 0.8;
            const pos = curve.getPointAt(t);
            const tangent = curve.getTangentAt(t);

            const ringGeo = new THREE.TorusGeometry(cableRadius * 1.2, cableRadius * 0.2, 24, 48);
            this._ensureUv2(ringGeo);
            const ring = new THREE.Mesh(ringGeo, mat);
            ring.position.copy(pos);
            ring.lookAt(pos.clone().add(tangent));
            ring.castShadow = true;
            ring.receiveShadow = true;
            this.detailGroup.add(ring);
        }

        if (Math.random() > 0.7) {
            const t = 0.3 + Math.random() * 0.4;
            const pos = curve.getPointAt(t);
            const tangent = curve.getTangentAt(t);

            const jointGroup = new THREE.Group();
            jointGroup.position.copy(pos);
            jointGroup.lookAt(pos.clone().add(tangent));
            this.detailGroup.add(jointGroup);

            const jointMat = this.sharedWhiteShellMaterial.clone();
            this._applyCableSleeveMaterial(jointMat, sleeveColor);
            const jointGeo = new THREE.CylinderGeometry(cableRadius * 1.8, cableRadius * 1.8, cableRadius * 4, 48, 4);
            this._ensureUv2(jointGeo);
            const joint = new THREE.Mesh(jointGeo, jointMat);
            joint.rotateX(Math.PI / 2);
            joint.castShadow = true;
            joint.receiveShadow = true;
            jointGroup.add(joint);

            const boltRingGeo = new THREE.TorusGeometry(cableRadius * 2.0, cableRadius * 0.3, 20, 32);
            this._ensureUv2(boltRingGeo);
            const boltRing1 = new THREE.Mesh(boltRingGeo, jointMat);
            boltRing1.position.z = cableRadius * 1.5;
            boltRing1.castShadow = true;
            boltRing1.receiveShadow = true;
            jointGroup.add(boltRing1);

            const boltRing2 = new THREE.Mesh(boltRingGeo, jointMat);
            boltRing2.position.z = -cableRadius * 1.5;
            boltRing2.castShadow = true;
            boltRing2.receiveShadow = true;
            jointGroup.add(boltRing2);
        }
    }

    createCables() {
        this.scene.add(this.cableGroup);
        const floorY = -498;

        let generatedCount = 0;
        let attempts = 0;
        const maxAttempts = 15000; // 衝突判定を入れるので試行回数をさらに増やす

        // ケーブルの根本位置と半径を記録して、衝突判定に使うやで！
        const cableRootPositions = [];

        // --- 束感（Bundle）のロジック ---
        const bundleCount = 25; // 束の数を固定して安定させる
        
        while (generatedCount < this.cableCount && attempts < maxAttempts) {
            attempts++;
            
            // 束の基点となる方向を決定
            const bundlePhi = Math.acos(2 * Math.random() - 1);
            const bundleTheta = Math.random() * Math.PI * 2;
            
            // 束の中のケーブル本数（2〜5本）
            const cablesInBundle = 2 + Math.floor(Math.random() * 4);
            
            // 束ごとの終端の偏り（ノイズ）
            const bundleEndOffsetX = (Math.random() - 0.5) * 2000;
            const bundleEndOffsetZ = (Math.random() - 0.5) * 2000;

            for (let c = 0; c < cablesInBundle && generatedCount < this.cableCount; c++) {
                // 束の中でさらに密集させるやで！
                const spread = 0.08; // 生え際をタイトに！
                const phi = bundlePhi + (Math.random() - 0.5) * spread;
                const theta = bundleTheta + (Math.random() - 0.5) * spread;
                
                const normal = new THREE.Vector3(
                    Math.sin(phi) * Math.cos(theta),
                    Math.cos(phi),
                    Math.sin(phi) * Math.sin(theta)
                ).normalize();

                const startPos = normal.clone().multiplyScalar(this.coreRadius);
                startPos.y += this.coreCenterY;

                // 1. 入口ユニットとの距離チェック
                if (this.entrancePos && startPos.distanceTo(this.entrancePos) < 600) continue;

                // 2. 属性決定（太さを先に決める）— 白/黒ランダム、発光/非発光は別乱数
                const colorRand = Math.random();
                const isNonGlowing = colorRand < 0.45;
                const finalCableColor = Math.random() < 0.5 ? 0xffffff : 0x0c0c0e;

                let radius;
                const isSuperThick = Math.random() < 0.025;
                if (isSuperThick) {
                    radius = 150 + Math.random() * 50; 
                } else if (isNonGlowing) {
                    radius = 40 + Math.random() * 60; 
                } else {
                    const radiusRand = Math.random();
                    if (radiusRand < 0.5) radius = 15 + Math.random() * 15;
                    else if (radiusRand < 0.9) radius = 35 + Math.random() * 30;
                    else radius = 80 + Math.random() * 40;
                }

                // 3. ケーブル同士の衝突判定（ここが追加ポイント！）
                let isOverlapping = false;
                for (const other of cableRootPositions) {
                    // 半径の合計の80%（少しのめり込みを許容して密度を出す）を最小距離にするやで！
                    const minDist = (radius + other.radius) * 0.8; 
                    if (startPos.distanceTo(other.pos) < minDist) {
                        isOverlapping = true;
                        break;
                    }
                }
                if (isOverlapping) continue;

                // 生成成功！
                generatedCount++;
                cableRootPositions.push({ pos: startPos.clone(), radius: radius });

                // --- 接続ユニット：小さめのリングを数枚重ねただけ（ローカル +Z がケーブル方向） ---
                const unitGroup = new THREE.Group();
                unitGroup.position.copy(startPos);
                unitGroup.lookAt(startPos.clone().add(normal));
                this.detailGroup.add(unitGroup);

                const unitMat = this.sharedWhiteShellMaterial.clone();
                unitMat.map = null;
                unitMat.aoMap = null;
                unitMat.color.set(finalCableColor);
                unitMat.envMapIntensity = this._srgbLuminance(finalCableColor) < 0.22 ? 0.38 : 0.52;

                const r = radius;
                const tube = Math.max(2.8, Math.min(r * 0.09, 9));
                const majorMax = Math.min(Math.max(r + tube * 2.2, r * 1.28), r + 48);
                const ringZs = [0, 5, 10, 15];
                const majors = [majorMax, majorMax * 0.93, majorMax * 0.87, majorMax * 0.81];
                for (let ri = 0; ri < ringZs.length; ri++) {
                    const torusGeo = new THREE.TorusGeometry(majors[ri], tube * (0.96 - ri * 0.05), 20, 48);
                    this._ensureUv2(torusGeo);
                    const ring = new THREE.Mesh(torusGeo, unitMat);
                    ring.position.z = ringZs[ri];
                    unitGroup.add(ring);
                }

                const ferruleH = Math.max(7, Math.min(r * 0.4, 20));
                const ferruleGeo = new THREE.CylinderGeometry(
                    r * 0.92,
                    r * 0.82,
                    ferruleH,
                    48,
                    3,
                    false
                );
                this._ensureUv2(ferruleGeo);
                const ferrule = new THREE.Mesh(ferruleGeo, unitMat);
                ferrule.rotation.x = Math.PI / 2;
                const zLast = ringZs[ringZs.length - 1];
                ferrule.position.z = zLast + tube * 2.1 + ferruleH * 0.5;
                unitGroup.add(ferrule);

                const points = [];
                points.push(startPos.clone());
                
                const isUpper = startPos.y > this.coreCenterY;
                const pushDist = (isUpper ? 300 : 150) + (radius * 2.0) + (Math.random() * 50); 
                const point1 = startPos.clone().add(normal.clone().multiplyScalar(pushDist));
                points.push(point1);

                // --- 終端の計算（目的地への集中度をアップ！） ---
                let groundDist = isUpper ? (3500 + Math.random() * 3000) : (2000 + Math.random() * 2500);
                const groundAngle = Math.atan2(normal.z, normal.x) + (Math.random() - 0.5) * 0.2; 
                
                // 束のオフセットをノイズ的に加える（ばらつきを抑えて目的地を集中させる）
                let groundX = Math.cos(groundAngle) * groundDist + bundleEndOffsetX * (0.9 + Math.random() * 0.2);
                let groundZ = Math.sin(groundAngle) * groundDist + bundleEndOffsetZ * (0.9 + Math.random() * 0.2);

                const roomLimit = 4500;
                if (Math.abs(groundX) > roomLimit || Math.abs(groundZ) > roomLimit) {
                    const scale = roomLimit / Math.max(Math.abs(groundX), Math.abs(groundZ));
                    groundX *= scale;
                    groundZ *= scale;
                }
                
                if (isUpper) {
                    const bulgeScale = 1.5 + (radius < 40 ? 0.3 : (radius / 250)); // 1.6 -> 1.5 (少しだけ絞る)
                    const midY = Math.max(point1.y * 0.5, this.coreCenterY + 100); // 0.6 -> 0.5, +400 -> +100 (マイルドに下げる)
                    
                    // 球体の中心から外側へ向かうベクトルを計算して、中間地点を球体の外側に押し出す
                    const midPos = new THREE.Vector3(
                        point1.x * bulgeScale,
                        midY,
                        point1.z * bulgeScale
                    );
                    
                    // 球体中心（0, coreCenterY, 0）からの距離をチェック
                    const coreCenter = new THREE.Vector3(0, this.coreCenterY, 0);
                    const distToCenter = midPos.distanceTo(coreCenter);
                    const safeRadius = this.coreRadius + 250; // 300 -> 250 (少し球体に寄せる)
                    
                    if (distToCenter < safeRadius) {
                        const pushDir = midPos.clone().sub(coreCenter).normalize();
                        midPos.copy(coreCenter.clone().add(pushDir.multiplyScalar(safeRadius)));
                    }
                    
                    points.push(midPos);
                } else {
                    const midDistScale = 1.6 + (radius < 40 ? 0.4 : 0.0); // 1.8 -> 1.6
                    const midPos = new THREE.Vector3(
                        point1.x * midDistScale,
                        floorY + 300, // 400 -> 300 (少し床に近づける)
                        point1.z * midDistScale
                    );
                    
                    // 下側も同様に球体を避ける
                    const coreCenter = new THREE.Vector3(0, this.coreCenterY, 0);
                    const distToCenter = midPos.distanceTo(coreCenter);
                    const safeRadius = this.coreRadius + 180; // 200 -> 180
                    
                    if (distToCenter < safeRadius) {
                        const pushDir = midPos.clone().sub(coreCenter).normalize();
                        midPos.copy(coreCenter.clone().add(pushDir.multiplyScalar(safeRadius)));
                    }
                    
                    points.push(midPos);
                }

                const endPos = new THREE.Vector3(groundX, floorY, groundZ);
                
                // --- 床付近で「やや平行かも」ぐらいに曲げる ---
                const approachDist = 0.8; // 終点までの80%の位置
                const preEndX = groundX * approachDist;
                const preEndZ = groundZ * approachDist;
                // 床から少しだけ浮かせた位置（radius + 100 くらい）を通らせる
                const preEndPos = new THREE.Vector3(preEndX, floorY + 100 + (radius * 0.5), preEndZ);
                points.push(preEndPos);

                points.push(endPos);

                const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.2); 
                
                // --- バグ修正：TubeGeometryの生成に失敗する場合の安全策 ---
                let geometry;
                try {
                    const segments = radius > 60 ? 180 : 96;
                    geometry = new THREE.TubeGeometry(curve, segments, radius, 20, false); 
                } catch (e) {
                    continue; // このケーブルの生成をスキップ
                }
                
                const material = this.sharedWhiteShellMaterial.clone();
                this._applyCableSleeveMaterial(material, finalCableColor);
                if (isNonGlowing) {
                    material.emissive.setHex(0x000000);
                    material.emissiveIntensity = 0;
                }
                this._ensureUv2(geometry);

                if (!isNonGlowing) {
                    material.onBeforeCompile = (shader) => {
                        shader.uniforms.uPulses = { value: new Float32Array(10).fill(-1.0) };
                        shader.uniforms.uPulseColor = { value: this.pulseColor };
                        
                        shader.vertexShader = `
                            varying vec2 vUv;
                            ${shader.vertexShader}
                        `.replace(
                            `#include <begin_vertex>`,
                            `#include <begin_vertex>
                            vUv = uv;`
                        );

                        shader.fragmentShader = `
                            uniform float uPulses[10];
                            uniform vec3 uPulseColor;
                            varying vec2 vUv;
                            ${shader.fragmentShader}
                        `.replace(
                            `#include <dithering_fragment>`,
                            `
                            #include <dithering_fragment>
                            float pulseEffect = 0.0;
                            for(int i = 0; i < 10; i++) {
                                if(uPulses[i] >= 0.0) {
                                    float dist = abs(vUv.x - uPulses[i]);
                                    pulseEffect += smoothstep(0.03, 0.0, dist);
                                }
                            }
                            vec3 pCol = uPulseColor;
                            float constantGlow = smoothstep(0.15, 0.0, vUv.x) * 0.3;
                            gl_FragColor.rgb += pCol * (pulseEffect * 12.0 + constantGlow); 
                            `
                        );
                        material.userData.shader = shader;
                    };
                }

                const mesh = new THREE.Mesh(geometry, material);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.cableGroup.add(mesh);
                this.cables.push({ mesh, material, isGlowing: !isNonGlowing });

                const endRingMat = this.sharedWhiteShellMaterial.clone();
                this._applyCableSleeveMaterial(endRingMat, finalCableColor);
                const endRingGeo = new THREE.TorusGeometry(radius * 1.3, radius * 0.3, 20, 40);
                this._ensureUv2(endRingGeo);
                const endRing = new THREE.Mesh(endRingGeo, endRingMat);
                endRing.position.copy(endPos);
                endRing.rotateX(Math.PI / 2);
                endRing.castShadow = true;
                endRing.receiveShadow = true;
                this.detailGroup.add(endRing);

                if (Math.random() > 0.4) {
                    this.createCableRings(curve, radius, finalCableColor);
                }
            }
        }
    }

    createEntranceUnit() {
        // 球体の正面（Z軸方向）に入口っぽいパーツを配置するやで！
        const entranceGroup = new THREE.Group();
        const radius = this.coreRadius + 5; 
        
        // --- 位置の調整（真ん中よりちょい上！） ---
        const yOffset = 500; 
        const zPos = Math.sqrt(radius * radius - yOffset * yOffset);
        const finalPos = new THREE.Vector3(0, this.coreCenterY + yOffset, zPos);
        
        entranceGroup.position.copy(finalPos);
        const lookTarget = finalPos.clone().add(new THREE.Vector3(0, yOffset, zPos).normalize());
        entranceGroup.lookAt(lookTarget);
        this.scene.add(entranceGroup);

        // 1. ベースプレート（ノーマル＋ラフで角・スクラッチを汚す）
        const plateGeo = new THREE.BoxGeometry(450, 180, 15);
        plateGeo.computeTangents();
        this._entrancePlateTextures = this._generateEntrancePlateWearTextures(512);
        const plateMat = this._createCeramicHullMaterial({
            color: new THREE.Color(this.charcoalHex),
            envMapIntensity: 0.58,
            normalMap: this._entrancePlateTextures.normalMap,
            normalScale: new THREE.Vector2(0.85, 0.85),
            roughnessMap: this._entrancePlateTextures.roughnessMap,
            roughness: 1
        });
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.set(0, 20, 0); // 少し上にずらしてランプとテキストを乗せる
        plate.castShadow = true;
        plate.receiveShadow = true;
        entranceGroup.add(plate);

        // 2. 表示ランプ（球体まわりはケーブル以外すべて白で統一）
        const lampGeo = new THREE.SphereGeometry(10, 16, 16);
        const lampEm = new THREE.Color(0x25262c);
        const lampMat = this._createCeramicHullMaterial({
            color: new THREE.Color(this.charcoalHex),
            roughness: 0.22,
            clearcoat: 0.52,
            envMapIntensity: 0.66,
            emissive: lampEm,
            emissiveIntensity: 0.16
        });
        
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(0, 60, 10); // プレートの上に乗せる
        entranceGroup.add(lamp);

        // 3. 「MAVRX4」テキストラベル
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // 背景なし（透明）
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // テキスト描画（黒）
        ctx.fillStyle = '#0a0a0a';
        ctx.font = 'bold 60px Arial'; // 90px -> 60px (小さくしたで！)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('MAVRX4', canvas.width / 2, canvas.height / 2);
        
        const textTex = new THREE.CanvasTexture(canvas);
        const textMat = new THREE.MeshBasicMaterial({ map: textTex, transparent: true, side: THREE.DoubleSide });
        const textGeo = new THREE.PlaneGeometry(280, 70); // 400x100 -> 280x70 (小さくしたで！)
        const textMesh = new THREE.Mesh(textGeo, textMat);
        textMesh.position.set(0, -10, 11); // 10 -> 11 (チラつき防止)
        entranceGroup.add(textMesh);

        // 入口ユニットの位置を記録して、ケーブルが被らんようにするで！
        this.entrancePos = finalPos.clone();
        this.entranceUnit = entranceGroup;
    }

    /**
     * 部屋の四隅から球体へ伸びる直線的な安定パイプを生成するやで！
     */
    createStabilizerPipes() {
        const pipeGroup = new THREE.Group();
        this.stabilizerPipes = pipeGroup; // 管理用に追加
        this.scene.add(pipeGroup);

        this._stabilizerSteelTextures = this.generateRepaintedYellowSteelTextures(1024);
        const mkSteelMat = () =>
            new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: this._stabilizerSteelTextures.map,
                bumpMap: this._stabilizerSteelTextures.bumpMap,
                bumpScale: 6,
                metalness: 0.05,
                roughness: 0.92,
                envMap: this.scene.environment,
                envMapIntensity: 0.14
            });

        const roomLimit = 4800; // 壁の位置
        const corners = [
            { x: roomLimit, z: roomLimit },
            { x: -roomLimit, z: roomLimit },
            { x: roomLimit, z: -roomLimit },
            { x: -roomLimit, z: -roomLimit }
        ];
        
        const heights = [4500, -4500]; 
        const beamSize = 80; // 鉄骨の太さ
        const coreCenter = new THREE.Vector3(0, this.coreCenterY, 0);

        corners.forEach(corner => {
            heights.forEach(y => {
                const startPos = new THREE.Vector3(corner.x, y, corner.z);
                const toCore = coreCenter.clone().sub(startPos);
                const distToCenter = toCore.length();
                const dir = toCore.normalize();
                const distToSurface = distToCenter - this.coreRadius;
                const endPos = startPos.clone().add(dir.clone().multiplyScalar(distToSurface));

                // --- 鉄骨（H鋼）ユニットの生成 ---
                const beamGroup = new THREE.Group();
                const midPoint = startPos.clone().add(endPos).multiplyScalar(0.5);
                beamGroup.position.copy(midPoint);
                beamGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                pipeGroup.add(beamGroup);

                // H鋼のメインプレート（中央）
                const steelMat = mkSteelMat();
                const webGeo = new THREE.BoxGeometry(beamSize * 0.1, distToSurface, beamSize * 0.8);
                const web = new THREE.Mesh(webGeo, steelMat);
                beamGroup.add(web);

                // H鋼のフランジ（両端）
                const flangeGeo = new THREE.BoxGeometry(beamSize, distToSurface, beamSize * 0.1);
                const flange1 = new THREE.Mesh(flangeGeo, steelMat);
                flange1.position.z = beamSize * 0.4;
                beamGroup.add(flange1);

                const flange2 = new THREE.Mesh(flangeGeo, steelMat);
                flange2.position.z = -beamSize * 0.4;
                beamGroup.add(flange2);

                // 補強用のトラス（斜めの梁）をいくつか追加
                const trussCount = 4;
                const trussGeo = new THREE.BoxGeometry(beamSize * 0.05, beamSize * 1.2, beamSize * 0.05);
                for (let i = 0; i < trussCount; i++) {
                    const t = (i / (trussCount - 1) - 0.5) * distToSurface * 0.8;
                    const truss = new THREE.Mesh(trussGeo, steelMat);
                    truss.position.y = t;
                    truss.rotation.z = Math.PI / 4 * (i % 2 === 0 ? 1 : -1);
                    beamGroup.add(truss);
                }

                // 壁側の設置パーツ
                this.createPipeConnector(startPos, dir, beamSize * 0.5, steelMat, pipeGroup);

                // 球体側の設置パーツ
                this.createPipeConnector(endPos, dir.clone().negate(), beamSize * 0.5, steelMat, pipeGroup);
            });
        });
    }

    /**
     * パイプの端点の設置パーツを生成するやで！
     */
    createPipeConnector(pos, dir, pipeRadius, material, group) {
        const connectorGroup = new THREE.Group();
        connectorGroup.position.copy(pos);
        connectorGroup.lookAt(pos.clone().add(dir));
        group.add(connectorGroup);

        // ベースフランジ（大型化！ pipeRadius * 3 -> * 5）
        const baseGeo = new THREE.CylinderGeometry(pipeRadius * 5, pipeRadius * 5.5, 40, 40, 4);
        const base = new THREE.Mesh(baseGeo, material);
        base.rotateX(Math.PI / 2);
        connectorGroup.add(base);

        // 補強リング（大型化！）
        const ringGeo = new THREE.TorusGeometry(pipeRadius * 3.5, pipeRadius * 0.8, 24, 48);
        const ring = new THREE.Mesh(ringGeo, material);
        connectorGroup.add(ring);

        // 固定ボルト（大型化！）
        const boltGeo = new THREE.CylinderGeometry(15, 15, 60, 20);
        for (let i = 0; i < 8; i++) { // 6 -> 8本に増量！
            const angle = (i / 8) * Math.PI * 2;
            const bolt = new THREE.Mesh(boltGeo, material);
            bolt.position.set(Math.cos(angle) * pipeRadius * 4.5, Math.sin(angle) * pipeRadius * 4.5, 0);
            bolt.rotateX(Math.PI / 2);
            connectorGroup.add(bolt);
        }
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;

        // カメラの更新を明示的に呼ぶ
        this.updateCamera();

        // カラーの補間（トラック8で変化）
        this.pulseColor.lerp(this.targetPulseColor, 0.1);

        // --- インナーグロウ（球体内部の発光）の更新 ---
        if (this.innerSphere && this.innerSphere.material) {
            this.innerSphere.material.emissiveIntensity *= 0.92;
            const eb = Math.min(1, this.lightIntensity * 2.5);
            this.innerSphere.material.emissive.lerpColors(this.innerVividEmissive, this.pulseColor, eb);
            this.innerSphere.material.needsUpdate = true;
        }
        if (this.coreGlow && this.coreGlow.material) {
            this.coreGlow.material.opacity *= 0.9;
            const cw = Math.min(1, this.lightIntensity * 2.5);
            this.coreGlow.material.color.lerpColors(this.coreGlowVividColor, this.pulseColor, cw * 0.55);
            this.coreGlow.material.needsUpdate = true;
        }

        // 球体の外殻・パーツの発光強度の補間（陶器=0.02, ブルーグレー=0.1）
        const sphereEmissiveTarget = this.useCeramicSphere ? 0.02 : 0.05;
        if (this.centralSphere) {
            this.centralSphere.traverse(child => {
                if (child === this.innerSphere || child === this.coreGlow) return;
                if (child.material?.userData?.sphereCeramicShell) return;
                if (child.isMesh && child.material && child.material.emissive) {
                    const current = child.material.emissiveIntensity;
                    child.material.emissiveIntensity = current + (sphereEmissiveTarget - current) * 0.1;
                    child.material.needsUpdate = true;
                }
            });
        }

        // ライト強度の補間（パルス連動）
        this.lightIntensity += (this.targetLightIntensity - this.lightIntensity) * 0.15;
        if (this.spotLight) {
            this.spotLight.intensity = this.spotBaseIntensity + this.lightIntensity;
            const w = Math.min(1, this.lightIntensity * 2.5);
            this.spotLight.color.lerpColors(new THREE.Color(0xffffff), this.pulseColor, w);
        }
        // ライトもすぐに暗く戻ろうとする
        this.targetLightIntensity += (0.0 - this.targetLightIntensity) * 0.1;

        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const p = this.pulses[i];
            p.progress += deltaTime * p.speed;
            if (p.progress > 1.2) {
                this.pulses.splice(i, 1);
            }
        }

        this.cables.forEach(cable => {
            if (cable.material.userData.shader) {
                const shader = cable.material.userData.shader;
                const pulseArray = new Float32Array(10).fill(-1.0);
                this.pulses.forEach((p, idx) => {
                    if (idx < 10) pulseArray[idx] = p.progress;
                });
                shader.uniforms.uPulses.value = pulseArray;
                shader.uniforms.uPulseColor.value = this.pulseColor; // 補間後の色を渡す！
            }
        });

        const aoPass = this.ssaoPass;
        if (aoPass) {
            const focusPos = new THREE.Vector3(0, this.coreCenterY, 0);
            const camDist = this.camera.position.distanceTo(focusPos);
            const nearD = 900;
            const farD = 6200;
            const t = THREE.MathUtils.clamp((camDist - nearD) / (farD - nearD), 0, 1);
            const aoScale = THREE.MathUtils.lerp(1.0, this.ssaoFarAttenuation, t);
            if ('kernelRadius' in aoPass) aoPass.kernelRadius = this.ssaoNearKernelRadius * aoScale;
            if ('minDistance' in aoPass) aoPass.minDistance = this.ssaoNearMinDistance * aoScale;
            if ('maxDistance' in aoPass) aoPass.maxDistance = this.ssaoNearMaxDistance * aoScale;
            this._syncAODepthAndCameraUniforms(aoPass);
        }

        this._updateAmbientParticles(deltaTime);
        this._updatePinkSpillSpheres(deltaTime);

        if (this.fogNoisePass) {
            this.fogNoisePass.uniforms.time.value = this.time;
        }

        // DOF は Scene21 同様に固定 focus（球体表面追従はミニチュアCG感が強すぎるためオフ）

        // --- 2Dコールアウトの更新（共通システムを使用） ---
        if (this.calloutSystem) {
            this.calloutSystem.update(deltaTime, this.time, this.camera, {
                autoGenerate: false, // トラック5で手動生成するため自動生成はオフ
                maxCount: 15,
                margin: 200
            });
        }
    }

    triggerPulse(velocity = 127) {
        const speed = 0.3 + (velocity / 127.0) * 1.0;
        this.pulses.push({
            progress: 0.0,
            speed: speed
        });

        // --- インナーグロウを極限まで弱める（継ぎ目から漏れる程度！） ---
        const intensity = (velocity / 127.0) * 1.5; // 3.0 -> 1.5 (さらに半分)
        if (this.innerSphere && this.innerSphere.material) {
            this.innerSphere.material.emissiveIntensity = intensity;
            this.innerSphere.material.needsUpdate = true;
        }
        if (this.coreGlow && this.coreGlow.material) {
            this.coreGlow.material.opacity = Math.min(intensity * 0.1, 0.15); // 0.3 -> 0.15
            this.coreGlow.material.needsUpdate = true;
        }

        // 外殻やパーツの発光連動は完全に削除（不自然な光りを防ぐ）
        const sphereEmissiveTarget = this.useCeramicSphere ? 0.02 : 0.05;
        if (this.centralSphere) {
            this.centralSphere.traverse(child => {
                if (child === this.innerSphere || child === this.coreGlow) return;
                if (child.material?.userData?.sphereCeramicShell) return;
                if (child.isMesh && child.material && child.material.emissive) {
                    child.material.emissiveIntensity = sphereEmissiveTarget;
                    child.material.needsUpdate = true;
                }
            });
        }

        // スポットにパルスを乗せる（ベース＋フラッシュ）
        const flashIntensity = (velocity / 127.0) * 1.5;
        this.targetLightIntensity = flashIntensity;
        if (this.spotLight) {
            this.spotLight.intensity = this.spotBaseIntensity + flashIntensity;
            this.spotLight.color.copy(this.pulseColor);
        }
    }

    _createComposerRenderTargets() {
        const pr = this.renderer.getPixelRatio();
        const w = Math.max(1, Math.floor(window.innerWidth * pr));
        const h = Math.max(1, Math.floor(window.innerHeight * pr));
        const mk = () => {
            const rt = new THREE.WebGLRenderTarget(w, h, {
                type: THREE.HalfFloatType,
                depthBuffer: true
            });
            rt.depthTexture = new THREE.DepthTexture(w, h);
            return rt;
        };
        if (this._composerRTPrimary) this._composerRTPrimary.dispose();
        if (this._composerRTSecondary) this._composerRTSecondary.dispose();
        this._composerRTPrimary = mk();
        this._composerRTSecondary = mk();
    }

    initPostProcessing() {
        if (!this.composer) {
            this._createComposerRenderTargets();
            this.composer = new EffectComposer(this.renderer, this._composerRTPrimary);
            this.composer.renderTarget2.dispose();
            this.composer.renderTarget2 = this._composerRTSecondary;
            this.composer.writeBuffer = this.composer.renderTarget1;
            this.composer.readBuffer = this.composer.renderTarget2;

            this.composer.addPass(new RenderPass(this.scene, this.camera));

            this.fogNoisePass = new FogNoisePass(this.camera);
            const fc = this._fogNoiseConfig;
            if (fc) {
                this.fogNoisePass.uniforms.fogColor.value = fc.color;
                this.fogNoisePass.uniforms.fogDensity.value = fc.density;
                this.fogNoisePass.uniforms.noiseAmp.value = fc.noiseAmp;
                this.fogNoisePass.uniforms.noiseScale.value = fc.noiseScale;
                this.fogNoisePass.uniforms.timeScale.value = fc.timeScale;
            }
            this.composer.addPass(this.fogNoisePass);
        }
        if (this.useSSAO && !this.ssaoPass) {
            this.ssaoPass = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
            this.ssaoPass.kernelRadius = this.ssaoNearKernelRadius;
            this.ssaoPass.minDistance = this.ssaoNearMinDistance;
            this.ssaoPass.maxDistance = this.ssaoNearMaxDistance;
            this.composer.addPass(this.ssaoPass);
            this._syncAODepthAndCameraUniforms(this.ssaoPass);
        }
        if (this.useBloom && !this.bloomPass) {
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(Math.max(64, window.innerWidth / 6), Math.max(64, window.innerHeight / 6)),
                0.038,
                0.72,
                0.78
            );
            this.composer.addPass(this.bloomPass);
        }
        if (this.useDOF) {
            // Scene21 と同値（固定ピント。被写界深度は弱めの実写寄りに）
            attachDepthOfField(this, {
                focus: 2100,
                aperture: 0.0000044,
                maxblur: 0.0031
            });
        }
        attachPresentationOutputPass(this);
        attachFilmGrainPass(this, 0.22, false);
    }

    /**
     * FogNoisePass が composer の深度（HalfFloat 系）を読むため、
     * renderTarget の depthTexture を SSAO 用に差し替えない（霧が死ぬのを防ぐ）。
     */
    _syncAODepthAndCameraUniforms(aoPass) {
        if (!aoPass) return;

        const candidateDepth =
            aoPass.beautyRenderTarget?.depthTexture ||
            aoPass.normalRenderTarget?.depthTexture ||
            aoPass.depthRenderTarget?.depthTexture ||
            this.composer?.renderTarget1?.depthTexture ||
            this.composer?.renderTarget2?.depthTexture ||
            null;

        const maybeMaterials = [
            aoPass.ssaoMaterial,
            aoPass.saoMaterial,
            aoPass.materialAO,
            aoPass.vBlurMaterial,
            aoPass.hBlurMaterial
        ];

        for (const m of maybeMaterials) {
            const u = m?.uniforms;
            if (!u) continue;
            if (u.cameraNear) u.cameraNear.value = this.camera.near;
            if (u.cameraFar) u.cameraFar.value = this.camera.far;
            if (u.tDepth && candidateDepth) u.tDepth.value = candidateDepth;
        }
    }

    handleTrackNumber(trackNumber, message) {
        if (trackNumber === 2) {
            const args = message.args || [];
            const durationMs = (args.length >= 3) ? args[2] : 500;
            this.strobeActive = true; 
            this.strobeEndTime = Date.now() + durationMs;
        }
        
        // --- トラック5：コールアウト専用 ---
        if (trackNumber === 5) {
            const args = message.args || [];
            const velocity = args[1] !== undefined ? args[1] : 127;
            const durationMs = args[2] !== undefined ? args[2] : 2000; // デュレーションを取得（デフォルト2秒）
            
            if (this.calloutSystem) {
                const phi = Math.random() * Math.PI * 2;
                const theta = Math.random() * Math.PI;
                const worldPos = new THREE.Vector3(
                    this.coreRadius * Math.sin(theta) * Math.cos(phi),
                    this.coreRadius * Math.cos(theta) + this.coreCenterY,
                    this.coreRadius * Math.sin(theta) * Math.sin(phi)
                );

                // ミリ秒を秒に変換して渡す（最低でも1.2秒は保証して、アニメーションを完結させる！）
                const durationSec = Math.max(1.2, durationMs / 1000.0);
                this.calloutSystem.createCallout({
                    worldPos: worldPos,
                    time: this.time,
                    duration: durationSec
                });
            }
        }

        // --- トラック6：球体発光・ケーブルパルス専用 ---
        if (trackNumber === 6) {
            const args = message.args || [];
            const velocity = args[1] !== undefined ? args[1] : 127;
            this.triggerPulse(velocity);
        }

        // トラック8で色を変化させるやで！
        if (trackNumber === 8) {
            const args = message.args || [];
            const velocity = args[1] !== undefined ? args[1] : 0;
            
            // トラック8が鳴る（velocity > 0）度に色を切り替えるやで！
            if (velocity > 0) {
                this.colorIndex = (this.colorIndex + 1) % this.colors.length;
                this.targetPulseColor.copy(this.colors[this.colorIndex]);
            }
        }
    }

    render() {
        if (this.strobeActive) {
            const isWhite = Math.floor(performance.now() / 32) % 2 === 0;
            this.renderer.setClearColor(isWhite ? 0xffffff : 0x000000);
        } else {
            this.renderer.setClearColor(0x010102);
        }
        super.render();
    }

    dispose() {
        this.initialized = false;
        this.scene.fog = null;

        if (this.fogNoisePass) {
            if (this.composer) {
                const fi = this.composer.passes.indexOf(this.fogNoisePass);
                if (fi !== -1) this.composer.passes.splice(fi, 1);
            }
            this.fogNoisePass.dispose();
            this.fogNoisePass = null;
        }
        this._composerRTPrimary = null;
        this._composerRTSecondary = null;

        if (this.ssaoPass) {
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.ssaoPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            this.ssaoPass.enabled = false;
            this.ssaoPass = null;
        }
        disposePresentationOutputPass(this);

        if (this.ambientInstManager) {
            this.ambientInstManager.dispose();
            this.ambientInstManager = null;
        }
        this.ambientParticles = [];

        this._stripCableConcreteTextureRefs();

        if (this.studio) this.studio.dispose();
        if (this._roomEnvTexture) {
            this._roomEnvTexture.dispose();
            this._roomEnvTexture = null;
        }
        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }
        this.scene.environment = null;
        if (this.centralSphere) {
            this.scene.remove(this.centralSphere);
            const disposedMats = new Set();
            this.centralSphere.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    mats.forEach((m) => {
                        if (!disposedMats.has(m)) {
                            disposedMats.add(m);
                            m.dispose();
                        }
                    });
                }
            });
            this._sphereLabGrungeTextures = null;
        }
        // detailGroup の子を確実に削除・破棄（シーン復帰時に古いリングが浮くのを防ぐ）
        if (this.detailGroup) {
            while (this.detailGroup.children.length > 0) {
                const child = this.detailGroup.children[0];
                this.detailGroup.remove(child);
                child.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                });
            }
            this.scene.remove(this.detailGroup);
        }
        this.cables.forEach(c => {
            this.cableGroup.remove(c.mesh);
            c.mesh.geometry.dispose();
            c.mesh.material.dispose();
        });
        this.cables = [];
        this.scene.remove(this.cableGroup);
        if (this._cableLabGrungeTextures) {
            const t = this._cableLabGrungeTextures;
            ['map', 'normalMap', 'roughnessMap', 'aoMap', 'bumpMap'].forEach((k) => {
                if (t[k] && t[k].dispose) t[k].dispose();
            });
            this._cableLabGrungeTextures = null;
        }
        if (this._cableConcreteTextures) {
            const t = this._cableConcreteTextures;
            t.map.dispose();
            t.normalMap.dispose();
            t.roughnessMap.dispose();
            t.aoMap.dispose();
            this._cableConcreteTextures = null;
        }
        if (this.entranceUnit) {
            this.scene.remove(this.entranceUnit);
            this.entranceUnit.children.forEach((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m) => {
                        ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'aoMap'].forEach((k) => {
                            if (m[k] && m[k].dispose) m[k].dispose();
                        });
                        m.dispose();
                    });
                }
            });
            this._entrancePlateTextures = null;
        }
        if (this.calloutSystem) {
            this.calloutSystem.setScene(null);
        }
        if (this.stabilizerPipes) {
            this.stabilizerPipes.traverse((o) => {
                if (o.material) {
                    if (o.material.map) o.material.map = null;
                    if (o.material.bumpMap) o.material.bumpMap = null;
                    o.material.dispose();
                }
                if (o.geometry) o.geometry.dispose();
            });
            this.scene.remove(this.stabilizerPipes);
            this.stabilizerPipes = null;
        }
        if (this._stabilizerSteelTextures) {
            this._stabilizerSteelTextures.map.dispose();
            this._stabilizerSteelTextures.bumpMap.dispose();
            this._stabilizerSteelTextures = null;
        }
        this._stabilizerSteelMaterial = null;
        if (this.spillInstManager) {
            this.spillInstManager.dispose();
            this.spillInstManager = null;
        }
        this._spillSphereGeo = null;
        this._spillBloomAttr = null;
        this.spillParticles = [];
        if (this.spotLight) {
            this.scene.remove(this.spotLight.target);
            this.scene.remove(this.spotLight);
            this.spotLight.dispose();
            this.spotLight = null;
        }
        super.dispose();
    }
}
