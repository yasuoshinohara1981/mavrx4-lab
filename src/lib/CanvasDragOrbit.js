import * as THREE from 'three';

/**
 * Canvas ドラッグで視点への **加算オフセット**（毎フレームのシーンカメラに乗せる）。
 * 球の極・注視点重複・遠過ぎでのクリップを避けて真っ黒にならないよう制約する。
 */

const tmpOff = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const spherical = new THREE.Spherical();

/** 視点がこの Y より下に行きにくくする（部屋フロア付近。Scene4 が -498 級） */
const MIN_CAM_WORLD_Y = -560;
const FAR_FRAC = 0.92;

function finiteVec(v) {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** @returns {THREE.Vector3} */
function noopTarget(out) {
    return out.set(0, 400, 0);
}

/**
 * @param {HTMLCanvasElement} domElement
 * @param {THREE.PerspectiveCamera} camera
 * @param {{
 *   getTarget?: (out: THREE.Vector3) => THREE.Vector3,
 *   rotateSpeed?: number,
 *   zoomSpeed?: number,
 *   minRadial?: number,
 *   maxRadial?: number,
 *   minPolar?: number,
 *   maxPolar?: number,
 * } | undefined} [options]
 */
export function attachCanvasDragOrbit(domElement, camera, options = {}) {
    const getTarget = options.getTarget ?? noopTarget;
    const rotateSpeed = options.rotateSpeed ?? 0.005;
    const zoomSpeed = options.zoomSpeed ?? 0.0011;
    const minRadialFallback = options.minRadial ?? 95;
    const maxRadialOption = options.maxRadial ?? 42000;
    const minPolar = options.minPolar ?? 0.1;
    const maxPolarUpper = options.maxPolar ?? Math.PI - 0.1;

    const targetBuf = new THREE.Vector3();

    let userDeltaTheta = 0;
    let userDeltaPhi = 0;
    let userDeltaRadius = 0;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function ensureMinSeparationFromTarget() {
        const minSep = Math.max(minRadialFallback, (camera?.near ?? 1) * 10);
        const lenSq = tmpOff.lengthSq();
        if (lenSq < minSep * minSep * 1e-4) {
            tmpDir.set(-0.12, 0.35, 0.92).normalize();
            tmpOff.copy(tmpDir).multiplyScalar(minSep);
            return;
        }
        if (lenSq < minSep * minSep) {
            tmpDir.copy(tmpOff).normalize();
            tmpOff.copy(tmpDir).multiplyScalar(minSep);
        }
    }

    function applyAdditive() {
        const hasUserOffset =
            Math.abs(userDeltaTheta) > 1e-14 ||
            Math.abs(userDeltaPhi) > 1e-14 ||
            Math.abs(userDeltaRadius) > 1e-14;
        if (!hasUserOffset) return;

        getTarget(targetBuf);
        if (!finiteVec(targetBuf)) return;

        tmpOff.copy(camera.position).sub(targetBuf);
        ensureMinSeparationFromTarget();

        spherical.setFromVector3(tmpOff);

        spherical.theta += userDeltaTheta;
        spherical.phi += userDeltaPhi;
        spherical.radius += userDeltaRadius;

        const farCap =
            typeof camera?.far === 'number' && Number.isFinite(camera.far)
                ? Math.max(camera.far * FAR_FRAC, minRadialFallback * 2)
                : maxRadialOption;
        const rMaxEff = Math.min(maxRadialOption, farCap);

        spherical.phi = THREE.MathUtils.clamp(spherical.phi, minPolar, maxPolarUpper);
        spherical.radius = THREE.MathUtils.clamp(spherical.radius, minRadialFallback * 0.65, rMaxEff);

        // カメラを床より下に張りっぱなしにしない（φ が π 側に張り過ぎ → 視界外・ブラックになりやすい）
        const rClamped = Math.max(spherical.radius, minRadialFallback);
        const vyNeed = MIN_CAM_WORLD_Y - targetBuf.y;
        const cosPhiLim = vyNeed / rClamped;
        if (Number.isFinite(cosPhiLim) && cosPhiLim > -1.0001) {
            const phiCeil = Math.acos(THREE.MathUtils.clamp(cosPhiLim, -1, 1));
            spherical.phi = Math.min(spherical.phi, phiCeil - 0.015);
        }

        spherical.makeSafe();

        spherical.phi = THREE.MathUtils.clamp(spherical.phi, minPolar, maxPolarUpper);
        spherical.radius = THREE.MathUtils.clamp(spherical.radius, minRadialFallback * 0.65, rMaxEff);

        tmpOff.setFromSpherical(spherical);
        if (!finiteVec(tmpOff)) {
            reset();
            return;
        }

        camera.position.copy(targetBuf).add(tmpOff);
        if (!finiteVec(camera.position)) {
            reset();
            return;
        }

        tmpDir.copy(camera.position).sub(targetBuf);
        if (tmpDir.lengthSq() < minRadialFallback * minRadialFallback * 0.25) {
            tmpDir.set(-0.1, 0.25, 0.96).normalize().multiplyScalar(minRadialFallback);
            camera.position.copy(targetBuf).add(tmpDir);
        }

        camera.lookAt(targetBuf);

        if (camera.position.y < MIN_CAM_WORLD_Y + 100) {
            camera.position.y = MIN_CAM_WORLD_Y + 100;
            camera.lookAt(targetBuf);
        }
    }

    function onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        domElement.style.cursor = 'grabbing';
        try {
            domElement.setPointerCapture(e.pointerId);
        } catch {
            //
        }
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        userDeltaTheta -= dx * rotateSpeed;
        userDeltaPhi += dy * rotateSpeed;
        e.preventDefault();
    }

    function onPointerUp(e) {
        if (!dragging) return;
        dragging = false;
        domElement.style.cursor = '';
        try {
            domElement.releasePointerCapture(e.pointerId);
        } catch {
            //
        }
    }

    function onWheel(e) {
        userDeltaRadius += e.deltaY * zoomSpeed;
        userDeltaRadius = THREE.MathUtils.clamp(userDeltaRadius, -9000, 9000);
        e.preventDefault();
    }

    function reset() {
        userDeltaTheta = 0;
        userDeltaPhi = 0;
        userDeltaRadius = 0;
        dragging = false;
        domElement.style.cursor = '';
    }

    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('pointercancel', onPointerUp);
    domElement.addEventListener('lostpointercapture', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });

    function dispose() {
        domElement.removeEventListener('pointerdown', onPointerDown);
        domElement.removeEventListener('pointermove', onPointerMove);
        domElement.removeEventListener('pointerup', onPointerUp);
        domElement.removeEventListener('pointercancel', onPointerUp);
        domElement.removeEventListener('lostpointercapture', onPointerUp);
        domElement.removeEventListener('wheel', onWheel);
    }

    return {
        reset,
        dispose,
        applyIfActive: applyAdditive,
        applyAdditive
    };
}
