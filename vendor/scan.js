/*
 * カメラで商品を読む（バーコード・QRコード・文字）— 泰山木POS の「カメラで自動入力」で使う部品
 * --------------------------------------------------
 * カメラを裏で動かし（映像は画面に出さない）、写っている物を一定の間をおいて読み続ける。
 *   バーコード … 端末に読み取りの機能（BarcodeDetector）があればそれを使い、無ければ zxing-wasm（vendor/zxing）で読む。
 *                ラベルの QRコード（中身は商品のコード）も読む。1枚の画面に写った全部を、まとめて返す。
 *                小さく写ったバーコードも読めるよう、画面全体のほかに、画面を4つに分けて細かく（元の解像度で）読む。
 *   文字       … Tesseract.js（vendor/tesseract・日本語）で読む。読む前に「細い線（文字）だけを取り出す」下ごしらえをして、
 *                ラベルのふち・影・背景の模様を消してから読む（ブラックハット変換）。
 * 【電池のため】画面が動いていない間は読み直さず、前に読んだ結果をもう一度伝える（ときどきだけ読み直す）。
 *   画面が変わったら、すぐに続けて何回か読む。省エネ（eco）の時は、解像度・回数をさらに控えめにする。
 * 読んだ結果を、どの商品か決めるのはレジの側（index.html の「カメラで自動入力」）。ここは読むことだけをする。
 *
 * 使い方：POS_SCAN.start({ video, barcode: true, text: true, facing: 'environment', whitelist: '…', eco: false,
 *                          onCodes(list), onText(lines, info), onState(state, info) })
 *   onCodes … [{ raw: '2000000000015', box: {x,y,w,h} }]（同じ商品が2つ写っていれば2つ。枠は画面の割合 0〜1）
 *   onText  … [{ text: 'あんぱん', conf: 90, x0, y0, x1, y1 }]（行ごと。枠は画面の割合 0〜1）、info.same … 読み直さずに前の結果を伝えた時 true
 *             info.sv … 読んだ時の画面の印（scene() と同じ数。読んでいる間に画面が変わったかを、レジの側で見分ける）。onCodes も同じ
 *   onState … 'starting' | 'on' | 'denied' | 'nocam' | 'error' | 'off'、文字の読み取りは 'text-loading' | 'text-ready' | 'text-error'
 * 重い処理（zxing の読み取り・文字の下ごしらえ）は、裏の作業場（vendor/scan-worker.js）でする（レジの画面を止めない）。
 * 部品の許諾：zxing-wasm（MIT）・zxing-cpp（Apache-2.0）・Tesseract.js / tesseract.js-core（Apache-2.0）・日本語の学習データ（Apache-2.0）
 */
