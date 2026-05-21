/**
 * Scene01: 新規シーン（テンプレートベース）
 */     

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import {
    StudioBox,
    attachDepthOfField,
    attachFilmGrainPass,
    attachPresentationOutputPass,
    disposePresentationOutputPass,
    applyStudioRoomToneAndBackdrop,
    setupStudioRoomEnvironmentMap,
    disposeStudioRoomEnvironmentMap,
    studioBoxOptionsForStudioRoom,
    ceilingSpotRigOptionsForStudioRoom,
    setupStudioRoomPromoWallFillLight,
    STUDIO_CEILING_Y
} from '../../lib/presentation/index.js';
import { Scene01Particle } from './Scene01Particle.js';

export class Scene01 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'Xenosphere';  // シーンのタイトルを設定
        this.initialized = false;
        this.sceneNumber = 1;
        this.kitNo = 29;
        
        // 共有リソースマネージャー
        this.sharedResourceManager = sharedResourceManager;
        this.useSharedResources = !!sharedResourceManager;
        
        // レイキャスター（オートフォーカス用）
        this.raycaster = new THREE.Raycaster();
        
        // Sphereの設定
        this.sphereCount = 300; // 100から300に戻す
        this.spawnRadius = 500; // 中心に寄せる
        
        // インスタンス管理
        this.instancedMeshManager = null;
        this.lineManager = null; // タコの足（赤い毛）
        this.particles = [];
        this.fluorescentLights = [];

        // 空間分割用
        this.gridSize = 150; // マス目を少し大きくして効率化
        this.grid = new Map();

        // 撮影用スタジオ
        this.studio = null;
        
        // エフェクト設定
        this.useDOF = true; // SceneBaseのフラグを使用
        this.useBloom = true; 
        this.useSSAO = false; // 重いのでオフ
        this.useWallCollision = true; // 壁判定オン
        this.useTacoFeet = true;      // 赤い足オン
        this.useFilmGrain = true;     // フィルムグレインON
        this.bloomPass = null;
        this.ssaoPass = null;
        /** Scene21/22 と同じ露出スケール（トーンマップ露出の lerp 係数） */
        this.sceneLightingScale = 0.32;
        this.outputPass = null;
        this.useSceneFog = true;
        this.sceneFogDensity = 0.00009;
        this.sceneFogColor = 0x151820;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this._roomEnvPresentation = null;
        this.promoWallLightTarget = null;
        this.promoWallFillLight = null;

        // トラック6用エフェクト管理
        this.expandSpheres = []; 
        
        // 重力設定
        this.useGravity = false;
        this.gravityForce = new THREE.Vector3(0, -0.8, 0);
        this.gravityTimer = 0;
        this.gravityInterval = 10.0; // 10秒周期

        // モード設定（自動ランダマイズ）
        this.currentMode = this.MODE_DEFAULT; // 最初は引力モードから開始
        this.modeTimer = 0;
        this.modeInterval = 10.0; 
        
        // モード定数（Scene01オリジナル：生物的・物理的アプローチ）
        this.MODE_DEFAULT    = 0; // 浮遊
        this.MODE_GRAVITY    = 1; // 重力
        this.MODE_SWARM      = 2; // 群れ（一つの巨大な塊）
        this.MODE_SNAKE      = 3; // 蛇行（数珠つなぎ）
        this.MODE_VORTEX     = 4; // 竜巻
        this.MODE_ATOM       = 5; // 原子軌道
        this.MODE_PULSE      = 6; // 鼓動
        this.MODE_GRID_3D    = 7; // 3D標本（整列）
        this.MODE_FIGHT      = 8; // 衝突（2群対立）
        this.MODE_RAIN       = 9; // 降り注ぐ雨

        // スクリーンショット用テキスト
        this.setScreenshotText(this.title);
    }

    handlePhase(phase) {
        super.handlePhase(phase);
        
        // phase 0 の時は強制的に引力モード（DEFAULT）にし、位置を原点にリセットする
        if (phase === 0) {
            this.currentMode = this.MODE_DEFAULT;
            this.modeTimer = 0; 
// 全パーティクルの位置を原点に強制移動
            this.particles.forEach(p => {
                p.position.set(0, 200, 0); // 少し浮かせて原点付近に
                p.velocity.set(0, 0, 0);   // 勢いもリセット
            });

            this.useGravity = false;
        }
    }
    
    /**
     * カメラパーティクルの距離パラメータを設定
     */
    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 400;
        cameraParticle.maxDistance = 3000;
        cameraParticle.minY = -450; // 地面より下に行かないように制限
    }
    
    /**
     * セットアップ処理
     */
    async setup() {
        if (this.initialized) return;
        await super.setup();
        
        if (this.camera) {
            this.camera.far = 20000;
            this.camera.updateProjectionMatrix();
        }

        this.useSSAO = false;

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        applyStudioRoomToneAndBackdrop(this.renderer, this.scene, this.sceneLightingScale, {
            useSceneFog: this.useSceneFog,
            sceneFogDensity: this.sceneFogDensity,
            sceneFogColor: this.sceneFogColor
        });
        this._roomEnvPresentation = setupStudioRoomEnvironmentMap(this.renderer, this.scene);
        this.pmremGenerator = this._roomEnvPresentation.pmremGenerator;
        this._roomEnvTexture = this._roomEnvPresentation.envMapTexture;

        this.showGridRuler3D = false; // デフォルトでオフ
        this.initGridRuler3D({
            center: { x: 0, y: 0, z: 0 },
            size: { x: 5000, y: 5000, z: 5000 },
            floorY: -498, // 床(-499)より1ユニット上に配置してZファイティングを物理的に回避
            floorSize: 10000,
            floorDivisions: 100,
            labelMax: 256
        });

        this.setupLights();
        this.createStudioBox();
        this.createSpheres();
        this.initPostProcessing();
        this.initialized = true;
    }

    setupLights() {
        const { promoWallLightTarget, promoWallFillLight } = setupStudioRoomPromoWallFillLight(this.scene, {
            ceilingY: STUDIO_CEILING_Y
        });
        this.promoWallLightTarget = promoWallLightTarget;
        this.promoWallFillLight = promoWallFillLight;
    }

    /**
     * 撮影用スタジオ（Scene21 と同一の StudioBox + attachCeilingSpotRig）
     */
    createStudioBox() {
        this.studio = new StudioBox(
            this.scene,
            studioBoxOptionsForStudioRoom(this.sceneLightingScale, this._roomEnvTexture)
        );
        this.studio.attachCeilingSpotRig(this.studio.studioBox, {
            includeCeilingPlane: false,
            ...ceilingSpotRigOptionsForStudioRoom(this.sceneLightingScale)
        });
    }

    /**
     * Sphereと赤い足の作成
     */
    createSpheres() {
        this.particles = [];
        const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
        const textures = this.generateFleshTextures();
        const sphereMat = new THREE.MeshStandardMaterial({
            map: textures.map,
            bumpMap: textures.bumpMap,
            bumpScale: 3.0, 
            metalness: 0.4,  // エイリアンっぽく少し金属的な光沢を
            roughness: 0.2,  // ヌルヌル感は維持
            emissive: 0x000000, // 発光はオフにして不気味に
            emissiveIntensity: 0.0
        });

        this.instancedMeshManager = new InstancedMeshManager(this.scene, sphereGeo, sphereMat, this.sphereCount);
        const mainMesh = this.instancedMeshManager.getMainMesh();
        mainMesh.castShadow = true;
        mainMesh.receiveShadow = true;
        
        // 個別色設定のための準備
        const colorArray = new Float32Array(this.sphereCount * 3);
        for (let i = 0; i < this.sphereCount; i++) {
            colorArray[i * 3 + 0] = 1.0;
            colorArray[i * 3 + 1] = 1.0;
            colorArray[i * 3 + 2] = 1.0;
        }
        mainMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);

        // 赤い足（Cylinder）
        // 向きを逆にするため、ジオメトリのオフセットを調整
        // さきっちょ（尖っている方）が外側を向くように調整
        const footGeo = new THREE.CylinderGeometry(0.02, 0.1, 1, 8); // 上底を細く(0.02)、下底を太く(0.1)
        footGeo.translate(0, 0.5, 0); // 下底（太い方）が原点(Sphere側)に来るように配置
        const footMat = new THREE.MeshStandardMaterial({ 
            color: 0xff0000, // 赤に戻す
            metalness: 0.4,  
            roughness: 0.4   
        });
        this.lineManager = new THREE.InstancedMesh(footGeo, footMat, this.sphereCount);
        this.lineManager.castShadow = true;
        this.lineManager.receiveShadow = true;
        this.scene.add(this.lineManager);

        for (let i = 0; i < this.sphereCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = Math.pow(Math.random(), 1.5) * this.spawnRadius;
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);

            // 大きさのランダム幅を拡大 (15〜25 だったのを 10〜60 に拡大)
            const radius = 10 + Math.pow(Math.random(), 2.0) * 50; 
            const p = new Scene01Particle(x, y, z, radius);
            p.angularVelocity.multiplyScalar(2.0);
            this.particles.push(p);

            this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, radius);
        }
        
        this.instancedMeshManager.markNeedsUpdate();
        this.setParticleCount(this.sphereCount);
    }

    /**
     * エイリアンっぽい質感のテクスチャ（カラーとバンプ）を生成
     */
    generateFleshTextures() {
        const size = 512;
        
        // 1. カラーマップ用のキャンバス
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size;
        colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');
        
        // ベースのライトグレー（さらに明るく調整）
        cCtx.fillStyle = '#888888'; 
        cCtx.fillRect(0, 0, size, size);

        // エイリアンっぽい「斑点」や「色ムラ」をグレースケールで追加
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 20 + Math.random() * 60;
            const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
            // グレーの濃淡（さらに明るめに）
            const grayVal = 120 + Math.random() * 80;
            grad.addColorStop(0, `rgba(${grayVal}, ${grayVal}, ${grayVal}, 0.5)`);
            grad.addColorStop(1, `rgba(136, 136, 136, 0)`);
            cCtx.fillStyle = grad;
            cCtx.beginPath();
            cCtx.arc(x, y, r, 0, Math.PI * 2);
            cCtx.fill();
        }

        // 「血管」のようなうねった曲線をグレースケールで追加
        cCtx.strokeStyle = 'rgba(200, 200, 200, 0.5)'; // かなり明るいグレーの血管
        for (let i = 0; i < 30; i++) {
            cCtx.lineWidth = 0.8 + Math.random() * 2.0; // 少し太くして視認性アップ
            let x = Math.random() * size;
            let y = Math.random() * size;
            
            cCtx.beginPath();
            cCtx.moveTo(x, y);
            
            // ランダムウォーク + 慣性でうねうねさせる
            let angle = Math.random() * Math.PI * 2;
            for (let j = 0; j < 40; j++) {
                angle += (Math.random() - 0.5) * 1.2;
                x += Math.cos(angle) * 8;
                y += Math.sin(angle) * 8;
                cCtx.lineTo(x, y);
            }
            cCtx.stroke();
        }

        // 2. バンプマップ用のキャンバス
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size;
        bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, size, size);

        // 細かい凹凸
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 1 + Math.random() * 3;
            const isBump = Math.random() > 0.5;
            bCtx.fillStyle = isBump ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
            bCtx.beginPath();
            bCtx.arc(x, y, r, 0, Math.PI * 2);
            bCtx.fill();
        }

        // 大きなボコボコ
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 10 + Math.random() * 30;
            const grad = bCtx.createRadialGradient(x, y, 0, x, y, r);
            const val = Math.random() > 0.5 ? 255 : 0;
            grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.4)`);
            grad.addColorStop(1, `rgba(128, 128, 128, 0)`);
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

    initPostProcessing() {
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            const renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);
        }
        if (this.useSSAO) {
            this.ssaoPass = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
            this.ssaoPass.kernelRadius = 8;
            this.composer.addPass(this.ssaoPass);
        }
        if (this.useBloom) {
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 4, window.innerHeight / 4), 0.2, 0.1, 1.2);
            this.composer.addPass(this.bloomPass);
        }
        if (this.useDOF) {
            attachDepthOfField(this, {
                focus: 500,
                aperture: 0.000005,
                maxblur: 0.003
            });
        }
        attachPresentationOutputPass(this);
        attachFilmGrainPass(this, 0.35, false);
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;
        
        // シェーダーの時間を更新
        if (this.sphereMaterialShader) {
            this.sphereMaterialShader.uniforms.uTime.value = this.time;
        }
        if (this.sphereDepthShader) {
            this.sphereDepthShader.uniforms.uTime.value = this.time;
        }

        // モードの自動切り替え（10秒周期）
        this.modeTimer += deltaTime;
        if (this.modeTimer >= this.modeInterval) {
            this.modeTimer = 0;
            let nextMode;
            do {
                nextMode = Math.floor(Math.random() * 10);
            } while (nextMode === this.currentMode);
            
            this.currentMode = nextMode;
            this.useGravity = (this.currentMode === this.MODE_GRAVITY || this.currentMode === this.MODE_RAIN);
// モード切り替え時の初期化
            if (this.currentMode === this.MODE_RAIN) {
                this.particles.forEach(p => {
                    p.position.y = 1500 + Math.random() * 1000;
                    p.velocity.set(0, -10 - Math.random() * 20, 0);
                });
            } else if (this.currentMode === this.MODE_FIGHT) {
                this.particles.forEach((p, idx) => {
                    const side = (idx % 2 === 0) ? 1 : -1;
                    p.position.set(side * 800, (Math.random() - 0.5) * 500 + 200, (Math.random() - 0.5) * 1000);
                    p.velocity.set(-side * 20, 0, 0);
                });
            }
        }

        this.updatePhysics(deltaTime);
        this.updateExpandSpheres();
        
        // レイキャストによるオートフォーカス：視線の先にあるオブジェクトにピントを合わせる
        if (this.useDOF && this.bokehPass && this.instancedMeshManager) {
            const mainMesh = this.instancedMeshManager.getMainMesh();
            if (mainMesh) {
                this.updateAutoFocus([mainMesh]);
            }
        }
    }

    updatePhysics(deltaTime) {
        const subSteps = 2;
        const dt = deltaTime / subSteps;
        const halfSize = 950;
        const tempVec = new THREE.Vector3();
        const diff = new THREE.Vector3();

        for (let s = 0; s < subSteps; s++) {
            this.grid.clear();
            this.particles.forEach((p, i) => {
                const gx = Math.floor(p.position.x / this.gridSize);
                const gy = Math.floor(p.position.y / this.gridSize);
                const gz = Math.floor(p.position.z / this.gridSize);
                // 文字列キーをやめて、整数キー（ハッシュ）を使うことで劇的に高速化
                // 空間を200x200x200のグリッドと仮定（十分な広さ）
                const key = (gx + 100) + (gy + 100) * 200 + (gz + 100) * 40000;
                if (!this.grid.has(key)) this.grid.set(key, []);
                this.grid.get(key).push(i);
            });

            this.particles.forEach((p, idx) => {
                // モード別の力計算（Scene01オリジナル：生物的・物理的アプローチ）
                if (this.currentMode === this.MODE_SWARM) {
                    // 一つの巨大な塊として動く（群れ）
                    const center = new THREE.Vector3(
                        Math.sin(this.time * 0.5) * 300,
                        Math.cos(this.time * 0.7) * 200 + 300,
                        Math.sin(this.time * 0.3) * 300
                    );
                    const tx = center.x + p.targetOffset.x * 0.4;
                    const ty = center.y + p.targetOffset.y * 0.4;
                    const tz = center.z + p.targetOffset.z * 0.4;
                    const springK = 0.05 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (this.currentMode === this.MODE_SNAKE) {
                    // 蛇行（数珠つなぎのような動き）
                    const t = this.time * 2.0 - idx * 0.1;
                    const tx = Math.sin(t) * 500;
                    const ty = Math.cos(t * 0.5) * 300 + 300;
                    const tz = Math.sin(t * 0.7) * 500;
                    const springK = 0.1 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (this.currentMode === this.MODE_VORTEX) {
                    // 竜巻（垂直方向の渦）
                    const angle = this.time * 3.0 + p.position.y * 0.01;
                    const radius = (p.position.y + 500) * 0.3 + 100;
                    const tx = Math.cos(angle) * radius;
                    const tz = Math.sin(angle) * radius;
                    const springK = 0.08 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, 0.5, (tz - p.position.z) * springK);
                    p.addForce(tempVec);
                    if (p.position.y > 1500) p.position.y = -450;

                } else if (this.currentMode === this.MODE_ATOM) {
                    // 原子軌道（3軸の回転）
                    const speed = 2.0;
                    const radius = 500 * p.radiusOffset;
                    const axis = idx % 3;
                    let tx = 0, ty = 200, tz = 0;
                    if (axis === 0) {
                        tx = Math.cos(this.time * speed + p.phaseOffset) * radius;
                        ty = Math.sin(this.time * speed + p.phaseOffset) * radius + 200;
                    } else if (axis === 1) {
                        ty = Math.cos(this.time * speed + p.phaseOffset) * radius + 200;
                        tz = Math.sin(this.time * speed + p.phaseOffset) * radius;
                    } else {
                        tx = Math.cos(this.time * speed + p.phaseOffset) * radius;
                        tz = Math.sin(this.time * speed + p.phaseOffset) * radius;
                    }
                    const springK = 0.06 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (this.currentMode === this.MODE_PULSE) {
                    // 鼓動（拡大縮小する球体）
                    const pulse = Math.pow(Math.sin(this.time * 2.0), 4.0);
                    const radius = (300 + pulse * 400) * p.radiusOffset;
                    const target = p.targetOffset.clone().normalize().multiplyScalar(radius);
                    const tx = target.x;
                    const ty = target.y + 300;
                    const tz = target.z;
                    const springK = 0.1 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (this.currentMode === this.MODE_GRID_3D) {
                    // 3D標本（整列）
                    const gridCount = 7; // 7x7x7 = 343 (300個にちょうど良い)
                    const spacing = 150;
                    const gx = idx % gridCount;
                    const gy = Math.floor(idx / gridCount) % gridCount;
                    const gz = Math.floor(idx / (gridCount * gridCount));
                    const tx = (gx - (gridCount-1)*0.5) * spacing;
                    const ty = (gy - (gridCount-1)*0.5) * spacing + 400;
                    const tz = (gz - (gridCount-1)*0.5) * spacing;
                    const springK = 0.15 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (this.currentMode === this.MODE_FIGHT) {
                    // 衝突（2群対立）
                    const side = (idx % 2 === 0) ? 1 : -1;
                    const tx = side * (Math.sin(this.time * 5.0) * 200 + 400);
                    const ty = p.targetOffset.y * 0.5 + 300;
                    const tz = p.targetOffset.z * 0.5;
                    const springK = 0.1 * p.strayFactor;
                    tempVec.set((tx - p.position.x) * springK, (ty - p.position.y) * springK, (tz - p.position.z) * springK);
                    p.addForce(tempVec);

                } else if (this.currentMode === this.MODE_RAIN) {
                    // 降り注ぐ雨
                    p.addForce(this.gravityForce.clone().multiplyScalar(2.0));
                    if (p.position.y < -450) {
                        p.position.y = 1500;
                        p.velocity.y = -10 - Math.random() * 20;
                    }
                } else if (this.currentMode === this.MODE_GRAVITY) {
                    p.addForce(this.gravityForce);
                } else {
                    // DEFAULT: 浮遊
                    tempVec.copy(p.position).multiplyScalar(-0.002);
                    p.addForce(tempVec);
                }

                p.update();
                p.velocity.multiplyScalar(0.95); 

                if (this.useWallCollision) {
                    if (p.position.x > halfSize) { p.position.x = halfSize; p.velocity.x *= -0.5; }
                    if (p.position.x < -halfSize) { p.position.x = -halfSize; p.velocity.x *= -0.5; }
                    if (p.position.y > 1500) { p.position.y = 1500; p.velocity.y *= -0.5; }
                    
                    // 床の衝突判定
                    if (p.position.y < -450) { 
                        p.position.y = -450; 
                        p.velocity.y *= -0.2; // 跳ね返りを弱くして接地感を出す
                        
                        // 【コロコロ転がるロジック】
                        // 横方向の速度を回転速度に変換（物理的な転がりをシミュレート）
                        // X方向の移動 -> Z軸周りの回転、Z方向の移動 -> X軸周りの回転
                        const rollFactor = 0.1 / (p.radius / 30); 
                        p.angularVelocity.z = -p.velocity.x * rollFactor;
                        p.angularVelocity.x = p.velocity.z * rollFactor;

                        // 床との摩擦（少しずつ止まるように）
                        p.velocity.x *= 0.97;
                        p.velocity.z *= 0.97;
                    }
                    if (p.position.z > halfSize) { p.position.z = halfSize; p.velocity.z *= -0.5; }
                    if (p.position.z < -halfSize) { p.position.z = -halfSize; p.velocity.z *= -0.5; }
                }
                p.updateRotation(dt);
            });

            this.particles.forEach((a, i) => {
                const gx = Math.floor(a.position.x / this.gridSize);
                const gy = Math.floor(a.position.y / this.gridSize);
                const gz = Math.floor(a.position.z / this.gridSize);
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oy = -1; oy <= 1; oy++) {
                        for (let oz = -1; oz <= 1; oz++) {
                            const key = (gx + ox + 100) + (gy + oy + 100) * 200 + (gz + oz + 100) * 40000;
                            const neighbors = this.grid.get(key);
                            if (!neighbors) continue;
                            neighbors.forEach(j => {
                                if (i >= j) return;
                                const b = this.particles[j];
                                diff.subVectors(a.position, b.position);
                                const distSq = diff.lengthSq();
                                const minDist = a.radius + b.radius;
                                if (distSq < minDist * minDist) {
                                    const dist = Math.sqrt(distSq);
                                    const overlap = (minDist - dist) * 0.6; // 重なり解消を少し強める(0.5 -> 0.6)
                                    const normal = diff.divideScalar(dist || 1);
                                    tempVec.copy(normal).multiplyScalar(overlap);
                                    a.position.add(tempVec);
                                    b.position.sub(tempVec);
                                    
                                    const relVel = tempVec.subVectors(a.velocity, b.velocity);
                                    const dot = relVel.dot(normal);
                                    if (dot < 0) {
                                        const impulse = normal.multiplyScalar(-(1 + 0.7) * dot * 0.5); // 反発係数を上げる(0.5 -> 0.7)
                                        a.velocity.add(impulse);
                                        b.velocity.sub(impulse);
                                        
                                        // 衝突時に少し回転を加える（転がるきっかけ）
                                        const torque = (Math.random() - 0.5) * 0.01;
                                        a.angularVelocity.x += torque;
                                        b.angularVelocity.z += torque;
                                    }
                                }
                            });
                        }
                    }
                }
            });
        }

        if (this.instancedMeshManager) {
            const mainMesh = this.instancedMeshManager.getMainMesh();
            if (mainMesh) {
                const lineMatrix = new THREE.Matrix4();
                const lineQuat = new THREE.Quaternion();
                this.particles.forEach((p, i) => {
                    if (i >= this.sphereCount) return;
                    this.instancedMeshManager.setMatrixAt(i, p.position, p.rotation, p.radius);
                    if (this.lineManager && this.useTacoFeet) {
                        lineQuat.setFromEuler(p.rotation);
                        lineMatrix.compose(p.position, lineQuat, tempVec.set(p.radius*0.5, p.radius*4.0, p.radius*0.5));
                        this.lineManager.setMatrixAt(i, lineMatrix);
                    }
                });
                this.instancedMeshManager.markNeedsUpdate();
                if (this.lineManager) this.lineManager.instanceMatrix.needsUpdate = true;
            }
        }
    }

    handleTrackNumber(trackNumber, message) {
        if (trackNumber === 6) {
            const args = message.args || [];
            const velocity = args[1] !== undefined ? args[1] : 127; // ベロシティを取得（デフォルト127）
            this.triggerExpandEffect(velocity);
        }
    }

    triggerExpandEffect(velocity = 127) {
        const center = new THREE.Vector3((Math.random()-0.5)*this.spawnRadius*0.4, (Math.random()-0.5)*this.spawnRadius*0.4, (Math.random()-0.5)*this.spawnRadius*0.4);
        const explosionRadius = 800;
        
        // ベロシティ（0-127）を力（0.0 - 1.0）に正規化して、最大威力（40.0）にかける
        const vFactor = velocity / 127.0;
        const explosionForce = 40.0 * vFactor; 

        this.particles.forEach(p => {
            const diff = p.position.clone().sub(center);
            const dist = diff.length();
            if (dist < explosionRadius) {
                const strength = Math.pow(1.0 - dist/explosionRadius, 2.0) * explosionForce;
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

    reset() { super.reset(); }

    dispose() {
        this.initialized = false;
        this.particles = [];
        if (this.studio) this.studio.dispose();
        disposeStudioRoomEnvironmentMap(this._roomEnvPresentation, this.scene);
        this._roomEnvPresentation = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;
        this.expandSpheres.forEach(e => {
            if (e.light) this.scene.remove(e.light);
            if (e.mesh) { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
        });
        if (this.instancedMeshManager) this.instancedMeshManager.dispose();
        if (this.lineManager) {
            this.scene.remove(this.lineManager);
            this.lineManager.geometry.dispose();
            this.lineManager.material.dispose();
        }
        if (this.ssaoPass) {
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.ssaoPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            this.ssaoPass.enabled = false;
        }
        disposePresentationOutputPass(this);
        super.dispose();
    }
}
