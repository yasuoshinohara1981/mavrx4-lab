// build-report.mjs
// visual-check.mjs が出力した JSON を読み、スクショを埋め込んだ
// 「お洒落なアーティストページ風 レンダーレポート HTML」を生成する。
// この HTML を Claude Code の Artifact ツールで公開すればリモートでも見れる。
//
// 使い方:
//   node tools/build-report.mjs --json screenshots/visualcheck_Scene08_xxxx.json
//   (--out 省略時は JSON と同じ場所に .html を出す)
//
// スクショは 1280px 幅 JPEG に縮小して data URI 埋め込み(CSP対策 & 軽量化)。
// 縮小には macOS の sips を使う。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const jsonPath = arg('json', '');
if (!jsonPath || !fs.existsSync(jsonPath)) {
  console.error('ERROR: --json <visualcheck json> が必要や'); process.exit(1);
}
const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const shotDir = d.shotDir;
const outPath = arg('out', jsonPath.replace(/\.json$/, '.html'));
const embedDir = path.join(shotDir, 'embed');
if (!fs.existsSync(embedDir)) fs.mkdirSync(embedDir, { recursive: true });

const embed = (file) => {
  const src = path.join(shotDir, file);
  const jpg = path.join(embedDir, file.replace(/\.png$/, '.jpg'));
  try {
    execSync(`sips --resampleWidth 1280 -s format jpeg -s formatOptions 78 "${src}" --out "${jpg}"`,
      { stdio: 'ignore' });
    return `data:image/jpeg;base64,${fs.readFileSync(jpg).toString('base64')}`;
  } catch {
    // sips が無い/失敗したら元PNGをそのまま埋め込む
    return `data:image/png;base64,${fs.readFileSync(src).toString('base64')}`;
  }
};

const s = d.stamp;
const stampFmt = `${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)} JST`;
const frames = d.captures.map((c, i) => ({
  n: String(c.i).padStart(2, '0'),
  fps: c.fpsAtShot,
  t: `T+${(d.warmupSec + d.gapSec * (i + 1)).toFixed(1).padStart(4,'0')}s`,
  src: embed(c.file),
}));
const f = d.fps;
const sceneNo = String(d.scene.no).padStart(2, '0');
const pct = (ms) => Math.min(100, (ms / 33.34) * 100).toFixed(1);
const sim = !!d.simulate;
const simChip = sim ? `<span class="chip">SIM LOAD · ${d.simSent} hits</span>` : '';
const loadLabel = sim ? 'OSC-DRIVEN LOAD' : 'IDLE';

