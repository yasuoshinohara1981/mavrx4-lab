/**
 * PlayerParticle Class
 * シーンの「主人公」となる注視点パーティクル
 */

import { Particle } from './Particle.js';
import * as THREE from 'three';

export class PlayerParticle extends Particle {
    constructor(x = 0, y = 0, z = 0) {
        super(x, y, z);
        
        this.maxSpeed = 0.3;    // 0.8 → 0.3（さらに大幅に減速、超スロー散歩）
        this.maxForce = 0.02;   // 0.05 → 0.02
        this.friction = 0.1;    // 0.05 → 0.1（さらに摩擦を増やしてピタッと止まるように）
        
        // 移動範囲の制限（極限まで地面に近づける）
        this.boxMin = new THREE.Vector3(-10000, 1.0, -10000); // 最低1.0m（ほぼ足元）
        this.boxMax = new THREE.Vector3(10000, 3.0, 10000);   // 最高3.0m（目線の高さ）
        
        // ノイズ用パラメータ
        this.noiseTime = Math.random() * 1000;
        
        // 目標地点
        this.target = new THREE.Vector3();
        this.updateTarget();
    }
    
    updateTarget() {
        if (this.boxMin && this.boxMax) {
            // 制限範囲（建物があるエリア）の中でターゲットを決める
            this.target.set(
                this.boxMin.x + Math.random() * (this.boxMax.x - this.boxMin.x),
                this.boxMin.y + Math.random() * (this.boxMax.y - this.boxMin.y),
                this.boxMin.z + Math.random() * (this.boxMax.z - this.boxMin.z)
            );
        } else {
            this.target.set(
                (Math.random() - 0.5) * 5000,
                1.0 + Math.random() * 2.0, // 1m〜3mの間
                (Math.random() - 0.5) * 5000
            );
        }
    }
    
    update() {
        // 1. 基本のSeek挙動（ターゲットに向かう）
        const desired = new THREE.Vector3().subVectors(this.target, this.position);
        const dist = desired.length();
        
        if (dist < 300) {
            this.updateTarget();
        }
        
        desired.normalize().multiplyScalar(this.maxSpeed);
        const steer = new THREE.Vector3().subVectors(desired, this.velocity);
        
        // 2. ノイズによる揺らぎ（巡回感）
        this.noiseTime += 0.005;
        // 大きなうねり（ゆったりとした進路変更）
        const largeNoiseX = Math.sin(this.noiseTime * 0.5) * 0.2;
        const largeNoiseZ = Math.cos(this.noiseTime * 0.3) * 0.2;
        // 小さな揺らぎ（細かな進路変更）
        const smallNoiseX = Math.sin(this.noiseTime * 2.1) * 0.05;
        const smallNoiseZ = Math.cos(this.noiseTime * 1.8) * 0.05;
        
        const noiseForce = new THREE.Vector3(
            largeNoiseX + smallNoiseX,
            0,
            largeNoiseZ + smallNoiseZ
        );
        
        // 力を合成
        steer.add(noiseForce);
        
        if (steer.length() > this.maxForce) {
            steer.normalize().multiplyScalar(this.maxForce);
        }
        this.addForce(steer);
        
        super.update();
        
        // 境界チェック（反発）
        if (this.position.x < this.boxMin.x || this.position.x > this.boxMax.x) this.velocity.x *= -1;
        if (this.position.y < this.boxMin.y || this.position.y > this.boxMax.y) this.velocity.y *= -1;
        if (this.position.z < this.boxMin.z || this.position.z > this.boxMax.z) this.velocity.z *= -1;
    }
    
    // 進んでいる方向（注視点用）を取得
    getLookAtTarget() {
        // 現在位置から速度方向に少し進んだ点を返す
        const lookAt = this.position.clone();
        if (this.velocity.length() > 0.01) {
            lookAt.add(this.velocity.clone().normalize().multiplyScalar(100));
        } else {
            lookAt.z += 100; // 止まっている時は前方を向く
        }
        return lookAt;
    }
}
