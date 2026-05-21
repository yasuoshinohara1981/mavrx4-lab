/**
 * GPU Particle System
 * Three.jsでGPUパーティクルを実装（RenderTarget + Ping-pongバッファを使用）
 * ノイズ計算と色計算をGPU側で行う
 */

import * as THREE from 'three';

export class GPUParticleSystem {
    constructor(renderer, particleCount, cols, rows, baseRadius, shaderPath = 'scene01', particleSize = 3.0, placementType = 'sphere', initOptions = {}) {
        if (!renderer) {
            throw new Error('GPUParticleSystem: renderer is required');
        }
        
        this.renderer = renderer;
        this.particleCount = particleCount;
        this.cols = cols;
        this.rows = rows;
        this.baseRadius = baseRadius;
        this.shaderPath = shaderPath;
        this.particleSize = particleSize;  // パーティクルサイズ（シーン側から指定可能）
        this.placementType = placementType;  // 配置タイプ: 'sphere'（デフォルト）または'terrain'
        this.initOptions = initOptions;  // 初期化オプション
        
        // テクスチャサイズ（パーティクル数に合わせる）
        this.width = cols;
        this.height = rows;
        
        // ノイズオフセットテクスチャ（terrain配置の場合に使用）
        this.noiseOffsetTexture = null;
        
        // Ping-pongバッファ用のRenderTarget
        this.positionRenderTargets = [];
        this.colorRenderTargets = [];
        this.currentPositionBuffer = 0;
        this.currentColorBuffer = 0;
        
        // 更新用シェーダーマテリアル
        this.positionUpdateMaterial = null;
        this.colorUpdateMaterial = null;
        this.positionUpdateMesh = null;
        this.colorUpdateMesh = null;
        
        // 描画用ジオメトリとマテリアル
        this.particleGeometry = null;
        this.particleMaterial = null;
        this.particleSystem = null;
        
        // 更新用シーンとカメラ（createUpdateShaderで初期化）
        this.updateScene = null;
        this.updateCamera = null;
        
        // シェーダーソース
        this.shaders = null;
        
        // ラインシステム
        this.lineSystem = null;
        
        // 初期化（非同期）
        this.initPromise = this.init();
    }
    
    async init() {
        // RenderTargetを作成
        this.createRenderTargets();
        
        // シェーダーを読み込む
        await this.loadShaders();
        
        // 更新用シェーダーを作成
        this.createUpdateShader();
        
        // 描画用シェーダーを作成
        this.createRenderShader();
        
        // 初期データを設定
        this.initializeParticleData();
        
        // 初期テクスチャを設定（render()が先に呼ばれる場合に備える）
        if (this.particleMaterial && this.particleMaterial.uniforms && 
            this.positionRenderTargets && this.positionRenderTargets[0] &&
            this.colorRenderTargets && this.colorRenderTargets[0]) {
            if (this.particleMaterial.uniforms.positionTexture) {
                this.particleMaterial.uniforms.positionTexture.value = this.positionRenderTargets[0].texture;
            }
            if (this.particleMaterial.uniforms.colorTexture) {
                this.particleMaterial.uniforms.colorTexture.value = this.colorRenderTargets[0].texture;
            }
        }
    }
    
    /**
     * シェーダーファイルを読み込む
     */
    async loadShaders() {
        try {
            // publicフォルダからシェーダーを読み込む
            const shaderBasePath = `/shaders/${this.shaderPath}/`;      
            const loadShader = async (path, name) => {
                const response = await fetch(path);
                if (!response.ok) {
                    throw new Error(`Failed to load ${name}: ${response.status} ${response.statusText}`);
                }
                const text = await response.text();
                if (!text || text.trim().length === 0) {
                    throw new Error(`Empty shader file: ${name}`);
                }
                return text;
            };
            
            const [positionVert, positionFrag, colorVert, colorFrag, renderVert, renderFrag] = await Promise.all([
                loadShader(`${shaderBasePath}positionUpdate.vert`, 'positionUpdate.vert'),
                loadShader(`${shaderBasePath}positionUpdate.frag`, 'positionUpdate.frag'),
                loadShader(`${shaderBasePath}colorUpdate.vert`, 'colorUpdate.vert'),
                loadShader(`${shaderBasePath}colorUpdate.frag`, 'colorUpdate.frag'),
                loadShader(`${shaderBasePath}particleRender.vert`, 'particleRender.vert'),
                loadShader(`${shaderBasePath}particleRender.frag`, 'particleRender.frag')
            ]);
            
            this.shaders = {
                positionUpdate: { vertex: positionVert, fragment: positionFrag },
                colorUpdate: { vertex: colorVert, fragment: colorFrag },
                particleRender: { vertex: renderVert, fragment: renderFrag }
            };
        } catch (error) {
            // フォールバック: デフォルトシェーダーを使用
            this.shaders = this.getDefaultShaders();
        }
    }
    
