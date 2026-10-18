/*
 * 集計の結果（HTML）を、PDFファイルにする部品 — 泰山木POS で使う
 * --------------------------------------------------
 * iPhone・iPad では、別の窓で印刷の画面を出す作りがうまく動かないことがある。
 * そこで、端末の中で集計の紙面を絵（JPEG）にして、A4のPDFファイルを作る。
 * できたファイルは、共有メニュー（「ファイル」に保存・プリント・AirDrop など）で使える。
 *   紙面を絵にする … html2canvas（vendor/html2canvas・MIT License）
 *   PDFの組み立て … ここで書く（1ページに1枚の絵を置くだけの、小さなPDF）
 * 使い方：POS_REPORT_PDF.make(紙面の要素, { title, onProgress(済んだページ, 全部のページ) }) → Promise<Blob>
 * 文字は絵になるので、PDFの中の文字を選んだり探したりはできない（見た目と印刷はそのまま）。
 */
(function () {
    'use strict';
    var BASE = (function () {
        try { if (document.currentScript && document.currentScript.src) return new URL('.', document.currentScript.src).href; } catch (e) {}
        return new URL('vendor/', location.href).href;
    })();
    // A4（210×297mm）の、上下左右15mmを除いた所に置く
    var PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 42.52;   // pt（1pt＝1/72インチ）
    var BOX_W = PAGE_W - MARGIN * 2, BOX_H = PAGE_H - MARGIN * 2;
    var CSS_W = 680;                                         // 紙面の幅（CSSのpx）。180mm に当たる
    var CSS_H = Math.floor(CSS_W * BOX_H / BOX_W);           // 1ページの高さ（CSSのpx）
    // iPhone の絵の大きさの上限（約1600万画素）を超えないよう、1ページずつ描く
    var SCALE = 2;

    var h2cLoading = null;
    function loadH2c() {
        if (window.html2canvas) return Promise.resolve(window.html2canvas);
        if (!h2cLoading) {
            h2cLoading = new Promise(function (res, rej) {
                var s = document.createElement('script');
                s.src = BASE + 'html2canvas/html2canvas.min.js';
                s.onload = function () { res(window.html2canvas); };
                s.onerror = function () { h2cLoading = null; rej(new Error('html2canvas を読み込めませんでした')); };
                document.head.appendChild(s);
            });
        }
        return h2cLoading;
    }

    // ページの切れ目：表の行・見出し・段落の途中で切らないよう、要素の下の端で切る
    function breakPoints(root) {
        var top = root.getBoundingClientRect().top;
        var ys = [];
        var sel = 'tr, h1, h2, h3, p, li, section, .report-heading, .sub-heading, .chart-container, .stat, .key-box, .note-box, .two-col, table, svg, img, .report-section > div';
        Array.prototype.forEach.call(root.querySelectorAll(sel), function (el) {
            var r = el.getBoundingClientRect();
            if (r.height > 0) ys.push(Math.round(r.bottom - top));
        });
        ys.sort(function (a, b) { return a - b; });
        return ys;
    }
    // 見出しだけがページの最後に残らないよう、見出しの上でも切れるようにする
    function headTops(root) {
        var top = root.getBoundingClientRect().top;
        return Array.prototype.map.call(root.querySelectorAll('.report-heading, .sub-heading, section'), function (el) {
            return Math.round(el.getBoundingClientRect().top - top);
        });
    }
    function pages(root) {
        var total = Math.ceil(root.scrollHeight);
        var ys = breakPoints(root), heads = headTops(root);
        var out = [], y = 0;
        while (y < total - 2) {
            var lim = y + CSS_H;
            if (lim >= total) { out.push([y, total]); break; }
            var cut = 0;
            ys.forEach(function (b) { if (b > y + CSS_H * 0.5 && b <= lim) cut = b; });
            if (!cut) cut = lim;
            // 見出しがページのいちばん下（切れ目の少し上）に来た時は、見出しの上で切って次のページへ送る
            heads.forEach(function (h) { if (h > y + CSS_H * 0.5 && h < cut && cut - h < 160) cut = Math.min(cut, h); });
            out.push([y, cut]);
            y = cut;
        }
        return out;
    }

    // グラフ（SVG）は、いまの大きさのまま絵（img）に置き換えてから描く（html2canvas が SVG を欠けて描くことがあるため）
    function svgToImg(root) {
        var waits = [];
        Array.prototype.forEach.call(root.querySelectorAll('svg'), function (svg) {
            var r = svg.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return;
            var c = svg.cloneNode(true);
            c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            c.setAttribute('width', String(Math.round(r.width)));
            c.setAttribute('height', String(Math.round(r.height)));
            // 色を CSS の変数や class で決めている所は、いまの色を書き込んでおく（絵にすると外の CSS が効かないため）
            var src = svg.querySelectorAll('*'), dst = c.querySelectorAll('*');
            for (var i = 0; i < src.length && i < dst.length; i++) {
                var cs = getComputedStyle(src[i]);
                ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family'].forEach(function (k) {
                    var v = cs.getPropertyValue(k);
                    if (v) dst[i].style.setProperty(k, v);
                });
            }
            var img = new Image();
            img.width = Math.round(r.width); img.height = Math.round(r.height);
            img.style.cssText = 'display:inline-block; vertical-align:top; width:' + Math.round(r.width) + 'px; height:' + Math.round(r.height) + 'px;';
            waits.push(new Promise(function (res) { img.onload = res; img.onerror = res; }));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c));
            svg.parentNode.replaceChild(img, svg);
            // 見出し（縦・横の説明）と同じ枠の中にある時は、枠からはみ出さない大きさに縮める（下の凡例と重ならないように）
            var box = img.parentNode && img.parentNode.getBoundingClientRect ? img.parentNode.getBoundingClientRect() : null;
            var ir = img.getBoundingClientRect();
            if (box && box.height > 0 && ir.bottom > box.bottom + 1) {
                var hh = Math.max(40, Math.floor(box.bottom - ir.top)), ww = Math.round(ir.width * hh / ir.height);
                img.width = ww; img.height = hh;
                img.style.width = ww + 'px'; img.style.height = hh + 'px';
            }
        });
        return Promise.all(waits);
    }
    function b64ToBytes(dataUrl) {
        var bin = atob(dataUrl.split(',')[1]);
        var a = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        return a;
    }
    // JPEG の絵を1ページに1枚ずつ置いたPDFを作る
    function buildPdf(imgs, title) {
        var enc = new TextEncoder();
        var parts = [], offsets = [], size = 0;
        function put(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; }
        function obj(n, body) { offsets[n] = size; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); }
        put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
        var n = imgs.length;
        // 1:目録 2:ページの束 3:題名など 以降：ページ・中身・絵 を3つずつ
        var kids = [];
        for (var i = 0; i < n; i++) kids.push((4 + i * 3) + ' 0 R');
        obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
        obj(2, function () { put('<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>'); });
        // 題名は UTF-16 で入れる（日本語の題名のため）
        var t = String(title || '');
        var hex = 'FEFF';
        for (var k = 0; k < t.length; k++) hex += ('0000' + t.charCodeAt(k).toString(16)).slice(-4).toUpperCase();
        obj(3, function () { put('<< /Title <' + hex + '> /Producer (POS) >>'); });
        imgs.forEach(function (im, i) {
            var pg = 4 + i * 3, ct = pg + 1, xo = pg + 2;
            var w = BOX_W, h = BOX_W * im.h / im.w;
            var y = PAGE_H - MARGIN - h;
            obj(pg, function () {
                put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /XObject << /Im' + i + ' ' + xo + ' 0 R >> >> /Contents ' + ct + ' 0 R >>');
            });
            var cs = 'q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + MARGIN.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + i + ' Do Q';
            obj(ct, function () { put('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream'); });
            obj(xo, function () {
                put('<< /Type /XObject /Subtype /Image /Width ' + im.pw + ' /Height ' + im.ph + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n');
                put(im.bytes);
                put('\nendstream');
            });
        });
        var xref = size, total = 4 + n * 3;
        var x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
        for (var j = 1; j < total; j++) x += ('0000000000' + offsets[j]).slice(-10) + ' 00000 n \n';
        put(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF');
        return new Blob(parts, { type: 'application/pdf' });
    }

    function make(source, opts) {
        opts = opts || {};
        // 画面の外に、紙と同じ幅の紙面を置いて描く（画面には見えない）
        var host = document.createElement('div');
        host.id = 'rp-host-' + Date.now();
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed; left:-12000px; top:0; width:' + CSS_W + 'px; background:#fff; z-index:-1; pointer-events:none;';
        host.innerHTML = source.innerHTML;
        document.body.appendChild(host);
        var done = function () { if (host.parentNode) host.parentNode.removeChild(host); };
        return loadH2c().then(function (h2c) {
            return svgToImg(host).then(function () { return h2c; });
        }).then(function (h2c) {
            // 字体と絵が読み終わるのを待ってから描く
            var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
            return ready.then(function () {
                var list = pages(host), imgs = [], i = 0;
                var next = function () {
                    if (i >= list.length) return Promise.resolve();
                    var y0 = list[i][0], y1 = list[i][1];
                    // 描く時の写し（html2canvas が作る見えない写し）の中だけ、紙面を左上に置き直す
                    return h2c(host, {
                        x: 0, y: y0, width: CSS_W, height: y1 - y0,
                        windowWidth: Math.max(CSS_W, window.innerWidth), windowHeight: Math.max(Math.ceil(host.scrollHeight) + 10, window.innerHeight),
                        scrollX: 0, scrollY: 0,
                        onclone: function (doc) {
                            var h = doc.getElementById(host.id);
                            if (h) { h.style.position = 'absolute'; h.style.left = '0px'; h.style.top = '0px'; h.style.zIndex = '2147483647'; }
                        },
                        scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true
                    }).then(function (cv) {
                        imgs.push({ w: CSS_W, h: y1 - y0, pw: cv.width, ph: cv.height, bytes: b64ToBytes(cv.toDataURL('image/jpeg', 0.86)) });
                        cv.width = cv.height = 1;   // 絵の場所をすぐ返す（iPhone は絵の合計の大きさにも上限がある）
                        i++;
                        if (opts.onProgress) { try { opts.onProgress(i, list.length); } catch (e) {} }
                        return next();
                    });
                };
                return next().then(function () { return buildPdf(imgs, opts.title); });
            });
        }).then(function (blob) { done(); return blob; }, function (e) { done(); throw e; });
    }

    window.POS_REPORT_PDF = { make: make, _pages: pages, _svgToImg: svgToImg, CSS_W: CSS_W, CSS_H: CSS_H };
})();
