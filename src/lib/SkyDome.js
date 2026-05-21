/**
 * SkyDome: HDRIスカイドームの共通クラス
 * シーンにHDRIを環境マップ・背景として適用する
 * 
 * 2026/03/03 更新: 背景専用のシーンとカメラ（2台体制）をサポート
 * これにより、背景に3Dオブジェクトを置いてもZ-Fightingやクリッピングの問題を回避できる
 */

import * as THREE from 'three';
import { loadHdrCached } from './hdrCache.js';

export class SkyDome {
    /**
     * @param {THREE.Scene} scene - メインシーン
     */
    constructor(scene) {
        this.scene = scene;
        this.envMap = null;

        // 背景専用のシーンとカメラ
        this.backgroundScene = new THREE.Scene();
        this.backgroundCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 100000);

        // 背景シーンにライトを追加（3Dオブジェクト用）
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.backgroundScene.add(ambientLight);
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        sunLight.position.set(5000, 10000, 5000);
        this.backgroundScene.add(sunLight);
    }

    /**
     * HDRIを読み込み、スカイドームを適用
     * @param {string} hdriUrl - HDRIファイルのURL
     * @param {Object} [options] - オプション
     */
    async setup(hdriUrl, options = {}) {
        if (!hdriUrl) throw new Error('SkyDome.setup: hdriUrl is required');

        const envMap = await loadHdrCached(hdriUrl);
        envMap.mapping = THREE.EquirectangularReflectionMapping;

        // メインシーンの環境マップ・背景設定
        // EffectComposer が内部バッファに描画するため、HDRI はメインシーンの background に設定する
        this.scene.environment = envMap;
        this.scene.environmentIntensity = options.environmentIntensity ?? 1.5;
        this.scene.background = envMap;

        if (options.rotation) {
            const r = options.rotation;
            const euler = new THREE.Euler(r.x ?? 0, r.y ?? 0, r.z ?? 0);
            this.scene.environmentRotation = euler;
            this.scene.backgroundRotation = euler;
        }

        if (options.fog !== false) {
            this.scene.fog = new THREE.FogExp2(
                options.fogColor ?? 0xb5d4e8,
                options.fogDensity ?? 0.00008
            );
        }

        this.envMap = envMap;
        return envMap;
    }

    /**
     * 背景シーンに3Dオブジェクトを追加する
     * @param {THREE.Object3D} object 
     */
    addToBackground(object) {
        this.backgroundScene.add(object);
    }

    /**
     * メインカメラの情報を背景カメラに同期させる
     * @param {THREE.Camera} mainCamera 
     */
    update(mainCamera) {
        // 回転だけ同期（位置は原点固定、または必要に応じて調整）
        this.backgroundCamera.quaternion.copy(mainCamera.quaternion);
        this.backgroundCamera.fov = mainCamera.fov;
        this.backgroundCamera.aspect = mainCamera.aspect;
        this.backgroundCamera.updateProjectionMatrix();
    }

    /**
     * 背景を描画する
     * @param {THREE.WebGLRenderer} renderer 
     */
    render(renderer) {
        renderer.render(this.backgroundScene, this.backgroundCamera);
    }

    /**
     * スカイドームを解除
     */
    dispose() {
        if (this.scene) {
            this.scene.environment = null;
            this.scene.background = null;
            this.scene.fog = null;
            this.scene.environmentRotation = null;
            this.scene.backgroundRotation = null;
        }
        
        // 背景シーンのクリーンアップ
        this.backgroundScene.traverse(object => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(m => m.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
        
        this.envMap = null;
    }
}
