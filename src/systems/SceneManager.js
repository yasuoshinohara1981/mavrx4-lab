/**
 * シーンマネージャー
 * 複数のシーンを管理し、切り替えを制御
 */

import { SceneBase } from '../scenes/SceneBase.js';
import { Scene01 } from '../scenes/scene01/Scene01.js';
import { Scene02 } from '../scenes/scene02/Scene02.js';
import { Scene03 } from '../scenes/scene03/Scene03.js';
import { Scene04 } from '../scenes/scene04/Scene04.js';
import { Scene05 } from '../scenes/scene05/Scene05.js';
import { Scene06 } from '../scenes/scene06/Scene06.js';
import { Scene07 } from '../scenes/scene07/Scene07.js';
import { Scene08 } from '../scenes/scene08/Scene08.js';
import { Scene09 } from '../scenes/scene09/Scene09.js';
import { Scene10 } from '../scenes/scene10/Scene10.js';
import { Scene11 } from '../scenes/scene11/Scene11.js';
import { Scene12 } from '../scenes/scene12/Scene12.js';
import { Scene13 } from '../scenes/scene13/Scene13.js';
import { Scene14 } from '../scenes/scene14/Scene14.js';

/** 登録シーン数 */
export const SCENE_COUNT = 14;
/** シーンバンク数（[] で切替。1バンク=10スロット） */
export const SCENE_BANK_COUNT = 2;
/** 最大シーンスロット番号（0 始まりインデックスの上限） */
export const MAX_SCENE_SLOTS = SCENE_BANK_COUNT * 10;

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
                scene = new Scene01(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 1:
                scene = new Scene02(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 2:
                scene = new Scene03(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 3:
                scene = new Scene04(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 4:
                scene = new Scene05(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 5:
                scene = new Scene06(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 6:
                scene = new Scene07(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 7:
                scene = new Scene08(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 8:
                scene = new Scene09(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 9:
                scene = new Scene10(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 10:
                scene = new Scene11(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 11:
                scene = new Scene12(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 12:
                scene = new Scene13(this.renderer, this.camera, this.sharedResourceManager);
                break;
            case 13:
                scene = new Scene14(this.renderer, this.camera, this.sharedResourceManager);
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
            this.scenes.push(new Scene01(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene02(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene03(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene04(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene05(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene06(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene07(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene08(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene09(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene10(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene11(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene12(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene13(this.renderer, this.camera, this.sharedResourceManager));
            this.scenes.push(new Scene14(this.renderer, this.camera, this.sharedResourceManager));

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
