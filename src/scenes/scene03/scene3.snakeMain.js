/**
 * Scene3 メイン：ノードガーデン（近接 Sphere 同士を黄色シリンダーで接続）＋カールで動くスポーン中心
 */

import * as THREE from 'three';
import { generateFleshVeinTextures } from '../../lib/FleshVeinTextures.js';
import { fadeOpacity01, attachInstanceOpacityAttribute } from '../scene01/scene1.helpers.js';
import { curlNoiseWorld } from './scene3.curlNoise.js';
import { generateLinkTubeWornTextures } from './scene3.linkTubeTextures.js';

const SPHERE_COUNT = 700; // 1000から700に減らして軽量化や！🚀
const SPHERE_RADIUS_TO_WORLD = 0.138;
const SPHERE_SPAWN_JIT = { x: 170, y: 130, z: 170 };

/** 中心間距離がこれ未満なら接続（小さいほど線が減る） */
const LINK_DISTANCE = 265;
const LINK_DISTANCE_SQ = LINK_DISTANCE * LINK_DISTANCE;
const LINK_GRID_CELL = LINK_DISTANCE;
const MAX_LINKS = 10000;
/** シリンダー半径 ≒ 両端 Sphere の平均ワールド半径 × この割合 */
const LINK_RADIUS_FRAC = 0.21;
const LINK_RADIUS_MIN = 0.62;
const LINK_RADIUS_MAX = 3.25;

/** 球の論理半径に対する初速スケール（|v| ∝ radius） */
const VEL_PER_RADIUS = 0.24;

/** 接続パルスが端に到達したとき Sphere への内側風発光の強さ */
const SPHERE_LINK_INNER_GLOW = 2.35;
const SPHERE_INNER_GLOW_DECAY = 19.5;

const TMP = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const MAT = new THREE.Matrix4();
const SCALE = new THREE.Vector3();
const ORIGIN_ZERO = new THREE.Vector3(0, 0, 0);
const Y_UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function edgeKey(ia, ib) {
    return ia < ib ? `${ia},${ib}` : `${ib},${ia}`;
}

function attachLinkPulseAttribute(geometry, count) {
    const a = new Float32Array(count);
    a.fill(0);
    const attr = new THREE.InstancedBufferAttribute(a, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('linkPulse', attr);
    return attr;
}

function attachInnerGlowAttribute(geometry, count) {
    const a = new Float32Array(count);
    a.fill(0);
    const attr = new THREE.InstancedBufferAttribute(a, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('innerGlow', attr);
    return attr;
}

/** 不透明度 + 接続パルス連動の内側風発光 */
function applySphereOpacityInnerGlowShader(material) {
    material.transparent = true;
    material.depthWrite = true;
    material.onBeforeCompile = (shader) => {
        shader.vertexShader =
            'attribute float instanceOpacity;\nattribute float innerGlow;\nvarying float vInstanceOpacity;\nvarying float vInnerGlow;\n' +
            shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            'vInstanceOpacity = instanceOpacity;\nvInnerGlow = innerGlow;\n#include <begin_vertex>'
        );
        shader.fragmentShader =
            'varying float vInstanceOpacity;\nvarying float vInnerGlow;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>
            gl_FragColor.a *= vInstanceOpacity;
            vec3 _vn = normalize( normal );
            vec3 _vd = normalize( vViewPosition );
            float _ndv = clamp( abs( dot( _vn, _vd ) ), 0.0, 1.0 );
            float _inward = pow( _ndv, 1.12 ) * vInnerGlow;
            float _rim = pow( 1.0 - _ndv, 2.35 ) * vInnerGlow * 0.42;
            gl_FragColor.rgb += vec3( 1.0, 0.9, 0.38 ) * ( _inward + _rim ) * 1.22;
            `
        );
    };
}

/** 不透明度 + 接続成立時に軸方向へ走るブルーム用パルス */
function applyNodeLinkCylinderMaterial(material) {
    material.transparent = true;
    material.depthWrite = true;
    material.onBeforeCompile = (shader) => {
        shader.vertexShader =
            'attribute float instanceOpacity;\nattribute float linkPulse;\nvarying float vInstanceOpacity;\nvarying float vLinkPulse;\nvarying float vLocalY;\n' +
            shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            'vInstanceOpacity = instanceOpacity;\nvLinkPulse = linkPulse;\nvLocalY = position.y;\n#include <begin_vertex>'
        );
        shader.fragmentShader =
            'varying float vInstanceOpacity;\nvarying float vLinkPulse;\nvarying float vLocalY;\n' +
            shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>
            gl_FragColor.a *= vInstanceOpacity;
            float u = clamp(vLocalY + 0.5, 0.0, 1.0);
            float travel = 1.0 - vLinkPulse;
            float band = exp(-pow((u - travel) * 18.0, 2.0)) * vLinkPulse;
            gl_FragColor.rgb += vec3(1.0, 0.92, 0.52) * band * 3.2;
            `
        );
    };
}

