// POP・ポスターを作る（設定 → POP・ポスター。「レジの機能」でオンにした時だけ、開いた時に読み込む）
// ・販売中の商品を押すと、テンプレート・スタンプ・イラスト・フォントを組み合わせて下書きを自動で作る
// ・下書きを直して、画像（PNG）で保存・共有・印刷する。作ったものはこの端末に残る
// 【素材と権利】
// ・テンプレート（背景・枠・模様）は、このファイルの中で線と図形を描いて作る
// ・イラスト・飾りは、このファイルの中の SVG（線と図形だけで描いた、このアプリのための物）
// ・商品の絵は vendor/menu-art.js（このアプリのための物）。写真はお店が付けた物
// ・文字は Google Fonts の日本語フォント（どれも SIL Open Font License 1.1。作った画像・印刷物は自由に使える）
// ・AIで作った画像は使わない。文字はすべて本物のフォントで描く（日本語がくずれない）
// ・会計の計算・記録には関わらない（商品の名前と値段を読むだけ）
(function () {
    'use strict';
    var A = null;              // アプリとの橋渡し（index.html の popApi）
    var host = null;           // 描く場所（設定の画面の中）
    var S = { view: 'list', d: null, hist: [], sel: null, tab: 'tpl', boxes: [], drag: null, raf: 0, batch: null, fontsAsked: false, fontState: 'wait', printTile: true, thumbs: {} };

    // ---------------- フォント（Google Fonts・SIL Open Font License 1.1） ----------------
    var FONTS = [
        { id: 'zen', fam: 'Zen Maru Gothic', label: 'まるゴシック', w: [500, 700, 900] },
        { id: 'kiwi', fam: 'Kiwi Maru', label: 'まる手書き', w: [400, 500] },
        { id: 'mochiy', fam: 'Mochiy Pop One', label: 'ポップ', w: [400] },
        { id: 'dela', fam: 'Dela Gothic One', label: '極太', w: [400] },
        { id: 'rnr', fam: 'RocknRoll One', label: '太まる', w: [400] },
        { id: 'yusei', fam: 'Yusei Magic', label: 'マーカー', w: [400] },
        { id: 'hachi', fam: 'Hachi Maru Pop', label: 'まる文字', w: [400] },
        { id: 'klee', fam: 'Klee One', label: 'えんぴつ', w: [400, 600] },
        { id: 'yomogi', fam: 'Yomogi', label: '手書き', w: [400] },
        { id: 'mincho', fam: 'Shippori Mincho', label: '明朝', w: [500, 800] },
        // 読みまちがえにくい形の文字（ユニバーサルデザイン。SIL Open Font License 1.1）
        { id: 'udg', fam: 'BIZ UDPGothic', label: 'UDゴシック', w: [400, 700] }
    ];
    var FONT_BY = {};
    FONTS.forEach(function (f) { FONT_BY[f.id] = f; });
    var FALLBACK = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    function fontWt(f, bold) { return bold ? f.w[f.w.length - 1] : f.w[0]; }
    // フォントは、使う文字の分だけを Google Fonts から読み込む（text= で文字をしぼる。1回で数KB〜数十KB）。
    // 読み込んだ分は「別名」で登録し、描く時は別名を順に並べる（足りない文字は次の別名・端末の文字で描く）
    var FREG = {};
    function freg(fid, wt) { var k = fid + '|' + wt; return FREG[k] || (FREG[k] = { have: {}, aliases: [], pend: '', t: 0, waits: [], n: 0 }); }
    function fontStr(fid, bold, px) {
        var f = FONT_BY[fid] || FONTS[0], wt = fontWt(f, bold), r = FREG[f.id + '|' + wt];
        var names = (r ? r.aliases.slice().reverse().map(function (x) { return '"' + x + '"'; }).join(', ') + (r.aliases.length ? ', ' : '') : '');
        return wt + ' ' + Math.max(1, Math.round(px * 10) / 10) + 'px ' + names + '"' + f.fam + '", ' + FALLBACK;
    }
    function gfUrl(f, wt, text) {
        var fam = f.fam.replace(/ /g, '+') + (f.w.length > 1 ? ':wght@' + wt : '');
        return 'https://fonts.googleapis.com/css2?family=' + fam + '&text=' + encodeURIComponent(text) + '&display=block';
    }
    // 要る文字を頼む（まだ無い文字だけ。少し待ってまとめて読む）。読めたら描き直す
    function needFont(fid, bold, text, low) {
        var f = FONT_BY[fid] || FONTS[0], wt = fontWt(f, bold), r = freg(f.id, wt), add = '';
        Array.from(String(text || '').replace(/\s/g, '')).forEach(function (ch) { if (!r.have[ch] && r.pend.indexOf(ch) < 0 && add.indexOf(ch) < 0) add += ch; });
        if (!add) return r.busy || Promise.resolve();
        // うまく読めなかった直後は、しばらく頼まない（何度も続けて頼まないように）
        if (r.failAt && Date.now() - r.failAt < 15000) return Promise.resolve();
        r.pend += add;
        r.low = !!low && r.low !== false;
        if (!r.busy) r.busy = new Promise(function (res) { r.waits.push(res); });
        clearTimeout(r.t);
        r.t = setTimeout(function () { flushFont(f, wt, r); }, 120);
        return r.busy;
    }
    function flushFont(f, wt, r) {
        var chars = r.pend; r.pend = ''; var low = r.low; r.low = undefined;
        var done = function () { var w = r.waits; r.waits = []; r.busy = null; w.forEach(function (x) { x(); }); };
        if (!chars || !window.fetch || !window.FontFace) { done(); return; }
        // 文字が多い時は分けて頼む（アドレスが長くなりすぎないように）
        var parts = [], all = Array.from(chars);
        for (var i = 0; i < all.length; i += 300) parts.push(all.slice(i, i + 300).join(''));
        Promise.all(parts.map(function (part) {
            return fontJob(low, function () {
                return retry(function () { return fetch(gfUrl(f, wt, part)).then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.text(); }); }, 2).then(function (css) {
                    var m = css.match(/url\((https:[^)]+)\)/);
                    if (!m) throw new Error('no font');
                    var alias = 'pop-' + f.id + '-' + wt + '-' + (++r.n);
                    return retry(function () { return new FontFace(alias, 'url(' + m[1] + ')', { weight: String(wt) }).load(); }, 2)
                        .then(function (ff) { document.fonts.add(ff); r.aliases.push(alias); Array.from(part).forEach(function (ch) { r.have[ch] = 1; }); FONT_OK++; });
                });
            });
        })).then(function () {
            r.failAt = 0;
            if (S.fontState !== 'ok') { S.fontState = 'ok'; showFontState(); }
            done(); drawSoon(); S.thumbs = {}; drawTplThumbsSoon();
        }, function () {
            // 読めなかった文字は、端末の文字で描く（しばらくしてから、もう一度頼む）
            r.failAt = Date.now();
            if (!FONT_OK) { S.fontState = 'off'; showFontState(); }
            done(); drawSoon();
        });
    }
    // 同時に頼むのは2つまで（たくさん同時に頼むと、断られることがある）。失敗したら、少し待ってやり直す
    var FONT_OK = 0, FQ = [], FQrun = 0;
    // 下書きで使う文字を先に、フォントを選ぶボタンの見本（low）は後に
    function fontJob(low, job) {
        return new Promise(function (res, rej) { var it = { job: job, res: res, rej: rej }; if (low) FQ.push(it); else FQ.unshift(it); pumpFonts(); });
    }
    function pumpFonts() {
        while (FQrun < 2 && FQ.length) {
            var it = FQ.shift();
            FQrun++;
            (function (it) {
                var fin = function () { FQrun--; pumpFonts(); };
                it.job().then(function (v) { fin(); it.res(v); }, function (e) { fin(); it.rej(e); });
            })(it);
        }
    }
    function retry(fn, n) {
        return fn().catch(function (e) {
            if (n <= 0) throw e;
            return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return retry(fn, n - 1); });
        });
    }
    // フォントを選ぶボタンの見本の字（あ字A）だけ、先に読む
    function askFonts() {
        if (S.fontsAsked) return;
        S.fontsAsked = true;
        FONTS.forEach(function (f) { needFont(f.id, true, 'あ字A', true); });
    }
    function pickerFamily(f) {
        var r = FREG[f.id + '|' + fontWt(f, true)];
        return (r && r.aliases.length ? r.aliases.map(function (x) { return "'" + x + "'"; }).join(',') + ',' : '') + "'" + f.fam + "'," + FALLBACK.replace(/"/g, "'");
    }
    // この下書きで使う文字を、そろえる（保存・印刷の前。最長で数秒待つ）
    function loadFontsFor(d) {
        var jobs = [];
        (d.els || []).forEach(function (e) {
            var txt = elText(e);
            if (txt) jobs.push(needFont(resolveFont(d, e), resolveBold(d, e), txt));
        });
        return Promise.race([Promise.all(jobs), new Promise(function (r) { setTimeout(r, 12000); })]);
    }

    // ---------------- 大きさ（印刷に向く細かさ。300dpi） ----------------
    var FMTS = {
        popL: { label: 'POP 横（はがき）', w: 1748, h: 1181, mm: [148, 100] },
        popP: { label: 'POP 縦（はがき）', w: 1181, h: 1748, mm: [100, 148] },
        card: { label: '名刺サイズ', w: 1075, h: 650, mm: [91, 55] },
        a4: { label: 'ポスター A4', w: 2480, h: 3508, mm: [210, 297] },
        sq: { label: '正方形（SNS）', w: 1440, h: 1440, mm: [120, 120] }
    };
    var FMT_ORDER = ['popL', 'popP', 'card', 'a4', 'sq'];

    // ---------------- イラスト・飾り（このアプリのために描いた SVG。viewBox 0 0 100 100） ----------------
    function rep(n, f) { var s = ''; for (var i = 0; i < n; i++) s += f(i); return s; }
    var DECO = [
        { id: 'star', label: '星', g: 'all', svg: '<path d="M50 6l12.4 27.3 29.8 3.3-22.2 20.1 6.2 29.3L50 71.3 23.8 86l6.2-29.3L7.8 36.6l29.8-3.3z" fill="#FFD43B" stroke="#E8A800" stroke-width="3" stroke-linejoin="round"/>' },
        { id: 'sparkle', label: 'きらきら', g: 'all', svg: '<path d="M50 6C53 38 62 47 94 50C62 53 53 62 50 94C47 62 38 53 6 50C38 47 47 38 50 6Z" fill="#FFE066"/><path d="M82 12C83 20 86 23 94 24C86 25 83 28 82 36C81 28 78 25 70 24C78 23 81 20 82 12Z" fill="#FFC9D9"/>' },
        { id: 'heart', label: 'ハート', g: 'all', svg: '<path d="M50 86C20 64 8 46 14 30C20 14 40 12 50 28C60 12 80 14 86 30C92 46 80 64 50 86Z" fill="#F06C8B"/><path d="M30 26C24 28 20 34 22 40" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".6"/>' },
        { id: 'flower', label: '花', g: 'all', svg: '<g fill="#F7A1B8">' + [[50, 27], [71.9, 42.9], [63.5, 68.6], [36.5, 68.6], [28.1, 42.9]].map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="17"/>'; }).join('') + '</g><circle cx="50" cy="50" r="12" fill="#FFD43B"/>' },
        { id: 'daisy', label: 'デイジー', g: 'all', svg: '<g fill="#fff" stroke="#E2D6C2" stroke-width="2">' + rep(12, function (i) { return '<ellipse cx="50" cy="24" rx="8" ry="19" transform="rotate(' + (i * 30) + ' 50 50)"/>'; }) + '</g><circle cx="50" cy="50" r="13" fill="#F6C343"/>' },
        { id: 'sunflower', label: 'ひまわり', g: 'summer', svg: '<g fill="#FFC928" stroke="#E8A800" stroke-width="1.5">' + rep(16, function (i) { return '<ellipse cx="50" cy="20" rx="7" ry="17" transform="rotate(' + (i * 22.5) + ' 50 50)"/>'; }) + '</g><circle cx="50" cy="50" r="18" fill="#7A4A22"/><g fill="#A9713E">' + rep(8, function (i) { var a = i * Math.PI / 4; return '<circle cx="' + (50 + 9 * Math.cos(a)).toFixed(1) + '" cy="' + (50 + 9 * Math.sin(a)).toFixed(1) + '" r="2.2"/>'; }) + '</g>' },
        { id: 'sakura', label: '桜', g: 'spring', svg: '<g fill="#F9C4D2" stroke="#EF98B0" stroke-width="2" stroke-linejoin="round">' + rep(5, function (i) { return '<path d="M50 50C37 41 35 22 44 11L50 17L56 11C65 22 63 41 50 50Z" transform="rotate(' + (i * 72) + ' 50 50)"/>'; }) + '</g><circle cx="50" cy="50" r="6" fill="#F06C9B"/>' },
        { id: 'leaf', label: '葉っぱ', g: 'all', svg: '<path d="M16 84C16 40 46 16 88 14C86 58 60 86 16 84Z" fill="#7CB66A"/><path d="M19 81C40 60 58 40 84 18" stroke="#4E8A43" stroke-width="3" fill="none" stroke-linecap="round"/>' },
        { id: 'maple', label: 'もみじ', g: 'autumn', svg: '<path d="M50 6L57 30L76 18L70 42L94 44L74 58L84 76L60 70L54 92H46L40 70L16 76L26 58L6 44L30 42L24 18L43 30Z" fill="#E8702A" stroke="#C4531C" stroke-width="2" stroke-linejoin="round"/><path d="M50 30V94" stroke="#B4471A" stroke-width="3" stroke-linecap="round"/>' },
        { id: 'ginkgo', label: 'いちょう', g: 'autumn', svg: '<path d="M50 58C24 60 8 40 12 18C30 8 70 8 88 18C92 40 76 60 50 58Z" fill="#F2C531"/><path d="M50 12L50 58M30 16L50 58M70 16L50 58" stroke="#D9A515" stroke-width="2" opacity=".7"/><path d="M50 58V92" stroke="#B88A12" stroke-width="4" stroke-linecap="round"/>' },
        { id: 'pumpkin', label: 'かぼちゃ', g: 'autumn', svg: '<ellipse cx="32" cy="60" rx="20" ry="26" fill="#E8751A"/><ellipse cx="68" cy="60" rx="20" ry="26" fill="#E8751A"/><ellipse cx="50" cy="60" rx="21" ry="29" fill="#F48C2C"/><path d="M50 32C50 24 54 18 61 15" stroke="#4E7A33" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M38 52L44 60H32Z M62 52L68 60H56Z" fill="#5A2E0E"/><path d="M36 70Q50 80 64 70Q58 76 50 76Q42 76 36 70Z" fill="#5A2E0E"/>' },
        { id: 'ghost', label: 'おばけ', g: 'autumn', svg: '<path d="M22 86V44C22 24 36 12 50 12S78 24 78 44V86L69 78L60 86L50 78L40 86L31 78Z" fill="#fff" stroke="#BFC3D6" stroke-width="3" stroke-linejoin="round"/><ellipse cx="40" cy="44" rx="5" ry="7" fill="#2B2B3A"/><ellipse cx="60" cy="44" rx="5" ry="7" fill="#2B2B3A"/><ellipse cx="50" cy="60" rx="5" ry="6" fill="#2B2B3A"/><ellipse cx="33" cy="54" rx="4" ry="2.5" fill="#F7B3C2"/><ellipse cx="67" cy="54" rx="4" ry="2.5" fill="#F7B3C2"/>' },
        { id: 'snow', label: '雪の結晶', g: 'winter', svg: '<g stroke="#8EC5E8" stroke-width="5" stroke-linecap="round" fill="none">' + rep(3, function (i) { return '<g transform="rotate(' + (i * 60) + ' 50 50)"><path d="M50 8V92"/><path d="M50 22L40 14M50 22L60 14M50 78L40 86M50 78L60 86"/></g>'; }) + '</g>' },
        { id: 'holly', label: 'ひいらぎ', g: 'winter', svg: '<path d="M50 56C34 60 16 54 6 40C14 42 18 36 26 38C30 32 38 34 42 30C46 38 50 44 50 56Z" fill="#2E7D4F"/><path d="M50 56C66 60 84 54 94 40C86 42 82 36 74 38C70 32 62 34 58 30C54 38 50 44 50 56Z" fill="#3C9A62"/><g fill="#D7263D"><circle cx="43" cy="60" r="7"/><circle cx="57" cy="60" r="7"/><circle cx="50" cy="69" r="7"/></g><g fill="#fff" opacity=".6"><circle cx="41" cy="58" r="2"/><circle cx="55" cy="58" r="2"/><circle cx="48" cy="67" r="2"/></g>' },
        { id: 'ornament', label: 'オーナメント', g: 'winter', svg: '<path d="M50 4C46 10 54 14 50 20" stroke="#B8962E" stroke-width="2" fill="none"/><circle cx="50" cy="58" r="32" fill="#D94A5A"/><rect x="41" y="20" width="18" height="10" rx="2" fill="#E8C35A"/><path d="M20 54Q50 68 80 54" stroke="#F5D88A" stroke-width="6" fill="none"/><path d="M22 68Q50 80 78 68" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/><ellipse cx="38" cy="42" rx="7" ry="4" fill="#fff" opacity=".35"/>' },
        { id: 'tree', label: 'ツリー', g: 'winter', svg: '<path d="M50 10L74 44H62L82 70H18L38 44H26Z" fill="#2E8B57"/><rect x="44" y="70" width="12" height="16" fill="#8B5A2B"/><g fill="#FFD43B"><circle cx="40" cy="58" r="3"/><circle cx="60" cy="52" r="3"/><circle cx="50" cy="36" r="3"/></g><g fill="#E5484D"><circle cx="58" cy="64" r="3"/><circle cx="44" cy="46" r="3"/></g><path d="M50 2l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L41 9l6-1z" fill="#FFD43B"/>' },
        { id: 'gift', label: 'プレゼント', g: 'winter', svg: '<rect x="16" y="40" width="68" height="48" rx="4" fill="#E5484D"/><rect x="12" y="30" width="76" height="14" rx="3" fill="#F06A6E"/><rect x="45" y="30" width="10" height="58" fill="#FFD43B"/><path d="M50 30C38 14 22 20 30 30M50 30C62 14 78 20 70 30" stroke="#FFD43B" stroke-width="6" fill="none" stroke-linecap="round"/>' },
        { id: 'cup', label: 'カップ', g: 'cafe', svg: '<path d="M38 26C34 20 42 16 38 10M50 26C46 20 54 16 50 10" stroke="#B9A08A" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M20 36H70V60C70 76 60 84 45 84S20 76 20 60Z" fill="#fff" stroke="#6B4A35" stroke-width="4" stroke-linejoin="round"/><path d="M70 44C86 42 88 64 70 64" fill="none" stroke="#6B4A35" stroke-width="4"/><path d="M14 90H76" stroke="#6B4A35" stroke-width="4" stroke-linecap="round"/><ellipse cx="45" cy="40" rx="21" ry="3" fill="#8A5A3C"/>' },
        { id: 'wheat', label: '麦', g: 'all', svg: '<path d="M50 94V20" stroke="#C4943E" stroke-width="3" stroke-linecap="round"/><g fill="#E3B55B" stroke="#C4943E" stroke-width="1.5">' + rep(5, function (i) { var y = 22 + i * 12; return '<ellipse cx="42" cy="' + y + '" rx="6" ry="10" transform="rotate(-30 42 ' + y + ')"/><ellipse cx="58" cy="' + y + '" rx="6" ry="10" transform="rotate(30 58 ' + y + ')"/>'; }) + '</g><ellipse cx="50" cy="12" rx="5" ry="9" fill="#E3B55B" stroke="#C4943E" stroke-width="1.5"/>' },
        { id: 'bow', label: 'リボン', g: 'all', svg: '<path d="M50 46C36 30 14 30 14 46S36 62 50 46Z" fill="#F08DA6"/><path d="M50 46C64 30 86 30 86 46S64 62 50 46Z" fill="#F08DA6"/><path d="M46 50L34 84L42 80L48 88L52 52Z M54 50L66 84L58 80L52 88L48 52Z" fill="#E56F8E"/><circle cx="50" cy="46" r="7" fill="#E56F8E"/>' },
        { id: 'crown', label: '王冠', g: 'all', svg: '<path d="M12 72L18 30L36 50L50 20L64 50L82 30L88 72Z" fill="#F6C343" stroke="#C99A16" stroke-width="3" stroke-linejoin="round"/><rect x="12" y="72" width="76" height="12" rx="2" fill="#E8B020"/><g fill="#E5484D"><circle cx="30" cy="78" r="3.5"/><circle cx="50" cy="78" r="3.5"/><circle cx="70" cy="78" r="3.5"/></g><g fill="#fff"><circle cx="18" cy="30" r="4"/><circle cx="50" cy="20" r="4"/><circle cx="82" cy="30" r="4"/></g>' },
        { id: 'clover', label: 'クローバー', g: 'spring', svg: '<g fill="#5DB36A">' + rep(4, function (i) { return '<path d="M50 50C40 40 34 26 42 20C47 16 50 22 50 22C50 22 53 16 58 20C66 26 60 40 50 50Z" transform="rotate(' + (i * 90) + ' 50 50)"/>'; }) + '</g><path d="M52 52Q58 74 70 88" stroke="#3E8A4B" stroke-width="4" fill="none" stroke-linecap="round"/>' },
        { id: 'cloud', label: '雲', g: 'all', svg: '<path d="M24 74C10 74 8 54 22 52C20 36 40 30 48 42C54 26 80 30 76 50C92 50 92 74 76 74Z" fill="#fff" stroke="#C9D6E3" stroke-width="3" stroke-linejoin="round"/>' },
        { id: 'tape', label: 'マスキングテープ', g: 'all', svg: '<path d="M4 36L8 40L4 44L8 48L4 52L8 56L4 60L8 64H92L96 60L92 56L96 52L92 48L96 44L92 40L96 36Z" fill="#F7C9A8" opacity=".9"/><g stroke="#fff" stroke-width="3" opacity=".7">' + rep(9, function (i) { return '<path d="M' + (12 + i * 9) + ' 36L' + (6 + i * 9) + ' 64"/>'; }) + '</g>' },
        { id: 'confetti', label: '紙ふぶき', g: 'all', svg: '<g><rect x="12" y="18" width="10" height="5" rx="1" fill="#F06C8B" transform="rotate(-20 17 20)"/><rect x="70" y="14" width="10" height="5" rx="1" fill="#3BA3E0" transform="rotate(30 75 16)"/><rect x="40" y="36" width="10" height="5" rx="1" fill="#FFC93C" transform="rotate(10 45 38)"/><rect x="80" y="56" width="10" height="5" rx="1" fill="#7CB66A" transform="rotate(-35 85 58)"/><rect x="18" y="70" width="10" height="5" rx="1" fill="#9B6BD3" transform="rotate(25 23 72)"/><circle cx="58" cy="76" r="4" fill="#F06C8B"/><circle cx="30" cy="46" r="3.5" fill="#3BA3E0"/><circle cx="64" cy="40" r="3" fill="#7CB66A"/><circle cx="48" cy="88" r="3" fill="#FFC93C"/></g>' },
        { id: 'arrow', label: '矢印', g: 'all', svg: '<path d="M12 70C30 30 60 24 82 34" stroke="#E2557F" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M70 22L86 36L66 46" stroke="#E2557F" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' }
    ];
    var DECO_BY = {};
    DECO.forEach(function (x) { DECO_BY[x.id] = x; });
    function decoSvg(id) { var x = DECO_BY[id]; return x ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + x.svg + '</svg>' : ''; }

    // ---------------- スタンプ（札）。文字はフォントで描く ----------------
    // 「No.1」「無添加」のような、根拠や中身を書き添えないといけない言葉は、スタンプに入れない
    // （景品表示法の No.1 表示の考え方・食品添加物の不使用表示のガイドライン）。必要な時は、根拠と一緒に自分で書く
    var STAMP_WORDS = ['おすすめ', '新商品', '人気', '期間限定', '数量限定', '季節限定', '焼きたて', '手作り', '本日のおすすめ', 'NEW'];
    var STAMP_STYLES = [['burst', 'ギザギザ'], ['circle', 'まる'], ['ribbon', 'リボン'], ['tag', 'ふだ'], ['bubble', '吹き出し']];

    // ---------------- 描く道具 ----------------
    function rng(seed) { var s = (seed >>> 0) || 1; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
    function rr(ctx, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    function burstPath(ctx, cx, cy, ro, ri, n, rot) {
        ctx.beginPath();
        for (var i = 0; i < n * 2; i++) {
            var a = (rot || 0) + i * Math.PI / n, r = i % 2 ? ri : ro;
            var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
    }
    // 手で引いたような四角（少しゆれる線）
    function wobblyRect(ctx, x, y, w, h, amp, rnd) {
        var pts = [], seg = 14, i;
        for (i = 0; i <= seg; i++) pts.push([x + w * i / seg, y + (rnd() - .5) * amp]);
        for (i = 1; i <= seg; i++) pts.push([x + w + (rnd() - .5) * amp, y + h * i / seg]);
        for (i = 1; i <= seg; i++) pts.push([x + w - w * i / seg, y + h + (rnd() - .5) * amp]);
        for (i = 1; i < seg; i++) pts.push([x + (rnd() - .5) * amp, y + h - h * i / seg]);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
    }
    function dots(ctx, W, H, step, r, color, rnd, jitter) {
        ctx.fillStyle = color;
        for (var y = step / 2, row = 0; y < H + step; y += step, row++) {
            for (var x = (row % 2 ? step / 2 : 0); x < W + step; x += step) {
                var jx = jitter ? (rnd() - .5) * step * jitter : 0, jy = jitter ? (rnd() - .5) * step * jitter : 0;
                ctx.beginPath(); ctx.arc(x + jx, y + jy, r, 0, Math.PI * 2); ctx.fill();
            }
        }
    }
    function petal(ctx, x, y, s, rot, color) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(0, s * .5); ctx.bezierCurveTo(-s * .6, 0, -s * .4, -s * .55, -s * .1, -s * .5); ctx.lineTo(0, -s * .38); ctx.lineTo(s * .1, -s * .5);
        ctx.bezierCurveTo(s * .4, -s * .55, s * .6, 0, 0, s * .5); ctx.fill(); ctx.restore();
    }

    // ---------------- テンプレート（背景・枠・模様は、ここで描く） ----------------
    // pals … 配色。bg 地 / ink 大きな文字 / sub 小さな文字 / acc acc2 acc3 飾りの色 / onAcc 飾りの上の文字 / price 値段
    // fonts … title 見出し / body 説明 / accent ひとこと・札（[フォント, 太字]）
    // price … 値段の飾り（'circle' 丸 / 'tag' ふだ / 'plain' なし / 'band' 帯）。img … 写真の形
    var TPLS = [
        {
            id: 'natural', label: 'ナチュラル', fonts: { title: ['kiwi', true], body: ['zen', true], accent: ['yusei', false] },
            price: 'tag', img: 'round', stamp: 'circle', titleBox: '', catchBox: 'line', decos: ['sunflower', 'daisy', 'leaf'],
            pals: [
                { bg: '#E9DFCC', paper: '#F8F2E6', ink: '#5A3E2B', sub: '#7A5A44', acc: '#C9605A', acc2: '#E9A23B', acc3: '#7FA36B', onAcc: '#fff', price: '#5A3E2B' },
                { bg: '#E3E3CF', paper: '#F7F6EA', ink: '#3F4A35', sub: '#5E6A50', acc: '#5E8C5A', acc2: '#D9A441', acc3: '#C96B5A', onAcc: '#fff', price: '#3F4A35' },
                { bg: '#DCE3E6', paper: '#F5F7F6', ink: '#33475A', sub: '#56697A', acc: '#4E7EA8', acc2: '#E3A14B', acc3: '#A8676B', onAcc: '#fff', price: '#33475A' }
            ],
            draw: function (ctx, W, H, p, U, rnd) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = .18; dots(ctx, W, H, U * .025, U * .0025, p.sub, rnd, 1.2); ctx.globalAlpha = 1;
                var m = U * .045;
                ctx.fillStyle = p.paper; rr(ctx, m, m, W - 2 * m, H - 2 * m, U * .02); ctx.fill();
                ctx.strokeStyle = p.acc; ctx.lineWidth = U * .005; ctx.lineJoin = 'round';
                wobblyRect(ctx, m + U * .022, m + U * .022, W - 2 * m - U * .044, H - 2 * m - U * .044, U * .006, rnd); ctx.stroke();
                ctx.lineWidth = U * .0028; ctx.globalAlpha = .7;
                wobblyRect(ctx, m + U * .032, m + U * .032, W - 2 * m - U * .064, H - 2 * m - U * .064, U * .006, rnd); ctx.stroke();
                ctx.globalAlpha = 1;
            }
        },
        {
            id: 'pop', label: 'ポップ', fonts: { title: ['mochiy', true], body: ['zen', true], accent: ['mochiy', false] },
            price: 'circle', img: 'round', stamp: 'burst', titleStroke: true, titleBox: '', catchBox: '', decos: ['sparkle', 'star', 'heart'],
            pals: [
                { bg: '#FFFBEF', stripe: '#FFF0B3', ink: '#E2557F', sub: '#5B4A3F', acc: '#3BA3E0', acc2: '#FFC93C', acc3: '#9B6BD3', onAcc: '#fff', price: '#fff', priceBg: '#E2557F' },
                { bg: '#FBFFF4', stripe: '#E3F3D2', ink: '#F07B2C', sub: '#4F4A3A', acc: '#4BB37A', acc2: '#FFD23F', acc3: '#E2557F', onAcc: '#fff', price: '#fff', priceBg: '#F07B2C' },
                { bg: '#FCF8FF', stripe: '#ECE3FA', ink: '#7D4CC2', sub: '#4A4256', acc: '#F2668B', acc2: '#FFC93C', acc3: '#3BA3E0', onAcc: '#fff', price: '#fff', priceBg: '#7D4CC2' }
            ],
            draw: function (ctx, W, H, p, U) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                var sw = U * .06; ctx.fillStyle = p.stripe;
                for (var x = 0; x < W; x += sw * 2) ctx.fillRect(x, 0, sw, H);
                // すみの、ぎざぎざの模様
                ctx.fillStyle = p.acc; burstPath(ctx, 0, 0, U * .26, U * .19, 12, .2); ctx.fill();
                ctx.fillStyle = p.acc2; burstPath(ctx, W, U * .02, U * .2, U * .15, 11, 0); ctx.fill();
                ctx.fillStyle = p.acc3; burstPath(ctx, W - U * .02, H, U * .22, U * .16, 12, .1); ctx.fill();
                ctx.fillStyle = p.acc2; burstPath(ctx, 0, H, U * .16, U * .12, 10, .3); ctx.fill();
                // 文字の下の白い面
                ctx.globalAlpha = .82; ctx.fillStyle = '#fff';
                rr(ctx, U * .07, U * .07, W - U * .14, H - U * .14, U * .08); ctx.fill(); ctx.globalAlpha = 1;
            }
        },
        {
            id: 'elegant', label: '上品', fonts: { title: ['mincho', true], body: ['mincho', false], accent: ['klee', true] },
            price: 'plain', img: 'circle', stamp: 'circle', titleBox: '', catchBox: '', decos: ['wheat'], footBand: true,
            pals: [
                { bg: '#FBF6EF', ink: '#3C2F26', sub: '#6E5E50', acc: '#8C6B4F', acc2: '#CDB89D', acc3: '#E8DCCB', onAcc: '#fff', price: '#3C2F26' },
                { bg: '#F6F7FA', ink: '#22324A', sub: '#56637A', acc: '#2F4A6E', acc2: '#B9C4D4', acc3: '#E0E6EF', onAcc: '#fff', price: '#22324A' },
                { bg: '#F6F8F2', ink: '#2F3D2E', sub: '#5A6A57', acc: '#55704F', acc2: '#C3CDB8', acc3: '#E3E9DC', onAcc: '#fff', price: '#2F3D2E' }
            ],
            draw: function (ctx, W, H, p, U) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                var m = U * .04;
                ctx.strokeStyle = p.acc2; ctx.lineWidth = U * .003; ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
                // すみの斜めの線
                var t = U * .05; ctx.strokeStyle = p.acc; ctx.lineWidth = U * .004; ctx.lineCap = 'round';
                [[m + t * .2, m + t * 1.2, m + t * 1.2, m + t * .2], [W - m - t * .2, m + t * 1.2, W - m - t * 1.2, m + t * .2], [m + t * .2, H - m - t * 1.2, m + t * 1.2, H - m - t * .2], [W - m - t * .2, H - m - t * 1.2, W - m - t * 1.2, H - m - t * .2]].forEach(function (l) { ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke(); });
                // 下の帯
                ctx.fillStyle = p.acc; ctx.fillRect(0, H * .93, W, H * .07);
            }
        },
        {
            id: 'chalk', label: '黒板', fonts: { title: ['yusei', false], body: ['klee', true], accent: ['yusei', false] },
            price: 'circle', img: 'round', stamp: 'circle', titleBox: '', catchBox: 'line', decos: ['star', 'sparkle'],
            pals: [
                { bg: '#2F4A3A', wood: '#A9774A', ink: '#F7F3E8', sub: '#DCE8DC', acc: '#F6D365', acc2: '#F29CB0', acc3: '#9AD0EC', onAcc: '#2F4A3A', price: '#2F4A3A', priceBg: '#F6D365' },
                { bg: '#2B2F33', wood: '#8A6A4A', ink: '#F4F4F0', sub: '#D7D9DC', acc: '#F29CB0', acc2: '#F6D365', acc3: '#9AD0EC', onAcc: '#2B2F33', price: '#2B2F33', priceBg: '#F29CB0' },
                { bg: '#33496A', wood: '#B08356', ink: '#F5F7FA', sub: '#D9E1EC', acc: '#F6D365', acc2: '#9AD0EC', acc3: '#F29CB0', onAcc: '#33496A', price: '#33496A', priceBg: '#F6D365' }
            ],
            draw: function (ctx, W, H, p, U, rnd) {
                ctx.fillStyle = p.wood; ctx.fillRect(0, 0, W, H);
                ctx.strokeStyle = 'rgba(60,35,15,.25)'; ctx.lineWidth = U * .003;
                for (var i = 0; i < 26; i++) { var y = rnd() * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(W * .3, y + (rnd() - .5) * U * .03, W * .7, y + (rnd() - .5) * U * .03, W, y); ctx.stroke(); }
                var m = U * .045;
                ctx.fillStyle = p.bg; rr(ctx, m, m, W - 2 * m, H - 2 * m, U * .01); ctx.fill();
                // チョークでこすったあと
                for (var k = 0; k < 14; k++) { ctx.globalAlpha = .035 + rnd() * .035; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(m + rnd() * (W - 2 * m), m + rnd() * (H - 2 * m), U * (.08 + rnd() * .18), U * (.03 + rnd() * .05), rnd() * Math.PI, 0, Math.PI * 2); ctx.fill(); }
                ctx.globalAlpha = 1;
            }
        },
        {
            id: 'cafe', label: 'カフェ', fonts: { title: ['rnr', false], body: ['zen', true], accent: ['kiwi', true] },
            price: 'band', img: 'round', stamp: 'tag', titleBox: '', catchBox: '', decos: ['cup', 'wheat'],
            pals: [
                { bg: '#F6EEE3', dot: '#EADBC8', ink: '#4A3426', sub: '#6E5644', acc: '#6B4A35', acc2: '#D9A066', acc3: '#B5835A', onAcc: '#FFF7EC', price: '#FFF7EC', priceBg: '#6B4A35' },
                { bg: '#EEF2EC', dot: '#DCE5D8', ink: '#24433A', sub: '#4E665C', acc: '#2F5D50', acc2: '#E3B04B', acc3: '#9C7A55', onAcc: '#F4F8F2', price: '#F4F8F2', priceBg: '#2F5D50' },
                { bg: '#F7EDEA', dot: '#ECDAD4', ink: '#5A2A2A', sub: '#7A5050', acc: '#8A3B3B', acc2: '#E7B75F', acc3: '#B57A5A', onAcc: '#FFF4EE', price: '#FFF4EE', priceBg: '#8A3B3B' }
            ],
            draw: function (ctx, W, H, p, U, rnd) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                dots(ctx, W, H, U * .07, U * .012, p.dot, rnd, 0);
                // 上と下の、ふちがなみなみの帯
                var bh = U * .055, r = U * .022;
                ctx.fillStyle = p.acc;
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, bh);
                for (var x = W; x > 0; x -= r * 2) ctx.arc(x - r, bh, r, 0, Math.PI, false);
                ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.lineTo(W, H - bh);
                for (var x2 = W; x2 > 0; x2 -= r * 2) ctx.arc(x2 - r, H - bh, r, 0, Math.PI, true);
                ctx.closePath(); ctx.fill();
            }
        },
        {
            id: 'spring', label: '春・桜', fonts: { title: ['kiwi', true], body: ['zen', true], accent: ['hachi', false] },
            price: 'circle', img: 'circle', stamp: 'bubble', titleBox: '', catchBox: '', decos: ['sakura', 'sakura', 'clover'],
            pals: [
                { bg: '#FFF5F7', ink: '#B9466C', sub: '#7A5560', acc: '#F28DAA', acc2: '#9CCB86', acc3: '#FFD27A', onAcc: '#fff', price: '#fff', priceBg: '#F28DAA', petal: '#F9C4D2' },
                { bg: '#F6FBF1', ink: '#4F7A3A', sub: '#5E6B55', acc: '#8CC07A', acc2: '#F5A3BC', acc3: '#FFD27A', onAcc: '#fff', price: '#fff', priceBg: '#7FB46C', petal: '#F9D3DE' }
            ],
            draw: function (ctx, W, H, p, U, rnd) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = .14; ctx.fillStyle = p.acc;
                ctx.beginPath(); ctx.arc(W * .1, H * .12, U * .3, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(W * .95, H * .85, U * .34, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = .9;
                for (var i = 0; i < 26; i++) { var x = rnd() * W, y = rnd() * H; if (x > W * .12 && x < W * .88 && y > H * .12 && y < H * .88) continue; petal(ctx, x, y, U * (.025 + rnd() * .025), rnd() * Math.PI * 2, p.petal); }
                ctx.globalAlpha = 1;
            }
        },
        {
            id: 'autumn', label: '秋・ハロウィン', fonts: { title: ['yusei', false], body: ['zen', true], accent: ['mochiy', false] },
            price: 'tag', img: 'round', stamp: 'ribbon', titleBox: '', catchBox: 'band', decos: ['maple', 'ginkgo', 'pumpkin'],
            pals: [
                { bg: '#ECE5D9', ink: '#3F342A', sub: '#62574A', acc: '#E8792B', acc2: '#7B4FA0', acc3: '#F2B92B', onAcc: '#fff', price: '#3F342A' },
                { bg: '#F2EADC', ink: '#4A2F20', sub: '#6E5545', acc: '#B5532B', acc2: '#C99A2E', acc3: '#6E8B3D', onAcc: '#fff', price: '#4A2F20' }
            ],
            draw: function (ctx, W, H, p, U, rnd) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = .12; ctx.fillStyle = p.acc;
                ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - U * .45); ctx.quadraticCurveTo(W * .35, H - U * .2, W * .6, H); ctx.closePath(); ctx.fill();
                ctx.fillStyle = p.acc2;
                ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, U * .35); ctx.quadraticCurveTo(W * .7, U * .18, W * .55, 0); ctx.closePath(); ctx.fill();
                ctx.globalAlpha = .25; dots(ctx, W, H, U * .05, U * .004, p.sub, rnd, .6); ctx.globalAlpha = 1;
            }
        },
        {
            id: 'winter', label: '冬・クリスマス', fonts: { title: ['zen', true], body: ['zen', true], accent: ['mochiy', false] },
            price: 'circle', img: 'round', stamp: 'ribbon', titleBox: '', catchBox: '', decos: ['holly', 'snow', 'ornament'],
            pals: [
                { bg: '#FBF7EE', ink: '#1F3B4D', sub: '#4A5E6B', acc: '#C8323F', acc2: '#2E7D4F', acc3: '#E5B53B', onAcc: '#fff', price: '#fff', priceBg: '#C8323F', snow: '#C9DDEB' },
                { bg: '#EEF5FB', ink: '#24466E', sub: '#4E6684', acc: '#3E7CC2', acc2: '#7DB3E0', acc3: '#E5B53B', onAcc: '#fff', price: '#fff', priceBg: '#3E7CC2', snow: '#FFFFFF' }
            ],
            draw: function (ctx, W, H, p, U, rnd) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                ctx.fillStyle = p.snow;
                for (var i = 0; i < 70; i++) { ctx.globalAlpha = .5 + rnd() * .5; ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, U * (.004 + rnd() * .008), 0, Math.PI * 2); ctx.fill(); }
                ctx.globalAlpha = 1;
                // 下の、しましまのリボン
                var bh = U * .03, y0 = H - bh;
                ctx.fillStyle = '#fff'; ctx.fillRect(0, y0, W, bh);
                ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, bh); ctx.clip(); ctx.fillStyle = p.acc;
                for (var x = -bh; x < W + bh; x += bh * 1.6) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + bh * .8, H); ctx.lineTo(x + bh * 1.8, y0); ctx.lineTo(x + bh, y0); ctx.closePath(); ctx.fill(); }
                ctx.restore();
            }
        },
        {
            id: 'simple', label: 'シンプル', fonts: { title: ['zen', true], body: ['zen', true], accent: ['zen', true] },
            price: 'plain', img: 'round', stamp: 'tag', titleBox: '', catchBox: '', decos: [],
            pals: [
                { bg: '#FFFFFF', ink: '#222222', sub: '#555555', acc: '#E85A4F', acc2: '#F2C14E', acc3: '#2F6DB5', onAcc: '#fff', price: '#E85A4F' },
                { bg: '#FFFFFF', ink: '#111111', sub: '#444444', acc: '#222222', acc2: '#888888', acc3: '#555555', onAcc: '#fff', price: '#111111' },
                { bg: '#FFFFFF', ink: '#1F2E44', sub: '#4A5568', acc: '#2F6DB5', acc2: '#F2C14E', acc3: '#E85A4F', onAcc: '#fff', price: '#2F6DB5' }
            ],
            draw: function (ctx, W, H, p, U) {
                ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
                ctx.fillStyle = p.acc; ctx.fillRect(0, 0, W, U * .03);
                ctx.fillRect(U * .05, H - U * .05, W - U * .1, U * .004);
            }
        }
    ];
    var TPL_BY = {};
    TPLS.forEach(function (t) { TPL_BY[t.id] = t; });
    function tplOf(d) { return TPL_BY[d.tpl] || TPLS[0]; }
    function palOf(d) { var t = tplOf(d); return t.pals[d.pal % t.pals.length] || t.pals[0]; }

    // ---------------- 端末から読み込んだ画像（この端末の IndexedDB にしまう。localStorage には入れない） ----------------
    // 1つの記録：{ id, kind: 'photo'（写真）|'cut'（背景を消した物）|'bg'（背景）, blob, w, h, at }
    var IDBP = null, USERURL = {}, USERP = {};
    function idb() {
        if (IDBP) return IDBP;
        IDBP = new Promise(function (res, rej) {
            if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
            var r = indexedDB.open(A.key('taizanboku_pop_img'), 1);
            r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('img')) r.result.createObjectStore('img', { keyPath: 'id' }); };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
        });
        IDBP.catch(function () { IDBP = null; });
        return IDBP;
    }
    function idbTx(mode, fn) {
        return idb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction('img', mode), req = fn(tx.objectStore('img'));
                tx.oncomplete = function () { res(req ? req.result : undefined); };
                tx.onerror = function () { rej(tx.error); };
                tx.onabort = function () { rej(tx.error || new Error('abort')); };
            });
        });
    }
    function userPut(rec) { return idbTx('readwrite', function (st) { return st.put(rec); }); }
    function userGet(id) { return idbTx('readonly', function (st) { return st.get(id); }); }
    function userAll() { return idbTx('readonly', function (st) { return st.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return b.at - a.at; }); }); }
    function userDel(id) {
        if (USERURL[id]) { try { URL.revokeObjectURL(USERURL[id]); } catch (e) {} delete USERURL[id]; }
        delete USERP[id]; delete IMG['user:' + id];
        return idbTx('readwrite', function (st) { return st.delete(id); });
    }
    function loadUser(id) {
        if (USERURL[id]) return Promise.resolve(USERURL[id]);
        if (!USERP[id]) USERP[id] = userGet(id).then(function (r) {
            if (r && r.blob) { USERURL[id] = URL.createObjectURL(r.blob); drawSoon(); drawTplThumbsSoon(); }
            return USERURL[id] || '';
        }).catch(function () { return ''; });
        return USERP[id];
    }
    // 端末の画像を読み、長い辺を maxSide までに小さくする（大きいままだと、しまう場所と描く時間をとるため）
    function fileToImage(file) {
        return new Promise(function (res, rej) {
            var u = URL.createObjectURL(file), im = new Image();
            im.onload = function () { res(im); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
            im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('この画像は読み込めませんでした')); };
            im.src = u;
        });
    }
    function scaledCanvas(im, maxSide, white) {
        var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(1, maxSide / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        var x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        if (white) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }   // JPEG は透けた所が黒くなるので、白を敷く
        x.drawImage(im, 0, 0, c.width, c.height);
        return c;
    }
    function saveUserImage(c, kind, type) {
        return new Promise(function (res) { c.toBlob(function (b) { res(b); }, type || 'image/jpeg', .88); }).then(function (b) {
            if (!b) throw new Error('画像を作れませんでした');
            var rec = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: kind, blob: b, w: c.width, h: c.height, at: Date.now() };
            return userPut(rec).then(function () { USERURL[rec.id] = URL.createObjectURL(b); return rec; });
        });
    }
    function pickFile(cb) {
        var i = document.createElement('input');
        i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none';
        i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (f) cb(f); };
        i.addEventListener('cancel', function () { i.remove(); });
        document.body.appendChild(i);
        i.click();
    }

    // ---------------- 絵の読み込み（読めたら描き直す） ----------------
    var IMG = {};
    function imgSrcUrl(src) {
        if (!src) return '';
        if (src.indexOf('user:') === 0) { var uu = USERURL[src.slice(5)]; if (!uu) loadUser(src.slice(5)); return uu || ''; }
        if (src.indexOf('deco:') === 0) { var s = decoSvg(src.slice(5)); return s ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s) : ''; }
        if (src.indexOf('art:') === 0) { var a = window.MENU_ART && MENU_ART.has(src.slice(4)) ? MENU_ART.svg(src.slice(4)).replace('<svg ', '<svg width="200" height="200" ') : ''; return a ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a) : ''; }
        if (src.indexOf('photo:') === 0) return A ? photoUrl(src.slice(6)) : '';
        return '';
    }
    // 商品の写真：印刷用の大きい控えがあればそれを、まだ無ければ小さい写真を使い、控えを取りに行く（届いたら描き直す）
    var HQASK = {};
    function photoUrl(name) {
        var hq = A.photoHQNow ? A.photoHQNow(name) : '';
        if (hq) return hq;
        if (A.photoHQ && !HQASK[name]) {
            HQASK[name] = 1;
            A.photoHQ(name).then(function (u) { if (u) { drawSoon(); drawTplThumbsSoon(); } else setTimeout(function () { delete HQASK[name]; }, 60000); }, function () { delete HQASK[name]; });
        }
        return A.photo(name);
    }
    function getImg(src) {
        var url = imgSrcUrl(src);
        if (!url) return null;
        var c = IMG[src];
        if (c && c.url === url) return c.ok ? c.img : null;
        var im = new Image();
        c = IMG[src] = { url: url, img: im, ok: false, p: null };
        c.p = new Promise(function (res) {
            im.onload = function () { c.ok = true; drawSoon(); drawTplThumbsSoon(); res(); };
            im.onerror = function () { c.ok = false; res(); };
        });
        im.src = url;
        return null;
    }
    function loadImgsFor(d) {
        var srcs = (d.els || []).filter(function (e) { return e.t === 'img'; }).map(function (e) { return e.src; });
        if (d.bg && d.bg.src) srcs.push(d.bg.src);
        var ps = srcs.map(function (src) {
            var pre = src.indexOf('user:') === 0 ? loadUser(src.slice(5))
                : (src.indexOf('photo:') === 0 && A.photoHQ) ? A.photoHQ(src.slice(6)).catch(function () {}) : Promise.resolve();
            return pre.then(function () { getImg(src); var c = IMG[src]; return c && c.p; });
        });
        return Promise.race([Promise.all(ps), new Promise(function (r) { setTimeout(r, 6000); })]);
    }

    // ---------------- 色・フォントの決め方（テンプレートに合わせる／自分で決めた物はそのまま） ----------------
    function col(d, e, keyName, valName) {
        var k = e[keyName];
        if (k) { var p = palOf(d); return p[k] || p.ink; }
        return e[valName] || '';
    }
    function resolveFont(d, e) { if (e.fk) { var f = tplOf(d).fonts[e.fk]; return f ? f[0] : 'zen'; } return e.font || 'zen'; }
    function resolveBold(d, e) { if (e.fk && e.bold == null) { var f = tplOf(d).fonts[e.fk]; return f ? f[1] : true; } return e.bold !== false; }
    function elText(e) {
        if (e.t === 'text' || e.t === 'stamp') return e.text || '';
        if (e.t === 'menu') return (e.title || '') + (e.items || []).map(function (x) { return x.n + priceShort(x.p); }).join('');
        return '';
    }
    function priceShort(p) { return '¥' + Math.round(Number(p) || 0).toLocaleString('ja-JP'); }

    // ---------------- 日本語の折り返し（行頭・行末の禁則つき。英数字の言葉は切らない） ----------------
    var NO_START = '、。，．,.・：；？！!?)）」』】〕〉》ー〜～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞ';
    var NO_END = '（(「『【〔〈《';
    function tokens(s) { return String(s).match(/[A-Za-z0-9¥$%.,'’\-+&@#/]+|[\s\S]/g) || []; }
    function wrap(ctx, text, maxW) {
        var out = [];
        String(text || '').split('\n').forEach(function (para) {
            var toks = tokens(para), line = '';
            for (var i = 0; i < toks.length; i++) {
                var t = toks[i], next = line + t;
                if (!line || ctx.measureText(next).width <= maxW) { line = next; continue; }
                if (NO_START.indexOf(t) >= 0) { line = next; continue; }   // ぶら下げ（。、を行の頭にしない）
                var carry = '';
                if (NO_END.indexOf(line.slice(-1)) >= 0 && line.length > 1) { carry = line.slice(-1); line = line.slice(0, -1); }
                out.push(line.replace(/\s+$/, ''));
                line = (carry + t).replace(/^\s+/, '');
            }
            out.push(line);
        });
        return out;
    }

    // ---------------- 1つの要素を描く ----------------
    // 位置は (x, y) が要素の中心（0〜1：画面の幅・高さに対する割合）。大きさ U は短い辺の長さ
    function drawEl(ctx, d, e, W, H, U, rec) {
        ctx.save();
        var cx = e.x * W, cy = (e._y != null ? e._y : e.y) * H;
        ctx.translate(cx, cy);
        if (e.rot) ctx.rotate(e.rot * Math.PI / 180);
        if (e.op != null && e.op < 1) ctx.globalAlpha = Math.max(.05, e.op);
        if (e.flip && e.t === 'img') ctx.scale(-1, 1);
        // 影（文字・画像・スタンプの下に、やわらかい影）
        if (e.shadow) { ctx.shadowColor = 'rgba(0,0,0,.32)'; ctx.shadowBlur = U * .018; ctx.shadowOffsetY = U * .007; }
        var box = null;
        if (e.t === 'text') box = drawText(ctx, d, e, W, H, U);
        else if (e.t === 'img') box = drawImg(ctx, d, e, W, H, U);
        else if (e.t === 'stamp') box = drawStamp(ctx, d, e, W, H, U);
        else if (e.t === 'menu') box = drawMenu(ctx, d, e, W, H, U);
        else if (e.t === 'qr') box = drawQr(ctx, d, e, W, H, U);
        else if (e.t === 'box') box = drawCard(ctx, d, e, W, H, U);
        ctx.restore();
        if (box && rec) rec.push({ id: e.id, lock: !!e.lock, cx: cx, cy: cy, rot: e.rot || 0, x0: box[0], y0: box[1], x1: box[2], y1: box[3] });
    }
    function textLayout(ctx, d, e, W, H, U) {
        var fid = resolveFont(d, e), bold = resolveBold(d, e);
        var px = (e.size || .06) * U * (e._k || 1), maxW = (e.w || .8) * (e.vert ? H : W), lines, guard = 0;
        var maxLines = e.max || 0;
        for (;;) {
            ctx.font = fontStr(fid, bold, px);
            if (e.vert) { lines = vwrap(String(e.text || ''), maxW, px); }
            else {
                lines = wrap(ctx, e.text || '', maxW);
                if (lines.length > 1 && (e.align || 'center') === 'center' && e.balance !== false) {
                    // 同じ行数のまま、いちばん狭い幅を探す
                    var lo = maxW * .4, hi = maxW, n0 = lines.length;
                    for (var it = 0; it < 12; it++) { var mid = (lo + hi) / 2; if (wrap(ctx, e.text || '', mid).length > n0) lo = mid; else hi = mid; }
                    lines = wrap(ctx, e.text || '', hi + 1);
                }
            }
            var tooMany = maxLines && lines.length > maxLines;
            var tooWide = !e.vert && lines.some(function (l) { return ctx.measureText(l).width > maxW * 1.04; });
            if ((!tooMany && !tooWide) || guard++ > 40 || px < (e.size || .06) * U * .35) break;
            px *= .94;
        }
        return { fid: fid, bold: bold, px: px, lines: lines, maxW: maxW };
    }
    // 縦書き：1列に入る文字数で区切る
    function vwrap(text, maxH, px) {
        var per = Math.max(1, Math.floor(maxH / px)), out = [];
        text.split('\n').forEach(function (para) {
            var chars = Array.from(para);
            if (!chars.length) { out.push(''); return; }
            for (var i = 0; i < chars.length; i += per) {
                var col = chars.slice(i, i + per);
                // 次の列の頭が「。、」なら、この列に入れる
                if (i + per < chars.length && NO_START.indexOf(chars[i + per]) >= 0) { col.push(chars[i + per]); i++; }
                out.push(col.join(''));
            }
        });
        return out;
    }
    var V_ROT = 'ー－―‐〜～…‥（）「」『』【】〔〕()[]-=＝→←〈〉《》:：';
    var V_SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
    function drawText(ctx, d, e, W, H, U) {
        var L = textLayout(ctx, d, e, W, H, U), px = L.px, lh = e.lh || 1.28;
        var color = col(d, e, 'ck', 'color') || '#222', boxC = col(d, e, 'bk', 'boxColor'), strokeC = col(d, e, 'sk', 'stroke');
        ctx.font = fontStr(L.fid, L.bold, px);
        ctx.textBaseline = 'middle';
        var bw, bh, x0, y0;
        if (e.vert) {
            var cols = L.lines.length, colW = px * lh;
            var maxLen = L.lines.reduce(function (a, l) { return Math.max(a, Array.from(l).length); }, 0);
            bw = cols * colW; bh = maxLen * px;
            x0 = -bw / 2; y0 = -bh / 2;
            drawBoxStyle(ctx, e.box, boxC, x0, y0, bw, bh, px, U);
            ctx.textAlign = 'center';
            L.lines.forEach(function (l, ci) {
                var colX = bw / 2 - colW * (ci + .5);
                Array.from(l).forEach(function (ch, k) {
                    var cy = y0 + px * (k + .5);
                    ctx.save(); ctx.translate(colX, cy);
                    if (V_ROT.indexOf(ch) >= 0) ctx.rotate(Math.PI / 2);
                    else if ('、。，．'.indexOf(ch) >= 0) ctx.translate(px * .32, -px * .32);
                    else if (V_SMALL.indexOf(ch) >= 0) ctx.translate(px * .08, -px * .08);
                    if (strokeC) { ctx.lineJoin = 'round'; ctx.lineWidth = px * (e.sw || .2); ctx.strokeStyle = strokeC; ctx.strokeText(ch, 0, 0); }
                    ctx.fillStyle = color; ctx.fillText(ch, 0, 0);
                    ctx.restore();
                });
            });
            return [x0 - px * .2, y0 - px * .2, x0 + bw + px * .2, y0 + bh + px * .2];
        }
        var widths = L.lines.map(function (l) { return ctx.measureText(l).width; });
        var tw = Math.max.apply(null, widths.concat([px * .5]));
        bh = L.lines.length * px * lh;
        y0 = -bh / 2;
        var al = e.align || 'center';
        var bx = al === 'left' ? -L.maxW / 2 : (al === 'right' ? L.maxW / 2 - tw : -tw / 2);
        drawBoxStyle(ctx, e.box, boxC, bx, y0, tw, bh, px, U, widths, al, L.maxW, lh);
        ctx.textAlign = al;
        var ax = al === 'left' ? -L.maxW / 2 : (al === 'right' ? L.maxW / 2 : 0);
        L.lines.forEach(function (l, i) {
            var y = y0 + px * lh * (i + .5);
            if (e.shadow) { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillText(l, ax + px * .05, y + px * .06); }
            if (strokeC) { ctx.lineJoin = 'round'; ctx.lineWidth = px * (e.sw || .2); ctx.strokeStyle = strokeC; ctx.strokeText(l, ax, y); }
            ctx.fillStyle = color; ctx.fillText(l, ax, y);
        });
        var pad = e.box ? px * .5 : px * .15;
        return [bx - pad, y0 - pad, bx + tw + pad, y0 + bh + pad];
    }
    // 文字の下の飾り（帯・まる・吹き出し・テープ・下線）
    function drawBoxStyle(ctx, kind, c, x, y, w, h, px, U, widths, al, maxW, lh) {
        if (!kind || !c) return;
        var p = px * .45;
        ctx.save();
        ctx.fillStyle = c;
        if (kind === 'band') { rr(ctx, x - p * 1.4, y - p * .6, w + p * 2.8, h + p * 1.2, px * .18); ctx.fill(); }
        else if (kind === 'round') { rr(ctx, x - p * 1.6, y - p, w + p * 3.2, h + p * 2, (h + p * 2) / 2); ctx.fill(); }
        else if (kind === 'circle') { var r = Math.max(w, h) / 2 + p * .9; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.fill(); }
        else if (kind === 'bubble') {
            var bx = x - p * 1.6, by = y - p * 1.1, bw = w + p * 3.2, bh = h + p * 2.2;
            rr(ctx, bx, by, bw, bh, px * .6); ctx.fill();
            ctx.beginPath(); ctx.moveTo(bx + bw * .2, by + bh - 1); ctx.lineTo(bx + bw * .12, by + bh + px * .7); ctx.lineTo(bx + bw * .34, by + bh - 1); ctx.closePath(); ctx.fill();
        } else if (kind === 'tape') {
            ctx.globalAlpha = .85;
            var tx = x - p * 2, ty = y - p * .5, tw = w + p * 4, th = h + p, z = Math.min(px * .25, th / 6);
            ctx.beginPath(); ctx.moveTo(tx, ty);
            for (var i = 0; i < 6; i++) ctx.lineTo(tx + (i % 2 ? 0 : z), ty + th * (i + 1) / 6);
            ctx.lineTo(tx + tw, ty + th);
            for (var j = 0; j < 6; j++) ctx.lineTo(tx + tw - (j % 2 ? 0 : z), ty + th - th * (j + 1) / 6);
            ctx.closePath(); ctx.fill();
        } else if (kind === 'line' && widths) {
            ctx.globalAlpha = .55;
            widths.forEach(function (lw, i) {
                var lx = al === 'left' ? -maxW / 2 : (al === 'right' ? maxW / 2 - lw : -lw / 2);
                var ly = y + px * lh * (i + .5) + px * .12;
                rr(ctx, lx - px * .1, ly, lw + px * .2, px * .38, px * .15); ctx.fill();
            });
        }
        ctx.restore();
    }
    function drawImg(ctx, d, e, W, H, U) {
        var w = (e.w || .3) * W, im = getImg(e.src);
        var isPhoto = /^(photo|user):/.test(e.src || '');
        var ar = (e.shape === 'round' || e.shape === 'circle') ? (e.far || .78) : (e.ar || (e.shape === 'round' && isPhoto ? .78 : 1));
        var h = w * ar;
        if (!im) { ctx.globalAlpha = .08; ctx.fillStyle = '#000'; rr(ctx, -w / 2, -h / 2, w, h, w * .1); ctx.fill(); ctx.globalAlpha = 1; return [-w / 2, -h / 2, w / 2, h / 2]; }
        var shape = e.shape || (isPhoto ? 'round' : 'plain');
        if (shape === 'plain') {
            // 絵は縦横の比を保って、枠いっぱいに
            var iw = im.naturalWidth || 100, ih = im.naturalHeight || 100, sc = Math.min(w / iw, h / ih);
            if (e.outline > 0) {
                // まわりの白いふち（シール風）：形をぬりつぶした物を、まわりに少しずつずらして重ねる
                var sil = silhouette(e.src, im, e.outlineC || '#FFFFFF'), r0 = e.outline * w * .045;
                for (var a = 0; a < 16; a++) { var an = a * Math.PI / 8; ctx.drawImage(sil, -iw * sc / 2 + Math.cos(an) * r0, -ih * sc / 2 + Math.sin(an) * r0, iw * sc, ih * sc); }
                ctx.shadowColor = 'transparent';
            }
            ctx.drawImage(im, -iw * sc / 2, -ih * sc / 2, iw * sc, ih * sc);
            return [-w / 2, -h / 2, w / 2, h / 2];
        }
        if (shape === 'circle') h = w;
        ctx.save();
        if (shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); } else rr(ctx, -w / 2, -h / 2, w, h, w * .08);
        // 背景の色（透けた絵のため）
        var bgc = col(d, e, 'bk', 'boxColor');
        if (bgc) { ctx.fillStyle = bgc; ctx.fill(); }
        ctx.clip();
        var iw2 = im.naturalWidth || 100, ih2 = im.naturalHeight || 100;
        var sc2 = isPhoto ? Math.max(w / iw2, h / ih2) * Math.max(1, e.zoom || 1) : Math.min(w / iw2, h / ih2) * .9;
        var dw2 = iw2 * sc2, dh2 = ih2 * sc2;
        // 枠の中で、写真のどこを見せるか（-1〜1）
        var ox = isPhoto ? (e.px || 0) * (dw2 - w) / 2 : 0, oy = isPhoto ? (e.py || 0) * (dh2 - h) / 2 : 0;
        ctx.drawImage(im, -dw2 / 2 - ox, -dh2 / 2 - oy, dw2, dh2);
        ctx.restore();
        var bc = col(d, e, 'ek', 'border');
        if (bc) {
            ctx.lineWidth = U * .008; ctx.strokeStyle = bc;
            if (shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.stroke(); } else { rr(ctx, -w / 2, -h / 2, w, h, w * .08); ctx.stroke(); }
        }
        return [-w / 2, -h / 2, w / 2, h / 2];
    }
    // 画像の形だけを、ひとつの色でぬった物（白いふちに使う。画像ごとに一度だけ作る）
    var SIL = {};
    function silhouette(src, im, color) {
        var k = src + '|' + color, c = SIL[k];
        if (c && c.im === im) return c.cv;
        var cv = document.createElement('canvas'), iw = im.naturalWidth || 100, ih = im.naturalHeight || 100, kk = Math.min(1, 800 / Math.max(iw, ih));
        cv.width = Math.max(1, Math.round(iw * kk)); cv.height = Math.max(1, Math.round(ih * kk));
        var x = cv.getContext('2d'); x.drawImage(im, 0, 0, cv.width, cv.height);
        x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, cv.width, cv.height);
        SIL[k] = { im: im, cv: cv };
        return cv;
    }
    function drawStamp(ctx, d, e, W, H, U) {
        var s = (e.w || .16) * W, c = col(d, e, 'ck', 'color') || '#E2557F', ink = col(d, e, 'ik', 'ink') || '#fff';
        var st = e.style || 'burst', bw = s, bh = s, r = s / 2;
        ctx.fillStyle = c;
        if (st === 'burst') { burstPath(ctx, 0, 0, r, r * .84, 16, 0); ctx.fill(); }
        else if (st === 'circle') {
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = ink; ctx.lineWidth = s * .018; ctx.setLineDash([s * .04, s * .03]); ctx.beginPath(); ctx.arc(0, 0, r * .86, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        } else if (st === 'ribbon') {
            bh = s * .34;
            var t = bh * .5;
            ctx.beginPath(); ctx.moveTo(-bw / 2 - t, -bh / 2 + bh * .25); ctx.lineTo(-bw / 2 + t * .4, -bh / 2 + bh * .25); ctx.lineTo(-bw / 2 + t * .4, bh / 2 + bh * .25); ctx.lineTo(-bw / 2 - t, bh / 2 + bh * .25); ctx.lineTo(-bw / 2 - t * .5, bh * .25); ctx.closePath();
            ctx.moveTo(bw / 2 + t, -bh / 2 + bh * .25); ctx.lineTo(bw / 2 - t * .4, -bh / 2 + bh * .25); ctx.lineTo(bw / 2 - t * .4, bh / 2 + bh * .25); ctx.lineTo(bw / 2 + t, bh / 2 + bh * .25); ctx.lineTo(bw / 2 + t * .5, bh * .25); ctx.closePath();
            ctx.globalAlpha = .8; ctx.fill(); ctx.globalAlpha = 1;
            ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        } else if (st === 'tag') { bh = s * .36; rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill(); }
        else if (st === 'bubble') {
            bh = s * .62;
            ctx.beginPath(); ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-bw * .12, bh * .4); ctx.lineTo(-bw * .3, bh * .7); ctx.lineTo(bw * .04, bh * .45); ctx.closePath(); ctx.fill();
        }
        // 文字（入る大きさまで小さくする）
        var fid = resolveFont(d, e), bold = resolveBold(d, e);
        var room = st === 'burst' || st === 'circle' ? r * 1.25 : (st === 'bubble' ? bw * .72 : bw * .86);
        var roomH = st === 'burst' || st === 'circle' ? r * 1.1 : bh * .78;
        var px = st === 'burst' || st === 'circle' ? s * .2 : bh * .56, lines;
        for (var g = 0; g < 40; g++) {
            ctx.font = fontStr(fid, bold, px);
            lines = wrap(ctx, e.text || '', room);
            var wOk = lines.every(function (l) { return ctx.measureText(l).width <= room * 1.02; });
            if (wOk && lines.length * px * 1.12 <= roomH) break;
            px *= .93;
        }
        ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        lines.forEach(function (l, i) { ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * px * 1.12); });
        return [-bw / 2 - (st === 'ribbon' ? bh * .5 : 0), -bh / 2, bw / 2 + (st === 'ribbon' ? bh * .5 : 0), bh / 2 + (st === 'ribbon' ? bh * .25 : 0)];
    }
    // メニューの一覧（名前 …… 値段）。入りきらない時は文字を小さくする
    function drawMenu(ctx, d, e, W, H, U) {
        var w = (e.w || .84) * W, h = (e.h || .2) * H, items = e.items || [];
        var fid = resolveFont(d, e), bold = resolveBold(d, e), color = col(d, e, 'ck', 'color') || '#333', sub = col(d, e, 'pk', 'subColor') || color;
        var gap = w * .05, lh = 1.5;
        var fitPx = function (cols) {
            var rows = Math.max(1, Math.ceil(items.length / cols)), cw = (w - gap * (cols - 1)) / cols, px = (e.size || .03) * U;
            for (var g = 0; g < 40; g++) {
                ctx.font = fontStr(fid, bold, px);
                var fits = rows * px * lh <= h && items.every(function (x) { return ctx.measureText(x.n).width + ctx.measureText(priceShort(x.p)).width + px * 1.2 <= cw; });
                if (fits || px < U * .008) break;
                px *= .94;
            }
            return px;
        };
        // 列の数：決めてある時はその数。autoCols の時は、文字がいちばん大きくなる列の数を選ぶ
        var cols = e.cols || (items.length > 8 ? 2 : 1);
        if (e.autoCols && !e.colsSet) { var best = 0; [1, 2, 3].forEach(function (c) { var q = fitPx(c); if (q > best * 1.02) { best = q; cols = c; } }); }
        var rows = Math.max(1, Math.ceil(items.length / cols)), cw = (w - gap * (cols - 1)) / cols;
        var px = fitPx(cols);
        ctx.font = fontStr(fid, bold, px);
        ctx.textBaseline = 'middle';
        var top = -h / 2 + Math.max(0, (h - rows * px * lh) / (e.autoCols ? 6 : 2));
        items.forEach(function (x, i) {
            var c = Math.floor(i / rows), r = i % rows;
            var lx = -w / 2 + c * (cw + gap), y = top + px * lh * (r + .5);
            var pr = priceShort(x.p), pw = ctx.measureText(pr).width, nw = ctx.measureText(x.n).width;
            ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(x.n, lx, y);
            ctx.fillStyle = sub; ctx.textAlign = 'right'; ctx.fillText(pr, lx + cw, y);
            // 点線でつなぐ
            var a = lx + nw + px * .4, b = lx + cw - pw - px * .4;
            if (b - a > px) { ctx.globalAlpha = .45; ctx.fillStyle = sub; for (var dx = a; dx < b; dx += px * .45) { ctx.beginPath(); ctx.arc(dx, y + px * .12, px * .06, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
        });
        return [-w / 2, -h / 2, w / 2, h / 2];
    }
    // 商品ごとの台紙（おすすめ商品のポスター）。テンプレートの紙の色を、少しすかして敷く
    function drawCard(ctx, d, e, W, H, U) {
        var w = (e.w || .4) * W, h = (e.h || .3) * H, p = palOf(d);
        var darkTpl = relLum(rgbOf(p.ink || '#222')) > .45;
        ctx.save();
        ctx.fillStyle = e.color || (darkTpl ? 'rgba(255,255,255,.09)' : (p.paper || '#FFFFFF'));
        ctx.globalAlpha *= darkTpl ? 1 : .88;
        rr(ctx, -w / 2, -h / 2, w, h, U * .022); ctx.fill();
        ctx.globalAlpha = .55; ctx.strokeStyle = p.acc3 || p.acc || '#999'; ctx.lineWidth = U * .003;
        rr(ctx, -w / 2 + U * .006, -h / 2 + U * .006, w - U * .012, h - U * .012, U * .018); ctx.stroke();
        ctx.restore();
        return [-w / 2, -h / 2, w / 2, h / 2];
    }
    // QRコード（vendor/qrcode-generator.js を使う。白いふちを付けて、読み取りやすくする）
    function drawQr(ctx, d, e, W, H, U) {
        var s = (e.w || .2) * W;
        ctx.fillStyle = '#fff'; rr(ctx, -s / 2, -s / 2, s, s, s * .04); ctx.fill();
        if (!window.qrcode || !e.url) { ctx.strokeStyle = '#999'; ctx.strokeRect(-s / 2, -s / 2, s, s); return [-s / 2, -s / 2, s / 2, s / 2]; }
        try {
            var q = window.qrcode(0, 'M'); q.addData(e.url); q.make();
            var n = q.getModuleCount(), m = s * .86 / n, o = -n * m / 2;
            ctx.fillStyle = '#111';
            for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(o + c * m, o + r * m, m + .5, m + .5);
        } catch (err) { ctx.fillStyle = '#c00'; ctx.fillRect(-s / 4, -s / 4, s / 2, s / 2); }
        return [-s / 2, -s / 2, s / 2, s / 2];
    }
    // 要素の高さ（画面の高さに対する割合）。縦に積む組で使う
    function elHeight(ctx, d, e, W, H, U) {
        if (e.t === 'text') {
            ctx.save();
            var L = textLayout(ctx, d, e, W, H, U), lh = e.lh || 1.28, h;
            if (e.vert) h = L.lines.reduce(function (a, l) { return Math.max(a, Array.from(l).length); }, 0) * L.px;
            else h = L.lines.length * L.px * lh;
            if (e.box === 'circle') { ctx.font = fontStr(L.fid, L.bold, L.px); var tw = Math.max.apply(null, L.lines.map(function (l) { return ctx.measureText(l).width; })); h = Math.max(tw, h) + L.px * .81; }
            else if (e.box) h += L.px * 1.1;
            ctx.restore();
            return h / H;
        }
        if (e.t === 'img') return (e.w || .3) * W * (e.shape === 'circle' ? 1 : (e.ar || 1)) / H;
        if (e.t === 'stamp') return (e.w || .16) * W / H;
        return (e.h || .1);   // メニュー・台紙
    }
    // 組（d.groups）の要素を、上から順に、間をあけて並べる。全体は組の y を中心にする
    function layoutGroups(ctx, d, W, H, U) {
        var gs = d.groups || {};
        Object.keys(gs).forEach(function (g) {
            var spec = gs[g], mem = (d.els || []).filter(function (e) { return e.grp === g && !e.hide; });
            if (!mem.length) return;
            var room = (spec.y1 || 1) - (spec.y0 || 0), gap0 = spec.gap || .02, hs, total, k = 1;
            for (var pass = 0; pass < 6; pass++) {
                mem.forEach(function (e) { e._k = k; });
                hs = mem.map(function (e) { return elHeight(ctx, d, e, W, H, U); });
                total = hs.reduce(function (a, b) { return a + b; }, 0);
                if (total + gap0 * .3 * (mem.length - 1) <= room) break;
                k *= Math.max(.6, room / (total + gap0 * .3 * (mem.length - 1))) * .98;
            }
            var gap = gap0;
            total += gap * (mem.length - 1);
            if (total > room && mem.length > 1) { gap = Math.max(0, gap - (total - room) / (mem.length - 1)); total = hs.reduce(function (a, b) { return a + b; }, 0) + gap * (mem.length - 1); }
            var top = Math.max(spec.y0 || 0, Math.min((spec.y1 || 1) - total, (spec.y || .5) - total / 2));
            mem.forEach(function (e, i) { e._y = top + hs[i] / 2; top += hs[i] + gap; });
        });
    }
    // 背景の画像（テンプレートの上に敷く）。fit：cover＝画面いっぱい／contain＝全部見せる。fade：白（黒）くうすめる。blur：ぼかす
    function drawBg(ctx, b, W, H) {
        var im = getImg(b.src);
        if (!im) return;
        var iw = im.naturalWidth || 1, ih = im.naturalHeight || 1, z = Math.max(1, b.zoom || 1);
        var sc = (b.fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih)) * z;
        var dw = iw * sc, dh = ih * sc;
        var dx = (W - dw) / 2 - (b.px || 0) * Math.abs(dw - W) / 2, dy = (H - dh) / 2 - (b.py || 0) * Math.abs(dh - H) / 2;
        ctx.save();
        ctx.imageSmoothingQuality = 'high';
        if (b.blur > 0) {
            // 小さく描いてから大きく広げると、ぼける（どの端末でも同じに描ける）
            var k = 1 / (1 + b.blur * 14), t = document.createElement('canvas');
            t.width = Math.max(1, Math.round(dw * k)); t.height = Math.max(1, Math.round(dh * k));
            var tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(im, 0, 0, t.width, t.height);
            ctx.drawImage(t, dx, dy, dw, dh);
        } else ctx.drawImage(im, dx, dy, dw, dh);
        if (b.fade > 0) { ctx.globalAlpha = Math.min(.9, b.fade); ctx.fillStyle = b.dark ? '#000' : '#fff'; ctx.fillRect(0, 0, W, H); }
        ctx.restore();
    }
    // 下書き1枚を描く（画面の見本も、保存する画像も、同じ描き方）
    function renderDesign(ctx, d, W, H, opt) {
        opt = opt || {};
        var U = Math.min(W, H), t = tplOf(d), p = palOf(d);
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        t.draw(ctx, W, H, p, U, rng(d.seed || 7));
        ctx.restore();
        if (d.bg && d.bg.src) drawBg(ctx, d.bg, W, H);
        (d.els || []).forEach(function (e) { delete e._y; delete e._k; });
        layoutGroups(ctx, d, W, H, U);
        var rec = opt.rec || null;
        (d.els || []).forEach(function (e) { if (!e.hide) drawEl(ctx, d, e, W, H, U, rec); });
        if (opt.sel && rec) {
            var b = rec.filter(function (x) { return x.id === opt.sel; })[0];
            if (b) {
                var hs = opt.hs || Math.max(4, U * .01), blue = b.lock ? '#8A8F98' : '#1A73E8';
                ctx.save(); ctx.translate(b.cx, b.cy); if (b.rot) ctx.rotate(b.rot * Math.PI / 180);
                ctx.setLineDash([hs * 1.1, hs * .8]); ctx.lineWidth = Math.max(2, hs * .28); ctx.strokeStyle = blue;
                ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
                ctx.setLineDash([]);
                if (!b.lock) {
                    // 四すみの丸：引っぱると大きさが変わる。上の丸：まわすと向きが変わる
                    var mx = (b.x0 + b.x1) / 2, ry = b.y0 - hs * 3.4;
                    ctx.lineWidth = hs * .3; ctx.beginPath(); ctx.moveTo(mx, b.y0); ctx.lineTo(mx, ry); ctx.stroke();
                    [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].forEach(function (q) { ctx.beginPath(); ctx.arc(q[0], q[1], hs, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = hs * .35; ctx.strokeStyle = blue; ctx.stroke(); });
                    ctx.beginPath(); ctx.arc(mx, ry, hs * 1.1, 0, Math.PI * 2); ctx.fillStyle = blue; ctx.fill();
                    ctx.strokeStyle = '#fff'; ctx.lineWidth = hs * .28; ctx.beginPath(); ctx.arc(mx, ry, hs * .55, -Math.PI * .9, Math.PI * .5); ctx.stroke();
                }
                ctx.restore();
            }
        }
        if (opt.safe) {
            // 印刷で切れやすい所の目安（紙のふちから 4mm）。見本だけに出し、保存する画像には入らない
            var f0 = FMTS[d.fmt], ix = f0 ? 4 / f0.mm[0] * W : U * .03, iy = f0 ? 4 / f0.mm[1] * H : U * .03;
            ctx.save(); ctx.strokeStyle = 'rgba(26,115,232,.7)'; ctx.lineWidth = Math.max(1, U * .003); ctx.setLineDash([U * .012, U * .01]);
            ctx.strokeRect(ix, iy, W - ix * 2, H - iy * 2); ctx.restore();
        }
        if (opt.guides) {
            ctx.save(); ctx.strokeStyle = '#E2557F'; ctx.lineWidth = Math.max(1, U * .003); ctx.setLineDash([U * .015, U * .01]);
            (opt.guides.xs || []).forEach(function (x) { ctx.beginPath(); ctx.moveTo(x * W, 0); ctx.lineTo(x * W, H); ctx.stroke(); });
            (opt.guides.ys || []).forEach(function (y) { ctx.beginPath(); ctx.moveTo(0, y * H); ctx.lineTo(W, y * H); ctx.stroke(); });
            ctx.restore();
        }
    }

    // ---------------- ひとこと（商品名の言葉から選ぶ。事実かどうか分からない言葉は使わない） ----------------
    var COPY = [
        [/塩/, ['ほどよい塩気がやみつき！', 'ひと口でわかる、塩のうまみ'], 'ほどよい塩気と、バターの香り。'],
        [/メロン/, ['さくさくクッキー生地！', 'みんな大好き、まあるいメロンパン'], '外はさくっと、中はふんわり。'],
        [/クリーム|カスタード/, ['とろ〜りクリーム', 'やさしい甘さのクリーム'], 'なめらかなクリームがたっぷり。'],
        [/あん|アン|つぶ|こし/, ['ほっこり甘いあんこ', 'なつかしい、やさしい甘さ'], 'ほっとする甘さのあんこ入り。'],
        [/チーズ/, ['チーズの香りがたまらない！', 'とろけるチーズ'], 'チーズのコクと、こうばしさ。'],
        [/シナモン/, ['シナモンふわり', '香りでほっとひと息'], 'シナモンの香りが広がります。'],
        [/チョコ|ココア|ブラウニー/, ['チョコたっぷり！', 'ほろにがチョコ'], 'チョコの風味をしっかり楽しめます。'],
        [/アーモンド/, ['こうばしいアーモンド', 'アーモンドの香りがやみつき！'], 'アーモンドのこうばしさが自慢です。'],
        [/ココナッツ/, ['ココナッツ香る', '食べごたえばつぐん！'], 'ココナッツの風味豊かなクッキー。'],
        [/紅茶|アールグレイ/, ['紅茶がふわり', 'ティータイムのおともに'], '紅茶の香りがやさしく広がります。'],
        [/抹茶/, ['ほろにが抹茶', '抹茶の香りでひと休み'], '抹茶のほろにがさと甘さ。'],
        [/全粒粉/, ['さくさく全粒粉', '素材を生かした味'], 'ざっくりとした食感が楽しい。'],
        [/ミルク|牛乳|練乳/, ['やさしいミルクの甘さ', 'なつかしいおいしさ'], 'ほのかな甘さとミルクの香り。'],
        [/カレー/, ['スパイス香る！', 'ごはん代わりにも'], 'スパイスの香りが食欲をそそります。'],
        [/ウィンナー|ソーセージ|フランク/, ['ジューシー！', 'お昼ごはんにぴったり'], 'ぱりっとしたウィンナー入り。'],
        [/ピザ|マヨ|コーン/, ['ボリュームたっぷり！', 'おかずパンの定番'], 'お昼ごはんにもぴったりです。'],
        [/枝豆/, ['枝豆ごろごろ', '彩りもきれい'], '枝豆の食感が楽しいパン。'],
        [/かぼちゃ|カボチャ|パンプキン/, ['ほくほくかぼちゃ', '秋の味'], 'かぼちゃのやさしい甘さ。'],
        [/さつま|いも|芋/, ['ほくほくおいも', '秋の味'], 'おいものやさしい甘さ。'],
        [/いちご|苺|ストロベリー/, ['甘ずっぱいいちご', 'ピンクがかわいい'], 'いちごの甘ずっぱさ。'],
        [/レモン/, ['さわやかレモン', 'すっきり甘ずっぱい'], 'レモンのさわやかな香り。'],
        [/はちみつ|ハニー/, ['はちみつのやさしい甘さ', 'とろりとはちみつ'], 'はちみつのやさしい甘さ。'],
        [/りんご|アップル/, ['りんごの甘ずっぱさ', 'りんごの香り'], 'りんごの甘ずっぱさが広がります。'],
        [/フィナンシェ/, ['バター香る焼き菓子', 'しっとり焼き上げ'], 'しっとり、バターの香り。'],
        [/フロランタン/, ['カリッと香ばしい！', 'キャラメルとアーモンド'], 'キャラメルとアーモンドのカリッと食感。'],
        [/パウンド|ケーキ/, ['しっとりやさしい甘さ', 'おやつの時間に'], 'しっとり焼き上げました。'],
        [/マフィン|スコーン|マドレーヌ/, ['焼き菓子でひと休み', 'ほろっと焼き上げ'], 'ていねいに焼き上げました。'],
        [/スノーボール/, ['ほろりと溶ける', '雪玉みたいなクッキー'], '口の中でほろりと崩れます。'],
        [/スティック/, ['ついつい手がのびる', 'ぽりぽり食感'], 'おやつにぴったり。'],
        [/クッキー|サブレ|ビスケット/, ['さくさく食感！', 'おやつにどうぞ'], 'ひとつひとつ、ていねいに焼きました。'],
        [/シュトーレン/, ['冬だけのおいしさ', '少しずつ切って楽しむ'], 'ドライフルーツとナッツたっぷり。'],
        [/コーヒー|珈琲|カフェ|ラテ/, ['ほっとひと休み', '香り高い一杯'], 'パンやお菓子のおともに。'],
        [/ジュース|ソーダ|ティー|茶/, ['ごくごくおいしい', 'パンのおともに'], 'すっきり飲みやすい一杯。'],
        [/クロワッサン|デニッシュ/, ['さくさくの層', 'バターの香り'], 'さくっと軽い食感。'],
        [/ベーグル/, ['もちもち食感！', 'かむほどおいしい'], 'もっちり、食べごたえあり。'],
        [/食パン|トースト/, ['ふんわり、もっちり', '毎日の朝ごはんに'], 'トーストしてもおいしい。']
    ];
    var COPY_DEF = {
        sweet: [['やさしい味わい', 'ひとつひとつ、ていねいに'], 'ていねいに作りました。'],
        savory: [['おやつの時間に', 'ていねいに焼きました'], 'ていねいに作りました。'],
        drink: [['ほっとひと休み', 'パンのおともに'], 'パンやお菓子といっしょにどうぞ。'],
        other: [['ていねいに作りました', 'ぜひどうぞ'], 'ていねいに作りました。']
    };
    function copyFor(p, v) {
        var hit = null;
        for (var i = 0; i < COPY.length; i++) if (COPY[i][0].test(p.name)) { hit = COPY[i]; break; }
        var def = COPY_DEF[p.type] || COPY_DEF.other;
        var catches = hit ? hit[1] : def[0];
        return { catch: catches[v % catches.length], desc: p.desc || (hit ? hit[2] : def[1]) };
    }
    // ひとことの案（商品名に合う物 → 分類に合う物の順）。「ひとことを替える」で順に出す
    function catchList(p) {
        var out = [];
        COPY.forEach(function (c) { if (c[0].test(p.name)) c[1].forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); });
        (COPY_DEF[p.type] || COPY_DEF.other)[0].concat(['ぜひ一度どうぞ', 'おやつの時間に', 'おみやげにもどうぞ']).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
        return out;
    }
    // 季節（月）に合うテンプレート
    function seasonTpl(m) { return (m === 3 || m === 4) ? 'spring' : (m >= 9 && m <= 11) ? 'autumn' : m === 12 ? 'winter' : ''; }
    function tplChoices(p, kind) {
        var m = new Date().getMonth() + 1, s = seasonTpl(m), base;
        if (kind === 'poster') base = ['pop', 'natural', 'elegant', 'cafe', 'chalk', 'simple'];
        else if (p && p.type === 'drink') base = ['cafe', 'chalk', 'natural', 'simple', 'pop', 'elegant'];
        else if (p && p.type === 'savory') base = ['natural', 'pop', 'elegant', 'cafe', 'chalk', 'simple'];
        else base = ['pop', 'natural', 'cafe', 'chalk', 'elegant', 'simple'];
        return s ? [s].concat(base) : base;
    }
    function decosFor(t) {
        var m = new Date().getMonth() + 1, list = t.decos.slice();
        if (t.id === 'autumn' && m !== 10) list = list.filter(function (x) { return x !== 'pumpkin'; }).concat(['leaf']);
        return list;
    }

    // ---------------- 下書きを作る ----------------
    var uid = 0;
    function nid() { uid++; return 'e' + Date.now().toString(36) + uid.toString(36); }
    function T(role, text, o) { return Object.assign({ id: nid(), t: 'text', role: role, text: text, x: .5, y: .5, w: .8, size: .06, align: 'center', ck: 'ink', fk: 'body' }, o || {}); }
    function IMGEL(src, o) { return Object.assign({ id: nid(), t: 'img', src: src, x: .5, y: .5, w: .3 }, o || {}); }
    function picOf(p) {
        if (A.photo(p.name)) return 'photo:' + p.name;
        var a = A.art(p);
        return a ? 'art:' + a : '';
    }
    function stampWord(p) {
        // 「No.1」は、何で比べたか（当店の販売数・いつの間か）を、すぐそばに書く（下の basis）
        if (A.topSeller(p)) return '当店人気No.1';
        if (p.isNew) return '新商品';
        if (p.rec) return 'おすすめ';
        return '';
    }
    // おすすめ商品のポスターの吹き出しの一語（味・食感の言葉だけ。事実かどうか分からない言葉は使わない）
    var WORDS = [
        [/スノーボール/, 'ほろほろ！'], [/クッキー|サブレ|ビスケット|スティック|クロワッサン|デニッシュ/, 'さくさく！'], [/メロン/, 'さっくり！'],
        [/塩/, 'じゅわっ！'], [/チーズ/, 'こくうま！'], [/あん|アン|つぶ|こし/, 'ほっこり'], [/パウンド|ケーキ|フィナンシェ|マドレーヌ/, 'しっとり'],
        [/コーヒー|珈琲|ブレンド|カフェ|ラテ/, 'ほっと一息'], [/チョコ|ココア/, 'ほろにが'], [/ミルク|牛乳|練乳/, 'ふんわり'], [/ウィンナー|ソーセージ/, 'ジューシー！'],
        [/レモン/, 'さわやか！'], [/さつま|いも|芋|かぼちゃ|カボチャ/, 'ほくほく'], [/りんご|アップル/, 'あまずっぱい'], [/紅茶|アールグレイ/, 'ふんわり香る'],
        [/抹茶/, 'ほろにが'], [/アーモンド|ナッツ|ココナッツ/, 'こうばしい！'], [/全粒粉/, 'ざくざく'], [/つめ合わせ|詰め合わせ|セット/, 'おみやげに！'],
        [/はちみつ|ハニー/, 'やさしい甘さ'], [/ベーグル|もち/, 'もちもち'], [/ジュース|ソーダ|ティー|茶/, 'ごくごく'], [/パン/, 'ふわふわ']
    ];
    function wordFor(p) {
        for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(p.name)) return WORDS[i][1];
        return 'おすすめ！';
    }
    // おすすめ商品のポスターの1品（名前・写真・値段・コメント・吹き出しの一語。どれも後から直せる）
    function recItemFor(p, v) { return { pid: p.id, name: p.name, price: A.priceInfo(p).main, comment: copyFor(p, v || 0).desc, word: wordFor(p), pic: picOf(p) }; }
    // この下書きの商品（予定から作ったポスターは、その予定のメニュー。ふだんは販売中の商品）
    function prods(d) { return d && Array.isArray(d.plist) && d.plist.length ? d.plist : A.products(); }
    // 商品1つのPOP
    function genPop(p, fmt, tplId, v, dense) {
        // ぎっしり：写真と文字を大きくして、すき間を詰める
        var K = dense ? 1.13 : 1, KI = dense ? 1.16 : 1;
        var t = TPL_BY[tplId] || TPLS[0], pr = A.priceInfo(p), cp = copyFor(p, v), pic = picOf(p), sw = stampWord(p);
        var flip = v % 2 === 1, f = FMTS[fmt], land = f.w > f.h * 1.15, sq = !land && f.w > f.h * .9;
        var els = [];
        var isPhoto = pic.indexOf('photo:') === 0;
        var imgO = { shape: isPhoto ? t.img : 'plain', ek: isPhoto && t.img !== 'plain' ? 'acc' : '', bk: '' };
        var priceBox = t.price === 'circle' ? 'circle' : t.price === 'tag' ? 'round' : t.price === 'band' ? 'band' : '';
        var priceO = { fk: 'title', ck: 'price', bk: priceBox ? (palOf({ tpl: t.id, pal: 0 }).priceBg ? 'priceBg' : 'acc') : '', box: priceBox };
        if (priceBox && !palOf({ tpl: t.id, pal: 0 }).priceBg) priceO.ck = 'onAcc';
        var titleO = { fk: 'title', ck: 'ink', fit: true, max: 2 };
        if (t.titleStroke) { titleO.sk = 'onAcc'; titleO.sw = .22; titleO.stroke = '#fff'; }
        var catchO = { fk: 'accent', ck: t.catchBox === 'band' ? 'onAcc' : 'acc', box: t.catchBox, bk: t.catchBox ? (t.catchBox === 'line' ? 'acc3' : 'acc') : '', max: 2, fit: true };
        var groups = {}, G = function (o) { o.grp = 'm'; return o; };
        var bottom = t.footBand ? .91 : .95;
        if (land) {
            var ix = flip ? .76 : .24, tx = flip ? .33 : .67;
            groups.m = { y: .5, y0: dense ? .05 : .08, y1: bottom, gap: dense ? .016 : .03 };
            if (pic) els.push(IMGEL(pic, Object.assign({ x: ix, y: .52, w: .32 * KI }, imgO)));
            els.push(T('catch', cp.catch, G(Object.assign({ x: tx, y: .2, w: .54, size: .062 * K }, catchO))));
            els.push(T('title', p.name, G(Object.assign({ x: tx, y: .42, w: .55, size: .14 * K }, titleO))));
            els.push(T('desc', cp.desc, G({ x: tx, y: .62, w: .54, size: .048 * K, ck: 'sub', max: 3, fit: true })));
            els.push(T('price', pr.main, G(Object.assign({ x: tx + .1, y: .8, w: .34, size: (priceBox === 'circle' ? .085 : .11) * K }, priceO))));
            if (pr.sub) els.push(T('pricesub', pr.sub, G({ x: tx + .1, y: .925, w: .4, size: .034, ck: 'sub' })));
            if (sw) els.push({ id: nid(), t: 'stamp', role: 'stamp', text: sw, style: t.stamp, x: flip ? .88 : .12, y: .17, w: .17, rot: flip ? 12 : -12, ck: 'acc', ik: 'onAcc', fk: 'accent', bold: true });
        } else if (sq) {
            groups.m = { y: .76, y0: dense ? .6 : .56, y1: bottom, gap: dense ? .014 : .025 };
            if (pic) els.push(IMGEL(pic, Object.assign({ x: .5, y: dense ? .33 : .335, w: .4 * KI }, imgO)));
            els.push(T('catch', cp.catch, Object.assign({ x: .5, y: .09, w: .8, size: .058 * K }, catchO)));
            els.push(T('title', p.name, G(Object.assign({ x: .5, y: .72, w: .84, size: .1 * K }, titleO))));
            els.push(T('price', pr.main, G(Object.assign({ x: .5, y: .88, w: .4, size: (priceBox === 'circle' ? .07 : .085) * K }, priceO))));
            if (pr.sub) els.push(T('pricesub', pr.sub, G({ x: .5, y: .94, w: .6, size: .03, ck: 'sub' })));
            if (sw) els.push({ id: nid(), t: 'stamp', role: 'stamp', text: sw, style: t.stamp, x: .16, y: .22, w: .2, rot: -12, ck: 'acc', ik: 'onAcc', fk: 'accent', bold: true });
        } else {
            groups.m = { y: .72, y0: dense ? .52 : .48, y1: bottom, gap: dense ? .01 : .02 };
            if (pic) els.push(IMGEL(pic, Object.assign({ x: .5, y: dense ? .27 : .27, w: .52 * KI }, imgO)));
            els.push(T('catch', cp.catch, G(Object.assign({ x: .5, y: .6, w: .84, size: .07 * K }, catchO))));
            els.push(T('title', p.name, G(Object.assign({ x: .5, y: .7, w: .86, size: .13 * K }, titleO))));
            els.push(T('desc', cp.desc, G({ x: .5, y: .8, w: .82, size: .048 * K, ck: 'sub', max: dense ? 3 : 2, fit: true })));
            els.push(T('price', pr.main, G(Object.assign({ x: .5, y: .9, w: .6, size: (priceBox === 'circle' ? .085 : .1) * K }, priceO))));
            if (pr.sub) els.push(T('pricesub', pr.sub, G({ x: .5, y: .95, w: .6, size: .032, ck: 'sub' })));
            if (sw) els.push({ id: nid(), t: 'stamp', role: 'stamp', text: sw, style: t.stamp, x: .17, y: .12, w: .24, rot: -12, ck: 'acc', ik: 'onAcc', fk: 'accent', bold: true });
        }
        var basis = sw === '当店人気No.1' && A.topBasis ? A.topBasis() : '';
        if (t.footBand) els.push(T('note', A.shopName(), { x: .5, y: basis ? .955 : .965, w: .8, size: .03, ck: 'onAcc' }));
        if (basis) els.push(T('basis', basis, { x: .5, y: t.footBand ? .987 : .978, w: .94, size: t.footBand ? .017 : .02, ck: t.footBand ? 'onAcc' : 'sub', fk: 'body' }));
        // 飾り（すみに置く。じゃまなら消せる）
        var spots = land ? [[flip ? .1 : .93, flip ? .86 : .14, .1, 14], [flip ? .95 : .06, .9, .09, -10]] : sq ? [[.92, .1, .1, 14], [.07, .93, .08, -10]] : [[.88, .08, .12, 14], [.1, .93, .09, -10]];
        decosFor(t).slice(0, 2).forEach(function (id, i) { var s = spots[i]; if (s) els.push(IMGEL('deco:' + id, { x: s[0], y: s[1], w: s[2], rot: s[3], role: 'deco' })); });
        return { v: 1, kind: 'pop', fmt: fmt, tpl: t.id, pal: Math.floor(v / 2) % t.pals.length, seed: 7 + v, pid: p.id, els: els, groups: groups, dense: !!dense };
    }
    // 販売会のポスター（販売会名・開催日時・開催場所・実施団体・コラボ団体・一言コメント・おすすめ・メニュー）
    // 実施団体・コラボ団体は1行にまとめる（「実施　◯◯　×　コラボ　◯◯」）
    function orgsText(ev) {
        var a = [];
        if (ev.org) a.push('実施　' + ev.org);
        if (ev.collab && !ev.noCollab) a.push('コラボ　' + ev.collab);
        return a.join('　×　');
    }
    function genPoster(list, fmt, tplId, v, ev, fids, opt) {
        opt = opt || {};
        var dense = !!opt.dense, allP = opt.all || A.products();
        var t = TPL_BY[tplId] || TPLS[0], els = [], feat;
        var f = FMTS[fmt], tall = f.h > f.w * 1.15;
        var maxF = dense && tall ? 6 : 3;
        if (fids) {
            feat = fids.map(function (id) { return allP.filter(function (p) { return p.id === id; })[0]; }).filter(Boolean);
        } else {
            feat = list.filter(function (p) { return p.rec; });
            if (!feat.length) feat = list.filter(function (p) { return A.topSeller(p); });
            if (!feat.length) feat = list.slice(0, 3);
        }
        feat = feat.slice(0, maxF);
        var titleO = { fk: 'title', ck: 'ink', fit: true, max: 2 };
        if (t.titleStroke) { titleO.sk = 'onAcc'; titleO.sw = .2; }
        var orgs = orgsText(ev);
        var menuItems = list.map(function (p) { return { id: p.id, n: p.name, p: A.priceInfo(p).value }; });
        var groups;
        if (dense && tall) {
            // ぎっしり（縦長）：見出しを詰め、おすすめを2段（6つまで）、メニューの文字を大きく
            groups = { h: { y: .15, y0: .022, y1: .285, gap: .006 } };
            els.push(T('brand', ev.shop, { x: .5, y: .05, w: .86, size: .05, fk: 'accent', ck: 'acc', grp: 'h' }));
            els.push(T('event', ev.name, Object.assign({ x: .5, y: .11, w: .92, size: .125, grp: 'h' }, titleO)));
            els.push(T('date', ev.date, { x: .5, y: .19, w: .9, size: .074, fk: 'title', ck: 'acc', grp: 'h' }));
            els.push(T('place', [ev.time, ev.place].filter(Boolean).join('　'), { x: .5, y: .23, w: .9, size: .045, ck: 'ink', fit: true, max: 2, grp: 'h' }));
            if (orgs) els.push(T('orgs', orgs, { x: .5, y: .255, w: .9, size: .033, ck: 'sub', fk: 'title', fit: true, max: 2, grp: 'h' }));
            if (ev.catch) els.push(T('catch', ev.catch, { x: .5, y: .27, w: .86, size: .038, fk: 'accent', ck: 'sub', box: t.catchBox === 'band' ? 'band' : '', bk: 'acc3', max: 2, fit: true, grp: 'h' }));
            // メニューが長い時は、おすすめの所を少し低くして、メニューの文字を読める大きさに保つ
            var mCols = menuItems.length > 16 ? 3 : menuItems.length > 7 ? 2 : 1, mRows = Math.ceil(menuItems.length / mCols);
            var fA = .325, fB = Math.max(.6, Math.min(.715, .9 - mRows * .03));
            if (feat.length) {
                els.push(T('fhead', '〜 おすすめ 〜', { x: .5, y: .305, w: .6, size: .036, fk: 'accent', ck: 'onAcc', box: 'band', bk: 'acc' }));
                var rows = feat.length > 3 ? 2 : 1, rowH = (fB - fA) / rows;
                feat.forEach(function (p, i) {
                    var r = i < 3 ? 0 : 1, inRow = r === 0 ? Math.min(3, feat.length) : feat.length - 3, c = r === 0 ? i : i - 3;
                    var xs = inRow === 1 ? [.5] : inRow === 2 ? [.3, .7] : [.18, .5, .82], cw = inRow === 1 ? .6 : inRow === 2 ? .4 : .3;
                    var ph = rowH * (rows === 1 ? .55 : .5), iw = Math.min(cw * .9, ph * f.h / f.w), top = fA + rowH * r;
                    var pic = picOf(p), isPhoto = pic.indexOf('photo:') === 0, g = 'f' + i;
                    groups[g] = { y: top + ph + (rowH - ph) / 2, y0: top + ph + .006, y1: top + rowH - .004, gap: .003 };
                    if (pic) els.push(IMGEL(pic, { x: xs[c], y: top + ph / 2 + .004, w: iw, shape: isPhoto ? t.img : 'plain', ek: isPhoto ? 'acc' : '', role: 'fpic', pid: p.id }));
                    els.push(T('fname', p.name, { x: xs[c], y: top + ph + .02, w: cw * .96, size: .036, fk: 'title', ck: 'ink', fit: true, max: 2, pid: p.id, grp: g }));
                    els.push(T('fprice', A.priceInfo(p).main, { x: xs[c], y: top + ph + .04, w: cw * .8, size: .032, fk: 'title', ck: 'acc', pid: p.id, grp: g }));
                    els.push(T('fdesc', copyFor(p, v).desc, { x: xs[c], y: top + ph + .06, w: cw * .96, size: .024, ck: 'sub', max: 2, fit: true, pid: p.id, grp: g }));
                });
            }
            var my0 = feat.length ? fB + .02 : .315;
            els.push(T('mhead', 'メニュー', { x: .5, y: my0, w: .5, size: .04, fk: 'accent', ck: 'acc', box: 'line', bk: 'acc3' }));
            var mh = .94 - (my0 + .025);
            els.push({ id: nid(), t: 'menu', role: 'menu', x: .5, y: my0 + .02 + mh / 2, w: .9, h: mh, size: feat.length ? .042 : .05, cols: mCols, autoCols: true, fk: 'body', ck: 'ink', pk: 'sub', items: menuItems });
            if (ev.note) els.push(T('note', ev.note, { x: .5, y: t.footBand ? .967 : .962, w: .9, size: .024, ck: t.footBand ? 'onAcc' : 'sub' }));
            [[.08, .045, .085, -12], [.92, .05, .09, 12]].forEach(function (sp, i) { var id = decosFor(t)[i]; if (id) els.push(IMGEL('deco:' + id, { x: sp[0], y: sp[1], w: sp[2], rot: sp[3], role: 'deco' })); });
            return { v: 1, kind: 'poster', fmt: fmt, tpl: t.id, pal: Math.floor(v / 2) % t.pals.length, seed: 11 + v, ev: ev, els: els, groups: groups, dense: true };
        }
        var K = dense ? 1.12 : 1;
        var y = tall ? 1 : .72;   // 横長・正方形の時は、全体を詰める
        var Y = function (a) { return tall ? a : .06 + (a - .05) * .95; };
        groups = { h: { y: Y(.2), y0: Y(.03), y1: Y(.395), gap: dense ? .006 : .012 } };
        els.push(T('brand', ev.shop, { x: .5, y: Y(.065), w: .8, size: .055 * y * K, fk: 'accent', ck: 'acc', grp: 'h' }));
        els.push(T('event', ev.name, Object.assign({ x: .5, y: Y(.145), w: .88, size: .12 * y * K, grp: 'h' }, titleO)));
        els.push(T('date', ev.date, { x: .5, y: Y(.245), w: .86, size: .075 * y * K, fk: 'title', ck: 'acc', grp: 'h' }));
        els.push(T('place', [ev.time, ev.place].filter(Boolean).join('　'), { x: .5, y: Y(.305), w: .86, size: .042 * y * K, ck: 'ink', fit: true, max: 2, grp: 'h' }));
        if (orgs) els.push(T('orgs', orgs, { x: .5, y: Y(.33), w: .86, size: .032 * y * K, ck: 'sub', fk: 'title', fit: true, max: 2, grp: 'h' }));
        if (ev.catch) els.push(T('catch', ev.catch, { x: .5, y: Y(.36), w: .8, size: .04 * y * K, fk: 'accent', ck: 'sub', box: t.catchBox === 'band' ? 'band' : '', bk: 'acc3', max: 2, fit: true, grp: 'h' }));
        var fy = Y(.425);
        if (feat.length) {
            els.push(T('fhead', '〜 おすすめ 〜', { x: .5, y: fy, w: .6, size: .038 * y, fk: 'accent', ck: 'onAcc', box: 'band', bk: 'acc' }));
            var xs = feat.length === 1 ? [.5] : feat.length === 2 ? [.3, .7] : [.19, .5, .81];
            // 写真・絵は、見出しの下から決まった高さに収める（数が少なくても、下の文字と重ならない）
            var picTop = Y(.45), picH = (tall ? .14 : .2) * (dense ? 1.12 : 1);
            var iw = Math.min(feat.length === 1 ? .34 : .24, picH * f.h / f.w) * (dense ? 1.1 : 1);
            var picY = picTop + picH / 2;
            feat.forEach(function (p, i) {
                var pic = picOf(p), isPhoto = pic.indexOf('photo:') === 0, g = 'f' + i;
                groups[g] = { y: (picTop + picH + Y(.7)) / 2, y0: picTop + picH + .008, y1: Y(.7), gap: .006 };
                if (pic) els.push(IMGEL(pic, { x: xs[i], y: picY, w: iw, shape: isPhoto ? t.img : 'plain', ek: isPhoto ? 'acc' : '', role: 'fpic', pid: p.id }));
                els.push(T('fname', p.name, { x: xs[i], y: Y(.6), w: feat.length === 1 ? .6 : .29, size: .034 * y * K, fk: 'title', ck: 'ink', fit: true, max: 2, pid: p.id, grp: g }));
                if (dense) els.push(T('fprice', A.priceInfo(p).main, { x: xs[i], y: Y(.63), w: .25, size: .03 * y * K, fk: 'title', ck: 'acc', pid: p.id, grp: g }));
                els.push(T('fdesc', copyFor(p, v).desc, { x: xs[i], y: Y(.655), w: feat.length === 1 ? .6 : .28, size: .022 * y * K, ck: 'sub', max: 3, fit: true, pid: p.id, grp: g }));
            });
        }
        var my0 = feat.length ? Y(.71) : Y(.42);
        els.push(T('mhead', 'メニュー', { x: .5, y: my0, w: .5, size: .04 * y, fk: 'accent', ck: 'acc', box: 'line', bk: 'acc3' }));
        var mh = (tall ? .9 : .93) - (my0 + .04);
        els.push({ id: nid(), t: 'menu', role: 'menu', x: .5, y: my0 + .03 + mh / 2, w: dense ? .9 : .84, h: mh, size: .03 * K, fk: 'body', ck: 'ink', pk: 'sub', items: menuItems });
        if (ev.note) els.push(T('note', ev.note, { x: .5, y: t.footBand ? .965 : .955, w: .86, size: .022, ck: t.footBand ? 'onAcc' : 'sub' }));
        var spots = tall ? [[.09, .05, .1, -12], [.91, .06, .11, 12], [.07, .4, .08, -8], [.93, .38, .08, 10]] : [[.06, .08, .08, -12], [.94, .08, .08, 12]];
        decosFor(t).slice(0, spots.length).forEach(function (id, i) { var s = spots[i]; els.push(IMGEL('deco:' + id, { x: s[0], y: s[1], w: s[2], rot: s[3], role: 'deco' })); });
        return { v: 1, kind: 'poster', fmt: fmt, tpl: t.id, pal: Math.floor(v / 2) % t.pals.length, seed: 11 + v, ev: ev, els: els, groups: groups, dense: dense };
    }
    // おすすめ商品のポスター：チェックした商品を、写真・名前・値段・コメント・吹き出しの一語で、すき間なくならべる
    function genRec(items, head, fmt, tplId, v, dense) {
        var t = TPL_BY[tplId] || TPLS[0], els = [], groups = {};
        var f = FMTS[fmt], tall = f.h > f.w * 1.15;
        var list = (items || []).slice(0, 6), n = Math.max(1, list.length);
        var pal0 = palOf({ tpl: t.id, pal: 0 }), priceK = pal0.priceBg ? 'priceBg' : 'price';
        var titleO = { fk: 'title', ck: 'ink', fit: true, max: 1 };
        if (t.titleStroke) { titleO.sk = 'onAcc'; titleO.sw = .2; }
        // 見出し・台紙は、テンプレートの枠（紙のふちから少し内側）の内側に置く
        var hy1 = tall ? .13 : .19;
        groups.h = { y: hy1 / 2 + .02, y0: tall ? .045 : .06, y1: hy1, gap: .006 };
        els.push(T('rtitle', head.title || 'おすすめ商品', Object.assign({ x: .5, y: .06, w: .9, size: tall ? .1 : .085, grp: 'h' }, titleO)));
        if (head.sub) els.push(T('rsub', head.sub, { x: .5, y: .1, w: .9, size: tall ? .038 : .032, fk: 'accent', ck: 'acc', fit: true, max: 2, grp: 'h' }));
        var cols = tall ? (n <= 3 ? 1 : 2) : Math.min(3, n), rows = Math.ceil(n / cols);
        var top = hy1 + .012, bot = head.note ? (tall ? .93 : .91) : (tall ? .955 : .94), gx = dense === false ? .035 : .02, gy = dense === false ? .025 : .012, side = tall ? .07 : .06;
        var cw = (1 - side * 2 - gx * (cols - 1)) / cols, ch = (bot - top - gy * (rows - 1)) / rows;
        list.forEach(function (it, i) {
            var r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, list.length - r * cols);
            var x0 = side + (cols - inRow) * (cw + gx) / 2 + c * (cw + gx), y0 = top + r * (ch + gy);
            var cx = x0 + cw / 2, cy = y0 + ch / 2, pid = it.pid, g = 'r' + i;
            var horiz = cw * f.w > ch * f.h * 1.25;
            var pic = it.pic || '', isPhoto = /^(photo|user):/.test(pic);
            var imgO = { shape: isPhoto ? (t.img === 'plain' ? 'round' : t.img) : 'plain', ek: isPhoto ? 'acc' : '', role: 'rpic', pid: pid };
            els.push({ id: nid(), t: 'box', role: 'rcard', pid: pid, x: cx, y: cy, w: cw, h: ch, lock: true });
            var nameO = { fk: 'title', ck: 'ink', fit: true, max: 2, pid: pid };
            if (horiz) {
                var iw = Math.min(cw * .44, ch * .84 * f.h / f.w), ix = x0 + .014 + iw / 2;
                if (pic) els.push(IMGEL(pic, Object.assign({ x: ix, y: cy + ch * .03, w: iw }, imgO)));
                var tx0 = x0 + .03 + iw, tw = x0 + cw - tx0 - .016, tcx = tx0 + tw / 2;
                groups[g] = { y: cy, y0: y0 + ch * .07, y1: y0 + ch * .95, gap: .006 };
                els.push(T('rname', it.name, Object.assign({ x: tcx, y: cy - .03, w: tw, size: tall ? .064 : .056 }, nameO, { grp: g })));
                els.push(T('rprice', it.price, { x: tcx, y: cy, w: tw, size: tall ? .056 : .05, fk: 'title', ck: priceK, pid: pid, grp: g }));
                els.push(T('rcomm', it.comment, { x: tcx, y: cy + .03, w: tw, size: tall ? .032 : .028, ck: 'sub', max: 3, fit: true, pid: pid, grp: g }));
                els.push(T('rword', it.word, { x: x0 + Math.min(iw * .62, cw * .3), y: y0 + ch * .13, w: cw * .36, size: tall ? .04 : .034, fk: 'accent', ck: 'onAcc', box: 'bubble', bk: 'acc', rot: -6, max: 1, fit: true, pid: pid }));
            } else {
                var ph = ch * (dense === false ? .5 : .56), iw2 = Math.min(cw * .84, ph * f.h / f.w), ih2 = iw2 * f.w / f.h * (isPhoto ? .78 : 1);
                if (pic) els.push(IMGEL(pic, Object.assign({ x: cx, y: y0 + ch * .05 + ph / 2, w: iw2 }, imgO)));
                // 文字は写真のすぐ下から詰めて並べる（写真が低い時も、間をあけない）
                var gy0 = y0 + ch * .05 + ph / 2 + ih2 / 2 + .008;
                groups[g] = { y: gy0, y0: gy0, y1: y0 + ch * .96, gap: .003 };
                els.push(T('rname', it.name, Object.assign({ x: cx, y: y0 + ch * .66, w: cw * .9, size: .05 }, nameO, { grp: g })));
                els.push(T('rprice', it.price, { x: cx, y: y0 + ch * .76, w: cw * .8, size: .046, fk: 'title', ck: priceK, pid: pid, grp: g }));
                els.push(T('rcomm', it.comment, { x: cx, y: y0 + ch * .86, w: cw * .9, size: .027, ck: 'sub', max: 3, fit: true, pid: pid, grp: g }));
                els.push(T('rword', it.word, { x: x0 + cw * .3, y: y0 + ch * .1, w: cw * .5, size: .036, fk: 'accent', ck: 'onAcc', box: 'bubble', bk: 'acc', rot: -6, max: 1, fit: true, pid: pid }));
            }
        });
        if (head.note) els.push(T('rnote', head.note, { x: .5, y: t.footBand ? .967 : (tall ? .952 : .935), w: .86, size: .026, ck: t.footBand ? 'onAcc' : 'sub' }));
        return { v: 1, kind: 'rec', fmt: fmt, tpl: t.id, pal: Math.floor(v / 2) % t.pals.length, seed: 13 + v, els: els, groups: groups, rec: list, rhead: head, dense: dense !== false };
    }
    function defaultEvent() {
        var d = new Date(), wd = '日月火水木金土'[d.getDay()];
        var m = d.getMonth() + 1;
        var name = A.eventName() || (m + '月販売会');
        var c = m === 12 ? '冬のおいしいパンとお菓子' : m === 10 ? 'ひとやすみしませんか？' : (m === 3 || m === 4) ? '春のパンとお菓子をどうぞ' : 'ひとつひとつ手づくりのパンとお菓子';
        var ev = { shop: A.shopName(), name: name, date: m + '/' + d.getDate() + '（' + wd + '）', time: '11:45〜', place: '', org: A.shopName(), collab: '', catch: c, note: '' };
        // 予定から開店した販売会：予定の中身（日時・場所・実施団体・コラボ団体・一言コメント）を使う
        var pe = A.planEvent ? A.planEvent() : null;
        if (pe) Object.keys(pe).forEach(function (k) { if (pe[k] != null && pe[k] !== '') ev[k] = pe[k]; });
        return ev;
    }

    // ---------------- 直す（元に戻せるように、直す前の形を覚えておく） ----------------
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function pushHist() { if (!S.d) return; S.hist.push(JSON.stringify(S.d)); if (S.hist.length > 40) S.hist.shift(); S.fut = []; }
    function undo() {
        if (!S.hist.length) { A.error(); return; }
        S.fut = S.fut || []; S.fut.push(JSON.stringify(S.d)); if (S.fut.length > 40) S.fut.shift();
        S.d = JSON.parse(S.hist.pop());
        if (S.sel && !elById(S.sel)) S.sel = null;
        A.sound(660, .04); saveSoon(); render();
    }
    // やり直す（元に戻したのを、もう一度する）
    function redo() {
        if (!S.fut || !S.fut.length) { A.error(); return; }
        S.hist.push(JSON.stringify(S.d)); if (S.hist.length > 40) S.hist.shift();
        S.d = JSON.parse(S.fut.pop());
        if (S.sel && !elById(S.sel)) S.sel = null;
        A.sound(760, .04); saveSoon(); render();
    }
    // 元に戻す・やり直すのボタンを、押せるかどうかに合わせる
    function histBtns() {
        if (!host) return;
        var u = host.querySelector('[data-act="undo"]'); if (u) u.disabled = !S.hist.length;
        var r = host.querySelector('[data-act="redo"]'); if (r) r.disabled = !(S.fut && S.fut.length);
    }
    function elById(id) { return S.d && (S.d.els || []).filter(function (e) { return e.id === id; })[0] || null; }
    function selEl() { return S.sel ? elById(S.sel) : null; }
    function change(fn, keepPanel) {
        pushHist(); fn(); saveSoon();
        if (keepPanel) drawSoon(); else render();
    }
    // 作り直した下書きに、自分で直した所（文字・位置・大きさ・フォント・色・足した物）を引きつぐ
    function keyOf(e) { return e.role ? e.role + (e.pid != null ? ':' + e.pid : '') : ''; }
    function carry(oldD, nd, keepGeo) {
        var byKey = {};
        (oldD.els || []).forEach(function (e) { var k = keyOf(e); if (k && e.role !== 'deco') byKey[k] = e; });
        nd.els = nd.els.filter(function (e) {
            var o = byKey[keyOf(e)];
            if (!o) return !(oldD.removed || []).includes(keyOf(e));
            if (o.t === 'text' || o.t === 'stamp') { if (o.text !== undefined) e.text = o.text; }
            if (keepGeo) { ['x', 'y', 'w', 'h', 'size', 'rot', 'align', 'vert'].forEach(function (k) { if (o[k] !== undefined) e[k] = o[k]; }); if (!o.grp) delete e.grp; }
            if (o.font) { e.font = o.font; e.bold = o.bold; delete e.fk; }
            ['color', 'boxColor', 'stroke', 'ink', 'border'].forEach(function (k, i) { var kk = ['ck', 'bk', 'sk', 'ik', 'ek'][i]; if (o[k] && !o[kk]) { e[k] = o[k]; delete e[kk]; } });
            if (o.box !== undefined && o.boxSet) { e.box = o.box; e.boxSet = true; }
            if (o.items) e.items = o.items;
            if (o.cols && o.colsSet) { e.cols = o.cols; e.colsSet = true; } else if (o.cols && !o.autoCols) e.cols = o.cols;
            if (o.url) e.url = o.url;
            if (o.src && o.srcSet) { e.src = o.src; e.srcSet = true; }
            if (o.shape && o.shapeSet) { e.shape = o.shape; e.shapeSet = true; }
            if (o.hide) e.hide = true;
            ['op', 'flip', 'lock', 'zoom', 'px', 'py', 'far', 'cut', 'ar', 'lh', 'shadow', 'outline', 'outlineC'].forEach(function (k) { if (o[k] !== undefined) e[k] = o[k]; });
            return true;
        });
        // 自分で足した物は、そのまま残す
        (oldD.els || []).forEach(function (e) { if (e.u) nd.els.push(clone(e)); });
        nd.id = oldD.id; nd.removed = oldD.removed || []; nd.var = oldD.var || 0;
        if (oldD.bg) nd.bg = clone(oldD.bg);
        if (oldD.fids) nd.fids = oldD.fids;
        if (oldD.mids) nd.mids = oldD.mids;
        if (oldD.plist) nd.plist = oldD.plist;
        if (oldD.ev && !nd.ev) nd.ev = oldD.ev;
        if (oldD.kind === 'rec') { nd.rec = oldD.rec; nd.rhead = oldD.rhead; }
        return nd;
    }
    function productOf(d) { return A.products().filter(function (p) { return p.id === d.pid; })[0] || A.allProduct(d.pid); }
    function genFor(d, tpl, fmt, v) {
        if (d.kind === 'poster') return genPoster(posterList(d), fmt, tpl, v, d.ev || defaultEvent(), d.fids, { dense: !!d.dense, all: prods(d) });
        if (d.kind === 'rec') return genRec(d.rec || [], d.rhead || {}, fmt, tpl, v, d.dense !== false);
        var p = productOf(d);
        return p ? genPop(p, fmt, tpl, v, !!d.dense) : null;
    }
    function posterList(d) {
        var all = prods(d);
        if (d && d.mids) { var set = {}; d.mids.forEach(function (id) { set[id] = 1; }); return all.filter(function (p) { return set[p.id]; }); }
        return all;
    }
    function setTpl(id) {
        if (!S.d || S.d.tpl === id) return;
        var nd = genFor(S.d, id, S.d.fmt, S.d.var || 0);
        if (!nd) { A.error(); return; }
        change(function () { S.d = carry(S.d, nd, true); S.d.pal = 0; });
    }
    function setPal(i) { change(function () { S.d.pal = i; }); }
    function setFmt(f) {
        if (!S.d || S.d.fmt === f || !FMTS[f]) return;
        var nd = genFor(S.d, S.d.tpl, f, S.d.var || 0);
        if (!nd) { A.error(); return; }
        change(function () { var pal = S.d.pal; S.d = carry(S.d, nd, false); S.d.pal = pal; S.sel = null; });
    }
    function regen() {
        if (!S.d) return;
        var v = (S.d.var || 0) + 1, ch = S.d.kind === 'poster' || S.d.kind === 'rec' ? tplChoices(null, 'poster') : tplChoices(productOf(S.d) || {}, 'pop');
        var tpl = ch[v % ch.length];
        var nd = genFor(S.d, tpl, S.d.fmt, v);
        if (!nd) { A.error(); return; }
        change(function () { var old = S.d; S.d = carry(old, nd, false); S.d.var = v; S.d.pal = Math.floor(v / ch.length) % tplOf(S.d).pals.length; S.sel = null; });
        A.sound(880, .05);
    }

    // ---------------- 作ったものを、この端末に残す ----------------
    function store() { try { var j = JSON.parse(localStorage.getItem(A.key('taizanboku_pop')) || '{}'); return Array.isArray(j.list) ? j.list : []; } catch (e) { return []; } }
    function storeSet(list) {
        try { localStorage.setItem(A.key('taizanboku_pop'), JSON.stringify({ list: list })); return true; }
        catch (e) { A.toast('この端末にしまう場所が足りません。古い作ったものを消してください'); return false; }
    }
    var saveT = 0;
    function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveNow, 500); }
    function designName(d) {
        var t = (d.els || []).filter(function (e) { return e.role === (d.kind === 'poster' ? 'event' : d.kind === 'rec' ? 'rtitle' : 'title'); })[0];
        return (t && t.text ? t.text.replace(/\s+/g, ' ') : (d.kind === 'poster' ? 'ポスター' : d.kind === 'rec' ? 'おすすめ商品' : 'POP')).slice(0, 30);
    }
    function saveNow() {
        clearTimeout(saveT);
        if (!S.d) return;
        var list = store().filter(function (x) { return x.id !== S.d.id; });
        list.unshift({ id: S.d.id, at: Date.now(), name: designName(S.d), d: S.d });
        storeSet(list.slice(0, 24));
    }
    function delSaved(id) {
        if (!confirm('この作ったものを消しますか？')) return;
        storeSet(store().filter(function (x) { return x.id !== id; }));
        A.sound(660, .05); render();
    }

    // ---------------- 画像にする・保存・共有・印刷 ----------------
    function exportCanvas(d) {
        var f = FMTS[d.fmt];
        return Promise.all([loadFontsFor(d), loadImgsFor(d)]).then(function () {
            var c = document.createElement('canvas');
            c.width = f.w; c.height = f.h;
            renderDesign(c.getContext('2d'), d, f.w, f.h, {});
            return c;
        });
    }
    function canvasBlob(c) { return new Promise(function (res) { if (c.toBlob) c.toBlob(function (b) { res(b); }, 'image/png'); else res(null); }); }
    // ファイル名は英数字だけにする（日本語の名前だと、端末によっては「download」という名前になり、画像として開けないことがある）
    function stamp() {
        var t = new Date(), z = function (n) { return String(n).padStart(2, '0'); };
        return t.getFullYear() + z(t.getMonth() + 1) + z(t.getDate()) + '-' + z(t.getHours()) + z(t.getMinutes()) + z(t.getSeconds());
    }
    function fileName(d) { return (d.kind === 'poster' ? 'poster-' : d.kind === 'rec' ? 'osusume-' : 'pop-') + stamp() + '.png'; }
    function busy(on, msg) {
        S.busy = on;
        var b = host && host.querySelector('.pp-busy');
        if (b) { b.hidden = !on; b.textContent = msg || ''; }
        if (host) host.querySelectorAll('[data-act="png"],[data-act="share"],[data-act="print"]').forEach(function (x) { x.disabled = on; });
    }
    function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }
    function savePng() {
        if (S.busy || !S.d) return;
        saveNow();
        busy(true, '画像を作っています…');
        exportCanvas(S.d).then(canvasBlob).then(function (b) {
            busy(false);
            if (!b) { A.error(); alert('画像を作れませんでした。'); return; }
            downloadBlob(b, fileName(S.d));
            A.toast('画像を保存しました（' + FMTS[S.d.fmt].w + '×' + FMTS[S.d.fmt].h + '）');
        }).catch(function (e) { busy(false); A.error(); alert('画像を作れませんでした。\n' + (e && e.message || '')); });
    }
    function canShareFiles() { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File(['x'], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; } }
    function sharePng() {
        if (S.busy || !S.d) return;
        saveNow();
        busy(true, '画像を作っています…');
        exportCanvas(S.d).then(canvasBlob).then(function (b) {
            busy(false);
            if (!b) { A.error(); return; }
            var file = new File([b], fileName(S.d), { type: 'image/png' });
            return navigator.share({ files: [file], title: designName(S.d) }).catch(function () {});
        }).catch(function () { busy(false); A.error(); });
    }
    // A4に何枚並ぶか（ふち 5mm）
    function tileOf(fmt) {
        var f = FMTS[fmt], m = f.mm;
        if (fmt === 'a4') return { cols: 1, rows: 1 };
        var cols = Math.max(1, Math.floor(200 / m[0] + 1e-6)), rows = Math.max(1, Math.floor(287 / m[1] + 1e-6));
        return { cols: cols, rows: rows };
    }
    function blobToDataUrl(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }
    function printPages(title, pages, fmt, tileOn) {
        // pages … [dataURL, …]。tileOn の時は、同じ物を A4 に並べる（切り取り線つき）
        var f = FMTS[fmt], t = tileOf(fmt), n = tileOn ? t.cols * t.rows : 1;
        var css = '@page { size: A4 portrait; margin: 0; } body { margin: 0; background: #fff; }'
            + ' .pg { width: 210mm; height: 297mm; display: flex; align-items: center; justify-content: center; page-break-after: always; break-after: page; overflow: hidden; }'
            + ' .pg:last-child { page-break-after: auto; break-after: auto; }'
            + ' .grid { display: grid; grid-template-columns: repeat(' + (tileOn ? t.cols : 1) + ', ' + (fmt === 'a4' ? 210 : f.mm[0]) + 'mm); }'
            + ' .grid img { display: block; width: ' + (fmt === 'a4' ? 210 : f.mm[0]) + 'mm; height: ' + (fmt === 'a4' ? 297 : f.mm[1]) + 'mm; outline: ' + (tileOn && n > 1 ? '0.2mm dashed #bbb' : 'none') + '; }'
            + ' @media screen { body { background: #e9e9ee; } .pg { background: #fff; margin: 12px auto; box-shadow: 0 2px 10px rgba(0,0,0,.15); transform-origin: top center; } }';
        var body = pages.map(function (src) { return '<div class="pg"><div class="grid">' + new Array(n + 1).join('<img src="' + src + '" alt="">') + '</div></div>'; }).join('');
        A.openPrintDoc(title, body, css, tileOn && n > 1 ? 'A4に' + n + '枚ならべて印刷します（点線で切ってください）' : 'A4の紙に印刷します');
    }
    function printOne() {
        if (S.busy || !S.d) return;
        saveNow();
        busy(true, '印刷の用意をしています…');
        var d = S.d, tileOn = S.printTile && d.fmt !== 'a4';
        exportCanvas(d).then(canvasBlob).then(blobToDataUrl).then(function (u) { busy(false); printPages(designName(d), [u], d.fmt, tileOn); })
            .catch(function () { busy(false); A.error(); });
    }

    // ---------------- 画面 ----------------
    function esc(s) { return A.esc(String(s == null ? '' : s)); }
    var ROLE_LABEL = { title: '商品名', basis: 'No.1の根拠', catch: 'ひとこと', desc: '説明', price: '値段', pricesub: '値段の注記', note: '下の小さな文字', brand: 'お店の名前', event: '販売会の名前', date: '日付', place: '時間・場所', fhead: 'おすすめの見出し', fname: 'おすすめの名前', fdesc: 'おすすめの説明', mhead: 'メニューの見出し', free: '文字', orgs: '実施団体・コラボ団体', fprice: 'おすすめの値段', rtitle: '見出し', rsub: '見出しの下', rname: '商品名', rprice: '値段', rcomm: 'コメント', rword: '吹き出しの一語', rnote: '下の小さな文字' };
    function thumbHtml(p) {
        var ph = A.photo(p.name);
        if (ph) return '<img src="' + ph + '" alt="">';
        var a = A.art(p);
        return a && window.MENU_ART ? MENU_ART.svg(a) : '';
    }
    function listHtml() {
        var ps = A.products(), saved = store();
        return '<div class="pp-list">'
            + '<p class="settings-hint" style="margin-top:0;">商品を押すと、POPの下書きを自動で作ります。文字・飾り・テンプレートを直して、画像で保存・印刷できます。</p>'
            + '<div class="pp-top">'
            + '<button type="button" class="action-btn btn-checkout" data-act="poster"' + (ps.length ? '' : ' disabled') + '><svg class="ic"><use href="#ic-image"/></svg>販売会のポスターを作る</button>'
            + '<button type="button" class="action-btn btn-checkout" data-act="recposter"' + (ps.length ? '' : ' disabled') + '><svg class="ic"><use href="#ic-star"/></svg>おすすめ商品のポスターを作る</button>'
            + '<button type="button" class="action-btn btn-secondary" data-act="batch"' + (ps.length ? '' : ' disabled') + '><svg class="ic"><use href="#ic-printer"/></svg>まとめて作る（A4にならべる）</button>'
            + '</div>'
            + '<label class="field-label sec">商品のPOPを作る</label>'
            + (ps.length ? '<div class="pp-plist">' + ps.map(function (p) {
                return '<button type="button" class="pp-prod" data-act="pop" data-id="' + esc(p.id) + '"><span class="pp-pt" style="--ink:' + A.catInk(p.type) + '">' + thumbHtml(p) + '</span><span class="pp-pn">' + esc(p.name) + '</span><span class="pp-pp">' + esc(A.priceInfo(p).main) + '</span></button>';
            }).join('') + '</div>' : '<p class="settings-hint">販売する商品がまだありません。「商品と仕入れ数」か「商品・在庫の調整」で入れてください。</p>')
            + noPhotoHtml(ps)
            + (saved.length ? '<label class="field-label sec">作ったもの（この端末）</label><div class="pp-saved">' + saved.map(function (x) {
                return '<div class="pp-sv"><button type="button" class="pp-svb" data-act="open" data-id="' + esc(x.id) + '"><canvas class="pp-th" data-thumb="' + esc(x.id) + '" aria-hidden="true"></canvas><span>' + esc(x.name) + '</span><small>' + esc(FMTS[x.d.fmt] ? FMTS[x.d.fmt].label : '') + '</small></button>'
                    + '<button type="button" class="pp-del" data-act="delsaved" data-id="' + esc(x.id) + '" aria-label="' + esc(x.name) + 'を消す"><svg class="ic"><use href="#ic-trash"/></svg></button>'
                    + '<button type="button" class="pp-del pp-dupb" data-act="dupsaved" data-id="' + esc(x.id) + '" aria-label="' + esc(x.name) + 'を複製"><svg class="ic"><use href="#ic-copy"/></svg></button></div>';
            }).join('') + '</div>' : '')
            + '<p class="settings-hint pp-lic">素材について：テンプレート・イラスト・飾りは、このアプリのために作った物です。文字は Google Fonts の日本語フォント（SIL Open Font License 1.1）を使っていて、作った画像・印刷物は自由に使えます。AIで作った画像は使っていません。</p>'
            + '</div>';
    }
    // 写真の無い商品に、ここから写真を付ける（付けた写真は、レジ・在庫・モバイルオーダーにも出る）
    function noPhotoHtml(ps) {
        if (!A.pickProductPhoto) return '';
        var no = ps.filter(function (p) { return !A.photo(p.name); });
        if (!no.length) return '';
        return '<details class="pp-more pp-nophoto"><summary>写真の無い商品に写真を付ける（' + no.length + '）</summary>'
            + '<p class="settings-hint" style="margin-top:4px;">写真を付けると、POPの下書きはイラストの代わりに写真で作ります。レジのボタン・在庫の画面・モバイルオーダーにも同じ写真が出ます。</p>'
            + '<div class="pp-row pp-wrap">' + no.map(function (p) { return '<button type="button" class="pp-chip" data-act="prodphoto" data-v="' + esc(p.name) + '"><svg class="ic"><use href="#ic-image"/></svg>' + esc(p.name) + '</button>'; }).join('') + '</div></details>';
    }
    function fmtChips() {
        return '<div class="pp-fmt" role="group" aria-label="大きさ">' + FMT_ORDER.map(function (k) {
            return '<button type="button" class="pp-chip' + (S.d.fmt === k ? ' on' : '') + '" aria-pressed="' + (S.d.fmt === k) + '" data-act="fmt" data-v="' + k + '">' + FMTS[k].label + '</button>';
        }).join('') + '</div>';
    }
    function editHtml() {
        var poster = S.d.kind === 'poster', recP = S.d.kind === 'rec';
        var tabs = (recP ? [['rec', 'おすすめ商品']] : poster ? [['event', '販売会・メニュー']] : []).concat([['tpl', 'テンプレート'], ['text', '文字'], ['deco', '飾り'], ['img', '画像'], ['layer', '重なり']]);
        var t = tileOf(S.d.fmt), n = t.cols * t.rows;
        return '<div class="pp-edit">'
            + '<div class="pp-stage">'
            + '<div class="pp-bar">'
            + '<button type="button" class="pp-chip" data-act="list"><svg class="ic"><use href="#ic-left"/></svg>一覧へ</button>'
            + '<button type="button" class="pp-chip" data-act="undo"' + (S.hist.length ? '' : ' disabled') + '><svg class="ic"><use href="#ic-undo"/></svg>元に戻す</button>'
            + '<button type="button" class="pp-chip" data-act="redo"' + (S.fut && S.fut.length ? '' : ' disabled') + '><svg class="ic pp-flipx"><use href="#ic-undo"/></svg>やり直す</button>'
            + '<button type="button" class="pp-chip" data-act="regen"><svg class="ic"><use href="#ic-refresh"/></svg>作り直す</button>'
            + '</div>'
            + (function () { var g = priceGap(S.d); return g ? '<div class="pp-warn" role="status"><span>POPの値段（' + esc(g.el.text || '') + '）が、いまの登録の値段（' + esc(g.now.main) + '）と違います。</span><button type="button" class="pp-chip" data-act="fixprice">いまの値段にする</button></div>' : ''; })()
            + '<div class="pp-cv"><canvas id="pp-canvas" tabindex="0" aria-label="POPの見本。押すと文字や飾りを選び、指でずらせます"></canvas></div>'
            + '<div class="pp-quick" id="pp-quick">' + quickHtml() + '</div>'
            + '<p class="pp-tip">押すと選べます。指でずらす・四すみの丸で大きさ・上の丸で向きを変えます（2本の指で広げる・ひねるでも）。</p>'
            + fmtChips()
            + '<div class="pp-out">'
            + '<button type="button" class="action-btn btn-checkout" data-act="png"><svg class="ic"><use href="#ic-download"/></svg>画像で保存</button>'
            + (canShareFiles() ? '<button type="button" class="action-btn btn-secondary" data-act="share"><svg class="ic"><use href="#ic-upload"/></svg>共有</button>' : '')
            + '<button type="button" class="action-btn btn-secondary" data-act="print"><svg class="ic"><use href="#ic-printer"/></svg>印刷</button>'
            + '</div>'
            + '<label class="pp-check"><input type="checkbox" data-act="safe"' + (S.safe ? ' checked' : '') + '>印刷で切れやすい所の目安を出す（見本だけ）</label>'
            + (S.d.fmt !== 'a4' && n > 1 ? '<label class="pp-check"><input type="checkbox" data-act="tile"' + (S.printTile ? ' checked' : '') + '>印刷の時に、A4に' + n + '枚ならべる</label>' : '')
            + '<p class="pp-busy" hidden></p>'
            + '<p class="pp-font" aria-live="polite"></p>'
            + '</div>'
            + '<div class="pp-ctl">'
            + '<div class="pp-tabs" role="tablist">' + tabs.map(function (x) { return '<button type="button" role="tab" class="pp-tab' + (S.tab === x[0] ? ' on' : '') + '" aria-selected="' + (S.tab === x[0]) + '" data-act="tab" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'
            + '<div class="pp-panel">' + panelHtml() + '</div>'
            + '</div>'
            + '</div>';
    }
    // 見本の下の「すぐ直す」：選んだ物の文字・大きさ・向きを、下までスクロールせずに直す
    function quickHtml() {
        var e = selEl();
        if (!e) return '<p class="pp-qhint">見本の中の文字や写真を押すと、ここですぐ直せます。</p>';
        var btn = function (act, v, label, ic) { return '<button type="button" class="pp-qb" data-act="' + act + '"' + (v != null ? ' data-v="' + v + '"' : '') + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' + (ic ? '<svg class="ic"><use href="#ic-' + ic + '"/></svg>' : '') + '<span>' + esc(label) + '</span></button>'; };
        var out = '';
        if (e.t === 'text') out += '<textarea class="pp-qt" rows="' + Math.min(3, Math.max(1, (e.text || '').split('\n').length)) + '" data-act="text" maxlength="200" aria-label="文字">' + esc(e.text || '') + '</textarea>';
        if (e.t === 'stamp') out += '<input type="text" class="pp-qt" maxlength="16" data-act="stext" value="' + esc(e.text || '') + '" aria-label="スタンプの文字">';
        out += '<div class="pp-qrow">'
            + btn('qsz', '0.9', '小さく', 'minus') + btn('qsz', '1.1', '大きく', 'plus')
            + btn('qrot', '-10', '左へ回す', '') + btn('qrot', '10', '右へ回す', '')
            + (e.t === 'img' && /^(photo|user|art):/.test(e.src || '') ? btn('qswap', null, '写真を替える', 'image') : '')
            + btn('alignel', 'c', '左右の中へ', '')
            + btn('del', null, '消す', 'trash')
            + '</div>';
        return out;
    }
    function updateQuick() { var q = host && host.querySelector('#pp-quick'); if (q) q.innerHTML = quickHtml(); }
    function panelHtml() {
        if (S.tab === 'rec') return recPanel();
        if (S.tab === 'tpl') return tplPanel();
        if (S.tab === 'text') return textPanel();
        if (S.tab === 'deco') return decoPanel();
        if (S.tab === 'event') return eventPanel();
        if (S.tab === 'img') return imgPanel();
        if (S.tab === 'layer') return layerPanel();
        return '';
    }
    // ---- 画像：背景の画像・端末の写真・わたしの素材 ----
    function seg(act, cur, opts, label) {
        return '<div class="seg-pick pp-wrapseg" role="group" aria-label="' + esc(label || '') + '">' + opts.map(function (o) { var on = cur === o[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-act="' + act + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
    }
    function range(act, min, max, step, val, label) { return '<label class="field-label">' + label + '</label><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-act="' + act + '" aria-label="' + esc(label) + '">'; }
    function imgPanel() {
        var b = S.d.bg, se = selEl(), out = '';
        // 見本で画像を選んでいる時は、その画像を直す所を上に出す
        if (se && se.t === 'img') out += '<label class="field-label sec" style="margin-top:0;">選んでいる画像</label>' + elCtlHtml(se);
        out += '<label class="field-label sec">背景の画像</label>';
        if (b && b.src) {
            var u = USERURL[b.src.slice(5)];
            out += '<div class="pp-edbox">'
                + (u ? '<img class="pp-bgthumb" src="' + u + '" alt="">' : '')
                + '<label class="field-label">合わせ方</label>' + seg('bgfit', b.fit || 'cover', [['cover', '画面いっぱい'], ['contain', '全部見せる']], '合わせ方')
                + range('bgzoom', 1, 3, .01, b.zoom || 1, '大きさ')
                + range('bgpx', -1, 1, .01, b.px || 0, '横の位置')
                + range('bgpy', -1, 1, .01, b.py || 0, '縦の位置')
                + range('bgfade', 0, .8, .01, b.fade || 0, '文字を読みやすくする（うすくする）')
                + seg('bgdark', b.dark ? '1' : '0', [['0', '白くする'], ['1', '黒くする']], 'うすくする色')
                + range('bgblur', 0, 1, .01, b.blur || 0, 'ぼかす')
                + '<div class="pp-row"><button type="button" class="pp-chip" data-act="bgpick">画像を替える</button><button type="button" class="pp-chip pp-danger" data-act="bgdel">背景の画像を外す</button></div>'
                + '</div>';
        } else {
            out += '<button type="button" class="action-btn btn-secondary pp-wide" data-act="bgpick"><svg class="ic"><use href="#ic-image"/></svg>端末の画像を背景にする</button>'
                + '<p class="settings-hint" style="margin-top:4px;">写真をテンプレートの背景の代わりに敷きます。文字が読みにくい時は「うすくする」「ぼかす」で整えます。</p>';
        }
        out += '<label class="field-label sec">写真・イラストを足す</label><div class="pp-row">'
            + '<button type="button" class="action-btn btn-secondary pp-half" data-act="photopick"><svg class="ic"><use href="#ic-image"/></svg>端末の写真を足す</button>'
            + '<button type="button" class="action-btn btn-secondary pp-half" data-act="cutpick"><svg class="ic"><use href="#ic-pencil"/></svg>背景を消して足す</button>'
            + '</div><p class="settings-hint" style="margin-top:4px;">「背景を消して足す」は、商品の写真や季節の物の写真から、まわりを消して切り抜きます（白い台・単色の布の上で撮ると、きれいに消せます）。</p>'
            + '<label class="field-label sec">わたしの素材（この端末）</label>';
        var lib = S.lib;
        if (!lib) { libLoad(); out += '<p class="settings-hint">読み込んでいます…</p>'; }
        else if (!lib.length) out += '<p class="settings-hint">まだありません。読み込んだ写真・切り抜いた画像は、ここに残ります（ほかのPOPでも使えます）。</p>';
        else out += '<div class="pp-lib">' + lib.map(function (x) {
            var u = USERURL[x.id];
            return '<div class="pp-li"><button type="button" class="pp-art pp-lib-b' + (x.kind === 'cut' ? ' pp-cutbg' : '') + '" data-act="useradd" data-id="' + x.id + '" aria-label="' + (x.kind === 'cut' ? '切り抜いた画像' : '写真') + 'を足す">' + (u ? '<img src="' + u + '" alt="">' : '') + '</button>'
                + '<div class="pp-li-acts"><button type="button" class="pp-mini" data-act="userbg" data-id="' + x.id + '">背景に</button>' + (x.kind !== 'cut' ? '<button type="button" class="pp-mini" data-act="usercut" data-id="' + x.id + '">切り抜く</button>' : '') + (x.kind === 'photo' && A.setProductPhoto ? '<button type="button" class="pp-mini' + (S.prodFor === x.id ? ' on' : '') + '" data-act="userprod" data-id="' + x.id + '" aria-expanded="' + (S.prodFor === x.id) + '">商品の写真に</button>' : '') + '<button type="button" class="pp-mini pp-danger" data-act="userdel" data-id="' + x.id + '" aria-label="この素材を消す">消す</button></div>'
                + '</div>';
        }).join('') + '</div>' + (S.prodFor && libRec(S.prodFor) ? prodForHtml(S.prodFor) : '');
        return out;
    }
    // わたしの素材の写真を、商品の写真にする：どの商品かを選ぶ
    function prodForHtml(id) {
        var ps = A.products();
        if (!ps.length) return '<p class="settings-hint pp-pf">商品がまだありません。</p>';
        return '<div class="pp-pf"><label class="field-label">どの商品の写真にしますか</label><select class="pp-in" data-act="userprodsel" data-id="' + id + '"><option value="">商品を選ぶ</option>'
            + ps.map(function (p) { return '<option value="' + esc(p.name) + '">' + esc(p.name) + (A.photo(p.name) ? '（写真を替える）' : '') + '</option>'; }).join('') + '</select>'
            + '<p class="settings-hint" style="margin-top:4px;">レジのボタン・在庫の画面・モバイルオーダー・POP に、この写真が出ます（共有している時は、ほかの端末にも）。</p></div>';
    }
    function libLoad() {
        if (S.libLoading) return;
        S.libLoading = true;
        userAll().then(function (list) {
            S.lib = list.map(function (r) { if (!USERURL[r.id] && r.blob) USERURL[r.id] = URL.createObjectURL(r.blob); return { id: r.id, kind: r.kind, w: r.w, h: r.h, at: r.at }; });
        }).catch(function () { S.lib = []; }).then(function () { S.libLoading = false; if (S.view === 'edit' && S.tab === 'img') renderPanel(); });
    }
    // ---- 重なり：上にある物から並べる。出す／かくす・固定・上へ／下へ ----
    function layerPanel() {
        var els = S.d.els.slice().reverse();
        var out = '<p class="settings-hint" style="margin-top:0;">上にある物から並んでいます。「固定」した物は、見本の上で押しても選ばれません（背景の写真などに）。</p><div class="pp-layers">';
        out += els.map(function (e) {
            return '<div class="pp-ly' + (S.sel === e.id ? ' on' : '') + (e.hide ? ' hid' : '') + '">' + elRow(e)
                + '<div class="pp-ly-acts">'
                + '<button type="button" class="pp-mini" data-act="lhide" data-id="' + e.id + '" aria-pressed="' + !!e.hide + '">' + (e.hide ? '出す' : 'かくす') + '</button>'
                + '<button type="button" class="pp-mini' + (e.lock ? ' on' : '') + '" data-act="llock" data-id="' + e.id + '" aria-pressed="' + !!e.lock + '">' + (e.lock ? '固定をやめる' : '固定') + '</button>'
                + '<button type="button" class="pp-mini" data-act="lup" data-id="' + e.id + '" aria-label="ひとつ上へ">▲</button>'
                + '<button type="button" class="pp-mini" data-act="ldown" data-id="' + e.id + '" aria-label="ひとつ下へ">▼</button>'
                + '</div></div>';
        }).join('');
        if (S.d.bg && S.d.bg.src) out += '<div class="pp-ly"><button type="button" class="pp-er" data-act="tab" data-v="img"><b>背景の画像</b><span>見本のいちばん下</span></button></div>';
        return out + '</div>';
    }
    function tplPanel() {
        var t = tplOf(S.d), dn = S.d.kind === 'rec' ? S.d.dense !== false : !!S.d.dense;
        return '<label class="field-label" style="margin-top:0;">つめ方</label>' + seg('dense', dn ? '1' : '0', [['1', 'ぎっしり（文字と写真を大きく）'], ['0', 'ゆったり']], 'つめ方')
            + '<div class="pp-tpls">' + TPLS.map(function (x) {
            return '<button type="button" class="pp-tpl' + (x.id === S.d.tpl ? ' on' : '') + '" aria-pressed="' + (x.id === S.d.tpl) + '" data-act="tpl" data-v="' + x.id + '"><canvas data-tplthumb="' + x.id + '" aria-hidden="true"></canvas><span>' + x.label + '</span></button>';
        }).join('') + '</div>'
            + '<label class="field-label sec">配色</label><div class="pp-pals">' + t.pals.map(function (p, i) {
                return '<button type="button" class="pp-pal' + ((S.d.pal % t.pals.length) === i ? ' on' : '') + '" aria-label="配色 ' + (i + 1) + '" aria-pressed="' + ((S.d.pal % t.pals.length) === i) + '" data-act="pal" data-v="' + i + '" style="background:' + p.bg + '"><i style="background:' + p.ink + '"></i><i style="background:' + p.acc + '"></i><i style="background:' + (p.acc2 || p.acc) + '"></i></button>';
            }).join('') + '</div>';
    }
    function swatches(act, cur, d) {
        var p = palOf(d), keys = ['ink', 'sub', 'acc', 'acc2', 'acc3', 'onAcc'];
        var seen = {}, out = '';
        keys.forEach(function (k) { var c = p[k]; if (!c || seen[c]) return; seen[c] = 1; out += '<button type="button" class="pp-sw' + (cur === k ? ' on' : '') + '" style="background:' + c + '" data-act="' + act + '" data-k="' + k + '" aria-label="テンプレートの色 ' + k + '"></button>'; });
        ['#222222', '#FFFFFF', '#E2557F', '#E8792B', '#3B7A57', '#2F6DB5'].forEach(function (c) { if (seen[c]) return; seen[c] = 1; out += '<button type="button" class="pp-sw' + (cur === c ? ' on' : '') + '" style="background:' + c + '" data-act="' + act + '" data-c="' + c + '" aria-label="色 ' + c + '"></button>'; });
        return '<div class="pp-sws">' + out + '<label class="pp-sw pp-swc" aria-label="ほかの色"><input type="color" data-act="' + act + '" value="#888888"></label></div>';
    }
    function elRow(e) {
        var label = e.t === 'text' ? (ROLE_LABEL[e.role] || '文字') : e.t === 'stamp' ? 'スタンプ' : e.t === 'menu' ? 'メニュー' : e.t === 'qr' ? 'QRコード' : e.t === 'box' ? '台紙' : (e.cut ? '切り抜き' : e.src && /^(photo|user):/.test(e.src) ? '写真' : 'イラスト');
        var txt = e.t === 'text' || e.t === 'stamp' ? (e.text || '') : '';
        var ic = '';
        if (e.t === 'img') {
            if (e.src.indexOf('deco:') === 0) ic = decoSvg(e.src.slice(5));
            else if (e.src.indexOf('art:') === 0 && window.MENU_ART) ic = MENU_ART.svg(e.src.slice(4));
            else if (e.src.indexOf('photo:') === 0) { var u = A.photo(e.src.slice(6)); if (u) ic = '<img src="' + u + '" alt="">'; }
            else if (e.src.indexOf('user:') === 0) { var uu = USERURL[e.src.slice(5)]; if (uu) ic = '<img src="' + uu + '" alt="">'; }
        }
        return '<button type="button" class="pp-er' + (ic ? ' pp-eri' : '') + (e.cut ? ' pp-ercut' : '') + (e.hide ? ' pp-erhid' : '') + (S.sel === e.id ? ' on' : '') + '" data-act="sel" data-id="' + e.id + '">' + (ic ? '<i aria-hidden="true">' + ic + '</i>' : '') + '<b>' + esc(label) + '</b>' + (txt ? '<span translate="no">' + esc(txt.replace(/\n/g, ' ').slice(0, 24)) + '</span>' : '') + '</button>';
    }
    function commonCtl(e) {
        return range('rot', -180, 180, 1, e.rot || 0, '向き')
            + range('op', .1, 1, .01, e.op != null ? e.op : 1, 'こさ（透明度）')
            + '<label class="field-label">紙に合わせて揃える</label><div class="seg-pick pp-wrapseg" role="group" aria-label="紙に合わせて揃える">'
            + [['l', '左'], ['c', '左右の中'], ['r', '右'], ['t', '上'], ['m', '上下の中'], ['b', '下']].map(function (a) { return '<button type="button" data-act="alignel" data-v="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'
            + '<label class="pp-check"><input type="checkbox" data-act="shadow"' + (e.shadow ? ' checked' : '') + '>影を付ける</label>'
            + '<div class="pp-row">'
            + '<button type="button" class="pp-chip" data-act="front">手前へ</button>'
            + '<button type="button" class="pp-chip" data-act="back">奥へ</button>'
            + '<button type="button" class="pp-chip" data-act="dup">複製</button>'
            + (e.t === 'img' ? '<button type="button" class="pp-chip' + (e.flip ? ' on' : '') + '" data-act="flip" aria-pressed="' + !!e.flip + '">左右反転</button>' : '')
            + '<button type="button" class="pp-chip' + (e.lock ? ' on' : '') + '" data-act="lock" aria-pressed="' + !!e.lock + '">' + (e.lock ? '固定をやめる' : '固定') + '</button>'
            + '<button type="button" class="pp-chip pp-danger" data-act="del"><svg class="ic"><use href="#ic-trash"/></svg>消す</button>'
            + '</div>';
    }
    function textPanel() {
        var texts = S.d.els.filter(function (e) { return e.t === 'text'; });
        var e = selEl();
        if (e && e.t !== 'text') e = null;
        var out = '<div class="pp-els">' + texts.map(elRow).join('') + '<button type="button" class="pp-er pp-add" data-act="addtext"><b>＋ 文字を足す</b></button></div>';
        if (!e) return out + '<p class="settings-hint">直したい文字を、上か見本の中から選んでください。</p>';
        var fid = resolveFont(S.d, e), bold = resolveBold(S.d, e);
        askFonts();   // フォントを選ぶボタンの見本の字は、この時に読む
        out += '<div class="pp-edbox">'
            + (e.role === 'catch' && S.d.kind === 'pop' && productOf(S.d) ? '<div class="pp-row"><button type="button" class="pp-chip" data-act="nextcatch"><svg class="ic"><use href="#ic-refresh"/></svg>ひとことの案を替える</button></div>' : '')
            + '<label class="field-label">文字（改行もできます）</label><textarea class="pp-ta" rows="' + Math.min(5, Math.max(2, (e.text || '').split('\n').length + 1)) + '" data-act="text" maxlength="200">' + esc(e.text || '') + '</textarea>'
            + '<label class="field-label">フォント</label><div class="pp-fonts">' + FONTS.map(function (f) {
                return '<button type="button" class="pp-font-b' + (fid === f.id ? ' on' : '') + '" aria-pressed="' + (fid === f.id) + '" data-act="font" data-v="' + f.id + '" style="font-family:' + pickerFamily(f) + ';font-weight:' + fontWt(f, true) + '"><span class="pp-fs" translate="no">あ字A</span><small>' + f.label + '</small></button>';
            }).join('') + '</div>'
            + '<div class="pp-row"><label class="pp-check"><input type="checkbox" data-act="bold"' + (bold ? ' checked' : '') + '>太く</label><label class="pp-check"><input type="checkbox" data-act="vert"' + (e.vert ? ' checked' : '') + '>縦書き</label></div>'
            + '<label class="field-label">大きさ</label><input type="range" min="0.015" max="0.3" step="0.002" value="' + (e.size || .06) + '" data-act="size" aria-label="文字の大きさ">'
            + '<label class="field-label">' + (e.vert ? '列の長さ' : '幅（折り返す長さ）') + '</label><input type="range" min="0.15" max="1" step="0.01" value="' + (e.w || .8) + '" data-act="w" aria-label="幅">'
            + (e.vert ? '' : '<label class="field-label">行の間</label><input type="range" min="0.9" max="2.2" step="0.02" value="' + (e.lh || 1.28) + '" data-act="lh" aria-label="行の間">')
            + '<label class="field-label">揃え</label><div class="seg-pick" role="group" aria-label="揃え">' + [['left', '左'], ['center', '中'], ['right', '右']].map(function (a) { var on = (e.align || 'center') === a[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-act="align" data-v="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'
            + '<label class="field-label">文字の色</label>' + swatches('color', e.ck || e.color, S.d)
            + '<p class="pp-contrast hide" id="pp-contrast" role="status"></p>'
            + '<label class="field-label">文字の下の飾り</label><div class="seg-pick pp-wrapseg" role="group" aria-label="文字の下の飾り">' + [['', 'なし'], ['band', '帯'], ['round', 'まるい帯'], ['circle', 'まる'], ['bubble', '吹き出し'], ['tape', 'テープ'], ['line', '下線']].map(function (a) { var on = (e.box || '') === a[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-act="box" data-v="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'
            + (e.box ? '<label class="field-label">飾りの色</label>' + swatches('boxcolor', e.bk || e.boxColor, S.d) : '')
            + '<label class="field-label">ふち取り</label><div class="seg-pick" role="group" aria-label="ふち取り">' + [['', 'なし'], ['#FFFFFF', '白'], ['#222222', '黒'], ['acc', '色']].map(function (a) { var cur = e.sk || e.stroke || ''; var on = cur === a[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-act="stroke" data-v="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'
            + commonCtl(e)
            + '</div>';
        return out;
    }
    // 選んだ飾り・画像を直す所（「飾り」と「画像」で使う）
    function elCtlHtml(e) {
        var out = '<div class="pp-edbox">';
        if (e.t === 'stamp') {
            out += '<label class="field-label">スタンプの文字</label><input type="text" class="pp-in" maxlength="16" data-act="stext" value="' + esc(e.text || '') + '">'
                + '<label class="field-label">形</label><div class="seg-pick pp-wrapseg" role="group" aria-label="形">' + STAMP_STYLES.map(function (s) { var on = e.style === s[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-act="sstyle" data-v="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>'
                + '<label class="field-label">色</label>' + swatches('scolor', e.ck || e.color, S.d);
        }
        if (e.t === 'img' && /^(photo|user):/.test(e.src) && !e.cut) {
            var shp = e.shape || 'round';
            out += '<label class="field-label">写真の形</label>' + seg('shape', shp, [['round', '角まる'], ['circle', 'まる'], ['plain', '元の形']], '写真の形');
            // 商品の写真で、印刷用の大きい控えが無い時（前のしくみで付けた写真など）
            var pn = e.src.indexOf('photo:') === 0 ? e.src.slice(6) : '';
            if (pn && A.photoHQNow && A.pickProductPhoto && !A.photoHQNow(pn)) out += '<p class="settings-hint" style="margin-top:4px;">この写真は小さい物しか無いため、大きく印刷すると粗くなることがあります。写真を選び直すと、きれいに印刷できます（レジのボタンなどの写真も替わります）。</p>'
                + '<button type="button" class="pp-chip" data-act="prodphoto" data-v="' + esc(pn) + '">「' + esc(pn) + '」の写真を選び直す</button>';
            if (shp !== 'plain') out += range('zoom', 1, 3, .01, e.zoom || 1, '枠の中の写真の大きさ') + range('px', -1, 1, .01, e.px || 0, '枠の中の横の位置') + range('py', -1, 1, .01, e.py || 0, '枠の中の縦の位置')
                + (shp === 'round' ? range('far', .4, 1.6, .01, e.far || .78, '枠の縦の長さ') : '');
        }
        if (e.t === 'img' && (e.shape === 'plain' || !/^(photo|user):/.test(e.src) || e.cut)) {
            out += range('outline', 0, 1, .01, e.outline || 0, 'まわりの白いふち（シール風）');
        }
        if (e.t === 'img' && /^(photo|user):/.test(e.src) && !e.cut && (e.shape || 'round') !== 'plain') {
            var bcur = e.ek ? 'acc' : (e.border || '');
            out += '<label class="field-label">写真のふち</label>' + seg('pborder', bcur, [['', 'なし'], ['#FFFFFF', '白'], ['acc', '色']], '写真のふち');
        }
        if (e.t === 'box') out += '<label class="field-label">高さ</label><input type="range" min="0.05" max="1" step="0.005" value="' + (e.h || .3) + '" data-act="h">';
        if (e.t === 'qr') out += '<label class="field-label">QRコードの中身（アドレス）</label><input type="url" class="pp-in" data-act="qrurl" value="' + esc(e.url || '') + '" placeholder="https://…">';
        if (e.t === 'menu') {
            out += '<label class="field-label">列</label><div class="seg-pick" role="group" aria-label="列">' + [[1, '1列'], [2, '2列'], [3, '3列']].map(function (s) { var on = (e.cols || (e.items.length > 8 ? 2 : 1)) === s[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '" data-act="mcols" data-v="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>'
                + '<label class="field-label">文字の大きさ（入りきらない時は小さくなります）</label><input type="range" min="0.012" max="0.07" step="0.001" value="' + (e.size || .03) + '" data-act="size">'
                + '<label class="field-label">高さ</label><input type="range" min="0.08" max="0.8" step="0.01" value="' + (e.h || .2) + '" data-act="h">';
        }
        out += '<label class="field-label">大きさ</label><input type="range" min="0.04" max="' + (e.t === 'menu' ? 1 : e.t === 'img' ? 1.5 : .95) + '" step="0.005" value="' + (e.w || .3) + '" data-act="w" aria-label="大きさ">'
            + commonCtl(e) + '</div>';
        return out;
    }
    function decoPanel() {
        var e = selEl();
        if (e && e.t === 'text') e = null;
        var out = '<div class="pp-els">' + S.d.els.filter(function (x) { return x.t !== 'text'; }).map(elRow).join('') + '</div>';
        if (e) out += elCtlHtml(e);
        // 足す
        var t = tplOf(S.d);
        out += '<label class="field-label sec">スタンプを足す</label><div class="pp-stamps" translate="no">' + STAMP_WORDS.map(function (w) { return '<button type="button" class="pp-chip" data-act="addstamp" data-v="' + esc(w) + '">' + esc(w) + '</button>'; }).join('') + '</div>'
            + '<p class="settings-hint" style="margin-top:4px;">「期間限定」「焼きたて」「手作り」などは、本当にそうな時だけ使ってください。「No.1」「無添加」は、根拠や中身を書き添える決まりがあるので、スタンプには入れていません。</p>'
            + '<label class="field-label sec">イラストを足す</label><div class="pp-arts">' + DECO.map(function (x) { return '<button type="button" class="pp-art" data-act="adddeco" data-v="' + x.id + '" aria-label="' + esc(x.label) + '" title="' + esc(x.label) + '">' + decoSvg(x.id) + '</button>'; }).join('') + '</div>';
        var mine = A.products();
        var arts = window.MENU_ART ? MENU_ART.list : [];
        out += '<details class="pp-more"><summary>食べ物・飲み物の絵</summary><div class="pp-arts" translate="no">' + arts.map(function (x) { return '<button type="button" class="pp-art" data-act="addart" data-v="' + x.id + '" aria-label="' + esc(x.label) + '" title="' + esc(x.label) + '">' + MENU_ART.svg(x.id) + '</button>'; }).join('') + '</div></details>';
        var photos = mine.filter(function (p) { return A.photo(p.name); });
        if (photos.length) out += '<label class="field-label sec">商品の写真を足す</label><div class="pp-arts">' + photos.map(function (p) { return '<button type="button" class="pp-art pp-photo" data-act="addphoto" data-v="' + esc(p.name) + '" aria-label="' + esc(p.name) + 'の写真"><img src="' + A.photo(p.name) + '" alt=""></button>'; }).join('') + '</div>';
        out += '<label class="field-label sec">QRコードを足す</label><div class="pp-row"><input type="url" class="pp-in" id="pp-qrnew" placeholder="https://…（予約フォーム・注文ページなど）" value="' + esc(A.qrUrl()) + '"><button type="button" class="pp-chip" data-act="addqr">足す</button></div>';
        return out;
    }
    // ポスターに必ず入れる項目（販売会名・開催日時・開催場所・実施団体・コラボ団体・メニュー・一言コメント）
    function posterNeeds(d) {
        var ev = d.ev || {}, miss = [];
        if (!ev.name) miss.push('販売会名');
        if (!ev.date || !ev.time) miss.push('開催日時');
        if (!ev.place) miss.push('開催場所');
        if (!ev.org) miss.push('実施団体');
        if (!ev.collab && !ev.noCollab) miss.push('コラボ団体');
        if (!posterList(d).length) miss.push('メニュー');
        if (!ev.catch) miss.push('一言コメント');
        return miss;
    }
    function eventPanel() {
        var d = S.d, ev = d.ev || {};
        var f = function (k, label, ph, req) { return '<label class="field-label">' + label + (req && !ev[k] ? '<span class="pp-req">必ず入れる</span>' : '') + '</label><input type="text" class="pp-in" data-act="ev" data-k="' + k + '" value="' + esc(ev[k] || '') + '" placeholder="' + esc(ph || '') + '" maxlength="60">'; };
        var all = prods(d), mids = d.mids || all.map(function (p) { return p.id; }), fids = d.fids || [];
        var miss = posterNeeds(d), maxF = d.dense && FMTS[d.fmt].h > FMTS[d.fmt].w * 1.15 ? 6 : 3;
        return '<div class="pp-need' + (miss.length ? '' : ' ok') + '" role="status">' + (miss.length ? 'まだ入っていない項目：<b>' + miss.map(esc).join('・') + '</b>' : '必ず入れる項目（販売会名・開催日時・開催場所・実施団体・コラボ団体・メニュー・一言コメント）は、全部入っています。') + '</div>'
            + (A.plans && A.plans().length ? '<label class="field-label">販売会の予定から入れる</label><div class="pp-row pp-wrap">' + A.plans().map(function (p) { return '<button type="button" class="pp-chip" data-act="evplan" data-v="' + esc(p.id) + '">' + esc(p.label) + '</button>'; }).join('') + '</div>' : '')
            + '<div class="pp-edbox">'
            + f('name', '販売会名', '例：10月の臨時販売会', true) + f('date', '開催日', '例：10/17（金）', true) + f('time', '開催時間', '例：10:00〜12:00', true)
            + f('place', '開催場所', '例：○○会館前（雨の時は一号館一階）', true)
            + f('org', '実施団体', '例：泰山木', true)
            + (ev.noCollab ? '' : f('collab', 'コラボ団体', '例：カフェ ひだまり', true))
            + '<label class="pp-check"><input type="checkbox" data-act="nocollab"' + (ev.noCollab ? ' checked' : '') + '>コラボ団体はなし</label>'
            + f('catch', '一言コメント', '例：焼きたてのパンをご用意してお待ちしています', true)
            + f('shop', 'いちばん上の小さな文字（お店の名前など）', '例：泰山木') + f('note', 'いちばん下の文字', '例：雨天決行・売り切れの時はご容赦ください')
            + '</div>'
            + '<label class="field-label sec">おすすめ（' + maxF + 'つまで。写真か絵と名前を大きく出します）</label><div class="pp-checks">' + all.map(function (p) { var on = fids.indexOf(p.id) >= 0; return '<label class="pp-check"><input type="checkbox" data-act="feat" data-id="' + esc(p.id) + '"' + (on ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') + '</div>'
            + '<label class="field-label sec">メニューにのせる商品</label><div class="pp-checks">' + all.map(function (p) { var on = mids.indexOf(p.id) >= 0; return '<label class="pp-check"><input type="checkbox" data-act="mitem" data-id="' + esc(p.id) + '"' + (on ? ' checked' : '') + '>' + esc(p.name) + '　' + esc(A.priceInfo(p).main) + '</label>'; }).join('') + '</div>';
    }
    // おすすめ商品のポスター：商品にチェックを入れて選び、1品ずつ名前・値段・コメント・吹き出しの一語・写真を直す
    function recPanel() {
        var d = S.d, head = d.rhead || {}, items = d.rec || [], all = prods(d);
        var hf = function (k, label, ph) { return '<label class="field-label">' + label + '</label><input type="text" class="pp-in" data-act="rh" data-k="' + k + '" value="' + esc(head[k] || '') + '" placeholder="' + esc(ph || '') + '" maxlength="60">'; };
        var on = {}; items.forEach(function (it) { on[it.pid] = 1; });
        var out = '<div class="pp-edbox">' + hf('title', '見出し', '例：今日のおすすめ') + hf('sub', '見出しの下', '例：10月の臨時販売会') + hf('note', 'いちばん下の文字', '例：泰山木') + '</div>'
            + '<label class="field-label sec">おすすめにする商品（販売中の商品から、6つまで）</label><div class="pp-checks">' + all.map(function (p) { return '<label class="pp-check"><input type="checkbox" data-act="ritem" data-id="' + esc(p.id) + '"' + (on[p.id] ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') + '</div>';
        if (!items.length) return out + '<p class="settings-hint">商品にチェックを入れると、名前・写真・値段・コメント・吹き出しの一語を自動で入れます。</p>';
        out += '<label class="field-label sec">1品ずつ直す（自動で入れた文を、自由に直せます）</label>';
        items.forEach(function (it, i) {
            var u = it.pic && it.pic.indexOf('photo:') === 0 ? A.photo(it.pic.slice(6)) : it.pic && it.pic.indexOf('user:') === 0 ? USERURL[it.pic.slice(5)] : '';
            var art = it.pic && it.pic.indexOf('art:') === 0 && window.MENU_ART ? MENU_ART.svg(it.pic.slice(4)) : '';
            var f2 = function (k, label, max, ta) { return '<label class="field-label">' + label + '</label>' + (ta ? '<textarea class="pp-in pp-ta" rows="2" data-act="ri" data-i="' + i + '" data-k="' + k + '" maxlength="' + max + '">' + esc(it[k] || '') + '</textarea>' : '<input type="text" class="pp-in" data-act="ri" data-i="' + i + '" data-k="' + k + '" value="' + esc(it[k] || '') + '" maxlength="' + max + '">'); };
            out += '<div class="pp-ritem"><div class="pp-rtop"><span class="pp-rpic">' + (u ? '<img src="' + u + '" alt="">' : art) + '</span><b>' + (i + 1) + '. ' + esc(it.name) + '</b>'
                + '<button type="button" class="pp-mini" data-act="rup" data-v="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="前へ">▲</button><button type="button" class="pp-mini" data-act="rdown" data-v="' + i + '"' + (i < items.length - 1 ? '' : ' disabled') + ' aria-label="後へ">▼</button></div>'
                + f2('name', '名前', 30) + '<div class="pp-r2">' + f2('price', '値段', 20) + f2('word', '吹き出しの一語', 12) + '</div>' + f2('comment', 'コメント', 80, true)
                + '<div class="pp-row pp-wrap"><button type="button" class="pp-chip" data-act="rword" data-v="' + i + '">一語の案を替える</button><button type="button" class="pp-chip" data-act="rcomm" data-v="' + i + '">コメントの案を替える</button><button type="button" class="pp-chip" data-act="rphoto" data-v="' + i + '"><svg class="ic"><use href="#ic-image"/></svg>端末の写真にする</button>'
                + (A.photo(it.name) && it.pic !== 'photo:' + it.name ? '<button type="button" class="pp-chip" data-act="rprodpic" data-v="' + i + '">商品の写真にする</button>' : '') + '</div>'
                + '</div>';
        });
        return out;
    }
    // まとめて作る：選んだ商品のPOPを、A4にならべる
    function batchHtml() {
        var b = S.batch, ps = A.products();
        var t = tileOf(b.fmt);
        return '<div class="pp-list">'
            + '<div class="pp-bar"><button type="button" class="pp-chip" data-act="list"><svg class="ic"><use href="#ic-left"/></svg>一覧へ</button></div>'
            + '<p class="settings-hint" style="margin-top:0;">選んだ商品のPOPを、A4の紙に' + (t.cols * t.rows) + '枚ずつならべます（点線で切って使います）。一度直して残してあるPOP（同じ大きさ）は、直した形を使います。</p>'
            + '<label class="field-label">大きさ</label><div class="pp-fmt">' + ['card', 'popL', 'popP'].map(function (k) { return '<button type="button" class="pp-chip' + (b.fmt === k ? ' on' : '') + '" data-act="bfmt" data-v="' + k + '">' + FMTS[k].label + '（' + tileOf(k).cols * tileOf(k).rows + '枚）</button>'; }).join('') + '</div>'
            + '<label class="field-label">テンプレート</label><div class="pp-fmt">' + TPLS.map(function (x) { return '<button type="button" class="pp-chip' + (b.tpl === x.id ? ' on' : '') + '" data-act="btpl" data-v="' + x.id + '">' + x.label + '</button>'; }).join('') + '</div>'
            + '<label class="field-label sec">商品</label><div class="pp-row"><button type="button" class="pp-chip" data-act="ball">全部選ぶ</button><button type="button" class="pp-chip" data-act="bnone">選ぶのをやめる</button></div>'
            + '<div class="pp-checks">' + ps.map(function (p) { var on = b.ids.indexOf(p.id) >= 0; return '<label class="pp-check"><input type="checkbox" data-act="bitem" data-id="' + esc(p.id) + '"' + (on ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') + '</div>'
            + '<div class="pp-out"><button type="button" class="action-btn btn-checkout" data-act="bmake"' + (b.ids.length ? '' : ' disabled') + '>A4にならべて作る（' + Math.max(1, Math.ceil(b.ids.length / (t.cols * t.rows))) + '枚）</button></div>'
            + '<p class="pp-busy" hidden></p>'
            + (b.pages ? '<div class="pp-pages">' + b.pages.map(function (u, i) { return '<figure><img src="' + u + '" alt="' + (i + 1) + '枚目"><figcaption>' + (i + 1) + '枚目</figcaption></figure>'; }).join('') + '</div>'
                + '<div class="pp-out"><button type="button" class="action-btn btn-checkout" data-act="bpng"><svg class="ic"><use href="#ic-download"/></svg>画像で保存</button><button type="button" class="action-btn btn-secondary" data-act="bprint"><svg class="ic"><use href="#ic-printer"/></svg>印刷</button></div>' : '')
            + '</div>';
    }
    function batchMake() {
        var b = S.batch, f = FMTS[b.fmt], t = tileOf(b.fmt), per = t.cols * t.rows;
        var ps = A.products().filter(function (p) { return b.ids.indexOf(p.id) >= 0; });
        if (!ps.length) { A.error(); return; }
        var saved = store();
        var stale = 0;
        var designs = ps.map(function (p) {
            var s = saved.filter(function (x) { return x.d.kind === 'pop' && x.d.pid === p.id && x.d.fmt === b.fmt; })[0];
            if (!s) return genPop(p, b.fmt, b.tpl, 0);
            // 前に直したPOPの値段が、いまの値段と違う時：値段だけの文字なら、いまの値段に直す（ほかの書き方なら、そのままにして知らせる）
            var d = clone(s.d), g = priceGap(d);
            if (g && /^¥[\d,]+$/.test((g.el.text || '').trim())) {
                g.el.text = g.now.main;
                var sub = d.els.filter(function (x) { return x.role === 'pricesub'; })[0];
                if (sub && g.now.sub) sub.text = g.now.sub; else if (sub) d.els = d.els.filter(function (x) { return x !== sub; });
            } else if (g) stale++;
            return d;
        });
        if (stale) A.toast('値段の書き方を変えてあるPOPが' + stale + '枚あり、いまの値段と違います。開いて確かめてください');
        busy(true, 'POPを作っています…');
        var mm = 300 / 25.4, PW = 2480, PH = 3508;
        var all = { v: 1, els: [] };
        // 背景の画像も、先に読んでおく
        designs.forEach(function (d) { all.els = all.els.concat(d.els); if (d.bg && d.bg.src) all.els.push({ t: 'img', src: d.bg.src }); });
        Promise.all([loadFontsFor(all), loadImgsFor(all)]).then(function () {
            var pages = [];
            for (var i = 0; i < designs.length; i += per) {
                var c = document.createElement('canvas'); c.width = PW; c.height = PH;
                var ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PW, PH);
                var gw = t.cols * f.w, gh = t.rows * f.h, ox = (PW - gw) / 2, oy = (PH - gh) / 2;
                designs.slice(i, i + per).forEach(function (d, k) {
                    var cx = ox + (k % t.cols) * f.w, cy = oy + Math.floor(k / t.cols) * f.h;
                    var cc = document.createElement('canvas'); cc.width = f.w; cc.height = f.h;
                    renderDesign(cc.getContext('2d'), d, f.w, f.h, {});
                    ctx.drawImage(cc, cx, cy);
                });
                // 切り取り線
                ctx.strokeStyle = '#BBBBBB'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]);
                for (var cI = 0; cI <= t.cols; cI++) { ctx.beginPath(); ctx.moveTo(ox + cI * f.w, oy - 5 * mm); ctx.lineTo(ox + cI * f.w, oy + gh + 5 * mm); ctx.stroke(); }
                for (var rI = 0; rI <= t.rows; rI++) { ctx.beginPath(); ctx.moveTo(ox - 5 * mm, oy + rI * f.h); ctx.lineTo(ox + gw + 5 * mm, oy + rI * f.h); ctx.stroke(); }
                pages.push(c.toDataURL('image/png'));
            }
            b.pages = pages; busy(false); render();
        }).catch(function () { busy(false); A.error(); });
    }
    function dataUrlBlob(u) { var i = u.indexOf(','), bin = atob(u.slice(i + 1)), arr = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k); return new Blob([arr], { type: 'image/png' }); }

    // ---------------- 描き直し ----------------
    function render() {
        if (!host) return;
        if (S.view === 'edit' && !S.d) S.view = 'list';
        host.innerHTML = S.view === 'edit' ? editHtml() : S.view === 'batch' ? batchHtml() : listHtml();
        if (S.view === 'edit') { setupCanvas(); drawTplThumbs(); showFontState(); }
        if (S.view === 'list') drawSavedThumbs();
    }
    function renderPanel() {
        var p = host && host.querySelector('.pp-panel');
        if (!p) return render();
        p.innerHTML = panelHtml();
        host.querySelectorAll('.pp-tab').forEach(function (b) { var on = b.dataset.v === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
        histBtns();
        drawTplThumbs();
        updateQuick();
        if (S.tab === 'text') contrastSoon();
    }
    function drawSavedThumbs() {
        var saved = store();
        host.querySelectorAll('canvas[data-thumb]').forEach(function (c) {
            var x = saved.filter(function (s) { return s.id === c.dataset.thumb; })[0];
            if (!x || !FMTS[x.d.fmt]) return;
            var f = FMTS[x.d.fmt], w = 120, h = Math.round(w * f.h / f.w);
            c.width = w * 2; c.height = h * 2; c.style.width = w + 'px'; c.style.height = h + 'px';
            try { renderDesign(c.getContext('2d'), x.d, c.width, c.height, {}); } catch (e) {}
        });
    }
    var thT = 0;
    function drawTplThumbsSoon() { clearTimeout(thT); thT = setTimeout(function () { drawTplThumbs(); if (host && S.view === 'list') drawSavedThumbs(); }, 200); }
    function drawTplThumbs() {
        if (!host || S.tab !== 'tpl' || !S.d) return;
        host.querySelectorAll('canvas[data-tplthumb]').forEach(function (c) {
            var id = c.dataset.tplthumb, f = FMTS[S.d.fmt];
            var nd = S.thumbs[id + '|' + S.d.fmt + '|' + S.d.id + '|' + S.d.var];
            if (!nd) { nd = genFor(S.d, id, S.d.fmt, S.d.var || 0); if (nd) { nd = carry(S.d, nd, true); nd.pal = 0; S.thumbs[id + '|' + S.d.fmt + '|' + S.d.id + '|' + S.d.var] = nd; } }
            if (!nd) return;
            var w = 110, h = Math.round(w * f.h / f.w);
            if (h > 130) { h = 130; w = Math.round(h * f.w / f.h); }
            c.width = w * 2; c.height = h * 2; c.style.width = w + 'px'; c.style.height = h + 'px';
            try { renderDesign(c.getContext('2d'), nd, c.width, c.height, {}); } catch (e) {}
        });
    }
    function showFontState() {
        var el = host && host.querySelector('.pp-font');
        if (!el) return;
        el.textContent = S.fontState === 'off' ? '文字の形（フォント）を読み込めませんでした。インターネットにつながる所で開き直すと、選んだフォントで描きます（いまは端末の文字で描いています）。' : (S.fontState === 'wait' ? '文字の形（フォント）を読み込んでいます…' : '');
    }
    var cvs = null;
    function setupCanvas() {
        cvs = host.querySelector('#pp-canvas');
        if (!cvs) return;
        sizeCanvas();
        cvs.addEventListener('pointerdown', onDown);
        cvs.addEventListener('pointermove', onMove);
        cvs.addEventListener('pointerup', onUp);
        cvs.addEventListener('pointercancel', onUp);
        cvs.addEventListener('keydown', onKey);
        // 選べる物の上で指を置いた時だけ、画面のスクロールを止める（何もない所なら、そのままスクロールできる）
        cvs.addEventListener('touchstart', function (ev) {
            var t = ev.touches[0];
            if ((S.sel && ev.touches.length >= 2) || (t && (hitHandle(t.clientX, t.clientY) || hitAt(t.clientX, t.clientY)))) ev.preventDefault();
        }, { passive: false });
    }
    function sizeCanvas() {
        if (!cvs || !S.d) return;
        var f = FMTS[S.d.fmt], wrapEl = cvs.parentElement;
        var cw = wrapEl.clientWidth || 320, maxH = Math.max(240, window.innerHeight * (window.innerWidth >= 900 ? .7 : .56));
        var w = Math.min(cw, maxH * f.w / f.h), h = w * f.h / f.w;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        cvs.style.width = Math.round(w) + 'px'; cvs.style.height = Math.round(h) + 'px';
        cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
        drawNow();
    }
    function drawSoon() { if (S.raf) return; S.raf = requestAnimationFrame(function () { S.raf = 0; drawNow(); }); }
    function drawNow() {
        if (!cvs || !cvs.isConnected || !S.d || S.view !== 'edit') return;
        loadFontsFor(S.d);
        S.boxes = [];
        renderDesign(cvs.getContext('2d'), S.d, cvs.width, cvs.height, { rec: S.boxes, sel: S.sel, hs: handleSize(), guides: S.guides, safe: S.safe });
        if (S.tab === 'text') contrastSoon();
    }
    // ---- 文字と後ろの色が近すぎないか（読みにくい方がいるので知らせる。直すかどうかは作る人が決める） ----
    // 選んでいる文字だけを透明にして小さく描き、文字の四角の中の色を集めて、文字の色との明るさの比（コントラスト）を出す。
    // 大きな文字の目安 3：1 より低い時に知らせる。ふち取りを付けている時は、読みやすいので知らせない。
    var CT = 0;
    function contrastSoon() { clearTimeout(CT); CT = setTimeout(contrastCheck, 400); }
    function rgbOf(c) {
        var x = document.createElement('canvas').getContext('2d');
        x.fillStyle = '#000'; x.fillStyle = String(c || '#000');
        var v = x.fillStyle;
        if (v.charAt(0) === '#') { var n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
        var m = v.match(/[\d.]+/g) || [0, 0, 0];
        return [Number(m[0]), Number(m[1]), Number(m[2])];
    }
    function relLum(r) {
        var f = function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        return .2126 * f(r[0]) + .7152 * f(r[1]) + .0722 * f(r[2]);
    }
    function contrastOf(a, b) { var x = relLum(a), y = relLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
    function contrastCheck() {
        var el = host && host.querySelector('#pp-contrast');
        if (!el || !S.d || !cvs) return;
        var e = selEl(), b = e && (S.boxes || []).filter(function (x) { return x.id === e.id; })[0];
        if (!e || e.t !== 'text' || !String(e.text || '').trim() || !b || col(S.d, e, 'sk', 'stroke')) { el.classList.add('hide'); return; }
        var k = Math.min(1, 360 / cvs.width), W = Math.round(cvs.width * k), H = Math.round(cvs.height * k);
        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var g = c.getContext('2d');
        var dd = Object.assign({}, S.d, { els: S.d.els.map(function (x) { return x.id === e.id ? Object.assign({}, x, { ck: '', color: 'rgba(0,0,0,0)', sk: '', stroke: '', shadow: false }) : x; }) });
        g.save(); g.scale(k, k); renderDesign(g, dd, cvs.width, cvs.height, {}); g.restore();
        var x0 = Math.max(0, Math.floor((b.cx + b.x0) * k)), y0 = Math.max(0, Math.floor((b.cy + b.y0) * k));
        var x1 = Math.min(W, Math.ceil((b.cx + b.x1) * k)), y1 = Math.min(H, Math.ceil((b.cy + b.y1) * k));
        if (x1 - x0 < 2 || y1 - y0 < 2) { el.classList.add('hide'); return; }
        var px = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, tc = rgbOf(col(S.d, e, 'ck', 'color') || '#222'), rs = [];
        for (var i = 0; i < px.length; i += 4 * 3) if (px[i + 3] > 200) rs.push(contrastOf(tc, [px[i], px[i + 1], px[i + 2]]));
        if (!rs.length) { el.classList.add('hide'); return; }
        rs.sort(function (a, z) { return a - z; });
        var r = rs[Math.floor(rs.length * .25)];   // 文字の後ろの、薄い方から4分の1の所で見る（模様・写真の上でも、読みにくい所を見落とさない）
        var low = r < 3;
        el.classList.toggle('hide', !low);
        if (low) el.innerHTML = '<svg class="ic"><use href="#ic-alert"/></svg><span>文字と後ろの色が近く、読みにくい方がいます（明るさの比 ' + r.toFixed(1) + '：1。3：1 以上が目安）。文字の色を変えるか、「ふち取り」「文字の下の飾り」を付けると読みやすくなります。</span>';
    }
    // 画面の点（CSS）→ キャンバスの点
    function canvasPt(clientX, clientY) {
        var r = cvs.getBoundingClientRect(), k = cvs.width / Math.max(1, r.width);
        return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
    }
    function handleSize() { if (!cvs) return 8; var r = cvs.getBoundingClientRect(); return 9 * cvs.width / Math.max(1, r.width); }   // 画面で 9px の丸
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    // 押した所にある物（上にある物から。固定した物は選ばない）
    function hitAt(clientX, clientY) {
        if (!cvs) return null;
        var p = canvasPt(clientX, clientY);
        for (var i = S.boxes.length - 1; i >= 0; i--) {
            var b = S.boxes[i], a = -(b.rot || 0) * Math.PI / 180;
            if (b.lock) continue;
            var dx = p.x - b.cx, dy = p.y - b.cy;
            var lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
            if (lx >= b.x0 && lx <= b.x1 && ly >= b.y0 && ly <= b.y1) return b.id;
        }
        return null;
    }
    // 選んだ物の取っ手（四すみ＝大きさ、上の丸＝向き）
    function hitHandle(clientX, clientY) {
        if (!S.sel || !cvs) return null;
        var e = selEl();
        if (!e || e.lock) return null;
        var b = S.boxes.filter(function (x) { return x.id === S.sel; })[0];
        if (!b) return null;
        var p = canvasPt(clientX, clientY), hs = handleSize(), a = (b.rot || 0) * Math.PI / 180, reach = hs * 2.6;
        var at = function (lx, ly) { return { x: b.cx + lx * Math.cos(a) - ly * Math.sin(a), y: b.cy + lx * Math.sin(a) + ly * Math.cos(a) }; };
        if (dist(p, at((b.x0 + b.x1) / 2, b.y0 - hs * 3.4)) < reach) return { kind: 'rot', b: b };
        var cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
        for (var i = 0; i < cs.length; i++) if (dist(p, at(cs[i][0], cs[i][1])) < reach) return { kind: 'scale', b: b };
        return null;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    // 大きさを k 倍にする（文字は字の大きさと幅、メニューは幅と高さ、ほかは幅）
    function applyScale(e, g, k) {
        if (e.t === 'text') { e.size = clamp(g.s0 * k, .008, .5); e.w = clamp(g.w0 * k, .06, 1.4); }
        else if (e.t === 'menu') { e.w = clamp(g.w0 * k, .1, 1.3); e.h = clamp(g.h0 * k, .04, 1.2); e.size = clamp(g.s0 * k, .006, .12); }
        else e.w = clamp(g.w0 * k, .02, 2);
    }
    // 向き：0°・90°・180° の近くでは、そこにぴったり合わせる
    function snapRot(r) {
        r = ((r % 360) + 540) % 360 - 180;
        [0, 90, -90, 180, -180].forEach(function (q) { if (Math.abs(r - q) < 4) r = q; });
        return Math.round(r);
    }
    function startTransform(e) { return { id: e.id, w0: e.w || .3, s0: e.size || .06, h0: e.h || .2, r0: e.rot || 0, pushed: false, moved: false }; }
    function onDown(ev) {
        S.ptrs = S.ptrs || {};
        S.ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        try { cvs.setPointerCapture(ev.pointerId); } catch (er) {}
        var ids = Object.keys(S.ptrs);
        // 2本の指：選んだ物を、広げて大きく・ひねってまわす
        if (ids.length === 2 && S.sel) {
            var e2 = selEl();
            if (e2 && !e2.lock) {
                var p1 = canvasPt(S.ptrs[ids[0]].x, S.ptrs[ids[0]].y), p2 = canvasPt(S.ptrs[ids[1]].x, S.ptrs[ids[1]].y);
                if (S.drag && S.drag.pushed) S.drag.done = true;
                S.drag = null;
                S.pinch = Object.assign(startTransform(e2), { d0: dist(p1, p2), a0: Math.atan2(p2.y - p1.y, p2.x - p1.x) });
            }
            return;
        }
        var h = hitHandle(ev.clientX, ev.clientY);
        if (h) {
            var eh = selEl(), ph = canvasPt(ev.clientX, ev.clientY);
            S.drag = Object.assign(startTransform(eh), { mode: h.kind, cx: h.b.cx, cy: h.b.cy, d0: dist(ph, { x: h.b.cx, y: h.b.cy }), a0: Math.atan2(ph.y - h.b.cy, ph.x - h.b.cx) });
            return;
        }
        var id = hitAt(ev.clientX, ev.clientY);
        if (!id) { if (S.sel) { S.sel = null; drawNow(); renderPanel(); } return; }
        var e = elById(id);
        S.drag = { mode: 'move', id: id, sx: ev.clientX, sy: ev.clientY, ex: e.x, ey: e._y != null ? e._y : e.y, moved: false, pushed: false };
        if (S.sel !== id) {
            S.sel = id;
            var want = e.t === 'text' ? 'text' : 'deco';
            if (S.tab !== want && S.tab !== 'layer' && S.tab !== 'img') S.tab = want;
            renderPanel();
        }
        drawNow();
    }
    function onMove(ev) {
        if (S.ptrs && S.ptrs[ev.pointerId]) S.ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        var pz = S.pinch;
        if (pz) {
            var ids = Object.keys(S.ptrs || {}), ep = elById(pz.id);
            if (ids.length < 2 || !ep) return;
            var p1 = canvasPt(S.ptrs[ids[0]].x, S.ptrs[ids[0]].y), p2 = canvasPt(S.ptrs[ids[1]].x, S.ptrs[ids[1]].y);
            if (!pz.pushed) { pushHist(); pz.pushed = true; }
            pz.moved = true;
            applyScale(ep, pz, dist(p1, p2) / Math.max(1, pz.d0));
            ep.rot = snapRot(pz.r0 + (Math.atan2(p2.y - p1.y, p2.x - p1.x) - pz.a0) * 180 / Math.PI);
            drawSoon();
            return;
        }
        var g = S.drag;
        if (!g) return;
        var e = elById(g.id);
        if (!e) return;
        if (g.mode === 'scale' || g.mode === 'rot') {
            var p = canvasPt(ev.clientX, ev.clientY);
            if (!g.pushed) { pushHist(); g.pushed = true; }
            g.moved = true;
            if (g.mode === 'scale') applyScale(e, g, Math.max(.1, dist(p, { x: g.cx, y: g.cy }) / Math.max(1, g.d0)));
            else e.rot = snapRot(g.r0 + (Math.atan2(p.y - g.cy, p.x - g.cx) - g.a0) * 180 / Math.PI);
            drawSoon();
            return;
        }
        var r = cvs.getBoundingClientRect();
        var dx = (ev.clientX - g.sx) / r.width, dy = (ev.clientY - g.sy) / r.height;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < .006) return;
        if (!g.pushed) { pushHist(); g.pushed = true; }
        g.moved = true;
        if (e.grp) { e.y = g.ey; delete e.grp; }
        // 真ん中・ほかの物の真ん中の近くでは、ぴったり合わせる（赤い点線が出る）
        var nx = clamp(g.ex + dx, -.1, 1.1), ny = clamp(g.ey + dy, -.1, 1.1), gd = null;
        if (!g.snaps) {
            g.snaps = { xs: [.5], ys: [.5] };
            S.boxes.forEach(function (b) { if (b.id !== g.id) { g.snaps.xs.push(b.cx / cvs.width); g.snaps.ys.push(b.cy / cvs.height); } });
        }
        var near = function (v, list) { var best = null; list.forEach(function (q) { if (Math.abs(v - q) < .012 && (best === null || Math.abs(v - q) < Math.abs(v - best))) best = q; }); return best; };
        var sx = near(nx, g.snaps.xs), sy = near(ny, g.snaps.ys);
        if (sx !== null) { nx = sx; gd = { xs: [sx], ys: [] }; }
        if (sy !== null) { ny = sy; gd = gd || { xs: [], ys: [] }; gd.ys = [sy]; }
        S.guides = gd;
        e.x = nx; e.y = ny;
        drawSoon();
    }
    function onUp(ev) {
        if (S.ptrs && ev) delete S.ptrs[ev.pointerId];
        var moved = (S.drag && S.drag.moved) || (S.pinch && S.pinch.moved);
        if (S.pinch && Object.keys(S.ptrs || {}).length < 2) S.pinch = null;
        if (moved) {
            saveSoon();
            histBtns();
            syncSliders();
        }
        S.drag = null;
        if (S.guides) { S.guides = null; drawSoon(); }
    }
    // 指で動かしたあと、つまみ（大きさ・向き）を合わせる
    function syncSliders() {
        var e = selEl();
        if (!e || !host) return;
        host.querySelectorAll('.pp-panel input[type=range][data-act]').forEach(function (inp) {
            var k = inp.dataset.act;
            if (k === 'rot') inp.value = e.rot || 0;
            else if ((k === 'size' || k === 'w' || k === 'h' || k === 'op') && e[k] != null) inp.value = e[k];
        });
    }
    function onKey(ev) {
        if (shortcut(ev)) return;
        var e = selEl();
        if (!e) return;
        var k = ev.key, st = ev.shiftKey ? .05 : .01;
        var mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[k];
        if (mv) { ev.preventDefault(); change(function () { if (e.grp) { e.y = e._y != null ? e._y : e.y; delete e.grp; } e.x += mv[0]; e.y += mv[1]; }, true); }
        else if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); delSel(); }
    }

    // キーボード（パソコン）：Ctrl（⌘）+Z 元に戻す・Ctrl+Shift+Z／Ctrl+Y やり直す・Ctrl+D 複製
    function shortcut(ev) {
        if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return false;
        var k = (ev.key || '').toLowerCase();
        if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); return true; }
        if ((k === 'z' && ev.shiftKey) || k === 'y') { ev.preventDefault(); redo(); return true; }
        if (k === 'd' && selEl()) { ev.preventDefault(); dupSel(); return true; }
        return false;
    }
    function onDocKey(ev) {
        if (!host || !host.isConnected || S.view !== 'edit' || CUT) return;
        var t = ev.target, tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;   // 文字を打っている所では、ふつうの動きのまま
        if (t === cvs) return;   // 見本の上では onKey が受け持つ
        shortcut(ev);
    }

    // ---------------- 操作 ----------------
    function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function openPop(pid) {
        var p = A.products().filter(function (x) { return String(x.id) === String(pid); })[0];
        if (!p) { A.error(); return; }
        var ch = tplChoices(p, 'pop');
        S.d = genPop(p, 'popL', ch[0], 0); S.d.id = newId(); S.d.var = 0;
        S.hist = []; S.fut = []; S.sel = null; S.tab = 'tpl'; S.view = 'edit'; S.thumbs = {};
        A.sound(880, .05); saveNow(); render(); scrollTop();
    }
    // 販売会のポスター。opt.ev（販売会の中身）・opt.plist（予定のメニュー）を渡すと、それで作る
    function openPoster(opt) {
        opt = opt || {};
        var plist = Array.isArray(opt.plist) && opt.plist.length ? opt.plist : null;
        var list = plist || A.products();
        if (!list.length) { A.error(); return; }
        var ev = Object.assign(defaultEvent(), opt.ev || {});
        var fids = list.filter(function (p) { return p.rec; }).map(function (p) { return p.id; }).slice(0, 3);
        if (!fids.length) fids = list.filter(function (p) { return A.topSeller(p); }).map(function (p) { return p.id; }).slice(0, 3);
        if (!fids.length) fids = list.slice(0, 3).map(function (p) { return p.id; });
        // はじめから「ぎっしり」（空いた所を少なく）。「テンプレート」の「つめ方」で「ゆったり」にもできる
        S.d = genPoster(list, 'a4', tplChoices(null, 'poster')[0], 0, ev, fids, { dense: true, all: list });
        S.d.id = newId(); S.d.var = 0; S.d.fids = fids; S.d.dense = true;
        if (plist) S.d.plist = plist;
        S.hist = []; S.fut = []; S.sel = null; S.tab = 'event'; S.view = 'edit'; S.thumbs = {};
        A.sound(880, .05); saveNow(); render(); scrollTop();
    }
    // おすすめ商品のポスター：はじめは、おすすめ・よく売れた品から3つ（チェックで選び直す）
    function openRec(opt) {
        opt = opt || {};
        var list = Array.isArray(opt.plist) && opt.plist.length ? opt.plist : A.products();
        if (!list.length) { A.error(); return; }
        var pick = list.filter(function (p) { return p.rec; });
        if (!pick.length) pick = list.filter(function (p) { return A.topSeller(p); });
        if (!pick.length) pick = list.slice(0, 3);
        var ev = defaultEvent();
        var head = { title: '今日のおすすめ', sub: [ev.name, ev.date].filter(Boolean).join('　'), note: ev.org || A.shopName() || '' };
        var items = pick.slice(0, 3).map(function (p) { return recItemFor(p, 0); });
        S.d = genRec(items, head, 'a4', tplChoices(null, 'poster')[0], 0, true);
        S.d.id = newId(); S.d.var = 0;
        if (opt.plist) S.d.plist = opt.plist;
        S.hist = []; S.fut = []; S.sel = null; S.tab = 'rec'; S.view = 'edit'; S.thumbs = {};
        A.sound(880, .05); saveNow(); render(); scrollTop();
    }
    // おすすめ商品の並び・中身を変えた時：並べ直す（直した文字は引きつぐ）
    function setRecItems(items) {
        var d = S.d;
        var nd = genRec(items, d.rhead || {}, d.fmt, d.tpl, d.var || 0, d.dense !== false);
        change(function () { var pal = S.d.pal; S.d = carry(S.d, nd, false); S.d.rec = items; S.d.pal = pal; S.sel = null; });
    }
    function setRecField(i, k, v) {
        var d = S.d, it = (d.rec || [])[i];
        if (!it) return;
        if (!typing) { pushHist(); typing = true; }
        it[k] = v;
        var role = { name: 'rname', price: 'rprice', comment: 'rcomm', word: 'rword' }[k];
        var e = (d.els || []).filter(function (x) { return x.role === role && x.pid === it.pid; })[0];
        if (e) e.text = v;
        drawSoon(); saveSoon();
    }
    function setRecHead(k, v) {
        var d = S.d;
        d.rhead = d.rhead || {};
        if (!typing) { pushHist(); typing = true; }
        d.rhead[k] = v;
        var role = { title: 'rtitle', sub: 'rsub', note: 'rnote' }[k];
        var e = (d.els || []).filter(function (x) { return x.role === role; })[0];
        if (e) { e.text = v; drawSoon(); saveSoon(); return; }
        if (v) { var nd = genFor(d, d.tpl, d.fmt, d.var || 0); var add = nd && nd.els.filter(function (x) { return x.role === role; })[0]; if (add) d.els.push(add); drawSoon(); saveSoon(); }
    }
    // 選んだ物を大きく・小さく・回す（見本の下の「すぐ直す」）
    function quickSize(k) {
        var e = selEl();
        if (!e || e.lock) return;
        change(function () {
            if (e.t === 'text') e.size = clamp((e.size || .06) * k, .012, .3);
            else e.w = clamp((e.w || .3) * k, .03, e.t === 'img' ? 1.5 : 1);
            if (e.grp) { e.y = e._y != null ? e._y : e.y; delete e.grp; }
        }, true);
        syncSliders();
    }
    function quickRot(dg) { var e = selEl(); if (!e || e.lock) return; change(function () { e.rot = ((e.rot || 0) + dg + 540) % 360 - 180; }, true); syncSliders(); }
    // 選んだ写真・絵を、端末の写真に替える（位置と大きさはそのまま）
    function swapPhoto(e) {
        pickFile(function (f) {
            importImage(f, 1600, 'photo', function (r) {
                change(function () { e.src = 'user:' + r.id; e.srcSet = true; if (!e.shape || e.shape === 'plain') { e.shape = 'round'; e.shapeSet = true; } });
                var it = S.d.kind === 'rec' && (S.d.rec || []).filter(function (x) { return x.pid === e.pid; })[0];
                if (it) it.pic = e.src;
            });
        });
    }
    function openSaved(id) {
        var x = store().filter(function (s) { return s.id === id; })[0];
        if (!x) { A.error(); return; }
        S.d = clone(x.d); S.d.id = x.id; S.hist = []; S.fut = []; S.sel = null; S.tab = 'tpl'; S.view = 'edit'; S.thumbs = {};
        // メニューの値段・名前は、いまの商品に合わせる（値段を変えたあとに古い値段のまま出さない）
        if (S.d.kind === 'poster') refreshMenu(S.d);
        A.sound(880, .05); render(); scrollTop();
    }
    function scrollTop() { var b = document.getElementById('panel-body'); if (b) b.scrollTop = 0; }
    function delSel() {
        var e = selEl();
        if (!e) return;
        change(function () {
            S.d.els = S.d.els.filter(function (x) { return x.id !== e.id; });
            if (e.role && e.role !== 'deco' && !e.u) { S.d.removed = (S.d.removed || []).concat([keyOf(e)]); }
            S.sel = null;
        });
    }
    function zMove(dir) {
        var e = selEl();
        if (!e) return;
        change(function () {
            var i = S.d.els.indexOf(e);
            S.d.els.splice(i, 1);
            if (dir > 0) S.d.els.push(e); else S.d.els.unshift(e);
        }, true);
    }
    function addEl(e) {
        e.id = nid(); e.u = true;
        change(function () { S.d.els.push(e); S.sel = e.id; });
    }
    function addText() { addEl({ t: 'text', role: 'free', text: '文字を入れてください', x: .5, y: .5, w: .6, size: .06, align: 'center', ck: 'ink', fk: 'body' }); S.tab = 'text'; renderPanel(); }
    function addStamp(w) { var t = tplOf(S.d); addEl({ t: 'stamp', text: w, style: t.stamp, x: .2, y: .2, w: .18, rot: -10, ck: 'acc', ik: 'onAcc', fk: 'accent', bold: true }); }
    function addImg(src, w) { addEl({ t: 'img', src: src, x: .5, y: .5, w: w || .16, shape: src.indexOf('photo:') === 0 ? 'round' : 'plain' }); }
    function addQr() {
        var inp = host.querySelector('#pp-qrnew'), url = inp ? inp.value.trim() : '';
        if (!/^https?:\/\/\S+$/.test(url)) { A.error(); alert('QRコードにするアドレス（https:// から始まる物）を入れてください。'); return; }
        addEl({ t: 'qr', url: url, x: .82, y: .82, w: .2 });
    }
    // ---- 端末の画像を読み込む・使う ----
    function storeErr(er) {
        var m = er && er.message || '';
        return /[ぁ-んァ-ン]/.test(m) ? m : 'この端末に画像をしまえませんでした（しまう場所が足りないか、使えない設定になっています）。';
    }
    function importImage(f, max, kind, cb) {
        if (S.busy) return;
        // 透ける画像（PNG など）の写真は PNG のまま。ほかは JPEG にして小さくする
        var png = kind !== 'bg' && /png|webp|gif|svg/i.test(f.type || '');
        busy(true, '画像を読み込んでいます…');
        fileToImage(f).then(function (im) { return saveUserImage(scaledCanvas(im, max, !png), kind, png ? 'image/png' : 'image/jpeg'); })
            .then(function (r) { busy(false); libAdd(r); cb(r); })
            .catch(function (er) { busy(false); A.error(); alert(storeErr(er)); });
    }
    function libAdd(r) { if (S.lib) S.lib.unshift({ id: r.id, kind: r.kind, w: r.w, h: r.h, at: r.at }); }
    function libRec(id) { return (S.lib || []).filter(function (x) { return x.id === id; })[0] || null; }
    function setBg(id) {
        if (!S.d) return;
        change(function () {
            var o = S.d.bg || {};
            S.d.bg = { src: 'user:' + id, fit: o.fit || 'cover', zoom: 1, px: 0, py: 0, fade: o.fade || 0, dark: !!o.dark, blur: o.blur || 0 };
        });
        A.toast('背景にしました');
    }
    // 画像を足す：縦横の比はそのまま。縦に長い画像は、はみ出さない大きさにする
    function addUserImg(r) {
        if (!S.d) return;
        var f = FMTS[S.d.fmt], ar = (r.h || 1) / (r.w || 1);
        var w = Math.max(.08, Math.min(r.kind === 'cut' ? .36 : .42, .6 * f.h / (f.w * ar)));
        var e = { t: 'img', src: 'user:' + r.id, shape: 'plain', ar: ar, w: w, x: .5, y: .5 };
        if (r.kind === 'cut') e.cut = true;
        addEl(e);
    }
    function usesImg(d, id) { var s = 'user:' + id; return !!(d && ((d.bg && d.bg.src === s) || (d.els || []).some(function (e) { return e.src === s; }))); }
    function dropImg(d, id) { var s = 'user:' + id; if (d.bg && d.bg.src === s) delete d.bg; d.els = (d.els || []).filter(function (e) { return e.src !== s; }); }
    function delUserImg(id) {
        var list = store(), used = usesImg(S.d, id) || list.some(function (x) { return usesImg(x.d, id); });
        if (!confirm(used ? 'この素材は、作ったPOP・ポスターで使っています。消すと、そこからも消えます。消しますか？' : 'この素材を消しますか？')) return;
        userDel(id).then(function () {
            S.lib = (S.lib || []).filter(function (x) { return x.id !== id; });
            if (used) {
                storeSet(list.map(function (x) { if (usesImg(x.d, id)) dropImg(x.d, id); return x; }));
                if (usesImg(S.d, id)) { pushHist(); dropImg(S.d, id); if (S.sel && !elById(S.sel)) S.sel = null; saveSoon(); }
                // 元に戻すと消した画像が出てくるので、元に戻す記録から、この画像を使う物を除く
                S.hist = S.hist.filter(function (h) { return h.indexOf('user:' + id) < 0; });
                S.fut = (S.fut || []).filter(function (h) { return h.indexOf('user:' + id) < 0; });
            }
            A.sound(660, .05); render();
        }).catch(function (er) { A.error(); alert(storeErr(er)); });
    }
    // 重なりの順を1つ動かす（dir 1＝上へ）
    function layerStep(id, dir) {
        var a = S.d.els, i = a.findIndex(function (x) { return x.id === id; }), j = i + dir;
        if (i < 0 || j < 0 || j >= a.length) { A.error(); return; }
        change(function () { var t = a[i]; a[i] = a[j]; a[j] = t; });
    }
    // 紙に合わせて揃える（ふちから少し内側。真ん中はぴったり）
    function alignSel(v) {
        var e = selEl(), b = e && S.boxes.filter(function (x) { return x.id === e.id; })[0];
        if (!e || !b || !cvs) return;
        // 向きを変えている時も、外に出ないよう、まわした形の外枠で測る
        var a = (b.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
        var bw = (b.x1 - b.x0), bh = (b.y1 - b.y0), hw = (bw * c + bh * sn) / 2 / cvs.width, hh = (bw * sn + bh * c) / 2 / cvs.height;
        var m = .04;
        change(function () {
            if (e.grp) { e.y = e._y != null ? e._y : e.y; delete e.grp; }
            if (v === 'l') e.x = m + hw; else if (v === 'r') e.x = 1 - m - hw; else if (v === 'c') e.x = .5;
            else if (v === 't') e.y = m + hh; else if (v === 'b') e.y = 1 - m - hh; else if (v === 'm') e.y = .5;
        }, true);
        renderPanel();
    }
    function nextCatch() {
        var e = selEl(), p = S.d && productOf(S.d);
        if (!e || !p) return;
        var list = catchList(p), i = list.indexOf(e.text);
        change(function () { e.text = list[(i + 1) % list.length]; });
    }
    // 値段の確かめ：POPの値段が、いまの登録の値段と違う時（値段を変えたあとなど）
    function priceGap(d) {
        if (!d || d.kind !== 'pop') return null;
        var p = productOf(d), e = (d.els || []).filter(function (x) { return x.role === 'price'; })[0];
        if (!p || !e) return null;
        var pi = A.priceInfo(p);
        if ((e.text || '').trim() === pi.main) return null;
        return { now: pi, el: e };
    }
    function fixPrice() {
        var g = priceGap(S.d);
        if (!g) return;
        change(function () {
            g.el.text = g.now.main;
            var sub = S.d.els.filter(function (x) { return x.role === 'pricesub'; })[0];
            if (sub && g.now.sub) sub.text = g.now.sub;
            else if (sub && !g.now.sub) S.d.els = S.d.els.filter(function (x) { return x !== sub; });
        });
        A.toast('いまの値段にしました');
    }
    // ポスターのメニュー：名前と値段を、いまの商品に合わせる
    function refreshMenu(d) {
        var all = prods(d);
        (d.els || []).forEach(function (e) {
            if (e.t !== 'menu' || !e.items) return;
            e.items.forEach(function (it) { var p = all.filter(function (x) { return x.id === it.id; })[0]; if (p) { it.n = p.name; it.p = A.priceInfo(p).value; } });
        });
    }
    // 作ったものを複製して、別のものとして直す
    function dupSaved(id) {
        var x = store().filter(function (s) { return s.id === id; })[0];
        if (!x) { A.error(); return; }
        saveNow();
        S.d = clone(x.d); S.d.id = newId(); S.hist = []; S.fut = []; S.sel = null; S.tab = 'tpl'; S.view = 'edit'; S.thumbs = {};
        if (S.d.kind === 'poster') refreshMenu(S.d);
        A.sound(880, .05); saveNow(); render(); scrollTop();
        A.toast('複製しました（元のものはそのまま）');
    }
    // 複製：少しずらして、すぐ上に置く
    function dupSel() {
        var e = selEl();
        if (!e) return;
        var c = clone(e);
        c.id = nid(); c.u = true; c.lock = false;
        delete c.pid; delete c.grp; delete c._y; delete c._k;
        if (c.t === 'text') c.role = 'free'; else delete c.role;
        c.x = Math.min(1.05, (e.x || .5) + .03); c.y = Math.min(1.05, (e._y != null ? e._y : e.y || .5) + .03);
        change(function () { S.d.els.splice(S.d.els.indexOf(e) + 1, 0, c); S.sel = c.id; });
    }
    // 販売会の情報を直した時：その文字の所だけ直す
    var EV_ROLE = { shop: 'brand', name: 'event', date: 'date', catch: 'catch', note: 'note', org: 'orgs', collab: 'orgs', noCollab: 'orgs' };
    function setEv(k, v) {
        var d = S.d;
        d.ev = d.ev || {};
        d.ev[k] = v;
        var role = k === 'time' || k === 'place' ? 'place' : EV_ROLE[k];
        var text = role === 'place' ? [d.ev.time, d.ev.place].filter(Boolean).join('　') : role === 'orgs' ? orgsText(d.ev) : v;
        var nb = host && host.querySelector('.pp-need');
        if (nb) { var miss = posterNeeds(d); nb.classList.toggle('ok', !miss.length); nb.innerHTML = miss.length ? 'まだ入っていない項目：<b>' + miss.map(esc).join('・') + '</b>' : '必ず入れる項目（販売会名・開催日時・開催場所・実施団体・コラボ団体・メニュー・一言コメント）は、全部入っています。'; }
        var e = d.els.filter(function (x) { return x.role === role; })[0];
        if (e) { e.text = text; drawSoon(); saveSoon(); return; }
        // まだ無い（はじめは空だった）物は、作り直して足す
        if (text) { var nd = genFor(d, d.tpl, d.fmt, d.var || 0); if (nd) { var add = nd.els.filter(function (x) { return x.role === role; })[0]; if (add) { d.els.push(add); drawSoon(); saveSoon(); } } }
    }
    function setFeatIds(ids) {
        var nd;
        S.d.fids = ids;
        nd = genFor(S.d, S.d.tpl, S.d.fmt, S.d.var || 0);
        if (!nd) return;
        var keep = S.d;
        change(function () {
            // おすすめが変わると並びが変わるので、おすすめの所だけ作り直す（ほかの直した所はそのまま）
            var FR = ['fpic', 'fname', 'fprice', 'fdesc', 'fhead'];
            var others = keep.els.filter(function (e) { return FR.indexOf(e.role) < 0; });
            var feats = nd.els.filter(function (e) { return FR.indexOf(e.role) >= 0; });
            var i = others.findIndex(function (e) { return e.role === 'mhead'; });
            S.d.els = i >= 0 ? others.slice(0, i).concat(feats, others.slice(i)) : others.concat(feats);
            S.d.groups = nd.groups;   // おすすめの数で、組（並べる場所）も変わる
        });
    }
    function setMenuIds(ids) {
        var all = A.products();
        change(function () {
            S.d.mids = ids;
            var m = S.d.els.filter(function (e) { return e.t === 'menu'; })[0];
            if (m) m.items = all.filter(function (p) { return ids.indexOf(p.id) >= 0; }).map(function (p) { return { id: p.id, n: p.name, p: A.priceInfo(p).value }; });
        }, true);
    }
    function onClick(ev) {
        var b = ev.target.closest('[data-act]');
        if (!b || !host.contains(b) || b.disabled) return;
        var act = b.dataset.act, v = b.dataset.v, e = selEl();
        if (b.tagName === 'INPUT' && b.type !== 'button') return;   // 入力欄は input/change で
        switch (act) {
            case 'pop': openPop(b.dataset.id); break;
            case 'poster': openPoster(); break;
            case 'recposter': openRec(); break;
            case 'dense': {
                var dv = v === '1', nd0;
                S.d.dense = dv;
                nd0 = genFor(S.d, S.d.tpl, S.d.fmt, S.d.var || 0);
                if (nd0) change(function () { var pal = S.d.pal; S.d = carry(S.d, nd0, false); S.d.dense = dv; S.d.pal = pal; S.sel = null; });
                break;
            }
            case 'qsz': quickSize(Number(v) || 1); break;
            case 'qrot': quickRot(Number(v) || 0); break;
            case 'qswap': if (e && e.t === 'img') swapPhoto(e); break;
            case 'evplan': { var pe = A.planEventOf && A.planEventOf(v); if (pe) { pushHist(); Object.keys(pe.ev).forEach(function (k) { setEv(k, pe.ev[k]); }); if (pe.plist && pe.plist.length) { S.d.plist = pe.plist; delete S.d.mids; var nd1 = genFor(S.d, S.d.tpl, S.d.fmt, S.d.var || 0); if (nd1) { S.d = carry(S.d, nd1, false); S.d.plist = pe.plist; } } render(); A.toast('予定の中身を入れました'); } break; }
            case 'rup': case 'rdown': { var ri = Number(v), arr = (S.d.rec || []).slice(), rj = act === 'rup' ? ri - 1 : ri + 1; if (rj < 0 || rj >= arr.length) break; var tmp = arr[ri]; arr[ri] = arr[rj]; arr[rj] = tmp; setRecItems(arr); break; }
            case 'rword': case 'rcomm': {
                var it0 = (S.d.rec || [])[Number(v)], p0 = it0 && prods(S.d).filter(function (x) { return x.id === it0.pid; })[0];
                if (!it0 || !p0) break;
                if (act === 'rword') { var ws = WORDS.filter(function (w) { return w[0].test(p0.name); }).map(function (w) { return w[1]; }).concat(['おすすめ！', 'ぜひどうぞ', 'できたて！', 'おやつに！']); var wi = (ws.indexOf(it0.word) + 1) % ws.length; setRecField(Number(v), 'word', ws[wi]); }
                else { var cs = []; for (var cv = 0; cv < 4; cv++) { var c0 = copyFor(p0, cv); [c0.desc, c0.catch].forEach(function (x) { if (cs.indexOf(x) < 0) cs.push(x); }); } var ci2 = (cs.indexOf(it0.comment) + 1) % cs.length; setRecField(Number(v), 'comment', cs[ci2]); }
                typing = false; renderPanel(); break;
            }
            case 'rphoto': { var it1 = (S.d.rec || [])[Number(v)]; if (!it1) break; var pe1 = (S.d.els || []).filter(function (x) { return x.role === 'rpic' && x.pid === it1.pid; })[0]; if (pe1) swapPhoto(pe1); else pickFile(function (f) { importImage(f, 1600, 'photo', function (r) { it1.pic = 'user:' + r.id; setRecItems(S.d.rec.slice()); }); }); break; }
            case 'rprodpic': { var it2 = (S.d.rec || [])[Number(v)]; if (!it2) break; it2.pic = 'photo:' + it2.name; setRecItems(S.d.rec.slice()); break; }
            case 'open': openSaved(b.dataset.id); break;
            case 'delsaved': delSaved(b.dataset.id); break;
            case 'batch': S.batch = { fmt: 'card', tpl: tplChoices(null, 'pop')[0], ids: A.products().map(function (p) { return p.id; }), pages: null }; S.view = 'batch'; render(); scrollTop(); break;
            case 'list': saveNow(); S.view = 'list'; S.sel = null; render(); scrollTop(); break;
            case 'undo': undo(); break;
            case 'redo': redo(); break;
            case 'regen': regen(); break;
            case 'fmt': setFmt(v); break;
            case 'tpl': setTpl(v); break;
            case 'pal': setPal(Number(v)); break;
            case 'tab': S.tab = v; renderPanel(); break;
            case 'sel': S.sel = b.dataset.id; renderPanel(); drawNow(); break;
            case 'png': savePng(); break;
            case 'share': sharePng(); break;
            case 'print': printOne(); break;
            case 'addtext': addText(); break;
            case 'addstamp': addStamp(v); break;
            case 'adddeco': addImg('deco:' + v, .14); break;
            case 'addart': addImg('art:' + v, .22); break;
            case 'addphoto': addImg('photo:' + v, .3); break;
            case 'addqr': addQr(); break;
            case 'del': delSel(); break;
            case 'front': zMove(1); break;
            case 'back': zMove(-1); break;
            case 'font': if (e) change(function () { var bold = resolveBold(S.d, e); e.font = v; e.bold = bold; delete e.fk; }); break;
            case 'align': if (e) change(function () { e.align = v; }); break;
            case 'box': if (e) change(function () { e.box = v; e.boxSet = true; if (v && !e.bk && !e.boxColor) e.bk = v === 'line' ? 'acc3' : 'acc'; }); break;
            case 'stroke': if (e) change(function () { delete e.sk; delete e.stroke; if (v === 'acc') e.sk = 'acc'; else if (v) e.stroke = v; }); break;
            case 'color': case 'boxcolor': case 'scolor':
                if (e) change(function () {
                    var kk = act === 'boxcolor' ? 'bk' : 'ck', vv = act === 'boxcolor' ? 'boxColor' : 'color';
                    if (b.dataset.k) { e[kk] = b.dataset.k; delete e[vv]; } else { e[vv] = b.dataset.c; delete e[kk]; }
                });
                break;
            case 'sstyle': if (e) change(function () { e.style = v; }); break;
            case 'shape': if (e) change(function () { e.shape = v; e.shapeSet = true; }); break;
            case 'mcols': if (e) change(function () { e.cols = Number(v); e.colsSet = true; }); break;
            case 'bfmt': S.batch.fmt = v; S.batch.pages = null; render(); break;
            case 'btpl': S.batch.tpl = v; S.batch.pages = null; render(); break;
            case 'ball': S.batch.ids = A.products().map(function (p) { return p.id; }); S.batch.pages = null; render(); break;
            case 'bnone': S.batch.ids = []; S.batch.pages = null; render(); break;
            case 'bmake': batchMake(); break;
            case 'bpng': (S.batch.pages || []).forEach(function (u, i) { downloadBlob(dataUrlBlob(u), 'pop-sheet-' + stamp() + '-' + (i + 1) + '.png'); }); A.toast('画像を保存しました'); break;
            case 'bprint': printPages('POP（まとめ）', S.batch.pages || [], 'a4', false); break;
            // 画像
            case 'bgpick': pickFile(function (f) { importImage(f, 2480, 'bg', function (r) { setBg(r.id); }); }); break;
            case 'bgdel': change(function () { delete S.d.bg; }); break;
            case 'bgfit': if (S.d.bg) change(function () { S.d.bg.fit = v; }); break;
            case 'bgdark': if (S.d.bg) change(function () { S.d.bg.dark = v === '1'; if (!(S.d.bg.fade > 0)) S.d.bg.fade = .35; }); break;
            case 'photopick': pickFile(function (f) { importImage(f, 1600, 'photo', addUserImg); }); break;
            case 'cutpick': pickFile(function (f) { fileToImage(f).then(openCutout).catch(function (er) { A.error(); alert(er && er.message || 'この画像は読み込めませんでした'); }); }); break;
            case 'useradd': { var lr = libRec(b.dataset.id); if (lr) addUserImg(lr); break; }
            case 'userbg': setBg(b.dataset.id); break;
            case 'usercut': { var cu = USERURL[b.dataset.id]; if (cu) { var ci = new Image(); ci.onload = function () { openCutout(ci); }; ci.onerror = function () { A.error(); }; ci.src = cu; } break; }
            case 'userdel': delUserImg(b.dataset.id); break;
            case 'userprod': S.prodFor = S.prodFor === b.dataset.id ? null : b.dataset.id; renderPanel(); break;
            case 'prodphoto': A.pickProductPhoto(v).then(function (ok) { if (!ok || !host) return; if (S.view === 'list') render(); else if (S.view === 'edit') { drawSoon(); renderPanel(); } }); break;
            // 重なり
            case 'lhide': { var lh = elById(b.dataset.id); if (lh) change(function () { lh.hide = !lh.hide; if (lh.hide && S.sel === lh.id) S.sel = null; }, false); break; }
            case 'llock': { var ll = elById(b.dataset.id); if (ll) change(function () { ll.lock = !ll.lock; }, false); break; }
            case 'lup': case 'ldown': layerStep(b.dataset.id, act === 'lup' ? 1 : -1); break;
            case 'dup': dupSel(); break;
            case 'alignel': alignSel(v); break;
            case 'pborder': if (e) change(function () { delete e.ek; delete e.border; if (v === 'acc') e.ek = 'acc'; else if (v) e.border = v; }); break;
            case 'nextcatch': nextCatch(); break;
            case 'fixprice': fixPrice(); break;
            case 'dupsaved': dupSaved(b.dataset.id); break;
            case 'flip': if (e) change(function () { e.flip = !e.flip; }); break;
            case 'lock': if (e) change(function () { e.lock = !e.lock; }); break;
            default: return;
        }
    }
    var typing = false;
    function onInput(ev) {
        var b = ev.target.closest('[data-act]');
        if (!b || !host.contains(b)) return;
        var act = b.dataset.act, e = selEl(), val = b.value;
        var slide = function (k, num) { if (!e) return; if (!typing) { pushHist(); typing = true; } e[k] = num; drawSoon(); saveSoon(); };
        switch (act) {
            case 'text': if (e) { if (!typing) { pushHist(); typing = true; } e.text = val; drawSoon(); saveSoon(); var r = host.querySelector('.pp-er.on span'); if (r) r.textContent = val.replace(/\n/g, ' ').slice(0, 24); host.querySelectorAll('[data-act="text"]').forEach(function (x) { if (x !== b) x.value = val; }); } break;
            case 'stext': if (e) { if (!typing) { pushHist(); typing = true; } e.text = val; drawSoon(); saveSoon(); } break;
            case 'qrurl': if (e) { if (!typing) { pushHist(); typing = true; } e.url = val.trim(); drawSoon(); saveSoon(); } break;
            case 'size': slide('size', Number(val)); break;
            case 'w': slide('w', Number(val)); break;
            case 'h': slide('h', Number(val)); break;
            case 'rot': slide('rot', Number(val)); break;
            case 'op': slide('op', Number(val)); break;
            case 'lh': slide('lh', Number(val)); break;
            case 'outline': slide('outline', Number(val)); break;
            case 'zoom': case 'px': case 'py': case 'far': slide(act, Number(val)); break;
            case 'bgzoom': case 'bgpx': case 'bgpy': case 'bgfade': case 'bgblur':
                if (S.d && S.d.bg) { if (!typing) { pushHist(); typing = true; } S.d.bg[act.slice(2)] = Number(val); drawSoon(); saveSoon(); }
                break;
            case 'ev': setEv(b.dataset.k, val); break;
            case 'rh': setRecHead(b.dataset.k, val); break;
            case 'ri': setRecField(Number(b.dataset.i), b.dataset.k, val); break;
            case 'color': case 'boxcolor': case 'scolor':
                if (e && b.type === 'color') { if (!typing) { pushHist(); typing = true; } var kk = act === 'boxcolor' ? 'bk' : 'ck', vv = act === 'boxcolor' ? 'boxColor' : 'color'; e[vv] = val; delete e[kk]; drawSoon(); saveSoon(); }
                break;
        }
    }
    function onChange(ev) {
        var b = ev.target.closest('[data-act]');
        typing = false;
        if (!b || !host.contains(b)) return;
        var act = b.dataset.act, e = selEl();
        switch (act) {
            case 'bold': if (e) change(function () { if (e.fk) { e.font = resolveFont(S.d, e); delete e.fk; } e.bold = b.checked; }, true); break;
            case 'vert': if (e) change(function () { e.vert = b.checked; if (b.checked && (e.w || .8) > .6) e.w = .5; }); break;
            case 'tile': S.printTile = b.checked; break;
            case 'shadow': if (e) change(function () { e.shadow = b.checked; }, true); break;
            case 'safe': S.safe = b.checked; drawNow(); break;
            case 'feat': {
                var ids = (S.d.fids || []).slice(), id = num(b.dataset.id);
                var maxF = S.d.dense && FMTS[S.d.fmt].h > FMTS[S.d.fmt].w * 1.15 ? 6 : 3;
                if (b.checked) { if (ids.length >= maxF) { b.checked = false; A.error(); A.toast('おすすめは' + maxF + 'つまでです'); return; } ids.push(id); }
                else ids = ids.filter(function (x) { return x !== id; });
                setFeatIds(ids); break;
            }
            case 'nocollab': pushHist(); setEv('noCollab', b.checked); renderPanel(); break;
            case 'ritem': {
                var rid = num(b.dataset.id), cur = (S.d.rec || []).slice();
                if (b.checked) {
                    if (cur.length >= 6) { b.checked = false; A.error(); A.toast('おすすめ商品は6つまでです'); return; }
                    var rp = prods(S.d).filter(function (x) { return x.id === rid; })[0];
                    if (rp) cur.push(recItemFor(rp, cur.length));
                } else cur = cur.filter(function (x) { return x.pid !== rid; });
                setRecItems(cur); break;
            }
            case 'mitem': {
                var all = prods(S.d), mids = S.d.mids ? S.d.mids.slice() : all.map(function (p) { return p.id; }), mid = num(b.dataset.id);
                if (b.checked) { if (mids.indexOf(mid) < 0) mids.push(mid); } else mids = mids.filter(function (x) { return x !== mid; });
                mids = all.map(function (p) { return p.id; }).filter(function (x) { return mids.indexOf(x) >= 0; });
                setMenuIds(mids); break;
            }
            case 'userprodsel': {
                var pn = b.value, pid = b.dataset.id;
                if (!pn) break;
                userGet(pid).then(function (r) {
                    if (!r || !r.blob) throw new Error('none');
                    return A.setProductPhoto(pn, r.blob);
                }).then(function (ok) {
                    if (ok) { S.prodFor = null; if (S.view === 'edit' && S.tab === 'img') renderPanel(); }
                }).catch(function () { A.error(); A.toast('この写真を読み込めませんでした'); });
                break;
            }
            case 'bitem': {
                var bid = num(b.dataset.id), bi = S.batch.ids;
                if (b.checked) { if (bi.indexOf(bid) < 0) bi.push(bid); } else S.batch.ids = bi.filter(function (x) { return x !== bid; });
                S.batch.pages = null;
                var mk = host.querySelector('[data-act="bmake"]'); if (mk) { var t = tileOf(S.batch.fmt); mk.disabled = !S.batch.ids.length; mk.textContent = 'A4にならべて作る（' + Math.max(1, Math.ceil(S.batch.ids.length / (t.cols * t.rows))) + '枚）'; }
                break;
            }
            case 'text': case 'stext': case 'size': case 'w': case 'h': case 'rot': case 'qrurl':
            case 'op': case 'zoom': case 'px': case 'py': case 'far': case 'lh': case 'outline': case 'bgzoom': case 'bgpx': case 'bgpy': case 'bgfade': case 'bgblur': {
                histBtns();
                if (act === 'stext' || act === 'text') renderElRows();
                break;
            }
        }
    }
    function renderElRows() { var box = host.querySelector('.pp-els'); if (!box) return; var tabText = S.tab === 'text'; box.innerHTML = S.d.els.filter(function (x) { return tabText ? x.t === 'text' : x.t !== 'text'; }).map(elRow).join('') + (tabText ? '<button type="button" class="pp-er pp-add" data-act="addtext"><b>＋ 文字を足す</b></button>' : ''); }
    function num(id) { return /^\d+$/.test(String(id)) ? Number(id) : id; }

    // ---------------- 背景を消す（切り抜き）：AIは使わず、色の近さで消す ----------------
    // まわりから自動で消す → 残った所をタップで消す・消しゴム・戻すペンで整える → ふちを少しなめらかにして、透ける PNG でしまう
    var CUT = null;
    var CUT_MAX = 1200;
    function cutDist2(d, i, r, g, b) { var dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b; return 2 * dr * dr + 4 * dg * dg + 3 * db * db; }
    // seeds の点から、色の近い所をつながりでたどって消す（tol：0〜100）
    function cutFlood(C, seeds, rgb, tol) {
        var W = C.w, H = C.h, d = C.src, m = C.mask, seen = new Uint8Array(W * H), st = new Int32Array(W * H), n = 0;
        var t2 = 9 * tol * tol * 1.6, near2 = t2 * .12, far2 = t2 * 3.2;
        seeds.forEach(function (p) { if (!seen[p]) { seen[p] = 1; st[n++] = p; } });
        while (n) {
            var p = st[--n];
            m[p] = 0;
            var x = p % W, y = (p - x) / W, pi = p * 4;
            for (var k = 0; k < 4; k++) {
                var q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < W - 1 ? p + 1 : -1) : k === 2 ? (y > 0 ? p - W : -1) : (y < H - 1 ? p + W : -1);
                if (q < 0 || seen[q]) continue;
                var qi = q * 4, ds = cutDist2(d, qi, rgb[0], rgb[1], rgb[2]);
                // 消す色に近い所、または、となりとほとんど同じ色（ゆるやかに色が変わる背景）の所
                if (ds < t2 || (ds < far2 && cutDist2(d, qi, d[pi], d[pi + 1], d[pi + 2]) < near2)) { seen[q] = 1; st[n++] = q; }
            }
        }
    }
    // まわり（ふち）に多い色を、背景の色とみなして消す
    function cutAuto(C, tol) {
        var W = C.w, H = C.h, d = C.src, edge = [], bins = {}, i;
        for (i = 0; i < W; i++) { edge.push(i, (H - 1) * W + i); }
        for (i = 1; i < H - 1; i++) { edge.push(i * W, i * W + W - 1); }
        edge.forEach(function (p) { if (!C.mask[p]) return; var j = p * 4, k = (d[j] >> 5) * 64 + (d[j + 1] >> 5) * 8 + (d[j + 2] >> 5); var b = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 }); b.n++; b.r += d[j]; b.g += d[j + 1]; b.b += d[j + 2]; });
        var cols = Object.keys(bins).map(function (k) { var b = bins[k]; return { n: b.n, rgb: [b.r / b.n, b.g / b.n, b.b / b.n] }; })
            .filter(function (b) { return b.n >= edge.length * .06; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
        var t2 = 9 * tol * tol * 1.6;
        cols.forEach(function (c) {
            var seeds = edge.filter(function (p) { return cutDist2(d, p * 4, c.rgb[0], c.rgb[1], c.rgb[2]) < t2; });
            if (seeds.length) cutFlood(C, seeds, c.rgb, tol);
        });
        return cols.length > 0;
    }
    function cutWand(C, x, y, tol) {
        var W = C.w, H = C.h, d = C.src, r = 0, g = 0, b = 0, n = 0;
        for (var yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (var xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) { var j = (yy * W + xx) * 4; r += d[j]; g += d[j + 1]; b += d[j + 2]; n++; }
        cutFlood(C, [y * W + x], [r / n, g / n, b / n], tol);
    }
    function cutOutAll(C) { var o = C.out.data, m = C.mask; for (var p = 0, n = m.length; p < n; p++) o[p * 4 + 3] = m[p]; C.octx.putImageData(C.out, 0, 0); }
    function cutOutRect(C, x0, y0, x1, y1) {
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(C.w, Math.ceil(x1)); y1 = Math.min(C.h, Math.ceil(y1));
        if (x1 <= x0 || y1 <= y0) return;
        var o = C.out.data, m = C.mask;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var p = y * C.w + x; o[p * 4 + 3] = m[p]; }
        C.octx.putImageData(C.out, 0, 0, x0, y0, x1 - x0, y1 - y0);
    }
    function cutDot(C, cx, cy, r, val) {
        var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(C.w - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(C.h - 1, Math.ceil(cy + r)), r2 = r * r;
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r2) C.mask[y * C.w + x] = val; }
    }
    function cutLine(C, a, b, r, val) {
        var L = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(L / Math.max(1, r / 3)));
        for (var i = 0; i <= steps; i++) cutDot(C, a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, r, val);
        cutOutRect(C, Math.min(a.x, b.x) - r - 1, Math.min(a.y, b.y) - r - 1, Math.max(a.x, b.x) + r + 2, Math.max(a.y, b.y) + r + 2);
    }
    function cutPush(C) { C.undo.push(C.mask.slice()); if (C.undo.length > 10) C.undo.shift(); C.edited = true; cutSync(C); }
    function cutHtml() {
        var tools = [['wand', 'タップで消す'], ['erase', '消しゴム'], ['restore', '戻すペン'], ['pan', '動かす']];
        return '<div class="pp-cut-top">'
            + '<button type="button" class="pp-chip" data-c="cancel">やめる</button>'
            + '<b class="pp-cut-ttl">背景を消す</b>'
            + '<button type="button" class="pp-chip on" data-c="done"><svg class="ic"><use href="#ic-check"/></svg>切り抜いて足す</button>'
            + '</div>'
            + '<div class="pp-cut-stage"><canvas aria-label="切り抜く画像"></canvas></div>'
            + '<div class="pp-cut-tools">'
            + '<p class="pp-cut-msg" aria-live="polite"></p>'
            + '<div class="seg-pick pp-wrapseg" role="group" aria-label="道具">' + tools.map(function (t) { return '<button type="button" data-c="tool" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>'
            + '<div class="pp-cut-rng"><label class="field-label">似た色の幅（大きいほど、たくさん消えます）</label><input type="range" min="4" max="60" step="1" data-c="tol" aria-label="似た色の幅"></div>'
            + '<div class="pp-cut-rng"><label class="field-label">ペンの太さ</label><input type="range" min="6" max="80" step="1" data-c="brush" aria-label="ペンの太さ"></div>'
            + '<div class="pp-row">'
            + '<button type="button" class="pp-chip" data-c="auto">まわりを自動で消す</button>'
            + '<button type="button" class="pp-chip" data-c="undo"><svg class="ic"><use href="#ic-undo"/></svg>元に戻す</button>'
            + '<button type="button" class="pp-chip" data-c="reset">最初から</button>'
            + '<button type="button" class="pp-chip" data-c="zin" aria-label="大きく見る">＋</button>'
            + '<button type="button" class="pp-chip" data-c="zout" aria-label="小さく見る">－</button>'
            + '<button type="button" class="pp-chip" data-c="fit">全体</button>'
            + '</div>'
            + '<label class="field-label">見え方（消した所の色）</label><div class="seg-pick" role="group" aria-label="見え方">' + [['chk', '市松もよう'], ['white', '白'], ['black', '黒']].map(function (t) { return '<button type="button" data-c="view" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>'
            + '<label class="pp-check"><input type="checkbox" data-c="ghost">消した所をうすく見せる</label>'
            + '</div>';
    }
    function cutSync(C) {
        var el = C.el;
        el.querySelectorAll('[data-c="tool"]').forEach(function (b) { var on = b.dataset.v === C.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        el.querySelectorAll('[data-c="view"]').forEach(function (b) { var on = b.dataset.v === C.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        el.querySelector('[data-c="undo"]').disabled = !C.undo.length;
        var tr = el.querySelector('[data-c="tol"]').parentNode, br = el.querySelector('[data-c="brush"]').parentNode;
        tr.hidden = C.tool === 'erase' || C.tool === 'restore' || C.tool === 'pan';
        br.hidden = !(C.tool === 'erase' || C.tool === 'restore');
        var msg = { wand: '残っている背景を押すと、その色のつながった所が消えます。', erase: '指でなぞった所を消します。', restore: '消えすぎた所を、指でなぞって戻します。', pan: '指で画像を動かします。2本の指で広げると大きく見られます。' }[C.tool];
        el.querySelector('.pp-cut-msg').textContent = C.note || msg;
    }
    function cutFit(C) {
        var r = C.cv.getBoundingClientRect(), s = Math.min(r.width / C.w, r.height / C.h) * .94;
        C.v = { s: s, ox: (r.width - C.w * s) / 2, oy: (r.height - C.h * s) / 2, fit: s };
    }
    function cutSize(C) {
        var r = C.cv.parentNode.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
        C.cv.style.width = r.width + 'px'; C.cv.style.height = r.height + 'px';
        C.cv.width = Math.max(1, Math.round(r.width * dpr)); C.cv.height = Math.max(1, Math.round(r.height * dpr)); C.dpr = dpr;
        if (!C.v) cutFit(C);
        cutPaint(C);
    }
    function cutPaint(C) {
        if (C.raf) return;
        C.raf = requestAnimationFrame(function () {
            C.raf = 0;
            var x = C.cv.getContext('2d'), v = C.v, dpr = C.dpr;
            x.setTransform(dpr, 0, 0, dpr, 0, 0);
            x.fillStyle = '#8A8F98'; x.fillRect(0, 0, C.cv.width / dpr, C.cv.height / dpr);
            var iw = C.w * v.s, ih = C.h * v.s;
            if (C.view === 'chk') {
                if (!C.pat) { var t = document.createElement('canvas'); t.width = t.height = 16; var tx = t.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, 16, 16); tx.fillStyle = '#D5D8DD'; tx.fillRect(0, 0, 8, 8); tx.fillRect(8, 8, 8, 8); C.pat = x.createPattern(t, 'repeat'); }
                x.fillStyle = C.pat;
            } else x.fillStyle = C.view === 'black' ? '#111' : '#fff';
            x.fillRect(v.ox, v.oy, iw, ih);
            x.imageSmoothingEnabled = v.s < 2;
            if (C.ghost) { x.globalAlpha = .22; x.drawImage(C.orig, v.ox, v.oy, iw, ih); x.globalAlpha = 1; }
            x.drawImage(C.oc, v.ox, v.oy, iw, ih);
            if (C.cur && (C.tool === 'erase' || C.tool === 'restore')) {
                x.beginPath(); x.arc(C.cur.x, C.cur.y, C.brush / 2, 0, Math.PI * 2);
                x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke(); x.lineWidth = 1; x.strokeStyle = '#1A73E8'; x.stroke();
            }
        });
    }
    function cutPt(C, ev) { var r = C.cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function cutImgPt(C, p) { return { x: (p.x - C.v.ox) / C.v.s, y: (p.y - C.v.oy) / C.v.s }; }
    function cutZoom(C, k, at) {
        var v = C.v, s = Math.max(v.fit * .5, Math.min(v.fit * 12, v.s * k));
        at = at || { x: C.cv.clientWidth / 2, y: C.cv.clientHeight / 2 };
        v.ox = at.x - (at.x - v.ox) * s / v.s; v.oy = at.y - (at.y - v.oy) * s / v.s; v.s = s;
        cutPaint(C);
    }
    function cutRerun(C) {
        // 「似た色の幅」を変えた時：さっき消した所を、新しい幅でやり直す
        var L = C.last;
        if (!L) return;
        C.mask.set(L.base);
        if (L.kind === 'auto') cutAuto(C, C.tol); else cutWand(C, L.x, L.y, C.tol);
        cutOutAll(C); cutPaint(C);
    }
    function cutDown(ev) {
        var C = CUT; if (!C) return;
        ev.preventDefault();
        try { C.cv.setPointerCapture(ev.pointerId); } catch (er) {}
        C.ptrs[ev.pointerId] = cutPt(C, ev);
        var ids = Object.keys(C.ptrs);
        if (ids.length === 2) {
            // 2本の指：広げて大きく・ずらして動かす
            var a = C.ptrs[ids[0]], b = C.ptrs[ids[1]];
            C.g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: Object.assign({}, C.v) };
            return;
        }
        if (ids.length > 2) return;
        var p = C.ptrs[ev.pointerId];
        var tool = (ev.button === 1 || ev.button === 2) ? 'pan' : C.tool;
        C.g = { kind: tool, p0: p, v0: Object.assign({}, C.v), last: cutImgPt(C, p), moved: false, pushed: false };
        C.cur = p;
        if (tool === 'erase' || tool === 'restore') { cutPush(C); C.g.pushed = true; C.last = null; var q = cutImgPt(C, p); cutLine(C, q, q, C.brush / 2 / C.v.s, tool === 'erase' ? 0 : 255); }
        cutPaint(C);
    }
    function cutMove(ev) {
        var C = CUT; if (!C) return;
        var p = cutPt(C, ev);
        if (C.ptrs[ev.pointerId]) C.ptrs[ev.pointerId] = p;
        C.cur = p;
        var g = C.g;
        if (!g) { if (ev.pointerType === 'mouse') cutPaint(C); return; }
        if (g.kind === 'pinch') {
            var ids = Object.keys(C.ptrs); if (ids.length < 2) return;
            var a = C.ptrs[ids[0]], b = C.ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            var s = Math.max(g.v0.fit * .5, Math.min(g.v0.fit * 12, g.v0.s * d / Math.max(1, g.d0)));
            var ix = (g.m0.x - g.v0.ox) / g.v0.s, iy = (g.m0.y - g.v0.oy) / g.v0.s;
            C.v.s = s; C.v.ox = m.x - ix * s; C.v.oy = m.y - iy * s;
            C.cur = null; cutPaint(C); return;
        }
        if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) > 6) g.moved = true;
        if (g.kind === 'pan') { C.v.ox = g.v0.ox + p.x - g.p0.x; C.v.oy = g.v0.oy + p.y - g.p0.y; cutPaint(C); return; }
        if (g.kind === 'erase' || g.kind === 'restore') {
            var q = cutImgPt(C, p);
            cutLine(C, g.last, q, C.brush / 2 / C.v.s, g.kind === 'erase' ? 0 : 255);
            g.last = q; cutPaint(C);
        }
    }
    function cutUp(ev) {
        var C = CUT; if (!C) return;
        var g = C.g, was = C.ptrs[ev.pointerId];
        delete C.ptrs[ev.pointerId];
        if (ev.pointerType !== 'mouse') C.cur = null;
        if (g && g.kind === 'pinch') { if (Object.keys(C.ptrs).length < 2) C.g = null; cutPaint(C); return; }
        C.g = null;
        if (g && g.kind === 'wand' && !g.moved && was && ev.type === 'pointerup') {
            var q = cutImgPt(C, g.p0), x = Math.floor(q.x), y = Math.floor(q.y);
            if (x >= 0 && y >= 0 && x < C.w && y < C.h) {
                cutPush(C);
                C.last = { kind: 'wand', x: x, y: y, base: C.mask.slice() };
                cutWand(C, x, y, C.tol); cutOutAll(C);
            }
        }
        cutPaint(C);
    }
    function cutWheel(ev) {
        var C = CUT; if (!C) return;
        ev.preventDefault();
        cutZoom(C, ev.deltaY < 0 ? 1.15 : 1 / 1.15, cutPt(C, ev));
    }
    function cutClick(ev) {
        var C = CUT, b = ev.target.closest('[data-c]');
        if (!C || !b || b.disabled || b.tagName === 'INPUT') return;
        var c = b.dataset.c;
        C.note = '';
        if (c === 'cancel') { if (!C.edited || confirm('切り抜くのをやめますか？（いま消した所は残りません）')) cutClose(); return; }
        if (c === 'done') { cutDone(C); return; }
        if (c === 'tool') { C.tool = b.dataset.v; C.last = null; }
        else if (c === 'view') C.view = b.dataset.v;
        else if (c === 'undo') { if (C.undo.length) { C.mask.set(C.undo.pop()); C.last = null; cutOutAll(C); } }
        else if (c === 'reset') { cutPush(C); C.mask.set(C.base0); C.last = null; cutOutAll(C); }
        else if (c === 'auto') {
            cutPush(C); C.mask.set(C.base0);
            C.last = { kind: 'auto', base: C.mask.slice() };
            if (!cutAuto(C, C.tol)) C.note = 'まわりの色がまちまちで、自動では消せませんでした。「タップで消す」か「消しゴム」で消してください。';
            cutOutAll(C);
        }
        else if (c === 'zin') cutZoom(C, 1.4);
        else if (c === 'zout') cutZoom(C, 1 / 1.4);
        else if (c === 'fit') cutFit(C);
        cutSync(C); cutPaint(C);
    }
    function cutInput(ev) {
        var C = CUT, b = ev.target.closest('[data-c]');
        if (!C || !b) return;
        if (b.dataset.c === 'tol') { C.tol = Number(b.value); clearTimeout(C.tolT); C.tolT = setTimeout(function () { cutRerun(C); }, 60); }
        else if (b.dataset.c === 'brush') { C.brush = Number(b.value); C.cur = { x: C.cv.clientWidth / 2, y: C.cv.clientHeight / 2 }; cutPaint(C); }
        else if (b.dataset.c === 'ghost') { C.ghost = b.checked; cutPaint(C); }
    }
    function cutKey(ev) {
        if (!CUT) return;
        if (ev.key === 'Escape') { ev.preventDefault(); CUT.el.querySelector('[data-c="cancel"]').click(); }
        else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); CUT.el.querySelector('[data-c="undo"]').click(); }
    }
    function cutResize() { if (CUT) { CUT.v = null; cutSize(CUT); } }
    function openCutout(im) {
        if (CUT) cutClose();
        var c = scaledCanvas(im, CUT_MAX, false), w = c.width, h = c.height, cx = c.getContext('2d');
        var src = cx.getImageData(0, 0, w, h);
        var mask = new Uint8Array(w * h);
        // すでに透けている所（PNG）は、はじめから消えた所にする
        for (var p = 0; p < mask.length; p++) mask[p] = src.data[p * 4 + 3] < 24 ? 0 : 255;
        var oc = document.createElement('canvas'); oc.width = w; oc.height = h;
        var octx = oc.getContext('2d'), out = octx.createImageData(w, h);
        out.data.set(src.data);
        var el = document.createElement('div');
        el.className = 'pp-cut'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '背景を消す');
        el.innerHTML = cutHtml();
        document.body.appendChild(el);
        var C = CUT = { el: el, cv: el.querySelector('canvas'), w: w, h: h, src: src.data, mask: mask, base0: mask.slice(), orig: c, oc: oc, octx: octx, out: out, undo: [], ptrs: {}, tool: 'wand', tol: 24, brush: 28, view: 'chk', ghost: true, v: null, last: null, edited: false, note: '' };
        el.querySelector('[data-c="tol"]').value = C.tol;
        el.querySelector('[data-c="brush"]').value = C.brush;
        el.querySelector('[data-c="ghost"]').checked = C.ghost;
        el.addEventListener('click', cutClick);
        el.addEventListener('input', cutInput);
        el.addEventListener('change', cutInput);
        C.cv.addEventListener('pointerdown', cutDown);
        C.cv.addEventListener('pointermove', cutMove);
        C.cv.addEventListener('pointerup', cutUp);
        C.cv.addEventListener('pointercancel', cutUp);
        C.cv.addEventListener('pointerleave', function () { if (CUT && !CUT.g) { CUT.cur = null; cutPaint(CUT); } });
        C.cv.addEventListener('wheel', cutWheel, { passive: false });
        C.cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        document.addEventListener('keydown', cutKey);
        window.addEventListener('resize', cutResize);
        // はじめに、まわりを自動で消しておく
        C.last = { kind: 'auto', base: mask.slice() };
        if (!cutAuto(C, C.tol)) C.note = 'まわりの色がまちまちで、自動では消せませんでした。「タップで消す」か「消しゴム」で消してください。';
        else C.note = 'まわりを自動で消しました。残った背景は押して消し、消えすぎた所は「戻すペン」でなぞります。';
        cutOutAll(C);
        cutSync(C);
        cutSize(C);
        var first = el.querySelector('[data-c="done"]'); if (first) first.focus();
    }
    function cutClose() {
        if (!CUT) return;
        var C = CUT; CUT = null;
        if (C.raf) cancelAnimationFrame(C.raf);
        document.removeEventListener('keydown', cutKey);
        window.removeEventListener('resize', cutResize);
        C.el.remove();
    }
    // できた：ふちを1つぶん内側へ寄せてから少しぼかし（背景の色が残りにくい）、まわりの透けた所を切りとって、PNG でしまう
    function cutDone(C) {
        var W = C.w, H = C.h, m = C.mask, er = new Uint8Array(W * H), sm = new Uint8Array(W * H), x, y, p;
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            p = y * W + x;
            var v = m[p];
            if (v) { if ((x > 0 && !m[p - 1]) || (x < W - 1 && !m[p + 1]) || (y > 0 && !m[p - W]) || (y < H - 1 && !m[p + W])) v = 0; }
            er[p] = v;
        }
        var x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            p = y * W + x;
            var s = 0, n = 0;
            for (var dy = -1; dy <= 1; dy++) { var yy = y + dy; if (yy < 0 || yy >= H) continue; for (var dx = -1; dx <= 1; dx++) { var xx = x + dx; if (xx < 0 || xx >= W) continue; s += er[yy * W + xx]; n++; } }
            sm[p] = s / n;
            if (sm[p] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) { A.error(); alert('全部消えています。「元に戻す」か「戻すペン」で、残したい所を戻してください。'); return; }
        x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2);
        var cw = x1 - x0 + 1, ch = y1 - y0 + 1, c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var cx = c.getContext('2d'), img = cx.createImageData(cw, ch), o = img.data, d = C.src;
        for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
            var sp = (y + y0) * W + (x + x0), op = (y * cw + x) * 4;
            o[op] = d[sp * 4]; o[op + 1] = d[sp * 4 + 1]; o[op + 2] = d[sp * 4 + 2]; o[op + 3] = Math.min(sm[sp], d[sp * 4 + 3]);
        }
        cx.putImageData(img, 0, 0);
        var btn = C.el.querySelector('[data-c="done"]'); if (btn) btn.disabled = true;
        saveUserImage(c, 'cut', 'image/png').then(function (r) {
            cutClose(); libAdd(r);
            if (S.d && S.view === 'edit') { addUserImg(r); A.toast('切り抜いた画像を足しました'); }
        }).catch(function (e) { if (btn) btn.disabled = false; A.error(); alert(storeErr(e)); });
    }

    // ---------------- 見た目（この画面だけ） ----------------
    var CSS = '\
.pp-list { display: flex; flex-direction: column; gap: 10px; }\
.pp-top { display: flex; flex-wrap: wrap; gap: 10px; }\
.pp-top .action-btn { flex: 1 1 240px; margin: 0; }\
.pp-plist { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }\
.pp-prod { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px; border: none; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-card); color: var(--text-main); font: inherit; cursor: pointer; min-height: 132px; }\
.pp-pt { width: 72px; height: 72px; border-radius: 14px; overflow: hidden; display: grid; place-items: center; background: var(--sunken); box-shadow: inset 0 -4px 0 var(--ink); }\
.pp-pt img, .pp-pt svg { width: 100%; height: 100%; object-fit: cover; }\
.pp-pn { font-weight: 800; font-size: 14px; text-align: center; line-height: 1.3; overflow-wrap: anywhere; }\
.pp-pp { font-size: 13px; color: var(--text-light); font-weight: 700; font-variant-numeric: tabular-nums; }\
.pp-saved { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }\
.pp-sv { position: relative; }\
.pp-svb { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px; border: none; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-card); color: var(--text-main); font: inherit; cursor: pointer; }\
.pp-svb canvas { border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.15); max-width: 100%; }\
.pp-svb span { font-weight: 800; font-size: 13px; text-align: center; overflow-wrap: anywhere; }\
.pp-svb small { font-size: 11px; color: var(--text-light); }\
.pp-del { position: absolute; top: 4px; right: 4px; width: 44px; height: 44px; border: none; border-radius: 50%; background: var(--surface); color: var(--danger); box-shadow: var(--shadow-card); display: grid; place-items: center; cursor: pointer; }\
.pp-del .ic { width: 18px; height: 18px; }\
.pp-dupb { right: 54px; color: var(--accent-ink); }\
.pp-flipx { transform: scaleX(-1); }\
.pp-warn { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--r-md); background: #FFF4E5; color: #7A4A00; font-size: 13.5px; font-weight: 700; }\
.pp-warn span { flex: 1 1 200px; }\
.pp-lic { font-size: 12px; }\
.pp-edit { display: grid; gap: 14px; }\
@media (min-width: 900px) { .pp-edit { grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr); align-items: start; } .pp-stage { position: sticky; top: 0; } }\
.pp-stage { display: flex; flex-direction: column; gap: 10px; min-width: 0; }\
.pp-bar, .pp-row, .pp-fmt, .pp-stamps { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }\
.pp-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: none; border-radius: var(--r-pill); background: var(--surface); color: var(--text-main); box-shadow: var(--shadow-card); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }\
.pp-chip .ic { width: 18px; height: 18px; }\
.pp-chip.on { background: var(--accent); color: #fff; box-shadow: none; }\
.pp-chip:disabled { opacity: .4; cursor: default; }\
.pp-chip.pp-danger { color: var(--danger); }\
.pp-cv { display: flex; justify-content: center; min-width: 0; }\
.pp-cv canvas { display: block; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.10); background: #fff; touch-action: pan-y; cursor: pointer; }\
.pp-cv canvas:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }\
.pp-tip, .pp-font, .pp-busy { margin: 0; font-size: 12.5px; color: var(--text-light); text-align: center; }\
.pp-busy { color: var(--accent-ink); font-weight: 700; }\
.pp-out { display: flex; flex-wrap: wrap; gap: 10px; }\
.pp-out .action-btn { flex: 1 1 140px; margin: 0; }\
.pp-check { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-size: 14px; font-weight: 700; color: var(--text-main); }\
.pp-check input { width: 22px; height: 22px; flex-shrink: 0; }\
.pp-ctl { display: flex; flex-direction: column; gap: 10px; min-width: 0; }\
.pp-tabs { display: flex; gap: 4px; padding: 4px; border-radius: var(--r-pill); background: var(--sunken); overflow-x: auto; scrollbar-width: none; }\
.pp-tabs::-webkit-scrollbar { display: none; }\
.pp-tab { flex: 1 0 auto; white-space: nowrap; min-height: 44px; border: none; border-radius: var(--r-pill); background: transparent; color: var(--text-light); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; padding: 0 10px; }\
.pp-tab.on { background: var(--surface); color: var(--text-main); box-shadow: var(--shadow-card); }\
.pp-panel { display: flex; flex-direction: column; gap: 8px; }\
.pp-tpls { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }\
.pp-tpl { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border: none; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-card); font: inherit; font-size: 13px; font-weight: 800; color: var(--text-main); cursor: pointer; }\
.pp-tpl canvas { border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.15); max-width: 100%; }\
.pp-tpl.on { box-shadow: 0 0 0 3px var(--accent); }\
.pp-pals { display: flex; flex-wrap: wrap; gap: 10px; }\
.pp-pal { display: inline-flex; gap: 3px; align-items: center; justify-content: center; width: 64px; height: 44px; border: none; border-radius: 12px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); cursor: pointer; }\
.pp-pal i { width: 12px; height: 22px; border-radius: 4px; }\
.pp-pal.on { box-shadow: 0 0 0 3px var(--accent); }\
.pp-els { display: flex; flex-wrap: wrap; gap: 6px; }\
.pp-er { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 1px; min-height: 44px; max-width: 100%; padding: 6px 12px; border: none; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow-card); color: var(--text-main); font: inherit; cursor: pointer; text-align: left; }\
.pp-er b { font-size: 12px; color: var(--text-light); }\
.pp-er span { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }\
.pp-er.on { box-shadow: 0 0 0 3px var(--accent); }\
.pp-er.pp-eri { flex-direction: row; align-items: center; gap: 8px; }\
.pp-er i { width: 32px; height: 32px; display: grid; place-items: center; }\
.pp-er i svg, .pp-er i img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }\
.pp-er.pp-add b { color: var(--accent-ink); font-size: 14px; }\
.pp-edbox { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-card); }\
.pp-edbox .field-label { margin: 6px 0 0; }\
.pp-edbox input[type=range] { width: 100%; min-height: 36px; }\
.pp-ta, .pp-in { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 10px 12px; border-radius: 10px; border: none; background: var(--sunken); color: var(--text-main); }\
.pp-row .pp-in { flex: 1 1 200px; width: auto; }\
.pp-fonts { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; }\
.pp-font-b { display: flex; flex-direction: column; align-items: center; gap: 0; min-height: 56px; padding: 4px; border: none; border-radius: 10px; background: var(--sunken); color: var(--text-main); cursor: pointer; }\
.pp-font-b .pp-fs { font-size: 20px; line-height: 1.3; }\
.pp-font-b small { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; font-size: 11px; color: var(--text-light); font-weight: 700; }\
.pp-font-b.on { background: var(--accent); color: #fff; }\
.pp-font-b.on small { color: #fff; }\
.pp-wrapseg { flex-wrap: wrap; }\
.pp-sws { display: flex; flex-wrap: wrap; gap: 8px; }\
.pp-sw { width: 40px; height: 40px; border-radius: 50%; border: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); cursor: pointer; position: relative; overflow: hidden; padding: 0; }\
.pp-sw.on { box-shadow: 0 0 0 3px var(--accent), inset 0 0 0 1px rgba(0,0,0,.18); }\
.pp-swc { background: conic-gradient(#f44, #fd4, #4c4, #4cf, #44f, #c4f, #f44); display: inline-block; }\
.pp-swc input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }\
.pp-arts { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 6px; }\
.pp-art { aspect-ratio: 1; border: none; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow-card); padding: 6px; cursor: pointer; display: grid; place-items: center; min-height: 52px; }\
.pp-art svg, .pp-art img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }\
.pp-more summary { cursor: pointer; font-weight: 800; font-size: 14px; padding: 10px 0; color: var(--accent-ink); }\
.pp-checks { display: flex; flex-direction: column; gap: 0; padding: 4px 12px; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-card); }\
.pp-pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }\
.pp-pages figure { margin: 0; text-align: center; font-size: 12px; color: var(--text-light); }\
.pp-pages img { width: 100%; height: auto; display: block; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,.18); background: #fff; }\
.pp-wide { width: 100%; margin: 0; }\
.pp-half { flex: 1 1 160px; margin: 0; }\
.pp-bgthumb { display: block; width: 100%; max-height: 140px; object-fit: cover; border-radius: 10px; }\
.pp-lib { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; }\
.pp-li { display: flex; flex-direction: column; gap: 4px; }\
.pp-lib-b { width: 100%; padding: 4px; }\
.pp-lib-b img { object-fit: contain; }\
.pp-cutbg, .pp-ercut i { background-color: #fff; background-image: conic-gradient(#E3E5EA 25%, transparent 0 50%, #E3E5EA 0 75%, transparent 0); background-size: 12px 12px; }\
.pp-li-acts { display: flex; gap: 4px; flex-wrap: wrap; }\
.pp-contrast { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0 0; padding: 10px 12px; border-radius: 12px; background: var(--warn-bg); color: var(--warn-ink); font-size: 13.5px; font-weight: 700; line-height: 1.55; }\
.pp-contrast .ic { flex: none; width: 18px; height: 18px; margin-top: 2px; }\
.pp-contrast.hide { display: none; }\
.pp-pf { margin-top: 10px; padding: 12px; border-radius: 14px; background: var(--sunken); }\
.pp-pf .pp-in { width: 100%; }\
.pp-wrap { flex-wrap: wrap; }\
.pp-nophoto .pp-chip .ic { width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px; }\
.pp-mini { flex: 1 1 auto; min-height: 36px; padding: 0 8px; border: none; border-radius: 10px; background: var(--sunken); color: var(--text-main); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }\
.pp-mini.on { background: var(--accent); color: #fff; }\
.pp-mini.pp-danger { color: var(--danger); }\
.pp-layers { display: flex; flex-direction: column; gap: 8px; }\
.pp-ly { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: var(--r-md); background: var(--surface); box-shadow: var(--shadow-card); }\
.pp-ly .pp-er { flex: 1 1 auto; min-width: 0; overflow: hidden; box-shadow: none; background: transparent; padding: 4px 6px; }\
.pp-ly .pp-er span { max-width: 100%; }\
.pp-ly.on { box-shadow: 0 0 0 3px var(--accent); }\
.pp-ly.hid .pp-er, .pp-erhid { opacity: .45; }\
.pp-ly-acts { display: flex; gap: 4px; flex-shrink: 0; }\
.pp-ly-acts .pp-mini { flex: 0 0 auto; min-width: 38px; min-height: 40px; padding: 0 6px; }\
@media (max-width: 420px) { .pp-ly { flex-wrap: wrap; } .pp-ly-acts { width: 100%; } .pp-ly-acts .pp-mini { flex: 1 1 auto; } }\
.pp-cut { position: fixed; inset: 0; z-index: 5000; display: flex; flex-direction: column; background: var(--bg-color, #F2F3F7); padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }\
.pp-cut-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; }\
.pp-cut-ttl { font-size: 16px; font-weight: 800; color: var(--text-main); }\
.pp-cut-stage { flex: 1 1 auto; min-height: 160px; position: relative; overflow: hidden; }\
.pp-cut-stage canvas { position: absolute; inset: 0; display: block; touch-action: none; cursor: crosshair; }\
.pp-cut-tools { flex: 0 0 auto; max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px 16px 14px; }\
.pp-cut-tools .field-label { margin: 2px 0 0; }\
.pp-cut-tools .seg-pick { flex-wrap: wrap; }\
.pp-cut-tools .seg-pick button { flex: 1 0 auto; }\
.pp-cut-tools input[type=range] { width: 100%; min-height: 32px; }\
.pp-cut-msg { margin: 0; font-size: 13px; color: var(--text-light); min-height: 1.4em; }\
.pp-cut-rng[hidden] { display: none; }\
@media (min-width: 900px) { .pp-cut { flex-direction: row; flex-wrap: wrap; } .pp-cut-top { width: 100%; } .pp-cut-stage { flex: 1 1 0; height: calc(100% - 60px); } .pp-cut-tools { width: 340px; max-height: none; } }\
.pp-quick { margin: 8px 0 4px; display: flex; flex-direction: column; gap: 6px; }\
.pp-qhint { margin: 0; font-size: 12.5px; color: var(--text-light); text-align: center; }\
.pp-qt { width: 100%; box-sizing: border-box; min-height: 44px; padding: 8px 12px; font: inherit; font-size: 16px; border: none; border-radius: var(--r-md); background: var(--sunken); color: var(--text-main); box-shadow: inset 0 0 0 1px var(--hairline); resize: vertical; }\
.pp-qt:focus { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }\
.pp-qrow { display: flex; flex-wrap: wrap; gap: 6px; }\
.pp-qb { flex: 1 1 auto; min-height: 42px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 12px; background: var(--surface); color: var(--text-main); box-shadow: var(--shadow-card); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }\
.pp-qb .ic { width: 16px; height: 16px; }\
.pp-qb[data-act=del] { color: var(--danger); }\
.pp-need { padding: 10px 12px; border-radius: var(--r-md); background: var(--danger-bg, #FCEAEE); color: var(--danger-ink, #B3263C); font-size: 13.5px; font-weight: 700; margin-bottom: 8px; }\
.pp-need.ok { background: var(--ok-bg, #E0F2E5); color: var(--ok-ink, #1F7A3D); }\
.pp-req { margin-left: 8px; font-size: 11px; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: var(--danger-bg, #FCEAEE); color: var(--danger-ink, #B3263C); }\
.pp-ritem { background: var(--surface); border-radius: var(--r-md); box-shadow: var(--shadow-card); padding: 10px 12px; margin-top: 8px; }\
.pp-rtop { display: flex; align-items: center; gap: 8px; }\
.pp-rtop b { flex: 1; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }\
.pp-rtop .pp-mini { flex: 0 0 auto; min-width: 38px; }\
.pp-rpic { width: 44px; height: 44px; border-radius: 10px; overflow: hidden; background: var(--sunken); flex-shrink: 0; display: grid; place-items: center; }\
.pp-rpic img, .pp-rpic svg { width: 100%; height: 100%; object-fit: cover; }\
.pp-r2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }\
';
    function injectCss() {
        if (document.getElementById('pop-css')) return;
        var s = document.createElement('style'); s.id = 'pop-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    var bound = null, resizeT = 0;
    function mount(el, api) {
        A = api; host = el;
        // 前につながらなかった時は、開き直した時にもう一度試す
        if (S.fontState === 'off') { S.fontState = 'wait'; S.fontsAsked = false; }
        injectCss();
        if (bound !== el) {
            bound = el;
            el.addEventListener('click', onClick);
            el.addEventListener('input', onInput);
            el.addEventListener('change', onChange);
            el.addEventListener('focusout', function () { typing = false; });
        }
        if (!mount.kb) { mount.kb = true; document.addEventListener('keydown', onDocKey); }
        if (!mount.rs) { mount.rs = true; window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (host && host.isConnected && S.view === 'edit') sizeCanvas(); }, 120); }); }
        render();
    }
    // 画面を離れる時（設定のほかの所へ）：作りかけを残す
    function leave() { saveNow(); }
    // 戻る（画面の上の「戻る」・左端からなぞる）：この画面の中で一つ前へ。戻せた時は true
    //   背景を消す画面 → 直す画面 → 一覧 → （false：アプリが前の画面へ）
    function back() {
        if (CUT) {
            if (!CUT.edited || confirm('切り抜くのをやめますか？（いま消した所は残りません）')) cutClose();
            return true;
        }
        if (S.view === 'edit' || S.view === 'batch') {
            saveNow(); S.view = 'list'; S.sel = null;
            render(); scrollTop(); A.sound(660, .04);
            return true;
        }
        return false;
    }
    window.POPMAKER = {
        mount: mount, leave: leave, back: back, render: renderDesign,
        // 予定から：販売会のポスター・おすすめ商品のポスターを作る（{ ev, plist }）
        openPoster: function (o) { if (host) openPoster(o); }, openRec: function (o) { if (host) openRec(o); },
        genRec: function (items, head, f, t, v, dense) { return genRec(items, head || {}, f, t, v || 0, dense); }, genPop: function (p, f, t, v) { return genPop(p, f, t, v || 0); }, genPoster: function (l, f, t, v, ev, fids) { return genPoster(l, f, t, v || 0, ev || defaultEvent(), fids); },
        fonts: FONTS, templates: TPLS, formats: FMTS, decos: DECO, state: S, exportCanvas: exportCanvas, wrap: wrap, tileOf: tileOf,
        cutState: function () { return CUT; }
    };
})();
