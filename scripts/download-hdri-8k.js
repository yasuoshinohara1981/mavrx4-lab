#!/usr/bin/env node
/**
 * Poly Havenから8K HDRIをダウンロードするスクリプト
 * 使い方: node scripts/download-hdri-8k.js [枚数] [出力ディレクトリ]
 * 例: node scripts/download-hdri-8k.js 10 src/assets
 */

import { writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
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

async function main() {
  const count = parseInt(process.argv[2] || '10', 10);
  const outDir = process.argv[3] || join(__dirname, '../src/assets');
  const targetDir = outDir.startsWith('/') ? outDir : join(__dirname, '..', outDir);

  await mkdir(targetDir, { recursive: true });
  console.log(`📥 Poly Havenから8K HDRIを${count}枚ダウンロード → ${targetDir}\n`);

  const assets = await fetchJson(`${API_BASE}/assets?t=hdris`);
  const ids = Object.keys(assets).sort((a, b) => (assets[b].download_count || 0) - (assets[a].download_count || 0));

  let downloaded = 0;
  let skipped = 0;

  for (const id of ids) {
    if (downloaded >= count) break;

    try {
      const files = await fetchJson(`${API_BASE}/files/${id}`);
      const hdri = files?.hdri;
      if (!hdri || !hdri['8k'] || !hdri['8k'].hdr) {
        skipped++;
        continue;
      }

      const url = hdri['8k'].hdr.url;
      const filename = `${id}_8k.hdr`;
      const destPath = join(targetDir, filename);

      console.log(`[${downloaded + 1}/${count}] ${id}...`);
      await downloadFile(url, destPath);
      downloaded++;
      console.log(`  ✓ ${filename}\n`);

      // レート制限対策
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`  ✗ ${id}: ${err.message}\n`);
    }
  }

  console.log(`\n完了: ${downloaded}枚ダウンロード, ${skipped}枚スキップ（8K非対応）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
