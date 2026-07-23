// visual-check.mjs
// mavrx4 の「現在のデフォルトシーン」を Playwright(実機Chrome) で開いて、
//   - 時間差でスクショを複数枚(既定4枚)撮る
//   - FPS(平均/最低/最悪フレーム/p95) を連続計測、各ショット時点のFPSも記録
// を行い、結果を JSON + 読める要約で標準出力に吐く。
//
// ★シーンの切替はしない。src/main.js の DEFAULT_SCENE_INDEX で決まる
//   「今開くシーン」をそのまま撮る。撮りたいシーンはその定数で設定しておくこと。
//
// 使い方:
//   node tools/visual-check.mjs --shots 4 --gap 2.5 --stamp "$(date +%Y%m%d%H%M%S)"
//   node tools/visual-check.mjs --shots 6 --gap 2 --w 1920 --h 1080
//
// 前提: 別ターミナルで `npm run start`(OSC+Vite) が動いていること。
// 画像は screenshots/ に PNG 保存。レポート本文はファイルに書かず標準出力へ。

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OSC from 'osc-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');        // src/mavrx4
const SHOT_DIR = path.join(APP_DIR, 'screenshots');
const MAIN_JS = path.join(APP_DIR, 'src', 'main.js');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const url      = arg('url', 'http://localhost:3000');
const shots    = Math.max(1, Number(arg('shots', '4')));
const gapMs    = Math.round(Number(arg('gap', '2.5')) * 1000);
const warmupMs = Math.round(Number(arg('warmup', '2.5')) * 1000);
const width    = Number(arg('w', '1920'));
const height   = Number(arg('h', '1080'));
const fullscreen = flag('fullscreen'); // F11 でアプリのフルスクリーンを発火
const headless = flag('headless');   // 既定はヘッドあり(実機GPU)
const stamp    = arg('stamp', localStamp());
// --- シミュレーションモード (OSCトラックをランダム発火) ---
const simulate  = flag('simulate') || flag('sim');
const simRate   = Number(arg('sim-rate', '6'));    // 1秒あたりの平均トラック発火数
const simTracks = Number(arg('sim-tracks', '10')); // 使うトラック番号の上限(1..N)
const oscHost   = arg('osc-host', '127.0.0.1');
const oscPort   = Number(arg('osc-port', '30337'));

function localStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// main.js の DEFAULT_SCENE_INDEX からシーン番号/名を推定(アプリ改変なし)
function detectScene() {
  try {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    const m = src.match(/DEFAULT_SCENE_INDEX\s*=\s*(\d+)/);
    if (m) {
      const idx = Number(m[1]);
      return { index: idx, no: idx + 1, label: `Scene${String(idx + 1).padStart(2, '0')}` };
    }
  } catch {}
  return { index: null, no: null, label: 'Scene' };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// OSCシミュレーター: 実機と同じ経路(UDP 30337)へランダムな /track を流す
function createSimulator() {
  let osc = null, trackTimer = null, tickTimer = null, tick = 0, sent = 0;
  return {
    async open() {
      osc = new OSC({ plugin: new OSC.DatagramPlugin({
        open: { host: '127.0.0.1', port: 0 },       // 送信元は任意ポート
        send: { host: oscHost, port: oscPort },     // 受信は osc-server(30337)
      }) });
      await new Promise((res) => { osc.on('open', res); osc.open(); });
    },
    start() {
      const period = Math.max(20, Math.round(1000 / simRate));
      trackTimer = setInterval(() => {
        const tr = rint(1, simTracks);
        osc.send(new OSC.Message(`/track/${tr}`, rint(36, 96), rint(70, 127), rint(60, 400)));
        sent++;
      }, period);
      // 小節感を出すため actual_tick も緩やかに進める(1小節=384tick)
      tickTimer = setInterval(() => {
        tick = (tick + 8) % (384 * 96);
        osc.send(new OSC.Message('/actual_tick', tick));
      }, 60);
    },
    async stop() {
      if (trackTimer) clearInterval(trackTimer);
      if (tickTimer) clearInterval(tickTimer);
      try { if (osc) osc.close(); } catch {}
      return sent;
    },
    get sent() { return sent; },
  };
}

(async () => {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const scene = detectScene();

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const captures = [];
  let agg = null;
  let simSent = 0;
  const sim = simulate ? createSimulator() : null;
  if (sim) { await sim.open(); console.log(`  [SIM] OSC simulation ON → ${oscHost}:${oscPort} (~${simRate}/s, tracks 1..${simTracks})`); }
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(
      () => { const el = document.getElementById('fps'); return el && Number(el.textContent) > 0; },
      { timeout: 15000 }
    ).catch(() => {});
    if (fullscreen) {
      await page.click('body', { position: { x: 5, y: 5 } }).catch(() => {}); // ジェスチャ確保
      await page.keyboard.press('F11').catch(() => {});                        // アプリの requestFullscreen
      await sleep(600);
    }
    await sleep(warmupMs);

    // 連続FPS計測を開始(セッション全体を通して回す)
    await page.evaluate(() => {
      window.__fps = [];
      const loop = (t) => { window.__fps.push(t); window.__fps._raf = requestAnimationFrame(loop); };
      window.__fps._raf = requestAnimationFrame(loop);
    });

    if (sim) sim.start();  // 計測窓の間ずっとランダム発火

    for (let i = 0; i < shots; i++) {
      await sleep(gapMs);
      const nowFps = await page.evaluate(() => {
        const el = document.getElementById('fps');
        return el ? Number(el.textContent) : null;
      });
      const file = `visualcheck_${scene.label}_${stamp}_${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(SHOT_DIR, file) });
      captures.push({ i: i + 1, file, fpsAtShot: nowFps });
      console.log(`  shot ${i + 1}/${shots}  fps=${nowFps}  ${file}`);
    }

    // 集計
    agg = await page.evaluate(() => {
      const ts = window.__fps || [];
      cancelAnimationFrame(ts._raf);
      const d = [];
      for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
      d.sort((a, b) => a - b);
      const frames = d.length;
      const totalS = ts.length > 1 ? (ts[ts.length - 1] - ts[0]) / 1000 : 0;
      const avgFps = totalS ? frames / totalS : 0;
      const median = d[Math.floor(d.length / 2)] || 0;
      const p95 = d[Math.floor(d.length * 0.95)] || 0;
      const worst = d[d.length - 1] || 0;
      return {
        frames, seconds: +totalS.toFixed(2), avgFps: +avgFps.toFixed(1),
        medianMs: +median.toFixed(2), p95Ms: +p95.toFixed(2), worstMs: +worst.toFixed(2),
        minFps: worst ? +(1000 / worst).toFixed(1) : 0,
      };
    });
  } catch (err) {
    console.error('ERROR:', err && err.message ? err.message : err);
    agg = { error: String(err && err.message ? err.message : err) };
  } finally {
    if (sim) simSent = await sim.stop();
    await browser.close();
  }

  const report = {
    scene, url, viewport: `${width}x${height}`, headless,
    shots, gapSec: gapMs / 1000, warmupSec: warmupMs / 1000,
    stamp, shotDir: SHOT_DIR,
    simulate, simSent, simRate: simulate ? simRate : 0, simTracks: simulate ? simTracks : 0,
    fps: agg, captures,
    consoleErrors: consoleErrors.slice(0, 20),
  };
  // レポートJSONをファイルにも保存(build-report.mjs が読む)
  const jsonOut = arg('json-out', path.join(SHOT_DIR, `visualcheck_${scene.label}_${stamp}.json`));
  try { fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2)); } catch {}
  report.jsonOut = jsonOut;

  console.log('\n===VISUAL_CHECK_JSON===');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nreport json: ${jsonOut}`);
})();
