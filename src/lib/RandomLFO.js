/**
 * RandomLFO Class
 * LFOでLFOを揺らすクラス
 * LFOのrateとvalueを別のLFOを使って揺らす
 * rateLFOとvalueLFOの周期（rate）自体も別のLFOで揺らす
 */

import { LFO } from './LFO.js';

export class RandomLFO {
    constructor(minRate, maxRate, minValue, maxValue) {
        this.minRate = minRate;
        this.maxRate = maxRate;
        this.minValue = minValue;
        this.maxValue = maxValue;
        
        // rateLFOとvalueLFOのrateを揺らす範囲（デフォルト値）
        this.rateLFO_minRate = 0.01;   // 100秒で1周期
        this.rateLFO_maxRate = 0.1;    // 10秒で1周期
        this.valueLFO_minRate = 0.01;  // 100秒で1周期
        this.valueLFO_maxRate = 0.1;   // 10秒で1周期
        
        // rateLFOのrateを揺らすLFO（非常にゆっくり揺らす）
        // rateLFO_rateLFOのrateは固定値（例: 0.005 = 200秒で1周期）
        this.rateLFO_rateLFO = new LFO(0.005, this.rateLFO_minRate, this.rateLFO_maxRate);
        
        // valueLFOのrateを揺らすLFO（非常にゆっくり揺らす）
        // valueLFO_rateLFOのrateは固定値（例: 0.003 = 約333秒で1周期）
        this.valueLFO_rateLFO = new LFO(0.003, this.valueLFO_minRate, this.valueLFO_maxRate);
        
        // rateを揺らすLFO（rateLFO_rateLFOで制御される）
        const initialRateLFORate = (this.rateLFO_minRate + this.rateLFO_maxRate) / 2.0;
        this.rateLFO = new LFO(initialRateLFORate, minRate, maxRate);
        
        // valueを揺らすLFO（valueLFO_rateLFOで制御される）
        const initialValueLFORate = (this.valueLFO_minRate + this.valueLFO_maxRate) / 2.0;
        this.valueLFO = new LFO(initialValueLFORate, minValue, maxValue);
        
        // 実際に値を生成するLFO（初期値は中央値）
        const initialRate = (minRate + maxRate) / 2.0;
        const initialMinValue = (minValue + maxValue) / 2.0;
        const initialMaxValue = (minValue + maxValue) / 2.0;
        this.lfo = new LFO(initialRate, initialMinValue, initialMaxValue);
    }
    
    /**
     * 更新処理（毎フレーム呼ぶ）
     * @param {number} deltaTime - 前フレームからの経過時間（秒、オプション）
     */
    update(deltaTime = 1/60) {
        // rateLFO_rateLFOとvalueLFO_rateLFOを更新
        this.rateLFO_rateLFO.update(deltaTime);
        this.valueLFO_rateLFO.update(deltaTime);
        
        // rateLFOとvalueLFOのrateを更新（rateLFO_rateLFOとvalueLFO_rateLFOの値を使用）
        this.rateLFO.setRate(this.rateLFO_rateLFO.getValue());
        this.valueLFO.setRate(this.valueLFO_rateLFO.getValue());
        
        // rateLFOとvalueLFOを更新
        this.rateLFO.update(deltaTime);
        this.valueLFO.update(deltaTime);
        
        // 実際に使用するLFOのrateを更新（rateLFOの値を使用）
        this.lfo.setRate(this.rateLFO.getValue());
        
        // 実際に使用するLFOのvalue範囲を更新（valueLFOの値を使用）
        const currentValue = this.valueLFO.getValue();
        // valueLFOの値の周りに小さな範囲を設定（より滑らかな動きのため）
        const range = (this.maxValue - this.minValue) * 0.1;  // 範囲の10%
        this.lfo.setRange(currentValue - range, currentValue + range);
        
        // 実際に使用するLFOを更新
        this.lfo.update(deltaTime);
    }
    
    /**
     * 現在の値を取得
     * @return {number} 現在の値（minValue〜maxValueの範囲）
     */
    getValue() {
        return this.lfo.getValue();
    }
    
    /**
     * パラメータを設定
     */
    setMinRate(minRate) {
        this.minRate = minRate;
        this.rateLFO.setMinValue(minRate);
    }
    
    setMaxRate(maxRate) {
        this.maxRate = maxRate;
        this.rateLFO.setMaxValue(maxRate);
    }
    
    setRateRange(minRate, maxRate) {
        this.minRate = minRate;
        this.maxRate = maxRate;
        this.rateLFO.setRange(minRate, maxRate);
    }
    
    setMinValue(minValue) {
        this.minValue = minValue;
        this.valueLFO.setMinValue(minValue);
    }
    
    setMaxValue(maxValue) {
        this.maxValue = maxValue;
        this.valueLFO.setMaxValue(maxValue);
    }
    
    setValueRange(minValue, maxValue) {
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.valueLFO.setRange(minValue, maxValue);
    }
    
    /**
     * パラメータを取得
     */
    getMinRate() {
        return this.minRate;
    }
    
    getMaxRate() {
        return this.maxRate;
    }
    
    getMinValue() {
        return this.minValue;
    }
    
    getMaxValue() {
        return this.maxValue;
    }
    
    /**
     * 現在のrateを取得（デバッグ用）
     */
    getCurrentRate() {
        return this.lfo.getRate();
    }
    
    /**
     * rateLFOとvalueLFOのrate範囲を設定
     */
    setRateLFORateRange(minRate, maxRate) {
        this.rateLFO_minRate = minRate;
        this.rateLFO_maxRate = maxRate;
        this.rateLFO_rateLFO.setRange(minRate, maxRate);
    }
    
    setValueLFORateRange(minRate, maxRate) {
        this.valueLFO_minRate = minRate;
        this.valueLFO_maxRate = maxRate;
        this.valueLFO_rateLFO.setRange(minRate, maxRate);
    }
    
    /**
     * rateLFOとvalueLFOのrate範囲を取得
     */
    getRateLFOMinRate() {
        return this.rateLFO_minRate;
    }
    
    getRateLFOMaxRate() {
        return this.rateLFO_maxRate;
    }
    
    getValueLFOMinRate() {
        return this.valueLFO_minRate;
    }
    
    getValueLFOMaxRate() {
        return this.valueLFO_maxRate;
    }
    
    /**
     * 現在のrateLFOとvalueLFOのrateを取得（デバッグ用）
     */
    getCurrentRateLFORate() {
        return this.rateLFO.getRate();
    }
    
    getCurrentValueLFORate() {
        return this.valueLFO.getRate();
    }
    
    /**
     * リセット処理
     */
    reset() {
        this.rateLFO_rateLFO.reset();
        this.valueLFO_rateLFO.reset();
        this.rateLFO.reset();
        this.valueLFO.reset();
        this.lfo.reset();
    }
}

