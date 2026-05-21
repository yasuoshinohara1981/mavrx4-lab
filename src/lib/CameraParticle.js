/**
 * CameraParticle Class
 * カメラを動かすためのパーティクル
 * Particleクラスを継承
 */

import { Particle } from './Particle.js';
import * as THREE from 'three';

export class CameraParticle extends Particle {
    constructor() {
        super();
        
        // 物理パラメータ
        this.maxSpeed = 8.0;
        this.maxForce = 2.0;
        this.friction = 0.0001;  // 摩擦を減らして動き続けるように
        
        // 距離パラメータ
        this.maxDistance = 1500.0;
        this.minDistance = 400.0;
        this.maxDistanceReset = 1000.0;
        
        // 立方体の境界（nullの場合は球体の制限を使用）
        this.boxMin = null;
        this.boxMax = null;
        this.minY = -Infinity; // Y座標の下限
        this.bounceDamping = 0.8;
        
        // 回転
        this.rotationX = (Math.random() - 0.5) * Math.PI * 2;
        this.rotationY = (Math.random() - 0.5) * Math.PI * 2;
        
        // 移動と回転の有効化フラグ（カメラランダマイズがオフの時にfalseにする）
        this.enableMovement = true;
        
        // 初期位置を設定
        this.initializePosition();
    }
    
    /**
     * プリセットに基づいたカメラの性格付け（新しいスタンダード）
     */
    applyPreset(presetName, options = {}) {
        // デフォルト設定
        this.minDistance = 400;
        this.maxDistance = 2000;
        this.boxMin = null;
        this.boxMax = null;
        this.maxSpeed = 8.0;
        this.friction = 0.0001;

        switch (presetName) {
            case 'LOOK_UP': // 低い位置から見上げる
                this.position.set((Math.random()-0.5)*1000, -400, (Math.random()-0.5)*1000);
                this.velocity.set(0, 5, 0);
                break;
            case 'SKY_HIGH': // 高い位置から見下ろす
                this.position.set((Math.random()-0.5)*1500, 3000, (Math.random()-0.5)*1500);
                this.velocity.set(0, -2, 0);
                break;
            case 'WIDE_VIEW': // 遠くから俯瞰
                const angle = Math.random() * Math.PI * 2;
                const dist = options.distance || 3000;
                this.position.set(Math.cos(angle) * dist, 1000, Math.sin(angle) * dist);
                this.minDistance = dist * 0.5;
                this.maxDistance = dist * 1.5;
                break;
            case 'FRONT_SIDE': // 正面または真横
                if (Math.random() > 0.5) {
                    this.position.set((Math.random()-0.5)*2000, 500, options.z || 1500);
                } else {
                    this.position.set(options.x || 3000, 500, (Math.random()-0.5)*1000);
                }
                break;
            case 'DRONE_SURFACE': // 水面スレスレを高速移動
                this.position.set((Math.random()-0.5)*3000, options.y || -300, (Math.random()-0.5)*3000);
                this.maxSpeed = 15.0;
                break;
            case 'CORE_JET': // 中心またはジェット先端
                if (Math.random() > 0.5) {
                    this.position.set((Math.random()-0.5)*200, 200, (Math.random()-0.5)*200);
                } else {
                    this.position.set((Math.random()-0.5)*500, options.height || 4000, (Math.random()-0.5)*500);
                }
                break;
            case 'PILLAR_WALK': // 障害物の間を縫う
                // 柱モードの時は少しカメラを離して全体を見やすく調整
                this.position.set((Math.random()-0.5)*2000, (Math.random()-0.5)*1500 + 800, (Math.random()-0.5)*2000);
                this.maxSpeed = 10.0; // 少し速度を落として重厚感を出す
                this.minDistance = 1000;
                this.maxDistance = 4000;
                break;
            case 'CHAOTIC': // 激しい動き
                this.applyRandomForce();
                this.velocity.multiplyScalar(5.0);
                this.maxSpeed = 30.0;
                break;
            default:
                this.applyRandomForce();
                break;
        }
    }

    /**
     * 初期位置を設定
     */
    initializePosition() {
        if (this.boxMin && this.boxMax) {
            // 立方体の境界がある場合
            this.position.set(
                this.boxMin.x + Math.random() * (this.boxMax.x - this.boxMin.x),
                this.boxMin.y + Math.random() * (this.boxMax.y - this.boxMin.y),
                this.boxMin.z + Math.random() * (this.boxMax.z - this.boxMin.z)
            );
        } else {
            // 球面上のランダムな位置に配置
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const distance = this.minDistance + Math.random() * (this.maxDistanceReset - this.minDistance);
            
            this.position.set(
                Math.cos(angle1) * Math.sin(angle2) * distance,
                Math.sin(angle1) * Math.sin(angle2) * distance,
                Math.cos(angle2) * distance
            );
        }
    }
    
