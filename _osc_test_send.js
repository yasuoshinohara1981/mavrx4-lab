/**
 * Scene09 動作確認用の OSC 送信スクリプト（一時ファイル）。
 * 生UDPでOSCパケットを組んで 127.0.0.1:30337 へ送る。
 *   /kit 22        → scene09 へ切り替え
 *   /track/1 ...   → 赤い菱形マーカー◇
 *   /track/5 ...   → コールアウト
 *   /track/6 ...   → expand（立方体の回転に勢い）
 * 使い方: node _osc_test_send.js
 */
const dgram = require('dgram');

const HOST = '127.0.0.1';
const PORT = 30337;

function pad4(buf) {
    const rem = buf.length % 4;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}
function oscString(s) {
    return pad4(Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])]));
}
function oscInt(n) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n | 0, 0);
    return b;
}
function oscFloat(n) {
    const b = Buffer.alloc(4);
    b.writeFloatBE(n, 0);
    return b;
}
/** args は数値の配列（int扱い）。typetag は ",iii" のように組む */
function oscMessage(address, args) {
    const addr = oscString(address);
    let tags = ',';
    const argBufs = [];
    for (const a of args) {
        tags += 'i';
        argBufs.push(oscInt(a));
    }
    return Buffer.concat([addr, oscString(tags), ...argBufs]);
}

const sock = dgram.createSocket('udp4');

function send(address, args) {
    return new Promise((resolve) => {
        const msg = oscMessage(address, args);
        sock.send(msg, 0, msg.length, PORT, HOST, (err) => {
            if (err) console.error('send error', address, err);
            else console.log('sent', address, JSON.stringify(args));
            resolve();
        });
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    // 1) scene09 へ切り替え（kitNo=22）
    await send('/kit', [22]);
    await sleep(1500);

    // 2) track1: 赤い菱形マーカーを連発（クラスタリングで近接して出る）
    console.log('--- track1: red diamond markers ---');
    for (let i = 0; i < 12; i++) {
        // [noteNumber, velocity, durationMs]
        await send('/track/1', [40 + (i % 12), 100, 200]);
        await sleep(180);
    }
    await sleep(800);

    // 3) track5: コールアウトを数発
    console.log('--- track5: callouts ---');
    for (let i = 0; i < 6; i++) {
        await send('/track/5', [50 + i * 3, 110, 4000]);
        await sleep(500);
    }
    await sleep(800);

    // 4) track6: expand（立方体に勢い）
    console.log('--- track6: expand ---');
    for (let i = 0; i < 4; i++) {
        await send('/track/6', [60, 120, 0]);
        await sleep(400);
    }

    await sleep(500);
    console.log('done.');
    sock.close();
}

main();
