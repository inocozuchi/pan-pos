/*
 * カメラで自動入力：文字を読む前の下ごしらえ（vendor/scan.js・vendor/scan-worker.js で使う）
 * 明るい所の中の細い暗い線（文字）だけを黒く、ほかを白にする（ブラックハット変換）。
 * ラベルのふち・影・背景の模様が文字と取り違えられないようにする。
 */
(function (root) {
    'use strict';
    // 1次元の最大・最小（van Herk / Gil-Werman。窓の大きさによらず速い）
    function runFilter(src, dst, n, stride, off, k, isMax, g, h) {
        var r = k >> 1, i, b, e, v, q;
        for (b = 0; b < n; b += k) {
            e = Math.min(n, b + k);
            v = src[off + b * stride]; g[b] = v;
            for (i = b + 1; i < e; i++) { q = src[off + i * stride]; v = isMax ? (q > v ? q : v) : (q < v ? q : v); g[i] = v; }
            v = src[off + (e - 1) * stride]; h[e - 1] = v;
            for (i = e - 2; i >= b; i--) { q = src[off + i * stride]; v = isMax ? (q > v ? q : v) : (q < v ? q : v); h[i] = v; }
        }
        for (i = 0; i < n; i++) {
            var lo = i - r < 0 ? 0 : i - r, hi = i + r >= n ? n - 1 : i + r;
            var a = h[lo], c = g[hi];
            dst[off + i * stride] = isMax ? (a > c ? a : c) : (a < c ? a : c);
        }
    }
    function filter2d(src, W, H, k, isMax) {
        var tmp = new Uint8ClampedArray(W * H), out = new Uint8ClampedArray(W * H);
        var g = new Uint8ClampedArray(Math.max(W, H)), h = new Uint8ClampedArray(Math.max(W, H));
        for (var y = 0; y < H; y++) runFilter(src, tmp, W, 1, y * W, k, isMax, g, h);
        for (var x = 0; x < W; x++) runFilter(tmp, out, H, W, x, k, isMax, g, h);
        return out;
    }
    // data … RGBA の並び（そのまま書きかえる）。kk … 窓の大きさ（省くと画面の幅から決める。ラベルを拡大して並べた画像は、文字が太いので大きめ）
    function prep(data, W, H, kk) {
        var n = W * H, i;
        var gray = new Uint8ClampedArray(n);
        for (i = 0; i < n; i++) gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
        var k = (kk > 0 ? kk : Math.max(9, Math.round(W / 56))) | 1;   // 文字の線の太さより十分大きい窓
        var clo = filter2d(filter2d(gray, W, H, k, true), W, H, k, false);
        for (i = 0; i < n; i++) { var v = clo[i] - gray[i] > 38 ? 0 : 255; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
        return data;
    }
    root.SCAN_PREP = { prep: prep };
})(typeof self !== 'undefined' ? self : this);
