/**
 * Scene05: AKIRAの鉄雄のようなグロテスクな金属融合
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
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
import { RandomLFO } from '../../lib/RandomLFO.js';
import { Scene05Particle } from './Scene05Particle.js';

export class Scene05 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'Xenomorph';
        this.initialized = false;
        this.sceneNumber = 5;
        this.kitNo = 16;
        
        this.sharedResourceManager = sharedResourceManager;
        this.raycaster = new THREE.Raycaster();
        
        // 触手（Tentacles）の設定
        this.tentacleCount = 100; 
        this.tentacles = [];
        this.tentacleGroup = new THREE.Group();
        this.coreMesh = null; // 真ん中の球体

        // 意志（State Machine）の設定
        this.STATE_IDLE = 0;    
        this.STATE_WILD = 1;    
        this.STATE_FOCUS = 2;   
        this.STATE_STASIS = 3;  
        
        this.creatureState = this.STATE_IDLE;
        this.stateTimer = 0;
        this.stateDuration = 5.0;
        this.focusTarget = new THREE.Vector3(0, 500, 1000); 
        
        // なだらかな遷移のためのパラメータ
        this.currentAnimParams = {
            speed: 0.08,
            waveFreq: 1.2,
            waveAmp: 40.0,
            focusWeight: 0.0,
            moveSpeed: 0.02,
            distortionSpeed: 0.03,
            distortionAmp: 0.2 
        };
        this.targetAnimParams = { ...this.currentAnimParams };

        // 究極のランダムさのための RandomLFO 群
        this.speedLFO = new RandomLFO(0.01, 0.05, 0.01, 0.08); // スピード上限を抑制
        this.ampLFO = new RandomLFO(0.005, 0.02, 10.0, 80.0);   // 動きの大きさ
        this.distortionSpeedLFO = new RandomLFO(0.01, 0.04, 0.01, 0.06); // コアの歪み速さ
        this.distortionAmpLFO = new RandomLFO(0.005, 0.03, 0.1, 0.5);   // コアの歪み強さ
        this.colorCycleLFO = new RandomLFO(0.002, 0.01, 0.0, 1.0);      // 色の移り変わり

        // エフェクト設定
        this.useDOF = true; // SceneBaseのフラグを使用
        this.useBloom = true; 
        this.useFilmGrain = true;     // フィルムグレインON
        this.bloomPass = null;
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

        this.trackEffects = {
            1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false
        };

        // クリーチャー自体の物理状態を管理するパーティクル
        this.creatureParticle = new Scene05Particle(0, 400, 0);
        this.creatureParticle.maxSpeed = 8.0; // 12.0 * 2/3
        this.creatureParticle.maxForce = 2.0; // 3.0 * 2/3
        this.creatureParticle.friction = 0.01; 

        // トラックごとの値を保持するオブジェクト
        this.trackValues = {
            5: 0,
            6: 0,
            7: 0
        };

        // レーザースキャン用の配列
        this.scans = [];

        // 最適化用のテンポラリオブジェクト
        this.tempColor = new THREE.Color();
        this.tempTargetColor = new THREE.Color();
        this.tempVPos = new THREE.Vector3();
        this.tempV = new THREE.Vector3();
        this.tempNormal = new THREE.Vector3(); // カメラ反発用
        this.scanColor = new THREE.Color(); // スキャン発光用

        this.setScreenshotText(this.title);
    }

    /**
     * トラック番号ごとのOSCメッセージ処理
     */
    handleTrackNumber(trackNumber, message) {
        const args = message.args || [];
        const velocity = args[1] || 0;
        const value = velocity / 127.0; // 0.0 〜 1.0 に正規化
        const durationMs = args[2] || 500; // デュレーション（ミリ秒）

        if (trackNumber === 5) {
            this.trackValues[5] = value;
            if (velocity > 0) {
                // Scene03を参考にスキャンを追加
                const speed = 1.0 / (Math.max(100, durationMs) / 1000.0) * 0.5;
                this.scans.push({
                    progress: -0.2, // コアの内側からスタート
                    speed: speed,
                    intensity: value,
                    hue: Math.random() // スキャンの色は全系統ランダムに奔放に！
                });
            }
        } else if (trackNumber === 6) {
            this.trackValues[6] = value;
        } else if (trackNumber === 7) {
            this.trackValues[7] = value;
        }
    }

    /**
     * カメラ距離の徹底修正
     */
    setupCameraParticleDistance(cameraParticle) {
        // 距離を離しつつ、StudioBox（size=10000, 半径5000）を突き抜けないように制限
        // z-fighting 防止のため、最大距離を 4850 程度に抑える
        // コアが描画されないバグ対策のため、最小距離を調整 (500 -> 750)
        cameraParticle.minDistance = 750; 
        cameraParticle.maxDistance = 4850; 
        cameraParticle.maxDistanceReset = 4500;
        cameraParticle.minY = -200; 
        cameraParticle.maxY = 4500; 
        
        // 即座に位置を更新
        cameraParticle.initializePosition();
    }

    /**
     * カメラをランダムに切り替える（SceneBaseのオーバーライド）
     */
    switchCameraRandom() {
        // 親クラスの処理を呼ぶ
        super.switchCameraRandom();
        
        // 切り替わった瞬間に、新しいカメラの位置が近すぎないかチェックして強制的に離す
        const cp = this.cameraParticles[this.currentCameraIndex];
        if (cp) {
            const dist = cp.position.length();
            if (dist < cp.minDistance) {
                cp.position.normalize().multiplyScalar(cp.minDistance + 500);
            }
        }
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();
        
        // 基底クラスのカメラ設定を上書き
        if (this.cameraParticle) {
            this.setupCameraParticleDistance(this.cameraParticle);
        }

        // 初期カメラ位置も箱の内側に収める
        this.camera.position.set(0, 1000, 4500); 
        this.camera.lookAt(0, 400, 0);
        
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

        this.setupLights();

        this.createStudioBox();
        this.createTentacles();
        this.initPostProcessing();
        this.initialized = true;
    }

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

    /** Scene21 と同一 */
    setupLights() {
        const { promoWallLightTarget, promoWallFillLight } = setupStudioRoomPromoWallFillLight(this.scene, {
            ceilingY: STUDIO_CEILING_Y
        });
        this.promoWallLightTarget = promoWallLightTarget;
        this.promoWallFillLight = promoWallFillLight;
    }

    createTentacles() {
        const textures = this.generateFleshTextures();
        this.scene.add(this.tentacleGroup);
        const tentacleCount = this.tentacleCount; 
        const baseRadius = 450; 

        this.time = Math.random() * 100;

        const coreGeo = new THREE.IcosahedronGeometry(baseRadius, 12); 
        coreGeo.userData.initialPositions = coreGeo.attributes.position.array.slice();
        
        // 頂点カラー属性を初期化
        const coreColors = new Float32Array(coreGeo.attributes.position.count * 3);
        const skinColor = new THREE.Color('#ffffff');
        for(let i=0; i<coreColors.length/3; i++){
            coreColors[i*3] = skinColor.r;
            coreColors[i*3+1] = skinColor.g;
            coreColors[i*3+2] = skinColor.b;
        }
        coreGeo.setAttribute('color', new THREE.BufferAttribute(coreColors, 3));

        const coreMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: textures.map, 
            bumpMap: textures.bumpMap,
            bumpScale: 15.0, 
            metalness: 0.1, 
            roughness: 0.5, 
            vertexColors: true,
            emissive: 0x000000,
            transparent: false
        });
        this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
        this.coreMesh.castShadow = true;
        this.coreMesh.receiveShadow = true;
        this.tentacleGroup.add(this.coreMesh);

        for (let i = 0; i < tentacleCount; i++) {
            const points = [];
            
            // 生える場所：クラスターの影響を弱め、よりバラついた配置に
            const clusterSeed = Math.floor(i / 20); 
            const clusterPhi = (Math.sin(clusterSeed * 1.8) * 0.5 + 0.5) * Math.PI * 2;
            const clusterTheta = (Math.cos(clusterSeed * 2.5) * 0.5 + 0.5) * Math.PI;
            // クラスター中心への寄り度合いを50%にし、残りはランダムで球面に分散
            const clusterWeight = 0.5;
            const randomSpread = 2.8;
            const phi = clusterPhi * clusterWeight + (Math.random() - 0.5) * randomSpread + (i / tentacleCount) * Math.PI * 0.3;
            const theta = clusterTheta * clusterWeight + (Math.random() - 0.5) * randomSpread + (i / tentacleCount) * Math.PI * 0.2;

            const baseThickness = 12 + Math.pow(Math.random(), 2.0) * 60;
            const r = baseRadius + 400; 

            // 個性（群れを外れる確率など）を保存
            const rebellionFactor = Math.random() > 0.8 ? 1.0 : 0.0; // 20%の確率で反抗的
            const coilDirection = Math.random() > 0.5 ? 1.0 : -1.0; // 内巻きか外巻きか

            // 1点目：コアのさらに中心深くからスタート
            // コアが縮んだ時（scaleが小さくなった時）でも浮かないように、
            // 半径の 10% くらいの位置まで下げて、実質的に「中心点」に近い場所から生やす
            const startPoint = new THREE.Vector3(
                baseRadius * 0.1 * Math.sin(theta) * Math.cos(phi),
                baseRadius * 0.1 * Math.cos(theta),
                baseRadius * 0.1 * Math.sin(theta) * Math.sin(phi)
            );
            points.push(startPoint);

            const midDist = baseRadius * 0.5; // 中間点もコアの内部に配置して、生え際を安定させる
            const midPoint = new THREE.Vector3(
                midDist * Math.sin(theta + (Math.random()-0.5)*0.5) * Math.cos(phi + (Math.random()-0.5)*0.5),
                midDist * Math.cos(theta + (Math.random()-0.5)*0.5),
                midDist * Math.sin(theta + (Math.random()-0.5)*0.5) * Math.sin(phi + (Math.random()-0.5)*0.5)
            );
            points.push(midPoint);
            points.push(new THREE.Vector3(
                r * Math.sin(theta) * Math.cos(phi),
                r * Math.cos(theta),
                r * Math.sin(theta) * Math.sin(phi)
            ));
            
            const curve = new THREE.CatmullRomCurve3(points);
            const geometry = new THREE.TubeGeometry(curve, 64, baseThickness, 12, false);
            
            // ジオメトリのバウンディングスフィアを更新（カメラの衝突判定等に使われる可能性があるため）
            geometry.computeBoundingSphere();
            
            const tentacleColors = new Float32Array(geometry.attributes.position.count * 3);
            for(let j=0; j<tentacleColors.length/3; j++){
                tentacleColors[j*3] = skinColor.r;
                tentacleColors[j*3+1] = skinColor.g;
                tentacleColors[j*3+2] = skinColor.b;
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(tentacleColors, 3));

            const posAttr = geometry.attributes.position;
            const vertex = new THREE.Vector3();
            for (let s = 0; s <= 64; s++) {
                const t = s / 64;
                // テーパリングの計算を調整：根本（t=0）付近を太く維持し、先端に向けて細くする
                // 根本から 20% くらいまでは太さをキープするように累乗を調整
                const taperScale = Math.max(0.01, 1.0 - Math.pow(t, 2.5)); 
                const pathPoint = curve.getPointAt(t);
                for (let rIdx = 0; rIdx <= 12; rIdx++) {
                    const idx = s * 13 + rIdx;
                    if (idx < posAttr.count) {
                        vertex.fromBufferAttribute(posAttr, idx);
                        vertex.sub(pathPoint).multiplyScalar(taperScale).add(pathPoint);
                        posAttr.setXYZ(idx, vertex.x, vertex.y, vertex.z);
                    }
                }
            }
            const basePositions = geometry.attributes.position.array.slice();
            const mesh = this.createTentacleMesh(geometry, textures);
            this.tentacleGroup.add(mesh);
            this.tentacles.push({ mesh, curve, basePositions, phi, theta, baseRadius, baseThickness, rebellionFactor, coilDirection });
        }
        this.tentacleGroup.position.set(0, 400, 0);
        this.setParticleCount(this.tentacles.length);
    }

    createTentacleMesh(geometry, textures) {
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: textures.map, bumpMap: textures.bumpMap,
            bumpScale: 30.0, 
            metalness: 0.1, 
            roughness: 0.5, 
            vertexColors: true,
            emissive: 0x000000, transparent: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        return mesh;
    }

    generateFleshTextures() {
        const size = 1024; // 解像度を上げてより細かく
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = size; colorCanvas.height = size;
        const cCtx = colorCanvas.getContext('2d');
        
        // ベースを白にして、頂点カラーがそのまま映るように
        cCtx.fillStyle = '#ffffff'; 
        cCtx.fillRect(0, 0, size, size);
        
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size; bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        bCtx.fillStyle = '#808080'; bCtx.fillRect(0, 0, size, size);
        
        for (let i = 0; i < 5000; i++) {
            const x = Math.random() * size; const y = Math.random() * size;
            const r = 0.5 + Math.random() * 1.0; const val = Math.random() * 40;
            bCtx.fillStyle = `rgb(${val}, ${val}, ${val})`; bCtx.beginPath(); bCtx.arc(x, y, r, 0, Math.PI * 2); bCtx.fill();
        }
        
        const map = new THREE.CanvasTexture(colorCanvas);
        const bumpMap = new THREE.CanvasTexture(bumpCanvas);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
        return { map, bumpMap };
    }

    initPostProcessing() {
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
        }
        
        // 既存のパスをクリアして、二重に追加されるのを防ぐ（ホットリロード対策）
        const passesToRemove = this.composer.passes.filter(p => p instanceof UnrealBloomPass || (typeof BokehPass !== 'undefined' && p instanceof BokehPass));
        passesToRemove.forEach(p => this.composer.removePass(p));

        // ブルームを再設定（バランス調整：さらにほんの少しだけ落とす）
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 4, window.innerHeight / 4), 0.25, 0.2, 0.9);
        this.composer.addPass(this.bloomPass);
        
        if (this.useDOF) {
            attachDepthOfField(this, {
                focus: 1500,
                aperture: 0.00001,
                maxblur: 0.005
            });
        }
        attachPresentationOutputPass(this);
        attachFilmGrainPass(this, 0.35, false);
    }

    /**
     * カメラの位置を更新（クリーチャーを追従）
     */
    updateCamera() {
        if (this.cameraParticles[this.currentCameraIndex] && this.creatureParticle) {
            const cp = this.cameraParticles[this.currentCameraIndex];
            const cameraPos = cp.getPosition();
            
            // --- 修正: 物理更新後にも距離制限を強制適用 ---
            const dist = cameraPos.length();
            if (dist < cp.minDistance) {
                cameraPos.normalize().multiplyScalar(cp.minDistance);
            }
            
            this.camera.position.copy(cameraPos);
            
            // 注視点をクリーチャーの現在位置に設定
            this.camera.lookAt(this.creatureParticle.position.x, this.creatureParticle.position.y, this.creatureParticle.position.z);
            
            // matrixWorldNeedsUpdateをfalseにして不要な再計算を回避
            this.camera.matrixWorldNeedsUpdate = false;
        }
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;
        this.stateTimer += deltaTime;

        // RandomLFO 群の更新
        this.speedLFO.update(deltaTime);
        this.ampLFO.update(deltaTime);
        this.distortionSpeedLFO.update(deltaTime);
        this.distortionAmpLFO.update(deltaTime);
        this.colorCycleLFO.update(deltaTime);

        // LFOから動的にパラメータを取得（ベースの揺らぎ）
        const baseSpeed = this.speedLFO.getValue();
        const baseAmp = this.ampLFO.getValue();
        const baseDistortionSpeed = this.distortionSpeedLFO.getValue();
        const baseDistortionAmp = this.distortionAmpLFO.getValue();

        if (this.stateTimer >= this.stateDuration) {
            this.stateTimer = 0;
            this.creatureState = Math.floor(Math.random() * 4);
            this.stateDuration = 10.0 + Math.random() * 15.0; 
            if (this.creatureState === this.STATE_FOCUS) {
                this.focusTarget.copy(this.camera.position).add(new THREE.Vector3((Math.random()-0.5)*1500, (Math.random()-0.5)*800, (Math.random()-0.5)*1500));
            }
            
            // ステートに応じて「ターゲット倍率」を設定（直接LFOをいじらない）
            if (!this.stateMultipliers) {
                this.stateMultipliers = { speed: 1.0, amp: 1.0 };
            }
            
            switch(this.creatureState) {
                case this.STATE_IDLE: 
                    this.stateMultipliers.targetSpeed = 0.5; // 1.0 -> 0.5
                    this.stateMultipliers.targetAmp = 0.8;
                    break;
                case this.STATE_WILD: 
                    this.stateMultipliers.targetSpeed = 1.2; // 2.5 -> 1.2
                    this.stateMultipliers.targetAmp = 1.5;
                    break;
                case this.STATE_FOCUS: 
                    this.stateMultipliers.targetSpeed = 0.8; // 0.5 -> 0.8
                    this.stateMultipliers.targetAmp = 0.6;
                    break;
                case this.STATE_STASIS: 
                    this.stateMultipliers.targetSpeed = 0.2; // 0.4 -> 0.2
                    this.stateMultipliers.targetAmp = 0.3;
                    break;
            }
        }

        // 倍率を滑らかに補間
        if (!this.stateMultipliers) {
            this.stateMultipliers = { speed: 1.0, amp: 1.0, targetSpeed: 1.0, targetAmp: 1.0 };
        }
        const multiplierLerp = deltaTime * 0.3; // 非常にゆっくり変化
        this.stateMultipliers.speed += (this.stateMultipliers.targetSpeed - this.stateMultipliers.speed) * multiplierLerp;
        this.stateMultipliers.amp += (this.stateMultipliers.targetAmp - this.stateMultipliers.amp) * multiplierLerp;

        // トラック6のMIDI信号（力）を取得
        const targetTrack6Force = (this.trackEffects[6]) ? (this.trackValues[6] || 0) : 0;
        if (this.smoothTrack6Force === undefined) this.smoothTrack6Force = 0;
        // 動きの変化も少し滑らかにする（deltaTimeを使用）
        this.smoothTrack6Force += (targetTrack6Force - this.smoothTrack6Force) * deltaTime * 2.0;
        const track6Force = this.smoothTrack6Force;
        
        // トラック7のMIDI信号（色）を取得
        const targetTrack7Color = (this.trackEffects[7]) ? (this.trackValues[7] || 0) : 0;
        if (this.smoothTrack7Color === undefined) this.smoothTrack7Color = 0;
        // 【ゆっくり戻るロジック】オフにした時（targetが0）はさらに極限までゆっくり（0.3）、オンの時は少し早め（3.0）に反応
        const colorLerpSpeed = targetTrack7Color > 0 ? 3.0 : 0.3;
        this.smoothTrack7Color += (targetTrack7Color - this.smoothTrack7Color) * deltaTime * colorLerpSpeed;
        const track7Color = this.smoothTrack7Color;

        // 全トラックのレベル状態を調査（デバッグ用）
        if (Math.floor(this.time * 60) % 60 === 0) {
        }
        
        // トラック6で「時間の進み方」自体を加速させる
        // 加速をマイルドに調整（4.0 -> 1.5）
        const timeAcceleration = 1.0 + track6Force * 1.5;
        this.time += deltaTime * (timeAcceleration - 1.0); 

        // LFOの値にステート倍率を掛けて最終的なターゲット値を決定
        this.targetAnimParams.speed = baseSpeed * this.stateMultipliers.speed;
        this.targetAnimParams.waveAmp = baseAmp * this.stateMultipliers.amp;
        this.targetAnimParams.distortionSpeed = baseDistortionSpeed;
        this.targetAnimParams.distortionAmp = baseDistortionAmp;

        const lerpFactor = deltaTime * 0.5; 
        for (let key in this.currentAnimParams) { this.currentAnimParams[key] += (this.targetAnimParams[key] - this.currentAnimParams[key]) * lerpFactor; }
        
        const heartbeat = Math.pow(Math.sin(this.time * 1.0), 8.0); 
        
        // 【コアの基準サイズ変動】周期的に巨大化したり縮小したりする
        // speedLFOを直接使わず、平滑化した値を使う
        if (this.smoothSizeLFO === undefined) this.smoothSizeLFO = baseSpeed;
        this.smoothSizeLFO += (baseSpeed - this.smoothSizeLFO) * deltaTime * 0.5;
        // 巨大化をさらに抑える（0.1 -> 0.05）
        const coreBaseScale = 1.0 + Math.sin(this.time * 0.05 + this.smoothSizeLFO) * 0.05; 
        
        const scale = coreBaseScale + heartbeat * 0.03;
        this.tentacleGroup.scale.set(scale, scale, scale);

        // クリーチャーの物理更新
        this.creatureParticle.update(deltaTime);
        
        // 中心（0, 400, 0）から離れすぎないように緩やかな復元力を加える
        // カメラパーティクルの制限に近い挙動にする
        const homePos = new THREE.Vector3(0, 400, 0);
        const distToHome = this.creatureParticle.position.distanceTo(homePos);
        const maxRadius = 1500.0; // 移動可能範囲
        
        if (distToHome > maxRadius) {
            // 範囲外に出そうになったら中心へ引き戻す力を加える
            const pullStrength = (distToHome - maxRadius) * 0.1;
            const steer = homePos.clone().sub(this.creatureParticle.position).normalize().multiplyScalar(pullStrength);
            this.creatureParticle.addForce(steer);
        }
        
        // 速度が小さすぎる場合は常に弱い力を加えて動き続けるように（カメラパーティクル踏襲）
        if (this.creatureParticle.velocity.length() < 0.5) {
            const gentleForce = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar(0.2);
            this.creatureParticle.addForce(gentleForce);
        }

        this.tentacleGroup.position.set(this.creatureParticle.position.x, this.creatureParticle.position.y, this.creatureParticle.position.z);

        // --- 全てのカメラの距離制限をコアの大きさに同期させる ---
        if (this.cameraParticles) {
            this.cameraParticles.forEach(cp => {
                // ニアクリップ（カメラの最短描画距離）による「中身透け」を防ぐため、
                // 物理的な minDistance をさらに大きく取るやで。
                // コア半径 450 * スケール に、ニアクリップ分の余裕をガッツリ乗せる。
                // 500だとまだ近すぎたので、750に微調整
                const currentCoreRadius = 450 * scale;
                cp.minDistance = Math.min(currentCoreRadius + 750, 2750); 
                
                // maxDistance は StudioBox を突き抜けない 4850 固定！
                cp.maxDistance = 4850;

                // カメラのターゲットをクリーチャーの中心に固定
                if (cp.target) {
                    cp.target.copy(this.tentacleGroup.position);
                }
            });
        }

        // 移動ベクトル（速度）を取得して、触手の反作用（しなり）に利用
        const velocity = this.creatureParticle.velocity.clone();
        
        const rotationSpeed = this.creatureState === this.STATE_FOCUS ? 0.02 : 0.08;
        this.tentacleGroup.rotation.y += deltaTime * rotationSpeed;
        this.tentacleGroup.rotation.x += deltaTime * (rotationSpeed * 0.3);

        // 動きのバリエーションを制御するフェーズ
        const behaviorTime = this.time * 0.15;
        const pointingWeight = Math.max(0, Math.sin(this.time * 0.1) * 2.0 - 1.0); // 時々一点を指す
        const coilWeight = Math.max(0, Math.cos(this.time * 0.08) * 2.0 - 1.0); // 時々巻く
        const entwineWeight = Math.max(0, Math.sin(this.time * 0.05) * 1.5 - 0.5); // 絡みつき
        const upwardWeight = Math.max(0, Math.cos(this.time * 0.06) * 2.0 - 1.0); // 【追加】時々真上を向く
        
        // 【時間的変化：成長シーケンス】
        // phase 0-6 で成長、phase 7-12 で縮小消滅
        // actualTick を使ってフェーズ内を滑らかに補間
        // 1ループ 96小節 = 384 ticks * 96 = 36864 ticks
        // 12フェーズあるとすると 1フェーズ = 36864 / 12 = 3072 ticks
        const ticksPerPhase = 3072; 
        
        // OSCが来ていない場合（0の場合）は、自前の time を使ってシミュレーションする
        let smoothPhase;
        if (this.actualTick === 0 && this.phase === 0) {
            // デバッグ用：OSCがない時は60秒で1周するシミュレーション
            smoothPhase = (this.time % 60.0) / 60.0 * 12.0;
        } else {
            // 【修正】actualTick が 36864 (96小節) でループすることを考慮する
            // 1ループ = 36864 ticks
            const totalTicks = 36864;
            const currentTick = this.actualTick % totalTicks;
            smoothPhase = (currentTick / totalTicks) * 12.0;
        }
        
        let globalGrowthProgress = 0;
        if (smoothPhase <= 6) {
            // phase 0-6: 0.0 -> 1.0 (phase 6 の開始時点で 1.0 になるように)
            globalGrowthProgress = Math.min(1.0, smoothPhase / 6.0);
        } else if (smoothPhase <= 8) {
            // phase 6-8: 1.0 を維持
            globalGrowthProgress = 1.0;
        } else {
            // phase 8-12: 1.0 -> 0.0
            // smoothPhase が 12 を超えても、ここで 0 以下になるようにクランプ
            globalGrowthProgress = Math.max(0, 1.0 - (smoothPhase - 8) / 4.0);
        }

        // 触手1本あたりの成長幅（重なりを持たせて滑らかにする）
        const growthOverlap = 50.0; 
        
        // 全体の進捗を触手本数にマッピング
        const totalGrowthSteps = this.tentacleCount + growthOverlap;
        const currentGrowthStep = globalGrowthProgress * totalGrowthSteps;
        
        // 共通のターゲットポイント（一点を指し示す用）
        const commonTarget = new THREE.Vector3(
            Math.sin(this.time * 0.3) * 1000,
            Math.cos(this.time * 0.2) * 800,
            Math.sin(this.time * 0.4) * 1000
        );
        
        // 【ベースカラーの刷新】常に白をベースにする
        const skinColor = new THREE.Color(1, 1, 1);
        
        // トラック7の強度（track7Color）に応じて、白からグレーへ遷移（オプションとして残す）
        const baseCycle = this.colorCycleLFO.getValue(); 
        const grayVal = 0.2 + (baseCycle * 0.7); 
        const targetSkinColor = new THREE.Color(grayVal, grayVal, grayVal);
        
        // デフォルトは真っ白、track7Colorが上がった時だけグレーが混ざるように
        skinColor.lerp(targetSkinColor, track7Color * 0.5);

        const { speed, waveFreq, waveAmp, focusWeight, moveSpeed, distortionSpeed, distortionAmp } = this.currentAnimParams;
        
        const totalForce = 1.0 + track6Force * 2.0; // 加速をマイルドに（3.0 -> 2.0）

        // 【標高ベースのヒートマップロジック】地球儀のようにノイズの高さで多段階に色を変える
        const getElevationHeatColor = (vPos, baseColor, time, region = 0, u = 0) => {
            // 3次元ノイズで「標高（Elevation）」を計算
            const noiseScale = 0.003; 
            const elevation1 = (
                Math.sin(vPos.x * noiseScale + time * 0.25) * 
                Math.cos(vPos.y * noiseScale + time * 0.35) * 
                Math.sin(vPos.z * noiseScale + time * 0.2)
            );
            const elevation2 = (
                Math.sin(vPos.x * noiseScale * 1.5 - time * 0.4) * 
                Math.cos(vPos.y * noiseScale * 1.5 + time * 0.5)
            ) * 0.4;
            const elevation3 = (
                Math.sin(vPos.z * noiseScale * 2.0 + time * 0.8)
            ) * 0.2;

            const totalElevation = (elevation1 + elevation2 + elevation3) * 0.5 + 0.5; 
            
            const steps = 64.0;
            const steppedElevation = Math.floor(totalElevation * steps) / steps;
            
            const colorShiftSpeed = 0.2; 
            // トラック7の信号で色相のオフセットを変化させる
            const baseHueOffset = (this.time * colorShiftSpeed + track7Color * 2.0) % 1.0;
            
            // 【色相の刷新】緑系を完全に排除し、青・紫系にトーンを寄せる
            // ただし、先端（region === 2）は全系統の色を奔放に許可する
            let hue;
            if (region > 1.5) { // 先端（Tip）
                // 先端は全系統の色を許可（baseHueOffsetをフルに活用）
                hue = (baseHueOffset + steppedElevation * 0.1) % 1.0;
            } else {
                // 寒色系：0.55（青）〜 0.85（紫）の範囲
                hue = 0.55 + ((baseHueOffset + steppedElevation * 0.2) % 1.0) * 0.3;
                
                if (region > 0.5) { // 先端の少し下（Sub-tip）
                    hue = (hue + 0.05) % 1.0;
                }
                
                // 胴体部分のガード（緑〜黄色の範囲 0.15 〜 0.55 を避ける）
                if (hue > 0.15 && hue < 0.55) {
                    hue = 0.65; // 綺麗な青に強制
                }
            }
            
            const targetColor = this.tempTargetColor;
            
            // 【白と黒の導入】
            // steppedElevation や region に応じて、彩度を落として白や黒を混ぜる
            let saturation = region > 0 ? 0.8 : (0.4 + steppedElevation * 0.4);
            let lightness = Math.sin(steppedElevation * Math.PI * 8.0) * 0.2 + 0.4;

            // 標高が極端に高い場所は「白」、低い場所は「黒」に近づける
            if (steppedElevation > 0.9) {
                lightness = 0.9; // 白
                saturation = 0.1;
            } else if (steppedElevation < 0.1) {
                lightness = 0.1; // 黒
                saturation = 0.1;
            }

            targetColor.setHSL(hue, saturation, lightness);
            
            // 【トラック7連動】ブレンド率を track7Color に連動させる
            // 信号が 0 の時はヒートマップが消えて baseColor（白）だけになる
            const blendFactor = (0.15 + steppedElevation * 0.8) * track7Color;
            const finalColor = this.tempColor.copy(baseColor).lerp(targetColor, blendFactor);

            // レーザースキャン発光（蛍光灯のような強い発光感を演出）
            this.scans.forEach(scan => {
                const dist = Math.abs(u - scan.progress);
                const width = 0.06; // 少し幅を広げて存在感を出す
                if (dist < width) {
                    const glow = Math.pow(1.0 - dist / width, 2.0) * scan.intensity;
                    const scanCol = this.scanColor.setHSL(scan.hue, 0.9, 0.7);
                    
                    // 標高に合わせて少し明滅させる
                    const noiseGlow = glow * (0.6 + steppedElevation * 0.4);
                    
                    // 蛍光灯のような「芯」の白さを出すために、中心部は白く飛ばす
                    // 【修正】白くなりすぎないように、芯の強さを少し抑える (3.0 -> 1.5)
                    const coreGlow = Math.pow(Math.max(0, 1.0 - dist / (width * 0.3)), 3.0) * scan.intensity;
                    
                    // 体色とのブレンドを強める
                    finalColor.lerp(scanCol, noiseGlow * 1.5);
                    
                    // 加算合成的な強い発光（1.0を超えるHDR値）を加えてブルームを誘発させる
                    // 【修正】白飛びを抑えるために、色成分（scanCol）をベースに発光させる
                    const emissiveBoost = noiseGlow * 1.2;
                    finalColor.r += scanCol.r * emissiveBoost + coreGlow * 1.0;
                    finalColor.g += scanCol.g * emissiveBoost + coreGlow * 1.0;
                    finalColor.b += scanCol.b * emissiveBoost + coreGlow * 1.0;
                }
            });

            // スキャン以外の部分はクランプするが、スキャン部分は1.0を超えて光らせる
            // ただし極端な白飛びを防ぐために上限は少し高めの 3.0 に設定
            finalColor.r = Math.min(3.0, finalColor.r);
            finalColor.g = Math.min(3.0, finalColor.g);
            finalColor.b = Math.min(3.0, finalColor.b);
            
            return finalColor;
        };

        if (this.coreMesh && this.coreMesh.geometry.attributes.color) {
            this.coreMesh.rotation.y += deltaTime * 0.05;
            const corePosAttr = this.coreMesh.geometry.attributes.position;
            const coreColorAttr = this.coreMesh.geometry.attributes.color;
            const initialPos = this.coreMesh.geometry.userData.initialPositions;
            const v = this.tempVPos;
            const { distortionSpeed, distortionAmp } = this.currentAnimParams; 
            
            for (let i = 0; i < corePosAttr.count; i++) {
                v.set(initialPos[i * 3], initialPos[i * 3 + 1], initialPos[i * 3 + 2]);
                
                const rx = v.x; const ry = v.y; const rz = v.z;
                const lowFreqNoise = (Math.sin(rx * 0.002 + this.time * distortionSpeed * 0.3) * Math.cos(ry * 0.002 + this.time * distortionSpeed * 0.4) * Math.sin(rx * 0.002 + this.time * distortionSpeed * 0.2));
                const midFreqNoise = (Math.sin(rx * 0.01 + this.time * distortionSpeed) + Math.cos(ry * 0.01 + this.time * distortionSpeed * 0.8) + Math.sin(rx * 0.01 + this.time * distortionSpeed * 1.1)) * 0.3;
                const noiseVal = lowFreqNoise + midFreqNoise;
                
                v.multiplyScalar(1.0 + noiseVal * distortionAmp); 
                corePosAttr.setXYZ(i, v.x, v.y, v.z);

                // 多段階標高ヒートマップ（コア）
                const finalColor = getElevationHeatColor(v, skinColor, this.time, 0, 0);
                coreColorAttr.setXYZ(i, finalColor.r, finalColor.g, finalColor.b);
            }
            
            corePosAttr.needsUpdate = true; coreColorAttr.needsUpdate = true; this.coreMesh.geometry.computeVertexNormals();
        }

        // レーザースキャンの進行度を更新
        this.scans.forEach(scan => {
            scan.progress += deltaTime * scan.speed;
        });
        // 画面外に出たスキャンを削除
        this.scans = this.scans.filter(scan => scan.progress <= 1.2);
        
        this.tentacles.forEach((t, i) => {
            const posAttr = t.mesh.geometry.attributes.position;
            const colorAttr = t.mesh.geometry.attributes.color;
            if (!posAttr || !colorAttr) return;

            // 群れを外れる個体かどうか
            const isRebel = t.rebellionFactor > 0.5;

            // 【触手の配置・集合ロジックの刷新】
            const gatheringCycle = Math.sin(this.time * 0.1) * 0.5 + 0.5; 
            const noiseTime = this.time * 0.05;
            const noiseScale = 1.0 + (1.0 - gatheringCycle) * 2.0; 
            
            let currentPhi = t.phi * noiseScale + Math.sin(noiseTime + i * 0.1) * 0.2;
            let currentTheta = t.theta * noiseScale + Math.cos(noiseTime + i * 0.1) * 0.2;

            // 反抗的な個体は集合に従わない
            if (isRebel) {
                currentPhi = t.phi + Math.sin(this.time * 0.2 + i) * 0.5;
                currentTheta = t.theta + Math.cos(this.time * 0.2 + i) * 0.5;
            }

            const individualSpeed = speed * (0.5 + Math.sin(this.time * 0.05 + i * 0.5) * 1.5);
            const individualAmp = waveAmp * (0.3 + Math.cos(this.time * 0.03 + i * 0.8) * 0.7);

            const individualRotationX = Math.sin(this.time * 0.1 + i) * 0.1;
            const individualRotationY = Math.cos(this.time * 0.15 + i * 1.5) * 0.1;
            
            t.mesh.rotation.set(currentTheta + individualRotationX - t.theta, currentPhi + individualRotationY - t.phi, 0);
            
            const focusVec = new THREE.Vector3();
            if (focusWeight > 0) { 
                focusVec.copy(this.focusTarget).sub(this.tentacleGroup.position).applyQuaternion(this.tentacleGroup.quaternion.clone().invert()).normalize(); 
            }
            
            // 1. ノイズによる長さ計算（さらにスローダウンして滑らかに）
            // サイン波の合成をシンプルにして、カクつきの原因となる急激な変化を排除
            const lengthNoiseBase = Math.sin(t.phi * 1.5 + this.time * 0.03);
            
            // 【滑らかさの向上】LFOの値を直接使わず、lerpで平滑化して急変を抑える
            const targetMaxLFO = baseSpeed; 
            if (this.smoothMaxLFO === undefined) this.smoothMaxLFO = targetMaxLFO;
            this.smoothMaxLFO += (targetMaxLFO - this.smoothMaxLFO) * deltaTime * 0.5; 
            
            // 【初期値の徹底固定】ベースを 0.1 にし、最大長を LFO で揺らす
            // currentMaxScale が 0.5 + 0.08 * 6.0 = 0.98 くらいやと、dynamicLengthBase は最大 1.08 程度
            // もっとダイナミックに伸ばしたいなら、ここをガツンと上げるやで！
            const currentMaxScale = 1.0 + this.smoothMaxLFO * 12.0; 
            
            const rawNoise = lengthNoiseBase * 0.5 + 0.5; // 0.0 〜 1.0
            // 5次式の Smoothstep (Smootherstep) で極限まで滑らかに
            const smoothNoise = rawNoise * rawNoise * rawNoise * (rawNoise * (rawNoise * 6 - 15) + 10);
            const dynamicLengthBase = 0.2 + smoothNoise * currentMaxScale;

            // 【時間的変化：個別の成長（1本ずつ、かつシームレスに）】
            // 1. 線形な進捗を計算
            let rawGrowth = Math.max(0, Math.min(1.0, (currentGrowthStep - i) / growthOverlap));
            
            // 2. Smootherstep (5次式) で極限まで滑らかに生えるようにする
            // これで「パッ」と出る感じをなくして「ヌルッ」と生やす
            const individualGrowth = rawGrowth * rawGrowth * rawGrowth * (rawGrowth * (rawGrowth * 6 - 15) + 10);
            
            const dynamicLength = dynamicLengthBase * individualGrowth;

            // メッシュのスケールは確実に 1.0 に固定
            t.mesh.scale.set(1.0, 1.0, 1.0);
            
            // 成長していない触手は非表示にして計算をスキップ
            if (individualGrowth <= 0.001) {
                t.mesh.visible = false;
                return;
            }
            t.mesh.visible = true;

            for (let s = 0; s <= 64; s++) {
                const u = s / 64; 
                const time = this.time * individualSpeed * totalForce; 
                
                const wavePhase = u * waveFreq + i * 2.0;
                const propagation = u * 4.0; 
                const currentAmp = individualAmp * totalForce;

                // 1. 基本のしなり（根本から大きく、かつ複雑にうねる）
                // 複数の周波数を合成して「ムチ」のような不規則なしなりを作る
                const bendFreq = 0.3 * totalForce;
                const wave1 = Math.sin(time * bendFreq + u * 1.5 + i);
                const wave2 = Math.sin(time * bendFreq * 2.1 + u * 3.0 + i * 0.5) * 0.5;
                const wave3 = Math.sin(time * bendFreq * 4.5 + u * 6.0 + i * 1.2) * 0.2;
                
                let offsetX = (wave1 + wave2 + wave3) * currentAmp * u * 2.0;
                let offsetY = (Math.cos(time * bendFreq * 0.8 + u * 1.8 + i * 1.5) + wave2) * currentAmp * u * 2.0;
                let offsetZ = (Math.sin(time * bendFreq * 1.2 + u * 2.2 + i * 0.5) + wave3) * currentAmp * u * 2.0;

                // 2. 内巻き・外巻き（螺旋運動をよりダイナミックに）
                // トラック6の力で巻き込みを強くする
                const coilEffect = (coilWeight + track6Force * 0.5) * (isRebel ? 0.3 : 1.0);
                const coilRadius = u * 300.0 * coilEffect;
                const coilAngle = time * 2.0 * t.coilDirection + u * 15.0;
                offsetX += Math.cos(coilAngle) * coilRadius;
                offsetY += Math.sin(coilAngle) * coilRadius;

                // 3. 絡みつき（共通のノイズフィールドをより有機的に）
                const entwineEffect = (entwineWeight + track6Force * 0.3) * (isRebel ? 0.1 : 1.0);
                const noiseFieldX = Math.sin(this.time * 0.15 + u * 4.0 + Math.sin(this.time * 0.1)) * 400.0;
                const noiseFieldY = Math.cos(this.time * 0.15 + u * 4.0 + Math.cos(this.time * 0.1)) * 400.0;
                offsetX = offsetX * (1.0 - entwineEffect) + noiseFieldX * entwineEffect * u;
                offsetY = offsetY * (1.0 - entwineEffect) + noiseFieldY * entwineEffect * u;

                // 4. 一点を指し示す（共通ターゲットへの指向性）
                const pointEffect = pointingWeight * (isRebel ? 0.2 : 1.0);
                const targetDir = commonTarget.clone().normalize();
                offsetX = offsetX * (1.0 - pointEffect) + targetDir.x * u * 800.0 * pointEffect;
                offsetY = offsetY * (1.0 - pointEffect) + targetDir.y * u * 800.0 * pointEffect;
                offsetZ = offsetZ * (1.0 - pointEffect) + targetDir.z * u * 800.0 * pointEffect;

                // 5. 全触手がねじれながら真上を向く
                const upwardEffect = upwardWeight * (isRebel ? 0.3 : 1.0);
                const twistAngle = time * 4.0 + u * 20.0;
                const twistRadius = u * 100.0 * upwardEffect;
                offsetX = offsetX * (1.0 - upwardEffect) + Math.sin(twistAngle) * twistRadius;
                offsetY = offsetY * (1.0 - upwardEffect) + (u * 1200.0) * upwardEffect; // 真上（Y軸正方向）
                offsetZ = offsetZ * (1.0 - upwardEffect) + Math.cos(twistAngle) * twistRadius;

                // 6. 移動ベクトルとは逆方向へのしなり（生物学的整合性）
                // 30%の確率で「従わない」触手を作る
                const followMovement = t.rebellionFactor < 0.7;
                if (followMovement) {
                    // 速度ベクトルの逆方向にオフセットを加える
                    // u（先端への距離）が大きいほど強くしなる
                    const dragStrength = u * 0.8; 
                    offsetX -= velocity.x * dragStrength;
                    offsetY -= velocity.y * dragStrength;
                    offsetZ -= velocity.z * dragStrength;
                }

                // 先端の巻き（既存の味付け）
                const curlIntensity = Math.pow(u, 2.5) * 150.0 * totalForce; 
                const curlAngle = time * 2.0 + u * 10.0;
                offsetX += Math.sin(curlAngle) * curlIntensity;
                offsetY += Math.cos(curlAngle) * curlIntensity;

                if (focusWeight > 0) {
                    const focusStrength = u * 250.0 * focusWeight;
                    offsetX = offsetX * (1.0 - focusWeight * 0.5) + focusVec.x * focusStrength;
                    offsetY = offsetY * (1.0 - focusWeight * 0.5) + focusVec.y * focusStrength;
                    offsetZ = offsetZ * (1.0 - focusWeight * 0.5) + focusVec.z * focusStrength;
                }
                const intensity = Math.pow(u, 1.1);
                
                // 触手の色計算：多段階標高ヒートマップ
                // 触手の各頂点の空間座標（vPos）を使って標高色を計算
                const vPos = new THREE.Vector3(offsetX, offsetY, offsetZ);
                // u（先端への距離）を使って、先端ほど「別の色」になるようにリージョンを分ける
                let colorRegion = 0; // 根本〜中間
                if (u > 0.85) colorRegion = 2; // 先端15%
                else if (u > 0.6) colorRegion = 1; // その下の25%
                
                const color = getElevationHeatColor(vPos, skinColor, this.time, colorRegion, u);
                
                for (let rIdx = 0; rIdx <= 12; rIdx++) {
                    const idx = s * 13 + rIdx;
                    if (idx < posAttr.count) {
                        const bx = t.basePositions[idx * 3 + 0]; const by = t.basePositions[idx * 3 + 1]; const bz = t.basePositions[idx * 3 + 2];
                        // 頂点座標全体に dynamicLength を掛けて、根本から伸縮させる
                        posAttr.setXYZ(idx, 
                            (bx + offsetX * intensity) * dynamicLength, 
                            (by + offsetY * intensity) * dynamicLength, 
                            (bz + offsetZ * intensity) * dynamicLength
                        );
                        colorAttr.setXYZ(idx, color.r, color.g, color.b);
                    }
                }
            }

            posAttr.needsUpdate = true; colorAttr.needsUpdate = true; t.mesh.geometry.computeVertexNormals();
        });
        
        // オートフォーカス
        if (this.useDOF && this.bokehPass) {
            this.updateAutoFocus(this.tentacleGroup.children);
        }
    }

    dispose() {
        this.initialized = false;
        if (this.studio) this.studio.dispose();
        disposeStudioRoomEnvironmentMap(this._roomEnvPresentation, this.scene);
        this._roomEnvPresentation = null;
        this.pmremGenerator = null;
        this._roomEnvTexture = null;

        // 触手のメッシュを確実に破棄
        this.tentacles.forEach(t => { 
            if (t.mesh) {
                this.tentacleGroup.remove(t.mesh);
                if (t.mesh.geometry) t.mesh.geometry.dispose(); 
                if (t.mesh.material) t.mesh.material.dispose(); 
            }
        });
        this.tentacles = []; 
        
        // コアメッシュを確実に破棄
        if (this.coreMesh) {
            this.tentacleGroup.remove(this.coreMesh);
            if (this.coreMesh.geometry) this.coreMesh.geometry.dispose();
            if (this.coreMesh.material) this.coreMesh.material.dispose();
            this.coreMesh = null;
        }
        
        this.scene.remove(this.tentacleGroup);
        if (this.bloomPass) { if (this.composer) { const idx = this.bloomPass && this.composer.passes.indexOf(this.bloomPass); if (idx !== -1) this.composer.passes.splice(idx, 1); } this.bloomPass.enabled = false; }
        disposePresentationOutputPass(this);
        super.dispose();
    }
}
