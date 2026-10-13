/* 筆談（文字と手書きで、お店の人とお客様が話す）
 * レジの「レジの機能 → 筆談」をオンにした時だけ読み込む（オフの時は、この部品そのものを読まない）。
 *
 * 【しくみ】
 *  ・やりとりは1枚の「筆談の紙」（events/{コード}/live/hitsu）に置く。
 *    { open: 話している最中か, s: お店の人が書いた物, c: お客様が書いた物, clr: 消した時刻, req: お客様が始めた時刻 }
 *  ・お店とお客様は、それぞれ自分の欄（s か c）だけを書きかえる（同時に書いても、相手の物を消さない）。
 *    お店の人の「全部消す」「終わる」だけは、両方の欄を空にする（消した時刻より前の物は、どちらの画面にも出さない）。
 *  ・1つの書いた物：{ i: 印, k: 't'（文字）|'d'（手書き）, at: 時刻, t: 文字, p: 手書きの線, r: 縦÷横 }
 *  ・共有していない時は、この端末の中だけで同じように使う（1台を向かい合って使う。画面の向きを逆さにできる）。
 *  ・会計の記録・在庫には、いっさいさわらない。
 */
(function () {
    'use strict';
    var A = null;           // アプリから渡されるもの（下の open の説明を参照）
    var root = null;        // 画面
    var D = { open: false, s: [], c: [], clr: 0, req: 0 };
    var side = 's';         // この画面で書く人（s: お店の人 / c: お客様）
    var mode = 'text';      // text: 文字で書く / draw: 手で書く
    var flip = false;       // 1台で向かい合う時に、画面を逆さにする
    var strokes = [], curStroke = null, cv = null, cx = null;
    var lastCount = 0;
    var MAX_ITEMS = 30, MAX_TEXT = 200, MAX_POINTS = 4000;

    var STAFF_PHRASES = ['いらっしゃいませ', 'お会計は{total}です', '少々お待ちください', '袋はご入用ですか', 'レシートはご入用ですか', 'お支払い方法はどうしますか', 'もう一度お願いします', 'ゆっくりで大丈夫です', 'ありがとうございました'];
    var CUST_PHRASES = ['はい', 'いいえ', 'わかりました', 'もう一度お願いします', '書いてください', 'ゆっくりお願いします', '袋をください', 'レシートをください', 'ありがとう'];

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function now() { return Date.now(); }
    function uid() { return now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function live(arr) { return (Array.isArray(arr) ? arr : []).filter(function (x) { return x && typeof x === 'object' && (Number(x.at) || 0) >= (D.clr || 0) && (x.k === 't' || x.k === 'd'); }); }
    function norm(d) {
        d = d && typeof d === 'object' ? d : {};
        return { open: d.open === true, s: Array.isArray(d.s) ? d.s.slice(-MAX_ITEMS) : [], c: Array.isArray(d.c) ? d.c.slice(-MAX_ITEMS) : [], clr: Number(d.clr) || 0, req: Number(d.req) || 0 };
    }

    // ---------------- 手書きの線を、短い文字にする（0〜999 の座標を 36進2けたずつ） ----------------
    function enc(list) {
        return list.map(function (s) {
            return s.map(function (p) { return ('0' + p[0].toString(36)).slice(-2) + ('0' + p[1].toString(36)).slice(-2); }).join('');
        }).join(' ');
    }
    function dec(str) {
        return String(str || '').split(' ').map(function (s) {
            var out = [];
            for (var i = 0; i + 4 <= s.length; i += 4) out.push([parseInt(s.slice(i, i + 2), 36) || 0, parseInt(s.slice(i + 2, i + 4), 36) || 0]);
            return out;
        }).filter(function (s) { return s.length; });
    }
    function drawSvg(it) {
        // 座標は、書く所の横の長さを 1000 とした数（縦も同じ尺度）。
        // 書いた所だけを切り出して見せる（余白ばかりの大きな絵にならないように）
        var ss = dec(it.p), x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        ss.forEach(function (s) { s.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
        if (x1 < 0) return '';
        var m = 40, w = Math.max(240, x1 - x0 + m * 2), h = Math.max(160, y1 - y0 + m * 2);
        var vx = Math.round((x0 + x1) / 2 - w / 2), vy = Math.round((y0 + y1) / 2 - h / 2);
        var d = ss.map(function (s) {
            return 'M' + s.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + (s.length === 1 ? 'l0.1 0' : '');
        }).join('');
        // 画面での幅：書いた大きさに合わせる（書く所いっぱいに書いた物でも、460px まで）
        var px = Math.round(Math.max(150, Math.min(460, w * .46)));
        return '<svg class="hs-ink" viewBox="' + vx + ' ' + vy + ' ' + Math.round(w) + ' ' + Math.round(h) + '" style="width:' + px + 'px" role="img" aria-label="手書き"><path d="' + d + '"/></svg>';
    }

    // ---------------- 画面 ----------------
    function phraseText(p) {
        if (p.indexOf('{total}') < 0) return p;
        var t = A.total ? A.total() : '';
        return t ? p.replace('{total}', t) : '';
    }
    function bubbles() {
        var all = live(D.s).map(function (x) { return { w: 's', x: x }; }).concat(live(D.c).map(function (x) { return { w: 'c', x: x }; }));
        all.sort(function (a, b) { return (a.x.at || 0) - (b.x.at || 0); });
        if (!all.length) {
            return '<div class="hs-empty">' + (side === 'c'
                ? '<b>文字や絵で、お店の人とお話しできます</b><span>下の「はい」「いいえ」を押すか、文字を打つ・指で書いて「送る」を押してください。</span>'
                : (peer()
                    ? '<b>お客様の画面（CD）にも、この筆談が出ています</b><span>お店とお客様が、それぞれの画面からチャットのように書き合えます。よく使う言葉は、下のボタンで送れます。</span>'
                    : '<b>文字や手書きで、お客様とお話しします</b><span>よく使う言葉は、下のボタンで送れます。キーボードのマイクで話すと、文字にもできます。</span>')) + '</div>';
        }
        var prev = null;
        return all.map(function (m) {
            var mine = m.w === side;
            var who = m.w === 's' ? 'お店' : 'お客様';
            // 同じ人が続けて書いた物は、名前と顔の印を1回だけにする（チャットと同じ）
            var cont = prev && prev.w === m.w && (Number(m.x.at) || 0) - (Number(prev.x.at) || 0) < 120000;
            prev = m;
            var body = m.x.k === 'd' ? drawSvg(m.x) : '<span class="hs-t">' + esc(m.x.t) + '</span>';
            // 文字は、音の印で読み上げられる（話すことが難しい方が、声で伝えたい時に）
            var say = m.x.k === 't' && A.speak ? '<button type="button" class="hs-say" data-h="speak" data-v="' + esc(m.x.i) + '" aria-label="声で読む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg></button>' : '';
            var av = mine ? '' : '<span class="hs-av' + (cont ? ' gap' : '') + '" aria-hidden="true">' + (cont ? '' : (m.w === 's' ? AV_SHOP : AV_CUST)) + '</span>';
            return '<div class="hs-msg ' + (mine ? 'mine' : 'theirs') + (m.x.k === 'd' ? ' ink' : '') + (cont ? ' cont' : '') + '">' + av
                + '<div class="hs-col">' + (cont ? '' : '<small>' + who + '<time>' + hm(m.x.at) + '</time></small>')
                + '<div class="hs-row">' + (mine ? say : '') + '<div class="hs-b">' + body + '</div>' + (mine ? '' : say) + '</div></div></div>';
        }).join('');
    }
    // CDの画面か（レジの画面をお客様に見せている時は、レジの画面のまま）
    function isCd() { return A.side === 'c' && !A.local; }
    // レジの画面で、お客様の画面（CD）がつながっているか（その時は、お客様の分はCDで書いてもらう）
    function peer() { return !isCd() && !A.local && !!(A.peer && A.peer()); }
    function hm(at) { var d = new Date(Number(at) || 0); return isNaN(d) ? '' : d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
    // 顔の印（自分で描いた形だけ）：お店＝屋根のあるお店、お客様＝人
    var AV_SHOP = '<svg viewBox="0 0 24 24"><path d="M4 10l1.5-5h13L20 10"/><path d="M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V19h13v-6.5"/><path d="M10 19v-4h4v4"/></svg>';
    var AV_CUST = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c.8-3.7 3.6-5.6 7-5.6s6.2 1.9 7 5.6"/></svg>';
    function html() {
        var cust = side === 'c', cd = isCd(), pe = peer();
        var phrases = (cust ? CUST_PHRASES : STAFF_PHRASES).map(phraseText).filter(Boolean);
        var info = A.info ? A.info() : '';
        return '<div class="hs-top">'
            + '<span class="hs-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-4.5 3.5V17H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8.5 13.5l.7-2.3 4.6-4.6 1.6 1.6-4.6 4.6z"/></svg></span>'
            + '<b class="hs-ttl">筆談' + (cust ? '<small>文字や絵で、お店の人とお話しできます</small>' : (pe ? '<small>お客様の画面（CD）とお話ししています</small>' : '')) + '</b>'
            + (info ? '<span class="hs-info">' + esc(info) + '</span>' : '')
            + '<span class="hs-sp"></span>'
            + (pe ? '<span class="hs-peer"><i></i>CDにも出ています</span>' : '')
            + (!cd && !pe ? '<div class="hs-seg" role="group" aria-label="書く人"><button type="button" data-h="who" data-v="s" class="' + (side === 's' ? 'on' : '') + '" aria-pressed="' + (side === 's') + '">お店</button><button type="button" data-h="who" data-v="c" class="' + (side === 'c' ? 'on' : '') + '" aria-pressed="' + (side === 'c') + '">お客様</button></div>'
                + '<button type="button" class="hs-btn" data-h="flip" aria-pressed="' + flip + '">逆さにする</button>' : '')
            + (cd ? '' : '<button type="button" class="hs-btn" data-h="clear">全部消す</button>')
            + '<button type="button" class="hs-btn hs-end" data-h="end">' + (cd ? 'とじる' : '終わる') + '</button>'
            + '</div>'
            + '<div class="hs-main">'
            + '<div class="hs-log" aria-live="polite">' + bubbles() + '</div>'
            + '<div class="hs-in">'
            + '<div class="hs-phr">' + phrases.map(function (p) { return '<button type="button" class="hs-chip" data-h="say" data-v="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') + '</div>'
            + '<div class="hs-seg hs-mode" role="group" aria-label="書き方"><button type="button" data-h="mode" data-v="text" class="' + (mode === 'text' ? 'on' : '') + '" aria-pressed="' + (mode === 'text') + '">文字で書く</button><button type="button" data-h="mode" data-v="draw" class="' + (mode === 'draw' ? 'on' : '') + '" aria-pressed="' + (mode === 'draw') + '">指で書く</button></div>'
            + (mode === 'text'
                ? '<textarea class="hs-ta" maxlength="' + MAX_TEXT + '" rows="2" placeholder="' + (cust ? 'ここに文字を打てます' : 'お客様に伝えたいこと') + '" aria-label="伝えたいこと"></textarea>'
                : '<div class="hs-pad"><canvas aria-label="指で書く所"></canvas><span class="hs-pad-hint">ここに指で書けます</span></div>')
            + '<div class="hs-acts">'
            + '<button type="button" class="hs-btn" data-h="undo">' + (mode === 'draw' ? '1画もどす' : '送った物を1つ消す') + '</button>'
            + (mode === 'draw' ? '<button type="button" class="hs-btn" data-h="wipe">書き直す</button>' : '')
            + '<button type="button" class="hs-send" data-h="send">送る</button>'
            + '</div></div></div>';
    }
    function render(keepInput) {
        if (!root) return;
        var ta = root.querySelector('.hs-ta'), typed = ta ? ta.value : '';
        // CDがつながっている時、お客様の分はCDで書いてもらう（レジは、お店の人の側だけ）
        if (peer()) { side = 's'; flip = false; }
        var focused = ta && document.activeElement === ta;
        root.className = 'hs-board' + (A.dark && A.dark() ? ' hs-dark' : '') + (flip ? ' hs-flip' : '') + (side === 'c' ? ' hs-cust' : '');
        root.innerHTML = html();
        var nta = root.querySelector('.hs-ta');
        if (nta && keepInput) { nta.value = typed; if (focused) nta.focus(); }
        setupPad();
        scrollLog();
    }
    // 書いた物だけ描き直す（打っている途中の文字・書いている途中の絵は、そのまま）
    function renderLog() {
        if (!root) return;
        var log = root.querySelector('.hs-log');
        if (log) log.innerHTML = bubbles();
        var info = A.info ? A.info() : '', ie = root.querySelector('.hs-info');
        if (ie) ie.textContent = info;
        scrollLog();
    }
    function scrollLog() { var log = root && root.querySelector('.hs-log'); if (log) log.scrollTop = log.scrollHeight; }

    // ---------------- 指で書く ----------------
    function setupPad() {
        cv = root.querySelector('.hs-pad canvas');
        if (!cv) { cx = null; return; }
        var box = cv.parentNode, dpr = Math.min(2, window.devicePixelRatio || 1);
        var w = Math.max(10, box.clientWidth), h = Math.max(10, box.clientHeight);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cv.style.width = w + 'px'; cv.style.height = h + 'px';
        cx = cv.getContext('2d');
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        redrawPad();
        cv.onpointerdown = function (ev) {
            ev.preventDefault();
            try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
            curStroke = [pt(ev)];
            strokes.push(curStroke);
            box.classList.add('used');
            redrawPad();
        };
        cv.onpointermove = function (ev) {
            if (!curStroke) return;
            var p = pt(ev), q = curStroke[curStroke.length - 1];
            if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 5) return;
            if (countPoints() >= MAX_POINTS) return;
            curStroke.push(p);
            redrawPad();
        };
        cv.onpointerup = cv.onpointercancel = function () { curStroke = null; };
    }
    function countPoints() { return strokes.reduce(function (n, s) { return n + s.length; }, 0); }
    function pt(ev) {
        var r = cv.getBoundingClientRect();
        var x = (ev.clientX - r.left) / Math.max(1, r.width), y = (ev.clientY - r.top) / Math.max(1, r.width);
        if (flip) { x = 1 - x; y = r.height / Math.max(1, r.width) - y; }
        return [Math.max(0, Math.min(999, Math.round(x * 1000))), Math.max(0, Math.min(1295, Math.round(y * 1000)))];
    }
    function redrawPad() {
        if (!cx || !cv) return;
        var w = cv.clientWidth, h = cv.clientHeight, k = w / 1000;
        cx.clearRect(0, 0, w, h);
        cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.lineWidth = Math.max(3, w / 140);
        cx.strokeStyle = getComputedStyle(cv).color || '#111';
        // 逆さにしている時も、画面ごと回っているので、ここではそのまま描く
        strokes.forEach(function (s) {
            cx.beginPath();
            cx.moveTo(s[0][0] * k, s[0][1] * k);
            if (s.length === 1) cx.lineTo(s[0][0] * k + .1, s[0][1] * k);
            for (var i = 1; i < s.length; i++) cx.lineTo(s[i][0] * k, s[i][1] * k);
            cx.stroke();
        });
    }

    // ---------------- 送る・消す ----------------
    function mine() { return live(D[side]); }
    function push(item) {
        var arr = mine().concat([item]).slice(-MAX_ITEMS);
        var patch = { open: true, at: now() };
        patch[side] = arr;
        if (isCd()) patch.req = D.req || now();
        D[side] = arr; D.open = true;
        A.write(patch);
        if (A.sound) A.sound();
        renderLog();
    }
    function sendText(t) {
        t = String(t || '').replace(/\s+$/, '').slice(0, MAX_TEXT);
        if (!t.trim()) return false;
        push({ i: uid(), k: 't', at: now(), t: t });
        return true;
    }
    function sendDraw() {
        if (!strokes.length) return false;
        var r = cv ? cv.clientHeight / Math.max(1, cv.clientWidth) : .6;
        push({ i: uid(), k: 'd', at: now(), p: enc(strokes), r: Math.round(Math.max(.3, Math.min(1.3, r)) * 100) / 100 });
        strokes = [];
        var pad = root.querySelector('.hs-pad');
        if (pad) pad.classList.remove('used');
        redrawPad();
        return true;
    }
    function onClick(ev) {
        var b = ev.target.closest('[data-h]');
        if (!b || !root || !root.contains(b)) return;
        var h = b.dataset.h, v = b.dataset.v;
        if (h === 'say') sendText(v);
        else if (h === 'speak') {
            var it = live(D.s).concat(live(D.c)).filter(function (x) { return x.i === v; })[0];
            if (it && it.t && A.speak) A.speak(it.t);
        }
        else if (h === 'send') {
            if (mode === 'text') { var ta = root.querySelector('.hs-ta'); if (ta && sendText(ta.value)) { ta.value = ''; ta.focus(); } }
            else sendDraw();
        } else if (h === 'mode') { mode = v === 'draw' ? 'draw' : 'text'; render(false); }
        else if (h === 'who') { side = v === 'c' ? 'c' : 's'; render(true); }
        else if (h === 'flip') { flip = !flip; render(true); }
        else if (h === 'wipe') { strokes = []; var pd = root.querySelector('.hs-pad'); if (pd) pd.classList.remove('used'); redrawPad(); }
        else if (h === 'undo') {
            if (mode === 'draw' && strokes.length) { strokes.pop(); if (!strokes.length) { var pe = root.querySelector('.hs-pad'); if (pe) pe.classList.remove('used'); } redrawPad(); return; }
            var arr = mine();
            if (!arr.length) return;
            arr = arr.slice(0, -1);
            var patch = {}; patch[side] = arr;
            D[side] = arr;
            A.write(patch);
            renderLog();
        } else if (h === 'clear') {
            if (!confirm('書いた物を全部消しますか？（お客様の画面からも消えます）')) return;
            var t = now();
            D.s = []; D.c = []; D.clr = t;
            A.write({ s: [], c: [], clr: t, open: true, at: t });
            renderLog();
        } else if (h === 'end') {
            if (isCd()) { A.write({ open: false, at: now() }); close(); return; }
            var t2 = now();
            D = { open: false, s: [], c: [], clr: t2, req: 0 };
            A.write({ open: false, s: [], c: [], clr: t2, req: 0, at: t2 });
            close();
        }
    }
    function onKey(ev) {
        // 文字を打っている時：Enter で送る（Shift+Enter・変換中は改行・確定）
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.target.classList && ev.target.classList.contains('hs-ta')) {
            ev.preventDefault();
            if (sendText(ev.target.value)) ev.target.value = '';
        }
    }
    function onResize() { if (root && cv) { setupPad(); } }

    // ---------------- 外から使う所 ----------------
    // api: { side: 's'|'c', local: 共有していないか, write(patch), total() → '¥1,280', info() → 上に出す文,
    //        dark() → 暗い配色か, sound(), onClose() }
    function open(api, doc) {
        A = api || {};
        side = A.side === 'c' ? 'c' : 's';
        if (doc) D = norm(doc);
        if (!root) {
            injectCss();
            root = document.createElement('div');
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-label', '筆談');
            root.addEventListener('click', onClick);
            root.addEventListener('keydown', onKey);
            document.body.appendChild(root);
            window.addEventListener('resize', onResize);
        }
        lastCount = live(D.s).length + live(D.c).length;
        render(true);
    }
    function close() {
        if (!root) return;
        window.removeEventListener('resize', onResize);
        root.remove();
        root = null; cv = null; cx = null; strokes = []; curStroke = null;
        if (A && A.onClose) A.onClose();
    }
    function update(doc) {
        var n = norm(doc);
        // 消した時刻より前の物は、自分の欄からも外す（消したあとに、古い物を送り直さないように）
        D = n;
        if (!root) return;
        var cnt = live(D.s).length + live(D.c).length;
        var theirs = live(D[side === 's' ? 'c' : 's']);
        if (cnt > lastCount && theirs.length && A.sound && theirs[theirs.length - 1].at > now() - 15000) A.sound(true);
        lastCount = cnt;
        renderLog();
    }
    function injectCss() {
        if (document.getElementById('hs-css')) return;
        var s = document.createElement('style');
        s.id = 'hs-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }
    var CSS = '\
.hs-board { position: fixed; inset: 0; z-index: 2600; display: flex; flex-direction: column; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0px)) 14px calc(12px + env(safe-area-inset-bottom, 0px)); background: #F2F3F7; color: #1C1D22; font-family: inherit; --hs-acc: #0A6CE0; --hs-surf: #FFFFFF; --hs-sunk: #E9EBF1; --hs-mute: #5E616C; --hs-mine: #0A6CE0; --hs-mine-ink: #fff; animation: hsIn .22s ease both; }\
.hs-board.hs-dark { background: #101116; color: #F2F3F7; --hs-surf: #1D1F27; --hs-sunk: #2A2D37; --hs-mute: #A9ADB9; --hs-mine: #2F7DE0; }\
.hs-board.hs-flip { transform: rotate(180deg); }\
@keyframes hsIn { from { opacity: 0; transform: translateY(12px); } }\
.hs-board.hs-flip { animation: none; }\
.hs-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\
.hs-mark { width: 40px; height: 40px; border-radius: 12px; background: var(--hs-acc); display: grid; place-items: center; flex: none; }\
.hs-mark svg { width: 26px; height: 26px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }\
.hs-ttl { font-size: 22px; font-weight: 800; display: flex; flex-direction: column; line-height: 1.15; }\
.hs-ttl small { font-size: 14px; font-weight: 700; color: var(--hs-mute); }\
.hs-info { font-size: 20px; font-weight: 800; padding: 6px 12px; border-radius: 999px; background: var(--hs-surf); font-variant-numeric: tabular-nums; }\
.hs-sp { flex: 1; }\
.hs-btn { min-height: 44px; padding: 0 16px; border: none; border-radius: 12px; background: var(--hs-sunk); color: inherit; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; }\
.hs-btn[aria-pressed="true"] { background: var(--hs-acc); color: #fff; }\
.hs-end { background: var(--hs-surf); box-shadow: inset 0 0 0 2px var(--hs-sunk); }\
.hs-seg { display: inline-flex; background: var(--hs-sunk); border-radius: 12px; padding: 3px; gap: 3px; }\
.hs-seg button { min-height: 40px; padding: 0 14px; border: none; border-radius: 9px; background: none; color: inherit; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; }\
.hs-seg button.on { background: var(--hs-surf); box-shadow: 0 1px 3px rgba(0,0,0,.12); }\
.hs-main { flex: 1; min-height: 0; display: flex; gap: 14px; }\
.hs-log { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 18px; background: var(--hs-surf); -webkit-overflow-scrolling: touch; }\
.hs-in { width: min(46%, 520px); display: flex; flex-direction: column; gap: 10px; min-height: 0; }\
.hs-empty { margin: auto; text-align: center; display: flex; flex-direction: column; gap: 8px; max-width: 30em; padding: 10px; }\
.hs-empty b { font-size: 24px; }\
.hs-empty span { font-size: 17px; color: var(--hs-mute); line-height: 1.6; }\
.hs-msg { display: flex; align-items: flex-end; gap: 8px; max-width: 88%; }\
.hs-msg.cont { margin-top: -6px; }\
.hs-col { display: flex; flex-direction: column; gap: 3px; min-width: 0; }\
.hs-msg small { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 800; color: var(--hs-mute); padding: 0 6px; }\
.hs-msg small time { font-weight: 700; font-size: 12px; opacity: .8; font-variant-numeric: tabular-nums; }\
.hs-msg.mine { align-self: flex-end; }\
.hs-msg.mine .hs-col { align-items: flex-end; }\
.hs-msg.theirs { align-self: flex-start; }\
.hs-av { flex: none; width: 38px; height: 38px; border-radius: 50%; background: var(--hs-sunk); display: grid; place-items: center; margin-bottom: 2px; }\
.hs-av.gap { background: none; }\
.hs-av svg { width: 22px; height: 22px; fill: none; stroke: var(--hs-mute); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\
.hs-b { padding: 12px 16px; border-radius: 20px; background: var(--hs-sunk); font-size: clamp(22px, 3.2vw, 34px); font-weight: 700; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }\
.hs-msg.theirs:not(.cont) .hs-b { border-bottom-left-radius: 6px; }\
.hs-msg.mine:not(.cont) .hs-b { border-bottom-right-radius: 6px; }\
.hs-msg.mine .hs-b { background: var(--hs-mine); color: var(--hs-mine-ink); }\
.hs-peer { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 14px; border-radius: 999px; background: var(--hs-surf); font-size: 15px; font-weight: 800; }\
.hs-peer i { width: 9px; height: 9px; border-radius: 50%; background: #2DBE73; box-shadow: 0 0 0 3px rgba(45,190,115,.18); }\
.hs-row { display: flex; align-items: center; gap: 6px; max-width: 100%; }\
.hs-row .hs-b { min-width: 0; }\
.hs-say { flex: none; width: 40px; height: 40px; border: none; border-radius: 50%; background: transparent; color: var(--hs-mute); display: grid; place-items: center; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1.5px var(--hs-sunk); }\
.hs-say svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }\
.hs-say svg path:first-child { fill: currentColor; }\
.hs-msg.ink .hs-b { padding: 6px; background: #fff; color: #1C1D22; box-shadow: inset 0 0 0 2px var(--hs-sunk); }\
.hs-msg.mine.ink .hs-b { box-shadow: inset 0 0 0 3px var(--hs-mine); }\
.hs-ink { display: block; max-width: 100%; max-height: 46vh; height: auto; }\
.hs-msg.ink { max-width: min(88%, 480px); }\
.hs-ink path { fill: none; stroke: currentColor; stroke-width: 10; stroke-linecap: round; stroke-linejoin: round; vector-effect: none; }\
.hs-phr { display: flex; flex-wrap: wrap; gap: 8px; flex: none; max-height: 46%; overflow-y: auto; }\
.hs-chip { min-height: 48px; padding: 6px 14px; border: none; border-radius: 14px; background: var(--hs-surf); color: inherit; font: inherit; font-size: 18px; font-weight: 800; cursor: pointer; box-shadow: inset 0 0 0 2px var(--hs-sunk); text-align: left; }\
.hs-cust .hs-chip { font-size: 22px; min-height: 56px; }\
.hs-chip:active, .hs-btn:active, .hs-send:active { filter: brightness(.92); }\
.hs-mode { align-self: flex-start; }\
.hs-ta { width: 100%; box-sizing: border-box; flex: 1; min-height: 96px; resize: none; padding: 12px 14px; border: none; border-radius: 14px; background: var(--hs-surf); color: inherit; font: inherit; font-size: 24px; font-weight: 700; line-height: 1.45; box-shadow: inset 0 0 0 2px var(--hs-sunk); }\
.hs-ta:focus { outline: none; box-shadow: inset 0 0 0 3px var(--hs-acc); }\
.hs-pad { position: relative; flex: 1; min-height: 160px; border-radius: 14px; background: #fff; color: #1C1D22; box-shadow: inset 0 0 0 2px var(--hs-sunk); overflow: hidden; }\
.hs-pad canvas { position: absolute; inset: 0; touch-action: none; color: #1C1D22; cursor: crosshair; }\
.hs-pad-hint { position: absolute; inset: 0; display: grid; place-items: center; font-size: 20px; font-weight: 700; color: #A0A4AF; pointer-events: none; }\
.hs-pad.used .hs-pad-hint { display: none; }\
.hs-acts { display: flex; gap: 8px; }\
.hs-acts .hs-btn { flex: 1; }\
.hs-send { flex: 1.4; min-height: 56px; border: none; border-radius: 14px; background: var(--hs-acc); color: #fff; font: inherit; font-size: 22px; font-weight: 800; cursor: pointer; }\
@media (max-width: 760px), (max-aspect-ratio: 1/1) {\
  .hs-main { flex-direction: column; gap: 10px; }\
  .hs-log { min-height: 120px; }\
  .hs-in { width: auto; flex: none; }\
  .hs-phr { max-height: 112px; }\
  .hs-cust .hs-chip { font-size: 19px; min-height: 50px; }\
  .hs-ta { min-height: 72px; flex: none; }\
  .hs-pad { min-height: 140px; flex: none; height: 22vh; }\
  .hs-ttl { font-size: 19px; }\
  .hs-btn { padding: 0 12px; font-size: 15px; }\
  .hs-top { flex-wrap: nowrap; }\
  .hs-ttl small { display: none; }\
  .hs-b { font-size: 21px; padding: 10px 14px; }\
  .hs-av { width: 32px; height: 32px; }\
  .hs-msg { max-width: 94%; gap: 6px; }\
}\
@media (prefers-reduced-motion: reduce) { .hs-board { animation: none; } }\
';
    window.HITSU = {
        open: open,
        close: close,
        update: update,
        isOpen: function () { return !!root; },
        side: function () { return side; },
        // テスト用
        _enc: enc, _dec: dec
    };
})();