function randomTrack9LikeSphereTint(baseC, baseE, outC, outE) {
    outC.copy(baseC);
    outC.offsetHSL(0, (Math.random() - 0.5) * 0.035, (Math.random() - 0.5) * 0.07);
    outE.copy(baseE);
    outE.offsetHSL(0, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.09);
}

/**
 * 空間ハッシュで近接ペアを列挙（i < j のみ）
 */
function buildLinkPairs(scene, outPairs) {
    outPairs.length = 0;
    const data = scene._snakeSphereData;
    const grid = new Map();

    for (let i = 0; i < SPHERE_COUNT; i++) {
        if (!data[i].active) continue;
        const p = data[i].worldPos;
        const gx = Math.floor(p.x / LINK_GRID_CELL);
        const gy = Math.floor(p.y / LINK_GRID_CELL);
        const gz = Math.floor(p.z / LINK_GRID_CELL);
        const key = `${gx},${gy},${gz}`;
        let bucket = grid.get(key);
        if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
        }
        bucket.push(i);
    }

    for (let i = 0; i < SPHERE_COUNT; i++) {
        if (!data[i].active) continue;
        const pi = data[i].worldPos;
        const gx = Math.floor(pi.x / LINK_GRID_CELL);
        const gy = Math.floor(pi.y / LINK_GRID_CELL);
        const gz = Math.floor(pi.z / LINK_GRID_CELL);

        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                for (let oz = -1; oz <= 1; oz++) {
                    const bucket = grid.get(`${gx + ox},${gy + oy},${gz + oz}`);
                    if (!bucket) continue;
                    for (let k = 0; k < bucket.length; k++) {
                        const j = bucket[k];
                        if (j <= i || !data[j].active) continue;
                        const pj = data[j].worldPos;
                        const dx = pi.x - pj.x;
                        const dy = pi.y - pj.y;
                        const dz = pi.z - pj.z;
                        const dsq = dx * dx + dy * dy + dz * dz;
                        if (dsq <= LINK_DISTANCE_SQ && dsq > 1e-8) {
                            outPairs.push(i, j);
                            if (outPairs.length >= MAX_LINKS * 2) return;
                        }
                    }
                }
            }
        }
    }
}

