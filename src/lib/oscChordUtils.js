/**
 * OSC args（osc-js が送るオブジェクト／素の数値の混在）から数値を取り出す
 * @param {unknown} x
 * @returns {number | null}
 */
export function oscArgToNumber(x) {
    if (x == null || x === '') return null;
    if (typeof x === 'number') return Number.isFinite(x) ? x : null;
    if (typeof x === 'string') {
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
    }
    if (typeof x === 'object' && x !== null && 'value' in x) {
        return oscArgToNumber(x.value);
    }
    return null;
}

/**
 * `/chord` 用：args を連続トリプレット [note, velocity, durationMs] とみなして分割。
 * （コードトラックで同一メッセージに複音が載る場合向け）
 * @param {unknown[] | undefined} args
 * @returns {{ note: number, velocity: number, durationMs: number }[]}
 */
export function parseChordHitsFromOscArgs(args) {
    const nums = [];
    for (const a of args || []) {
        const s = oscArgToNumber(a);
        if (s != null) nums.push(s);
    }
    const hits = [];
    for (let i = 0; i + 2 < nums.length; i += 3) {
        hits.push({
            note: nums[i],
            velocity: nums[i + 1],
            durationMs: nums[i + 2]
        });
    }
    return hits;
}
