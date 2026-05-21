import * as THREE from 'three';
import { drawGroutLines, drawRedCrossesAndLabels } from './studioBoxGrout.js';
import { generateLabGrungeTextures } from './LabGrungeTextures.js';
import { StudioEmissiveCeilingSpotRig } from './StudioEmissiveCeilingSpotRig.js';
import { StudioFluorescentLamp } from './StudioFluorescentLamp.js';

/**
 * StudioBox: 撮影用スタジオ（白い箱と床）を管理するクラス
 *
 * 【ライトまわりの方針】
 * シーンは `new StudioBox(scene, options)` を基本とし、照明の試作・調整は **StudioBox（＋ StudioEmissiveCeilingSpotRig）側** に寄せる。
 * 採用できたら各シーン固有の `setupLights` 等は削っていく。シーンはオプションで挙動を選ぶだけに寄せる。
 * デフォルトで **薄い AmbientLight**（`ambientIntensity` 既定 0.16）を足し、陰影は残したまま全体をほんのり均す。
 * 蛍光灯：`fluorescentLayout` が `'corners'` のときは四隅に **{@link StudioFluorescentLamp}**（emissive メッシュ + 同位置の PointLight）。
 * `'ceilingRow'` のときは四隅ではなく天井付近へ同型ランプを少し離して **並列（既定4本・軸は Z に沿う水平管）**で配置する。
 * 背景＋距離フォグは **{@link StudioBox.applySceneBackdrop}**（`lib/presentation` からも再エクスポート可）。
 */
export class StudioBox {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.size = options.size || 10000; // 2000 -> 10000
        this.color = options.color || 0xffffff;
        this.roughness = options.roughness !== undefined ? options.roughness : 0.8; // 0.4 -> 0.8
        this.metalness = options.metalness !== undefined ? options.metalness : 0.0;
        this.lightColor = options.lightColor || 0xffffff; // 蛍光灯の色
        this.lightIntensity = options.lightIntensity !== undefined ? options.lightIntensity : 10.0; // デフォルト10.0
        this.bumpScale = options.bumpScale !== undefined ? options.bumpScale : 5.0; // 0.5 -> 5.0
        this.useFloorTile = options.useFloorTile !== undefined ? options.useFloorTile : true;
        this.useLights = options.useLights !== undefined ? options.useLights : true;
        /** 全体をほんのり均す（シャドウは残す薄さ）。0 で無効扱い */
        this.useAmbientLight = options.useAmbientLight !== undefined ? options.useAmbientLight : true;
        this.ambientIntensity =
            options.ambientIntensity !== undefined ? options.ambientIntensity : 0.4;
        this.ambientColor = options.ambientColor !== undefined ? options.ambientColor : this.lightColor;
        
        // 追加パラメータ（既存の挙動を壊さないようにデフォルト値を設定）
        this.envMap = options.envMap || null;
        this.envMapIntensity = options.envMapIntensity !== undefined ? options.envMapIntensity : 1.0;
        this.grungeEnabled = options.grungeEnabled === true;
        this.maxAnisotropy = options.maxAnisotropy ?? 8;
        /** 壁・床のリピート（非対称で汚れの流れを偏らせる） */
        this.grungeWallRepeat = options.grungeWallRepeat || null;
        this.grungeFloorRepeat = options.grungeFloorRepeat || null;
        this.grungeWallOffset = options.grungeWallOffset || null;
        this.grungeFloorOffset = options.grungeFloorOffset || null;
        this.grungeWallTexOptions = options.grungeWallTexOptions || null;
        this.grungeFloorTexOptions = options.grungeFloorTexOptions || null;
        this.grungeTextures = null;

        /** 蛍光灯の PointLight 用（未指定時は emissive 強度から自動） */
        this.fluorescentPointIntensity = options.fluorescentPointIntensity;
        this.fluorescentPointDistance = options.fluorescentPointDistance;
        this.fluorescentPointDecay = options.fluorescentPointDecay !== undefined ? options.fluorescentPointDecay : 2;

        /** 蛍光灯の配置：`corners`（四隅の縦管） / `ceilingRow`（天井付近へ水平に複数並べ） */
        this.fluorescentLayout =
            options.fluorescentLayout === 'ceilingRow' ? 'ceilingRow' : 'corners';
        /** `ceilingRow` 時のみ参照 */
        this.ceilingRowFluorescent = options.ceilingRowFluorescent || {};