    /**
     * デフォルトシェーダー（フォールバック用・汎用的な実装）
     */
    getDefaultShaders() {
        return {
            positionUpdate: {
                vertex: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragment: `
                    uniform sampler2D positionTexture;
                    uniform float time;
                    uniform float noiseScale;
                    uniform float noiseStrength;
                    uniform float baseRadius;
                    uniform float width;
                    uniform float height;
                    varying vec2 vUv;
                    
                    // 汎用的な実装：位置をそのまま返す（変形なし）
                    void main() {
                        vec4 posData = texture2D(positionTexture, vUv);
                        // 位置をそのまま出力（baseRadiusをwに保存）
                        gl_FragColor = posData;
                    }
                `
            },
            colorUpdate: {
                vertex: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragment: `
                    uniform sampler2D positionTexture;
                    uniform float baseRadius;
                    varying vec2 vUv;
                    
                    // 汎用的な実装：位置から基本的な色を計算
                    void main() {
                        vec4 posData = texture2D(positionTexture, vUv);
                        vec3 currentPos = posData.xyz;
                        
                        // 位置から基本的な色を計算（シーン固有のロジックなし）
                        // 単純に位置の正規化された値を使用
                        vec3 normalizedPos = normalize(currentPos + vec3(1.0));
                        vec3 color = normalizedPos * 0.5 + 0.5;  // 0.0-1.0の範囲に正規化
                        
                        gl_FragColor = vec4(color, 1.0);
                    }
                `
            },
            particleRender: {
                vertex: `
                    uniform sampler2D positionTexture;
                    uniform sampler2D colorTexture;
                    uniform float width;
                    uniform float height;
                    attribute float size;
                    attribute vec2 particleUv;
                    varying vec3 vColor;
                    void main() {
                        vec2 pixelUv = vec2((floor(particleUv.x * width) + 0.5) / width, (floor(particleUv.y * height) + 0.5) / height);
                        vec4 posData = texture2D(positionTexture, pixelUv);
                        vec4 colorData = texture2D(colorTexture, pixelUv);
                        vec3 position = posData.xyz;
                        vColor = colorData.rgb;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (300.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragment: `
                    varying vec3 vColor;
                    void main() {
                        float dist = distance(gl_PointCoord, vec2(0.5));
                        if (dist > 0.5) discard;
                        float alpha = 1.0 - (dist * 2.0);
                        gl_FragColor = vec4(vColor, alpha);
                    }
                `
            }
        };
    }
    
    /**
     * RenderTargetを作成（ping-pong用）
     */
    createRenderTargets() {
        const rtOptions = {
            type: THREE.FloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: false
        };
        
        // 位置用RenderTarget（ping-pong）- 別々に作成
        this.positionRenderTargets[0] = new THREE.WebGLRenderTarget(
            this.width,
            this.height,
            rtOptions
        );
        
        this.positionRenderTargets[1] = new THREE.WebGLRenderTarget(
            this.width,
            this.height,
            rtOptions
        );
        
        // 色用RenderTarget（ping-pong）- 別々に作成
        this.colorRenderTargets[0] = new THREE.WebGLRenderTarget(
            this.width,
            this.height,
            rtOptions
        );
        
        this.colorRenderTargets[1] = new THREE.WebGLRenderTarget(
            this.width,
            this.height,
            rtOptions
        );
    }
    
    /**
     * 簡易パーリンノイズ関数（地形配置用、最適化版）
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {number} z - Z座標（デフォルト: 0）
     * @param {number} seed - ノイズシード
     * @returns {number} ノイズ値（0.0-1.0）
     */
    _terrainNoise(x, y = 0, z = 0, seed) {
        // ハッシュ関数（最適化版：sin()の呼び出しを減らす）
        const hash = (ix, iy, iz) => {
            const n = ix * 73856093.0 + iy * 19349663.0 + iz * 83492791.0 + seed * 1103515245.0;
            // 簡易版：1つのsin()のみ使用（パフォーマンス向上）
            const sin1 = Math.sin(n) * 43758.5453;
            return Math.abs((sin1 % 1.0));
        };
        
        const iX = Math.floor(x);
        const iY = Math.floor(y);
        const iZ = Math.floor(z);
        const fX = x - iX;
        const fY = y - iY;
        const fZ = z - iZ;
        
        // smoothstep補間
        const u = fX * fX * (3.0 - 2.0 * fX);
        const v = fY * fY * (3.0 - 2.0 * fY);
        const w = fZ * fZ * (3.0 - 2.0 * fZ);
        
        // 8つのコーナーのハッシュ値を取得
        const a = hash(iX, iY, iZ);
        const b = hash(iX + 1, iY, iZ);
        const c = hash(iX, iY + 1, iZ);
        const d = hash(iX + 1, iY + 1, iZ);
        const e = hash(iX, iY, iZ + 1);
        const f = hash(iX + 1, iY, iZ + 1);
        const g = hash(iX, iY + 1, iZ + 1);
        const h = hash(iX + 1, iY + 1, iZ + 1);
        
        // 3D補間
        const x1 = a + (b - a) * u;
        const x2 = c + (d - c) * u;
        const y1 = x1 + (x2 - x1) * v;
        
        const x3 = e + (f - e) * u;
        const x4 = g + (h - g) * u;
        const y2 = x3 + (x4 - x3) * v;
        
        return y1 + (y2 - y1) * w;
    }
    
    /**
     * map関数（Processingと同じ）
     * @param {number} value - 入力値
     * @param {number} start1 - 入力範囲の開始
     * @param {number} stop1 - 入力範囲の終了
     * @param {number} start2 - 出力範囲の開始
     * @param {number} stop2 - 出力範囲の終了
     * @returns {number} マッピングされた値
     */
    _map(value, start1, stop1, start2, stop2) {
        return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
    }
    
    /**
     * 初期パーティクルデータを設定
     */
    initializeParticleData() {
        const dataSize = this.width * this.height * 4;
        const positionData = new Float32Array(dataSize);
        const colorData = new Float32Array(dataSize);
        
        if (this.placementType === 'terrain') {
            // 地形配置（Scene04用）
            const noiseScale = this.initOptions.terrainNoiseScale ?? 0.0001;
            const noiseSeed = this.initOptions.terrainNoiseSeed ?? (Math.random() * 10000.0);
            const terrainScale = this.initOptions.terrainScale ?? 5.0;
            const zRange = this.initOptions.terrainZRange ?? { min: -100, max: 100 };
            const noiseOffsetData = new Float32Array(dataSize);
            
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const index = (y * this.width + x) * 4;
                    
                    // 地形の中心を画面の中心（0, 0, 0）に合わせる
                    const px = (x - this.width / 2) * terrainScale;
                    const py = (y - this.height / 2) * terrainScale;
                    
                    // ノイズオフセットデータ（更新時用、各パーティクルで異なる値）
                    const noiseOffsetX = Math.random() * 10000.0;
                    const noiseOffsetY = Math.random() * 10000.0;
                    const noiseOffsetZ = Math.random() * 10000.0;
                    
                    // 初期化時のZ値をノイズで計算
                    const noiseX = x * noiseScale * 200.0;
                    const noiseY = y * noiseScale * 200.0;
                    const pz = this._map(this._terrainNoise(noiseX, noiseY, 0, noiseSeed), 0, 1, zRange.min, zRange.max);
                    
                    // 位置データ（基準位置のZをwに保存）
                    positionData[index] = px;
                    positionData[index + 1] = py;
                    positionData[index + 2] = pz;
                    positionData[index + 3] = pz;  // 基準位置のZ
                    
                    // 色データ（初期色、明るくする）
                    colorData[index] = 0.8;
                    colorData[index + 1] = 0.8;
                    colorData[index + 2] = 0.8;
                    colorData[index + 3] = 1.0;
                    
                    // ノイズオフセットデータを保存
                    noiseOffsetData[index] = noiseOffsetX;
                    noiseOffsetData[index + 1] = noiseOffsetY;
                    noiseOffsetData[index + 2] = noiseOffsetZ;
                    noiseOffsetData[index + 3] = 0.0;
                }
            }
            
            // ノイズオフセットテクスチャを作成
            this.noiseOffsetTexture = new THREE.DataTexture(
                noiseOffsetData,
                this.width,
                this.height,
                THREE.RGBAFormat,
                THREE.FloatType
            );
            this.noiseOffsetTexture.needsUpdate = true;
        } else if (this.placementType === 'circle') {
            // 円配置（Scene05用）
            const circleRadius = this.initOptions.circleRadius ?? 400.0;
            const circleThickness = this.initOptions.circleThickness ?? 20.0;
            const minLifetime = this.initOptions.minLifetime ?? 5.0;
            const maxLifetime = this.initOptions.maxLifetime ?? 15.0;
            
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const index = (y * this.width + x) * 4;
                    
                    // 円周上の角度を計算（0～2π）
                    const angle = (x / (this.width - 1)) * Math.PI * 2.0;
                    
                    // 円の半径にランダムなオフセットを加える（太さを表現）
                    const radiusOffset = (Math.random() - 0.5) * circleThickness;
                    const radius = circleRadius + radiusOffset;
                    
                    // 円周上の位置（XZ平面、Y=0）
                    const posX = radius * Math.cos(angle);
                    const posY = 0.0;
                    const posZ = radius * Math.sin(angle);
                    
                    // ランダムなlifetimeを設定
                    const lifetime = minLifetime + Math.random() * (maxLifetime - minLifetime);
                    
                    // 位置データ（x, y, z, lifetime）
                    positionData[index] = posX;
                    positionData[index + 1] = posY;
                    positionData[index + 2] = posZ;
                    positionData[index + 3] = lifetime;  // lifetimeをwに保存
                    
                    // 色データ（初期色、maxLifetimeをaに保存）
                    colorData[index] = 1.0;     // r
                    colorData[index + 1] = 1.0; // g
                    colorData[index + 2] = 1.0; // b
                    colorData[index + 3] = maxLifetime; // aにmaxLifetimeを保存
                }
            }
        } else {
            // 球面上に初期配置（デフォルト）
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const index = (y * this.width + x) * 4;
                    
                    // 緯度・経度を計算
                    const latitude = (y / (this.height - 1) - 0.5) * Math.PI;
                    const longitude = (x / (this.width - 1)) * Math.PI * 2;
                    
                    // 球面上の位置
                    const posX = this.baseRadius * Math.cos(latitude) * Math.cos(longitude);
                    const posY = this.baseRadius * Math.sin(latitude);
                    const posZ = this.baseRadius * Math.cos(latitude) * Math.sin(longitude);
                    
                    // 位置データ（x, y, z, baseRadius）
                    positionData[index] = posX;
                    positionData[index + 1] = posY;
                    positionData[index + 2] = posZ;
                    positionData[index + 3] = this.baseRadius;
                    
                    // 色データ（初期は青）
                    colorData[index] = 0.0;     // r
                    colorData[index + 1] = 0.5; // g
                    colorData[index + 2] = 1.0; // b
                    colorData[index + 3] = 1.0; // a
                }
            }
        }
        
        // 初期テクスチャを作成してRenderTargetにコピー
        const positionTexture = new THREE.DataTexture(
            positionData,
            this.width,
            this.height,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        positionTexture.needsUpdate = true;
        
        const colorTexture = new THREE.DataTexture(
            colorData,
            this.width,
            this.height,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        colorTexture.needsUpdate = true;
        
        // RenderTargetにコピー
        this.copyTextureToRenderTarget(positionTexture, this.positionRenderTargets[0]);
        this.copyTextureToRenderTarget(colorTexture, this.colorRenderTargets[0]);
    }
    
    /**
     * テクスチャをRenderTargetにコピー
     */
    copyTextureToRenderTarget(texture, renderTarget) {
        // 一時的なシーンとカメラを作成
        const tempScene = new THREE.Scene();
        const tempCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        // FloatTypeのテクスチャをコピーするためのシェーダーマテリアル
        const copyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                sourceTexture: { value: texture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D sourceTexture;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(sourceTexture, vUv);
                }
            `
        });
            
            const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, copyMaterial);
        tempScene.add(mesh);
        
