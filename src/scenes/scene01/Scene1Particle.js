/**
 * Scene1Particle: Scene1（ケーブルブロブ等）用パーティクル
 */

import { Particle } from '../../lib/Particle.js';
import * as THREE from 'three';

export class Scene1Particle extends Particle {
    constructor(initialX = 0, initialY = 0, initialZ = 0, radius = 10, scale = null, typeIndex = 0, indexInType = 0) {
        super(initialX, initialY, initialZ);
        this.radius = radius;
        this.scale = scale || new THREE.Vector3(radius, radius, radius);
        this.typeIndex = typeIndex;
        this.indexInType = indexInType;

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

        this.spiralHeightFactor = Math.random();

        this.isStray = Math.random() < 0.05;
        if (this.isStray) {
            this.strayFactor = 0.05 + Math.random() * 0.1;
            this.strayRadiusOffset = 1.1 + Math.random() * 0.4;
            this.scale.multiplyScalar(1.5 + Math.random() * 1.0);
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

        this.maxSpeed = 200.0;
        this.maxForce = 500.0;
        this.friction = 0.02;
    }

    updateRotation(dt) {
        this.rotation.x += this.angularVelocity.x * dt * 60;
        this.rotation.y += this.angularVelocity.y * dt * 60;
        this.rotation.z += this.angularVelocity.z * dt * 60;
    }
}
