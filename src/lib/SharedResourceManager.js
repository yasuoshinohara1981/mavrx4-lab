/**
 * SharedResourceManager
 * GPUパーティクル、CPUパーティクル、GPUインスタンシングなどの
 * 重いリソースを最初に初期化して共有するマネージャー
 * 
 * 目的：
 * - シーン切り替え時のラグをなくす
 * - 初期化に時間がかかっても問題ない（最初に一度だけ初期化）
 * - 使わないシーンではdisposeせず、update/レンダリングから処理を外す
 */

import { GPUParticleSystem } from './GPUParticleSystem.js';

export class SharedResourceManager {
    constructor(renderer) {
        this.renderer = renderer;
        
        /** GPU パーティクルプール（現行シーンは未使用。必要ならシーン名キーを追加） */
        this.gpuParticlePools = {};
        
        // CPUパーティクルのプール（必要に応じて追加）
        this.cpuParticlePools = {};
        
        // GPUインスタンシングのプール（必要に応じて追加）
        this.instancedMeshPools = {};
        
        // 初期化フラグ
        this.isInitialized = false;
        this.initPromise = null;
        
        // 使用中のリソースを追跡（シーン名 -> リソースID）
        this.activeResources = new Map();
    }
    
    /**
     * 初期化（最大量のリソースを事前に作成）
     */
    async init() {
        if (this.isInitialized) {
            return;
        }
const startTime = performance.now();
        
        // GPUパーティクルシステムのプールを初期化
        for (const [sceneName, config] of Object.entries(this.gpuParticlePools)) {
            const initOptions = { ...config.initOptions };
            if (sceneName === 'scene04' && !initOptions.terrainNoiseSeed) {
                initOptions.terrainNoiseSeed = Math.random() * 10000.0;
            }
            const gpuParticleSystem = new GPUParticleSystem(
                this.renderer,
                config.maxParticles,
                config.cols,
                config.rows,
                config.baseRadius,
                config.shaderPath,
                config.particleSize,
                config.placementType,
                initOptions
            );
            
            // 初期化完了を待つ（GPUParticleSystemのinitializeParticleData()も含まれる）
            await gpuParticleSystem.initPromise;
            
            // シーン固有の初期化処理（初期位置データの計算など）は、シーン側で行う
            // ここではGPUParticleSystemの基本初期化のみを行う
            // シーン側では、setup()内でgetGPUParticleSystem()取得後に初期化処理を実行する
            
            // プールに追加
            config.pool.push(gpuParticleSystem);
}
        
        const endTime = performance.now();
        
        this.isInitialized = true;
    }
    
    /**
     * GPUパーティクルシステムを取得（シーン名で指定）
     * 既に使用中の場合は新しいインスタンスを作成（必要に応じて）
     */
    getGPUParticleSystem(sceneName) {
        if (!this.isInitialized) {
            throw new Error('SharedResourceManagerが初期化されていません。init()を先に呼んでください。');
        }
        
        const config = this.gpuParticlePools[sceneName];
        if (!config) {
            throw new Error(`シーン ${sceneName} のGPUパーティクル設定が見つかりません`);
        }
        
        // プールから未使用のインスタンスを探す
        // 現在は1つだけ保持するが、将来的に複数対応可能
        if (config.pool.length > 0) {
            const system = config.pool[0];
            
            // 使用中としてマーク
            this.activeResources.set(sceneName, system);
            
            return system;
        }
        
        // プールが空の場合は新規作成（通常は発生しない）
        console.warn(`[SharedResourceManager] ${sceneName}のプールが空です。新規作成します。`);
        const initOptions = config.initOptions || {};
        // シーン固有の初期化処理は、シーン側で行う（initOptionsは設定のみ）
        const newSystem = new GPUParticleSystem(
            this.renderer,
            config.maxParticles,
            config.cols,
            config.rows,
            config.baseRadius,
            config.shaderPath,
            config.particleSize,
            config.placementType,
            initOptions
        );
        config.pool.push(newSystem);
        this.activeResources.set(sceneName, newSystem);
        
        return newSystem;
    }
    
    /**
     * GPUパーティクルシステムを返却（使用終了時）
     * 実際にはdisposeせず、プールに戻すだけ
     */
    releaseGPUParticleSystem(sceneName) {
        // 使用中フラグを解除（実際にはdisposeしない）
        this.activeResources.delete(sceneName);
}
    
    /**
     * リソースの有効/無効を切り替え（update/レンダリングのスキップ制御）
     */
    setResourceActive(sceneName, active) {
        const resource = this.activeResources.get(sceneName);
        if (resource) {
            // リソースにactiveフラグを設定（各リソースクラスで実装が必要）
            if (resource.setActive) {
                resource.setActive(active);
            }
        }
    }

    /**
     * 全リソースをクリーンアップ（アプリ終了時のみ）
     */
    dispose() {
// 全GPUパーティクルシステムを破棄
        for (const [sceneName, config] of Object.entries(this.gpuParticlePools)) {
            for (const system of config.pool) {
                if (system.dispose) {
                    system.dispose();
                }
            }
            config.pool = [];
        }
        
        this.activeResources.clear();
        this.isInitialized = false;
}
}