function updateLinkInstances(scene, pairs, deltaTime) {
    const inst = scene._nodeLinkInst;
    const opAttr = scene._nodeLinkOpacity;
    const pulseAttr = scene._nodeLinkPulse;
    if (!inst || !opAttr || !pulseAttr) return;

    const data = scene._snakeSphereData;
    const sphereOp = scene._snakeSphereOpacity.array;
    const nPair = pairs.length >> 1;

    const keysNow = new Set();
    for (let e = 0; e < nPair; e++) {
        keysNow.add(edgeKey(pairs[e * 2], pairs[e * 2 + 1]));
    }

    const pulseMap = scene._linkPulseByEdge || (scene._linkPulseByEdge = new Map());
    const persistentLinks = scene._persistentLinks || (scene._persistentLinks = new Map());
    const pulseDecay = Math.exp(-deltaTime * 3.65);

    // 1. 既存のリンクの更新（距離チェック）
    for (const [key, link] of persistentLinks) {
        const ia = link.ia;
        const ib = link.ib;
        const da = data[ia];
        const db = data[ib];

        // どちらかが非アクティブ、または距離が離れすぎたら削除
        if (!da.active || !db.active) {
            persistentLinks.delete(key);
            continue;
        }

        const dx = da.worldPos.x - db.worldPos.x;
        const dy = da.worldPos.y - db.worldPos.y;
        const dz = da.worldPos.z - db.worldPos.z;
        const dsq = dx * dx + dy * dy + dz * dz;

        if (dsq > LINK_DISTANCE_SQ * 1.2) { // 少しバッファを持たせて切断
            persistentLinks.delete(key);
        }
    }

    // 2. 新規リンクの追加
    for (let e = 0; e < nPair; e++) {
        const ia = pairs[e * 2];
        const ib = pairs[e * 2 + 1];
        const key = edgeKey(ia, ib);
        if (!persistentLinks.has(key)) {
            persistentLinks.set(key, {
                ia,
                ib,
                // インスタンスごとに固有の乱数を持たせてシェーダーで使う
                seed: Math.random() * 100.0 
            });
            pulseMap.set(key, 1.0); // 新規接続時にパルス
        }
    }

    // パルスの減衰
    for (const [k, p] of pulseMap) {
        const nextP = p * pulseDecay;
        if (nextP < 0.003 || !persistentLinks.has(k)) pulseMap.delete(k);
        else pulseMap.set(k, nextP);
    }

    // 3. インスタンスの描画
    let w = 0;
    // persistentLinks の順序を安定させるためにソートするか、
    // あるいは単に順番に描画（Mapの挿入順）
    for (const [key, link] of persistentLinks) {
        const ia = link.ia;
        const ib = link.ib;
        const pa = data[ia].worldPos;
        const pb = data[ib].worldPos;

        TMP_DIR.subVectors(pb, pa);
        const len = TMP_DIR.length();
        if (len < 1e-5) continue;
        TMP_DIR.multiplyScalar(1 / len);

        TMP.addVectors(pa, pb).multiplyScalar(0.5);

        if (Math.abs(Y_UP.dot(TMP_DIR)) > 0.998) {
            QUAT.setFromAxisAngle(X_AXIS, TMP_DIR.y > 0 ? 0 : Math.PI);
        } else {
            QUAT.setFromUnitVectors(Y_UP, TMP_DIR);
        }

        const rwA = data[ia].radius * SPHERE_RADIUS_TO_WORLD;
        const rwB = data[ib].radius * SPHERE_RADIUS_TO_WORLD;

        const lifeA = data[ia].age / data[ia].lifeMs;
        const lifeB = data[ib].age / data[ib].lifeMs;
        const fadeOutStart = 0.85;
        let sizeScaleA = 1.0;
        if (lifeA > fadeOutStart) sizeScaleA = 1.0 - (lifeA - fadeOutStart) / (1.0 - fadeOutStart);
        let sizeScaleB = 1.0;
        if (lifeB > fadeOutStart) sizeScaleB = 1.0 - (lifeB - fadeOutStart) / (1.0 - fadeOutStart);

        const minSizeScale = Math.min(sizeScaleA, sizeScaleB);
        if (minSizeScale <= 0.01) {
            persistentLinks.delete(key);
            continue;
        }

        const linkR = THREE.MathUtils.clamp(
            LINK_RADIUS_FRAC * 0.5 * (rwA * sizeScaleA + rwB * sizeScaleB),
            LINK_RADIUS_MIN,
            LINK_RADIUS_MAX
        );
        SCALE.set(linkR, len, linkR);
        MAT.compose(TMP, QUAT, SCALE);
        inst.setMatrixAt(w, MAT);

        opAttr.array[w] = 1.0;
        pulseAttr.array[w] = pulseMap.get(key) ?? 0;
        
        // シェーダーに渡すシード値（カスタム属性として追加する必要があるが、
        // 今回はとりあえず instanceID で代用するか、既存の属性を流用検討）
        // ひとまず instanceID でのぶるぶるを抑えるために persistentLinks を使う
        
        w++;
        if (w >= MAX_LINKS) break;
    }

    inst.count = w;
    inst.instanceMatrix.needsUpdate = true;
    opAttr.needsUpdate = true;
    pulseAttr.needsUpdate = true;

    for (let e = w; e < MAX_LINKS; e++) {
        opAttr.array[e] = 0;
        pulseAttr.array[e] = 0;
        SCALE.set(0, 0, 0);
        QUAT.identity();
        MAT.compose(ORIGIN_ZERO, QUAT, SCALE);
        inst.setMatrixAt(e, MAT);
    }
}