const html = `<title>MAVRX4 — Render Report / Scene ${sceneNo}</title>
<style>
  :root{
    --bg:#04060B; --bg2:#070A12; --panel:#0A0E17;
    --line:rgba(122,144,180,.14); --line2:rgba(122,144,180,.28);
    --ink:#D8E0EE; --dim:#6B7788; --dim2:#8A97AC;
    --accent:#FF2E2E; --scene:#3B78FF; --ok:#43E3A0;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
    --pad:clamp(18px,4vw,64px);
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--mono);
    -webkit-font-smoothing:antialiased;letter-spacing:.02em;line-height:1.5;scroll-snap-type:y proximity;}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:60;
    background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 2px,rgba(0,0,0,.16) 2px 3px);
    mix-blend-mode:multiply;opacity:.5;}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:61;opacity:.05;
    background-image:radial-gradient(rgba(255,255,255,.9) .5px,transparent .6px);background-size:3px 3px;}
  .mono-num{font-variant-numeric:tabular-nums}
  .hud-bar{position:fixed;left:0;right:0;z-index:50;display:flex;align-items:center;gap:14px;
    padding:9px var(--pad);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim2);
    background:linear-gradient(var(--bg),rgba(4,6,11,.6));backdrop-filter:blur(4px);}
  .hud-top{top:0;border-bottom:1px solid var(--line)}
  .hud-bot{bottom:0;top:auto;border-top:1px solid var(--line);
    background:linear-gradient(rgba(4,6,11,.6),var(--bg));justify-content:space-between}
  .hud-bar .dot{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .hud-bar .sep{flex:1;height:1px;background:repeating-linear-gradient(90deg,var(--line2) 0 6px,transparent 6px 12px)}
  .tick{color:var(--accent)}
  main{max-width:1400px;margin:0 auto;padding:0 var(--pad)}
  .hero{min-height:100vh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;
    position:relative;padding-top:64px;padding-bottom:64px;overflow:hidden}
  .hero-bg{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center;
    filter:saturate(1.05) contrast(1.02);opacity:.5}
  .hero-veil{position:absolute;inset:0;z-index:1;
    background:radial-gradient(120% 90% at 70% 20%,transparent,rgba(4,6,11,.55) 55%,var(--bg) 92%),
      linear-gradient(180deg,rgba(4,6,11,.5),rgba(4,6,11,.2) 40%,var(--bg))}
  .hero-inner{position:relative;z-index:2;display:grid;grid-template-columns:1.5fr .9fr;gap:clamp(24px,5vw,80px);align-items:end}
  .eyebrow{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:var(--accent);margin:0 0 18px;
    display:flex;align-items:center;gap:12px}
  .eyebrow::before{content:"";width:26px;height:1px;background:var(--accent)}
  h1{font-size:clamp(44px,9vw,132px);line-height:.9;margin:0;font-weight:600;letter-spacing:-.02em;
    text-wrap:balance;text-transform:uppercase}
  h1 .slash{color:var(--accent);font-weight:400}
  h1 .sub{display:block;font-size:clamp(15px,2.2vw,26px);letter-spacing:.32em;color:var(--dim2);margin-top:22px;font-weight:400}
  .lede{max-width:44ch;color:var(--dim2);font-size:14px;margin:26px 0 0;line-height:1.7}
  .readout{border:1px solid var(--line);background:rgba(7,10,18,.5);backdrop-filter:blur(3px);padding:20px 22px}
  .readout h3{margin:0 0 14px;font-size:11px;letter-spacing:.22em;color:var(--dim);text-transform:uppercase;display:flex;justify-content:space-between}
  .readout h3 b{color:var(--ok);font-weight:400}
  .kv{display:flex;justify-content:space-between;gap:16px;padding:7px 0;font-size:12.5px;border-top:1px dashed var(--line)}
  .kv:first-of-type{border-top:0}
  .kv span:first-child{color:var(--dim)} .kv span:last-child{color:var(--ink)}
  .brk{position:relative}
  .brk::before,.brk::after{content:"";position:absolute;width:14px;height:14px;border:1px solid var(--line2)}
  .brk::before{top:-1px;left:-1px;border-right:0;border-bottom:0}
  .brk::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
  section.telemetry{padding:clamp(48px,9vh,110px) 0;scroll-snap-align:start;min-height:100vh;
    display:flex;flex-direction:column;justify-content:center;border-top:1px solid var(--line)}
  .sec-head{display:flex;align-items:baseline;gap:16px;margin-bottom:40px}
  .sec-head .idx{color:var(--accent);font-size:13px;letter-spacing:.1em}
  .sec-head h2{margin:0;font-size:clamp(16px,2.4vw,22px);letter-spacing:.24em;text-transform:uppercase;font-weight:500}
  .sec-head .rule{flex:1;height:1px;background:var(--line)}
  .sec-head .meta{color:var(--dim);font-size:11px;letter-spacing:.16em}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}
  .stat{background:var(--panel);padding:26px 22px 22px;position:relative}
  .stat .lab{font-size:10.5px;letter-spacing:.2em;color:var(--dim);text-transform:uppercase}
  .stat .val{font-size:clamp(38px,6vw,66px);line-height:1;margin-top:14px;font-weight:600;letter-spacing:-.02em}
  .stat .val u{font-size:.34em;text-decoration:none;color:var(--dim2);margin-left:4px;letter-spacing:0}
  .stat .foot{margin-top:14px;font-size:10.5px;color:var(--dim);letter-spacing:.08em}
  .stat.good .dotline{color:var(--ok)}
  .bar{height:4px;margin-top:16px;background:rgba(122,144,180,.14);position:relative;overflow:hidden}
  .bar i{position:absolute;left:0;top:0;bottom:0;background:var(--scene)}
  .bar.warn i{background:var(--accent)}
  .bar .budget{position:absolute;top:-3px;bottom:-3px;width:1px;background:var(--dim2);left:50%}
  .sub-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-top:0}
  .sub{background:var(--bg2);padding:16px 22px;display:flex;justify-content:space-between;align-items:baseline}
  .sub .k{font-size:10.5px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase}
  .sub .v{font-size:15px}
  .note{margin-top:22px;font-size:11.5px;color:var(--dim);letter-spacing:.04em;line-height:1.7;max-width:78ch}
  .note b{color:var(--dim2);font-weight:400}
  section.gallery{padding:clamp(40px,7vh,88px) 0;scroll-snap-align:start;border-top:1px solid var(--line)}
  .frames{display:flex;flex-direction:column;gap:clamp(16px,2.4vw,30px);margin-top:8px}
  figure.frame{margin:0;position:relative;border:1px solid var(--line);background:#000;overflow:hidden}
  .chip{display:inline-flex;align-items:center;gap:7px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;
    padding:4px 10px;border:1px solid var(--accent);color:var(--accent);border-radius:2px;vertical-align:middle}
  .chip::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);
    box-shadow:0 0 8px var(--accent);animation:pulse 1.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  figure.frame img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;
    transition:transform .9s cubic-bezier(.2,.7,.2,1),filter .6s;filter:saturate(1.04)}
  figure.frame:hover img{transform:scale(1.045)}
  .frame .tag{position:absolute;top:12px;left:12px;display:flex;gap:8px;align-items:center;
    font-size:10.5px;letter-spacing:.16em;color:var(--ink);text-shadow:0 1px 6px #000}
  .frame .tag b{color:var(--accent);font-weight:600}
  .frame .fps{position:absolute;top:12px;right:12px;font-size:10.5px;letter-spacing:.12em;
    padding:4px 9px;border:1px solid var(--line2);background:rgba(4,6,11,.55);backdrop-filter:blur(2px)}
  .frame .fps u{text-decoration:none;color:var(--ok)}
  .frame .tc{position:absolute;bottom:12px;left:12px;font-size:10.5px;letter-spacing:.14em;color:var(--dim2);text-shadow:0 1px 6px #000}
  .frame .reticle{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .5s}
  figure.frame:hover .reticle{opacity:.7}
  .frame .reticle::before,.frame .reticle::after{content:"";position:absolute;background:var(--line2)}
  .frame .reticle::before{left:50%;top:44%;bottom:44%;width:1px}
  .frame .reticle::after{top:50%;left:47%;right:47%;height:1px}
  footer{padding:60px var(--pad) 30px;color:var(--dim);font-size:11px;letter-spacing:.12em;
    display:flex;flex-wrap:wrap;gap:10px 26px;justify-content:space-between;border-top:1px solid var(--line)}
  footer .l{display:flex;gap:22px;flex-wrap:wrap}
  @media(max-width:820px){
    .hero-inner{grid-template-columns:1fr}
    .stat-grid,.sub-grid,.frames{grid-template-columns:repeat(2,1fr)}
    .hud-top .hide-sm{display:none}
  }
  @media(prefers-reduced-motion:reduce){
    *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
    figure.frame:hover img{transform:none}
  }
  @keyframes boot{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .boot{animation:boot .7s both}
  .boot.d1{animation-delay:.05s}.boot.d2{animation-delay:.15s}.boot.d3{animation-delay:.28s}.boot.d4{animation-delay:.42s}
</style>

<div class="hud-bar hud-top">
  <span class="dot"></span><span>MAVRX4 · LIVE-VISUAL SYSTEM</span>
  <span class="sep"></span>
  <span class="hide-sm">RENDER REPORT</span><span class="hide-sm tick">●REC</span>
  <span>SCENE ${sceneNo}</span>
</div>

<main>
  <section class="hero">
    <div class="hero-bg" style="background-image:url('${frames[0].src}')"></div>
    <div class="hero-veil"></div>
    <div class="hero-inner">
      <div>
        <p class="eyebrow boot d1">Remote Render · Scene ${sceneNo} ${simChip}</p>
        <h1 class="boot d2">MAVRX4<span class="slash"> // </span>${sceneNo}
          <span class="sub">SCENE ${sceneNo}</span></h1>
        <p class="lede boot d3">実機Mac／Three.js(WebGL) を Chrome で回し、フルスクリーン ${d.viewport} で
          ${d.shots} フレームを ${d.gapSec}s 間隔で採取。フレームレートは ${f.seconds}s 連続サンプリング。
          ${sim ? `本ランは <b style="color:var(--accent)">シミュレーションモード</b>：OSCトラックを ~${d.simRate}/s でランダム発火（計 ${d.simSent} 発）した実負荷状態での計測である。` : '以下は今回のレンダーの実測ログである（アイドル時）。'}</p>
      </div>
      <div class="readout brk boot d4">
        <h3>SESSION LOG <b>● NOMINAL</b></h3>
        <div class="kv"><span>AVG FRAMERATE</span><span class="mono-num">${f.avgFps} fps</span></div>
        <div class="kv"><span>LOAD STATE</span><span>${loadLabel}</span></div>
        ${sim ? `<div class="kv"><span>OSC HITS</span><span class="mono-num">${d.simSent} @ ${d.simRate}/s</span></div>` : ''}
        <div class="kv"><span>RESOLUTION</span><span>${d.viewport}</span></div>
        <div class="kv"><span>SAMPLES</span><span class="mono-num">${f.frames} frames</span></div>
        <div class="kv"><span>DURATION</span><span class="mono-num">${f.seconds}s</span></div>
        <div class="kv"><span>GPU MODE</span><span>${d.headless ? 'HEADLESS' : 'ON-DEVICE'}</span></div>
        <div class="kv"><span>CAPTURED</span><span>${stampFmt}</span></div>
      </div>
    </div>
  </section>

  <section class="gallery">
    <div class="sec-head">
      <span class="idx">/ 01</span><h2>Frame Grabs</h2>
      <span class="rule"></span><span class="meta">${d.shots} STILLS · ${d.gapSec}s INTERVAL · ${sim ? 'SIM LOAD' : 'IDLE'}</span>
    </div>
    <div class="frames">
      ${frames.map(fr => `
      <figure class="frame">
        <img src="${fr.src}" alt="MAVRX4 Scene ${sceneNo} frame ${fr.n}" loading="lazy">
        <span class="reticle"></span>
        <div class="tag"><b>FRAME</b> ${fr.n}</div>
        <div class="fps mono-num">FPS <u>${fr.fps}</u></div>
        <div class="tc mono-num">${fr.t}</div>
      </figure>`).join('')}
    </div>
  </section>

  <section class="telemetry">
    <div class="sec-head">
      <span class="idx">/ 02</span><h2>Performance Telemetry</h2>
      <span class="rule"></span><span class="meta">VSYNC-CAPPED · 60Hz</span>
    </div>
    <div class="stat-grid">
      <div class="stat good"><div class="lab">AVG FPS</div>
        <div class="val mono-num">${f.avgFps}<u>fps</u></div>
        <div class="bar"><i style="width:${Math.min(100,(f.avgFps/60)*100)}%"></i></div>
        <div class="foot dotline">上限(60)にほぼ張り付き</div></div>
      <div class="stat good"><div class="lab">MEDIAN FRAME</div>
        <div class="val mono-num">${f.medianMs}<u>ms</u></div>
        <div class="bar"><i style="width:${pct(f.medianMs)}%"></i><span class="budget"></span></div>
        <div class="foot">中央値 · 16.7ms=60fps ライン</div></div>
      <div class="stat good"><div class="lab">P95 FRAME</div>
        <div class="val mono-num">${f.p95Ms}<u>ms</u></div>
        <div class="bar"><i style="width:${pct(f.p95Ms)}%"></i><span class="budget"></span></div>
        <div class="foot">95%tile · フレーム保持</div></div>
      <div class="stat warn"><div class="lab">WORST FRAME</div>
        <div class="val mono-num">${f.worstMs}<u>ms</u></div>
        <div class="bar warn"><i style="width:${pct(f.worstMs)}%"></i><span class="budget"></span></div>
        <div class="foot">単発ヒッチ = ${f.minFps}fps 相当</div></div>
    </div>
    <div class="sub-grid">
      <div class="sub"><span class="k">MIN FPS</span><span class="v mono-num">${f.minFps}</span></div>
      <div class="sub"><span class="k">FRAMES</span><span class="v mono-num">${f.frames}</span></div>
      <div class="sub"><span class="k">WINDOW</span><span class="v mono-num">${f.seconds}s</span></div>
      <div class="sub"><span class="k">RES</span><span class="v mono-num">${d.viewport}</span></div>
    </div>
    <p class="note"><b>読み方:</b> FPS はモニタのリフレッシュ(60Hz)に vsync でキャップされる。
      AVG ${f.avgFps} は「上限に張り付き＝快適」の意。MEDIAN / P95 が 16.7ms 付近なら体感はヌルヌル。
      WORST(最悪フレーム)が跳ねてないかがカクつきの指標である。${sim ? ' 本ランはSIM負荷下での数値である。' : ''}</p>
  </section>
</main>

<footer>
  <div class="l"><span>MAVRX4 · threejs-mavrx4-experiment</span><span>SCENE ${sceneNo}</span><span>SYS: OK</span></div>
  <div class="l"><span>localhost:3000</span><span class="mono-num">${stampFmt}</span></div>
</footer>

<div class="hud-bar hud-bot">
  <span>MAVRX4 RENDER REPORT</span>
  <span class="mono-num hide-sm">AVG ${f.avgFps}fps · WORST ${f.worstMs}ms · ${d.viewport}</span>
  <span class="tick">● ${stampFmt}</span>
</div>`;

fs.writeFileSync(outPath, html);
console.log(`report html: ${outPath} (${(html.length/1024/1024).toFixed(2)} MB)`);
