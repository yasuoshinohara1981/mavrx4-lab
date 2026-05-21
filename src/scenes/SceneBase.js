/**
 * シーンの基底クラス
 * すべてのシーンはこのクラスを継承
 */

import * as THREE from 'three';
import { CameraParticle } from '../lib/CameraParticle.js';
import { HUD } from '../lib/HUD.js';
import { CalloutSystem } from '../lib/CalloutSystem.js';
import { ColorInversion } from '../lib/ColorInversion.js';
import { GridRuler3D } from '../lib/GridRuler3D.js';
import { debugLog } from '../lib/DebugLogger.js';
import { parseChordHitsFromOscArgs } from '../lib/oscChordUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SensorFilmGrainPass } from '../lib/SensorFilmGrainPass.js';
import { FilmLookPass } from '../lib/FilmLookPass.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { createFlareTexture, createGhostTexture } from '../lib/LensflareTextures.js';
import { SkyDome } from '../lib/SkyDome.js';

export class SceneBase {
    constructor(renderer, camera) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = null;
        this.title = 'Base Scene';
        
        // 背景色の制御
        this.backgroundWhite = false;
        this.backgroundWhiteEndTime = 0;
        
        // カメラパーティクル
        this.cameraParticles = [];
        this.currentCameraIndex = 0;
        this.cameraTriggerCounter = 0;
        this.cameraTriggerInterval = 180;
        
        // HUD
        this.hud = null;
        this.showHUD = true;
        this.hudPositionMode = 0;  // 0=正方形, 1=16:9左, 2=9:16右, 3=非表示
        this.calloutSystem = new CalloutSystem(); // 共通コールアウトシステム
        this.lastFrameTime = null;  // FPS計算用
        this.oscStatus = 'Unknown';  // OSC接続状態
        this.phase = 0;  // OSCの/phase/メッセージで受け取る値
        this.actualTick = 0;  // OSCの/actual_tick/メッセージで受け取る値（96小節で1ループ）
        this.kitNo = 0;  // シーン固有のキット番号（各シーンでハードコーディング）
        this.selectedKitNo = 0;  // OSCの/kit/メッセージで受け取る値（選択されたキット番号）
        /** `/chord` 専用バースト（複数同時ノート）を `handleChordBurst` に回すか */
        this.chordBurstEffectEnabled = true;
        /** Ctrl+数字のシーンバンク（SceneManagerと同期） */
        this.sceneBankIndex = 0;
        /** 登録シーン総数（HUDのバンク表示用・実際に存在するシーン数） */
        this.totalSceneCount = 21;
        /** HUD上の最大スロット数（100 = 10バンク×10） */
        this.maxSceneSlots = 100;
        /** 0始まりのシーンインデックス（SceneManagerが切替時に設定） */
        this.sceneIndex = 0;
        this.particleCount = 0;  // パーティクル数
        this.time = 0.0;  // 時間変数（サブクラスで設定）
        
        // 色反転エフェクト（共通化）
        this.colorInversion = null;
        /** true のシーンではトラック2が色反転ではなく全画面ストロボ（Scene3 など） */
        this.useTrack2Strobe = false;
        this.strobeFlashPass = null;
        /** トラック2ストロボの現在強度（0〜1）。実ライト連動用にサブクラスが参照 */
        this.strobeFlashIntensity = 0;
        /** トラック2 OSC 用のフラッシュ減衰値（0〜1） */
        this._strobeImpulse = 0;
        /** トラック2 ストロボの終了時刻（デュレーション用） */
        this._strobeEndTime = 0;
        /** 数字キー2トグルON中にキーを押し続けている間のベース光量（キーアップで解除） */
        this._strobeFromKeypad = false;
        
        /** 物理的なストロボライト（PointLight）を使用するかどうか */
        this.usePhysicalStrobe = false;
        /** 物理ストロボライトのインスタンス */
        this.strobeCameraSpot = null;
        /** 物理ストロボのピーク強度 */
        this.strobePhysicalPeak = 450.0;
        
        // ポストプロセッシングエフェクト（共通化）
        this.composer = null;
        this.chromaticAberrationPass = null;
        this.chromaticAberrationAmount = 0.0;  // 色収差の強度（0.0〜1.0）
        this.chromaticAberrationEndTime = 0;  // エフェクト終了時刻（サスティン用）
        this.chromaticAberrationKeyPressed = false;  // キーが押されているか
        
        this.glitchPass = null;
        this.glitchAmount = 0.0;  // グリッチの強度（0.0〜1.0）
        this.glitchEndTime = 0;  // エフェクト終了時刻（サスティン用）
        this.glitchKeyPressed = false;  // キーが押されているか
        
        this.bokehPass = null; // 被写界深度（DOF）用のパス
        this.useDOF = false;   // サブクラスで有効化するためのフラグ
        this.filmLookPass = null;  // 軽いCA＋ソフト（フィルムグレイン直前）
        this.filmPass = null;  // フィルムグレイン用のパス
        this.useFilmGrain = false;  // サブクラスで有効化するためのフラグ（Scene12以降でON）
        this.lensFlare = null;      // レンズフレアオブジェクト
        this.lensFlareLight = null; // フレア用の光源（位置決め用）
        this.useLensFlare = false;  // サブクラスで有効化するためのフラグ
        this.skyDome = null;        // HDRIスカイドーム（Scene19のみ有効）
        this.useSkyDome = false;    // サブクラスで有効化するためのフラグ
        this.dofParams = {
            focus: 1000,
            aperture: 0.000005,
            maxblur: 0.003
        };
        this.raycaster = new THREE.Raycaster(); // オートフォーカス用
        
        // 表示設定
        this.SHOW_PARTICLES = false;
        this.SHOW_LINES = true;
        this.SHOW_CAMERA_DEBUG = false;  // カメラパーティクルのデバッグ表示（デフォルトオフ、コードから切り替え可）
        this.SHOW_CAMERA_DEBUG_CIRCLES = false;  // カメラ周りのCircle表示（デフォルトオフ）
        
        // カメラデバッグ用オブジェクト
        this.cameraDebugGroup = null;
        this.cameraDebugSpheres = [];
        this.cameraDebugLines = [];
        this.cameraDebugCircles = [];  // 周囲のCircle
        this.cameraDebugCanvas = null;
        this.cameraDebugCtx = null;
        this.cameraDebugTextPositions = []; // テキスト位置のスムーズ化用
        
        // 座標軸ヘルパー（AxesHelper）
        this.axesHelper = null;
        this.SHOW_AXES = false;  // デバッグ用：座標軸を表示するか
        
        // 3Dグリッドとルーラー
        this.gridRuler3D = null;
        this.showGridRuler3D = false;  // g/Gキーでトグル
        
        // スクリーンショット用テキスト
        this.screenshotText = '';
        this.showScreenshotText = false;
        this.pendingScreenshot = false;
        this.screenshotTextEndTime = 0;
        this.screenshotTextX = 0;
        this.screenshotTextY = 0;
        this.screenshotTextSize = 48;
        this.pendingScreenshotFilename = '';
        this.screenshotCanvas = null;
        this.screenshotCtx = null;
        this.screenshotExecuting = false;  // スクリーンショット実行中フラグ
        
        // エフェクト状態管理（トラック1-9のオン/オフ）
        // デフォルト：すべてオン（シーン側で上書き可）
        this.trackEffects = {
            1: true,   // カメラ切り替え（表示のみ、実際の切り替えは別処理）
            2: true,   // 色反転
            3: true,   // 色収差（オン）
            4: true,   // グリッチ（オン）
            5: true,   // シーン固有のエフェクト（爆発、圧力など）
            6: true,   // 予備
            7: true,   // 予備
            8: true,   // 予備
            9: true    // 予備
        };
        