        this.studioBox = null;
        this.studioFloor = null;
        this.textures = null;
        this.floorTextures = null; // 床専用テクスチャ
        /** @type {import('./StudioFluorescentLamp.js').StudioFluorescentLamp[]} */
        this.fluorescentLights = [];
        /** @type {THREE.AmbientLight | null} */
        this.ambientLight = null;
        /** @type {import('./StudioEmissiveCeilingSpotRig.js').StudioEmissiveCeilingSpotRig | null} */
        this.ceilingSpotRig = null;
        /** オプション: 箱本体の天井は emissive 済みのため、Rig は Spot のみ追加 */
        this.ceilingSpotRigOption = options.ceilingSpotRig ?? null;

        this.setup();
    }

    /**
     * シーンの `background` と `FogExp2`（任意）を StudioBox 系の既定に揃える。
     * @param {THREE.Scene} scene
     * @param {object} [options]
     * @param {number} [options.backgroundHex=0x151820]
     * @param {number} [options.fogDensity=0.00009]
     * @param {number} [options.fogColor] 未指定時は背景と同じ色
     * @param {boolean} [options.useFog=true] false でフォグを外す
     */
    static applySceneBackdrop(scene, options = {}) {
        const bg = options.backgroundHex !== undefined ? options.backgroundHex : 0x151820;
        scene.background = new THREE.Color(bg);
        if (options.useFog === false) {
            scene.fog = null;
            return;
        }
        const fogColor = options.fogColor !== undefined ? options.fogColor : bg;
        const density = options.fogDensity !== undefined ? options.fogDensity : 0.00009;
        scene.fog = new THREE.FogExp2(fogColor, density);
    }

    /**
     * カスタム部屋の Group 等に「天井 emissive + オプション Spot」を付与。ライト実験は StudioBox 経由で。
     * @param {THREE.Object3D} parent 天井メッシュの親（例: Scene1 の roomGroup）
     * @param {object} options {@link StudioEmissiveCeilingSpotRig} にそのまま渡す。`parent` / `spotParent` はここで上書き
     * @returns {StudioEmissiveCeilingSpotRig}
     */
    attachCeilingSpotRig(parent, options = {}) {
        if (this.ceilingSpotRig) {
            this.ceilingSpotRig.dispose();
            this.ceilingSpotRig = null;
        }
        this.ceilingSpotRig = new StudioEmissiveCeilingSpotRig(this.scene, {
            ...options,
            parent,
            spotParent: options.spotParent ?? this.scene
        });
        return this.ceilingSpotRig;
    }

    setup() {
        if (this.grungeEnabled) {
            const maxA = this.maxAnisotropy;
            const wallGen = { variant: 'wall', seed: 101, maxAnisotropy: maxA, ...(this.grungeWallTexOptions || {}) };
            const floorGen = { variant: 'floor', seed: 202, maxAnisotropy: maxA, ...(this.grungeFloorTexOptions || {}) };
            this.grungeTextures = {
                wall: generateLabGrungeTextures(2048, wallGen),
                floor: generateLabGrungeTextures(2048, floorGen),
                ceiling: generateLabGrungeTextures(2048, { variant: 'ceiling', seed: 303, maxAnisotropy: maxA })
            };
            const wallRepX = this.grungeWallRepeat ? this.grungeWallRepeat.x : 5.5;
            const wallRepY = this.grungeWallRepeat ? this.grungeWallRepeat.y : 5.5;
            const floorRepX = this.grungeFloorRepeat ? this.grungeFloorRepeat.x : 5.2;
            const floorRepY = this.grungeFloorRepeat ? this.grungeFloorRepeat.y : 5.2;
            ['map', 'normalMap', 'roughnessMap', 'aoMap'].forEach((key) => {
                const t = this.grungeTextures.wall[key];
                if (t && t.repeat) {
                    t.repeat.set(wallRepX, wallRepY);
                    if (this.grungeWallOffset) t.offset.set(this.grungeWallOffset.x, this.grungeWallOffset.y);
                }
            });
            ['map', 'normalMap', 'roughnessMap', 'aoMap'].forEach((key) => {
                const t = this.grungeTextures.floor[key];
                if (t && t.repeat) {
                    t.repeat.set(floorRepX, floorRepY);
                    if (this.grungeFloorOffset) t.offset.set(this.grungeFloorOffset.x, this.grungeFloorOffset.y);
                }
            });
            this.textures = this.grungeTextures.wall;
            this.floorTextures = this.grungeTextures.floor;
        } else {
            this.textures = this.generateTileTexture(true);
        }

        // スタジオ（箱）
        // 天井だけタイルにならないように、マテリアルを配列で定義する
        // BoxGeometryの面順: 0:右, 1:左, 2:上(天井), 3:下(床), 4:前, 5:後
        let wallMat;
        let ceilingMat;
        if (this.grungeEnabled) {
            const w = this.grungeTextures.wall;
            const c = this.grungeTextures.ceiling;
            wallMat = new THREE.MeshStandardMaterial({
                color: this.color,
                map: w.map,
                normalMap: w.normalMap,
                normalScale: new THREE.Vector2(0.62, 0.62),
                roughnessMap: w.roughnessMap,
                aoMap: w.aoMap,
                aoMapIntensity: 1.0,
                side: THREE.BackSide,
                roughness: this.roughness * 0.5,
                metalness: this.metalness + 0.1,
                envMap: this.envMap,
                envMapIntensity: this.envMapIntensity
            });
            ceilingMat = new THREE.MeshStandardMaterial({
                color: this.lightColor,
                map: c.map,
                normalMap: c.normalMap,
                normalScale: new THREE.Vector2(0.42, 0.42),
                roughnessMap: c.roughnessMap,
                aoMap: c.aoMap,
                aoMapIntensity: 0.88,
                side: THREE.BackSide,
                roughness: this.roughness,
                metalness: this.metalness,
                emissive: this.lightColor,
                emissiveIntensity: this.lightIntensity * 0.5,
                envMap: this.envMap,
                envMapIntensity: this.envMapIntensity
            });
        } else {
            wallMat = new THREE.MeshStandardMaterial({
                color: this.color,
                map: this.textures.map,
                bumpMap: this.textures.bumpMap,
                bumpScale: 1.0, // 壁も凹凸を抑えて細い線を活かす
                side: THREE.BackSide,
                roughness: this.roughness * 0.5,
                metalness: this.metalness + 0.1,
                envMap: this.envMap,
                envMapIntensity: this.envMapIntensity
            });
            ceilingMat = new THREE.MeshStandardMaterial({
                color: this.lightColor, // 天井自体をライトの色にする
                side: THREE.BackSide,
                roughness: this.roughness,
                metalness: this.metalness,
                emissive: this.lightColor, // 天井を発光させる！
                emissiveIntensity: this.lightIntensity * 0.5, // 少し抑えめに発光
                envMap: this.envMap,
                envMapIntensity: this.envMapIntensity
            });
        }

        const materials = [
            wallMat, // 0: 右
            wallMat, // 1: 左
            ceilingMat, // 2: 上 (天井)
            wallMat, // 3: 下 (床)
            wallMat, // 4: 前
            wallMat  // 5: 後
        ];

        const geometry = new THREE.BoxGeometry(this.size, this.size, this.size);
        if (this.grungeEnabled) {
            geometry.setAttribute('uv2', geometry.attributes.uv.clone());
        }
        this.studioBox = new THREE.Mesh(geometry, materials);
        this.studioBox.position.set(0, 500, 0);
        this.studioBox.castShadow = true;
        this.studioBox.receiveShadow = true;
        this.scene.add(this.studioBox);

        const floorGeo = new THREE.PlaneGeometry(this.size, this.size);
        if (!this.grungeEnabled) {
            this.floorTextures = this.generateTileTexture(false);
        }
        if (this.grungeEnabled) {
            floorGeo.setAttribute('uv2', floorGeo.attributes.uv.clone());
        }

        if (this.useFloorTile) {
            let floorMat;
            if (this.grungeEnabled) {
                const f = this.grungeTextures.floor;
                floorMat = new THREE.MeshStandardMaterial({
                    color: this.color,
                    map: f.map,
                    normalMap: f.normalMap,
                    normalScale: new THREE.Vector2(0.62, 0.62),
                    roughnessMap: f.roughnessMap,
                    aoMap: f.aoMap,
                    aoMapIntensity: 1.0,
                    roughness: this.roughness * 0.3,
                    metalness: this.metalness + 0.2,
                    envMap: this.envMap,
                    envMapIntensity: this.envMapIntensity * 1.3
                });
            } else {
                floorMat = new THREE.MeshStandardMaterial({
                    color: this.color,
                    map: this.floorTextures.map,
                    bumpMap: this.floorTextures.bumpMap,
                    bumpScale: 1.0,
                    roughness: this.roughness * 0.3,
                    metalness: this.metalness + 0.2,
                    envMap: this.envMap,
                    envMapIntensity: this.envMapIntensity * 1.3
                });
            }
            this.studioFloor = new THREE.Mesh(floorGeo, floorMat);
            this.studioFloor.rotation.x = -Math.PI / 2;
            this.studioFloor.position.y = -498;
            this.studioFloor.castShadow = true;
            this.studioFloor.receiveShadow = true;
            this.scene.add(this.studioFloor);
        }

        if (this.useAmbientLight && this.ambientIntensity > 0) {
            this.ambientLight = new THREE.AmbientLight(this.ambientColor, this.ambientIntensity);
            this.scene.add(this.ambientLight);
        }

        // 蛍光灯の作成
        if (this.useLights) {
            this.createFluorescentLights();
        }

        if (this.ceilingSpotRigOption?.enabled) {
            const boxCy = 500;
            const ceilingY = boxCy + this.size / 2;
            const floorTopY = -498;
            const userSpot = this.ceilingSpotRigOption.spot || {};
            this.ceilingSpotRig = new StudioEmissiveCeilingSpotRig(this.scene, {
                includeCeilingPlane: false,
                parent: this.scene,
                spotParent: this.scene,
                ceilingY,
                floorTopY,
                sceneLightingScale: this.ceilingSpotRigOption.sceneLightingScale ?? 1,
                shadowDebugSpot: { enabled: true, ...userSpot }
            });
        }
    }

    createFluorescentLights() {
        if (this.fluorescentLayout === 'ceilingRow') {
            this._createCeilingRowFluorescentLights();
            return;
        }
        const lightHeight = this.size;
        const lightRadius = 50;
        const cornerDist = this.size / 2 - 100;

        const positions = [
            [cornerDist, 0, cornerDist],
            [-cornerDist, 0, cornerDist],
            [cornerDist, 0, -cornerDist],
            [-cornerDist, 0, -cornerDist]
        ];

        const lampOpts = {
            color: this.lightColor,
            emissiveIntensity: this.lightIntensity,
            radius: lightRadius,
            height: lightHeight,
            envMapIntensity: 1.0,
            distance: this.fluorescentPointDistance ?? this.size * 2,
            decay: this.fluorescentPointDecay
        };
        if (this.fluorescentPointIntensity !== undefined) {
            lampOpts.pointIntensity = this.fluorescentPointIntensity;
        }

        positions.forEach((pos) => {
            const lamp = new StudioFluorescentLamp(this.scene, {
                ...lampOpts,
                position: { x: pos[0], y: pos[1], z: pos[2] }
            });
            this.fluorescentLights.push(lamp);
        });
    }

    /**
     * 天井付近に水平蛍光灯を直列配置（軸は Z、位置は X で等間隔）。
     * `ceilingRowFluorescent` で調整可。
     */
    _createCeilingRowFluorescentLights() {
        const cfg = this.ceilingRowFluorescent;
        const count = Math.max(1, cfg.count ?? 4);
        const ceilingY = cfg.ceilingY ?? 5500;
        const yOffset = cfg.yOffset ?? -135;
        const spacingAlongX = cfg.spacingAlongX ?? 2400;
        const tubeLengthAlongZ = cfg.tubeLengthAlongZ ?? 7200;
        const radius = cfg.radius ?? 38;
        const rowZ = cfg.rowZ ?? 0;

        const y = ceilingY + yOffset;
        const totalSpan = spacingAlongX * (count - 1);
        const startX = -(totalSpan / 2);

        const lampOpts = {
            color: this.lightColor,
            emissiveIntensity: this.lightIntensity,
            radius,
            height: tubeLengthAlongZ,
            envMapIntensity: 1.0,
            distance:
                this.fluorescentPointDistance ??
                cfg.pointDistance ??
                Math.max(this.size * 2, tubeLengthAlongZ * 2),
            decay: this.fluorescentPointDecay,
            rotation: new THREE.Euler(Math.PI / 2, 0, 0)
        };
        if (this.fluorescentPointIntensity !== undefined) {
            lampOpts.pointIntensity = this.fluorescentPointIntensity;
        }

        for (let i = 0; i < count; i++) {
            const x = startX + i * spacingAlongX;
            const lamp = new StudioFluorescentLamp(this.scene, {
                ...lampOpts,
                position: { x, y, z: rowZ }
            });
            this.fluorescentLights.push(lamp);
        }
    }

    /**
     * タイル用のテクスチャを生成
     */
    generateTileTexture(isWall = false) {
        const size = 2048; 
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // 1. ベースカラー（目地の色）
        ctx.fillStyle = '#c8c8c8'; // #b0b0b0 -> #c8c8c8 (明るくして目立たなくする)
        ctx.fillRect(0, 0, size, size);

        // 2. タイルの本体を描画
        ctx.fillStyle = '#d0d0d0'; 
        ctx.fillRect(0, 0, size, size);

        // --- 経年劣化風のノイズをベースカラーに追加（控えめに！） ---
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const s = Math.random() * 1.5 + 0.5;
            const alpha = Math.random() * 0.02; // 0.05 -> 0.02
            ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
            ctx.fillRect(x, y, s, s);
        }

        // 目地の線を細く描画
        StudioBox.drawGroutLines(ctx, size);

        // 3. 赤い十字と目盛りテキスト（床のみ）
        if (!isWall) {
            StudioBox.drawRedCrossesAndLabels(ctx, size);
        }

        const map = new THREE.CanvasTexture(canvas);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(1, 1);

        // バンプマップ（タイルを浮かび上がらせる）
        const bCanvas = document.createElement('canvas');
        bCanvas.width = size;
        bCanvas.height = size;
        const bCtx = bCanvas.getContext('2d');

        bCtx.fillStyle = '#ffffff';
        bCtx.fillRect(0, 0, size, size);

        for (let i = 0; i < 4000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const s = Math.random() * 2 + 0.5;
            const gray = Math.floor(Math.random() * 30 + 210);
            bCtx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
            bCtx.fillRect(x, y, s, s);
        }

        StudioBox.drawGroutLines(bCtx, size, { strokeStyle: '#404040' });

        const bumpMap = new THREE.CanvasTexture(bCanvas);
        bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
        bumpMap.repeat.set(1, 1);

        return { map, bumpMap };
    }

    /**
     * Scene12 の床と同一の map + bump（generateTileTexture(false) と同一）。
     * 他シーンで床だけ合わせる用途。
     */
    static createFloorTileTextures() {
        return StudioBox.prototype.generateTileTexture(false);
    }

    /**
     * Scene12 の壁と同一の map + bump（generateTileTexture(true) と同一。赤十字なし）。
     */
    static createWallTileTextures() {
        return StudioBox.prototype.generateTileTexture(true);
    }

    dispose() {
        const detach = (mesh) => {
            if (!mesh) return;
            if (mesh.parent) mesh.parent.remove(mesh);
            else if (this.scene) this.scene.remove(mesh);
        };
        if (this.studioBox) {
            detach(this.studioBox);
            this.studioBox.geometry.dispose();
            if (Array.isArray(this.studioBox.material)) {
                this.studioBox.material.forEach(m => m.dispose());
            } else {
                this.studioBox.material.dispose();
            }
            this.studioBox = null;
        }
        if (this.studioFloor) {
            detach(this.studioFloor);
            this.studioFloor.geometry.dispose();
            this.studioFloor.material.dispose();
            this.studioFloor = null;
        }
        if (this.textures && !this.grungeEnabled) {
            if (this.textures.map) this.textures.map.dispose();
            if (this.textures.bumpMap) this.textures.bumpMap.dispose();
        }
        if (this.floorTextures && !this.grungeEnabled) {
            if (this.floorTextures.map) this.floorTextures.map.dispose();
            if (this.floorTextures.bumpMap) this.floorTextures.bumpMap.dispose();
        }
        this.grungeTextures = null;
        if (this.ambientLight) {
            this.scene.remove(this.ambientLight);
            this.ambientLight = null;
        }
        this.fluorescentLights.forEach((lamp) => lamp.dispose());
        this.fluorescentLights = [];
        if (this.ceilingSpotRig) {
            this.ceilingSpotRig.dispose();
            this.ceilingSpotRig = null;
        }
    }
}

StudioBox.drawGroutLines = drawGroutLines;
StudioBox.drawRedCrossesAndLabels = drawRedCrossesAndLabels;
