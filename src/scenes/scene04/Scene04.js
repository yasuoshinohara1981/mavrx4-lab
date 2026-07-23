/**
 * Scene04: GPU Vertex Displacement Mesh
 * 1つの巨大な球体をGPUで変形させつつ、Scene14の金属質感を継承
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LFO } from '../../lib/LFO.js';
import { RandomLFO } from '../../lib/RandomLFO.js';
import {
    StudioBox,
    attachDepthOfField,
    attachFilmGrainPass,
    applyStandardPresentationRenderer,
    attachPresentationOutputPass,
    disposePresentationOutputPass
} from '../../lib/presentation/index.js';
import { Scene04Particle } from './Scene04Particle.js';

export class Scene04 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'Xenoball';
        this.initialized = false;
        this.sceneNumber = 4;
        this.kitNo = 5;
        
        // 共有リソースマネージャー
        this.sharedResourceManager = sharedResourceManager;
        
        // レイキャスター（オートフォーカス用）
        this.raycaster = new THREE.Raycaster();
        
        // メインメッシュ
        this.mainMesh = null;
        this.material = null;
        this.fluorescentLights = [];

        // 動的環境マップ用
        this.cubeCamera = null;
        this.cubeRenderTarget = null;
        
        // ノイズパラメータとランダムLFO
        this.noiseScale = 1.0;
        this.noiseStrength = 50.0;
        this.noiseSpeed = 0.5;
        
        // 周期（スピード）を大幅に落として、変化をゆったりさせる
        this.noiseScaleLFO = new RandomLFO(0.0002, 0.001, 0.02, 0.15);
        this.noiseStrengthLFO = new RandomLFO(0.001, 0.005, 100.0, 250.0);
        
        // 圧力エフェクト管理
        this.pressurePoints = []; 
        this.pressureStrengths = []; 
        this.targetPressureStrengths = []; 
        for(let i=0; i<32; i++) {
            this.pressurePoints.push(new THREE.Vector3(0,0,0));
            this.pressureStrengths.push(0.0);
            this.targetPressureStrengths.push(0.0);
        }
        this.pressureDirections = []; 
        for(let i=0; i<32; i++) {
            this.pressureDirections.push(-1.0);
        }
        this.currentPressureIdx = 0;
        this.lastPressureTime = 0;
        this.lastPressurePoint = new THREE.Vector3(0, 1, 0);

        // 変形モード管理
        this.deformModeTransition = 0.0; 
        this.patternCount = 15; 
        this.patternTransition = new Float32Array(this.patternCount).fill(0);

        // クリオネ遊泳アニメーション管理
        this.swimTime = 0;
        this.swimPhase = 0; 
        this.swimVelocity = new THREE.Vector3();
        this.basePosition = new THREE.Vector3(0, 400, 0);
        this.targetPosition = new THREE.Vector3(0, 400, 0);
        this.swimRotation = new THREE.Euler();
        this.swimScale = new THREE.Vector3(1, 1, 1);

        // 撮影用スタジオ
        this.studio = null;
        
        // エフェクト設定
        this.useDOF = true; 
        this.useBloom = true; 
        this.useFilmGrain = true;     // フィルムグレインON
        this.showMainMesh = true; 
        this.bloomPass = null;
        this.sceneLightingScale = 0.32;
        this.outputPass = null;

        // ストロボエフェクト管理
        this.strobeActive = false;
        this.strobeEndTime = 0;

        // レーザースキャンエフェクト管理
        this.scanners = [];

        this.trackEffects = {
            1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true
        };

        this.setScreenshotText(this.title);
    }

    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.minDistance = 400;
        cameraParticle.maxDistance = 3000;
        cameraParticle.minY = -450; 
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, { 
            generateMipmaps: true, 
            minFilter: THREE.LinearMipmapLinearFilter 
        });
        this.cubeCamera = new THREE.CubeCamera(10, 10000, this.cubeRenderTarget);
        this.cubeCamera.position.set(0, 400, 0); 
        this.scene.add(this.cubeCamera);

        this.camera.position.set(0, 500, 1500);
        this.camera.lookAt(0, 200, 0);

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        applyStandardPresentationRenderer(this.renderer, this.sceneLightingScale);

        this.showGridRuler3D = false; 
        this.initGridRuler3D({
            center: { x: 0, y: 0, z: 0 },
            size: { x: 5000, y: 5000, z: 5000 },
            floorY: -498, 
            floorSize: 10000,
            floorDivisions: 100,
            labelMax: 256,
            color: 0xffffff,
            opacity: 0.8 
        });

        this.setupLights();
        this.createStudioBox();
        this.createDeformableMesh();
        this.initPostProcessing();
        this.initialized = true;
    }

    /** 環境・四隅蛍光灯は StudioBox。ここは球体用のキーのみ */
    setupLights() {
        const pureWhite = 0xffffff;
        this.sphereLight = new THREE.PointLight(0xffffff, 0, 5000);
        this.sphereLight.position.set(0, 400, 0);
        this.scene.add(this.sphereLight);

        const pointLight = new THREE.PointLight(pureWhite, 3.0, 15000);
        pointLight.decay = 1.0; 
        pointLight.position.set(0, 3000, 0); 
        this.scene.add(pointLight);
    }

    createStudioBox() {
        const L = this.sceneLightingScale ?? 1;
        this.studio = new StudioBox(this.scene, {
            size: 10000,
            color: 0xbbbbbb,
            roughness: 0.1, 
            metalness: 0.9, 
            lightColor: 0xffffff,
            lightIntensity: 2.8,
            envMap: this.cubeRenderTarget ? this.cubeRenderTarget.texture : null,
            envMapIntensity: 1.3,
            ceilingSpotRig: { enabled: true, sceneLightingScale: L }
        });
    }

    createDeformableMesh() {
        const geometry = new THREE.IcosahedronGeometry(400, 44); 
        geometry.setAttribute('aOffset', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));

        const noiseShaderChunk = `
            attribute vec3 aOffset;
            varying float vDisplacement;
        `;

        const vertexDisplacementChunk = `
            vDisplacement = length(aOffset); 
            vec3 transformed = position + aOffset;
        `;

        this.material = new THREE.MeshStandardMaterial({ 
            color: 0x222222,
            metalness: 1.0,  
            roughness: 0.1,  
            envMap: this.cubeRenderTarget ? this.cubeRenderTarget.texture : null,
            envMapIntensity: 1.5,
        });

        this.particles = [];
        const posAttr = geometry.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
            this.particles.push({
                basePosition: p.clone(),
                position: p.clone(),
                velocity: new THREE.Vector3(),
                force: new THREE.Vector3(),
                displacement: 0
            });
        }

        this.material.onBeforeCompile = (shader) => {
            shader.vertexShader = noiseShaderChunk + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', vertexDisplacementChunk);
            shader.fragmentShader = `varying float vDisplacement;\n` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `
                #include <dithering_fragment>
                float heat = smoothstep(2.0, 250.0, abs(vDisplacement));
                // クールブルー・グラデーション（濃紺 -> ロイヤルブルー -> シアン -> 白）
                vec3 heatColor;
                if (heat < 0.33) {
                    heatColor = mix(vec3(0.0, 0.05, 0.2), vec3(0.0, 0.2, 1.0), heat * 3.0); // 濃紺 -> ロイヤルブルー
                } else if (heat < 0.66) {
                    heatColor = mix(vec3(0.0, 0.2, 1.0), vec3(0.0, 1.0, 1.0), (heat - 0.33) * 3.0); // ロイヤルブルー -> シアン
                } else {
                    heatColor = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 1.0, 1.0), (heat - 0.66) * 3.0); // シアン -> 白
                }
                gl_FragColor.rgb = mix(gl_FragColor.rgb, heatColor, heat * 0.5);
                gl_FragColor.rgb += heatColor * heat * 2.0; 
                `
            );
            this.material.userData.shader = shader;
        };

        const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        depthMaterial.onBeforeCompile = (shader) => {
            shader.vertexShader = noiseShaderChunk + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', vertexDisplacementChunk);
            depthMaterial.userData.shader = shader;
        };

        this.mainMesh = new THREE.Mesh(geometry, this.material);
        this.mainMesh.customDepthMaterial = depthMaterial;
        this.mainMesh.position.y = 400;
        this.mainMesh.castShadow = true;
        this.mainMesh.receiveShadow = true;
        this.scene.add(this.mainMesh);
    }

    initPostProcessing() {
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
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
        
        const dt = Math.min(deltaTime, 0.1);
        const springK = 0.05; 
        const friction = 0.98;
        const time = this.time * 0.5;
        const offsetAttr = this.mainMesh.geometry.attributes.aOffset;
        const offsets = offsetAttr.array;

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const restoreForce = p.basePosition.clone().sub(p.position).multiplyScalar(springK);
            p.force.add(restoreForce);
            
            // 物理更新
            p.velocity.add(p.force.clone().multiplyScalar(dt));
            p.velocity.multiplyScalar(friction);
            p.position.add(p.velocity.clone().multiplyScalar(dt));
            
            const center = new THREE.Vector3(0, 0, 0);
            const distToCenter = p.position.distanceTo(center);
            const baseDistToCenter = p.basePosition.distanceTo(center);
            if (distToCenter < baseDistToCenter) {
                const normal = p.basePosition.clone().normalize();
                p.position.copy(normal.multiplyScalar(baseDistToCenter));
                p.velocity.multiplyScalar(0.5);
            }
            
            p.force.set(0, 0, 0);
            const offset = p.position.clone().sub(p.basePosition);
            offsets[i * 3] = offset.x;
            offsets[i * 3 + 1] = offset.y;
            offsets[i * 3 + 2] = offset.z;
            p.displacement = offset.length();
        }
        offsetAttr.needsUpdate = true;

        if (this.sphereLight) {
            let maxDisp = 0;
            for (let i = 0; i < this.particles.length; i += 20) { 
                maxDisp = Math.max(maxDisp, this.particles[i].displacement);
            }
            this.sphereLight.intensity = Math.min(maxDisp * 0.1, 15.0); 
            this.sphereLight.distance = 5000;
            if (maxDisp > 200) this.sphereLight.color.setHex(0xff0000);
            else if (maxDisp > 100) this.sphereLight.color.setHex(0xffaa00);
            else this.sphereLight.color.setHex(0x00ffff);
        }

        this.deformModeTransition = Math.pow(Math.sin(this.time * 0.07), 2.0); 
        const cycleSpeed = 0.15;
        for (let i = 0; i < this.patternCount; i++) {
            const offset = (i / this.patternCount) * Math.PI * 2;
            this.patternTransition[i] = Math.max(0, Math.sin(this.time * cycleSpeed + offset));
        }
        let sum = 0;
        for (let i = 0; i < this.patternCount; i++) sum += this.patternTransition[i];
        if (sum > 0) {
            for (let i = 0; i < this.patternCount; i++) this.patternTransition[i] /= sum;
        }

        if (this.cubeCamera) {
            this.cubeCamera.update(this.renderer, this.scene);
        }
        if (this.mainMesh) this.mainMesh.visible = this.showMainMesh;
        if (this.mainMesh) {
            this.mainMesh.position.set(0, 400, 0);
            this.mainMesh.scale.set(1, 1, 1);
        }
        if (this.mainMesh) {
            this.camera.lookAt(this.mainMesh.position);
        }
        if (this.strobeActive) {
            if (Date.now() > this.strobeEndTime) { this.strobeActive = false; this.backgroundWhite = false; }
            else this.backgroundWhite = Math.floor(performance.now() / 32) % 2 === 0;
        }
        if (this.noiseScaleLFO) this.noiseScaleLFO.update(deltaTime);
        if (this.noiseStrengthLFO) this.noiseStrengthLFO.update(deltaTime);
        this.noiseScale = this.noiseScaleLFO ? this.noiseScaleLFO.getValue() : 1.0;
        this.noiseStrength = this.noiseStrengthLFO ? this.noiseStrengthLFO.getValue() : 50.0;
        this.time += deltaTime * this.noiseSpeed;
        this.updateScanners(deltaTime);
        if (this.mainMesh?.geometry) this.setParticleCount(this.mainMesh.geometry.attributes.position.count);
        this.updateAutoFocus();
    }

    updateScanners(deltaTime) {
        const now = Date.now();
        for (let i = this.scanners.length - 1; i >= 0; i--) {
            const s = this.scanners[i];
            const progress = (now - s.startTime) / s.duration;
            if (progress >= 1.0) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); this.scanners.splice(i, 1); }
            else { 
                s.mesh.position.y = -500 + progress * 5000; 
                s.mesh.material.opacity = Math.pow(Math.sin(progress * Math.PI), 2.0) * 0.8; 
                const scale = 1.0 + Math.sin(progress * Math.PI) * 0.1;
                s.mesh.scale.set(scale, 1.0, scale);
            }
        }
    }

    triggerScanner(durationMs = 2000, velocity = 127) {
        const ringRadius = 500 + (velocity / 127.0) * 1000;
        const geometry = new THREE.TorusGeometry(ringRadius, 20, 16, 100); geometry.rotateX(Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 10.0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending 
        });
        const mesh = new THREE.Mesh(geometry, material); mesh.position.set(0, -500, 0); mesh.renderOrder = 100;
        this.scene.add(mesh);
        this.scanners.push({ mesh, startTime: Date.now(), duration: durationMs });
    }

    handleOSC(message) {
        if (message.trackNumber === 2) { this.handleTrackNumber(2, message); return; }
        super.handleOSC(message);
    }

    handleTrackNumber(trackNumber, message) {
        if (trackNumber === 2) {
            const args = message.args || [];
            const durationMs = (args.length >= 3) ? args[2] : 500;
            this.strobeActive = true; this.strobeEndTime = Date.now() + durationMs;
        }
        if (trackNumber === 5) {
            const args = message.args || [];
            const velocity = args[1] !== undefined ? args[1] : 127;
            const durationMs = (args.length >= 3) ? args[2] : 2000;
            this.triggerScanner(durationMs, velocity);
        }
        if (trackNumber === 6) {
            const args = message.args || [];
            const velocity = args[1] !== undefined ? args[1] : 127;
            const durationMs = (args.length >= 3) ? args[2] : 200; 
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const center = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.cos(phi),
                Math.sin(phi) * Math.sin(theta)
            ).multiplyScalar(400); 
            const forceStrength = 3000.0 * (velocity / 127.0); 
            const sharpness = 0.5 + Math.random() * 0.5;
            const radius = (100 + (durationMs / 1000.0) * 300) * sharpness; 
            this.particles.forEach(p => {
                const dist = p.basePosition.distanceTo(center);
                if (dist < radius && dist > 0) {
                    const normalizedDist = dist / radius;
                    const falloff = Math.pow(Math.cos(normalizedDist * Math.PI * 0.5), 2.0);
                    const normal = p.basePosition.clone().normalize();
                    const f = normal.multiplyScalar(forceStrength * falloff);
                    p.force.add(f);
                }
            });
        }
    }

    updateAutoFocus() {
        if (!this.useDOF || !this.bokehPass || !this.mainMesh) return;
        super.updateAutoFocus([this.mainMesh]);
    }

    render() {
        if (this.strobeActive) {
            const isWhite = Math.floor(performance.now() / 32) % 2 === 0;
            this.renderer.setClearColor(isWhite ? 0xffffff : 0x000000);
        } else {
            this.renderer.setClearColor(0x000000);
        }
        super.render();
    }

    dispose() {
        this.initialized = false;
        disposePresentationOutputPass(this);
        if (this.studio) this.studio.dispose();
        if (this.cubeRenderTarget) this.cubeRenderTarget.dispose();
        if (this.mainMesh) {
            this.scene.remove(this.mainMesh);
            this.mainMesh.geometry.dispose();
            this.mainMesh.material.dispose();
            if (this.mainMesh.customDepthMaterial) this.mainMesh.customDepthMaterial.dispose();
            this.mainMesh = null;
        }
        this.fluorescentLights = [];
        this.scanners.forEach(s => { 
            this.scene.remove(s.mesh); 
            s.mesh.geometry.dispose(); 
            s.mesh.material.dispose(); 
        });
        this.scanners = [];
        super.dispose();
    }
}
