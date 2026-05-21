# mavrx4-lab — 実験室シリーズ

**mavrx4-lab** は [mavrx4](https://github.com/yasuoshinohara1981/mavrx4) から分離した **実験室シリーズ** 専用リポジトリや。

StudioBox・コンクリート空間・Xeno 系ビジュアルなど、**ラボ／実験室テーマ**のシーンを OSC 連動でライブ演奏する Three.js プロジェクト。

## シーン構成（Scene01〜12）

| # | タイトル | 由来 |
|---|----------|----------|
| Scene01 | Xenosphere | mavrx4 Scene12 |
| Scene02 | Xenolith | mavrx4 Scene13 |
| Scene03 | Xenolite | mavrx4 Scene14 |
| Scene04 | Xenoball | mavrx4 Scene15 |
| Scene05 | Xenomorph | mavrx4 Scene16 |
| Scene06 | Mercury Mirror | mavrx4 Scene17 |
| Scene07 | Xeno Lab: Nucleus | mavrx4 Scene18 |
| Scene08 | mathym \| Xenomist | mavrx4 Scene21 |
| Scene09 | mathym \| Xenofog | mavrx4 Scene22 |
| Scene10 | mathym \| Xenobirth | 旧 lab Scene2（Emerald Swarm） |
| Scene11 | mathym \| Xenoxa | 旧 lab Scene3 |
| Scene12 | mathym \| Xenodub | 旧 lab Scene4 |

**Ctrl + 1〜9, 0** でバンク内切替（`[` / `]` でバンク切替）。バンク0 = Scene01〜10、バンク1 = Scene11〜12。

## クイックスタート

### 1. 依存関係のインストール

```bash
npm install
```

### 2. サーバー起動

**一括起動（おすすめ）**:

```bash
npm run start
```

**別々に起動する場合**:

```bash
npm run osc-server   # ターミナル1
npm run dev          # ターミナル2
```

起動後のポート：

- **Vite**: `http://localhost:3000`
- **OSC受信**: `30337`
- **WebSocket**: `8080`
- **HTTP**: `30338`（スクリーンショット保存。`OSC_HTTP_PORT` で変更可）

## プロジェクト構造

```
mavrx4-lab/
├── index.html
├── package.json
├── vite.config.js
├── osc-server.js
├── src/
│   ├── main.js
│   ├── scenes/
│   │   ├── SceneBase.js
│   │   ├── scene01/ … scene12/   # 実験室シリーズ全12シーン
│   │   └── ...
│   ├── systems/
│   │   ├── OSCManager.js
│   │   └── SceneManager.js
│   └── lib/                      # StudioBox, presentation, パーティクル等
└── public/
    └── shaders/common/
```

## キーボード操作

### シーン切り替え

- **Ctrl + 1〜9**: 現在バンクの Scene 1〜9 番目
- **Ctrl + 0**: 現在バンクの 10 番目
- **[ / ]**: シーンバンク切替

### その他

- **h/H**: HUD 表示サイクル
- **s/S**, **y/Y**: スクリーンショット（正方形 / 16:9）
- **r/R**, **l/L**, **p/P**, **g/G**: シーン依存の表示切替
- **c/C**: マウスカーソル表示切替

## OSC通信

- **トラック**: `/track/{1-16} [note, velocity, duration]`
- **和音**: `/chord` — 各シーンの `handleChordBurst` で処理
- **キット**: `/kit [kitNumber]` — kitNo に紐づくシーンへ切替
- **フェーズ**: `/phase [phaseValue]`
- **ティック**: `/actual_tick [tickValue]`

## 開発モード

`src/main.js` の `IS_DEVELOPMENT_MODE`:

- `true`: デフォルトシーンのみ読み込み（起動高速）
- `false`: 全12シーンをプリロード（ライブ向け）

## 関連リポジトリ

- **[mavrx4](https://github.com/yasuoshinohara1981/mavrx4)** — メインライブビジュアル（Scene01〜11 等）
- **mavrx4-lab**（本リポ） — 実験室シリーズ

## 参考

- [Three.js Documentation](https://threejs.org/docs/)
- [Vite Documentation](https://vitejs.dev/)
