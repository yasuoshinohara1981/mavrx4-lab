/**
 * Three.js MAVRX4 Live Visual
 * メインエントリーポイント
 */

import * as THREE from 'three';
import { OSCManager } from './systems/OSCManager.js';
import { SceneManager } from './systems/SceneManager.js';
import { SharedResourceManager } from './lib/SharedResourceManager.js';
import { attachCanvasDragOrbit } from './lib/CanvasDragOrbit.js';

// ============================================
// 設定
// ============================================

// 開発モード/ライブモードの設定
// true: 開発モード（デフォルトシーンのみ読み込み）
// false: ライブモード（全てのシーンをプリロード）
const IS_DEVELOPMENT_MODE = false;  // 開発時は true に変更

// デフォルトシーンのインデックス（0 = Scene1, 1 = Scene2, 2 = Scene3, 3 = Scene4）
const DEFAULT_SCENE_INDEX = 3;

// ============================================
// 初期化
// ============================================

let renderer, camera, scene;
let sceneManager;
let oscManager;
let sharedResourceManager;
/** @type {ReturnType<typeof attachCanvasDragOrbit> | null} */
let canvasDragOrbit = null;

/** osc-server の WebSocket ポート（osc-server.js の WS_PORT と一致） */
const OSC_WS_PORT = 8080;

/** WebSocket URL（DEV は Vite 経由、ビルド後は osc-server 8080 直） */
function resolveOscWsUrl() {
    const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_OSC_WS_URL;
    if (fromEnv) return fromEnv;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const h = window.location.hostname;

    if (typeof import.meta !== 'undefined' && import.meta.env.DEV) {
        return `${proto}//${host}/__osc_ws`;
    }

    if (h === 'localhost' || h === '127.0.0.1') {
        return `ws://127.0.0.1:${OSC_WS_PORT}`;
    }
    return `${proto}//${h}:${OSC_WS_PORT}`;
}

/** SharedResourceManager 待ちのあいだに届いた OSC（sceneManager なしで捨てない） */
let _oscPending = [];
const OSC_PENDING_MAX = 2000;

// アニメーションループ用
let time = 0;
let lastTime = performance.now();
let frameCount = 0;

// キー入力管理
let ctrlPressed = false;

// マウスカーソル表示（デフォルト表示、c/C で表示/非表示を切り替え）
let appCursorVisible = true;

function applyAppCursorVisibility() {
    const style = appCursorVisible ? '' : 'none';
    document.body.style.cursor = style;
    if (renderer && renderer.domElement) {
        renderer.domElement.style.cursor = style;
    }
}

// ============================================
// レンダラーの初期化
// ============================================

function initRenderer() {
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true  // Canvas 2D で drawImage するために必要
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Retina 3x を 2x にキャップして軽量化（パフォーマンス優先）
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000);
    /** シーンの setup より前からシャドウを有効化（全シーン共通） */
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);
    applyAppCursorVisibility();
}

// ============================================
// カメラの初期化
// ============================================

function initCamera() {
    // Processing版のデフォルトFOVは60度
    // Three.jsのFOVを60度に変更（75度 → 60度）
    camera = new THREE.PerspectiveCamera(
        60,  
        window.innerWidth / window.innerHeight,
        1.0,  // 0.1 -> 1.0
        100000 // 50000 -> 100000 にさらに拡大！
    );
    camera.position.z = 1000;
}

// ============================================
// OSC管理の初期化
// ============================================

function initOSC() {
    const wsUrl = resolveOscWsUrl();
    oscManager = new OSCManager({
        wsUrl,
        onMessage: (message) => {
            if (sceneManager) {
                sceneManager.handleOSC(message);
            } else {
                if (_oscPending.length >= OSC_PENDING_MAX) {
                    _oscPending.shift();
                }
                _oscPending.push(message);
            }
        },
        onStatusChange: (status) => {
            document.getElementById('oscStatus').textContent = status;
            // 現在のシーンにOSC状態を設定
            if (sceneManager) {
                const currentScene = sceneManager.getCurrentScene();
                if (currentScene) {
                    currentScene.setOSCStatus(status);
                }
            }
        }
    });
}

// ============================================
// 共有リソースマネージャーの初期化
// ============================================

async function initSharedResourceManager() {
    sharedResourceManager = new SharedResourceManager(renderer);
    
    // 初期化（最大量のリソースを事前に作成）
await sharedResourceManager.init();
}

// ============================================
// シーンマネージャーの初期化
// ============================================

function initSceneManager() {
    sceneManager = new SceneManager(renderer, camera, sharedResourceManager, {
        isDevelopmentMode: IS_DEVELOPMENT_MODE,
        defaultSceneIndex: DEFAULT_SCENE_INDEX
    });

    canvasDragOrbit = attachCanvasDragOrbit(renderer.domElement, camera, {
        getTarget(out) {
            const sc = sceneManager?.getCurrentScene();
            if (sc && sc._centerSmoothed && sc._centerSmoothed.isVector3) return out.copy(sc._centerSmoothed);
            return out.set(0, 400, 0);
        }
    });
    
    // モード表示
    if (IS_DEVELOPMENT_MODE) {
} else {
}
    
    // シーン切り替え時のコールバック
    sceneManager.onSceneChange = (sceneName) => {
        document.getElementById('sceneName').textContent = sceneName;
        if (canvasDragOrbit) {
            canvasDragOrbit.reset();
        }
    };
}

