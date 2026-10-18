/*
 * カメラで自動入力：裏の作業場（Web Worker）。重い処理（バーコードの読み取り・文字の下ごしらえ）をここでして、
 * レジの画面の動き（商品を押す・お会計）を止めないようにする。vendor/scan.js から使う。
 *   { id, type: 'bc',   w, h, buf } → { id, list: [{ raw, box, fmt }] }（枠は画面の割合 0〜1。fmt は 'qr'＝QRコード／'1d'＝バーコード）
 *   { id, type: 'prep', w, h, buf, k } → { id, buf }（下ごしらえした画像。k は窓の大きさ・省くと自動）
 */
/* global ZXingWASM, SCAN_PREP */
importScripts('scan-prep.js');
var zxReady = null;
function zx() {
    if (!zxReady) {
        zxReady = new Promise(function (res, rej) {
            try {
                importScripts('zxing/zxing-reader.js');
                ZXingWASM.prepareZXingModule({ overrides: { locateFile: function (p, prefix) { return /\.wasm$/.test(p) ? new URL('zxing/' + p, self.location.href).href : prefix + p; } } });
                res(ZXingWASM);
            } catch (e) { rej(e); }
        });
    }
    return zxReady;
}
function boxOf(pos, W, H) {
    if (!pos) return null;
    var xs = [pos.topLeft.x, pos.topRight.x, pos.bottomLeft.x, pos.bottomRight.x];
    var ys = [pos.topLeft.y, pos.topRight.y, pos.bottomLeft.y, pos.bottomRight.y];
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
    return { x: x0 / W, y: y0 / H, w: (Math.max.apply(null, xs) - x0) / W, h: (Math.max.apply(null, ys) - y0) / H };
}
self.onmessage = function (e) {
    var d = e.data;
    if (d.type === 'prep') {
        var px = new Uint8ClampedArray(d.buf);
        SCAN_PREP.prep(px, d.w, d.h, d.k || 0);
        self.postMessage({ id: d.id, buf: px.buffer }, [px.buffer]);
        return;
    }
    if (d.type === 'bc') {
        zx().then(function (z) {
            return z.readBarcodes(new ImageData(new Uint8ClampedArray(d.buf), d.w, d.h), { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'QRCode'], maxNumberOfSymbols: 16, tryHarder: true });
        }).then(function (r) {
            self.postMessage({ id: d.id, list: r.filter(function (x) { return x.isValid && x.text; }).map(function (x) { return { raw: String(x.text), box: boxOf(x.position, d.w, d.h), fmt: /qr/i.test(String(x.format || '')) ? 'qr' : '1d' }; }) });
        }).catch(function (err) { self.postMessage({ id: d.id, error: String(err && err.message || err) }); });
    }
};
