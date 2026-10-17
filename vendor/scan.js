/*
 * カメラで商品を読む（バーコード・文字）— 泰山木POS の「カメラで自動入力」で使う部品
 * --------------------------------------------------
 * レジの画面の隅に小さなカメラの窓を出し、写っている物を一定の間をおいて読み続ける。
 *   バーコード … 端末に読み取りの機能（BarcodeDetector）があればそれを使い、無ければ zxing-wasm（vendor/zxing）で読む。
 *                1枚の画面に写った全部のバーコードを、まとめて返す。
 *   文字       … Tesseract.js（vendor/tesseract・日本語）で読む。読む前に「細い線（文字）だけを取り出す」下ごしらえをして、
 *                ラベルのふち・影・背景の模様を消してから読む（ブラックハット変換）。画面が変わった時だけ読む（電池のため）。
 * 読んだ結果を、どの商品か決めるのはレジの側（index.html の「カメラで自動入力」）。ここは読むことだけをする。
 *
 * 使い方：POS_SCAN.start({ video, barcode: true, text: true, facing: 'environment', whitelist: '…',
 *                          onCodes(list), onText(lines), onState(state, info) })
 *   onCodes … [{ raw: '2000000000015', box: {x,y,w,h} }]（同じ商品が2つ写っていれば2つ。枠は画面の割合 0〜1）
 *   onText  … [{ text: 'あんぱん', conf: 90, x0, y0, x1, y1 }]（行ごと。枠は画面の割合 0〜1）
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
    var o = null;                // いまの設定
    var stream = null, video = null, alive = false;
    var bcTimer = null, txTimer = null;
    var cv = document.createElement('canvas');
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var thumbCv = document.createElement('canvas');
    thumbCv.width = 64; thumbCv.height = 36;
    var thumbCx = thumbCv.getContext('2d', { willReadFrequently: true });

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
    // 今の画面を、決めた幅まで縮めて描く（読みやすさと速さの両立）
    function grab(maxW) {
        if (!video || !video.videoWidth) return null;
        var vw = video.videoWidth, vh = video.videoHeight;
        var k = Math.min(1, maxW / vw);
        var w = Math.round(vw * k), h = Math.round(vh * k);
        if (cv.width !== w) cv.width = w;
        if (cv.height !== h) cv.height = h;
        cx.drawImage(video, 0, 0, w, h);
        return cx.getImageData(0, 0, w, h);
    }

    // ---- バーコード ----
    var native = null, nativeChecked = false, zx = null, zxLoading = null, bcBusy = false, usedWorker = false, zxHere = false;
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
    // 枠は画面の割合（0〜1）で返す（カメラの窓の大きさに合わせて描くため）
    function boxOf(pos, W, H) {
        if (!pos) return null;
        var xs = [pos.topLeft.x, pos.topRight.x, pos.bottomLeft.x, pos.bottomRight.x];
        var ys = [pos.topLeft.y, pos.topRight.y, pos.bottomLeft.y, pos.bottomRight.y];
        var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
        return { x: x0 / W, y: y0 / H, w: (Math.max.apply(null, xs) - x0) / W, h: (Math.max.apply(null, ys) - y0) / H };
    }
    function bcTick() {
        bcTimer = null;
        if (!alive || !o.barcode) return;
        var next = function (ms) { if (alive && o.barcode && !bcTimer) bcTimer = setTimeout(bcTick, ms); };
        if (document.hidden || bcBusy || (o.busy && o.busy())) { next(300); return; }
        bcBusy = true;
        sceneTick();
        nativeDetector().then(function (det) {
            if (det) {
                return det.detect(video).then(function (r) {
                    var vw = video.videoWidth || 1, vh = video.videoHeight || 1;
                    return { ms: 220, list: r.map(function (x) { var b = x.boundingBox; return { raw: String(x.rawValue || ''), box: b ? { x: b.x / vw, y: b.y / vh, w: b.width / vw, h: b.height / vh } : null }; }) };
                });
            }
            var img = grab(1280);
            if (!img) return { ms: 300, list: [] };
            var keep = wk === false ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
            return call('bc', img).then(function (r) {
                if (r && !r.error) { usedWorker = true; return { ms: 300, list: r.list || [] }; }
                // 作業場が使えない時は、この画面で読む
                return zxing().then(function (z) {
                    return z.readBarcodes(keep, { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'QRCode'], maxNumberOfSymbols: 16, tryHarder: true }).then(function (r2) {
                        zxHere = true;
                        return { ms: 420, list: r2.filter(function (x) { return x.isValid && x.text; }).map(function (x) { return { raw: String(x.text), box: boxOf(x.position, keep.width, keep.height) }; }) };
                    });
                });
            });
        }).then(function (res) {
            bcBusy = false;
            if (!alive) return;
            try { if (o.onCodes) o.onCodes(res.list); } catch (e) { console.warn(e); }
            next(res.ms);
        }).catch(function (e) {
            bcBusy = false;
            console.warn('バーコードを読めませんでした', e);
            state('bc-error', String(e && e.message || e));
            next(2000);
        });
    }

    // ---- 文字 ----
    var tw = null, twLoading = null, txBusy = false, lastThumb = null, lastLines = null, lastTextAt = 0;
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
    function call(type, img) {
        var w = worker();
        if (!w) return Promise.resolve({ error: 'worker' });
        return new Promise(function (res) {
            var id = ++wkSeq;
            wkWait[id] = res;
            w.postMessage({ id: id, type: type, w: img.width, h: img.height, buf: img.data.buffer }, [img.data.buffer]);
        });
    }
    // 下ごしらえ：作業場が使えない時は、この画面で（vendor/scan-prep.js）
    var prepLib = null;
    function prepHere() {
        if (window.SCAN_PREP) return Promise.resolve(window.SCAN_PREP);
        if (!prepLib) prepLib = loadScript(BASE + 'scan-prep.js').then(function () { return window.SCAN_PREP; });
        return prepLib;
    }
    function prep(img) {
        var W = img.width, H = img.height, copy = new Uint8ClampedArray(img.data);
        return call('prep', img).then(function (r) {
            if (r && r.buf) return new ImageData(new Uint8ClampedArray(r.buf), W, H);
            return prepHere().then(function (P) { P.prep(copy, W, H); return new ImageData(copy, W, H); });
        });
    }
    // 画面が変わったか（小さく縮めた明るさの差）。比べる相手は「最後に文字を読んだ時の画面」
    // （読んでいる途中で商品を外した時に、外した後の画面を「読んだ画面」と取り違えないように、読む前に控える）
    function thumbNow() {
        if (!video || !video.videoWidth) return null;
        thumbCx.drawImage(video, 0, 0, 64, 36);
        return new Uint8ClampedArray(thumbCx.getImageData(0, 0, 64, 36).data);
    }
    // 画面の動き：小さく縮めた画面が、前に見た画面からはっきり変わった時だけ数を増やす
    // （レジの側で「写らなくなった物は外に出した」と決める時に、画面が動いていなければ、まだ置いてあるとみなすため）
    var sceneVer = 0, sceneRef = null;
    function sceneTick() {
        var t = thumbNow();
        if (!t) return;
        if (!sceneRef) { sceneRef = t; return; }
        var s = 0, i;
        for (i = 0; i < t.length; i += 4) s += Math.abs(t[i] - sceneRef[i]) + Math.abs(t[i + 1] - sceneRef[i + 1]);
        if (s / (64 * 36 * 2) > 5) { sceneVer++; sceneRef = t; }
    }
    function changed() {
        var t = thumbNow();
        if (!t) return false;
        if (!lastThumb) return true;
        var s = 0, i;
        for (i = 0; i < t.length; i += 4) s += Math.abs(t[i] - lastThumb[i]) + Math.abs(t[i + 1] - lastThumb[i + 1]);
        return s / (64 * 36 * 2) > 3.5;
    }
    function txTick() {
        txTimer = null;
        if (!alive || !o.text) return;
        var next = function (ms) { if (alive && o.text && !txTimer) txTimer = setTimeout(txTick, ms); };
        if (document.hidden || txBusy || (o.busy && o.busy())) { next(500); return; }
        // 画面が変わっていなければ、前に読んだ結果をもう一度伝える（まだ写っている、という知らせ。読み直さない）
        if (lastLines && Date.now() - lastTextAt < 2500 && !changed()) {
            try { if (o.onText) o.onText(lastLines, { same: true }); } catch (e) {}
            next(700);
            return;
        }
        txBusy = true;
        sceneTick();
        var shot = null;
        var deg = ANGLES[angleAt++ % ANGLES.length], rad = deg * Math.PI / 180;
        textWorker().then(function (w) {
            shot = thumbNow();
            var img = grab(1100);
            if (!img) return [];
            return prep(img).then(function (pimg) { return [w, img, pimg]; });
        }).then(function (arr) {
            if (!arr.length) return [];
            var w = arr[0], img = arr[1], pimg = arr[2];
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
                            var t = String(l.text || '').replace(/\s+/g, '').trim();
                            if (!t) return;
                            var c = back((l.bbox.x0 + l.bbox.x1) / 2, (l.bbox.y0 + l.bbox.y1) / 2), hw = (l.bbox.x1 - l.bbox.x0) / 2, hh = (l.bbox.y1 - l.bbox.y0) / 2;
                            // 行どうしの位置（同じラベルの2行目か）を比べられるよう、回した向きのままの位置（rx・ry）も残す
                            lines.push({ text: t, conf: Math.round(l.confidence || 0), x0: (c[0] - hw) / img.width, y0: (c[1] - hh) / img.height, x1: (c[0] + hw) / img.width, y1: (c[1] + hh) / img.height,
                                rx0: l.bbox.x0 / img.width, ry0: l.bbox.y0 / img.height, rx1: l.bbox.x1 / img.width, ry1: l.bbox.y1 / img.height, deg: deg });
                        });
                    });
                });
                return lines;
            });
        }).then(function (lines) {
            txBusy = false;
            if (!alive) return;
            lastThumb = shot;
            lastLines = lines; lastTextAt = Date.now();
            try { if (o.onText) o.onText(lines, { same: false }); } catch (e) { console.warn(e); }
            next(600);
        }).catch(function (e) {
            txBusy = false;
            console.warn('文字を読めませんでした', e);
            next(4000);
        });
    }

    function start(opts) {
        stop(true);
        o = Object.assign({ barcode: true, text: true, facing: 'environment' }, opts || {});
        video = o.video;
        if (!video) return Promise.reject(new Error('video がありません'));
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { state('nocam'); return Promise.resolve(false); }
        alive = true;
        state('starting');
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.muted = true;
        return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: o.facing === 'user' ? 'user' : 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
            .then(function (s) {
                if (!alive) { s.getTracks().forEach(function (t) { t.stop(); }); return false; }
                stream = s;
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
                state(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : (n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nocam' : 'error'), String(e && e.message || e));
                return false;
            });
    }
    function stop(quiet) {
        alive = false;
        if (bcTimer) { clearTimeout(bcTimer); bcTimer = null; }
        if (txTimer) { clearTimeout(txTimer); txTimer = null; }
        if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); stream = null; }
        if (video) { try { video.srcObject = null; } catch (e) {} }
        lastThumb = null; lastLines = null;
        if (!quiet) state('off');
    }
    // 読み方だけを変える（カメラはそのまま）
    function setOptions(p) {
        if (!o) return;
        var hadText = o.text, hadBc = o.barcode, wl = o.whitelist;
        Object.assign(o, p || {});
        if (alive && o.barcode && !hadBc) bcTick();
        if (alive && o.text && !hadText) { textWorker().catch(function () {}); if (!txTimer) txTimer = setTimeout(txTick, 300); }
        if (tw && o.whitelist !== wl) tw.setParameters({ tessedit_char_whitelist: o.whitelist || '' }).catch(function () {});
    }
    window.POS_SCAN = {
        start: start, stop: stop, setOptions: setOptions,
        running: function () { return alive; },
        engine: function () { return native ? 'native' : (usedWorker ? 'zxing-worker' : (zxHere ? 'zxing' : '')); },
        textReady: function () { return !!tw; },
        scene: function () { return sceneVer; },
        prepText: function () { return textWorker().then(function () { return true; }); },
        // 試験用：下ごしらえだけを使う
        _prep: function (img) { return prep(img); }
    };
})();