// ============================================
// アニメーションループ
// ============================================

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000.0;
    lastTime = now;
    time += deltaTime;

    // FPS計算
    frameCount++;
    if (frameCount % 60 === 0) {
        const fps = Math.round(1.0 / deltaTime);
        document.getElementById('fps').textContent = fps;
    }

    // シーンの更新
    if (sceneManager) {
        sceneManager.update(deltaTime);
        if (canvasDragOrbit) {
            canvasDragOrbit.applyAdditive();
        }
        sceneManager.render();
    }
}

// ============================================
// リサイズ処理
// ============================================

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    if (sceneManager) {
        sceneManager.onResize();
    }
}

// ============================================
// フルスクリーン処理
// ============================================

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
});
    } else {
        document.exitFullscreen();
    }
}

// ============================================
// キーボード入力処理
// ============================================

/**
 * キーが押された時の処理（キーダウン）
 */
function handleKeyDown(e) {
    // Ctrlキーの状態を確認（e.ctrlKey/e.metaKeyを直接確認してより確実に）
    if (e.key === 'Control' || e.key === 'Meta') {
        ctrlPressed = true;
        return;
    }
    
    // e.ctrlKey/e.metaKeyを直接確認（より確実な検出）
    const isCtrlPressed = e.ctrlKey || e.metaKey;
    // Alt+Tab やフォーカス移動で Control の keyup を取り逃がすと ctrlPressed が固まり、
    // 数字以外のキーがすべて握りつぶされる。実際の修飾キー状態で同期する。
    if (!isCtrlPressed) {
        ctrlPressed = false;
    }
    
    if (!sceneManager) return;
    
    const currentScene = sceneManager.getCurrentScene();
    if (!currentScene) return;
    
    // [ ] でシーンバンク切替（1バンク=10シーン、Ctrl+数字でバンク内のスロットを選択）
    // e.key だけだとキーボード配列・IME・修飾キーで '[' にならず、下の Ctrl 分岐で握りつぶされることがある。
    // 物理位置は e.code（BracketLeft / BracketRight）で拾う。
    const isBankDec =
        e.key === '[' || e.code === 'BracketLeft';
    const isBankInc =
        e.key === ']' || e.code === 'BracketRight';
    if (isBankDec || isBankInc) {
        e.preventDefault();
        const maxBank = sceneManager.getMaxSceneBankIndex();
        if (isBankDec) {
            sceneManager.sceneBankIndex = Math.max(0, sceneManager.sceneBankIndex - 1);
        } else {
            sceneManager.sceneBankIndex = Math.min(maxBank, sceneManager.sceneBankIndex + 1);
        }
        currentScene.sceneBankIndex = sceneManager.sceneBankIndex;
        return;
    }
    
    // Ctrl + 数字キーでシーン切り替え（バンク内のスロット: 1=先頭 … 9=9番目、0=10番目）
    if (ctrlPressed || isCtrlPressed) {
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const slot = e.key === '0' ? 9 : (parseInt(e.key, 10) - 1);
            const sceneIndex = sceneManager.sceneBankIndex * 10 + slot;
            if (sceneIndex >= 0 && sceneIndex < sceneManager.scenes.length && sceneManager.scenes[sceneIndex]) {
                sceneManager.switchScene(sceneIndex);
            } else {
                console.warn(`[Scene] 無効なスロット: bank=${sceneManager.sceneBankIndex} key=${e.key} → index=${sceneIndex}`);
            }
            return;
        }
        // Ctrl押下中は他の処理をスキップ（数字キーがエフェクトとして処理されないように）
        return;
    }
    
    // h/HキーでHUDの位置・表示をサイクル（正方形→16:9→9:16→非表示→正方形…）
    if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        if (sceneManager) {
            // 4段階サイクル: 0→1→2→3→0
            sceneManager.globalHudPositionMode = (sceneManager.globalHudPositionMode + 1) % 4;
            sceneManager.globalShowHUD = (sceneManager.globalHudPositionMode !== 3);
            currentScene.showHUD = sceneManager.globalShowHUD;
            currentScene.hudPositionMode = sceneManager.globalHudPositionMode;
        } else {
            currentScene.showHUD = !currentScene.showHUD;
        }
        return;
    }
    
    // s/Sキーでスクリーンショット
    if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (currentScene.takeScreenshot) {
            // HUDの現在のモードに合わせて16:9か正方形かを自動判定
            // 1: 16:9, それ以外: 正方形
            const isWide = (sceneManager && sceneManager.globalHudPositionMode === 1);
            currentScene.takeScreenshot(isWide);
        }
        return;
    }
    
    // y/Yキーでスクリーンショット（16:9）
    if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        if (currentScene.takeScreenshot) {
            currentScene.takeScreenshot(true);  // true = 16:9
        }
        return;
    }
    
    // 数字キー1〜9でエフェクトのオン/オフをトグル（Ctrlが押されていない時のみ）
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= 9) {
        e.preventDefault();
        // エフェクトのオン/オフを切り替え
        if (currentScene.toggleEffect) {
            currentScene.toggleEffect(num);
        }
        return;
    }
    
    // 数字キー0はそのままOSCメッセージとして処理（10として扱う）
    if (e.key === '0') {
        e.preventDefault();
        const message = {
            trackNumber: 10,
            args: [],
            address: `/track/10`
        };
        currentScene.handleTrackNumber(10, message);
        return;
    }
    
    // r/Rキーでリセット
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (currentScene.reset) {
            currentScene.reset();
}
        return;
    }
    
    // c/Cキーでマウスカーソル表示の切り替え（Ctrl+C はコピー用に素通し）
    if (e.key === 'c' || e.key === 'C') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        appCursorVisible = !appCursorVisible;
        applyAppCursorVisibility();
        return;
    }
    
    // F11: フルスクリーン
    if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
    }
}

