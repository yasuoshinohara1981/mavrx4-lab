import * as THREE from 'three';

/**
 * Scene2 カメラ・モーション関連のロジック
 */

/**
 * パーティクルの中心座標（平滑化）の計算
 */
export function smoothCenterFromParticles(scene, dt) {
    const n = Math.min(scene.currentVisibleCount || 0, scene.particles.length);
    if (n <= 0) return;
    scene._tmpV.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
        scene._tmpV.add(scene.particles[i].position);
    }
    scene._tmpV.multiplyScalar(1 / n);
    const a = 1 - Math.exp(-Math.min(dt, 0.1) * 2.8);
    scene._centerSmoothed.lerp(scene._tmpV, a);
}

/**
 * カメラ位置と向きの更新
 */
export function updateCamera(scene) {
    if (scene.trackEffects[1] && scene.cameraParticles[scene.currentCameraIndex]) {
        const cp = scene.cameraParticles[scene.currentCameraIndex];
        scene.camera.position.copy(cp.getPosition());
        scene.camera.lookAt(scene._centerSmoothed.x, scene._centerSmoothed.y, scene._centerSmoothed.z);
        scene.camera.matrixWorldNeedsUpdate = false;
        return;
    }
    scene.camera.lookAt(scene._centerSmoothed.x, scene._centerSmoothed.y, scene._centerSmoothed.z);
    scene.camera.matrixWorldNeedsUpdate = false;
}

/**
 * モードに応じたカメラプリセットの適用
 */
export function applyCameraModeForMovement(scene) {
    const cp = scene.cameraParticles[scene.currentCameraIndex];
    if (!cp) return;
    const mode = scene.currentMode;
    switch (mode) {
        case scene.MODE_DRIFT_FIELD:
            cp.applyPreset('DEFAULT');
            break;
        case scene.MODE_UPTHRUST:
            cp.applyPreset('LOOK_UP');
            break;
        case scene.MODE_HELIX_RAIL:
            cp.applyPreset('SKY_HIGH');
            break;
        case scene.MODE_LEMNISCATE:
            cp.applyPreset('WIDE_VIEW', { distance: 2900 });
            break;
        case scene.MODE_HONEYCOMB:
            cp.applyPreset('FRONT_SIDE', { z: 1600, x: 3100 });
            break;
        case scene.MODE_BEAT_INTERFERENCE:
            cp.applyPreset('DRONE_SURFACE', { y: -280 });
            break;
        case scene.MODE_BINARY_ROTATE:
            cp.applyPreset('WIDE_VIEW', { distance: 3200 });
            break;
        case scene.MODE_DNA_HELIX:
            cp.applyPreset('PILLAR_WALK');
            break;
        case scene.MODE_TOROIDAL_VORTEX:
            cp.applyPreset('CHAOTIC');
            break;
        case scene.MODE_TRIPLE_WELL:
            cp.applyPreset('WIDE_VIEW', { distance: 2100 });
            break;
        case scene.MODE_PRECESS_ORBIT:
            cp.applyPreset('WIDE_VIEW', { distance: 2750 });
            break;
        default:
            cp.applyPreset('DEFAULT');
            break;
    }
}
