/**
 * VHSのOSD（オンスクリーンディスプレイ）テクスチャ。
 * `▶ PLAY` / `SP` / 日付・時刻 / `REC ●` みたいなあのビデオデッキ表示をキャンバスへ描く。
 *
 * **これ自体は EffectComposer のパスではない**。
 * 合成は {@link VHSPass} のフラグメントシェーダー内で行う（`tOsd`/`uOsdOpacity`）。
 * 文字を重ねるだけのためにフルスクリーンパスを1枚増やすと、
 * 高DPIのフルスクリーンでは無視できない帯域コストになるため。
 */

import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three';

export class VHSOverlay {
    /**
     * @param {object} [options]
     * @param {number} [options.opacity=0.85] OSD文字の不透明度
     * @param {string} [options.color='#dff0ff'] 文字色（VHSの青白い蛍光色）
     * @param {string} [options.mode='PLAY'] 左上に出すモード表示
     * @param {string} [options.tape='SP'] テープ速度表示
     * @param {Date|null} [options.date=null] 表示する日時（null＝固定の架空日時）
     * @param {boolean} [options.showCounter=true] 右上のテープカウンタ
     */
    constructor(options = {}) {
        this.opacity = options.opacity ?? 0.85;
        this.color = options.color ?? '#dff0ff';
        this.mode = options.mode ?? 'PLAY';
        this.tape = options.tape ?? 'SP';
        this.showCounter = options.showCounter !== false;
        // 実在の日付を勝手に出すと紛らわしいので、ドリームコア定番の架空90年代日時を既定に
        this.dateText = options.dateText ?? 'JAN 01 1998';
        this._counterSec = 0;
        this._blinkT = 0;
        this._blinkOn = true;

        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 576;
        this.ctx = this.canvas.getContext('2d');

        this.texture = new CanvasTexture(this.canvas);
        this.texture.colorSpace = SRGBColorSpace;
        this.texture.minFilter = LinearFilter;
        this.texture.magFilter = LinearFilter;

        this._redraw();
    }

    /** テープカウンタとブリンクを進める */
    update(deltaTime) {
        this._counterSec += deltaTime;
        this._blinkT += deltaTime;
        let dirty = false;
        // 点滅は REC / PAUSE のときだけ。PLAY で点滅計算すると
        // 0.5秒ごとに 1024x576 のテクスチャ再アップロードが走って無駄
        const blinky = (this.mode === 'REC' || this.mode === 'PAUSE');
        if (blinky && this._blinkT >= 0.5) {
            this._blinkT = 0;
            this._blinkOn = !this._blinkOn;
            dirty = true;
        }
        // カウンタは秒が変わった時だけ描き直す（毎フレーム再描画は無駄）
        if (Math.floor(this._counterSec) !== this._lastDrawnSec) {
            this._lastDrawnSec = Math.floor(this._counterSec);
            dirty = true;
        }
        if (dirty) this._redraw();
    }

    /** 表示モードを差し替える（'PLAY' / 'REC' / 'PAUSE' / 'FF' / 'REW' など） */
    setMode(mode) {
        if (this.mode === mode) return;
        this.mode = mode;
        this._redraw();
    }

    _redraw() {
        const c = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        c.clearRect(0, 0, W, H);

        const pad = Math.round(W * 0.045);
        const fs = Math.round(H * 0.052);
        c.font = `bold ${fs}px "Courier New", ui-monospace, monospace`;
        c.textBaseline = 'top';
        c.fillStyle = this.color;
        c.shadowColor = this.color;
        c.shadowBlur = Math.round(fs * 0.5);   // 蛍光表示のにじみ

        // 左上：▶ PLAY（PAUSEとRECは点滅させる）
        const glyph = this.mode === 'PLAY' ? '▶'
            : this.mode === 'REC' ? '●'
            : this.mode === 'PAUSE' ? '‖'
            : this.mode === 'FF' ? '▶▶'
            : this.mode === 'REW' ? '◀◀' : '▶';
        const blinky = (this.mode === 'REC' || this.mode === 'PAUSE');
        if (!blinky || this._blinkOn) {
            c.fillText(`${glyph} ${this.mode}`, pad, pad);
        }

        // 左上2段目：テープ速度
        c.font = `bold ${Math.round(fs * 0.78)}px "Courier New", ui-monospace, monospace`;
        c.fillText(this.tape, pad, pad + Math.round(fs * 1.35));

        // 右上：テープカウンタ 0:00:00
        if (this.showCounter) {
            const t = Math.floor(this._counterSec);
            const hh = Math.floor(t / 3600);
            const mm = Math.floor((t % 3600) / 60);
            const ss = t % 60;
            const cnt = `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
            c.font = `bold ${Math.round(fs * 0.86)}px "Courier New", ui-monospace, monospace`;
            const w = c.measureText(cnt).width;
            c.fillText(cnt, W - pad - w, pad);
        }

        // 右下：日付（架空の90年代日時）
        c.font = `bold ${Math.round(fs * 0.86)}px "Courier New", ui-monospace, monospace`;
        const dw = c.measureText(this.dateText).width;
        c.fillText(this.dateText, W - pad - dw, H - pad - Math.round(fs * 1.0));

        c.shadowBlur = 0;
        this.texture.needsUpdate = true;
    }

    /** {@link VHSPass} へ渡してシェーダー内で合成させる（このクラスは描画しない） */
    bindTo(vhsPass) {
        if (!vhsPass?.material?.uniforms) return;
        vhsPass.material.uniforms.tOsd.value = this.texture;
        vhsPass.material.uniforms.uOsdOpacity.value = this.opacity;
    }

    dispose() {
        this.texture?.dispose();
    }
}