/**
 * キーが離された時の処理（キーアップ）
 */
function handleKeyUp(e) {
    // Ctrlキーの状態をリセット
    if (e.key === 'Control' || e.key === 'Meta') {
        ctrlPressed = false;
        return;
    }
    
    // e.ctrlKey/e.metaKeyがfalseになったら、ctrlPressedもリセット
    if (!e.ctrlKey && !e.metaKey) {
        ctrlPressed = false;
    }
    
    if (!sceneManager) return;
    
    const currentScene = sceneManager.getCurrentScene();
    if (!currentScene) return;
    
    // 数字キー0〜9の処理
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 0 && num <= 9) {
        let trackNumber = num;
        if (trackNumber === 0) {
            trackNumber = 10;  // '0' → 10
        }
        
        // トラック2、3、4、5はキーが離された時にエフェクトを無効化
        if (trackNumber === 2 || trackNumber === 3 || trackNumber === 4 || trackNumber === 5) {
            e.preventDefault();
            if (currentScene && currentScene.handleKeyUp) {
                currentScene.handleKeyUp(trackNumber);
            } else {
                console.warn('Scene does not have handleKeyUp method');
            }
            return;
        }
    }
    
    // その他のキーアップ処理
    if (e.key === 'l' || e.key === 'L') {
        // Lキーで線描画の切り替え
        currentScene.SHOW_LINES = !currentScene.SHOW_LINES;
}
    
    if (e.key === 'p' || e.key === 'P') {
        // Pキーでパーティクル表示の切り替え
        currentScene.SHOW_PARTICLES = !currentScene.SHOW_PARTICLES;
}
    
    // g/Gキーで3Dグリッドとルーラーの表示/非表示を切り替え
    if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        if (currentScene.gridRuler3D) {
            // 既に初期化されている場合は表示/非表示を切り替え
            currentScene.showGridRuler3D = !currentScene.showGridRuler3D;
            currentScene.gridRuler3D.setVisible(currentScene.showGridRuler3D);
} else {
            // 初期化されていない場合はデフォルトパラメータで初期化
            currentScene.showGridRuler3D = true;
            currentScene.initGridRuler3D({
                center: { x: 0, y: 0, z: 0 },
                size: { x: 1000, y: 1000, z: 1000 },
                floorY: -500,
                floorSize: 2000,
                floorDivisions: 40,
                labelMax: 64
            });
}
    }
}

/**
 * キー状態をリセット（ウィンドウがフォーカスを失った時などに呼ぶ）
 */
function resetKeyStates() {
    ctrlPressed = false;
}

/**
 * ウィンドウがフォーカスを失った時の処理
 */
function handleWindowBlur() {
    resetKeyStates();
}

/**
 * ページの可視性が変わった時の処理
 */
function handleVisibilityChange() {
    if (document.hidden) {
        resetKeyStates();
}
}

// キーイベントリスナーを登録
document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

// ウィンドウのフォーカス状態を監視
window.addEventListener('blur', handleWindowBlur);
document.addEventListener('visibilitychange', handleVisibilityChange);

// ============================================
// 初期化と起動
// ============================================

async function init() {
    initRenderer();
    initCamera();
    initOSC();
    
    // 共有リソースマネージャーを先に初期化（重い初期化を最初に実行）
    await initSharedResourceManager();
    
    // その後、シーンマネージャーを初期化
    initSceneManager();

    for (let i = 0; i < _oscPending.length; i++) {
        sceneManager.handleOSC(_oscPending[i]);
    }
    _oscPending = [];

    window.addEventListener('resize', onWindowResize);
    
    // デフォルトでフルスクリーンにする
    // ユーザー操作が必要なため、少し遅延させる
    setTimeout(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
            });
        }
    }, 500);
    
    // アニメーション開始
    animate();
}

// DOM読み込み後に初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

