/*
 * 予約帳の共通の部品（お客様の予約ページ yoyaku.html と、管理のページ yoyaku-kanri.html で使う）
 * --------------------------------------------------
 * 予約帳は、レジ（index.html）とは別の仕組み。レジを初期化しても、販売会を閉じても、予約は消えない。
 *
 * 【置き場】Firestore の books/{予約帳の印}（決まりは firestore.rules の「予約帳」）
 *   books/{bid}            … 予約帳（題・品・受付の期間など）。だれにも消せない
 *   books/{bid}/resv/{rid} … 予約1つ。rid は長い乱数（知っている人だけが読める＝お客様の控えのリンク）。だれにも消せない
 *   books/{bid}/seq/s{n}   … 番号 n → 予約の印。同じ番号が2つできない・とびとびにならない
 *   books/{bid}/tally/c    … 何件目か（n）と、品ごとの予約の数（c）
 *   books/{bid}/sid/{h}    … 学籍番号ごとの予約の数（番号そのものは置かず、ハッシュだけ）
 *   books/{bid}/log/{id}   … 受け取り・取り消しの記録（足すだけ）
 *   books/{bid}/keys/{k}・bookkeys/{k} … 予約帳の鍵（管理の端末をなくしても、鍵で管理者に戻れる）
 *
 * 【端末の中】キーの頭は「yoyakucho_」。レジの初期化（taizanboku_ で始まるキーだけを消す）では消えない。
 *
 * 【二重の予約を防ぐ】予約の印（rid）は、送る前にこの端末で作って覚えておく。
 *   送った結果が分からない時（電波が切れた等）も、同じ印でもう一度送る。置き場に同じ印があれば、
 *   それを「予約できた」とする（2つ目は作らない）。
 */
