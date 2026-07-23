# 引き継ぎ：ラボ scene09（mathym | Xenofog）の調整作業

## 最優先の注意（ツールコール）
- AskUserQuestion やツールパラメータに**絵文字・特殊文字を入れるとパースエラー**になる。コード内コメントの日本語はOK。ツールの選択肢ラベル等に絵文字を入れない。
- Editの old_string は**ファイルの現在の中身と完全一致**させること（インデント込み）。途中でズレてエラーになったら必ず該当箇所を Read し直してからEdit。

## 対象ファイル
- メイン本体: `c:\projects\threejs-live\src\mavrx4-lab\src\scenes\scene09\Scene09.js`
- HUD（共通）: `c:\projects\threejs-live\src\mavrx4-lab\src\lib\HUD.js`
- 起動デフォルト: `c:\projects\threejs-live\src\mavrx4-lab\src\main.js`
- 参考シーン: `src/scenes/scene11/Scene11.js`（暗い部屋＋蛍光灯）, `src/scenes/scene02/Scene02.js`（StudioBox質感）

## このシーンの現状（何ができてるか）
mavrx4(メイン)/scene09 の data.scan を移植したもの。方針Aで完成済みの機能：
- **立方体グリッドが「XY平面の縦壁」**になっていて、壁が手前/奥(Z方向)にうねる（`_gridWarp`）。1立方体=1格子点。岩色チャコール質感・回転・IBLは維持。
- **赤い立体菱形マーカー◆**（八面体＋発光赤メタル＋IBL＋自転）が壁に追従（track1）。
- **3Dコールアウト**（track5）。
- **トラック別オシロ波形**（track1〜12、ヒートマップ色のTube、左壁→右壁を横断、前後Zうねり、滑らか化済み）。
- **track6 expand**（立方体の回転に勢い＋うねり増幅）。
- **track2 = 全画面フラッシュ（ストロボ）**（`useTrack2Strobe=true` + `attachStrobeFlashPass`）。
- **StudioBox（部屋）**を Scene11 風に「暗い(ambientIntensity:0.015)＋4隅蛍光灯を強発光(fluorescentPointIntensity:45.0)」で表示。
- ポスプロ（DOF/SSAO/Bloom/Fog）は Scene02 相当に質感調整済み（オートフォーカスDOF ON、bloomStrength:0.2）。
- HUDのトラック1〜4エフェクト表示は `FX1 FX2 FX3 FX4` に統一済み（HUD.js 2箇所：535行付近の下部クラスター、1046行付近のinfoパネル）。

## OSC処理の重要な構造（いじる時の注意）
- `handleOSC(message)` をオーバーライド。**track1/track5 を自前処理して return**、それ以外（track2/3/4・track6・/phase・/tick）は `super.handleOSC(message)` に委譲。
- 全トラックのノートは handleOSC 冒頭で `_addVoice(note, velocity, trackNumber)` して波形を鳴らす。
- track6 expand は `handleTrackNumber(6, message)` 経由（super.handleOSC の末尾から呼ばれる）。
- ラボ SceneBase は track1 で `switchCameraRandom()` して return する横取り仕様なので、必ず scene09 側で track1 を先取りすること。
- SceneBase 1008行で `trackNumber<=9 && !trackEffects[trackNumber]` だとスキップ。track2ストロボを効かせるには `trackEffects[2]=true` が必要。

## 今やりかけて「中断」した作業（ここが未完）
ユーザーの最新4要望に対応中だった。**部屋を大きくする方向は却下され、「部屋は10000デフォルトのまま、オブジェクトを小さくして収める」方針に転換**。
現状ファイルは**オブジェクトがまだデカいまま部屋からはみ出てる中途半端な状態**。以下を直す必要がある。

