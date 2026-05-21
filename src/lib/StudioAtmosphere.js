import * as THREE from 'three';
import { AtmosphericDustField } from './presentation/index.js';

/**
 * StudioAtmosphere: スタジオ内の大気エフェクト（浮遊チリ、空気ノイズボリューム）を管理する共通クラス
 */
export class StudioAtmosphere {
    /**
     * @param {THREE.Scene} scene
     * @param {object} options
     * @param {number} [options.roomHalfW=5000]
     * @param {number} [options.roomHalfD=5000]
     * @param {number} [options.floorTopY=-498]
     * @param {number} [options.ceilingY=5500]
     * @param {number} [options.particleCount=2000]
     * @param {number} [options.particleLifetimeMs=11000]
     * @param {number} [options.particleFadeOutMs=1400]
     * @param {number} [options.minLivingBurst=180]
     * @param {number} [options.airNoiseDensity=0.036]
     * @param {THREE.Color} [options.airNoiseColor=new THREE.Color(0xffffff)]
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.roomHalfW = options.roomHalfW ?? 5000;
        this.roomHalfD = options.roomHalfD ?? 5000;
        this.floorTopY = options.floorTopY ?? -498;
        this.ceilingY = options.ceilingY ?? 5500;

        // チリパーティクル
        this.ambientDust = new AtmosphericDustField(scene, {
            roomHalfW: this.roomHalfW,
            roomHalfD: this.roomHalfD,
            floorTopY: this.floorTopY,
            ceilingY: this.ceilingY,
            count: options.particleCount ?? 2000,
            lifetimeMs: options.particleLifetimeMs ?? 11000,
            fadeOutMs: options.particleFadeOutMs ?? 1400,
            minLivingBurst: options.minLivingBurst ?? 180
        });

        // 空気ノイズボリューム
        this.airNoiseVolume = null;
        this.airNoiseMaterial = null;
        this.setupAirNoiseVolume(options.airNoiseDensity ?? 0.036, options.airNoiseColor ?? new THREE.Color(0xffffff));
    }

    /**
     * 空気ノイズボリューム（フォグのような質感）の構築
     */
    setupAirNoiseVolume(density, color) {
        const volumeGeo = new THREE.BoxGeometry(this.roomHalfW * 2.6, this.ceilingY * 1.3, this.roomHalfD * 2.6);
        this.airNoiseMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uDensity: { value: density },
                uColor: { value: color }
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
                    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
                }

                float fbm(vec3 p) {
                    float a = 0.5; float s = 0.0;
                    for (int i = 0; i < 4; i++) { s += a * noise3(p); p = p * 2.03 + vec3(17.1, 3.7, 11.9); a *= 0.5; }
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
     * 毎フレームの更新
     * @param {number} deltaTime
     * @param {number} time
     * @param {THREE.Vector3} [focusPos] チリのスポーン中心（未指定時はデフォルト位置）
     */
    update(deltaTime, time, focusPos = null) {
        if (this.ambientDust) {
            this.ambientDust.update(deltaTime, time);
            const minLiving = this.ambientDust.options?.minLivingBurst ?? 180;
            if (this.ambientDust.livingCount < minLiving) {
                const p = focusPos ?? new THREE.Vector3(0, this.floorTopY + 600, 0);
                this.ambientDust.spawnBurst(p, minLiving - this.ambientDust.livingCount);
            }
        }
        if (this.airNoiseMaterial?.uniforms?.uTime) {
            this.airNoiseMaterial.uniforms.uTime.value = time;
        }
    }

    dispose() {
        if (this.ambientDust) {
            this.ambientDust.dispose();
            this.ambientDust = null;
        }
        if (this.airNoiseVolume) {
            this.scene.remove(this.airNoiseVolume);
            if (this.airNoiseVolume.geometry) this.airNoiseVolume.geometry.dispose();
            this.airNoiseVolume = null;
        }
        if (this.airNoiseMaterial) {
            this.airNoiseMaterial.dispose();
            this.airNoiseMaterial = null;
        }
    }
}