        this.init();
    }
    
    init() {
        // シーンを作成
        this.scene = new THREE.Scene();
        
        // デバッグ用シーンを作成（エフェクトから除外するため）
        this.debugScene = new THREE.Scene();
        // debugSceneの背景を確実に透明にする（sceneが上書きされないようにするため）
        this.debugScene.background = null;
        
        // カメラとHUDを初期化
        this.initializeCameraAndHUD();
        
        // カメラデバッグ用グループを作成（debugSceneに追加してライティングを有効化）
        this.cameraDebugGroup = new THREE.Group();
        this.debugScene.add(this.cameraDebugGroup);
        
        // debugSceneにライトを追加（MeshStandardMaterial用）
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.debugScene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1000, 2000, 1000);
        this.debugScene.add(directionalLight);
        
        // 座標軸ヘルパーを作成（元のsceneに追加）
        this.axesHelper = new THREE.AxesHelper(1000);  // 1000の長さの軸
        this.axesHelper.visible = this.SHOW_AXES;
        this.scene.add(this.axesHelper);
    }

    /**
     * カメラデバッグ用Canvasを作成（必要になったタイミングで作成）
     */
    ensureCameraDebugCanvas() {
        if (this.cameraDebugCanvas) return;

        this.cameraDebugCanvas = document.createElement('canvas');
        this.cameraDebugCanvas.width = window.innerWidth;
        this.cameraDebugCanvas.height = window.innerHeight;
        this.cameraDebugCanvas.style.position = 'absolute';
        this.cameraDebugCanvas.style.top = '0';
        this.cameraDebugCanvas.style.left = '0';
        this.cameraDebugCanvas.style.pointerEvents = 'none';
        this.cameraDebugCanvas.style.zIndex = '1000';
        this.cameraDebugCtx = this.cameraDebugCanvas.getContext('2d');
        this.cameraDebugCtx.font = '16px monospace';
        this.cameraDebugCtx.textAlign = 'center';
        this.cameraDebugCtx.textBaseline = 'bottom';
        document.body.appendChild(this.cameraDebugCanvas);
        
        // カメラデバッグ用オブジェクトを初期化
        this.initCameraDebugObjects();
    }
    
    /**
     * カメラとHUDの初期化（共通処理）
     */
    initializeCameraAndHUD() {
        // カメラ用パーティクルを初期化（8個）
        for (let i = 0; i < 8; i++) {
            const cameraParticle = new CameraParticle();
            this.setupCameraParticleDistance(cameraParticle);
            this.cameraParticles.push(cameraParticle);
        }
        this.currentCameraIndex = 0;
        
        // HUDを初期化
        this.hud = new HUD();
        
        // スクリーンショット用Canvasを初期化
        this.initScreenshotCanvas();
    }
    
    /**
     * スクリーンショット用Canvasを初期化
     */
    initScreenshotCanvas() {
        if (this.screenshotCanvas) return;
        
        this.screenshotCanvas = document.createElement('canvas');
        this.screenshotCanvas.style.position = 'absolute';
        this.screenshotCanvas.style.top = '0';
        this.screenshotCanvas.style.left = '0';
        this.screenshotCanvas.style.pointerEvents = 'none';
        this.screenshotCanvas.style.zIndex = '1000';
        this.screenshotCtx = this.screenshotCanvas.getContext('2d');
        
        // レンダラーの親要素に追加
        if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentElement) {
            this.renderer.domElement.parentElement.appendChild(this.screenshotCanvas);
        }
        
        this.resizeScreenshotCanvas();
    }
    
    /**
     * スクリーンショット用Canvasのサイズを更新
     */
    resizeScreenshotCanvas() {
        if (!this.screenshotCanvas || !this.renderer) return;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        const width = size.width;
        const height = size.height;
        
        this.screenshotCanvas.width = width;
        this.screenshotCanvas.height = height;
        this.screenshotCanvas.style.width = `${width}px`;
        this.screenshotCanvas.style.height = `${height}px`;
    }
    
    /**
     * カメラパーティクルの距離パラメータを設定（各Sceneでオーバーライド可能）
     */
    setupCameraParticleDistance(cameraParticle) {
        // デフォルト値を使用（各Sceneで必要に応じてオーバーライド）
    }
    
    /**
     * 被写界深度（DOF）エフェクトを初期化
     */
    initDOF(params = {}) {
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
        }

        // パラメータの統合
        this.dofParams = { ...this.dofParams, ...params };

        // 既存のパスがあれば削除
        if (this.bokehPass) {
            this.composer.removePass(this.bokehPass);
        }

        this.bokehPass = new BokehPass(this.scene, this.camera, {
            focus: this.dofParams.focus,
            aperture: this.dofParams.aperture,
            maxblur: this.dofParams.maxblur,
            width: window.innerWidth,
            height: window.innerHeight
        });

        this.bokehPass.enabled = this.useDOF;
        this.composer.addPass(this.bokehPass);
        
        debugLog('effect', 'DOF (BokehPass) initialized');
    }

    /**
     * フィルムグレインを追加（useFilmGrainがtrueの場合のみ）
     * initPostProcessingの最後で呼ぶこと
     * @param {number} [intensity=0.35] - グレイン強度
     * @param {boolean} [grayscale=false] - グレースケール化するか
     */
    addFilmGrainIfEnabled(intensity = 0.35, grayscale = false) {
        if (!this.useFilmGrain) return;
        if (!this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
        }
        if (this.filmPass) return; // 既に追加済み
        // 色収差のみ（soften=0）。ぼかし混ぜは縦横筋の原因になるのでデフォルトオフ。
        const filmLookCa = 0.0004;
        const filmLookSoften = 0.0;
        if (!this.filmLookPass && (filmLookCa > 0.0 || filmLookSoften > 0.0)) {
            this.filmLookPass = new FilmLookPass({ caAmount: filmLookCa, soften: filmLookSoften });
            this.composer.addPass(this.filmLookPass);
            debugLog('effect', 'FilmLookPass (CA only) added');
        }
        this.filmPass = new SensorFilmGrainPass(intensity, grayscale);
        if (this.bokehPass) {
            this.filmPass.bindBokehPass(this.bokehPass, () => this.useDOF && this.bokehPass && this.bokehPass.enabled);
        }
        this.composer.addPass(this.filmPass);
        debugLog('effect', 'FilmGrain (SensorFilmGrainPass) added');
    }

    /**
     * レンズフレアを追加（useLensFlareがtrueの場合のみ）
     * setup()の後、シーンのライト設定が完了した後に呼ぶこと
     * @param {Object} [options] - オプション
     * @param {THREE.Vector3} [options.position] - フレアの光源位置（デフォルト: 0, 800, 500）
     * @param {number} [options.intensity=0.3] - フレアの強さ（控えめに）
     */
    addLensFlareIfEnabled(options = {}) {
        if (!this.useLensFlare) return;
        if (this.lensFlare) return; // 既に追加済み

        const position = options.position || new THREE.Vector3(0, 800, 500);
        const intensity = options.intensity ?? 0.3;

        // フレア用の光源（強度0で位置決めのみ、シーン照明には影響しない）
        this.lensFlareLight = new THREE.PointLight(0xffffff, 0, 10000);
        this.lensFlareLight.position.copy(position);
        this.scene.add(this.lensFlareLight);

        // プロシージャルテクスチャで軽量フレアを構築
        const tex0 = createFlareTexture(128, 0.4);
        const tex1 = createFlareTexture(64, 0.6);
        const tex2 = createGhostTexture(32, 128);

        this.lensFlare = new Lensflare();
        this.lensFlare.addElement(new LensflareElement(tex0, 200 * intensity, 0, new THREE.Color(0xffffff)));
        this.lensFlare.addElement(new LensflareElement(tex1, 80 * intensity, 0.4, new THREE.Color(0xffffee)));
        this.lensFlare.addElement(new LensflareElement(tex2, 60 * intensity, 0.7, new THREE.Color(0xffffdd)));

        this.lensFlareLight.add(this.lensFlare);
        debugLog('effect', 'LensFlare added');
    }

    /**
     * HDRIスカイドームを適用（useSkyDomeがtrueの場合のみ）
     * 使用するHDRIは引数でシーン側から渡す
     * @param {string} hdriUrl - HDRIファイルのURL（importで取得したものを渡す）
     * @param {Object} [options] - SkyDome.setupのオプション
     * @returns {Promise<THREE.Texture|null>} envMap（マテリアル用）、無効時はnull
     */
    async addSkyDomeIfEnabled(hdriUrl, options = {}) {
        if (!this.useSkyDome) return null;
        if (this.skyDome) return this.skyDome.envMap; // 既に適用済み

        this.skyDomeLightConfig = {
            position: options.sunPosition ? new THREE.Vector3().copy(options.sunPosition) : null,
            color: options.sunColor ?? 0xffffff,
            intensity: options.sunIntensity ?? 0.5
        };

        this.skyDome = new SkyDome(this.scene);
        const envMap = await this.skyDome.setup(hdriUrl, options);
        debugLog('effect', 'SkyDome added');
        return envMap;
    }

    /**
     * オートフォーカスの更新
     * @param {Array} targetObjects - レイキャスト対象のオブジェクト配列
     */
    updateAutoFocus(targetObjects = []) {
        if (!this.useDOF || !this.bokehPass || !this.bokehPass.enabled) return;

        // nullやundefinedを除外
        const validObjects = targetObjects.filter(obj => obj != null);
        if (validObjects.length === 0) return;

        this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
        const intersects = this.raycaster.intersectObjects(validObjects, true);
        
        let targetDistance = this.dofParams.focus;
        if (intersects.length > 0) {
            targetDistance = intersects[0].distance;
        }

        const currentFocus = this.bokehPass.uniforms.focus.value;
        this.bokehPass.uniforms.focus.value = currentFocus + (targetDistance - currentFocus) * 0.1;
    }

    /**
     * セットアップ処理（シーン切り替え時に呼ばれる）
     */
    async setup() {
        // 色反転エフェクトを初期化（すべてのシーンで使用可能）
        // 非同期で実行してブロッキングを防ぐ
        debugLog('colorInversion', 'SceneBase.setup: 初期化開始');
        this.colorInversion = new ColorInversion(this.renderer, this.scene, this.camera);
        debugLog('colorInversion', 'SceneBase.setup: インスタンス作成完了');
        
        // init()はコンストラクタで呼ばれるが、非同期処理が完了するまで待つ
        // シェーダーの読み込みが完了するまで待つ（最大2秒）
        // ただし、待機中もフレームをブロックしないようにする
        let waitCount = 0;
        while (this.colorInversion && !this.colorInversion.initialized && waitCount < 100) {
            await new Promise(resolve => setTimeout(resolve, 20));
            waitCount++;
        }
        if (this.colorInversion && this.colorInversion.initialized) {
            debugLog('colorInversion', 'SceneBase.setup: 初期化完了');
        }
        
        // ポストプロセッシングエフェクトを初期化（すべてのシーンで使用可能）
        // 非同期で実行（awaitしないで、バックグラウンドで実行）
        // サブクラスでinitChromaticAberration()をオーバーライドしている場合は、そのメソッドが呼ばれる
        // オーバーライドしていない場合は、親クラスのメソッドが呼ばれる
        try {
            if (this.initChromaticAberration && typeof this.initChromaticAberration === 'function') {
                const initPromise = this.initChromaticAberration();
                if (initPromise && initPromise instanceof Promise) {
                    initPromise.catch(err => {
                        console.error('SceneBase.setup: initChromaticAberrationエラー:', err);
                    });
                }
            }
        } catch (err) {
            console.error('SceneBase.setup: initChromaticAberration呼び出しエラー:', err);
        }
        
        // エフェクトの初期状態（trackEffects に同期。色収差/グリッチは非同期初期化後に再同期）
        this.initializeEffectStates();
        
        // サブクラスで実装
    }
    
    /**
     * カメラパーティクルの距離パラメータを設定（共通処理）
     * サブクラスでオーバーライド可能
     */
    setupCameraParticleDistances() {
        if (this.cameraParticles) {
            for (const cameraParticle of this.cameraParticles) {
                this.setupCameraParticleDistance(cameraParticle);
            }
        }
    }
    
    /**
     * trackEffects[2–4] を色反転・色収差・グリッチのパスに反映する
     * （initChromaticAberration 完了後にも呼ぶ）
     */
    applyTrackEffectsToPostPasses() {
        if (this.colorInversion && this.colorInversion.initialized) {
            if (this.useTrack2Strobe) {
                this.colorInversion.setEnabled(false);
                this.colorInversion.endTime = 0;
                if (this.colorInversion.inversionPass) {
                    this.colorInversion.inversionPass.enabled = false;
                }
            } else {
                const on = !!this.trackEffects[2];
                this.colorInversion.setEnabled(on);
                this.colorInversion.endTime = 0;
                if (this.colorInversion.inversionPass) {
                    this.colorInversion.inversionPass.enabled = on;
                }
            }
        }

        if (this.useTrack2Strobe && this.strobeFlashPass && !this.trackEffects[2]) {
            this._strobeImpulse = 0;
            this._strobeFromKeypad = false;
            this.strobeFlashPass.uniforms.uFlash.value = 0;
        }

        if (this.chromaticAberrationPass) {
            const on = !!this.trackEffects[3];
            this.chromaticAberrationPass.enabled = on;
            if (!on) {
                this.chromaticAberrationAmount = 0.0;
                this.chromaticAberrationEndTime = 0;
                this.chromaticAberrationKeyPressed = false;
            }
        }

        if (this.glitchPass) {
            const on = !!this.trackEffects[4];
            this.glitchPass.enabled = on;
            if (!on) {
                this.glitchAmount = 0.0;
                this.glitchEndTime = 0;
                this.glitchKeyPressed = false;
            }
        }
    }

    /**
     * エフェクトの初期状態を trackEffects に合わせて適用（デフォルトは全トラックON）
     */
    initializeEffectStates() {
        debugLog('effect', 'initializeEffectStates: 開始');
        this.applyTrackEffectsToPostPasses();
        if (!this.chromaticAberrationPass) {
            debugLog('effect', 'chromaticAberrationPassは未初期化（非同期後に再同期）');
        }
        if (!this.glitchPass) {
            debugLog('effect', 'glitchPassは未初期化（非同期後に再同期）');
        }
        debugLog('effect', 'initializeEffectStates完了');
    }
    
    /**
     * 色収差エフェクトを初期化
     */
    async initChromaticAberration() {
        // 既に存在する場合はスキップ（重複追加を防ぐ）
        if (this.chromaticAberrationPass) return;
        
        // シェーダーを読み込む
        const shaderBasePath = `/shaders/common/`;
        try {
            const [vertexShader, fragmentShader] = await Promise.all([
                fetch(`${shaderBasePath}chromaticAberration.vert`).then(r => r.text()),
                fetch(`${shaderBasePath}chromaticAberration.frag`).then(r => r.text())
            ]);
            
            // 再度チェック（非同期処理中に別の呼び出しで追加された可能性）
            if (this.chromaticAberrationPass) return;
            
            // EffectComposerを作成
            if (!this.composer) {
                this.composer = new EffectComposer(this.renderer);
                
                // RenderPassを追加（通常のシーン描画）
                const renderPass = new RenderPass(this.scene, this.camera);
                this.composer.addPass(renderPass);
            }
            
            // 色収差シェーダーを作成
            const chromaticAberrationShader = {
                uniforms: {
                    tDiffuse: { value: null },
                    resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                    amount: { value: 0.0 }
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader
            };
            
            // ShaderPassを追加
            this.chromaticAberrationPass = new ShaderPass(chromaticAberrationShader);
            this.chromaticAberrationPass.enabled = false;  // デフォルトでは無効
            this.composer.addPass(this.chromaticAberrationPass);
            
            // グリッチエフェクトも初期化（composerが作成された後）
            await this.initGlitchShader();
            this.applyTrackEffectsToPostPasses();
        } catch (err) {
            console.error('色収差シェーダーの読み込みに失敗:', err);
        }
    }
    
    /**
     * グリッチシェーダーを初期化（composer作成後）
     */
    async initGlitchShader() {
        if (!this.composer) return;
        
        // 既に存在する場合はスキップ（重複追加を防ぐ）
        if (this.glitchPass) return;
        
        // シェーダーを読み込む
        const shaderBasePath = `/shaders/common/`;
        try {
            const [vertexShader, fragmentShader] = await Promise.all([
                fetch(`${shaderBasePath}glitch.vert`).then(r => r.text()),
                fetch(`${shaderBasePath}glitch.frag`).then(r => r.text())
            ]);
            
            // 再度チェック（非同期処理中に別の呼び出しで追加された可能性）
            if (this.glitchPass) return;
            
            // グリッチシェーダーを作成
            const glitchShader = {
                uniforms: {
                    tDiffuse: { value: null },
                    resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                    amount: { value: 0.0 },
                    time: { value: 0.0 }
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader
            };
            
            // ShaderPassを追加
            this.glitchPass = new ShaderPass(glitchShader);
            this.glitchPass.enabled = false;  // デフォルトでは無効
            this.composer.addPass(this.glitchPass);
        } catch (err) {
            console.error('グリッチシェーダーの読み込みに失敗:', err);
        }
    }
    
    /**
     * 更新処理（毎フレーム呼ばれる）
     * @param {number} deltaTime - 前フレームからの経過時間（秒）
     */
    update(deltaTime) {
        // 背景色のタイマーチェック
        if (this.backgroundWhiteEndTime > 0 && Date.now() >= this.backgroundWhiteEndTime) {
            this.backgroundWhite = false;
            this.backgroundWhiteEndTime = 0;
        }
        
        // カメラパーティクルの移動を有効/無効化（trackEffects[1]に基づく）
        this.cameraParticles.forEach(cp => {
            cp.enableMovement = this.trackEffects[1];
        });
        
        // カメラパーティクルを更新（全部のカメラパーティクルを更新）
        this.cameraParticles.forEach(cp => {
            cp.update();
        });
        
        // カメラにランダムな力を加える
        this.updateCameraForce();
        
        // カメラの位置を更新
        this.updateCamera();
        
        // 色反転エフェクトの更新（サスティン終了チェック）
        if (this.colorInversion) {
            this.colorInversion.update();
            // trackEffects[2]がfalseの場合は確実にオフにする（ストロボモードでは常に反転オフ）
            if (this.useTrack2Strobe && this.colorInversion.isEnabled()) {
                this.colorInversion.setEnabled(false);
            } else if (!this.trackEffects[2] && this.colorInversion.isEnabled()) {
                this.colorInversion.setEnabled(false);
            }
        }

        if (this.useTrack2Strobe && this.strobeFlashPass) {
            const u = this.strobeFlashPass.uniforms.uFlash;
            const now = Date.now();
            const sustain = (this._strobeFromKeypad || (this._strobeEndTime > 0 && now < this._strobeEndTime)) ? 0.78 : 0;
            this._strobeImpulse *= Math.exp(-deltaTime * 17);
            if (this._strobeImpulse < 0.002) this._strobeImpulse = 0;
            u.value = Math.min(1, Math.max(sustain, this._strobeImpulse));
            this.strobeFlashIntensity = u.value;

            // 物理ライトの強度を更新
            if (this.usePhysicalStrobe && this.strobeCameraSpot) {
                this.strobeCameraSpot.intensity = this.strobeFlashIntensity * (this.strobePhysicalPeak ?? 0.0);
            }
        } else {
            this.strobeFlashIntensity = 0;
        }
        
        // 色収差エフェクトの更新（サスティン終了チェック）
        this.updateChromaticAberration();
        // trackEffects[3]がfalseの場合は確実にオフにする
        if (!this.trackEffects[3] && this.chromaticAberrationPass && this.chromaticAberrationPass.enabled) {
            this.chromaticAberrationPass.enabled = false;
            this.chromaticAberrationAmount = 0.0;
            this.chromaticAberrationEndTime = 0;
            this.chromaticAberrationKeyPressed = false;
        }
        
        // グリッチエフェクトの更新（サスティン終了チェックと時間更新）
        this.updateGlitch();
        // trackEffects[4]がfalseの場合は確実にオフにする
        if (!this.trackEffects[4] && this.glitchPass && this.glitchPass.enabled) {
            this.glitchPass.enabled = false;
            this.glitchAmount = 0.0;
            this.glitchEndTime = 0;
            this.glitchKeyPressed = false;
        }
        
        // 時間を更新（HUD表示用、共通処理）
        // ただし、サブクラスで独自の時間更新（timeIncrementなど）を使っている場合は、そちらで更新される
        // Scene01やScene07は独自のtimeIncrementを使うため、ここでは更新しない
        // Scene02など、deltaTimeを使うシーンのみ、ここで更新する
        // this.time += deltaTime;  // サブクラスで独自更新するため、コメントアウト
        
        // スカイドームの更新
        if (this.skyDome && this.useSkyDome) {
            this.skyDome.update(this.camera);
        }

        // サブクラスの更新処理
        this.onUpdate(deltaTime);
        
        // 3Dグリッドとルーラーの更新（カメラ向きの更新）
        if (this.gridRuler3D && this.showGridRuler3D) {
            this.gridRuler3D.update(this.camera);
        }
    }
    
    /**
     * カメラにランダムな力を加える（共通処理）
     */
    updateCameraForce() {
        // trackEffects[1]がオフの場合は処理をスキップ
        if (!this.trackEffects[1]) {
            return;
        }
        
        this.cameraTriggerCounter++;
        if (this.cameraTriggerCounter >= this.cameraTriggerInterval) {
            if (this.cameraParticles[this.currentCameraIndex]) {
                this.cameraParticles[this.currentCameraIndex].applyRandomForce();
            }
            this.cameraTriggerCounter = 0;
        }
    }
    
    /**
     * カメラの位置を更新（最適化：matrixWorldNeedsUpdateを回避）
     */
    updateCamera() {
        if (this.cameraParticles[this.currentCameraIndex]) {
            const cameraPos = this.cameraParticles[this.currentCameraIndex].getPosition();
            this.camera.position.copy(cameraPos);
            this.camera.lookAt(0, 0, 0);
            // matrixWorldNeedsUpdateをfalseにして不要な再計算を回避
            this.camera.matrixWorldNeedsUpdate = false;
        }
    }
    
    /**
     * 色収差エフェクトの更新（サスティン終了チェック）
     */
    updateChromaticAberration() {
        if (this.chromaticAberrationPass && this.chromaticAberrationPass.enabled) {
            // キーが押されている場合は無効化しない
            if (this.chromaticAberrationKeyPressed) {
                return;
            }
            
            const currentTime = Date.now();
            if (this.chromaticAberrationEndTime > 0 && currentTime >= this.chromaticAberrationEndTime) {
                // サスティン終了
                this.chromaticAberrationPass.enabled = false;
                this.chromaticAberrationAmount = 0.0;
                this.chromaticAberrationEndTime = 0;
            }
        }
    }
    
    /**
     * グリッチエフェクトの更新（サスティン終了チェックと時間更新）
     */
    updateGlitch() {
        if (this.glitchPass && this.glitchPass.enabled) {
            // 時間を更新
            if (this.glitchPass.material && this.glitchPass.material.uniforms && this.glitchPass.material.uniforms.time) {
                this.glitchPass.material.uniforms.time.value = this.time * 0.1;  // 時間をスケール
            }
            
            // キーが押されている場合は無効化しない
            if (this.glitchKeyPressed) {
                return;
            }
            
            const currentTime = Date.now();
            if (this.glitchEndTime > 0 && currentTime >= this.glitchEndTime) {
                // サスティン終了
                this.glitchPass.enabled = false;
                this.glitchAmount = 0.0;
                this.glitchEndTime = 0;
            }
        }
    }
    
    /**
     * サブクラスの更新処理（オーバーライド用）
     */
    onUpdate(deltaTime) {
        // サブクラスで実装
    }
    
    /**
     * 描画処理
     */
    render() {
        // 背景色を設定
        if (this.backgroundWhite) {
            this.renderer.setClearColor(0xffffff);
        } else {
            this.renderer.setClearColor(0x000000);
        }
        
        // スカイドームは scene.background に HDRI を設定しているため、
        // EffectComposer の RenderPass がシーンを描画する際に自動で背景として表示される

        // 色反転エフェクトが有効な場合はColorInversionのcomposerを使用
        if (this.colorInversion && this.colorInversion.isEnabled()) {
            // トラック2が有効な時も他のパス（DOF, Bloomなど）を効かせるため、一時的に追加
            const invComposer = this.colorInversion.composer;
            
            if (invComposer) {
                // 既存のパスを一度クリア（RenderPass以外）
                const baseRenderPass = invComposer.passes[0];
                const inversionPass = invComposer.passes[invComposer.passes.length - 1];
                invComposer.passes = [baseRenderPass];

                // シーンのcomposerからパスをコピー（RenderPass以外）
                if (this.composer) {
                    this.composer.passes.forEach(pass => {
                        if (!(pass instanceof RenderPass) && pass.enabled) {
                            invComposer.addPass(pass);
                        }
                    });
                }

                // 最後に色反転パスを追加
                invComposer.addPass(inversionPass);
            }

            // ColorInversionのcomposerがシーンをレンダリングして色反転を適用
            const rendered = this.colorInversion.render();
            if (!rendered) {
                // レンダリングに失敗した場合は通常のレンダリング
                if (this.scene) {
                    this.renderer.render(this.scene, this.camera);
                }
            }
        } else {
            // ポストプロセッシングエフェクトが有効な場合はEffectComposerを使用
            if (this.composer && 
                this.composer.passes.some(pass => pass.enabled && !(pass instanceof RenderPass))) {
                this.composer.render();
            } else {
                // 通常のレンダリング
                if (this.scene) {
                    this.renderer.render(this.scene, this.camera);
                }
            }
        }
        
        
        // HUDを描画（非表示の時はCanvasをクリア）
        if (this.hud) {
            if (this.showHUD) {
                // 横位置モードをHUDに反映
                this.hud.positionMode = this.hudPositionMode;
                const cameraPos = this.cameraParticles[this.currentCameraIndex]?.getPosition() || new THREE.Vector3();
                const now = performance.now();
                const frameRate = this.lastFrameTime ? 1.0 / ((now - this.lastFrameTime) / 1000.0) : 60.0;
                this.lastFrameTime = now;
                
                // 色反転エフェクトが有効な場合は、HUDの色も反転する
                const isInverted = this.colorInversion && this.colorInversion.isEnabled();
                
                // サブクラスからのコールアウトデータを取得（存在する場合）
                const callouts = this.calloutSystem ? this.calloutSystem.getCallouts() : [];
                const qiPulses = this.calloutSystem ? this.calloutSystem.getQiPulses() : [];

                this.hud.display(
                    frameRate,
                    this.currentCameraIndex,
                    cameraPos,
                    0, // activeSpheres（サブクラスで設定）
                    this.time, // time（サブクラスで設定）
                    this.cameraParticles[this.currentCameraIndex]?.getRotationX() || 0,
                    this.cameraParticles[this.currentCameraIndex]?.getRotationY() || 0,
                    cameraPos.length(),
                    0, // noiseLevel（サブクラスで設定）
                    isInverted, // backgroundWhite（色反転エフェクトが有効な場合はtrue）
                    this.oscStatus,
                    this.particleCount,
                    this.trackEffects,  // エフェクト状態を渡す
                    this.phase,  // phase値を渡す
                    null,  // hudScales（サブクラスで設定可能）
                    null,  // hudGrid（サブクラスで設定可能）
                    0,  // currentBar（サブクラスで設定可能）
                    '',  // debugText（サブクラスで設定可能）
                    this.actualTick,  // actualTick（OSCから受け取る値）
                    null,  // cameraModeName（サブクラスで設定可能）
                    this.sceneNumber,  // sceneNumber（各シーンで設定）
                    callouts, // 2Dコールアウトデータを渡す
                    qiPulses, // 和弦「気」2Dサークル
                    this.sceneBankIndex,
                    this.totalSceneCount,
                    this.sceneIndex,
                    this.maxSceneSlots
                );
            } else {
                // HUDが非表示の時はCanvasをクリア
                this.hud.clear();
            }
        }
        
        // スクリーンショットテキストを描画
        this.drawScreenshotText();
        
        // デバッグ用シーンを描画（エフェクト適用後、HUDと同じタイミング）
        // カメラデバッグとAxesHelperはエフェクトから除外
        // SHOW_CAMERA_DEBUGがtrueの時のみレンダリング
        if (this.SHOW_CAMERA_DEBUG && this.debugScene) {
            // debugSceneの背景を確実に透明にする（sceneが上書きされないようにするため）
            this.debugScene.background = null;
            
            // autoClearを一時的にfalseにして、sceneの描画結果を保持したまま
            // debugSceneを上書きレンダリングする（これが重要！）
            const originalAutoClear = this.renderer.autoClear;
            this.renderer.autoClear = false;
            
            this.renderer.render(this.debugScene, this.camera);
            
            // autoClearを復元
            this.renderer.autoClear = originalAutoClear;
        }
        
        // カメラデバッグを描画（テキスト）
        this.drawCameraDebug();
    }
    
    /**
     * OSCメッセージのハンドリング
     * @param {Object} message - OSCメッセージ
     */
    handleOSC(message) {
        // デバッグ: 全てのOSCメッセージをログ出力（/phase/確認用）
        if (message.address && (message.address.includes('phase') || message.address.includes('Phase'))) {
        }
        
        // /phase/メッセージを処理（/phase/ または /phase の両方に対応）
        if (message.address === '/phase/' || message.address === '/phase') {
            const args = message.args || [];
            if (args.length > 0) {
                const phaseValue = typeof args[0] === 'number' ? args[0] : parseFloat(args[0]);
                if (!isNaN(phaseValue)) {
                    this.phase = Math.floor(phaseValue);  // integerとして保存
                }
            }
            return;  // 処理済み
        }
        
        // /actual_tick/メッセージを処理（/actual_tick/ または /actual_tick の両方に対応）
        if (message.address === '/actual_tick/' || message.address === '/actual_tick' || message.address === '/tick/' || message.address === '/tick') {
            const args = message.args || [];
            if (args.length > 0) {
                const tickValue = typeof args[0] === 'number' ? args[0] : parseFloat(args[0]);
                if (!isNaN(tickValue)) {
                    this.actualTick = Math.floor(tickValue);  // integerとして保存
                    // ログを削除（ユーザー要望）
                }
            }
            return;  // 処理済み
        }

        // /chord … コードトラック専用（トラック番号へは流さない）。
        // args を [n0,v0,d0,n1,v1,d1,...] の連続トリプレットとして複数ノートを一度に受け取れる。
        {
            const raw = typeof message.address === 'string' ? message.address.trim() : '';
            if (raw === '/chord' || raw === '/chord/' || raw.startsWith('/chord/')) {
                if (!this.chordBurstEffectEnabled) return;
                const hits = parseChordHitsFromOscArgs(message.args);
                debugLog('osc', `chord burst parsed=${hits.length} rawArgs=${JSON.stringify(message.args || [])}`);
                if (hits.length > 0) {
                    this.handleChordBurst(hits, message);
                }
                return;
            }
        }

        // /kit/メッセージはSceneManagerで処理されるため、ここでは処理しない
        // SceneManagerでシーン切り替えが行われる

        const trackNumber = message.trackNumber;
        
        // trackEffectsの状態をチェック（オフの場合は処理をスキップ）
        if (trackNumber >= 1 && trackNumber <= 9 && !this.trackEffects[trackNumber]) {
            debugLog('track', `Track ${trackNumber}: オフのため処理をスキップ`);
            return;
        }
        
        // トラック1: カメラをランダムに切り替え（全シーン共通）
        if (trackNumber === 1) {
            this.switchCameraRandom();
            return;  // 処理済み
        }
        
        // トラック2: 色反転 or 全画面ストロボ（OSC）
        if (trackNumber === 2) {
            const args = message.args || [];
            const noteNumber = args[0] || 64;
            const rawVel = args[1];
            const velocity =
                rawVel != null && rawVel !== '' && !Number.isNaN(Number(rawVel)) ? Number(rawVel) : 127.0;
            const durationMs = args[2] || 0.0;

            if (this.useTrack2Strobe) {
                debugLog('effect', `handleOSC track2 strobe: args=${JSON.stringify(args)}, vel=${velocity}, dur=${durationMs}`);
                if (this.strobeFlashPass) {
                    const spike = THREE.MathUtils.clamp(velocity / 127, 0, 1) * 0.96;
                    this._strobeImpulse = Math.min(1, Math.max(this._strobeImpulse, spike));
                    if (durationMs > 0) {
                        this._strobeEndTime = Date.now() + durationMs;
                    } else {
                        this._strobeEndTime = 0;
                    }
                }
                return;
            }

            debugLog('colorInversion', `handleOSC track2: args=${JSON.stringify(args)}, note=${noteNumber}, velocity=${velocity}, durationMs=${durationMs}`);
            if (this.colorInversion) {
                if (durationMs === 0 && args.length === 0) {
                    const currentState = this.colorInversion.isEnabled();
                    this.colorInversion.setEnabled(!currentState);
                    this.colorInversion.endTime = 0;
                    debugLog('colorInversion', `Track 2: ${!currentState ? 'ON' : 'OFF'} (トグル)`);
                } else {
                    debugLog('colorInversion', `apply呼び出し前: velocity=${velocity}, durationMs=${durationMs}`);
                    this.colorInversion.apply(velocity, durationMs);
                }
            }
            return;
        }
        
        // トラック3: 色収差エフェクト（共通化）
        if (trackNumber === 3) {
            const args = message.args || [];
            const velocity = args[1] || 127.0;
            const noteNumber = args[0] || 64.0;
            const durationMs = args[2] || 0.0;
            this.applyChromaticAberration(velocity, noteNumber, durationMs);
            return;  // 処理済み
        }
        
        // トラック4: グリッチエフェクト（共通化）
        if (trackNumber === 4) {
            const args = message.args || [];
            const velocity = args[1] || 127.0;
            const noteNumber = args[0] || 64.0;
            const durationMs = args[2] || 0.0;
            this.applyGlitch(velocity, noteNumber, durationMs);
            return;  // 処理済み
        }
        
        // その他のトラックはサブクラスで処理
        // サブクラスのOSC処理
        this.handleTrackNumber(trackNumber, message);
    }
    
    /**
     * キーダウン処理（全シーン共通）
     */
    handleKeyDown(trackNumber) {
    }
    
    /**
     * キーアップ処理（全シーン共通）
     */
    handleKeyUp(trackNumber) {
        // トラック2: 色反転 or ストロボ
        if (trackNumber === 2) {
            if (this.useTrack2Strobe) {
                this._strobeFromKeypad = false;
                this._strobeImpulse = 0;
                if (this.strobeFlashPass) {
                    this.strobeFlashPass.uniforms.uFlash.value = 0;
                }
            } else if (this.colorInversion) {
                this.colorInversion.setEnabled(false);
            }
        }
        // トラック3: 色収差
        else if (trackNumber === 3) {
            this.chromaticAberrationKeyPressed = false;
            if (this.chromaticAberrationPass) {
                this.chromaticAberrationPass.enabled = false;
                this.chromaticAberrationAmount = 0.0;
                this.chromaticAberrationEndTime = 0;
            }
        }
        // トラック4: グリッチ
        else if (trackNumber === 4) {
            this.glitchKeyPressed = false;
            if (this.glitchPass) {
                this.glitchPass.enabled = false;
                this.glitchAmount = 0.0;
                this.glitchEndTime = 0;
            }
        }
    }
    
    /**
     * トラック番号を処理（サブクラスでオーバーライド）
     */
    handleTrackNumber(trackNumber, message) {
    }

    /**
     * `/chord` 受信でパース済みの和音イベント（複数同時）。
     * シングルノート `/track/N` と切り離してシーン側でエフェクトを定義する。
     * @param {{ note: number, velocity: number, durationMs: number }[]} hits
     * @param {Object} message - 元 OSC（address / args を参照したいとき用）
     */
    handleChordBurst(hits, message) {
        void hits;
        void message;
    }

    /**
     * エフェクトのオン/オフを切り替え（数字キー1-9用）
     */
    toggleEffect(trackNumber) {
        if (trackNumber < 1 || trackNumber > 9) return;
        
        this.trackEffects[trackNumber] = !this.trackEffects[trackNumber];
        const isOn = this.trackEffects[trackNumber];
        
        if (trackNumber === 1) {
            if (isOn) this.switchCameraRandom();
        } else if (trackNumber === 2) {
            if (this.useTrack2Strobe) {
                this._strobeFromKeypad = isOn;
                if (!isOn) {
                    this._strobeImpulse = 0;
                    if (this.strobeFlashPass) this.strobeFlashPass.uniforms.uFlash.value = 0;
                }
            } else if (this.colorInversion) {
                this.colorInversion.setEnabled(isOn);
                this.colorInversion.endTime = 0;
            }
        } else if (trackNumber === 3) {
            if (this.chromaticAberrationPass) {
                this.chromaticAberrationPass.enabled = isOn;
                if (!isOn) {
                    this.chromaticAberrationAmount = 0.0;
                    this.chromaticAberrationEndTime = 0;
                    this.chromaticAberrationKeyPressed = false;
                }
            }
        } else if (trackNumber === 4) {
            if (this.glitchPass) {
                this.glitchPass.enabled = isOn;
                if (!isOn) {
                    this.glitchAmount = 0.0;
                    this.glitchEndTime = 0;
                    this.glitchKeyPressed = false;
                }
            }
        }
    }
    
    /**
     * 背景を白にする
     */
    setBackgroundWhite(white, endTime = null) {
        this.backgroundWhite = white;
        if (endTime !== null) this.backgroundWhiteEndTime = endTime;
    }
    
    /**
     * カメラをランダムに切り替える
     */
    switchCameraRandom() {
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex && this.cameraParticles.length > 1) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
        const cp = this.cameraParticles[this.currentCameraIndex];

        if (!cp) return;

        const angle1 = Math.random() * Math.PI * 2;
        const angle2 = Math.random() * Math.PI * 0.5 + 0.2;
        
        const minDist = cp.minDistance || 1000;
        const maxDist = cp.maxDistance || 2500;
        const dist = (minDist * 1.2) + Math.random() * (maxDist - minDist * 1.2);

        const centerX = this._centerSmoothed ? this._centerSmoothed.x : 0;
        const centerY = this._centerSmoothed ? this._centerSmoothed.y : 500;
        const centerZ = this._centerSmoothed ? this._centerSmoothed.z : 0;

        const targetX = centerX + Math.sin(angle2) * Math.cos(angle1) * dist;
        const targetY = centerY + Math.cos(angle2) * dist;
        const targetZ = centerZ + Math.sin(angle2) * Math.sin(angle1) * dist;

        cp.position.set(targetX, targetY, targetZ);
        if (cp.velocity) cp.velocity.set(0, 0, 0);
        cp.applyRandomForce();
        
        debugLog('camera', `Camera switched to index: ${this.currentCameraIndex} relative to center`);
    }
    
    /**
     * リセット処理
     */
    reset() {
        if (this.hud && this.hud.resetTime) this.hud.resetTime();
    }
    
    /**
     * 物理的なストロボライト（天井からのフラッシュ）をセットアップ
     */
    setupPhysicalStrobeLight(peakIntensity = 1.5) {
        if (this.strobeCameraSpot) return;
        
        this.usePhysicalStrobe = true;
        this.strobePhysicalPeak = peakIntensity;
        
        const flash = new THREE.PointLight(0xffffff, 0, 50000);
        flash.decay = 0; 
        
        const yPos = this.ceilingY ? this.ceilingY * 0.8 : 4000;
        flash.position.set(0, yPos, 0); 
        
        // 真下（床の方向）を向かせる
        const target = new THREE.Object3D();
        target.position.set(0, 0, 0);
        if (this.scene) this.scene.add(target);
        flash.target = target;
        
        if (this.scene) this.scene.add(flash);
        this.strobeCameraSpot = flash;
    }

    /**
     * クリーンアップ処理
     */
    dispose() {
        this.initialized = false;
        debugLog('init', 'SceneBase.dispose開始');
        
        if (this.strobeCameraSpot) {
            if (this.scene) this.scene.remove(this.strobeCameraSpot);
            this.strobeCameraSpot.dispose();
            this.strobeCameraSpot = null;
        }
        
        if (this.hud && this.hud.ctx && this.hud.canvas) {
            this.hud.ctx.clearRect(0, 0, this.hud.canvas.width, this.hud.canvas.height);
        }
        
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
                if (object.material && object.material.map) object.material.map.dispose();
            });
            while (this.scene.children.length > 0) {
                this.scene.remove(this.scene.children[0]);
            }
        }
        
        if (this.debugScene) {
            while (this.debugScene.children.length > 0) {
                this.debugScene.remove(this.debugScene.children[0]);
            }
        }
        
        if (this.cameraDebugGroup) {
            while (this.cameraDebugGroup.children.length > 0) {
                this.cameraDebugGroup.remove(this.cameraDebugGroup.children[0]);
            }
        }
        
        if (this.skyDome) {
            this.skyDome.dispose();
            this.skyDome = null;
        }
        this.skyDomeLightConfig = null;

        if (this.lensFlare) {
            if (this.lensFlare.dispose) this.lensFlare.dispose();
            this.lensFlare = null;
        }
        if (this.lensFlareLight && this.scene) {
            this.scene.remove(this.lensFlareLight);
            this.lensFlareLight = null;
        }

        if (this.filmLookPass) {
            this.filmLookPass.dispose();
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.filmLookPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            this.filmLookPass = null;
        }

        if (this.filmPass) {
            this.filmPass.dispose();
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.filmPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            this.filmPass = null;
        }

        if (this.strobeFlashPass) {
            if (this.composer) {
                const idx = this.composer.passes.indexOf(this.strobeFlashPass);
                if (idx !== -1) this.composer.passes.splice(idx, 1);
            }
            if (this.strobeFlashPass.material) this.strobeFlashPass.material.dispose();
            this.strobeFlashPass = null;
        }

        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }

        if (this.bokehPass) {
            this.bokehPass.enabled = false;
            this.bokehPass = null;
        }
        
        if (this.colorInversion && this.colorInversion.dispose) {
            this.colorInversion.dispose();
            this.colorInversion = null;
        }
        
        if (this.gridRuler3D) {
            this.gridRuler3D.dispose();
            this.gridRuler3D = null;
        }
        
        if (this.cameraDebugCanvas && this.cameraDebugCanvas.parentElement) {
            this.cameraDebugCanvas.parentElement.removeChild(this.cameraDebugCanvas);
            this.cameraDebugCanvas = null;
            this.cameraDebugCtx = null;
        }
        
        if (this.screenshotCanvas && this.screenshotCanvas.parentElement) {
            this.screenshotCanvas.parentElement.removeChild(this.screenshotCanvas);
            this.screenshotCanvas = null;
            this.screenshotCtx = null;
        }
        
        this.cameraDebugSpheres = [];
        this.cameraDebugLines = [];
        this.cameraDebugCircles = [];
        this.cameraDebugTextPositions = [];
        
        debugLog('init', 'SceneBase.dispose完了');
    }
    
    /**
     * 色収差エフェクトを適用（ノート、ベロシティ、デュレーション付き）
     */
    applyChromaticAberration(velocity, noteNumber, durationMs) {
        if (!this.chromaticAberrationPass) {
            console.warn('色収差エフェクトが初期化されていません');
            return;
        }
        
        // ベロシティ（0〜127）を色収差の強度（0.0〜1.0）に変換
        // ベロシティが大きいほど強度が高い
        const amount = THREE.MathUtils.mapLinear(velocity, 0, 127, 0.0, 1.0);
        this.chromaticAberrationAmount = amount;
        
        // シェーダーのuniformを更新
        if (this.chromaticAberrationPass.material && this.chromaticAberrationPass.material.uniforms) {
            this.chromaticAberrationPass.material.uniforms.amount.value = amount;
        }
        
        // エフェクトを有効化
        this.chromaticAberrationPass.enabled = true;
        
        // デュレーション（サスティン）を設定
        if (durationMs > 0) {
            this.chromaticAberrationEndTime = Date.now() + durationMs;
        } else {
            // デュレーションが0の場合は無期限（キーが離されるまで）
            this.chromaticAberrationEndTime = 0;
        }
        
        debugLog('effect', `Track 3: Chromatic aberration - velocity:${velocity}, amount:${amount.toFixed(2)}, duration:${durationMs}ms`);
    }
    
    /**
     * グリッチエフェクトを適用（ノート、ベロシティ、デュレーション付き）
     */
    applyGlitch(velocity, noteNumber, durationMs) {
        if (!this.glitchPass) {
            console.warn('グリッチエフェクトが初期化されていません');
            return;
        }
        
        // ベロシティ（0〜127）をグリッチの強度（0.0〜1.0）に変換
        // ベロシティが大きいほど強度が高い
        const amount = THREE.MathUtils.mapLinear(velocity, 0, 127, 0.0, 1.0);
        this.glitchAmount = amount;
        
        // シェーダーのuniformを更新
        if (this.glitchPass.material && this.glitchPass.material.uniforms) {
            this.glitchPass.material.uniforms.amount.value = amount;
        }
        
        // エフェクトを有効化
        this.glitchPass.enabled = true;
        
        // デュレーション（サスティン）を設定
        if (durationMs > 0) {
            this.glitchEndTime = Date.now() + durationMs;
        } else {
            // デュレーションが0の場合は無期限（キーが離されるまで）
            this.glitchEndTime = 0;
        }
        
        debugLog('effect', `Track 4: Glitch - velocity:${velocity}, amount:${amount.toFixed(2)}, duration:${durationMs}ms`);
    }
    
    /**
     * リサイズ処理
     */
    onResize() {
        // 色反転エフェクトのリサイズ
        if (this.colorInversion) {
            this.colorInversion.onResize();
        }
        
        // ポストプロセッシングエフェクトのリサイズ
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
        
        // サブクラスで実装
    }
    
    /**
     * OSC状態を設定
     */
    setOSCStatus(status) {
        this.oscStatus = status;
    }
    
    /**
     * パーティクル数を設定
     */
    setParticleCount(count) {
        this.particleCount = count;
    }
    
    /**
     * スクリーンショット用テキストを設定
     */
    setScreenshotText(text) {
        this.screenshotText = text;
    }
    
    /**
     * スクリーンショットを撮影
     * @param {boolean} is16_9 - trueの場合は16:9枠、falseの場合は正方形枠
     */
    takeScreenshot(is16_9) {
        // 既にスクリーンショット処理中の場合はスキップ
        if (this.pendingScreenshot || this.screenshotExecuting) {
            return;
        }
        
        if (!this.renderer || !this.renderer.domElement) {
            console.error('❌ レンダラーが初期化されていません');
            return;
        }
        
        // スクリーンショット用Canvasを初期化（まだ初期化されていない場合）
        if (!this.screenshotCanvas || !this.screenshotCtx) {
            this.initScreenshotCanvas();
            if (!this.screenshotCanvas || !this.screenshotCtx) {
                console.error('❌ スクリーンショット用Canvasの初期化に失敗しました');
                return;
            }
        }
        
        // スクリーンショットファイル名を生成
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        const filename = `screenshot_${year}${month}${day}_${hour}${minute}${second}.png`;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        const width = size.width;
        const height = size.height;
        
        let frameWidth, frameHeight, frameX, frameY;
        
        if (is16_9) {
            // YouTube用16:9の枠を計算（中央配置）
            const aspect16_9 = 16.0 / 9.0;
            
            // 画面の高さを基準に16:9の幅を計算
            frameHeight = height;
            frameWidth = frameHeight * aspect16_9;
            
            // 幅が画面より大きい場合は、幅を基準に高さを計算
            if (frameWidth > width) {
                frameWidth = width;
                frameHeight = frameWidth / aspect16_9;
            }
            
            // 中央に配置
            frameX = (width - frameWidth) / 2;
            frameY = (height - frameHeight) / 2;
        } else {
            // 正方形の枠を計算（中央配置）
            const squareSize = Math.min(width, height);
            frameWidth = squareSize;
            frameHeight = squareSize;
            frameX = (width - squareSize) / 2;
            frameY = (height - squareSize) / 2;
        }
        
        // テキストサイズを固定（画像のサイズに合わせて調整）
        this.screenshotTextSize = is16_9 ? 260 : 175;
        
        // テキストの位置をランダムに決定（より広い範囲でランダムに）
        const margin = 20;  // マージンを小さくしてより広い範囲を使用
        
        // テキストの幅を事前に計算（仮のフォントで）
        if (this.screenshotCtx) {
            this.screenshotCtx.font = `${this.screenshotTextSize}px Helvetica, Arial, sans-serif`;
            const textWidth = this.screenshotCtx.measureText(this.screenshotText).width;
            const textHeight = this.screenshotTextSize * 1.2;
            
            // テキストが枠からはみ出さない範囲を計算（CENTER揃えなので、中心位置の範囲）
            // マージンを小さくして、より広い範囲を使用
            const minX = frameX + margin + textWidth / 2;
            const maxX = frameX + frameWidth - margin - textWidth / 2;
            
            // X位置をランダムに決定（可能な限り広い範囲で）
            if (maxX < minX) {
                // テキストが大きすぎる場合は中央に配置
                this.screenshotTextX = frameX + frameWidth / 2;
            } else {
                // ランダムな位置を決定（広い範囲で）
                this.screenshotTextX = minX + Math.random() * (maxX - minX);
            }
            
            // Y位置もランダムに決定（より広い範囲で）
            const minY = frameY + margin + textHeight / 2;
            const maxY = frameY + frameHeight - margin - textHeight / 2;
            if (maxY < minY) {
                // テキストが大きすぎる場合は中央に配置
                this.screenshotTextY = frameY + frameHeight / 2;
            } else {
                // ランダムな位置を決定（広い範囲で）
                this.screenshotTextY = minY + Math.random() * (maxY - minY);
            }
        }
        
        // テキストを表示してからスクリーンショットを取る（次のフレームで）
        this.showScreenshotText = true;
        this.pendingScreenshot = true;
        this.pendingScreenshotFilename = filename;
        this.screenshotTextEndTime = Date.now() + 3000; // 3秒後（余裕を持たせる）
    }
    
    /**
     * スクリーンショットテキストを描画
     */
    drawScreenshotText() {
        if (!this.showScreenshotText || !this.screenshotText || this.screenshotText === '') {
            if (this.screenshotCanvas && this.screenshotCtx) {
                // テキストをクリア
                this.screenshotCtx.clearRect(0, 0, this.screenshotCanvas.width, this.screenshotCanvas.height);
            }
            return;
        }
        
        // タイマーチェック
        if (this.screenshotTextEndTime > 0 && Date.now() >= this.screenshotTextEndTime) {
            this.showScreenshotText = false;
            this.screenshotTextEndTime = 0;
            this.pendingScreenshot = false;
            if (this.screenshotCtx) {
                this.screenshotCtx.clearRect(0, 0, this.screenshotCanvas.width, this.screenshotCanvas.height);
            }
            return;
        }
        
        if (!this.screenshotCanvas || !this.screenshotCtx) {
            this.initScreenshotCanvas();
            if (!this.screenshotCanvas || !this.screenshotCtx) return;
        }
        
        // Canvasをクリア
        this.screenshotCtx.clearRect(0, 0, this.screenshotCanvas.width, this.screenshotCanvas.height);
        
        // フォントを設定
        this.screenshotCtx.font = `${this.screenshotTextSize}px Helvetica, Arial, sans-serif`;
        this.screenshotCtx.textAlign = 'center';
        this.screenshotCtx.textBaseline = 'middle';
        
        // テキストを描画（背景に応じて色を変更）
        if (this.backgroundWhite) {
            this.screenshotCtx.fillStyle = 'rgba(0, 0, 0, 1.0)';  // 白背景の場合は黒テキスト
        } else {
            this.screenshotCtx.fillStyle = 'rgba(255, 255, 255, 1.0)';  // 黒背景の場合は白テキスト
        }
        
        // テキストの位置が設定されているか確認
        if (this.screenshotTextX > 0 && this.screenshotTextY > 0) {
            this.screenshotCtx.fillText(this.screenshotText, this.screenshotTextX, this.screenshotTextY);
        } else {
            // 位置が設定されていない場合は中央に配置
            const size = new THREE.Vector2();
            this.renderer.getSize(size);
            this.screenshotTextX = size.width / 2;
            this.screenshotTextY = size.height / 2;
            this.screenshotCtx.fillText(this.screenshotText, this.screenshotTextX, this.screenshotTextY);
        }
        
        // スクリーンショットを実行（テキスト表示後に）
        // 注意: executePendingScreenshot()は1回だけ実行されるように、フラグをチェック
        if (this.pendingScreenshot && !this.screenshotExecuting) {
            // 2フレーム待ってから実行（テキストが確実に描画されるように）
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (this.pendingScreenshot && this.showScreenshotText && !this.screenshotExecuting) {
                        this.executePendingScreenshot();
                    }
                });
            });
        }
    }
    
    /**
     * スクリーンショットを実際に撮影（テキスト表示後に呼ばれる）
     */
    executePendingScreenshot() {
        if (this.screenshotExecuting) return;
        this.screenshotExecuting = true;
        
        const filename = this.pendingScreenshotFilename;
        debugLog('init', `📸 スクリーンショット撮影開始: ${filename}`);
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 背景を黒で塗りつぶす
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, width, height);
        
        // 合成（サイズを指定して確実に全体を描画）
        try {
            // メインの3Dレンダリング結果を描画
            tempCtx.drawImage(this.renderer.domElement, 0, 0, width, height);
            
            // HUDを描画
            const hudCanvas = document.getElementById('hud-canvas');
            if (hudCanvas && this.showHUD) {
                tempCtx.drawImage(hudCanvas, 0, 0, width, height);
            }
            
            // スクリーンショット用テキスト（Canvas）を描画
            if (this.screenshotCanvas) {
                tempCtx.drawImage(this.screenshotCanvas, 0, 0, width, height);
            }
            
            const base64data = tempCanvas.toDataURL('image/jpeg', 0.8);
            debugLog('init', `📤 送信中... (${(base64data.length / 1024).toFixed(0)} KB)`);
            
            fetch('http://127.0.0.1:30338/api/screenshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, imageData: base64data })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) debugLog('init', `✅ 保存成功: ${data.path}`);
                else console.error('❌ 保存失敗:', data.error);
            })
            .catch(err => console.error('❌ 送信失敗:', err))
            .finally(() => this.resetScreenshotFlags());
        } catch (err) {
            console.error('❌ 合成/生成失敗:', err);
            this.resetScreenshotFlags();
        }
    }
    
    /**
     * スクリーンショット用フラグをリセット
     */
    resetScreenshotFlags() {
        this.pendingScreenshot = false;
        this.pendingScreenshotFilename = '';
        this.screenshotExecuting = false;
    }
    
    /**
     * リサイズ処理（オーバーライド用）
     */
    onResize() {
        this.resizeScreenshotCanvas();
        
        // カメラデバッグ用Canvasをリサイズ
        if (this.cameraDebugCanvas) {
            this.cameraDebugCanvas.width = window.innerWidth;
            this.cameraDebugCanvas.height = window.innerHeight;
        }
    }
    
    /**
     * 3Dグリッドとルーラーを初期化
     * @param {Object} params - グリッドのパラメータ
     * @param {Object} params.center - 中心座標 {x, y, z}
     * @param {Object} params.size - サイズ {x, y, z}
     * @param {number} params.divX - X軸の分割数（デフォルト: 12）
     * @param {number} params.divY - Y軸の分割数（デフォルト: 10）
     * @param {number} params.divZ - Z軸の分割数（デフォルト: 8）
     * @param {number} params.labelMax - ラベルの最大値（デフォルト: 64）
     * @param {number} params.floorY - 床のY座標（デフォルト: minY - 0.002）
     * @param {number} params.color - 色（デフォルト: 0xffffff）
     * @param {number} params.opacity - 透明度（デフォルト: 0.65）
     */
    initGridRuler3D(params) {
        if (!params || !params.center || !params.size) {
            console.warn('[SceneBase] initGridRuler3D: パラメータが不正です');
            return;
        }
        
        // 既存のグリッドを破棄
        if (this.gridRuler3D) {
            this.gridRuler3D.dispose();
            this.gridRuler3D = null;
        }
        
        // 新しいグリッドを作成
        this.gridRuler3D = new GridRuler3D();
        this.gridRuler3D.init(params);
        this.gridRuler3D.setVisible(this.showGridRuler3D);
        
        // シーンに追加
        if (this.scene) {
            this.scene.add(this.gridRuler3D.group);
        }
    }
    
    /**
     * カメラデバッグ用オブジェクトを初期化
     */
    initCameraDebugObjects() {
        if (!this.cameraDebugGroup) return;
        
        // 各カメラパーティクル用のSphereとLineを作成
        for (let i = 0; i < this.cameraParticles.length; i++) {
            // 赤いSphere（塗りつぶし、ライティングあり）
            const sphereSize = 15;  // 大きく（5 → 15）
            const sphereGeometry = new THREE.SphereGeometry(sphereSize, 32, 32);
            const sphereMaterial = new THREE.MeshStandardMaterial({
                color: 0xff0000,  // 赤
                transparent: true,
                opacity: 0.8,
                emissive: 0x330000,  // 発光色（控えめ）
                emissiveIntensity: 0.2,
                roughness: 0.8,
                metalness: 0.0
            });
            const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
            sphere.visible = false;
            this.cameraDebugGroup.add(sphere);
            this.cameraDebugSpheres.push(sphere);
            
            // 周囲のCircle（3つの方向に配置）
            // Circleの大きさは固定（SphereとCircleの間を太くするため）
            const circleRadius = 30;  // 大きく（12 → 30）して見やすくする
            const circleSegments = 32;
            
            // X-Y平面のCircle（前回より少し細く：0.9 → 0.94）
            const circleXYGeometry = new THREE.RingGeometry(circleRadius * 0.94, circleRadius, circleSegments);
            const circleXYMaterial = new THREE.MeshBasicMaterial({
                color: 0xff0000,  // 赤
                transparent: true,
                opacity: 1.0,  // 0.6 → 1.0（見やすくする）
                side: THREE.DoubleSide,
                depthWrite: false  // 深度書き込みを無効化（透明なオブジェクトの描画順の問題を回避）
            });
            const circleXY = new THREE.Mesh(circleXYGeometry, circleXYMaterial);
            circleXY.rotation.x = -Math.PI / 2;  // X-Y平面に配置
            circleXY.visible = false;
            circleXY.renderOrder = 1000;  // 描画順を後ろに（他のオブジェクトの上に描画）
            this.cameraDebugGroup.add(circleXY);
            
            // X-Z平面のCircle（前回より少し細く：0.9 → 0.94）
            const circleXZGeometry = new THREE.RingGeometry(circleRadius * 0.94, circleRadius, circleSegments);
            const circleXZMaterial = new THREE.MeshBasicMaterial({
                color: 0xff0000,  // 赤
                transparent: true,
                opacity: 1.0,  // 0.6 → 1.0（見やすくする）
                side: THREE.DoubleSide,
                depthWrite: false  // 深度書き込みを無効化
            });
            const circleXZ = new THREE.Mesh(circleXZGeometry, circleXZMaterial);
            circleXZ.visible = false;
            circleXZ.renderOrder = 1000;  // 描画順を後ろに
            this.cameraDebugGroup.add(circleXZ);
            
            // Y-Z平面のCircle（前回より少し細く：0.9 → 0.94）
            const circleYZGeometry = new THREE.RingGeometry(circleRadius * 0.94, circleRadius, circleSegments);
            const circleYZMaterial = new THREE.MeshBasicMaterial({
                color: 0xff0000,  // 赤
                transparent: true,
                opacity: 1.0,  // 0.6 → 1.0（見やすくする）
                side: THREE.DoubleSide,
                depthWrite: false  // 深度書き込みを無効化
            });
            const circleYZ = new THREE.Mesh(circleYZGeometry, circleYZMaterial);
            circleYZ.rotation.y = Math.PI / 2;  // Y-Z平面に配置
            circleYZ.visible = false;
            circleYZ.renderOrder = 1000;  // 描画順を後ろに
            this.cameraDebugGroup.add(circleYZ);
            
            this.cameraDebugCircles.push([circleXY, circleXZ, circleYZ]);
            
            // デバッグ: Circleが正しく作成されたか確認
            if (i === 0) {
                debugLog('camera', `initCameraDebugObjects: Camera #${i + 1}`, {
                    circleXY: !!circleXY,
                    circleXZ: !!circleXZ,
                    circleYZ: !!circleYZ,
                    circlesArray: this.cameraDebugCircles[i]
                });
            }
            
            // 中心への赤い線を作成
            const lineGeometry = new THREE.BufferGeometry();
            const lineMaterial = new THREE.LineBasicMaterial({
                color: 0xff0000,  // 赤
                transparent: true,
                opacity: 0.6
            });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            line.visible = false;
            this.cameraDebugGroup.add(line);
            this.cameraDebugLines.push(line);
        }
        
        this.cameraDebugGroup.visible = this.SHOW_CAMERA_DEBUG;
        
        // 初期化時に個々のオブジェクトのvisibleも設定
        if (this.cameraDebugSpheres) {
            this.cameraDebugSpheres.forEach(sphere => {
                if (sphere) sphere.visible = this.SHOW_CAMERA_DEBUG;
            });
        }
        if (this.cameraDebugCircles) {
            this.cameraDebugCircles.forEach(circles => {
                if (circles) {
                    circles.forEach(circle => {
                        if (circle) circle.visible = this.SHOW_CAMERA_DEBUG;
                    });
                }
            });
        }
        if (this.cameraDebugLines) {
            this.cameraDebugLines.forEach(line => {
                if (line) line.visible = this.SHOW_CAMERA_DEBUG;
            });
        }
    }
    
    /**
     * カメラデバッグを描画
     */
    drawCameraDebug() {
        // Canvasをクリア（SHOW_CAMERA_DEBUGがfalseの時もクリアする）
        if (this.cameraDebugCtx && this.cameraDebugCanvas) {
            this.cameraDebugCtx.clearRect(0, 0, this.cameraDebugCanvas.width, this.cameraDebugCanvas.height);
        }
        
        if (!this.SHOW_CAMERA_DEBUG || !this.cameraDebugGroup) {
            // デバッグが無効な場合は、個々のオブジェクトも非表示にする
            if (this.cameraDebugSpheres) {
                this.cameraDebugSpheres.forEach(sphere => {
                    if (sphere) sphere.visible = false;
                });
            }
            return;
        }
        
        // 中心位置を取得（サブクラスでオーバーライド可能）
        const center = this.getCameraDebugCenter ? this.getCameraDebugCenter() : new THREE.Vector3(0, 0, 0);
        
        // 各カメラパーティクルを描画
        for (let i = 0; i < this.cameraParticles.length; i++) {
            const cp = this.cameraParticles[i];
            const pos = cp.getPosition();
            
            // Sphereを更新
            if (i < this.cameraDebugSpheres.length) {
                const sphere = this.cameraDebugSpheres[i];
                sphere.position.copy(pos);
                sphere.visible = true;
            }
            
            // 周囲のCircleを更新（スケールも確実に1.0に設定）
            // SHOW_CAMERA_DEBUG_CIRCLESフラグで制御
            if (this.SHOW_CAMERA_DEBUG_CIRCLES && i < this.cameraDebugCircles.length) {
                const circles = this.cameraDebugCircles[i];
                if (circles && Array.isArray(circles)) {
                    circles.forEach((circle, circleIndex) => {
                        if (circle) {
                            circle.position.copy(pos);
                            circle.scale.set(1.0, 1.0, 1.0);  // スケールを確実に1.0に設定（巨大化を防ぐ）
                            circle.visible = true;
                            
                            // マテリアルのopacityも確認
                            if (circle.material) {
                                circle.material.opacity = 1.0;  // 確実に不透明に
                                circle.material.needsUpdate = true;
                            }
                        } else {
                            console.warn(`drawCameraDebug: Camera particle #${i + 1}, circle #${circleIndex} is null`);
                        }
                    });
                } else {
                    console.warn(`drawCameraDebug: Camera particle #${i + 1} has invalid circles array`, circles);
                }
            } else if (i < this.cameraDebugCircles.length) {
                // SHOW_CAMERA_DEBUG_CIRCLESがfalseの場合はCircleを非表示
                const circles = this.cameraDebugCircles[i];
                if (circles && Array.isArray(circles)) {
                    circles.forEach((circle) => {
                        if (circle) {
                            circle.visible = false;
                        }
                    });
                }
            }
            
            // 中心への線を更新
            if (i < this.cameraDebugLines.length) {
                const line = this.cameraDebugLines[i];
                if (line && line.geometry) {
                    const positions = new Float32Array([
                        pos.x, pos.y, pos.z,
                        center.x, center.y, center.z
                    ]);
                    line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    line.geometry.attributes.position.needsUpdate = true;
                    line.visible = true;
                } else {
                    console.warn(`drawCameraDebug: Camera particle #${i + 1} has no line or line.geometry`);
                }
            }
            
            // テキストを描画（位置を安定させるため、前フレームの位置を保持）
            if (this.cameraDebugCtx && this.cameraDebugCanvas) {
                const vector = pos.clone();
                vector.project(this.camera);
                
                const x = (vector.x * 0.5 + 0.5) * this.cameraDebugCanvas.width;
                const y = (-vector.y * 0.5 + 0.5) * this.cameraDebugCanvas.height;
                
                // 画面外や背面の場合は描画しない
                if (x >= 0 && x <= this.cameraDebugCanvas.width && y >= 0 && y <= this.cameraDebugCanvas.height && vector.z < 1.0 && vector.z > -1.0) {
                    // 位置が急激に変化する場合は描画をスキップ（ちらつき防止）
                    if (!this.cameraDebugTextPositions) {
                        this.cameraDebugTextPositions = [];
                    }
                    if (!this.cameraDebugTextPositions[i]) {
                        this.cameraDebugTextPositions[i] = { x, y };
                    }
                    
                    // 前フレームとの距離を計算
                    const prevPos = this.cameraDebugTextPositions[i];
                    const dx = x - prevPos.x;
                    const dy = y - prevPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // 急激な変化（100px以上）の場合は描画をスキップ
                    if (distance < 100) {
                        // スムーズに補間（前フレームの位置と現在の位置を混ぜる）
                        const smoothX = prevPos.x * 0.3 + x * 0.7;
                        const smoothY = prevPos.y * 0.3 + y * 0.7;
                        
                        this.cameraDebugCtx.save();
                        this.cameraDebugCtx.fillStyle = 'white';  // 白
                        this.cameraDebugCtx.font = '16px monospace';
                        this.cameraDebugCtx.textAlign = 'center';
                        this.cameraDebugCtx.textBaseline = 'bottom';
                        
                        // カメラ番号と座標を表示
                        const cameraText = `camera #${i + 1}`;
                        const coordText = `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
                        this.cameraDebugCtx.fillText(cameraText, smoothX, smoothY - 80);
                        this.cameraDebugCtx.fillText(coordText, smoothX, smoothY - 60);
                        
                        this.cameraDebugCtx.restore();
                        
                        // 位置を更新
                        this.cameraDebugTextPositions[i] = { x: smoothX, y: smoothY };
                    } else {
                        // 急激な変化の場合は位置だけ更新（描画はスキップ）
                        this.cameraDebugTextPositions[i] = { x, y };
                    }
                }
            }
        }
    }
}
