# mavrx4-lab

GPUパーティクルシステムを使ったライブビジュアル。OSCでトラック情報を受信し、リアルタイムでビジュアルを生成します。

## 🚀 クイックスタート

### 1. 依存関係のインストール

```bash
npm install
```

### 2. サーバー起動

**一括起動（おすすめ）**:

```bash
npm run start
```

OSCサーバーとVite開発サーバーが同時に起動します。

**別々に起動する場合**（2つのターミナルで）:

```bash
# ターミナル1: OSCサーバー
npm run osc-server

# ターミナル2: Vite開発サーバー
npm run dev
```

起動後のポート：
- **Vite**: `http://localhost:3000`（ブラウザが自動で開く）
- **OSC受信**: `30337`（Max/Processingから送信先として指定）
- **WebSocket**: `8080`（ブラウザ↔OSCサーバー）
- **HTTP**: `30338`（スクリーンショット保存用。環境変数 `OSC_HTTP_PORT` で変更可）

### 4. OSC送信テスト

#### Max/MSP から送信する場合（ローカル）

Maxの `udpsend` オブジェクトで以下のように設定：

- **送信先ホスト**: `127.0.0.1` または `localhost`
- **送信先ポート**: `30337`

```
[udpsend 127.0.0.1 30337]
```

または `udpreceive` の代わりに、Maxの `pack` + `udpsend` でOSCメッセージを送信：

```
[prepend /track/1]
[pack f f f 64 127 1000]
[udpsend 127.0.0.1 30337]
```

**対応メッセージ形式**:
- `/track/{1-16}` + `[noteNumber, velocity, duration]` … トラックメッセージ
- `/phase` + `[phaseValue]` … フェーズ
- `/actual_tick` + `[tickValue]` … 進行度（96小節で1ループ）

#### Processing から送信する場合

```processing
oscP5.send(
    new OscMessage("/track/1", 64.0, 127.0, 1000.0), 
    new NetAddress("127.0.0.1", 30337)
);
```

## 📁 プロジェクト構造

```
mavrx4-lab/
├── index.html              # メインHTML
├── package.json            # 依存関係
├── vite.config.js          # Vite設定
├── osc-server.js           # OSCサーバー（Node.js）
├── src/
│   ├── main.js             # エントリーポイント
│   ├── scenes/
│   │   ├── SceneBase.js    # シーンの基底クラス
│   │   ├── SceneTemplate.js # 新規シーン用テンプレート
│   │   ├── scene01/ 〜 scene17/ # 各シーン関連ファイル
│   │   └── ...
│   ├── systems/
│   │   ├── OSCManager.js   # OSC通信管理
│   │   └── SceneManager.js # シーン管理
│   └── lib/                # 共通ライブラリ
│       ├── GPUParticleSystem.js
│       ├── SharedResourceManager.js
│       ├── GridRuler3D.js
│       ├── HUD.js
│       └── ...
└── public/
    └── shaders/            # GLSLシェーダー
        ├── common/         # 共通シェーダー
        ├── scene01/ 〜 scene17/ # 各シーン専用シェーダー
        └── ...
```

## 🎮 使い方

### 開発モード / ライブモード

`src/main.js` の `IS_DEVELOPMENT_MODE` で切り替え可能です。
- **開発モード (`true`)**: デフォルトシーンのみを読み込み、高速に起動します。他のシーンは必要に応じて遅延ロードされます。
- **ライブモード (`false`)**: 全てのシーンをプリロードし、本番中のスムーズな切り替えを可能にします。

### キーボード操作

#### シーン切り替え（Ctrl + 数字）

起動時のデフォルトは `src/main.js` の `DEFAULT_SCENE_INDEX`（現在は Scene21）。

- **Ctrl + 1**: Scene21
- **Ctrl + 2**: Scene22（未実装なら無効）
- **Ctrl + 3**: Scene23（同上）
- **Ctrl + 4**: Scene24（同上）
- **Ctrl + 5**: Scene25（同上）
- **Ctrl + 6**: Scene26（同上）
- **Ctrl + 7**: Scene27（同上）
- **Ctrl + 8**: Scene28（同上）
- **Ctrl + 9**: Scene29（同上）
- **Ctrl + 0**: Scene20

#### エフェクト・トラック処理（数字キー単体）
- **0**: トラック10処理
- **1**: カメラランダマイズ ON/OFF
- **2**: 色反転エフェクト ON/OFF
- **3**: 色収差エフェクト ON/OFF
- **4**: グリッチエフェクト ON/OFF
- **5-9**: シーン依存のエフェクトまたはOSC送信

#### その他の操作
- **h/H**: HUDの表示/非表示を切り替え
- **s/S**: 正方形のスクリーンショットを撮影
- **y/Y**: 16:9のスクリーンショットを撮影
- **F11**: フルスクリーン切り替え
- **r/R**: シーンをリセット
- **l/L**: 線描画の表示/非表示を切り替え
- **p/P**: パーティクル表示の表示/非表示を切り替え
- **g/G**: 3Dグリッドとルーラーの表示/非表示を切り替え

## 📡 OSC通信

### アーキテクチャ

ブラウザではUDPソケットが直接使えないため、以下の構成になっています：

1. **OSCサーバー** (`osc-server.js`): Node.jsでOSCメッセージを受信
2. **WebSocket**: OSCサーバーとブラウザを接続
3. **ブラウザ**: WebSocket経由でOSCメッセージを受信

### メッセージ形式

- **トラック**: `/track/{trackNumber} [note, velocity, duration]`
- **和音（コード）**: `/chord` または `/chord/` — **トラックには流さない**。args を `[n0,v0,dur0, n1,v1,dur1, ...]` の連続トリプレットとして解釈し、各シーンの `handleChordBurst` で処理（`parseChordHitsFromOscArgs`）。オフにするには `chordBurstEffectEnabled = false`。
- **キット**: `/kit [kitNumber]` (シーン切り替えに使用)
- **フェーズ**: `/phase [phaseValue]`
- **ティック**: `/actual_tick [tickValue]` (進行度表示に使用)

## 🎨 シーン実装状況

- **Scene01**: 爆発とミサイルのパーティクルシステム
- **Scene02**: 接続線と球体のネットワーク
- **Scene03**: レーザースキャンとグラデーション背景
- **Scene04**: 大規模なTerrain表示 (1000x1000)
- **Scene07**: インスタンス化されたビルディング群
- **Scene08**: GPUによる布（Cloth）シミュレーション
- **Scene10**: カラビ・ヤウ多様体の可視化
- **Scene11-17**: 最新の追加シーン（パーティクル、幾何学エフェクト等）

## 🔧 開発ガイド

### 新しいシーンを追加する場合

1. `src/scenes/SceneTemplate.js` を参考に `src/scenes/sceneXX/SceneXX.js` を作成します。
2. `src/systems/SceneManager.js` で新しいシーンをインポートし、`createScene` または `initScenes` に追加します。
3. 必要に応じて `public/shaders/sceneXX/` にシェーダーを配置します。

### 共有リソースの利用

大量のパーティクルを扱う場合、`SharedResourceManager.js` を通じてGPUリソースを共有し、メモリ消費を抑えることができます。

## 📝 注意点

- **OSCサーバー**: 常に起動しておく必要があります。
- **フルスクリーン**: ブラウザの制約により、初回はユーザー操作（クリック等）が必要な場合があります。
- **パフォーマンス**: 大量（数十万個〜）のパーティクルは `GPUParticleSystem` を使用してGPU側で計算しています。

## 📚 参考

- [Three.js Documentation](https://threejs.org/docs/)
- [Vite Documentation](https://vitejs.dev/)
