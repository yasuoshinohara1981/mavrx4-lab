/**
 * Scene14Particle: Scene14（ドリームコア）専用のパーティクルクラス
 *
 * Scene01Particle と同じく Particle を継承し、相互衝突判定に使う radius を持つ。
 * ふわっと漂うパステル球体向けに物理パラメータをゆるめに調整している。
 */

import { Particle } from '../../lib/Particle.js';
import * as THREE from 'three';

export class Scene14Particle extends Particle {
    constructor(initialX = 0, initialY = 0, initialZ = 0, radius = 80) {
        super(initialX, initialY, initialZ);
        this.radius = radius;

        // 回転（ゆっくり）
        this.rotation = new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        // 初期角速度ゼロ＝常時回転しない。力が加わった時だけ回る（慣性）
        this.angularVelocity = new THREE.Vector3(0, 0, 0);

        // 浮遊の個体差
        this.phaseOffset = Math.random() * Math.PI * 2;
        this.floatAmp = 6 + Math.random() * 10;
        this.floatSpeed = 0.4 + Math.random() * 0.6;

        // 無重力ふわふわ（風船）用のさまよい方向。ゆっくり向きが変わる
        this.wanderDir = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        this.wanderStrength = 0.6 + Math.random() * 0.8;

        // はぐれ者（一部は群れからゆるく外れる）
        this.isStray = Math.random() > 0.88;
        this.strayFactor = this.isStray ? 0.35 : 1.0;

        // パステル色（インスタンスカラー用に保持）
        this.baseColor = new THREE.Color();

        // 物理（現実に近い自由落下）。
        // 速度の単位は「1/60秒あたりのワールド単位」。部屋は 1000単位=1m 想定なので、
        // 部屋の高さ4800単位(4.8m)を落ちきると v=sqrt(2*9.81*4.8)=9.7m/s ≒ 162単位/フレーム。
        // maxSpeed がそれ未満だと落下が途中で頭打ちになり「ふわふわ」に見えるので余裕を持たせる
        // 4.8m を落ちきる速度（9.7m/s ≒ 162単位/コマ）に余裕を持たせる。
        // 実際の見た目の速さは Scene14 の motionScale で決まるので、ここは上限として広めに取る
        this.maxSpeed = 200.0;
        this.maxForce = 24.0;
        // 空気抵抗。0.02（＝毎フレーム2%減）は1秒で約70%も失う値で、
        // すぐ終端速度に達して「パラシュート」のような落ち方になっていた。実物の球に近い微小値にする
        this.friction = 0.0009;
    }

    /**
     * 位置・速度の積分。`step` は「60fps基準の何コマ分か」（= dt * 60）。
     * これを掛けないとフレームレートで落下の速さや空気抵抗が変わってしまう。
     * @param {number} [step=1]
     */
    update(step = 1) {
        if (this.force.length() > this.maxForce) {
            this.force.normalize().multiplyScalar(this.maxForce);
        }
        this.acceleration.copy(this.force);
        this.velocity.addScaledVector(this.acceleration, step);

        if (this.velocity.length() > this.maxSpeed) {
            this.velocity.normalize().multiplyScalar(this.maxSpeed);
        }
        this.position.addScaledVector(this.velocity, step);

        // 減衰も step 依存にする（1コマ分の係数を step 乗）
        this.velocity.multiplyScalar(Math.pow(1.0 - this.friction, step));
        this.force.set(0, 0, 0);
    }

    updateRotation(dt) {
        this.rotation.x += this.angularVelocity.x * dt * 60;
        this.rotation.y += this.angularVelocity.y * dt * 60;
        this.rotation.z += this.angularVelocity.z * dt * 60;
    }
}
