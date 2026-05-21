/**
 * HDRI（src/assets/hdri/ 配下の全フォルダ）
 * import.meta.glob でビルド時に取り込み、ランダム選択
 * nature, pure_skies, urban など全HDRIから選択
 *
 * 光源設定: hdriLightConfig.json があればそれを優先（scripts/analyze-hdri-lights.mjs で事前解析）
 * なければファイル名キーワードから推定
 */

import hdriLightConfig from './hdriLightConfig.json';

// ビルド時に src/assets/hdri/**/*.exr と *.hdr をすべて取り込む
const exrModules = import.meta.glob('./hdri/**/*.exr', { eager: true, as: 'url' });
const hdrModules = import.meta.glob('./hdri/**/*.hdr', { eager: true, as: 'url' });
const hdriModules = { ...exrModules, ...hdrModules };

// フォルダごとにグループ化（nature / pure_skies / urban を均等に選ぶため）
const hdriByFolder = {};
for (const [path, url] of Object.entries(hdriModules)) {
  const match = path.match(/hdri\/([^/]+)\//);
  const folder = match ? match[1] : 'other';
  if (!hdriByFolder[folder]) hdriByFolder[folder] = [];
  hdriByFolder[folder].push([path, url]);
}
const folderNames = Object.keys(hdriByFolder).filter(f => hdriByFolder[f].length > 0);

/** ファイル名から光源・フレア設定を推定 */
function getLightConfigFromFilename(filename) {
  const name = filename.toLowerCase();
  if (name.includes('night') || name.includes('moon')) {
    return {
      sunPosition: { x: 1500, y: 3500, z: 7000 },
      sunColor: 0x8899bb,
      sunIntensity: 0.25,
      useLensFlare: false,
      lensFlareIntensity: 0,
      fogColor: 0x1a2030,
      fogDensity: 0.00012
    };
  }
  if (name.includes('sunset') || name.includes('dusk') || name.includes('dawn') || name.includes('sunrise') || name.includes('evening') || name.includes('fire')) {
    return {
      sunPosition: { x: 2500, y: 2000, z: 8500 },
      sunColor: 0xffcc88,
      sunIntensity: 1.0,
      useLensFlare: true,
      lensFlareIntensity: 0.4,
      fogColor: 0xd4a574,
      fogDensity: 0.0001
    };
  }
  if (name.includes('overcast') || name.includes('misty') || name.includes('clouds')) {
    return {
      sunPosition: { x: 3000, y: 6500, z: 5000 },
      sunColor: 0xe8e8e8,
      sunIntensity: 0.6,
      useLensFlare: false,
      lensFlareIntensity: 0,
      fogColor: 0xb8c4d0,
      fogDensity: 0.0001
    };
  }
  if (name.includes('partly_cloudy')) {
    return {
      sunPosition: { x: 3000, y: 7500, z: 5000 },
      sunColor: 0xfff0e0,
      sunIntensity: 0.95,
      useLensFlare: true,
      lensFlareIntensity: 0.22,
      fogColor: 0xb5d4e8,
      fogDensity: 0.00008
    };
  }
  if (name.includes('noon') || name.includes('afternoon') || name.includes('mid_morning') || name.includes('morning')) {
    return {
      sunPosition: { x: 3000, y: 8500, z: 5000 },
      sunColor: 0xfff5e6,
      sunIntensity: 1.25,
      useLensFlare: true,
      lensFlareIntensity: 0.2,
      fogColor: 0xb5d4e8,
      fogDensity: 0.00008
    };
  }
  if (name.includes('clear')) {
    return {
      sunPosition: { x: 3000, y: 8000, z: 5000 },
      sunColor: 0xffffff,
      sunIntensity: 1.3,
      useLensFlare: true,
      lensFlareIntensity: 0.28,
      fogColor: 0xb5d4e8,
      fogDensity: 0.00006
    };
  }
  return {
    sunPosition: { x: 3000, y: 8000, z: 5000 },
    sunColor: 0xfff5e6,
    sunIntensity: 1.2,
    useLensFlare: true,
    lensFlareIntensity: 0.25,
    fogColor: 0xb5d4e8,
    fogDensity: 0.00008
  };
}

/**
 * ランダムに1つ選んで URL と光源・フレア設定を返す
 * フォルダ（nature / pure_skies / urban）を均等確率で選んでから、その中から1つ選ぶ
 * → pure_skies が60個でも urban が1個でも、選ばれる確率は同じになる
 */
export function getRandomPureSky() {
  if (folderNames.length === 0) {
    console.warn('pureSkiesList: No HDRI files found in src/assets/hdri/');
    return {
      url: '',
      filename: '(none)',
      sunPosition: { x: 3000, y: 8000, z: 5000 },
      sunColor: 0xfff5e6,
      sunIntensity: 1.2,
      useLensFlare: true,
      lensFlareIntensity: 0.25,
      fogColor: 0xb5d4e8,
      fogDensity: 0.00008
    };
  }
  // 1. フォルダを均等確率で選択
  const folder = folderNames[Math.floor(Math.random() * folderNames.length)];
  const entries = hdriByFolder[folder];
  // 2. そのフォルダ内からランダムに1つ選択
  const [globPath, url] = entries[Math.floor(Math.random() * entries.length)];
  const filename = globPath.split('/').pop() || globPath.split('\\').pop() || globPath;
  // hdriLightConfig のキー形式: "pure_skies/xxx.exr"
  const configKey = globPath.replace(/^.*hdri[/\\]/, '').replace(/^[/\\]/, '');
  const analyzedConfig = hdriLightConfig[configKey];
  const config = analyzedConfig
    ? { ...analyzedConfig, sunPosition: { ...analyzedConfig.sunPosition } }
    : getLightConfigFromFilename(filename);
  return {
    url,
    filename,
    ...config
  };
}
