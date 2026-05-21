import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

// HDRI loader cache (HDR/EXR対応)
// - 複数シーンで同じHDRを何度もloadしない（GPUメモリ/初期化時間の節約）
const _hdrPromiseCache = new Map();

export function loadHdrCached(file) {
  if (!file) throw new Error("loadHdrCached: file is required");
  const key = String(file);
  const cached = _hdrPromiseCache.get(key);
  if (cached) return cached;

  const isExr = /\.exr$/i.test(file);

  const p = new Promise((resolve, reject) => {
    const onLoad = (result) => {
      try {
        result.mapping = THREE.EquirectangularReflectionMapping;
        resolve(result);
      } catch (e) {
        reject(e);
      }
    };

    if (isExr) {
      new EXRLoader().load(file, onLoad, undefined, (err) => reject(err));
    } else {
      new RGBELoader().load(file, onLoad, undefined, (err) => reject(err));
    }
  });

  _hdrPromiseCache.set(key, p);
  return p;
}
