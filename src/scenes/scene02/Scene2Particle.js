/**
 * Scene2Particle: Scene2（エメラルド風インスタンス立方体群）用パーティクル
 */

import { Particle } from '../../lib/Particle.js';
import * as THREE from 'three';

export class Scene2Particle extends Particle {
    constructor(initialX = 0, initialY = 0, initialZ = 0, radius = 10, scale = null) {
        super(initialX, initialY, initialZ);
        this.radius = radius;
        this.scale = scale || new THREE.Vector3(radius, radius, radius);

        const tOffsetTheta = Math.random() * Math.PI * 2;
        const tOffsetPhi = Math.acos(2 * Math.random() - 1);
        const tOffsetR = Math.pow(Math.random(), 0.5) * 250;
        this.targetOffset = new THREE.Vector3(
            tOffsetR * Math.sin(tOffsetPhi) * Math.cos(tOffsetTheta),
            tOffsetR * Math.sin(tOffsetPhi) * Math.sin(tOffsetTheta),
            tOffsetR * Math.cos(tOffsetPhi)
        );

        this.radiusOffset = 0.8 + Math.random() * 0.4;
        this.phaseOffset = Math.random() * Math.PI * 2;

        this.spiralSpeedFactor = 0.5 + Math.random() * 1.0;
        this.spiralHeightFactor = Math.random();

        this.isStray = Math.random() < 0.15;
        if (this.isStray) {
            this.strayFactor = 0.1 + Math.random() * 0.3;
            this.strayRadiusOffset = 1.2 + Math.random() * 1.5;
            this.scale.multiplyScalar(0.4 + Math.random() * 0.4);
        } else {
            this.strayFactor = 1.0;
            this.strayRadiusOffset = 1.0;
        }

        this.rotation = new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        this.angularVelocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.01,
            (Math.random() - 0.5) * 0.01,
            (Math.random() - 0.5) * 0.01
        );

        this.maxSpeed = 30.0;
        this.maxForce = 2.0;
        this.friction = 0.05;

        /** サブステップ内で観測した力の最大（update 前、clamp 前の長さ） */
        this.frameForceMax = 0;
        /** ヒートマップ表示用にスムーズした 0〜1 */
        this.heatVisual = 0;
    }

    updateRotation(dt) {
        this.rotation.x += this.angularVelocity.x * dt * 60;
        this.rotation.y += this.angularVelocity.y * dt * 60;
        this.rotation.z += this.angularVelocity.z * dt * 60;
    }
}