const _linkPairScratch = [];

function updateSphereInnerGlowFromPulses(scene, deltaTime) {
    const attr = scene._snakeInnerGlow;
    if (!attr || !scene._snakeSphereData) return;
    const g = attr.array;
    const data = scene._snakeSphereData;
    const pulseMap = scene._linkPulseByEdge;
    const decay = Math.exp(-deltaTime * SPHERE_INNER_GLOW_DECAY);

    for (let i = 0; i < SPHERE_COUNT; i++) {
        g[i] *= decay;
    }

    if (pulseMap && pulseMap.size > 0) {
        for (const [k, p] of pulseMap) {
            const comma = k.indexOf(',');
            if (comma < 0) continue;
            const ia = parseInt(k.slice(0, comma), 10);
            const ib = parseInt(k.slice(comma + 1), 10);
            const ga = Math.exp(-Math.pow((p - 1) * 18, 2)) * SPHERE_LINK_INNER_GLOW;
            const gb = Math.exp(-Math.pow(p * 18, 2)) * SPHERE_LINK_INNER_GLOW;
            if (ia >= 0 && ia < SPHERE_COUNT) g[ia] += ga;
            if (ib >= 0 && ib < SPHERE_COUNT) g[ib] += gb;
        }
    }

    for (let i = 0; i < SPHERE_COUNT; i++) {
        if (!data[i].active) g[i] = 0;
        else g[i] = Math.min(4.0, g[i]);
    }
    attr.needsUpdate = true;
}

