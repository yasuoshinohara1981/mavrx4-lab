#!/usr/bin/env node
/**
 * JSON のキー（パス形式）を元に Poly Haven から HDRI をダウンロード
 * 使い方: node scripts/download-hdri-from-config.js <config.json>
 *
 * 出力先: src/assets/hdri/{nature|pure_skies|urban}/{filename}
 * 例: src/assets/hdri/nature/dikhololo_night_8k.hdr
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://api.polyhaven.com';
const USER_AGENT = 'threejs-mavrx4-hdri-downloader/1.0';

const fetchOptions = {
  headers: { 'User-Agent': USER_AGENT },
};

async function fetchJson(url) {
  const res = await fetch(url, fetchOptions);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, { ...fetchOptions, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  await writeFile(destPath, Buffer.from(buf));
}

/**
 * configKey から asset ID と resolution を抽出
 * 例: "nature/dikhololo_night_8k.hdr" -> { assetId: "dikhololo_night", res: "8k", ext: "hdr", folder: "nature" }
 * 例: "pure_skies/autumn_field_puresky_1k.hdr" -> { assetId: "autumn_field_puresky", res: "1k", ext: "hdr", folder: "pure_skies" }
 */
function parseConfigKey(configKey) {
  const [folder, filename] = configKey.split('/');
  const ext = filename.split('.').pop();
  const base = filename.replace(/\.[^.]+$/, '');

  // 末尾の解像度 (_1k, _2k, _4k, _8k, _16k, _24k) を抽出
  const resMatch = base.match(/_(\d+k)$/i);
  const res = resMatch ? resMatch[1].toLowerCase() : '8k';
  const assetId = resMatch ? base.slice(0, -resMatch[1].length - 1) : base;

  return { assetId, res, ext, folder, filename };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: node scripts/download-hdri-from-config.js <config.json>');
    process.exit(1);
  }
  const outBase = join(__dirname, '../src/assets/hdri');

  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  const keys = Object.keys(config);

  console.log(`📥 ${configPath} の ${keys.length} 件を Poly Haven からダウンロード\n`);
  console.log(`出力先: ${outBase}\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const configKey of keys) {
    const { assetId, res, ext, folder, filename } = parseConfigKey(configKey);
    const destDir = join(outBase, folder);
    const destPath = join(destDir, filename);

    try {
      const files = await fetchJson(`${API_BASE}/files/${assetId}`);
      const hdri = files?.hdri;
      const resData = hdri?.[res];
      const format = resData?.[ext] || resData?.hdr || resData?.exr;

      if (!format?.url) {
        console.log(`  ⏭ ${configKey} … ${res}.${ext} が存在しない (スキップ)`);
        skipped++;
        continue;
      }

      await mkdir(destDir, { recursive: true });
      console.log(`  📥 ${configKey} …`);
      await downloadFile(format.url, destPath);
      console.log(`     ✓ ${destPath}`);
      downloaded++;

      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`  ✗ ${configKey}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n完了: ${downloaded} ダウンロード, ${skipped} スキップ, ${failed} 失敗`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