(function () {
    'use strict';
    var BASE = (function () {
        try { if (document.currentScript && document.currentScript.src) return new URL('.', document.currentScript.src).href; } catch (e) {}
        return new URL('vendor/', location.href).href;
    })();
    // 読む間かく（ミリ秒）。省エネの時は eco の方
    var T = {
        normal: { bc: 300, bcStill: 450, bcRefresh: 3000, tx: 600, txStill: 700, txRefresh: 8000, txW: 1400, camW: 1920, camH: 1080, fps: 15 },
        eco:    { bc: 600, bcStill: 900, bcRefresh: 6000, tx: 1200, txStill: 1200, txRefresh: 15000, txW: 1100, camW: 1280, camH: 720, fps: 10 }
    };
    var MOVE = 10;               // 画面が変わったとみなす明るさの差（小さく縮めた画面の、区画ごとの平均の差）
    var o = null;                // いまの設定
    var stream = null, video = null, alive = false;
    var bcTimer = null, txTimer = null;
    var cv = document.createElement('canvas');
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var midCv = document.createElement('canvas');
    midCv.width = 256; midCv.height = 144;
    var midCx = midCv.getContext('2d');
    var thumbCv = document.createElement('canvas');
    thumbCv.width = 64; thumbCv.height = 36;
    var thumbCx = thumbCv.getContext('2d', { willReadFrequently: true });

    function t() { return T[o && o.eco ? 'eco' : 'normal']; }
    function state(s, info) { try { if (o && o.onState) o.onState(s, info || ''); } catch (e) {} }
    function loadScript(src) {
        return new Promise(function (res, rej) {
            var s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = function () { res(); };
            s.onerror = function () { rej(new Error('読み込めませんでした: ' + src)); };
            document.head.appendChild(s);
        });
    }
    // 今の画面（または、その一部）を、決めた幅まで縮めて描く
    // r … 元の画面の中の場所（割合 0〜1）。省くと全体
    function grab(maxW, r) {
        if (!video || !video.videoWidth) return null;
        var vw = video.videoWidth, vh = video.videoHeight;
        var sx = 0, sy = 0, sw = vw, sh = vh;
        if (r) { sx = Math.round(r.x * vw); sy = Math.round(r.y * vh); sw = Math.round(r.w * vw); sh = Math.round(r.h * vh); }
        var k = Math.min(1, maxW / sw);
        var w = Math.round(sw * k), h = Math.round(sh * k);
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        cx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
        return cx.getImageData(0, 0, w, h);
    }

    // ---- 画面が動いたか ----
    // 小さく縮めた画面（64×36）を 8×6 の区画に分け、どこか1つの区画でも明るさがはっきり変わったら「動いた」とする。
    // 全体の平均で比べると、小さなラベルを1つ置いただけの時に気づけないため。縮める時は2回に分けて、細かい模様のちらつきを抑える
    function thumbNow() {
        if (!video || !video.videoWidth) return null;
        midCx.drawImage(video, 0, 0, 256, 144);
        thumbCx.drawImage(midCv, 0, 0, 64, 36);
        return new Uint8ClampedArray(thumbCx.getImageData(0, 0, 64, 36).data);
    }
    function diff(a, b) {
        if (!a || !b) return 999;
        var best = 0;
        for (var by = 0; by < 6; by++) {
            for (var bx = 0; bx < 8; bx++) {
                var s = 0;
                for (var y = by * 6; y < by * 6 + 6; y++) {
                    for (var x = bx * 8; x < bx * 8 + 8; x++) {
                        var i = (y * 64 + x) * 4;
                        s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]);
                    }
                }
                s /= 96;
                if (s > best) best = s;
            }
        }
        return best;
    }
    // 画面の動き：はっきり変わった時だけ数を増やす
    // （レジの側で「写らなくなった物は外に出した」と決める時に、画面が動いていなければ、まだ置いてあるとみなすため）
    var sceneVer = 0, sceneRef = null;
    function sceneTick() {
        var th = thumbNow();
        if (!th) return null;
        if (!sceneRef) { sceneRef = th; return th; }
        if (diff(th, sceneRef) > MOVE) { sceneVer++; sceneRef = th; }
        return th;
    }

    // ---- ラベル（白っぽい四角）を探して、1枚ずつ切り出す ----
    // 小さく縮めた画面で、明るく色の薄い所のかたまりを探す。かたまりの重心・傾き・大きさ（2次のモーメント）から、
    // ラベルの場所と向きを出す。切り出す時は、まっすぐに直して拡大する（小さく写ったバーコード・文字も読めるように）
    var LW = 480;
    var smallCv = document.createElement('canvas'); smallCv.width = LW; smallCv.height = 270;
    var smallCx = smallCv.getContext('2d', { willReadFrequently: true });
    var regions = [];   // [{ cx, cy, a, b, th }]：中心（画面の割合）・長い辺と短い辺（画面の横の長さに対する割合）・傾き（ラジアン）
    function findLabels() {
        if (!video || !video.videoWidth) return [];
        var vw = video.videoWidth, vh = video.videoHeight, H = Math.max(1, Math.round(LW * vh / vw));
        if (smallCv.height !== H) smallCv.height = H;
        smallCx.drawImage(video, 0, 0, LW, H);
        var d = smallCx.getImageData(0, 0, LW, H).data, n = LW * H, g = new Uint8Array(n), hist = new Uint32Array(256), i;
        for (i = 0; i < n; i++) {
            var r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
            var v = (r * 77 + gg * 150 + b * 29) >> 8;
            if (Math.max(r, gg, b) - Math.min(r, gg, b) > 60) v >>= 1;   // 色の濃い所（パン・袋の柄など）は、ラベルではない
            g[i] = v; hist[v]++;
        }
        // 明るい所と暗い所の境目（大津の方法）
        var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
        var sB = 0, wB = 0, best = 0, thr = 128;
        for (i = 0; i < 256; i++) {
            wB += hist[i]; if (!wB) continue;
            var wF = n - wB; if (!wF) break;
            sB += i * hist[i];
            var mB = sB / wB, mF = (sum - sB) / wF, bt = wB * wF * (mB - mF) * (mB - mF);
            if (bt > best) { best = bt; thr = i; }
        }
        thr = Math.max(thr, 70);
        var lab = new Uint8Array(n), stack = new Int32Array(n), out = [];
        for (var p0 = 0; p0 < n; p0++) {
            if (lab[p0] || g[p0] <= thr) continue;
            var sp = 0; stack[sp++] = p0; lab[p0] = 1;
            var cnt = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = LW, x1 = 0, y0 = H, y1 = 0;
            // 4つの角（左上＝x+y が最小、右下＝最大、右上＝x−y が最大、左下＝最小）
            var tl = [0, 0, 1e9], br = [0, 0, -1e9], trc = [0, 0, -1e9], blc = [0, 0, 1e9];
            while (sp) {
                var q = stack[--sp], x = q % LW, y = (q / LW) | 0;
                cnt++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
                if (x + y < tl[2]) tl = [x, y, x + y]; if (x + y > br[2]) br = [x, y, x + y];
                if (x - y > trc[2]) trc = [x, y, x - y]; if (x - y < blc[2]) blc = [x, y, x - y];
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                if (x > 0 && !lab[q - 1] && g[q - 1] > thr) { lab[q - 1] = 1; stack[sp++] = q - 1; }
                if (x < LW - 1 && !lab[q + 1] && g[q + 1] > thr) { lab[q + 1] = 1; stack[sp++] = q + 1; }
                if (y > 0 && !lab[q - LW] && g[q - LW] > thr) { lab[q - LW] = 1; stack[sp++] = q - LW; }
                if (y < H - 1 && !lab[q + LW] && g[q + LW] > thr) { lab[q + LW] = 1; stack[sp++] = q + LW; }
            }
            var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            if (cnt < n * 0.0012 || cnt > n * 0.3 || bw < 10 || bh < 6 || cnt / (bw * bh) < 0.3) continue;
            var mx = sx / cnt, my = sy / cnt, cxx = sxx / cnt - mx * mx, cyy = syy / cnt - my * my, cxy = sxy / cnt - mx * my;
            var tr = (cxx + cyy) / 2, dt = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) / 4 + cxy * cxy));
            var A = Math.sqrt(12 * (tr + dt)), B = Math.sqrt(12 * Math.max(0, tr - dt));
            if (A < 10 || B < 6 || A / B > 5) continue;
            var reg = { cx: mx / LW, cy: my / H, a: A / LW, b: B / LW, th: 0.5 * Math.atan2(2 * cxy, cxx - cyy), n: cnt };
            // 角が平行四辺形にそろっている時（斜めから写してゆがんだラベル）は、角を使ってゆがみごと直して切り出す
            var ex = (tl[0] + br[0]) - (trc[0] + blc[0]), ey = (tl[1] + br[1]) - (trc[1] + blc[1]);
            var wv = Math.hypot(trc[0] - tl[0], trc[1] - tl[1]), hv = Math.hypot(blc[0] - tl[0], blc[1] - tl[1]);
            if (wv > 8 && hv > 5 && Math.hypot(ex, ey) < 0.18 * (wv + hv) && wv >= hv * 0.8)
                reg.q = [[(tl[0] + 0.5) / LW, (tl[1] + 0.5) / H], [(trc[0] + 0.5) / LW, (trc[1] + 0.5) / H], [(blc[0] + 0.5) / LW, (blc[1] + 0.5) / H], [(br[0] + 0.5) / LW, (br[1] + 0.5) / H]];
            out.push(reg);
        }
        out.sort(function (p, q2) { return q2.n - p.n; });
        return out.slice(0, 8);
    }
    var regionsAt = 0;
    function refreshRegions() { regions = findLabels(); regionsAt = Date.now(); }
    // ラベルの場所（画面の割合の、傾いていない四角）
    function boxOfRegion(r) {
        var vw = video.videoWidth || 16, vh = video.videoHeight || 9, c = Math.abs(Math.cos(r.th)), sn = Math.abs(Math.sin(r.th));
        var w = r.a * c + r.b * sn, h = (r.a * sn + r.b * c) * vw / vh;
        return { x: r.cx - w / 2, y: r.cy - h / 2, w: w, h: h };
    }
    var cropCv = document.createElement('canvas');
    var cropCx = cropCv.getContext('2d', { willReadFrequently: true });
    var cropMap = null;   // 最後に切り出した画像の点（px）→ 元の画面の点（px）
    // 切り出した画像の中の枠（割合）を、元の画面の枠（割合）にする
    function mapBox(b, map, W, H) {
        if (!b || !map) return null;
        var vw = video.videoWidth || 1, vh = video.videoHeight || 1;
        var pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(function (p) { return map(p[0] * W, p[1] * H); });
        var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
        var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
        return { x: x0 / vw, y: y0 / vh, w: (Math.max.apply(null, xs) - x0) / vw, h: (Math.max.apply(null, ys) - y0) / vh };
    }
    // ラベルを、まっすぐに直して、横 outW の大きさで切り出す（pad … まわりに足す余白の割合）
    function cropOf(r, outW, pad) {
        var vw = video.videoWidth, vh = video.videoHeight;
        if (r.q) return cropQuad(r, outW, pad, vw, vh);
        var a = r.a * vw * pad, b = r.b * vw * pad, k = outW / a;
        var outH = Math.max(16, Math.round(b * k));
        var cs0 = Math.cos(r.th), sn0 = Math.sin(r.th), ccx = r.cx * vw, ccy = r.cy * vh;
        cropMap = function (u, v) { var x = (u - outW / 2) / k, y = (v - outH / 2) / k; return [ccx + x * cs0 - y * sn0, ccy + x * sn0 + y * cs0]; };
        if (cropCv.width !== outW) cropCv.width = outW;
        if (cropCv.height !== outH) cropCv.height = outH;
        cropCx.setTransform(1, 0, 0, 1, 0, 0);
        cropCx.fillStyle = '#fff'; cropCx.fillRect(0, 0, outW, outH);
        cropCx.imageSmoothingEnabled = true;
        try { cropCx.imageSmoothingQuality = 'high'; } catch (e) {}
        cropCx.setTransform(1, 0, 0, 1, outW / 2, outH / 2);
        cropCx.scale(k, k); cropCx.rotate(-r.th); cropCx.translate(-r.cx * vw, -r.cy * vh);
        cropCx.drawImage(video, 0, 0);
        cropCx.setTransform(1, 0, 0, 1, 0, 0);
        return cropCx.getImageData(0, 0, outW, outH);
    }

    // 角から切り出す：左上・右上・左下の3つの角を、まっすぐな四角の角へ移す（右下は、ずれを平均して使う）
    function cropQuad(r, outW, pad, vw, vh) {
        var P = r.q.map(function (p) { return [p[0] * vw, p[1] * vh]; });
        // 平行四辺形にそろえる（右下の角のずれを、ほかの3つに半分ずつ分ける）
        var dx = (P[0][0] + P[3][0] - P[1][0] - P[2][0]) / 4, dy = (P[0][1] + P[3][1] - P[1][1] - P[2][1]) / 4;
        var TL = [P[0][0] - dx, P[0][1] - dy], TR = [P[1][0] + dx, P[1][1] + dy], BL = [P[2][0] + dx, P[2][1] + dy];
        var ux = TR[0] - TL[0], uy = TR[1] - TL[1], vx = BL[0] - TL[0], vy = BL[1] - TL[1];
        // まわりに余白を足す（中心から広げる）
        var cx0 = TL[0] + (ux + vx) / 2, cy0 = TL[1] + (uy + vy) / 2;
        ux *= pad; uy *= pad; vx *= pad; vy *= pad;
        var ox = cx0 - (ux + vx) / 2, oy = cy0 - (uy + vy) / 2;
        var outH = Math.max(16, Math.round(outW * Math.hypot(vx, vy) / Math.max(1, Math.hypot(ux, uy))));
        cropMap = function (u, v) { return [ox + u / outW * ux + v / outH * vx, oy + u / outW * uy + v / outH * vy]; };
        if (cropCv.width !== outW) cropCv.width = outW;
        if (cropCv.height !== outH) cropCv.height = outH;
        cropCx.setTransform(1, 0, 0, 1, 0, 0);
        cropCx.fillStyle = '#fff'; cropCx.fillRect(0, 0, outW, outH);
        cropCx.imageSmoothingEnabled = true;
        try { cropCx.imageSmoothingQuality = 'high'; } catch (e) {}
        // 出す側の点 (u, v) → 元の画面の点 = o + u/outW・U + v/outH・V。その逆を、描く時の変換にする
        var a = ux / outW, b = uy / outW, c = vx / outH, d = vy / outH, det = a * d - b * c;
        if (Math.abs(det) < 1e-9) { cropCx.setTransform(1, 0, 0, 1, 0, 0); return cropCx.getImageData(0, 0, outW, outH); }
        var ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
        cropCx.setTransform(ia, ib, ic, id, -(ia * ox + ic * oy), -(ib * ox + id * oy));
        cropCx.drawImage(video, 0, 0);
        cropCx.setTransform(1, 0, 0, 1, 0, 0);
        return cropCx.getImageData(0, 0, outW, outH);
    }

    // ---- バーコード・QRコード ----
    var native = null, nativeChecked = false, zx = null, zxLoading = null, bcBusy = false, usedWorker = false, zxHere = false;
    var FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'QRCode'];
    function nativeDetector() {
        if (nativeChecked) return Promise.resolve(native);
        nativeChecked = true;
        if (!('BarcodeDetector' in window)) return Promise.resolve(null);
        return window.BarcodeDetector.getSupportedFormats().then(function (f) {
            var want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'].filter(function (x) { return f.indexOf(x) >= 0; });
            if (want.indexOf('ean_13') < 0) return null;
            native = new window.BarcodeDetector({ formats: want });
            return native;
        }).catch(function () { return null; });
    }
    function zxing() {
        if (zx) return Promise.resolve(zx);
        if (!zxLoading) {
            zxLoading = loadScript(BASE + 'zxing/zxing-reader.js').then(function () {
                window.ZXingWASM.prepareZXingModule({
                    overrides: { locateFile: function (p, prefix) { return /\.wasm$/.test(p) ? BASE + 'zxing/' + p : prefix + p; } }
                });
                zx = window.ZXingWASM;
                return zx;
            });
            zxLoading.catch(function () { zxLoading = null; });
        }
        return zxLoading;
    }
    // 枠は画面の割合（0〜1）で返す
    function boxOf(pos, W, H) {
        if (!pos) return null;
        var xs = [pos.topLeft.x, pos.topRight.x, pos.bottomLeft.x, pos.bottomRight.x];
        var ys = [pos.topLeft.y, pos.topRight.y, pos.bottomLeft.y, pos.bottomRight.y];
        var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
        return { x: x0 / W, y: y0 / H, w: (Math.max.apply(null, xs) - x0) / W, h: (Math.max.apply(null, ys) - y0) / H };
    }
    // 読む場所の順番：ラベルが見つかっている時は「ラベルを1枚ずつ拡大」を1回おきに入れ、
    // 残りで 全体 → 4つに分けた1つ → 全体 → 次の1つ …（全体は縮めて、分けた所は元の解像度で読む）。
    // 画面が小さい（横1600未満）時は、分けても細かくならないので全体だけ
    var TILES = [{ x: 0, y: 0, w: 0.55, h: 0.55 }, { x: 0.45, y: 0, w: 0.55, h: 0.55 }, { x: 0, y: 0.45, w: 0.55, h: 0.55 }, { x: 0.45, y: 0.45, w: 0.55, h: 0.55 }];
    var CROPS = { crops: true };
    var passAt = 0, gridAt = 0;
    function nextPass() {
        var i = passAt++;
        if (regions.length && i % 2 === 0) return CROPS;
        if (!video || video.videoWidth < 1600) return null;
        var j = gridAt++ % (TILES.length * 2);
        return j % 2 === 0 ? null : TILES[(j - 1) / 2];
    }
    // 読めた物を、読んだ場所ごとに覚えておく。伝える時の数え方：
    //   1) 読んだ場所が違っても（全体・4つに分けた所・ラベルの拡大）、同じ所にある同じ種類の同じコードは1つ
    //   2) 商品ごとに「QRコードの数」と「バーコードの数」を別々に数え、多い方をその商品の数にする。
    //      ラベル1枚に QRコードとバーコードが1つずつあるので、足すと2倍に数えてしまう。多い方なら、
    //      ラベルが何枚くっついて写っていても、片方が読めなくても、数えすぎない（お客様に多く払わせない）
    var bcSeen = [], bcRef = null, bcAt = 0, bcFresh = 0, bcSv = 0;
    function mergeSeen(list, tile) {
        var key = tile === CROPS ? 99 : (tile ? TILES.indexOf(tile) : -1);
        bcSeen = bcSeen.filter(function (s) { return s.pass !== key; });
        list.forEach(function (x) {
            var b = x.box;
            if (b && tile && tile !== CROPS) b = { x: tile.x + b.x * tile.w, y: tile.y + b.y * tile.h, w: b.w * tile.w, h: b.h * tile.h };
            bcSeen.push({ raw: x.raw, box: b, fmt: x.fmt === 'qr' ? 'qr' : '1d', pass: key });
        });
    }
    function seenList() {
        var vw = video && video.videoWidth || 16, vh = video && video.videoHeight || 9;
        var uniq = [];
        bcSeen.forEach(function (s) {
            var b = s.box, c = b ? [(b.x + b.w / 2) * vw, (b.y + b.h / 2) * vh] : null, size = b ? Math.max(b.w * vw, b.h * vh) : 0;
            var dup = uniq.some(function (u) {
                if (u.raw !== s.raw || u.fmt !== s.fmt) return false;
                if (!c || !u.c) return true;   // 場所が分からない物は、同じ物とみなす（数えすぎないように）
                return Math.hypot(u.c[0] - c[0], u.c[1] - c[1]) < 0.6 * Math.max(u.size, size);
            });
            if (!dup) uniq.push({ raw: s.raw, fmt: s.fmt, box: b, c: c, size: size });
        });
        var by = {}, out = [];
        uniq.forEach(function (u) { var g = by[u.raw] || (by[u.raw] = { qr: [], '1d': [] }); g[u.fmt].push(u); });
        Object.keys(by).forEach(function (raw) {
            var g = by[raw], pick = g.qr.length >= g['1d'].length ? g.qr : g['1d'];
            pick.forEach(function (u) { out.push({ raw: raw, box: u.box }); });
        });
        return out;
    }
    // ラベルを1枚ずつ拡大して読む（1枚の中の同じコードは1つ。場所はラベルの場所）
    function decodeCrops() {
        var regs = regions.slice(), out = [], i = 0;
        var one = function () {
            if (i >= regs.length || !alive) return Promise.resolve(out);
            var r = regs[i++], img = cropOf(r, 720, 1.25), map = cropMap, W = img.width, H = img.height, rb = boxOfRegion(r);
            return decodeImage(img).then(function (list) {
                list.forEach(function (x) { out.push({ raw: x.raw, fmt: x.fmt, box: mapBox(x.box, map, W, H) || rb }); });
                return one();
            });
        };
        return one();
    }
    // 切り出した画像を読む（端末の読み取り機能 → 裏の作業場の zxing → この画面の zxing の順）
    function decodeImage(img) {
        return nativeDetector().then(function (det) {
            if (det) return det.detect(img).then(function (r) { return r.map(function (x) { var b = x.boundingBox; return { raw: String(x.rawValue || ''), fmt: /qr/.test(String(x.format || '')) ? 'qr' : '1d', box: b ? { x: b.x / img.width, y: b.y / img.height, w: b.width / img.width, h: b.height / img.height } : null }; }); });
            var keep = wk === false ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
            return call('bc', img).then(function (r) {
                if (r && !r.error) { usedWorker = true; return r.list || []; }
                return zxing().then(function (z) {
                    return z.readBarcodes(keep, { formats: FORMATS, maxNumberOfSymbols: 4, tryHarder: true }).then(function (r2) {
                        zxHere = true;
                        return r2.filter(function (x) { return x.isValid && x.text; }).map(function (x) { return { raw: String(x.text), fmt: /qr/i.test(String(x.format || '')) ? 'qr' : '1d', box: boxOf(x.position, keep.width, keep.height) }; });
                    });
                });
            });
        });
    }
    function decode(tile) {
        if (tile === CROPS) return decodeCrops();
        return nativeDetector().then(function (det) {
            if (det) {
                // 端末の読み取り機能：全体はそのまま、分けた所は切り出して読む
                var src = video, W = video.videoWidth || 1, H = video.videoHeight || 1;
                if (tile) { var im = grab(4000, tile); if (!im) return []; src = im; W = im.width; H = im.height; }
                return det.detect(src).then(function (r) {
                    return r.map(function (x) { var b = x.boundingBox; return { raw: String(x.rawValue || ''), fmt: /qr/.test(String(x.format || '')) ? 'qr' : '1d', box: b ? { x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H } : null }; });
                });
            }
            var img = grab(tile ? 4000 : 1280, tile);
            if (!img) return [];
            var keep = wk === false ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
            return call('bc', img).then(function (r) {
                if (r && !r.error) { usedWorker = true; return r.list || []; }
                // 作業場が使えない時は、この画面で読む
                return zxing().then(function (z) {
                    return z.readBarcodes(keep, { formats: FORMATS, maxNumberOfSymbols: 16, tryHarder: true }).then(function (r2) {
                        zxHere = true;
                        return r2.filter(function (x) { return x.isValid && x.text; }).map(function (x) { return { raw: String(x.text), fmt: /qr/i.test(String(x.format || '')) ? 'qr' : '1d', box: boxOf(x.position, keep.width, keep.height) }; });
                    });
                });
            });
        });
    }
    function bcTick() {
        bcTimer = null;
        if (!alive || !o.barcode) return;
        var T0 = t();
        var next = function (ms) { if (alive && o.barcode && !bcTimer) bcTimer = setTimeout(bcTick, ms); };
        if (document.hidden || bcBusy || (o.busy && o.busy())) { next(T0.bc); return; }
        var th = sceneTick();
        var moved = diff(th, bcRef) > MOVE;
        if (moved) { bcSeen = []; bcFresh = TILES.length * 2 + 1; passAt = 0; gridAt = 0; bcRef = th; }
        if (moved || bcFresh || Date.now() - bcAt >= T0.bcRefresh) refreshRegions();
        // 画面が動いていない間は読み直さず、前に読んだ物をもう一度伝える（ときどきだけ読み直す）
        if (!bcFresh && Date.now() - bcAt < T0.bcRefresh) {
            try { if (o.onCodes) o.onCodes(seenList(), { same: true, sv: bcSv }); } catch (e) {}
            next(T0.bcStill);
            return;
        }
        bcBusy = true;
        var tile = nextPass(), svCap = sceneVer;
        decode(tile).then(function (list) {
            bcBusy = false;
            if (!alive) return;
            if (bcFresh) bcFresh--;
            bcAt = Date.now(); bcSv = svCap;
            mergeSeen(list, tile);
            try { if (o.onCodes) o.onCodes(seenList(), { same: false, sv: svCap }); } catch (e) { console.warn(e); }
            next(T0.bc);
        }).catch(function (e) {
            bcBusy = false;
            console.warn('バーコードを読めませんでした', e);
            state('bc-error', String(e && e.message || e));
            next(2000);
        });
    }

    // ---- 文字 ----
    var tw = null, twLoading = null, txBusy = false, txRef = null, lastLines = null, lastTextAt = 0, lastSv = 0, txFresh = 0, txPass = 0;
    // 傾いて貼られたラベルも読めるよう、読むたびに少しずつ回して読む（まっすぐを多めに）
    var ANGLES = [0, 12, 0, -12], angleAt = 0;
    function simdOk() {
        try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; }
    }
    function textWorker() {
        if (tw) return Promise.resolve(tw);
        if (!twLoading) {
            state('text-loading');
            twLoading = loadScript(BASE + 'tesseract/tesseract.min.js').then(function () {
                return window.Tesseract.createWorker('jpn', 1, {
                    workerPath: BASE + 'tesseract/worker.min.js',
                    corePath: BASE + 'tesseract/' + (simdOk() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js'),
                    langPath: BASE + 'tesseract/lang',
                    workerBlobURL: false,
                    gzip: true
                });
            }).then(function (w) {
                return w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', tessedit_char_whitelist: (o && o.whitelist) || '' }).then(function () { tw = w; state('text-ready'); return w; });
            });
            twLoading.catch(function (e) { twLoading = null; state('text-error', String(e && e.message || e)); });
        }
        return twLoading;
    }
    // ---- 裏の作業場（Web Worker）：重い処理を、レジの画面の動きと分ける ----
    var wk = null, wkSeq = 0, wkWait = {};
    function worker() {
        if (wk !== null) return wk;
        try {
            wk = new Worker(BASE + 'scan-worker.js');
            wk.onmessage = function (e) { var cb = wkWait[e.data.id]; delete wkWait[e.data.id]; if (cb) cb(e.data); };
            wk.onerror = function () { wk = false; var w = wkWait; wkWait = {}; Object.keys(w).forEach(function (k) { w[k]({ error: 'worker' }); }); };
        } catch (e) { wk = false; }
        return wk;
    }
    function call(type, img, k) {
        var w = worker();
        if (!w) return Promise.resolve({ error: 'worker' });
        return new Promise(function (res) {
            var id = ++wkSeq;
            wkWait[id] = res;
            w.postMessage({ id: id, type: type, w: img.width, h: img.height, buf: img.data.buffer, k: k || 0 }, [img.data.buffer]);
        });
    }
    // 下ごしらえ：作業場が使えない時は、この画面で（vendor/scan-prep.js）
    var prepLib = null;
    function prepHere() {
        if (window.SCAN_PREP) return Promise.resolve(window.SCAN_PREP);
        if (!prepLib) prepLib = loadScript(BASE + 'scan-prep.js').then(function () { return window.SCAN_PREP; });
        return prepLib;
    }
    function prep(img, k) {
        var W = img.width, H = img.height, copy = new Uint8ClampedArray(img.data);
        return call('prep', img, k).then(function (r) {
            if (r && r.buf) return new ImageData(new Uint8ClampedArray(r.buf), W, H);
            return prepHere().then(function (P) { P.prep(copy, W, H, k || 0); return new ImageData(copy, W, H); });
        });
    }
    // 見つけたラベルを、まっすぐに直して拡大し、縦に並べた1枚の画像にする（小さく写った文字も、1回で読めるように）。
    // ラベルとラベルの間は大きくあけて、別のラベルの行を同じ名前の続きと取り違えないようにする
    var MOS_W = 560, MOS_GAP = 90, MOS_MAX = 6, mosAt = 0;
    var mosCv = document.createElement('canvas');
    var mosCx = mosCv.getContext('2d', { willReadFrequently: true });
    function buildMosaic() {
        var regs = regions.slice();
        if (regs.length > MOS_MAX) { var st = (mosAt++ * MOS_MAX) % regs.length; regs = regs.concat(regs).slice(st, st + MOS_MAX); }
        var pieces = [], y = MOS_GAP;
        regs.forEach(function (r) { var im = cropOf(r, MOS_W, 1.12); pieces.push({ im: im, y0: y, y1: y + im.height, r: r }); y += im.height + MOS_GAP; });
        mosCv.width = MOS_W; mosCv.height = y;
        mosCx.fillStyle = '#fff'; mosCx.fillRect(0, 0, MOS_W, y);
        pieces.forEach(function (pc) { mosCx.putImageData(pc.im, 0, pc.y0); pc.im = null; });
        return { img: mosCx.getImageData(0, 0, MOS_W, y), pieces: pieces };
    }
    function txTick() {
        txTimer = null;
        if (!alive || !o.text) return;
        var T0 = t();
        var next = function (ms) { if (alive && o.text && !txTimer) txTimer = setTimeout(txTick, ms); };
        if (document.hidden || txBusy || (o.busy && o.busy())) { next(500); return; }
        // 画面を控える（読んでいる途中で商品を外した時に、外した後の画面を「読んだ画面」と取り違えないように、読む前に控える）
        var shot = sceneTick();
        if (diff(shot, txRef) > MOVE) { txFresh = ANGLES.length; txRef = shot; }
        // 画面が動いていない間は、前に読んだ結果をもう一度伝える（まだ写っている、という知らせ。読み直さない）
        if (lastLines && !txFresh && Date.now() - lastTextAt < T0.txRefresh) {
            try { if (o.onText) o.onText(lastLines, { same: true, sv: lastSv }); } catch (e) {}
            next(T0.txStill);
            return;
        }
        txBusy = true;
        // 読む前の画面の印。読んでいる間に商品を外した時、読み終わった結果を「いまの画面にまだある」と取り違えないように
        var svCap = sceneVer;
        if (!regions.length || Date.now() - regionsAt > 1500) refreshRegions();
        // ラベルが見つかっている時は、ラベルを並べた画像を3回・画面全体を1回の割合で読む（白いラベルでない所の文字のため）
        var mos = regions.length && (txPass++ % 4 !== 3) ? buildMosaic() : null;
        var deg = mos ? 0 : ANGLES[angleAt++ % ANGLES.length], rad = deg * Math.PI / 180;
        textWorker().then(function (w) {
            var img = mos ? mos.img : grab(T0.txW);
            if (!img) return [];
            return prep(img, mos ? 15 : 0).then(function (pimg) { return [w, img, pimg]; });
        }).then(function (arr) {
            if (!arr.length) return [];
            var w = arr[0], img = arr[1], pimg = arr[2];
            if (mos) return w.recognize((function () { var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(pimg, 0, 0); return c; })(), {}, { text: true, blocks: true }).then(function (r) {
                var lines = [];
                ((r.data && r.data.blocks) || []).forEach(function (bl) {
                    (bl.paragraphs || []).forEach(function (pa) {
                        (pa.lines || []).forEach(function (l) {
                            var tx = String(l.text || '').replace(/\s+/g, '').trim();
                            if (!tx) return;
                            var cy = (l.bbox.y0 + l.bbox.y1) / 2, pc = null;
                            mos.pieces.forEach(function (q) { if (cy >= q.y0 && cy <= q.y1) pc = q; });
                            if (!pc) return;
                            var fb = boxOfRegion(pc.r);
                            // 場所は、そのラベルの場所。行どうしの上下（同じラベルの2行目か）は、並べた画像の中の位置（rx・ry）で比べる
                            lines.push({ text: tx, conf: Math.round(l.confidence || 0), x0: fb.x, y0: fb.y, x1: fb.x + fb.w, y1: fb.y + fb.h,
                                rx0: l.bbox.x0 / img.width, ry0: l.bbox.y0 / img.height, rx1: l.bbox.x1 / img.width, ry1: l.bbox.y1 / img.height, deg: 0, label: true });
                        });
                    });
                });
                return lines;
            });
            var c1 = document.createElement('canvas');
            c1.width = img.width; c1.height = img.height;
            c1.getContext('2d').putImageData(pimg, 0, 0);
            var c2 = c1;
            if (deg) {
                c2 = document.createElement('canvas');
                c2.width = img.width; c2.height = img.height;
                var g2 = c2.getContext('2d');
                g2.fillStyle = '#fff'; g2.fillRect(0, 0, c2.width, c2.height);
                g2.translate(c2.width / 2, c2.height / 2); g2.rotate(-rad); g2.drawImage(c1, -c1.width / 2, -c1.height / 2);
            }
            // 回して読んだ時は、枠を元の向きの場所へ戻す
            var back = function (x, y) {
                if (!deg) return [x, y];
                var dx = x - img.width / 2, dy = y - img.height / 2, cs = Math.cos(rad), sn = Math.sin(rad);
                return [dx * cs - dy * sn + img.width / 2, dx * sn + dy * cs + img.height / 2];
            };
            return w.recognize(c2, {}, { text: true, blocks: true }).then(function (r) {
                var lines = [];
                ((r.data && r.data.blocks) || []).forEach(function (bl) {
                    (bl.paragraphs || []).forEach(function (pa) {
                        (pa.lines || []).forEach(function (l) {
                            var tx = String(l.text || '').replace(/\s+/g, '').trim();
                            if (!tx) return;
                            var c = back((l.bbox.x0 + l.bbox.x1) / 2, (l.bbox.y0 + l.bbox.y1) / 2), hw = (l.bbox.x1 - l.bbox.x0) / 2, hh = (l.bbox.y1 - l.bbox.y0) / 2;
                            // 行どうしの位置（同じラベルの2行目か）を比べられるよう、回した向きのままの位置（rx・ry）も残す
                            lines.push({ text: tx, conf: Math.round(l.confidence || 0), x0: (c[0] - hw) / img.width, y0: (c[1] - hh) / img.height, x1: (c[0] + hw) / img.width, y1: (c[1] + hh) / img.height,
                                rx0: l.bbox.x0 / img.width, ry0: l.bbox.y0 / img.height, rx1: l.bbox.x1 / img.width, ry1: l.bbox.y1 / img.height, deg: deg });
                        });
                    });
                });
                return lines;
            });
        }).then(function (lines) {
            txBusy = false;
            if (!alive) return;
            if (txFresh) txFresh--;
            lastLines = lines; lastTextAt = Date.now(); lastSv = svCap;
            try { if (o.onText) o.onText(lines, { same: false, sv: svCap }); } catch (e) { console.warn(e); }
            next(T0.tx);
        }).catch(function (e) {
            txBusy = false;
            console.warn('文字を読めませんでした', e);
            next(4000);
        });
    }

    function camConstraints() {
        var T0 = t();
        return { audio: false, video: { facingMode: { ideal: o.facing === 'user' ? 'user' : 'environment' }, width: { ideal: T0.camW }, height: { ideal: T0.camH }, frameRate: { ideal: T0.fps, max: 30 } } };
    }
    // ピントを合わせ続ける（できる端末だけ。できない端末では何もしない）
    function keepFocus(s) {
        try {
            var tr = s.getVideoTracks()[0];
            var caps = tr && tr.getCapabilities ? tr.getCapabilities() : {};
            if (caps && caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
        } catch (e) {}
    }
    function start(opts) {
        stop(true);
        o = Object.assign({ barcode: true, text: true, facing: 'environment', eco: false }, opts || {});
        video = o.video;
        if (!video) return Promise.reject(new Error('video がありません'));
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { state('nocam'); return Promise.resolve(false); }
        alive = true;
        state('starting');
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.muted = true;
        return navigator.mediaDevices.getUserMedia(camConstraints())
            .then(function (s) {
                if (!alive) { s.getTracks().forEach(function (x) { x.stop(); }); return false; }
                stream = s;
                keepFocus(s);
                video.srcObject = s;
                return Promise.resolve(video.play()).catch(function () {}).then(function () {
                    state('on');
                    if (o.barcode) bcTick();
                    if (o.text) { textWorker().catch(function () {}); txTimer = setTimeout(txTick, 400); }
                    return true;
                });
            })
            .catch(function (e) {
                alive = false;
                var n = e && e.name;
                state(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError' ? 'nocam' : 'error'), String(e && e.message || e));
                return false;
            });
    }
    function stop(quiet) {
        alive = false;
        if (bcTimer) { clearTimeout(bcTimer); bcTimer = null; }
        if (txTimer) { clearTimeout(txTimer); txTimer = null; }
        if (stream) { stream.getTracks().forEach(function (x) { try { x.stop(); } catch (e) {} }); stream = null; }
        if (video) { try { video.srcObject = null; } catch (e) {} }
        txRef = null; lastLines = null; bcRef = null; bcSeen = []; sceneRef = null;
        if (!quiet) state('off');
    }
    // 読み方だけを変える（カメラはそのまま）。省エネを切り替えた時は、カメラの解像度も変える
    function setOptions(p) {
        if (!o) return;
        var hadText = o.text, hadBc = o.barcode, wl = o.whitelist, hadEco = o.eco;
        Object.assign(o, p || {});
        if (alive && o.barcode && !hadBc) bcTick();
        if (alive && o.text && !hadText) { textWorker().catch(function () {}); if (!txTimer) txTimer = setTimeout(txTick, 300); }
        if (tw && o.whitelist !== wl) tw.setParameters({ tessedit_char_whitelist: o.whitelist || '' }).catch(function () {});
        if (alive && stream && !!o.eco !== !!hadEco) {
            try { stream.getVideoTracks()[0].applyConstraints(camConstraints().video).catch(function () {}); } catch (e) {}
        }
    }
    window.POS_SCAN = {
        start: start, stop: stop, setOptions: setOptions,
        running: function () { return alive; },
        engine: function () { return native ? 'native' : (usedWorker ? 'zxing-worker' : (zxHere ? 'zxing' : '')); },
        textReady: function () { return !!tw; },
        scene: function () { return sceneVer; },
        size: function () { return video && video.videoWidth ? [video.videoWidth, video.videoHeight] : null; },
        prepText: function () { return textWorker().then(function () { return true; }); },
        // 試験用：下ごしらえだけを使う・見つけたラベル・ラベルの切り出し
        _prep: function (img) { return prep(img); },
        _regions: function () { return regions.slice(); },
        _crop: function (i, w) { return regions[i] ? cropOf(regions[i], w || 720, 1.25) : null; }
    };
})();