export function initCurlSnakeSystems(scene) {
    scene._snakeHeadPos = new THREE.Vector3(0, 900, 0);
    scene._snakeHeadDir = new THREE.Vector3(0, 0, 1);
    scene._snakePathParam = 0;
    scene._snakeCurlTmp = new THREE.Vector3();

    const flesh = generateFleshVeinTextures(512, { seed: 903 });
    scene._snakeFleshTextures = flesh;
    const L = scene.sceneLightingScale ?? 0.32;
    const env = scene.scene.environment;
    scene._snakeSphereBaseColor = new THREE.Color(0xd5d9df);
    scene._snakeSphereBaseEmissive = new THREE.Color(0x2a2d32);

    scene._snakeSphereMat = new THREE.MeshStandardMaterial({
        map: flesh.map,
        bumpMap: flesh.bumpMap,
        bumpScale: 3.0,
        color: 0xd5d9df,
        metalness: 0.22,
        roughness: 0.44,
        envMap: env,
        envMapIntensity: 0.68 * (0.55 + 0.45 * L),
        emissive: 0x2a2d32,
        emissiveIntensity: 0.2,
        fog: true,
        transparent: true
    });
    applySphereOpacityInnerGlowShader(scene._snakeSphereMat);

    const sphereGeo = new THREE.SphereGeometry(1, 16, 16); // 分割数を16に戻すやで！✨
    scene._snakeSphereOpacity = attachInstanceOpacityAttribute(sphereGeo, SPHERE_COUNT);
    scene._snakeInnerGlow = attachInnerGlowAttribute(sphereGeo, SPHERE_COUNT);
    scene._snakeSphereInst = new THREE.InstancedMesh(sphereGeo, scene._snakeSphereMat, SPHERE_COUNT);
    scene._snakeSphereInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene._snakeSphereInst.frustumCulled = false;
    scene._snakeSphereInst.castShadow = true;
    scene._snakeSphereInst.receiveShadow = true;
    scene.scene.add(scene._snakeSphereInst);

    scene._snakeSphereData = [];
    const cTmp = new THREE.Color();
    const eTmp = new THREE.Color();
    for (let i = 0; i < SPHERE_COUNT; i++) {
        randomTrack9LikeSphereTint(scene._snakeSphereBaseColor, scene._snakeSphereBaseEmissive, cTmp, eTmp);
        scene._snakeSphereInst.setColorAt(i, cTmp);
        const worldPos = new THREE.Vector3().copy(scene._snakeHeadPos);
        scene._snakeSphereData.push({
            worldPos,
            vel: new THREE.Vector3(),
            active: false,
            age: 0,
            lifeMs: 1200 + Math.random() * 2300, // 1800+3200 からさらに短縮
            radius: 125,
            emissiveIntensity: THREE.MathUtils.clamp(0.17 + (Math.random() - 0.5) * 0.08, 0.12, 0.24)
        });
        scene._snakeSphereOpacity.array[i] = 0;
        scene._snakeInnerGlow.array[i] = 0;
        SCALE.set(0, 0, 0);
        QUAT.identity();
        MAT.compose(ORIGIN_ZERO, QUAT, SCALE);
        scene._snakeSphereInst.setMatrixAt(i, MAT);
    }
    if (scene._snakeSphereInst.instanceColor) scene._snakeSphereInst.instanceColor.needsUpdate = true;
    scene._snakeSphereInst.instanceMatrix.needsUpdate = true;
    scene._snakeSphereOpacity.needsUpdate = true;
    scene._snakeInnerGlow.needsUpdate = true;

    const linkTubeTex = generateLinkTubeWornTextures(256, 9043);
    scene._nodeLinkTubeTextures = linkTubeTex;

    scene._nodeLinkMat = new THREE.MeshPhysicalMaterial({
        color: 0xffff00, // ビビッドな黄色に変更
        metalness: 0.1,
        roughness: 0.8, // ツルッとさせて色をはっきり出す
        roughnessMap: linkTubeTex.roughnessMap,
        normalMap: linkTubeTex.normalMap,
        normalScale: new THREE.Vector2(0.58, 0.58),
        bumpMap: linkTubeTex.bumpMap,
        bumpScale: 0.014,
        specularIntensity: 0.5, // 反射を強めてキラッとさせる
        specularColor: new THREE.Color(0xffffff),
        envMap: env,
        envMapIntensity: 0.11 * (0.55 + 0.45 * L), // 環境マップの映り込みを少し強める
        sheen: 0.5,
        sheenRoughness: 0.08,
        sheenColor: new THREE.Color(0xffff00),
        clearcoat: 0.1, // コーティングで光沢感を出す
        fog: true,
        transparent: true
    });
    applyNodeLinkCylinderMaterial(scene._nodeLinkMat);

    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false); // 分割数を最小限にして軽量化
    scene._nodeLinkOpacity = attachInstanceOpacityAttribute(cylGeo, MAX_LINKS);
    scene._nodeLinkPulse = attachLinkPulseAttribute(cylGeo, MAX_LINKS);
    scene._nodeLinkInst = new THREE.InstancedMesh(cylGeo, scene._nodeLinkMat, MAX_LINKS);
    scene._nodeLinkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene._nodeLinkInst.frustumCulled = false;
    scene._nodeLinkInst.castShadow = true;
    scene._nodeLinkInst.receiveShadow = true;
    scene._nodeLinkInst.count = 0;
    scene.scene.add(scene._nodeLinkInst);

    for (let e = 0; e < MAX_LINKS; e++) {
        scene._nodeLinkOpacity.array[e] = 0;
        scene._nodeLinkPulse.array[e] = 0;
        SCALE.set(0, 0, 0);
        QUAT.identity();
        MAT.compose(ORIGIN_ZERO, QUAT, SCALE);
        scene._nodeLinkInst.setMatrixAt(e, MAT);
    }
    scene._nodeLinkInst.instanceMatrix.needsUpdate = true;
}

function pickSphereSlot(scene) {
    const data = scene._snakeSphereData;
    for (let i = 0; i < SPHERE_COUNT; i++) {
        if (!data[i].active) return i;
    }
    let best = 0;
    let bestAge = -1;
    for (let i = 0; i < SPHERE_COUNT; i++) {
        if (data[i].age > bestAge) {
            bestAge = data[i].age;
            best = i;
        }
    }
    return best;
}

function clampSphereToRoom(scene, pos) {
    const margin = 380;
    const hw = scene.roomHalfW - margin;
    const hd = scene.roomHalfD - margin;
    pos.x = THREE.MathUtils.clamp(pos.x, -hw, hw);
    pos.z = THREE.MathUtils.clamp(pos.z, -hd, hd);
    pos.y = THREE.MathUtils.clamp(pos.y, scene.floorTopY + 120, scene.ceilingY * 0.42);
}

