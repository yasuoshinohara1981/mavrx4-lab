/**
 * OSC通信管理クラス
 * WebSocket経由でOSCメッセージを受信
 */

export class OSCManager {
    constructor(options = {}) {
        const envUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_OSC_WS_URL;
        this.wsUrl = options.wsUrl || envUrl || OSCManager.defaultWsUrl();
        this.onMessage = options.onMessage || null;
        this.onStatusChange = options.onStatusChange || null;

        this.ws = null;
        this.isConnected = false;
        this._reconnectTimer = null;
        this._destroyed = false;

        this.init();
    }

    /** 従来どおり osc-server の WebSocket 専用ポート 8080（127.0.0.1 で IPv4 固定） */
    static defaultWsUrl() {
        return 'ws://127.0.0.1:8080';
    }

    _clearReconnectTimer() {
        if (this._reconnectTimer != null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    _detachSocket() {
        if (!this.ws) return;
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        try {
            this.ws.close();
        } catch (_) {
            /* ignore */
        }
        this.ws = null;
    }

    init() {
        if (this._destroyed) return;

        this._clearReconnectTimer();
        this._detachSocket();

        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                if (this.onStatusChange) {
                    this.onStatusChange('Connected');
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('OSCメッセージパースエラー:', error);
                }
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                if (this.onStatusChange) {
                    this.onStatusChange('Disconnected');
                }
                if (!this._destroyed) {
                    this._reconnectTimer = setTimeout(() => {
                        this._reconnectTimer = null;
                        this.init();
                    }, 5000);
                }
            };

            this.ws.onerror = () => {
                console.error('OSC WebSocket Error:', this.wsUrl);
                if (this.onStatusChange) {
                    this.onStatusChange('Error');
                }
            };
        } catch (error) {
            console.error('OSC初期化エラー:', error);
            if (this.onStatusChange) {
                this.onStatusChange('Error');
            }
        }
    }

    handleMessage(message) {
        if (this.onMessage) {
            this.onMessage(message);
        }
    }

    close() {
        this._destroyed = true;
        this._clearReconnectTimer();
        this._detachSocket();
    }
}
