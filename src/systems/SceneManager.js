/**
 * シーンマネージャー
 * 複数のシーンを管理し、切り替えを制御
 */

import { SceneBase } from '../scenes/SceneBase.js';
import { Scene1 } from '../scenes/scene01/Scene1.js';
import { Scene2 } from '../scenes/scene02/Scene2.js';
import { Scene3 } from '../scenes/scene03/Scene3.js';
import { Scene4 } from '../scenes/scene04/Scene4.js';

/** 登録シーン数 */
export const SCENE_COUNT = 4;
/** シーンバンク数（UI 互換：[] でバンク切替。実質シーンは 2 のみ） */
export const SCENE_BANK_COUNT = 1;
/** 最大シーンスロット番号（0 始まりインデックスの上限） */
export const MAX_SCENE_SLOTS = SCENE_COUNT;

export class SceneManager {
    constructor(renderer, camera, sharedResourceManager = null, options = {}) {
        this.renderer = renderer;
        this.camera = camera;
        this.sharedResourceManager = sharedResourceManager;
        this.scenes = [];
        this.currentSceneIndex = 0;
        this.onSceneChange = null;

        this.isDevelopmentMode = options.isDevelopmentMode || false;

        this.defaultSceneIndex = options.defaultSceneIndex !== undefined ? options.defaultSceneIndex : 0;

        this.globalShowHUD = true;
        this.globalHudPositionMode = 0;

        this.selectedKitNo = 0;

        this.sceneBankIndex = 0;

        this.initScenes();
    }

    createScene(index) {
        if (this.scenes[index]) {
            return this.scenes[index];
        }

        let scene = null;
        switch (index) {
            case 0:
                scene = new Scene1(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 1:
                scene = new Scene2(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 2:
                scene = new Scene3(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 3:
                scene = new Scene4(this.renderer, this.camera, this.sharedResourceManager);
                break;
            default:
                console.warn(`無効なシーンインデックス: ${index}`);
                return null;
        }

        if (scene) {
            this.scenes[index] = scene;
        }

        return scene;
    }

    initScenes() {
        if (this.isDevelopmentMode) {
            this.createScene(this.defaultSceneIndex);
            this.currentSceneIndex = this.defaultSceneIndex;
        } else {
            this.scenes.push(new Scene1(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene2(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene3(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene4(this.renderer, this.camera, this.sharedResourceManager));

            this.currentSceneIndex = this.defaultSceneIndex;
            this.sceneBankIndex = Math.floor(this.currentSceneIndex / 10);
        }

        if (this.scenes[this.currentSceneIndex]) {
            this.scenes[this.currentSceneIndex].sceneIndex = this.currentSceneIndex;
            this.sceneBankIndex = Math.floor(this.currentSceneIndex / 10);
            this.scenes[this.currentSceneIndex].sceneBankIndex = this.sceneBankIndex;
            this.scenes[this.currentSceneIndex].totalSceneCount = this.scenes.length;
            this.scenes[this.currentSceneIndex].maxSceneSlots = MAX_SCENE_SLOTS;
            this.scenes[this.currentSceneIndex].setup().catch((err) => {
                console.error('シーンのセットアップエラー:', err);
            });
        }
    }

    switchScene(index) {
        if (index < 0 || index >= MAX_SCENE_SLOTS) {
            console.warn(`シーンインデックス ${index} は 0〜${MAX_SCENE_SLOTS - 1} の範囲外です`);
            return;
        }
        if (!this.scenes[index]) {
            if (this.isDevelopmentMode) {
                this.createScene(index);
            } else {
                console.warn(`シーンインデックス ${index} は無効です`);
                return;
            }
        }

        if (index < 0 || !this.scenes[index]) {
            console.warn(`シーンインデックス ${index} は無効です`);
            return;
        }

        if (index === this.currentSceneIndex && this.scenes[index]) {
            return;
        }

        try {
            if (this.scenes[this.currentSceneIndex]) {
                const oldScene = this.scenes[this.currentSceneIndex];

                if (oldScene.cleanupSceneSpecificElements) {
                    oldScene.cleanupSceneSpecificElements();
                } else if (oldScene.dispose) {
                    oldScene.dispose();
                }

                if (oldScene.setResourceActive) {
                    oldScene.setResourceActive(false);
                }
            }
        } catch (err) {
            console.error('シーン切り替え時のクリーンアップエラー:', err);
        }

        this.currentSceneIndex = index;
        this.sceneBankIndex = Math.floor(index / 10);
        const newScene = this.scenes[this.currentSceneIndex];

        if (newScene) {
            newScene.sceneIndex = index;
            newScene.sceneBankIndex = this.sceneBankIndex;
            newScene.totalSceneCount = this.scenes.length;
            newScene.maxSceneSlots = MAX_SCENE_SLOTS;

            newScene.showHUD = this.globalShowHUD;
            newScene.hudPositionMode = this.globalHudPositionMode;

            if (newScene.setResourceActive) {
                newScene.setResourceActive(true);
            }

            requestAnimationFrame(() => {
                newScene
                    .setup()
                    .catch((err) => {
                        console.error('シーンのセットアップエラー:', err);
                    })
                    .then(() => {
                        newScene.showHUD = this.globalShowHUD;
                        newScene.hudPositionMode = this.globalHudPositionMode;

                        if (this.onSceneChange) {
                            this.onSceneChange(newScene.title || `Scene ${index + 1}`);
                        }
                    })
                    .catch((err) => {
                        console.error('シーン切り替えエラー:', err);
                    });
            });
        }
    }

    update(deltaTime) {
        const scene = this.scenes[this.currentSceneIndex];
        if (scene) {
            scene.update(deltaTime);
        }
    }

    render() {
        const scene = this.scenes[this.currentSceneIndex];
        if (scene) {
            scene.render();
        }
    }

    handleOSC(message) {
        if (message.address === '/kit/' || message.address === '/kit') {
            const args = message.args || [];
            if (args.length > 0) {
                const kitValue = typeof args[0] === 'number' ? args[0] : parseFloat(args[0]);
                if (!isNaN(kitValue)) {
                    const kitNo = Math.floor(kitValue);
                    this.selectedKitNo = kitNo;
                    this.switchSceneByKitNo(kitNo);
                }
            }
            return;
        }

        const scene = this.scenes[this.currentSceneIndex];
        if (scene) {
            scene.handleOSC(message);
        }
    }

    switchSceneByKitNo(kitNo) {
        for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            if (scene && scene.kitNo === kitNo) {
                this.switchScene(i);
                return;
            }
        }

        console.warn(`[SceneManager] Scene with kitNo ${kitNo} not found`);
    }

    onResize() {
        const scene = this.scenes[this.currentSceneIndex];
        if (scene && scene.onResize) {
            scene.onResize();
        }
    }

    getCurrentScene() {
        return this.scenes[this.currentSceneIndex] || null;
    }

    getMaxSceneBankIndex() {
        return SCENE_BANK_COUNT - 1;
    }
}