/**
 * トラック6（OSC）で球を1つ生成。
 * velocityMidi は MIDI ベロシティ（大きさにマッピング）
 * durationMs は MIDI デュレーション（lifetime にマッピング）
 */
export function scene3OnTrack6Spawn(scene, velocityMidi, durationMs = 0) {
    if (!scene._snakeSphereData || !scene._snakeHeadPos) return;
    const v01 = THREE.MathUtils.clamp(velocityMidi / 127, 0.05, 1);
    const i = pickSphereSlot(scene);
    const d = scene._snakeSphereData[i];

    d.active = true;
    d.worldPos.copy(scene._snakeHeadPos);
    d.worldPos.x += (Math.random() - 0.5) * 2 * SPHERE_SPAWN_JIT.x;
    d.worldPos.y += (Math.random() - 0.5) * 2 * SPHERE_SPAWN_JIT.y;
    d.worldPos.z += (Math.random() - 0.5) * 2 * SPHERE_SPAWN_JIT.z;
    clampSphereToRoom(scene, d.worldPos);

    d.age = 0;
    // デュレーションが指定されていればそれを lifetime にマッピング（10倍して存在感を出す）
    // 指定がなければデフォルトのランダム値
    d.lifeMs = durationMs > 0 ? (durationMs * 30.0) : (1000 + Math.random() * 1800);
    
    // ベロシティ(v01)を大きさにマッピング
    d.radius = 80 + v01 * 350;

    TMP.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (TMP.lengthSq() < 1e-8) TMP.set(1, 0, 0);
    else TMP.normalize();
    // 初速は半径に比例させる（大きいほど速い）
    const speed = VEL_PER_RADIUS * d.radius;
    d.vel.copy(TMP).multiplyScalar(speed);

    const cTmp = new THREE.Color();
    const eTmp = new THREE.Color();
    randomTrack9LikeSphereTint(scene._snakeSphereBaseColor, scene._snakeSphereBaseEmissive, cTmp, eTmp);
    scene._snakeSphereInst.setColorAt(i, cTmp);
    if (scene._snakeSphereInst.instanceColor) scene._snakeSphereInst.instanceColor.needsUpdate = true;
    d.emissiveIntensity = THREE.MathUtils.clamp(0.17 + (Math.random() - 0.5) * 0.08, 0.12, 0.24);
}