(function () {
    'use strict';
    const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';
    const LS = 'yoyakucho_';
    const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const KEYAZ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 読みまちがえやすい字（I・O・0・1）を除く
    const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const yen = n => '¥' + (Math.round(Number(n) || 0)).toLocaleString('ja-JP');

    function randStr(n, az) {
        const out = [];
        const a = new Uint32Array(n);
        (window.crypto || window.msCrypto).getRandomValues(a);
        for (let i = 0; i < n; i++) out.push(az[a[i] % az.length]);
        return out.join('');
    }
    const newRid = () => 'r' + randStr(23, AZ);
    const newBid = () => 'bk' + randStr(22, AZ);
    const newKey = () => randStr(24, KEYAZ);
    const keyShow = k => String(k || '').replace(/(.{4})(?=.)/g, '$1-');
    const keyNorm = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isRid = r => /^[A-Za-z0-9]{20,40}$/.test(String(r || ''));
    const isBid = b => /^[A-Za-z0-9_-]{20,40}$/.test(String(b || ''));

    // 全角の英数字・記号を半角に。前後と途中の空白を除く
    function half(s) {
        return String(s == null ? '' : s).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
    }
    const normSid = s => half(s).replace(/\s+/g, '').toUpperCase().slice(0, 20);
    const normName = s => half(s).replace(/\s+/g, ' ').trim().slice(0, 30);

    async function sha256hex(text) {
        if (!(window.crypto && crypto.subtle && window.TextEncoder)) return '';
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // 学籍番号のハッシュ（予約帳ごとに違う。番号そのものは置き場に置かない）
    async function sidHash(bid, sid) {
        const n = normSid(sid);
        if (!n) return '';
        const h = await sha256hex('yoyakucho:' + bid + ':' + n);
        return h ? 'h' + h.slice(0, 31) : '';
    }

    function withTimeout(p, ms, label) {
        let t = 0;
        return Promise.race([p, new Promise((_, ng) => { t = setTimeout(() => { const e = new Error('timeout'); e.code = 'timeout'; e.label = label; ng(e); }, ms); })])
            .finally(() => clearTimeout(t));
    }
    const isPerm = e => !!e && (e.code === 'permission-denied' || /permission/i.test(String(e.message || '')));
    const isNet = e => !!e && (e.code === 'timeout' || e.code === 'unavailable' || e.code === 'deadline-exceeded' || /network|offline|timeout|unavailable/i.test(String(e.message || e.code || '')));

    // ---- 端末の中の保存（こわれていても動く） ----
    function lsGet(k, def) {
        try { const v = localStorage.getItem(LS + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    }
    function lsSet(k, v) {
        try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
    // IndexedDB の控え（localStorage がいっぱいの時・消えた時の、もう1つの控え）
    function idb() {
        return new Promise((ok, ng) => {
            try {
                const r = indexedDB.open('yoyakucho', 1);
                r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
                r.onsuccess = () => ok(r.result);
                r.onerror = () => ng(r.error);
            } catch (e) { ng(e); }
        });
    }
    async function idbPut(k, v) {
        try {
            const d = await idb();
            await new Promise((ok, ng) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = () => ng(t.error); });
            d.close();
            return true;
        } catch (e) { return false; }
    }
    async function idbGet(k) {
        try {
            const d = await idb();
            const v = await new Promise((ok, ng) => { const t = d.transaction('kv', 'readonly'); const q = t.objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); });
            d.close();
            return v;
        } catch (e) { return undefined; }
    }
    // この端末の保存を、ブラウザが勝手に消さないようにお願いする（できる端末だけ）
    function askPersist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {} }

    // ---- つなぐ ----
    function loadSdk() {
        const files = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
        return files.reduce((p, f) => p.then(() => new Promise((ok, ng) => {
            const s = document.createElement('script'); s.src = SDK + f; s.onload = ok; s.onerror = () => ng(new Error('sdk:' + f)); document.head.appendChild(s);
        })), Promise.resolve());
    }
    let conn = null, connP = null;
    // 同じ時に何度呼ばれても、つなぐのは1回だけ（2回目は、1回目の結果を待つ）
    function connect(opts) {
        if (conn) return Promise.resolve(conn);
        if (!connP) connP = connectOnce(opts).catch(e => { connP = null; throw e; });
        return connP;
    }
    async function connectOnce(opts) {
        if (!window.FIREBASE_CONFIG) { const e = new Error('no-config'); e.code = 'no-config'; throw e; }
        if (!window.firebase || !window.firebase.firestore) await withTimeout(loadSdk(), 20000, 'sdk');
        const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
        const db = firebase.firestore(app);
        // 試験の時だけ：手元のエミュレーターにつなぐ
        if (window.__FB_EMU) {
            db.useEmulator(window.__FB_EMU.host, window.__FB_EMU.fs);
            firebase.auth(app).useEmulator('http://' + window.__FB_EMU.host + ':' + window.__FB_EMU.auth, { disableWarnings: true });
        }
        try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) {}
        // 管理のページ：置き場の写しを端末にも持つ（電波が切れても一覧を読める）
        if (opts && opts.persist) { try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) {} }
        const auth = firebase.auth(app);
        try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}
        let user = auth.currentUser;
        if (!user) {
            user = await withTimeout(new Promise(ok => { const off = auth.onAuthStateChanged(u => { off(); ok(u); }); }), 8000, 'auth').catch(() => null);
        }
        if (!user) user = (await withTimeout(auth.signInAnonymously(), 20000, 'auth')).user;
        conn = { db, auth, uid: user.uid, FV: firebase.firestore.FieldValue, TS: firebase.firestore.Timestamp };
        return conn;
    }

    // ---- 予約帳 ----
    function bookState(b, now) {
        if (!b) return 'none';
        now = now || Date.now();
        if (!b.on) return 'off';
        if (b.from && now < b.from) return 'before';
        if (!b.to || now >= b.to) return 'after';
        return 'open';
    }
    // 品の一覧（印は英数字だけ。名前・値段・上限を整える）
    function bookItems(b) {
        return (Array.isArray(b && b.items) ? b.items : []).filter(it => it && /^[A-Za-z0-9_-]{1,20}$/.test(String(it.id)))
            .map(it => ({ id: String(it.id), name: String(it.name || '').slice(0, 40), price: Math.max(0, Math.round(Number(it.price) || 0)),
                cap: Math.max(0, Math.round(Number(it.cap) || 0)), desc: String(it.desc || '').slice(0, 120), off: !!it.off }));
    }
    // 残り（上限が0なら、上限なし＝Infinity）
    function remainOf(it, tally) {
        if (!it.cap) return Infinity;
        const used = Number(((tally && tally.c) || {})[it.id]) || 0;
        return Math.max(0, it.cap - used);
    }

    // 予約を1つ作る（お客様・管理者の店頭の予約で使う）。
    // order = { name, sid, lines: [{id, n}], via }。rid は呼ぶ側が前もって作って覚えておく。
    // 返す値：{ seq, existed, doc }。上限をこえる時は e.code = 'cap'、受付の外は 'closed'
    async function reserve(c, bid, rid, order, book) {
        const ref = c.db.collection('books').doc(bid);
        const resvRef = ref.collection('resv').doc(rid);
        const tallyRef = ref.collection('tally').doc('c');
        const items = bookItems(book);
        const lines = (order.lines || []).map(l => {
            const it = items.find(x => x.id === l.id);
            const n = Math.max(0, Math.round(Number(l.n) || 0));
            return it && n ? { id: it.id, name: it.name, price: it.price, n } : null;
        }).filter(Boolean);
        const qty = lines.reduce((s, l) => s + l.n, 0);
        const total = lines.reduce((s, l) => s + l.price * l.n, 0);
        if (!lines.length || qty < 1) { const e = new Error('empty'); e.code = 'empty'; throw e; }
        const hash = order.sid ? await sidHash(bid, order.sid) : '';
        const sidRef = hash ? ref.collection('sid').doc(hash) : null;
        let existed = null;
        // 同じ時に何人も予約すると、置き場の決まり（番号は1つずつ進める）で、あとの人が断られる（permission-denied）。
        // その時は、読み直して送り直す（少しずつ間をあける）。受付の外で断られた時も、数回で止まる
        let out = null;
        for (let i = 0; ; i++) {
            try { out = await once(); break; }
            catch (e) {
                if (!isPerm(e) || i >= 9) throw e;
                // 受付が止まった・期間が終わった時は、すぐに止める（待たせない）
                if (order.via !== 'shop') {
                    let now = null;
                    try { now = (await ref.get()).data(); } catch (e2) {}
                    if (now && bookState(now) !== 'open') { const e3 = new Error('closed'); e3.code = 'closed'; throw e3; }
                }
                await new Promise(ok => setTimeout(ok, Math.min(2500, 120 * Math.pow(1.7, i)) * (0.5 + Math.random())));
            }
        }
        return { seq: out.seq, existed: !!existed, lines, qty, total, doc: existed };
        function once() { return c.db.runTransaction(async tx => {
            existed = null;
            const have = await tx.get(resvRef);
            if (have.exists) { existed = have.data(); return { seq: existed.seq }; }
            const t = await tx.get(tallyRef);
            const tally = t.exists ? (t.data() || {}) : { n: 0, c: {} };
            const sidSnap = sidRef ? await tx.get(sidRef) : null;
            const cnt = Object.assign({}, tally.c || {});
            for (const l of lines) {
                const it = items.find(x => x.id === l.id);
                const left = remainOf(it, { c: cnt });
                if (l.n > left) { const e = new Error('cap'); e.code = 'cap'; e.item = it.name; e.left = left; throw e; }
                cnt[l.id] = (Number(cnt[l.id]) || 0) + l.n;
            }
            const n = (Number(tally.n) || 0) + 1;
            tx.set(tallyRef, { n, c: cnt });
            tx.set(ref.collection('seq').doc('s' + n), { r: rid });
            tx.set(resvRef, {
                uid: c.uid, seq: n, name: normName(order.name), sid: normSid(order.sid || ''), items: lines, qty, total,
                st: 'new', at: c.FV.serverTimestamp(), cat: Date.now(), via: String(order.via || 'web').slice(0, 10)
            });
            if (sidRef) tx.set(sidRef, { n: (sidSnap && sidSnap.exists ? (Number(sidSnap.data().n) || 0) : 0) + 1 });
            return { seq: n };
        }); }
    }

    // ---- Google スプレッドシート（控え）へ送る ----
    // Apps Script のウェブアプリだけに送る（ほかの所へ、名前・学籍番号を送らないように）
    const sheetOk = u => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(String(u || '').trim());
    function rowOf(bid, rid, r) {
        const at = r.at && r.at.toMillis ? r.at.toMillis() : (Number(r.cat) || Date.now());
        return {
            book: bid, rid, seq: r.seq || '', name: r.name || '', sid: r.sid || '',
            items: (r.items || []).map(l => l.name + '×' + l.n).join('、'), qty: r.qty || 0, total: r.total || 0,
            st: r.st || 'new', paid: r.paid ? 1 : 0, snote: r.snote || '', via: r.via || 'web', at: new Date(at).toISOString(),
            stAt: r.stAt ? new Date(r.stAt).toISOString() : ''
        };
    }
    // 届いたかどうかは分からない送り方（no-cors）。届かなくても、管理のページがあとでまとめて送り直す
    async function sheetPost(url, payload) {
        if (!sheetOk(url)) return false;
        try {
            await withTimeout(fetch(String(url).trim(), { method: 'POST', mode: 'no-cors', keepalive: JSON.stringify(payload).length < 60000, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }), 15000, 'sheet');
            return true;
        } catch (e) { return false; }
    }

    // ---- 日時 ----
    function dt(ms, withTime) {
        if (!ms) return '';
        const d = new Date(ms);
        return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）` + (withTime === false ? '' : ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
    }
    function msOf(v) { return v && v.toMillis ? v.toMillis() : (Number(v) || 0); }
    // 年も入れた日時（表計算ソフト・控えのファイル用）：2026/12/01 10:05
    function ymdhm(ms) {
        if (!ms) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    // 金額を確かめる：'bad' … 合計が品の値段×個数と合わない（書きかえられたかもしれない）、
    // 'old' … 予約した時の値段が、今の品の値段と違う（あとで値段を直した時など）、'' … 合っている
    function priceCheck(r, book) {
        const lines = Array.isArray(r && r.items) ? r.items : [];
        const sum = lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.n) || 0), 0);
        const qty = lines.reduce((s, l) => s + (Number(l.n) || 0), 0);
        if (sum !== Number(r.total) || qty !== Number(r.qty)) return 'bad';
        const items = bookItems(book);
        if (lines.some(l => { const it = items.find(x => x.id === l.id); return it && it.price !== Number(l.price); })) return 'old';
        return '';
    }

    // ---- CSV（表計算ソフトで、文字が式として動かないように） ----
    function csvCell(v) {
        let s = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    const ST_JA = { new: '予約中', done: '受け取り済み', cancel: '取り消し' };
    function toCsv(book, list) {
        const items = bookItems(book);
        const head = ['番号', '受付の日時', 'お名前', (book && book.sidLabel) || '学籍番号'].concat(items.map(i => i.name), ['個数', '金額', '状態', 'お支払い', 'お店のメモ', '受け方', '予約の印']);
        const rows = list.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).map(r => {
            const per = items.map(i => { const l = (r.items || []).find(x => x.id === i.id); return l ? l.n : ''; });
            return [r.seq, ymdhm(msOf(r.at) || r.cat), r.name, r.sid].concat(per, [r.qty, r.total, ST_JA[r.st] || r.st, r.paid ? '済み' : '', r.snote || '', r.via === 'shop' ? '店頭・電話' : 'ウェブ', r.rid]);
        });
        return '﻿' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
    }
    function download(name, text, type) {
        const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    }

    // ---- QRコード（vendor/qrcode-generator.js を使う） ----
    function qrSvg(text, alt) {
        if (typeof qrcode !== 'function') return '';
        try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: alt || 'QRコード' }); } catch (e) { return ''; }
    }
    function qrDraw(ctx, text, x, y, size) {
        if (typeof qrcode !== 'function') return false;
        try {
            const q = qrcode(0, 'M'); q.addData(text); q.make();
            const n = q.getModuleCount(), cell = size / (n + 4);
            ctx.fillStyle = '#fff'; ctx.fillRect(x, y, size, size);
            ctx.fillStyle = '#1d1630';
            for (let r = 0; r < n; r++) for (let c2 = 0; c2 < n; c2++) if (q.isDark(r, c2)) ctx.fillRect(x + (c2 + 2) * cell, y + (r + 2) * cell, Math.ceil(cell), Math.ceil(cell));
            return true;
        } catch (e) { return false; }
    }

    // ---- 動き ----
    // 「動きを減らす」の設定（端末の設定）
    const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

    window.Yoyaku = {
        LS, esc, yen, newRid, newBid, newKey, keyShow, keyNorm, isRid, isBid, normSid, normName, sidHash, sha256hex,
        withTimeout, isPerm, isNet, lsGet, lsSet, idbPut, idbGet, askPersist, connect, bookState, bookItems, remainOf, reserve,
        sheetOk, sheetPost, rowOf, dt, ymdhm, priceCheck, msOf, toCsv, csvCell, download, qrSvg, qrDraw, calm, ST_JA, WEEK
    };
})();
