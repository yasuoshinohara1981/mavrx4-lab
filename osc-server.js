/**
 * OSC WebSocket Server
 * OSCメッセージを受信してWebSocket経由でブラウザに転送
 * スクリーンショット保存機能も提供
 */

import OSC from 'osc-js';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OSC_PORT = 30337;  // Processingと同じポート
const WS_PORT = 8080;    // WebSocket（ブラウザ↔OSCサーバー）
// 3001 は他プロジェクトの Vite と衝突しがちなので 30338 固定（30337 の「隣」）
const HTTP_PORT = Number(process.env.OSC_HTTP_PORT) || 30338;

// screenshotsフォルダを作成（存在しない場合）
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    console.log(`screenshotsフォルダを作成: ${screenshotsDir}`);
}

// WebSocketサーバー（8080 専用・従来どおり）
const wss = new WebSocketServer({ port: WS_PORT });

console.log(`WebSocketサーバー起動: ws://localhost:${WS_PORT}`);

const osc = new OSC({
    plugin: new OSC.DatagramPlugin({
        open: {
            host: '0.0.0.0',
            port: OSC_PORT
        }
    })
});

osc.on('*', (message) => {
    const parsed = {
        address: message.address,
        args: message.args || [],
        trackNumber: null
    };

    const trackMatch = message.address.match(/\/track\/(\d+)/);
    if (trackMatch) {
        parsed.trackNumber = parseInt(trackMatch[1]);
    }

    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(parsed));
        }
    });

    console.log('OSC受信:', parsed);
});

osc.on('open', () => {
    console.log(`OSC受信開始: UDP/IPv4 ポート ${OSC_PORT} (バインド ${osc.options?.plugin?.options?.open?.host ?? '0.0.0.0'})`);
    console.log(
        `OSC送信先は **127.0.0.1:${OSC_PORT}** を推奨。「localhost」だけだと IPv6(::1) になり届かん環境がある（特に Windows）で。`
    );
});

osc.on('error', (error) => {
    console.error('OSC Error (受信パケットの解凍失敗やソケットエラーのときもここに来る):', error?.message || error);
    if (error?.stack) {
        console.error(error.stack);
    }
});

osc.open();

wss.on('connection', (ws) => {
    console.log('WebSocketクライアント接続');

    ws.on('close', () => {
        console.log('WebSocketクライアント切断');
    });

    ws.on('error', (error) => {
        console.error('WebSocket Error:', error);
    });
});

const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'osc-server' }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/save-texture') {
        console.log('🖼️ テクスチャ保存リクエスト受信');
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { filename, imageData, path: texturePath } = data;

                if (!filename || !imageData) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'filename and imageData are required' }));
                    return;
                }

                const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');

                let saveDir;
                if (texturePath) {
                    saveDir = path.join(__dirname, 'public', texturePath);
                } else {
                    saveDir = path.join(__dirname, 'public', 'textures');
                }

                if (!fs.existsSync(saveDir)) {
                    fs.mkdirSync(saveDir, { recursive: true });
                    console.log(`テクスチャ保存ディレクトリを作成: ${saveDir}`);
                }

                const filePath = path.join(saveDir, filename);

                fs.writeFileSync(filePath, buffer);

                console.log(`✅ テクスチャ保存成功: ${filePath}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, path: filePath }));
            } catch (error) {
                console.error('❌ テクスチャ保存エラー:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/api/screenshot') {
        console.log('📸 スクリーンショットリクエスト受信');
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                if (!body || body.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request body is empty' }));
                    return;
                }

                let data;
                try {
                    data = JSON.parse(body);
                } catch (parseError) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON: ' + parseError.message }));
                    return;
                }

                const { filename, imageData } = data;

                if (!filename || !imageData) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'filename and imageData are required' }));
                    return;
                }

                const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');

                const filePath = path.join(screenshotsDir, filename);

                fs.writeFileSync(filePath, buffer);

                console.log(`✅ スクリーンショット保存成功: ${filePath}`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, path: filePath }));
            } catch (error) {
                console.error('❌ スクリーンショット保存エラー:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(
            `[osc-server] HTTP ${HTTP_PORT} は使用中のため、スクリーンショット/テクスチャAPIのみ無効である。OSC(UDP ${OSC_PORT})とWebSocket(${WS_PORT})は継続する。別ポートは環境変数 OSC_HTTP_PORT を指定すること。`
        );
        return;
    }
    console.error('HTTPサーバーエラー:', err);
});

httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`HTTPサーバー起動: http://127.0.0.1:${HTTP_PORT}`);
});

console.log('OSC WebSocket Server 起動完了');
console.log(`OSC受信ポート: ${OSC_PORT}`);
console.log(`WebSocketポート: ${WS_PORT}`);
console.log(`HTTPポート: ${HTTP_PORT}`);
console.log(`スクリーンショット保存先: ${screenshotsDir}`);
