/**
 * Scene06: 水銀クローム・スフィア（相互反射モデル）
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { InstancedMeshManager } from '../../lib/InstancedMeshManager.js';
import {
    StudioBox,
    attachDepthOfField,
    attachFilmGrainPass,
    applyStandardPresentationRenderer,
    attachPresentationOutputPass,
    disposePresentationOutputPass
} from '../../lib/presentation/index.js';
import { Scene06Particle } from './Scene06Particle.js';

export class Scene06 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'Mercury Mirror';
        this.initialized = false;
        this.sceneNumber = 6;
        this.kitNo = 36;
        
        this.sharedResourceManager = sharedResourceManager;
        this.raycaster = new THREE.Raycaster();
        
        // 最大2250個に設定
        this.partTypes = 1; 
        this.maxInstances = 2250; 
        this.instancesPerType = this.maxInstances; 
        this.sphereCount = this.maxInstances;
        this.currentVisibleCount = 0;
        this.spawnRadius = 1000; 
        
        this.instancedMeshManagers = []; 
        this.particles = [];
        
        // 動的環境マップ用
        this.cubeCamera = null;
        this.cubeRenderTarget = null;

        // エフェクト設定
        this.useDOF = true; // SceneBaseのフラグを使用
        this.useBloom = true; 
        this.useFilmGrain = true;     // フィルムグレインON
        this.bloomPass = null;
        this.sceneLightingScale = 0.32;
        this.outputPass = null;

        this.trackEffects = {
            1: false, 2: false, 3: false, 4: false, 5: true, 6: true, 7: false, 8: false, 9: false
        };

        // 物理演算パラメータ
        this.useGravity = false; // true -> false 重力を切るで！
        this.gravityForce = new THREE.Vector3(0, 0, 0); // 0, -30.0, 0 -> 0, 0, 0
        this.centeringForce = 0.0002; // 0.001 -> 0.0002 さらに弱めて自然な広がりを！
        
        // モード管理（独自カスタマイズ版）
        this.DNA_HELIX = 'DNA_HELIX';
        this.ORBIT_SHELL = 'ORBIT_SHELL';
        this.FLOW_FIELD = 'FLOW_FIELD';
        this.GALAXY = 'GALAXY';
        this.HEART_BEAT = 'HEART_BEAT';
        this.TWIN_TORUS = 'TWIN_TORUS'; // 2つの絡み合うトーラス

        this.currentMode = this.DNA_HELIX;
        this.modeTimer = 0;
        this.modeInterval = 8.0; 
        this.modeSequence = [
            this.DNA_HELIX,
            this.ORBIT_SHELL,
            this.FLOW_FIELD,
            this.GALAXY,
            this.HEART_BEAT,
            this.TWIN_TORUS
        ];
        this.sequenceIndex = 0;
        this.geometricTargets = new Map();
        
        this.setScreenshotText(this.title);
    }

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 400;
        cameraParticle.maxDistance = 4000;
        cameraParticle.minY = -450;
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.setupLights();

        // 1. CubeCameraのセットアップ（解像度を256に戻してバランス調整！）
        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, { 
            generateMipmaps: true, 
            minFilter: THREE.LinearMipmapLinearFilter 
        });
        this.cubeCamera = new THREE.CubeCamera(10, 10000, this.cubeRenderTarget);
        this.cubeCamera.position.set(0, 500, 0);
        this.scene.add(this.cubeCamera);

        // 2. 壁・床用の静的な環境マップ（こちらも256に！）
        this.staticCubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter
        });
        this.staticCubeCamera = new THREE.CubeCamera(10, 10000, this.staticCubeRenderTarget);
        this.staticCubeCamera.position.set(0, 500, 0);
        this.scene.add(this.staticCubeCamera);

        this.createStudioBox();

        // シーン全体の環境マップとして設定（デフォルトは動的マップ）
        this.scene.environment = this.cubeRenderTarget.texture;

        this.camera.position.set(0, 500, 2000);
        this.camera.lookAt(0, 200, 0);

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStandardPresentationRenderer(this.renderer, this.sceneLightingScale);

        this.createSpheres();
        this.initPostProcessing();
        this.initialized = true;
    }

    /** 環境・四隅蛍光灯は StudioBox。天井付近のキーのみ */
    setupLights() {
        const pureWhite = 0xffffff;
        const pointLight = new THREE.PointLight(pureWhite, 3.0, 15000);
        pointLight.decay = 1.0; 
        pointLight.position.set(0, 3000, 0); 
        this.scene.add(pointLight);
    }

    createStudioBox() {
        const L = this.sceneLightingScale ?? 1;
        this.studio = new StudioBox(this.scene, {
            size: 10000,
            color: 0xbbbbbb, // 0xbbbbbb に下げて落ち着かせる
            roughness: 0.2, // 0.2 * 0.3 = 0.06 (床), 0.2 * 0.5 = 0.1 (壁)
            metalness: 0.8, // 0.8 + 0.2 = 1.0 (床), 0.8 + 0.1 = 0.9 (壁)
            lightColor: 0xffffff,
            lightIntensity: 2.8,
            envMap: this.cubeRenderTarget.texture,
            envMapIntensity: 1.3,
            ceilingSpotRig: { enabled: true, sceneLightingScale: L }
        });
        
        if (this.studio.studioFloor) {
            this.studio.studioFloor.material.side = THREE.DoubleSide;
        }
    }

    createSpheres() {
        // ヒートマップ用の基本マテリアル（デフォルトは黒に近い色）
        const heatMapMat = new THREE.MeshStandardMaterial({
            color: 0xffffff, // インスタンスカラーを使用するため白に設定
            metalness: 0.8,  
            roughness: 0.2,  
            envMap: this.staticCubeRenderTarget.texture, 
            envMapIntensity: 1.0 
        });

        // バンプマップ（ノーマルマップ）用のテクスチャを作成
        const size = 256;
        const data = new Uint8Array(size * size * 3);
        for (let i = 0; i < size * size * 3; i++) {
            data[i] = Math.random() * 255;
        }
        const noiseTex = new THREE.DataTexture(data, size, size, THREE.RGBFormat);
        noiseTex.wrapS = THREE.RepeatWrapping;
        noiseTex.wrapT = THREE.RepeatWrapping;
        noiseTex.needsUpdate = true;

        heatMapMat.normalMap = noiseTex;
        heatMapMat.normalScale.set(0.05, 0.05);

        const sphereGeom = new THREE.SphereGeometry(25, 12, 12); 
        
        // マネージャーを1つに戻す
        const manager = new InstancedMeshManager(this.scene, sphereGeom, heatMapMat, this.instancesPerType);
        this.instancedMeshManagers.push(manager);

        for (let i = 0; i < this.sphereCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = Math.pow(Math.random(), 1.5) * this.spawnRadius;
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta) + 500;
            const z = r * Math.cos(phi);

            const randomScale = 0.5 + Math.random() * 1.0;
            const p = new Scene06Particle(x, y, z, 75 * randomScale, new THREE.Vector3(randomScale, randomScale, randomScale), 0, i);
            p.scale.set(randomScale, randomScale, randomScale);
            p.radius = 75 * randomScale; 
            this.particles.push(p);
            
            // 初期状態は画面外へ
            manager.setMatrixAt(i, new THREE.Vector3(0, -10000, 0), p.rotation, p.scale);
            manager.setColorAt(i, new THREE.Color(0x050505)); // デフォルトは黒
        }
        
        this.instancedMeshManagers.forEach(m => {
            m.markNeedsUpdate();
            m.markColorsNeedsUpdate();
        });
        this.setParticleCount(this.sphereCount);
    }

    initPostProcessing() {
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
        }
        if (this.useBloom) {
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 4, window.innerHeight / 4), 0.25, 0.1, 0.85); // 0.3 -> 0.25 強度をほんの少し落とす
            this.composer.addPass(this.bloomPass);
        }
        if (this.useDOF) {
            attachDepthOfField(this, {
                focus: 1000,
                aperture: 0.000005,
                maxblur: 0.003
            });
        }
        attachPresentationOutputPass(this);
        attachFilmGrainPass(this, 0.35, false);
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        
        // actual_tick に基づく個数制御（384 tick/小節 * 96小節 で1ループ）
        const actualTick = this.actualTick || 0;
        const ticksPerMeasure = 384;
        const totalMeasures = 96;
        const totalLoopTicks = ticksPerMeasure * totalMeasures; // 36864 ticks
        
        const loopTick = actualTick % totalLoopTicks;
        
        // ユーザーの要望：phase 6（全体の約60%）付近までに最大数、最後には0
        // 96小節のうち、60小節（約62%）まで増やす設定にする
        const increaseUntilTick = ticksPerMeasure * 60;
        const decreaseFromTick = ticksPerMeasure * 80;
        
        let targetCount = 0;
        if (loopTick < increaseUntilTick) {
            // 0から60小節にかけて、1個から2250個まで増やす
            const progress = loopTick / increaseUntilTick;
            targetCount = Math.floor(1 + (this.maxInstances - 1) * progress);
        } else if (loopTick >= decreaseFromTick) {
            // 80小節以降、最後（96小節）に向かって0個に減らす
            const progress = Math.max(0, Math.min(1, (loopTick - decreaseFromTick) / (totalLoopTicks - decreaseFromTick))); 
            targetCount = Math.floor(this.maxInstances * (1 - progress));
        } else {
            // 60小節から80小節の間は最大数を維持
            targetCount = this.maxInstances;
        }
        
        this.currentVisibleCount = targetCount;
        this.setParticleCount(this.currentVisibleCount);

        // デバッグ用：HUDに現在の情報を表示
        if (this.hud) {
            const currentMeasure = Math.floor(loopTick / ticksPerMeasure) + 1;
            this.hud.debugText = `Spheres: ${this.currentVisibleCount} / Measure: ${currentMeasure}/96 (Tick: ${loopTick})`;
        }

        // deltaTimeが異常に大きい場合（タブ切り替え後など）の対策
        const dt = Math.min(deltaTime, 0.1);
        this.time += dt;

        // フレームカウント
        this.frameCounter = (this.frameCounter || 0) + 1;

        // モード切り替えタイマー（確実に切り替わるようにシンプルに！）
        const modeInterval = 8.0;
        const totalDuration = modeInterval * this.modeSequence.length;
        const cycleTime = this.time % totalDuration;
        const newIndex = Math.floor(cycleTime / modeInterval);
        
        this.sequenceIndex = newIndex;
        this.currentMode = this.modeSequence[this.sequenceIndex];

        // 物理演算
        this.updatePhysics(dt);

        // 環境マップの更新（カクつき防止のため毎フレーム更新に戻す！）
        // 1. スフィア用の環境マップ（背景のみ）を更新
        if (this.staticCubeCamera) {
            let mainMesh = null;
            let wasVisible = true;
            if (this.instancedMeshManagers.length > 0) {
                mainMesh = this.instancedMeshManagers[0].getMainMesh();
                if (mainMesh) {
                    wasVisible = mainMesh.visible;
                    mainMesh.visible = false; 
                }
            }
            this.staticCubeCamera.update(this.renderer, this.scene);
            if (mainMesh) mainMesh.visible = wasVisible;
        }

        // 2. 壁・床用の環境マップ（スフィアあり）を更新
        if (this.cubeCamera) {
            this.cubeCamera.update(this.renderer, this.scene);
        }

        // 行列の更新処理は updatePhysics に集約するため、ここからは削除！
        
        // オートフォーカス
        if (this.useDOF && this.bokehPass) {
            const meshes = this.instancedMeshManagers.map(m => m.getMainMesh());
            this.updateAutoFocus(meshes);
        }
    }

    updatePhysics(deltaTime) {
        // this.currentMode が undefined の場合のフォールバック
        const mode = this.currentMode || 'DNA_HELIX';
        const time = this.time;
        
        const halfSize = 4950;

        // インスタンス更新用のマネージャーをループの外で取得
        const manager = this.instancedMeshManagers[0];
        if (!manager) return;

        const tempColor = new THREE.Color();

        this.particles.forEach((p, i) => {
            // 現在の表示数を超えているパーティクルは更新しない（または画面外へ飛ばす）
            if (i >= this.currentVisibleCount) {
                // 画面外へ飛ばして見えなくする
                manager.setMatrixAt(i, new THREE.Vector3(0, -10000, 0), p.rotation, new THREE.Vector3(0, 0, 0));
                return;
            }

            let target = new THREE.Vector3();
            let force = new THREE.Vector3();

            switch (mode) {
                case 'DNA_HELIX': {
                    const side = i % 2 === 0 ? 1 : -1;
                    const angle = p.phaseOffset + time * 1.5;
                    const height = ((i / this.sphereCount) - 0.5) * 3500; // 2200 -> 3500 縦にガッツリ伸ばす
                    const radius = 1200 + Math.sin(time + height * 0.002) * 400; // 800 -> 1200 半径も大幅拡張
                    target.set(
                        Math.cos(angle + (side * Math.PI)) * radius,
                        height + 500,
                        Math.sin(angle + (side * Math.PI)) * radius
                    );
                    break;
                }
                case 'ORBIT_SHELL': {
                    const angle1 = p.phaseOffset + time * 0.4;
                    const angle2 = p.radiusOffset * 0.1 + time * 0.25;
                    const radius = 1800 + Math.sin(time * 0.5 + i * 0.1) * 300; // 1200 -> 1800 球殻をデカく
                    target.set(
                        Math.cos(angle1) * Math.sin(angle2) * radius,
                        Math.cos(angle2) * radius + 500,
                        Math.sin(angle1) * Math.sin(angle2) * radius
                    );
                    break;
                }
                case 'FLOW_FIELD': {
                    const noiseScale = 0.0005;
                    const noiseX = Math.sin(p.position.x * noiseScale + time * 0.5);
                    const noiseY = Math.cos(p.position.y * noiseScale + time * 0.5);
                    const noiseZ = Math.sin(p.position.z * noiseScale + time * 0.5);
                    force.set(noiseX, noiseY, noiseZ).multiplyScalar(150);
                    
                    const center = new THREE.Vector3(0, 500, 0);
                    const distToCenter = p.position.distanceTo(center);
                    if (distToCenter > 3000) { // 2000 -> 3000 部屋いっぱいに広げる
                        const backToCenter = center.clone().sub(p.position).normalize().multiplyScalar(50);
                        force.add(backToCenter);
                    }
                    break;
                }
                case 'GALAXY': {
                    const r = (i / this.sphereCount) * 3000 + 500; // 2000 -> 3000 渦を巨大化
                    const angle = time * (300 / r) + (i * 0.05);
                    const spiral = 0.5; // 0.4 -> 0.5
                    target.set(
                        Math.cos(angle) * r * (1 + Math.sin(time * 0.2) * spiral),
                        Math.sin(time * 0.3 + r * 0.005) * 800 + 500, // 500 -> 800 厚みを持たせる
                        Math.sin(angle) * r * (1 + Math.sin(time * 0.2) * spiral)
                    );
                    break;
                }
                case 'HEART_BEAT': {
                    const beat = Math.pow(Math.sin(time * 2.5), 8);
                    const r = (p.radiusOffset % 1500) + 800 + beat * 1000; // 1000, 600, 700 -> 1500, 800, 1000 爆発的な広がりに
                    const phi = (i / this.sphereCount) * Math.PI * 2;
                    const theta = Math.acos(2 * (i / this.sphereCount) - 1);
                    target.set(
                        Math.sin(theta) * Math.cos(phi) * r,
                        Math.cos(theta) * r + 500,
                        Math.sin(theta) * Math.sin(phi) * r
                    );
                    break;
                }
                case 'TWIN_TORUS': {
                    // 2つの絡み合う捻れたトーラス
                    const group = i % 2 === 0 ? 0 : 1;
                    const t = time * 0.5 + p.phaseOffset * 0.1;
                    const mainRadius = 1500;
                    const tubeRadius = 400;
                    
                    // グループごとに回転軸を変えて絡ませる
                    const angle = (i / (this.sphereCount / 2)) * Math.PI * 2 + time;
                    const tubeAngle = (i % 30) / 30 * Math.PI * 2 + time * 2;
                    
                    const tx = (mainRadius + tubeRadius * Math.cos(tubeAngle)) * Math.cos(angle);
                    const ty = tubeRadius * Math.sin(tubeAngle);
                    const tz = (mainRadius + tubeRadius * Math.cos(tubeAngle)) * Math.sin(angle);
                    
                    if (group === 0) {
                        target.set(tx, ty + 500, tz);
                    } else {
                        // 2つ目は90度回転させて垂直に絡ませる
                        target.set(ty, tx + 500, tz);
                    }
                    break;
                }
            }

            if (mode !== 'FLOW_FIELD') {
                const steer = target.clone().sub(p.position);
                const dist = steer.length();
                if (dist > 0) {
                    // Scene13並みに強力な引力を設定！
                    const springK = 0.5; // 0.05 -> 0.5  10倍に強化！
                    const maxSteerForce = 500; // 制限を大幅に緩和
                    steer.normalize().multiplyScalar(Math.min(dist * springK, maxSteerForce)); 
                    force.add(steer);
                }
            }

            // 物理更新
            p.velocity.add(force.multiplyScalar(deltaTime));
            p.velocity.multiplyScalar(0.92); // 摩擦を少し減らしてキビキビ動かす
            
            // 速度制限を大幅に緩和（Scene13並みの爆速移動を許可）
            const maxVelocity = 1500; 
            if (p.velocity.length() > maxVelocity) {
                p.velocity.normalize().multiplyScalar(maxVelocity);
            }
            
            p.position.add(p.velocity.clone().multiplyScalar(deltaTime));

            // 壁・床の衝突判定
            if (p.position.x > halfSize) { p.position.x = halfSize; p.velocity.x *= -0.3; }
            if (p.position.x < -halfSize) { p.position.x = -halfSize; p.velocity.x *= -0.3; }
            if (p.position.z > halfSize) { p.position.z = halfSize; p.velocity.z *= -0.3; }
            if (p.position.z < -halfSize) { p.position.z = -halfSize; p.velocity.z *= -0.3; }
            if (p.position.y > 4500) { p.position.y = 4500; p.velocity.y *= -0.3; }
            if (p.position.y < -450) { p.position.y = -450; p.velocity.y *= -0.1; }

            // 回転更新
            p.rotation.x += 0.05; // 0.01 -> 0.05
            p.rotation.y += 0.1;  // 0.02 -> 0.1
            p.rotation.z += 0.03; // 追加！

            // 行列の更新（ランダムなサイズを反映！）
            manager.setMatrixAt(i, p.position, p.rotation, p.scale);

            // --- モノクロ・ヒートマップ色の計算 ---
            // 速度（velocity）の大きさを力として扱う
            const speed = p.velocity.length();
            const maxSpeedForColor = 800; // 400 -> 800 バランス調整
            const normSpeed = Math.min(speed / maxSpeedForColor, 1.0);

            // 黒 (0,0,0) -> 白 (1,1,1) のシンプルなグラデーション
            // 指数関数（2.0乗）を使って、本当に速い時だけシルバーになるようにする
            const brightness = 0.05 + Math.pow(normSpeed, 2.0) * 0.95; 
            tempColor.setRGB(brightness, brightness, brightness);

            manager.setColorAt(i, tempColor);
        });

        manager.markNeedsUpdate();
        manager.markColorsNeedsUpdate();
    }

    handleOSC(message) {
        // 親クラスの処理を呼ぶ
        super.handleOSC(message);
        
        // rawPhase を独自に保存（滑らかな個数制御のため）
        if (message.address === '/phase/' || message.address === '/phase') {
            const args = message.args || [];
            if (args.length > 0) {
                const phaseValue = typeof args[0] === 'number' ? args[0] : parseFloat(args[0]);
                if (!isNaN(phaseValue)) {
                    this.rawPhase = phaseValue;
                }
            }
        }
    }

    handleTrackNumber(trackNumber, message) {
        const args = message.args || [];
        const velocity = args[1] !== undefined ? args[1] : 127;
        
        // トラック5でパーティクルにランダムな衝撃を加える！
        if (trackNumber === 5) {
            this.triggerMidiForce(velocity);
        }
        
        if (trackNumber === 6) this.triggerExpandEffect(velocity);
    }

    triggerMidiForce(velocity = 127) {
        if (this.particles.length === 0) return;

        // ランダムなパーティクルを1つ選んで、その位置を爆発の中心にする！
        const targetIdx = Math.floor(Math.random() * this.particles.length);
        const center = this.particles[targetIdx].position.clone();
        
        const forceStrength = 800.0 * (velocity / 127.0); // 3000.0 -> 800.0 大幅に弱めて繊細に！
        const radius = 400; // 500 -> 400 範囲も少しタイトに

        this.particles.forEach(p => {
            const diff = p.position.clone().sub(center);
            const dist = diff.length();
            
            if (dist < radius && dist > 0) {
                // 距離に応じて減衰する衝撃波
                const falloff = 1.0 - (dist / radius);
                const f = diff.normalize().multiplyScalar(forceStrength * falloff);
                p.velocity.add(f);
            }
        });
    }

    triggerExpandEffect(velocity = 127) {
        const center = new THREE.Vector3((Math.random()-0.5)*1000, 0, (Math.random()-0.5)*1000);
        const force = 300.0 * (velocity / 127.0);
        this.particles.forEach(p => {
            const diff = p.position.clone().sub(center);
            if (diff.length() < 2000) p.addForce(diff.normalize().multiplyScalar(force));
        });
    }

    dispose() {
        this.initialized = false;
        disposePresentationOutputPass(this);
        if (this.studio) this.studio.dispose();
        if (this.cubeRenderTarget) this.cubeRenderTarget.dispose();
        if (this.staticCubeRenderTarget) this.staticCubeRenderTarget.dispose();
        this.instancedMeshManagers.forEach(m => m.dispose());
        this.instancedMeshManagers = [];
        this.particles = [];
        if (this.bloomPass) { if (this.composer) { const idx = this.bloomPass && this.composer.passes.indexOf(this.bloomPass); if (idx !== -1) this.composer.passes.splice(idx, 1); } this.bloomPass.enabled = false; }
        super.dispose();
    }
}
