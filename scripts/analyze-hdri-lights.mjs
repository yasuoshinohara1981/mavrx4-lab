#!/usr/bin/env node
/**
 * HDRI から光源位置を解析して JSON を出力する
 * 各 HDRI の最も明るいピクセル（太陽）を検出し、equirectangular から方向ベクトルに変換
 *
 * Usage: node scripts/analyze-hdri-lights.mjs <output.json> [hdriRoot]
 * 例: node scripts/analyze-hdri-lights.mjs ./hdri-light-config.json src/assets/hdri
 */

import { readExr, readHdr } from 'hdrify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 輝度を計算 (Rec. 709) */
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 最も明るいピクセルを検出（下半分をスキップ＝地面、上半分＝空） */
function findBrightestPixel(data, width, height) {
  let maxLum = 0;
  let maxIdx = 0;
  const halfHeight = Math.floor(height * 0.5); // 上半分の空だけ見る

  for (let y = 0; y < halfHeight; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = luminance(r, g, b);
      if (lum > maxLum) {
        maxLum = lum;
        maxIdx = idx;
      }
    }
  }

  const pixelIdx = maxIdx / 4;
  const px = pixelIdx % width;
  const py = Math.floor(pixelIdx / width);
  const r = data[maxIdx];
  const g = data[maxIdx + 1];
  const b = data[maxIdx + 2];
  return { x: px, y: py, lum: maxLum, r, g, b };
}

/** equirectangular UV → 方向ベクトル (Y-up,  Three.js 座標系) */
function uvToDirection(u, v) {
  const lon = (u - 0.5) * 2 * Math.PI;
  const lat = (0.5 - v) * Math.PI;
  const x = Math.cos(lat) * Math.sin(lon);
  const y = Math.sin(lat);
  const z = Math.cos(lat) * Math.cos(lon);
  return { x, y, z };
}

/** 方向ベクトルを Three.js の DirectionalLight 位置に変換 (距離 8000) */
function directionToLightPosition(dir, dist = 8000) {
  return {
    x: dir.x * dist,
    y: dir.y * dist,
    z: dir.z * dist
  };
}

/** 輝度から太陽の色と強さを推定 */
function estimateSunFromLuminance(lum, r, g, b) {
  const scale = Math.min(lum / 2, 1.5);
  const intensity = 0.5 + scale * 1.0;
  const hex = (Math.min(255, Math.floor(r * 255)) << 16) |
    (Math.min(255, Math.floor(g * 255)) << 8) |
    Math.min(255, Math.floor(b * 255));
  return { sunColor: hex, sunIntensity: intensity };
}

function getAllHdriFiles(dir, base = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(base, e.name);
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...getAllHdriFiles(full, rel));
    } else if (/\.(exr|hdr)$/i.test(e.name)) {
      results.push({ full, rel, ext: path.extname(e.name).toLowerCase() });
    }
  }
  return results;
}

async function analyzeOne(filePath, ext) {
  const buf = fs.readFileSync(filePath);
  const img = ext === '.exr' ? readExr(new Uint8Array(buf)) : readHdr(new Uint8Array(buf));
  const { data, width, height } = img;

  const { x: px, y: py, lum, r, g, b } = findBrightestPixel(data, width, height);
  const u = (px + 0.5) / width;
  const v = (py + 0.5) / height;
  const dir = uvToDirection(u, v);
  const sunPosition = directionToLightPosition(dir);
  const { sunColor, sunIntensity } = estimateSunFromLuminance(lum, r, g, b);

  return {
    sunPosition,
    sunColor,
    sunIntensity,
    useLensFlare: lum > 0.5,
    lensFlareIntensity: Math.min(0.4, lum * 0.3),
    fogColor: 0xb5d4e8,
    fogDensity: 0.00008
  };
}

async function main() {
  const outputArg = process.argv[2];
  const hdriRootArg = process.argv[3];
  if (!outputArg) {
    console.error('Usage: node scripts/analyze-hdri-lights.mjs <output.json> [hdriRoot]');
    process.exit(1);
  }
  const OUTPUT_PATH = path.isAbsolute(outputArg) ? outputArg : path.join(process.cwd(), outputArg);
  const HDRI_ROOT = hdriRootArg
    ? path.isAbsolute(hdriRootArg)
      ? hdriRootArg
      : path.join(process.cwd(), hdriRootArg)
    : path.join(__dirname, '../src/assets/hdri');

  const files = getAllHdriFiles(HDRI_ROOT);
  const config = {};

  console.log(`Analyzing ${files.length} HDRI files...`);

  for (const { full, rel } of files) {
    const key = rel.replace(/\\/g, '/');
    try {
      const ext = path.extname(full).toLowerCase();
      const result = await analyzeOne(full, ext);
      config[key] = result;
      console.log(`  OK: ${key}`);
    } catch (err) {
      console.error(`  FAIL: ${key} - ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main().catch(console.error);
