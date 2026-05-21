/**
 * Particle Class
 * パーティクルの基底クラス（共通機能を実装）
 */

import * as THREE from 'three';

export class Particle {
    constructor(initialX = 0, initialY = 0, initialZ = 0) {
        this.position = new THREE.Vector3(initialX, initialY, initialZ);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.acceleration = new THREE.Vector3(0, 0, 0);
        this.force = new THREE.Vector3(0, 0, 0);
        
        // 物理パラメータ
        this.maxSpeed = 5.0;
        this.maxForce = 0.5;
        this.friction = 0.02;
        this.mass = 1.0;
    }
    
    /**
     * 更新処理（ProcessingのLibParticleと同じ順序）
     */
    update() {
        // 力を制限（Processingと同じ：force.limit(maxForce)）
        if (this.force.length() > this.maxForce) {
            this.force.normalize();
            this.force.multiplyScalar(this.maxForce);
        }
        
        // 力を加速度に変換（Processingと同じ：acceleration = force）
        this.acceleration.copy(this.force);
        
        // 加速度から速度を更新（Processingと同じ：velocity.add(acceleration)）
        this.velocity.add(this.acceleration);
        
        // 速度を制限（Processingと同じ：velocity.limit(maxSpeed)）
        if (this.velocity.length() > this.maxSpeed) {
            this.velocity.normalize();
            this.velocity.multiplyScalar(this.maxSpeed);
        }
        
        // 速度から位置を更新（Processingと同じ：position.add(velocity)）
        this.position.add(this.velocity);
        
        // 摩擦を適用（Processingと同じ：velocity.mult(1.0 - friction)）
        this.velocity.multiplyScalar(1.0 - this.friction);
        
        // 力をリセット（Processingと同じ：force.mult(0)）
        this.force.multiplyScalar(0);
    }
    
    /**
     * 力を追加
     */
    addForce(force) {
        this.force.add(force);
    }
    
    /**
     * 位置を取得
     */
    getPosition() {
        return this.position;
    }
    
    /**
     * 速度を取得
     */
    getVelocity() {
        return this.velocity;
    }
    
    /**
     * リセット
     */
    reset() {
        this.position.set(0, 0, 0);
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.force.set(0, 0, 0);
    }
}