    /**
     * 更新処理
     */
    update() {
        // 基底クラスの更新処理を呼ぶ
        super.update();
        
        // 立方体の境界がある場合は、立方体の境界で制限
        if (this.boxMin && this.boxMax) {
            this.checkBoundingBox();
        } else {
            // 球体の制限を使用
            if (this.position.length() > this.maxDistance) {
                this.position.normalize();
                this.position.multiplyScalar(this.maxDistance);
            }
        }

        // Y座標の下限を適用
        if (this.position.y < this.minY) {
            this.position.y = this.minY;
            if (this.velocity.y < 0) {
                this.velocity.y *= -this.bounceDamping; // 地面で跳ね返る
            }
        }
        
        // 移動が有効な場合のみ、gentleForceと回転を更新
        if (this.enableMovement) {
            // 速度が小さすぎる場合は常に弱い力を加えて動き続けるように（Processingと同じ）
            if (this.velocity.length() < 0.5) {
                // ProcessingのPVector.random3D()と同じ（ランダムな方向の単位ベクトル）
                const gentleForce = new THREE.Vector3(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2
                ).normalize().multiplyScalar(0.3);
                this.force.add(gentleForce);
            }
            
            // 回転も少し動かす（Processingと同じ）
            this.rotationX += this.velocity.y * 0.01;
            this.rotationY += this.velocity.x * 0.01;
        } else {
            // 移動が無効な場合は、velocityを減衰させて静止させる
            this.velocity.multiplyScalar(0.95);
            this.force.set(0, 0, 0);
        }
    }
    
    /**
     * 立方体の境界をチェックして反発
     */
    checkBoundingBox() {
        // X方向の境界チェック
        if (this.position.x < this.boxMin.x) {
            this.position.x = this.boxMin.x;
            this.velocity.x *= -this.bounceDamping;
        } else if (this.position.x > this.boxMax.x) {
            this.position.x = this.boxMax.x;
            this.velocity.x *= -this.bounceDamping;
        }
        
        // Y方向の境界チェック
        if (this.position.y < this.boxMin.y) {
            this.position.y = this.boxMin.y;
            this.velocity.y *= -this.bounceDamping;
        } else if (this.position.y > this.boxMax.y) {
            this.position.y = this.boxMax.y;
            this.velocity.y *= -this.bounceDamping;
        }
        
        // Z方向の境界チェック
        if (this.position.z < this.boxMin.z) {
            this.position.z = this.boxMin.z;
            this.velocity.z *= -this.bounceDamping;
        } else if (this.position.z > this.boxMax.z) {
            this.position.z = this.boxMax.z;
            this.velocity.z *= -this.bounceDamping;
        }
    }
    
    /**
     * ランダムな力を加える（突き飛ばす）
     */
    applyRandomForce() {
        const action = Math.random();
        
        if (action < 0.2) {
            // 20%の確率で球体の中心に向かう
            const toCenter = new THREE.Vector3(0, 0, 0).sub(this.position);
            if (toCenter.length() > 0) {
                toCenter.normalize();
                const strength = 1.5 + Math.random() * 1.5;
                this.force.copy(toCenter.multiplyScalar(strength));
            }
        } else if (action < 0.4) {
            // 20%の確率で遠くに移動（急に遠くへ）
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 3.0 + Math.random() * 3.0;
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        } else if (action < 0.7) {
            // 30%の確率でランダムな方向に急に動く
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 2.0 + Math.random() * 2.5;
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        } else {
            // 30%の確率で通常のランダムな方向
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 1.0 + Math.random() * 1.5;
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        }
        
        // 回転もランダムに変更
        this.rotationX += (Math.random() - 0.5) * 0.4;
        this.rotationY += (Math.random() - 0.5) * 0.4;
    }
    
    /**
     * リセット
     */
    reset() {
        this.initializePosition();
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.force.set(0, 0, 0);
        this.rotationX = (Math.random() - 0.5) * Math.PI * 2;
        this.rotationY = (Math.random() - 0.5) * Math.PI * 2;
    }
    
    /**
     * 回転を取得
     */
    getRotationX() {
        return this.rotationX;
    }
    
    getRotationY() {
        return this.rotationY;
    }
}

