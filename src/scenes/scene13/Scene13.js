/**
 * Scene13: mathym | (未実装)
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from 'three';

export class Scene13 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Scene13';
        this.initialized = false;
        this.sceneNumber = 13;
        this.kitNo = 5;
        this.sharedResourceManager = sharedResourceManager;
    }

    async setup() {
        if (this.initialized) return;
        await super.setup();

        this.scene.background = new THREE.Color(0x000000);

        this.initialized = true;
    }

    onUpdate(deltaTime) {
        if (!this.initialized) return;
        this.time += deltaTime;
    }

    dispose() {
        this.initialized = false;
        super.dispose();
    }
}
