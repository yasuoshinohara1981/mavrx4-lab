/**
 * Scene02Particle: Scene02専用のパーティクルクラス
 */

import { Particle } from '../../lib/Particle.js';
import * as THREE from 'three';

export class Scene02Particle extends Particle {
    constructor(initialX = 0, initialY = 0, initialZ = 0, radius = 10, scale = null) {
        super(initialX, initialY, initialZ);
        this.radius = radius;
        this.scale = scale || new THREE.Vector3(radius, radius, radius);
        
        // 【追加】個体差（パーソナリティ）パラメータ
        // 同じ目標位置に向かっても「固まらない」ようにするためのオフセット
        // 球状の分布（Spherical Distribution）に変更して、引力モードでの四角い固まりを解消
        const tOffsetTheta = Math.random() * Math.PI * 2;
        const tOffsetPhi = Math.acos(2 * Math.random() - 1);
        const tOffsetR = Math.pow(Math.random(), 0.5) * 250; // 分布半径
        this.targetOffset = new THREE.Vector3(
            tOffsetR * Math.sin(tOffsetPhi) * Math.cos(tOffsetTheta),
            tOffsetR * Math.sin(tOffsetPhi) * Math.sin(tOffsetTheta),
            tOffsetR * Math.cos(tOffsetPhi)
        );
        
        this.radiusOffset = 0.8 + Math.random() * 0.4; 
        this.phaseOffset = Math.random() * Math.PI * 2; 
        
        // 螺旋モード用：上昇速度のノイズ（0.5 〜 1.5倍）
        this.spiralSpeedFactor = 0.5 + Math.random() * 1.0;
        
        // 螺旋モードでの担当高度を固定（0.0 〜 1.0）
        this.spiralHeightFactor = Math.random();
        
        // 【追加】はみ出し（Stray）設定
        // 15%の確率で「はみ出し粒子」にする（25% -> 15%に少し抑える）
        this.isStray = Math.random() < 0.15;
        if (this.isStray) {
            // はみ出し粒子はオフセットを巨大にし、動きを鈍くする
            // 螺旋やトーラスの「外側」に漂うように半径方向のオフセットを調整
            this.strayFactor = 0.1 + Math.random() * 0.3; // 引力への抵抗力を少し弱めて、離れすぎないように調整
            this.strayRadiusOffset = 1.2 + Math.random() * 1.5; // 半径に対する倍率を少し抑える（1.5~3.5 -> 1.2~2.7）
            this.scale.multiplyScalar(0.4 + Math.random() * 0.4); // 少しだけ大きくして「欠片」としての存在感を出す
        } else {
            this.strayFactor = 1.0;
            this.strayRadiusOffset = 1.0;
        }
        
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

        // 物理パラメータの微調整（爆発的な動きに対応できるよう大幅に強化）
        this.maxSpeed = 30.0; // 200.0 -> 30.0 大幅に下げて落ち着かせる
        this.maxForce = 2.0;  // 500.0 -> 2.0  引力が強すぎたのを修正
        this.friction = 0.05; // 0.02 -> 0.05  摩擦を少し強めてブレーキを効かせる
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