export function updateCurlSnakeSystems(scene, deltaTime) {
    if (!scene._snakeHeadPos) return;

    const t = scene.time;
    curlNoiseWorld(scene._snakeHeadPos, t, scene._snakeCurlTmp);
    if (scene._snakeCurlTmp.lengthSq() < 1e-10) {
        scene._snakeCurlTmp.set(0, 0, 1);
    } else {
        scene._snakeCurlTmp.normalize();
    }

    const headSpeed = 440;
    scene._snakeHeadPos.addScaledVector(scene._snakeCurlTmp, headSpeed * deltaTime);
    scene._snakePathParam += deltaTime * headSpeed * 0.001;

    TMP.copy(scene._snakeHeadDir).lerp(scene._snakeCurlTmp, 1 - Math.exp(-deltaTime * 5.5));
    scene._snakeHeadDir.copy(TMP);
    if (scene._snakeHeadDir.lengthSq() > 1e-10) scene._snakeHeadDir.normalize();

    const margin = 380;
    const hw = scene.roomHalfW - margin;
    const hd = scene.roomHalfD - margin;
    scene._snakeHeadPos.x = THREE.MathUtils.clamp(scene._snakeHeadPos.x, -hw, hw);
    scene._snakeHeadPos.z = THREE.MathUtils.clamp(scene._snakeHeadPos.z, -hd, hd);
    scene._snakeHeadPos.y = THREE.MathUtils.clamp(
        scene._snakeHeadPos.y,
        scene.floorTopY + 200,
        scene.ceilingY * 0.42
    );

    scene._centerSmoothed.lerp(scene._snakeHeadPos, 1 - Math.exp(-deltaTime * 2.4));

    let totalGlow = 0;
    for (let i = 0; i < SPHERE_COUNT; i++) {
        const d = scene._snakeSphereData[i];
        if (!d.active) {
            d.vel.set(0, 0, 0);
            scene._snakeSphereOpacity.array[i] = 0;
            scene._snakeInnerGlow.array[i] = 0;
            SCALE.set(0, 0, 0);
            QUAT.identity();
            MAT.compose(ORIGIN_ZERO, QUAT, SCALE);
            scene._snakeSphereInst.setMatrixAt(i, MAT);
            continue;
        }

        d.age += deltaTime * 1000;
        d.worldPos.addScaledVector(d.vel, deltaTime);
        clampSphereToRoom(scene, d.worldPos);

        if (d.age >= d.lifeMs) {
            d.active = false;
            d.vel.set(0, 0, 0);
            scene._snakeSphereOpacity.array[i] = 0;
            scene._snakeInnerGlow.array[i] = 0;
            SCALE.set(0, 0, 0);
            QUAT.identity();
            MAT.compose(ORIGIN_ZERO, QUAT, SCALE);
            scene._snakeSphereInst.setMatrixAt(i, MAT);
            continue;
        }

        TMP.copy(d.worldPos);
        const life01 = d.age / d.lifeMs;
        const fadeOutStart = 0.85; // 最後の15%で小さくなる
        let sizeScale = 1.0;
        if (life01 > fadeOutStart) {
            sizeScale = 1.0 - (life01 - fadeOutStart) / (1.0 - fadeOutStart);
            sizeScale = THREE.MathUtils.clamp(sizeScale, 0, 1);
        }

        // 透明度は固定（1.0）にするが、出現時のフェードインだけは残す（必要なら）
        const op = life01 < 0.1 ? life01 / 0.1 : 1.0; 
        scene._snakeSphereOpacity.array[i] = op;

        const rad = d.radius * SPHERE_RADIUS_TO_WORLD * sizeScale;
        
        // 輝度の合計を計算（サイズと不透明度を考慮）
        totalGlow += sizeScale * op;

        SCALE.setScalar(rad);
        QUAT.identity();
        MAT.compose(TMP, QUAT, SCALE);
        scene._snakeSphereInst.setMatrixAt(i, MAT);
    }
    scene._totalSphereGlow = totalGlow; // 合計値をシーンに保存
    scene._snakeSphereOpacity.needsUpdate = true;
    scene._snakeSphereInst.instanceMatrix.needsUpdate = true;

    buildLinkPairs(scene, _linkPairScratch);
    updateLinkInstances(scene, _linkPairScratch, deltaTime);
    updateSphereInnerGlowFromPulses(scene, deltaTime);

    const linkN = scene._nodeLinkInst?.count ?? 0;
    scene.setParticleCount(SPHERE_COUNT + linkN);
}

export function disposeCurlSnakeSystems(scene) {
    if (scene._snakeSphereInst) {
        scene.scene.remove(scene._snakeSphereInst);
        if (scene._snakeSphereInst.geometry) scene._snakeSphereInst.geometry.dispose();
        scene._snakeSphereInst = null;
    }
    if (scene._snakeSphereMat) {
        scene._snakeSphereMat.dispose();
        scene._snakeSphereMat = null;
    }
    if (scene._snakeFleshTextures) {
        scene._snakeFleshTextures.map?.dispose();
        scene._snakeFleshTextures.bumpMap?.dispose();
        scene._snakeFleshTextures = null;
    }

    if (scene._nodeLinkInst) {
        scene.scene.remove(scene._nodeLinkInst);
        if (scene._nodeLinkInst.geometry) scene._nodeLinkInst.geometry.dispose();
        scene._nodeLinkInst = null;
    }
    if (scene._nodeLinkMat) {
        scene._nodeLinkMat.dispose();
        scene._nodeLinkMat = null;
    }
    if (scene._nodeLinkTubeTextures) {
        scene._nodeLinkTubeTextures.dispose();
        scene._nodeLinkTubeTextures = null;
    }

    scene._nodeLinkPulse = null;
    scene._linkPulseByEdge = null;
    scene._linkEdgePrev = null;
    scene._linkPulseReady = false;

    scene._snakeInnerGlow = null;
    scene._snakeSphereData = null;
    scene._snakeHeadPos = null;
}
