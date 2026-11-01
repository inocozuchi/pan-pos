// 予約帳（yoyaku.html・yoyaku-kanri.html）の通しの試験。Firestore・Auth エミュレーターに、本物の firestore.rules を当てて動かす
//
// 実行方法（tests/rules で）:
//   npm i && npm i -D playwright
//   npx firebase emulators:exec --only firestore,auth --project demo-pos --config ../../firebase.json "node yoyaku.e2e.mjs"
//
// 確かめること：予約できる・管理の一覧に出る・受け取り・元に戻す・取り消し（数えが戻る）・記録が残る・店頭の予約・数え直し・
//   控えのファイル・CSV・レジの初期化で端末の写しが消えない・鍵で別の端末から管理者になる・控えのファイルを開く・
//   何度押しても1件・同時に予約しても上限と番号が正しい・送れたか分からない時の送り直し・電波なし・受付の外・文字の混入
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SDK = path.join(HERE, 'node_modules', 'firebase') + '/';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'yoyaku-'));
const EMU = { host: '127.0.0.1', fs: Number(process.env.FSP || 8085), auth: Number(process.env.AUP || 9099) };
const BASE = `http://${EMU.host}:${EMU.fs}/v1/projects/demo-pos/databases/(default)/documents/`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
function val(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
}
function unval(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unval);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, unval(x)]));
  return v;
}
const docOf = j => j && j.fields ? Object.fromEntries(Object.entries(j.fields).map(([k, x]) => [k, unval(x)])) : null;
async function put(path, obj) {
  const r = await fetch(BASE + path, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, val(x)])) }) });
  if (!r.ok) throw new Error('put ' + path + ' ' + r.status + ' ' + await r.text());
}
async function get(path) { const r = await fetch(BASE + path, { headers: H }); return r.status === 200 ? docOf(await r.json()) : null; }
async function list(path) { const r = await fetch(BASE + path + '?pageSize=1000', { headers: H }); const j = await r.json(); return (j.documents || []).map(d => Object.assign({ _id: d.name.split('/').pop() }, docOf(d))); }
async function wipe() {
  await fetch(`http://${EMU.host}:${EMU.fs}/emulator/v1/projects/demo-pos/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${EMU.host}:${EMU.auth}/emulator/v1/projects/demo-pos/accounts`, { method: 'DELETE' });
}
function bookObj(over) {
  return Object.assign({ owners: ['seed-owner'], title: '12月 シュトーレンのご予約', shop: '泰山木', lead: 'ドライフルーツとナッツをたっぷり練りこんだ、冬だけの焼き菓子です。',
    pickup: '12月20日（土）12:00〜15:00\n学生会館 1階', note: '受け取りの時にお支払いください。', on: true, from: Date.now() - 60000, to: Date.now() + 86400000,
    items: [{ id: 'st', name: 'シュトーレン（ホール）', price: 1800, cap: 30, desc: '約18cm・ラッピング付き' }, { id: 'hf', name: 'シュトーレン（ハーフ）', price: 1000, cap: 3, desc: '約9cm' }],
    maxQty: 5, sidLabel: '学籍番号', sidReq: true, sheet: '', theme: 'stollen', at: Date.now(), ver: 1 }, over || {});
}
async function browser() { return chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}); }
async function page(b, o) {
  o = o || {};
  const ctx = o.ctx || await b.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: o.dpr || 2, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.calm ? 'reduce' : 'no-preference', hasTouch: !!o.touch, isMobile: !!o.touch });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => { p.errs.push(e.message); console.log('PAGEERR', o.dev || '', e.message, String(e.stack || '').split('\n').slice(1, 3).join(' | ')); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', o.dev || '', m.type(), m.text().slice(0, 240)); });
  p.on('dialog', d => d.accept(o.prompt || '').catch(() => {}));
  await p.route('**/www.gstatic.com/firebasejs/**', r => { const f = r.request().url().split('/').pop(); r.fulfill({ path: SDK + f, contentType: 'application/javascript' }); });
  await p.route('**/data/firebase-config.js', r => r.fulfill({ body: "window.FIREBASE_CONFIG = { apiKey: 'fake-key', authDomain: 'demo-pos.firebaseapp.com', projectId: 'demo-pos', appId: '1:123:web:abc' };", contentType: 'application/javascript' }));
  await p.route('**/script.google.com/**', r => { (global.__sheet = global.__sheet || []).push(r.request().postData()); r.fulfill({ status: 200, body: 'ok' }); });
  await p.addInitScript(e => { window.__FB_EMU = e; }, EMU);
  if (o.url) await p.goto(o.url);
  return p;
}
const L = { EMU, put, get, list, wipe, bookObj, browser, page, wait: ms => new Promise(r => setTimeout(r, ms)) };
const C = 'file://' + path.join(ROOT, 'yoyaku.html');
const A = 'file://' + path.join(ROOT, 'yoyaku-kanri.html');
let pass = 0, fail = 0;
const ok = (n, c, info) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}` + (c ? '' : ' ' + JSON.stringify(info))); c ? pass++ : fail++; };
async function fillAndCheck(p, name, sid, picks) {
  await p.waitForSelector('.item', { timeout: 20000 });
  for (const [id, n] of picks) for (let i = 0; i < n; i++) await p.click(`.item[data-id="${id}"] [data-act="inc"]`);
  await p.click('#bar-go'); await p.waitForSelector('#f-name');
  await p.fill('#f-name', name); await p.fill('#f-sid', sid);
  await p.click('#to-check'); await p.waitForSelector('#send', { timeout: 10000 });
}

// ---- 管理のページ ----
{
  await L.wipe();
  const b = await L.browser();
  const ctxA = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const a = await L.page(b, { ctx: ctxA, dev: 'A' });
  await a.goto(A);
  await a.waitForSelector('#w-new', { timeout: 15000 });
  await a.click('#w-new');
  await a.waitForSelector('.sheet .key', { timeout: 20000 });
  await L.wait(500);
  const adm = await a.evaluate(() => JSON.parse(localStorage.getItem('yoyakucho_admin')));
  const bid = adm.cur, key = adm.books[0].key;
  ok('予約帳ができ、鍵をこの端末に覚える', /^bk/.test(bid) && key.length === 24, adm);
  const bk = await L.get('bookkeys/' + key);
  ok('鍵から予約帳を引ける', bk && bk.book === bid, bk);
  const bdoc = await L.get('books/' + bid);
  ok('はじめは受付を止めている', bdoc && bdoc.on === false && bdoc.items.length === 1, bdoc);
  await a.click('.sheet [data-x]'); await L.wait(400);
  // 設定
  await a.fill('[data-k="shop"]', '泰山木');
  await a.fill('[data-k="pickup"]', '12月20日（土）12:00〜15:00\n学生会館');
  await a.fill('[data-ik="cap"]', '3');
  await a.click('[data-act="addItem"]');
  const names = await a.$$('[data-ik="name"]');
  await names[1].fill('シュトーレン（ハーフ）');
  const prices = await a.$$('[data-ik="price"]');
  await prices[1].fill('900');
  await a.click('[data-act="saveDraft"]'); await L.wait(1200);
  const b2 = await L.get('books/' + bid);
  ok('設定を保存できる', b2.shop === '泰山木' && b2.items.length === 2 && b2.items[0].cap === 3 && b2.items[1].price === 900, b2.items);

  await a.click('[data-act="toggleOn"]'); await L.wait(1200);
  ok('受付を始められる', (await L.get('books/' + bid)).on === true);
  // お客様
  const cu = await L.page(b, { dev: 'C', url: C + '?b=' + bid });
  await cu.waitForSelector('.item', { timeout: 20000 });
  for (let i = 0; i < 2; i++) await cu.click('.item:nth-child(1) [data-act="inc"]');
  await cu.click('#bar-go'); await L.wait(600);
  await cu.fill('#f-name', '山田 花子'); await cu.fill('#f-sid', 'b2400001');
  await cu.click('#to-check'); await L.wait(800);
  await cu.click('#send');
  await cu.waitForSelector('#ticket', { timeout: 20000 });
  await a.click('[data-tab="list"]');
  await a.waitForSelector('.r', { timeout: 15000 });
  ok('管理のページに予約が出る', (await a.textContent('.r')).includes('山田 花子'));
  // 受け取り
  await a.click('[data-quick]'); await L.wait(1500);
  const rs1 = await L.list(`books/${bid}/resv`);
  ok('受け取り済みにできる', rs1[0].st === 'done' && typeof rs1[0].stAt === 'number', rs1[0]);
  // 元に戻す
  await a.click('#toast-b'); await L.wait(1500);
  ok('元に戻せる', (await L.list(`books/${bid}/resv`))[0].st === 'new');
  // 取り消し（数えが戻る）
  await a.click('.r'); await a.waitForSelector('.sheet [data-st="cancel"]');
  await L.wait(500);
  await a.click('.sheet [data-st="cancel"]'); await L.wait(1800);
  const t1 = await L.get(`books/${bid}/tally/c`);
  ok('取り消すと、数えが戻る', (await L.list(`books/${bid}/resv`))[0].st === 'cancel' && t1.c.st === 0 && t1.n === 1, t1);
  const logs = await L.list(`books/${bid}/log`);
  ok('変えた記録が3つ残る', logs.length === 3, logs.map(l => l.from + '>' + l.to));
  // お客様の控えに状態が出る
  await L.wait(1500);
  ok('お客様の控えに「取り消し」が出る', (await cu.textContent('#tk-st')).includes('取り消し'));
  // 店頭の予約
  await a.click('[data-act="add"]'); await a.waitForSelector('#a-name');
  await a.fill('#a-name', '佐藤'); await a.click('.add-it:nth-child(2) [data-d="1"]');
  await a.click('#a-go'); await L.wait(2500);
  const rs2 = await L.list(`books/${bid}/resv`);
  ok('店頭の予約を足せる（No.2・店頭）', rs2.some(r => r.seq === 2 && r.via === 'shop'), rs2.map(r => [r.seq, r.via]));
  // 集計・数え直し
  await a.click('[data-tab="sum"]'); await L.wait(600);
  await L.put(`books/${bid}/tally/c`, { n: 2, c: { st: 7 } });
  await L.wait(800);
  await a.click('[data-act="recount"]'); await L.wait(2000);
  const t2 = await L.get(`books/${bid}/tally/c`);
  ok('数え直すと、品の数が一覧と合う', t2.n === 2 && t2.c.st === undefined || (t2.c.st || 0) === 0 && t2.c[Object.keys(t2.c).find(k => k !== 'st')] === 1, t2);
  // 控えのファイル
  await a.click('[data-tab="safe"]'); await L.wait(500);
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-act="saveJson"]')]);
  const jp = OUT + '/backup.json'; await dl.saveAs(jp);
  const j = JSON.parse(require('fs').readFileSync(jp, 'utf8'));
  ok('控えのファイルに予約が全部ある', Object.keys(j.resv).length === 2 && j.kind === 'yoyakucho-backup');
  const [dl2] = await Promise.all([a.waitForEvent('download'), a.click('[data-act="csv"]')]);
  const cp = OUT + '/list.csv'; await dl2.saveAs(cp);
  const csv = require('fs').readFileSync(cp, 'utf8');
  ok('CSV に予約がある', csv.includes('山田 花子') && csv.includes('取り消し'), csv.slice(0, 200));
  // 端末の写しは、レジの初期化で消えない
  const kept = await a.evaluate(() => { Object.keys(localStorage).forEach(k => { if (k.indexOf('taizanboku_') === 0) localStorage.removeItem(k); }); const m = JSON.parse(localStorage.getItem('yoyakucho_mirror_' + JSON.parse(localStorage.getItem('yoyakucho_admin')).cur) || 'null'); return m && Object.keys(m.resv).length; });
  ok('レジの初期化（taizanboku_ を消す）でも、端末の写しは残る', kept === 2, kept);
  // 別の端末：鍵で開く
  const ctxB = await b.newContext({ viewport: { width: 820, height: 1180 } });
  const nb = await L.page(b, { ctx: ctxB, dev: 'B', prompt: key.slice(0, 4) + '-' + key.slice(4) });
  await nb.goto(A);
  await nb.waitForSelector('#w-key');
  await nb.click('#w-key');
  await nb.waitForSelector('.r', { timeout: 20000 });
  ok('鍵で、別の端末から管理者になれる', (await nb.$$('.r')).length === 2);
  await L.wait(800);
  // 何をしても予約は消えない
  const cnt = (await L.list(`books/${bid}/resv`)).length;
  ok('予約は2件のまま', cnt === 2);
  // 控えのファイルを開く（電波なしでも）
  const v = await L.page(b, { dev: 'V' });
  await v.goto(A);
  await v.waitForSelector('#w-file');
  const [fc] = await Promise.all([v.waitForEvent('filechooser'), v.click('#w-file')]);
  await fc.setFiles(jp);
  await v.waitForSelector('.r', { timeout: 8000 });
  ok('控えのファイルを開ける', (await v.$$('.r')).length === 2);
  await b.close();
}
// ---- 強さ ----
{
  await L.wipe();
  const BID = 'bkROBUSTabcdefghijklmnop';
  await L.put('books/' + BID, L.bookObj({ items: [{ id: 'st', name: 'シュトーレン', price: 1500, cap: 5 }, { id: 'hf', name: 'ハーフ', price: 900, cap: 0 }] }));
  const b = await L.browser();

  // 1) ボタンを何度押しても1件
  const p1 = await L.page(b, { url: C + '?b=' + BID, dev: 'p1' });
  await fillAndCheck(p1, '連打 太郎', 'R0001', [['hf', 1]]);
  await p1.evaluate(() => { const b = document.getElementById('send'); for (let i = 0; i < 6; i++) b.click(); });
  await p1.waitForSelector('#ticket', { timeout: 20000 });
  await L.wait(800);
  ok('何度押しても予約は1件', (await L.list(`books/${BID}/resv`)).filter(r => r.name === '連打 太郎').length === 1);

  // 2) 同時に8人が上限5個の品を1個ずつ → ちょうど5件、番号は1〜6でとびとびにならない
  const ps = [];
  for (let i = 0; i < 8; i++) ps.push(await L.page(b, { url: C + '?b=' + BID, dev: 'm' + i }));
  for (let i = 0; i < 8; i++) await fillAndCheck(ps[i], '同時' + i, 'S000' + i, [['st', 1]]);
  await Promise.all(ps.map(p => p.click('#send')));
  await L.wait(9000);
  const rs = await L.list(`books/${BID}/resv`);
  const st = rs.filter(r => (r.items || []).some(l => l.id === 'st'));
  ok('上限5個：同時でも5件まで', st.length === 5, st.length);
  const seqs = rs.map(r => r.seq).sort((a, b) => a - b);
  ok('番号は1から続き、同じ番号はない', seqs.every((n, i) => n === i + 1), seqs);
  const capMsg = (await Promise.all(ps.map(p => p.evaluate(() => (document.getElementById('send-err') || {}).textContent || '')))).filter(t => t.includes('のこり'));
  ok('上限をこえた人には「のこり」の知らせ', capMsg.length === 3, capMsg.length);
  const t = await L.get(`books/${BID}/tally/c`);
  ok('数えが合う', t.n === seqs.length && t.c.st === 5, t);
  for (const p of ps) await p.close();

  // 3) 送れたか分からない（実は届いていた）→ 次に開くと「届いていました」、2つ目は作らない
  const p3 = await L.page(b, { url: C + '?b=' + BID, dev: 'p3' });
  await fillAndCheck(p3, '不明 花子', 'U0001', [['hf', 2]]);
  const rid3 = await p3.evaluate(async () => {
    const rid = Yoyaku.newRid();
    localStorage.setItem('yoyakucho_pend_bkROBUSTabcdefghijklmnop', JSON.stringify({ rid, order: { name: '不明 花子', sid: 'U0001', lines: [{ id: 'hf', n: 2 }], via: 'web' } }));
    const c = await Yoyaku.connect();
    const book = (await c.db.collection('books').doc('bkROBUSTabcdefghijklmnop').get()).data();
    await Yoyaku.reserve(c, 'bkROBUSTabcdefghijklmnop', rid, { name: '不明 花子', sid: 'U0001', lines: [{ id: 'hf', n: 2 }] }, book);
    return rid;
  });
  await p3.reload();
  await p3.waitForSelector('#ticket', { timeout: 20000 });
  ok('前に届いていた予約を見つけて控えを出す', (await L.list(`books/${BID}/resv`)).filter(r => r.name === '不明 花子').length === 1 && p3.url().includes(rid3));

  // 4) 送れたか分からない（届いていない）→ 確かめの面に戻り、同じ印で送ると1件
  const p4 = await L.page(b, { url: C + '?b=' + BID, dev: 'p4' });
  await p4.waitForSelector('.item');
  const rid4 = 'rPENDINGxxxxxxxxxxxxxxx1';
  await p4.evaluate(r => localStorage.setItem('yoyakucho_pend_bkROBUSTabcdefghijklmnop', JSON.stringify({ rid: r, order: { name: '未送 次郎', sid: 'P0001', lines: [{ id: 'hf', n: 1 }], via: 'web' } })), rid4);
  await p4.reload();
  await p4.waitForSelector('#send', { timeout: 20000 });
  ok('届いていない予約は、確かめの面に戻る', (await p4.textContent('#view')).includes('未送 次郎'));
  await p4.click('#send');
  await p4.waitForSelector('#ticket', { timeout: 20000 });
  ok('同じ印で送られる', !!(await L.get(`books/${BID}/resv/${rid4}`)));

  // 5) 電波なしで送る → 失敗の知らせ。電波が戻ると自動で送り直し、1件だけ
  const p5 = await L.page(b, { url: C + '?b=' + BID, dev: 'p5' });
  await fillAndCheck(p5, '電波 三郎', 'N0001', [['hf', 1]]);
  await p5.context().setOffline(true);
  await p5.click('#send');
  await p5.waitForSelector('#send-err', { timeout: 120000 });
  ok('電波なし：送れなかったと出る（2つにならない旨も）', (await p5.textContent('#send-err')).includes('2つにはなりません'));
  await p5.context().setOffline(false);
  await p5.waitForSelector('#ticket', { timeout: 60000 }).catch(() => {});
  await L.wait(1500);
  ok('電波が戻ると送れて、1件だけ', (await L.list(`books/${BID}/resv`)).filter(r => r.name === '電波 三郎').length === 1);

  // 6) 受付を止める → 画面が「止めています」に変わる
  await L.put('books/' + BID, L.bookObj({ on: false, items: [{ id: 'st', name: 'シュトーレン', price: 1500, cap: 5 }, { id: 'hf', name: 'ハーフ', price: 900, cap: 0 }] }));
  await L.wait(1500);
  ok('受付を止めると、お客様の画面が変わる', (await p1.evaluate(() => document.body.textContent)).includes('受付を止めています') || (await p5.evaluate(() => document.body.textContent)).includes('受付を止めています'));
  const p6 = await L.page(b, { url: C + '?b=' + BID, dev: 'p6' });
  await p6.waitForSelector('.shut-card', { timeout: 20000 });
  ok('止めている時は、品を選べない', (await p6.$$('.item')).length === 0);
  const direct = await p6.evaluate(async () => { const c = await Yoyaku.connect(); const book = (await c.db.collection('books').doc('bkROBUSTabcdefghijklmnop').get()).data(); try { await Yoyaku.reserve(c, 'bkROBUSTabcdefghijklmnop', Yoyaku.newRid(), { name: 'x', sid: '', lines: [{ id: 'hf', n: 1 }] }, Object.assign(book, { on: true })); return 'ok'; } catch (e) { return e.code; } });
  ok('止めている時は、直接書いても置き場が断る（すぐに止まる）', direct === 'permission-denied' || direct === 'closed', direct);

  // 7) 名前に文字を混ぜても、管理のページ・控えで動かない
  await L.put('books/' + BID, L.bookObj({ items: [{ id: 'st', name: 'シュトーレン<img src=x onerror=window.__x=1>', price: 1500, cap: 50 }] }));
  const p7 = await L.page(b, { url: C + '?b=' + BID, dev: 'p7' });
  await fillAndCheck(p7, '<img src=x onerror=window.__x=1>', 'X0001', [['st', 1]]);
  await p7.click('#send'); await p7.waitForSelector('#ticket', { timeout: 20000 });
  ok('お客様のページで文字が動かない', !(await p7.evaluate(() => window.__x)));
  const ad = await L.page(b, { dev: 'adm' });
  await ad.goto(A);
  await ad.waitForSelector('#w-new');
  const r8 = await ad.evaluate(async () => { const c = await Yoyaku.connect(); try { await c.db.collection('books').doc('bkROBUSTabcdefghijklmnop').collection('resv').get(); return { uid: c.uid, r: 'read' }; } catch (e) { return { uid: c.uid, r: e.code }; } });
  ok('管理者でない端末は一覧を読めない', r8.r === 'permission-denied', r8);
  await L.put('books/' + BID, L.bookObj({ owners: [r8.uid], items: [{ id: 'st', name: 'シュトーレン<img src=x onerror=window.__x=1>', price: 1500, cap: 50 }] }));
  await ad.evaluate(() => localStorage.setItem('yoyakucho_admin', JSON.stringify({ books: [{ bid: 'bkROBUSTabcdefghijklmnop', key: '', title: 't' }], cur: 'bkROBUSTabcdefghijklmnop', who: '' })));
  await ad.reload();
  await ad.waitForSelector('.r', { timeout: 20000 });
  await ad.click('.r'); await L.wait(800); await ad.keyboard.press('Escape'); await L.wait(400);
  await ad.click('[data-tab="sum"]'); await L.wait(500);
  await ad.click('[data-tab="set"]'); await L.wait(500);
  ok('管理のページでも文字が動かない（一覧・詳しく・集計・設定）', !(await ad.evaluate(() => window.__x)) && ad.errs.length === 0);
  await b.close();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
