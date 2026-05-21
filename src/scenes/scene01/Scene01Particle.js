/**
 * Scene01Particle: Scene01専用のパーティクルクラス
 */

import { Particle } from '../../lib/Particle.js';
import * as THREE from 'three';

export class Scene01Particle extends Particle {
    constructor(initialX = 0, initialY = 0, initialZ = 0, radius = 10) {
        super(initialX, initialY, initialZ);
        this.radius = radius;
        
        // 回転パラメータ
        this.rotation = new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        this.angularVelocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.01, // 0.1から大幅に遅く
            (Math.random() - 0.5) * 0.01,
            (Math.random() - 0.5) * 0.01
        );

        // デザインされた動きのためのパラメータ
        this.targetOffset = new THREE.Vector3(
            (Math.random() - 0.5) * 1000,
            (Math.random() - 0.5) * 1000,
            (Math.random() - 0.5) * 1000
        );
        this.phaseOffset = Math.random() * Math.PI * 2;
        this.radiusOffset = 0.5 + Math.random() * 1.5;
        
        // はみ出し（Stray）設定：一部の粒子を群れから外れさせる
        this.isStray = Math.random() > 0.9; // 10%ははぐれ者
        this.strayFactor = this.isStray ? 0.1 : 1.0; // 引力への抵抗力
        this.strayRadiusOffset = this.isStray ? (1.5 + Math.random() * 2.0) : 1.0;

        // 螺旋モード用の高度係数
        this.spiralHeightFactor = Math.random();

        // 物理パラメータの微調整
        this.maxSpeed = 200.0;
        this.maxForce = 500.0;
        this.friction = 0.02;
    }

    /**
     * 回転の更新
     */
    updateRotation(dt) {
        this.rotation.x += this.angularVelocity.x * dt * 60;
        this.rotation.y += this.angularVelocity.y * dt * 60;
        this.rotation.z += this.angularVelocity.z * dt * 60;
    }
}