### 残タスク（未完了）
1. **オブジェクトを部屋(10000角・半径5000・床上面 STUDIO_FLOOR_TOP_Y=-498)に収める**。現状の値は大きすぎる：
   - `this.gridFieldW = 12000.0`（118行）→ **8000.0 くらい**に縮小（壁の横幅）
   - `this.gridFieldH = 5000.0`（119行）→ **4000.0 くらい**に（壁の縦幅）。`gridCenterY = 床 + 高さ/2` は自動で追従。
   - `this.waveFieldW = 15200.0`（143行）→ **9000.0 くらい**（左壁→右壁の横断。±4500で部屋内に収める）
   - カメラ初期 `this.camera.position.set(0, this.gridCenterY, 11000)`（571行）→ **z を部屋内(5000未満)に**。例: `4500`。
   - `this.camera.fov = 52`（566行）→ 標準の **42前後**に戻すか、狭い部屋で壁を映すなら広角のまま要調整。
   - `this.camera.far = 22000`（568行）→ 部屋内に戻すなら **14000前後**で十分。
   - **カメラランダマイズ範囲**（ユーザーが「まだ近い／範囲確認して」と指摘した箇所）：
     - `switchCameraRandom()`：`p.minDistance=9000 / p.maxDistance=15000`（532-533行）、`const dist = 10000 + random*4000`（539行）→ **部屋内に収まる距離**（例 min1500/max4800、dist 3000〜4500）に下げる。今は部屋(半径5000)の外に出る値になっている。
     - `setupCameraParticleDistance()`：`minDistance=9000 / maxDistance=15000 / maxDistanceReset=14000`（923-925行）→ 同様に部屋内スケールへ。
     - ※`switchCameraRandom` は壁を正面〜斜め前から見るよう yaw/pitch 制限済み（裏や真上に回り込まない）。距離だけ部屋内に直せばよい。

2. **デフォルト起動シーンを scene09 に**：
   - `src/main.js` 22行 `const DEFAULT_SCENE_INDEX = 0;` → **`8`**（scene09 は index 8。SceneManager の push 順で Scene01=0…Scene09=8）。

3. **エフェクトのデフォルトを全部ON**：
   - Scene09.js 77行付近 `this.trackEffects = { 1:true, 2:false, 3:false, 4:false, 5:false, 6:true, 7:false, 8:false, 9:false }` → **全部 true** に。
   - 注意：track2 は `useTrack2Strobe=true` なので、trackEffects[2]=true にすると**起動時からフラッシュが有効**になる（OSCのtrack2が来るたびにストロボ）。それで良いか一応意識。色反転ではなくフラッシュになる。

## スケール設計の教訓（重要）
- 部屋は **10000角（半径5000）・床上面 -498** が固定前提（StudioBox の floorTopY=-498 はハードコード）。
- 壁グリッド横幅・波形横幅・カメラ距離は**すべて 5000 を超えない範囲**で設計する。超えるとカメラが部屋の外に出て壁の裏＝暗転、または壁でオクルージョンされる。
- 「広い壁を部屋の中から全部映す」は幾何学的にキツい。fov を上げる（〜52）か、壁グリッドの横幅を抑える（〜8000）かで調整。8000幅なら fov42, z4500 程度で概ね収まる。

## サーバー / 確認方法
- ラボは `cd src/mavrx4-lab; npm run start`（OSC30337 / Vite3000 / WS8080 / HTTP30338）。mavrx4 と同時起動NG。
- 再起動時は先に `taskkill /F /IM node.exe /T` で掃除 → `npm run start`（background）→ `netstat` で 3000 LISTENING 確認。
- **ブラウザ自動操作ツール（Playwright等）は無い**。スクショAPIもブラウザが開いてる前提。確認はユーザーに Chrome で `http://localhost:3000` を強制リロード（Ctrl+Shift+R）→ Ctrl+9 でscene09、を依頼する。OSCは既にMax等から流れていることが多い。
- デフォルトを scene09 にした後は、リロードだけで scene09 が出る（Ctrl+9 不要）。

## 作業の進め方の推奨
1. まず上記「残タスク」の数値修正を一気に Edit（grid/wave/camera/ランダマイズ距離 → main.js の DEFAULT_SCENE_INDEX → trackEffects 全ON）。
2. `node --check src/scenes/scene09/Scene09.js` で構文確認。
3. サーバー再起動 → ユーザーにブラウザ確認依頼。
4. 「まだ大きい／小さい」「カメラ寄せて／引いて」は数値の往復調整になるので、一回ごとに値を見せて確認してもらう。

## 一時ファイル（掃除推奨）
- `src/mavrx4-lab/_osc_test_send.js`（OSC送信テスト用。生UDPで /kit22→track1→track5→track6 を送る。不要なら削除可）
- `src/mavrx4-lab/_HANDOFF_scene09.md`（この引き継ぎ。作業完了後に削除可）