        this.renderer.setRenderTarget(renderTarget);
        this.renderer.render(tempScene, tempCamera);
        this.renderer.setRenderTarget(null);
        
        // クリーンアップ
        tempScene.remove(mesh);
        geometry.dispose();
        copyMaterial.dispose();
    }
    
    /**
     * 更新用シェーダーを作成
     */
    createUpdateShader() {
        if (!this.shaders) {
            return;
        }
        
        // 位置更新用シェーダー（基本uniformのみ）
        const positionUniforms = {
            positionTexture: { value: null },
            colorTexture: { value: null },
            time: { value: 0.0 },
            deltaTime: { value: 0.0 },
            noiseScale: { value: 0.01 },
            noiseStrength: { value: 50.0 },
            baseRadius: { value: 400.0 },
            width: { value: this.width },
            height: { value: this.height },
            maxLifetime: { value: 15.0 },  // lifetimeの最大値（circle配置用）
            circleRadius: { value: 400.0 },  // 円の半径（circle配置用）
            circleThickness: { value: 20.0 },  // 円の太さ（circle配置用）
            placementType: { value: this.placementType === 'circle' ? 1.0 : (this.placementType === 'terrain' ? 2.0 : 0.0) },  // 0: sphere, 1: circle, 2: terrain
            pressure: { value: 0.0 }  // 圧力（0.0 = なし、正の値 = 外側に押し出す、負の値 = 内側に押し込む）
        };
        
        this.positionUpdateMaterial = new THREE.ShaderMaterial({
            uniforms: positionUniforms,
            vertexShader: this.shaders.positionUpdate.vertex,
            fragmentShader: this.shaders.positionUpdate.fragment
        });
        
        // 色更新用シェーダー（基本uniformのみ）
        const colorUniforms = {
            positionTexture: { value: null },
            colorTexture: { value: null },  // colorUpdate.fragで使用するため追加
            baseRadius: { value: 400.0 },
            deltaTime: { value: 0.0 },
            width: { value: this.width },
            height: { value: this.height },
            time: { value: 0.0 },
            maxLifetime: { value: 15.0 },  // lifetimeの最大値（circle配置用）
            placementType: { value: this.placementType === 'circle' ? 1.0 : (this.placementType === 'terrain' ? 2.0 : 0.0) },  // 0: sphere, 1: circle, 2: terrain
            circleRadius: { value: 400.0 }  // 円の半径（circle配置用、ヒートマップで使用）
        };
        
        this.colorUpdateMaterial = new THREE.ShaderMaterial({
            uniforms: colorUniforms,
            vertexShader: this.shaders.colorUpdate.vertex,
            fragmentShader: this.shaders.colorUpdate.fragment
        });
        
        // 更新用メッシュを作成
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.positionUpdateMesh = new THREE.Mesh(geometry, this.positionUpdateMaterial);
        this.colorUpdateMesh = new THREE.Mesh(geometry, this.colorUpdateMaterial);
        this.updateScene = new THREE.Scene();
        this.updateScene.add(this.positionUpdateMesh);
        this.updateScene.add(this.colorUpdateMesh);
        this.updateCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    /**
     * 描画用シェーダーを作成
     */
    createRenderShader() {
        // パーティクル用のジオメトリを作成（UV座標を使用）
        const positions = new Float32Array(this.particleCount * 3);
        const uvs = new Float32Array(this.particleCount * 2);
        const sizes = new Float32Array(this.particleCount);
        
        // 各パーティクルにUV座標を設定
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const index = y * this.width + x;
                const u = (x + 0.5) / this.width;
                const v = (y + 0.5) / this.height;
                
                uvs[index * 2] = u;
                uvs[index * 2 + 1] = v;
                
                // パーティクルサイズを設定（デフォルトは固定サイズ）
                // シーン固有のサイズ設定が必要な場合は、シーン側で処理する
                sizes[index] = this.particleSize;
            }
        }
        
        this.particleGeometry = new THREE.BufferGeometry();
        this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.particleGeometry.setAttribute('particleUv', new THREE.BufferAttribute(uvs, 2));
        this.particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // 描画用シェーダーマテリアル
        if (!this.shaders) {
            return;
        }
        
        // ShaderMaterialを使用（RawShaderMaterialは問題があったため元に戻す）
        // ライティングを有効化
        // 初期テクスチャを作成（nullの代わりにダミーテクスチャを使用）
        const dummyTexture = new THREE.DataTexture(
            new Float32Array(4),
            1,
            1,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        dummyTexture.needsUpdate = true;
        
        this.particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                positionTexture: { value: dummyTexture },
                colorTexture: { value: dummyTexture },
                width: { value: this.width },
                height: { value: this.height }
            },
            vertexShader: this.shaders.particleRender.vertex,
            fragmentShader: this.shaders.particleRender.fragment,
            transparent: false,  // 完全に不透明にする
            vertexColors: true,
            lights: false,  // ライティングを無効化（シェーダーで使用していないため）
            depthTest: true,  // 深度テストを有効化（裏側を隠す）
            depthWrite: true  // 深度バッファに書き込み（裏側を隠す）
        });
        
        this.particleSystem = new THREE.Points(this.particleGeometry, this.particleMaterial);
    }
    
    /**
     * パーティクルを更新（GPU側で計算）
     */
    update(uniforms) {
        // 初期化が完了していない場合は何もしない
        if (!this.particleMaterial || !this.particleMaterial.uniforms) {
            return;
        }
        
        // 位置更新用シェーダーにuniformを設定
        if (this.positionUpdateMaterial && this.positionUpdateMaterial.uniforms) {
            if (this.positionUpdateMaterial.uniforms.time) {
                this.positionUpdateMaterial.uniforms.time.value = uniforms.time || 0.0;
            }
            if (this.positionUpdateMaterial.uniforms.noiseScale) {
                this.positionUpdateMaterial.uniforms.noiseScale.value = uniforms.noiseScale || 1.0;  // 緩めのノイズ（デフォルト値）
            }
            if (this.positionUpdateMaterial.uniforms.noiseStrength) {
                this.positionUpdateMaterial.uniforms.noiseStrength.value = uniforms.noiseStrength || 50.0;  // Processingと同じデフォルト値
            }
            if (this.positionUpdateMaterial.uniforms.baseRadius) {
                this.positionUpdateMaterial.uniforms.baseRadius.value = uniforms.baseRadius || 400.0;
            }
            if (this.positionUpdateMaterial.uniforms.deltaTime) {
                this.positionUpdateMaterial.uniforms.deltaTime.value = uniforms.deltaTime || 0.0;
            }
            if (this.positionUpdateMaterial.uniforms.maxLifetime) {
                this.positionUpdateMaterial.uniforms.maxLifetime.value = uniforms.maxLifetime || 15.0;
            }
            if (this.positionUpdateMaterial.uniforms.circleRadius) {
                this.positionUpdateMaterial.uniforms.circleRadius.value = uniforms.circleRadius || 400.0;
            }
            if (this.positionUpdateMaterial.uniforms.circleThickness) {
                this.positionUpdateMaterial.uniforms.circleThickness.value = uniforms.circleThickness || 20.0;
            }
            // placementTypeは初期化時に設定されるため、updateでは更新しない
            
            // 汎用的なuniform設定（uniformsオブジェクトに含まれるすべてのuniformを設定）
            // シーン固有のuniformは、シーン側でaddPositionUniform()を使って追加する
            for (const key in uniforms) {
                if (key === 'punchSpheres') {
                    // punchSpheresは特別な処理が必要なので、シーン側で処理する
                    continue;
                }
                if (this.positionUpdateMaterial.uniforms[key]) {
                    const value = uniforms[key];
                    if (value instanceof THREE.Vector3) {
                        this.positionUpdateMaterial.uniforms[key].value.copy(value);
                    } else if (value instanceof THREE.Texture) {
                        this.positionUpdateMaterial.uniforms[key].value = value;
                    } else {
                        this.positionUpdateMaterial.uniforms[key].value = value;
                    }
                }
            }
        }
        
        // 色更新用シェーダーにuniformを設定
        if (this.colorUpdateMaterial && this.colorUpdateMaterial.uniforms) {
            if (this.colorUpdateMaterial.uniforms.baseRadius) {
                this.colorUpdateMaterial.uniforms.baseRadius.value = uniforms.baseRadius || 400.0;
            }
            if (this.colorUpdateMaterial.uniforms.maxLifetime) {
                this.colorUpdateMaterial.uniforms.maxLifetime.value = uniforms.maxLifetime || 15.0;
            }
            
            // 汎用的なuniform設定（uniformsオブジェクトに含まれるすべてのuniformを設定）
            // シーン固有のuniformは、シーン側でaddColorUniform()を使って追加する
            for (const key in uniforms) {
                if (this.colorUpdateMaterial.uniforms[key]) {
                    const value = uniforms[key];
                    if (value instanceof THREE.Vector3) {
                        this.colorUpdateMaterial.uniforms[key].value.copy(value);
                    } else if (value instanceof THREE.Texture) {
                        this.colorUpdateMaterial.uniforms[key].value = value;
                    } else {
                        this.colorUpdateMaterial.uniforms[key].value = value;
                    }
                }
            }
        }
        
        // 現在のバッファから読み取り
        const readPositionBuffer = this.currentPositionBuffer;
        
        // 書き込み先バッファ
        const writePositionBuffer = 1 - readPositionBuffer;
        
        // 位置を更新
        if (this.positionUpdateMaterial && this.positionUpdateMaterial.uniforms && 
            this.positionRenderTargets && this.positionRenderTargets[readPositionBuffer]) {
            if (this.positionUpdateMaterial.uniforms.positionTexture) {
                this.positionUpdateMaterial.uniforms.positionTexture.value = this.positionRenderTargets[readPositionBuffer].texture;
            }
            // colorTextureを設定（読み取りバッファから）
            if (this.positionUpdateMaterial.uniforms.colorTexture && 
                this.colorRenderTargets && this.colorRenderTargets[this.currentColorBuffer]) {
                this.positionUpdateMaterial.uniforms.colorTexture.value = this.colorRenderTargets[this.currentColorBuffer].texture;
            }
            this.positionUpdateMesh.visible = true;
            this.colorUpdateMesh.visible = false;
            
            this.renderer.setRenderTarget(this.positionRenderTargets[writePositionBuffer]);
            this.renderer.render(this.updateScene, this.updateCamera);
        }
        
        // 色を更新（更新された位置テクスチャから色を計算）
        if (this.colorUpdateMaterial && this.colorUpdateMaterial.uniforms && 
            this.positionRenderTargets && this.positionRenderTargets[writePositionBuffer]) {
            if (this.colorUpdateMaterial.uniforms.positionTexture) {
                this.colorUpdateMaterial.uniforms.positionTexture.value = this.positionRenderTargets[writePositionBuffer].texture;
            }
            // colorTextureを設定（読み取りバッファから）
            if (this.colorUpdateMaterial.uniforms.colorTexture && 
                this.colorRenderTargets && this.colorRenderTargets[this.currentColorBuffer]) {
                this.colorUpdateMaterial.uniforms.colorTexture.value = this.colorRenderTargets[this.currentColorBuffer].texture;
            }
            // deltaTime, width, height, timeを設定
            if (this.colorUpdateMaterial.uniforms.deltaTime) {
                this.colorUpdateMaterial.uniforms.deltaTime.value = uniforms.deltaTime || 0.0;
            }
            if (this.colorUpdateMaterial.uniforms.width) {
                this.colorUpdateMaterial.uniforms.width.value = this.width;
            }
            if (this.colorUpdateMaterial.uniforms.height) {
                this.colorUpdateMaterial.uniforms.height.value = this.height;
            }
            if (this.colorUpdateMaterial.uniforms.time) {
                this.colorUpdateMaterial.uniforms.time.value = uniforms.time || 0.0;
            }
            this.positionUpdateMesh.visible = false;
            this.colorUpdateMesh.visible = true;
            
            this.renderer.setRenderTarget(this.colorRenderTargets[writePositionBuffer]);
            this.renderer.render(this.updateScene, this.updateCamera);
        }
        
        this.renderer.setRenderTarget(null);
        
        // バッファをスワップ
        this.currentPositionBuffer = writePositionBuffer;
        this.currentColorBuffer = writePositionBuffer;
        
        // 描画用シェーダーにテクスチャを設定
        if (this.particleMaterial && this.particleMaterial.uniforms) {
            if (this.particleMaterial.uniforms.positionTexture && 
                this.positionRenderTargets && this.positionRenderTargets[this.currentPositionBuffer] &&
                this.positionRenderTargets[this.currentPositionBuffer].texture) {
                this.particleMaterial.uniforms.positionTexture.value = this.positionRenderTargets[this.currentPositionBuffer].texture;
            }
            if (this.particleMaterial.uniforms.colorTexture && 
                this.colorRenderTargets && this.colorRenderTargets[this.currentColorBuffer] &&
                this.colorRenderTargets[this.currentColorBuffer].texture) {
                this.particleMaterial.uniforms.colorTexture.value = this.colorRenderTargets[this.currentColorBuffer].texture;
            }
        }
    }
    
    
    /**
     * パーティクルシステムを取得
     */
    getParticleSystem() {
        return this.particleSystem;
    }
    
    /**
     * 位置テクスチャを取得（シャドウ用）
     */
    getPositionTexture() {
        if (this.positionRenderTargets && this.positionRenderTargets[this.currentPositionBuffer]) {
            return this.positionRenderTargets[this.currentPositionBuffer].texture;
        }
        return null;
    }
    
    /**
     * 色テクスチャを取得（線描画用）
     */
    getColorTexture() {
        if (this.colorRenderTargets && this.colorRenderTargets[this.currentColorBuffer]) {
            return this.colorRenderTargets[this.currentColorBuffer].texture;
        }
        return null;
    }
    
    /**
     * 位置更新用シェーダーマテリアルを取得（シーン固有のuniform設定用）
     */
    getPositionUpdateMaterial() {
        return this.positionUpdateMaterial;
    }
    
    /**
     * 色更新用シェーダーマテリアルを取得（シーン固有のuniform設定用）
     */
    getColorUpdateMaterial() {
        return this.colorUpdateMaterial;
    }
    
    /**
     * 位置更新用シェーダーにuniformを追加（シーン固有のuniform設定用）
     * @param {string} name - uniform名
     * @param {*} value - uniform値
     */
    addPositionUniform(name, value) {
        if (this.positionUpdateMaterial && this.positionUpdateMaterial.uniforms) {
            this.positionUpdateMaterial.uniforms[name] = { value: value };
        }
    }
    
    /**
     * 色更新用シェーダーにuniformを追加（シーン固有のuniform設定用）
     * @param {string} name - uniform名
     * @param {*} value - uniform値
     */
    addColorUniform(name, value) {
        if (this.colorUpdateMaterial && this.colorUpdateMaterial.uniforms) {
            this.colorUpdateMaterial.uniforms[name] = { value: value };
        }
    }
    
    /**
     * ラインシステムを作成（チャンク分割による非同期化）
     * @param {Object} options - オプション
     * @param {number} options.linewidth - 線の太さ（デフォルト: 5）
     * @param {Object} options.additionalUniforms - 追加のuniform（デフォルト: {}）
     * @param {number} options.chunkSize - チャンクサイズ（1フレームで処理する線の数、デフォルト: 50）
     * @param {THREE.Scene} options.scene - シーン（ラインシステムを追加する先）
     * @returns {Promise<THREE.Group>} ラインシステムのグループ
     */
    createLineSystem(options = {}) {
        const {
            linewidth = 5,
            additionalUniforms = {},
            chunkSize = 50,
            scene = null
        } = options;
        
        // シェーダーを読み込む（非同期）
        const shaderBasePath = `/shaders/${this.shaderPath}/`;
        return Promise.all([
            fetch(`${shaderBasePath}lineRender.vert`).then(r => r.text()),
            fetch(`${shaderBasePath}lineRender.frag`).then(r => r.text())
        ]).then(([vertexShader, fragmentShader]) => {
            return this.createLineSystemWithShaders(vertexShader, fragmentShader, {
                linewidth,
                additionalUniforms,
                chunkSize,
                scene
            });
        }).catch(err => {
            return null;
        });
    }
    
    /**
     * シェーダーを使って線描画システムを作成（チャンク分割版）
     * @param {string} vertexShader - 頂点シェーダー
     * @param {string} fragmentShader - フラグメントシェーダー
     * @param {Object} options - オプション
     * @returns {Promise<THREE.Group>} ラインシステムのグループ
     */
    createLineSystemWithShaders(vertexShader, fragmentShader, options = {}) {
        const {
            linewidth = 5,
            additionalUniforms = {},
            scene = null
        } = options;
        
        const lineGeometries = [];
        const lineMaterials = [];
        
        // 縦線：各行ごとに、左右の列を結ぶ線
        for (let y = 0; y < this.rows - 1; y++) {
            const vertexCount = this.cols * 2;
            const rowIndices = new Float32Array(vertexCount);
            const colIndices = new Float32Array(vertexCount);
            
            for (let x = 0; x < this.cols; x++) {
                const index = x * 2;
                rowIndices[index] = y;
                colIndices[index] = x;
                rowIndices[index + 1] = y + 1;
                colIndices[index + 1] = x;
            }
            
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(vertexCount * 3);
            const colors = new Float32Array(vertexCount * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('rowIndex', new THREE.BufferAttribute(rowIndices, 1));
            geometry.setAttribute('colIndex', new THREE.BufferAttribute(colIndices, 1));
            
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    positionTexture: { value: null },
                    colorTexture: { value: null },
                    width: { value: this.cols },
                    height: { value: this.rows },
                    ...additionalUniforms
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                transparent: true,
                vertexColors: true,
                linewidth: linewidth
            });
            
            lineGeometries.push(geometry);
            lineMaterials.push(material);
        }
        
        // 横線：各列ごとに、上下の行を結ぶ線
        for (let x = 0; x < this.cols - 1; x++) {
            const vertexCount = this.rows * 2;
            const rowIndices = new Float32Array(vertexCount);
            const colIndices = new Float32Array(vertexCount);
            
            for (let y = 0; y < this.rows; y++) {
                const index = y * 2;
                rowIndices[index] = y;
                colIndices[index] = x;
                rowIndices[index + 1] = y;
                colIndices[index + 1] = x + 1;
            }
            
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(vertexCount * 3);
            const colors = new Float32Array(vertexCount * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('rowIndex', new THREE.BufferAttribute(rowIndices, 1));
            geometry.setAttribute('colIndex', new THREE.BufferAttribute(colIndices, 1));
            
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    positionTexture: { value: null },
                    colorTexture: { value: null },
                    width: { value: this.cols },
                    height: { value: this.rows },
                    ...additionalUniforms
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                transparent: true,
                vertexColors: true,
                linewidth: linewidth
            });
            
            lineGeometries.push(geometry);
            lineMaterials.push(material);
        }
        
        // すべての線をグループに追加
        this.lineSystem = new THREE.Group();
        for (let i = 0; i < lineGeometries.length; i++) {
            const line = new THREE.LineSegments(lineGeometries[i], lineMaterials[i]);
            this.lineSystem.add(line);
        }
        
        if (scene) {
            scene.add(this.lineSystem);
        }
        
        return Promise.resolve(this.lineSystem);
    }
    
    /**
     * ラインシステムを更新（テクスチャを更新）
     */
    updateLineSystem() {
        if (!this.lineSystem) return;
        
        const positionTexture = this.getPositionTexture();
        const colorTexture = this.getColorTexture ? this.getColorTexture() : null;
        
        if (!positionTexture || !colorTexture) return;
        
        this.lineSystem.children.forEach(line => {
            if (line.material && line.material.uniforms) {
                if (line.material.uniforms.positionTexture) {
                    line.material.uniforms.positionTexture.value = positionTexture;
                }
                if (line.material.uniforms.colorTexture) {
                    line.material.uniforms.colorTexture.value = colorTexture;
                }
            }
        });
    }
    
    /**
     * ラインシステムを取得
     * @returns {THREE.Group|null} ラインシステムのグループ
     */
    getLineSystem() {
        return this.lineSystem;
    }
    
    /**
     * リソースを解放
     */
    dispose() {
        if (this.positionRenderTargets[0]) this.positionRenderTargets[0].dispose();
        if (this.positionRenderTargets[1]) this.positionRenderTargets[1].dispose();
        if (this.colorRenderTargets[0]) this.colorRenderTargets[0].dispose();
        if (this.colorRenderTargets[1]) this.colorRenderTargets[1].dispose();
        if (this.positionUpdateMaterial) this.positionUpdateMaterial.dispose();
        if (this.colorUpdateMaterial) this.colorUpdateMaterial.dispose();
        if (this.particleMaterial) this.particleMaterial.dispose();
        if (this.particleGeometry) this.particleGeometry.dispose();
        if (this.noiseOffsetTexture) {
            this.noiseOffsetTexture.dispose();
            this.noiseOffsetTexture = null;
        }
        if (this.positionUpdateMesh) {
            this.positionUpdateMesh.geometry.dispose();
            if (this.updateScene) {
                this.updateScene.remove(this.positionUpdateMesh);
            }
        }
        if (this.colorUpdateMesh) {
            this.colorUpdateMesh.geometry.dispose();
            if (this.updateScene) {
                this.updateScene.remove(this.colorUpdateMesh);
            }
        }
        if (this.lineSystem) {
            this.lineSystem.children.forEach(line => {
                if (line.geometry) line.geometry.dispose();
                if (line.material) line.material.dispose();
            });
            this.lineSystem = null;
        }
    }
}
