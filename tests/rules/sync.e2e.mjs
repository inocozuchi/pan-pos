// レジ2台の共有の通しの試験（index.html）。Firestore・Auth エミュレーターに、本物の firestore.rules を当てて動かす
//
// 確かめること：2台目が合言葉で合流できる・両方の会計が両方に出る・取り消し・品目の直しが両方に届く・
//   電波の切れた端末の会計が、つながった時に届く（消えない・二重にならない）・どちらの端末でも合計と在庫が合う
//
// 実行方法（tests/rules で）:
//   npm i && npm i -D playwright
//   npx firebase emulators:exec --only firestore,auth --project demo-pos --config ../../firebase.json "node sync.e2e.mjs"
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
let pass = 0, fail = 0;
const ok = (n, c, info) => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}` + (c ? '' : ' ' + JSON.stringify(info))); c ? pass++ : fail++; };

const R = 'file://' + path.join(ROOT, 'index.html') + '?event=normal';
await L.wipe();
const b = await L.browser();
async function reg(dev, o) {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { window.__POS_TEST_SAMPLE = true; });
  const p = await L.page(b, Object.assign({ ctx, dev }, o || {}));
  await p.route(/open-meteo|fonts\.googleapis/, r => r.abort());
  await p.goto(R);
  await p.evaluate(() => { window.print = () => {}; window.alert = m => console.log('ALERT ' + m); });
  await p.waitForFunction(() => typeof syncReady !== 'undefined' && syncReady, null, { timeout: 40000 });
  return p;
}
const RA = await reg('A');
const opened = await RA.evaluate(async () => { openNewSetup(); document.getElementById('session-name-input').value = '共有の試験'; await startSession(); await new Promise(r => setTimeout(r, 1500)); return { s: !!currentSession, sync: syncMode, code: syncEventCode }; });
ok('1台目：開店すると共有になる', opened.s && opened.sync && /^\d{6}$/.test(opened.code), opened);
const inv = await RA.evaluate(async () => { const i = await makeInvite('register'); return i && i.token; });
ok('1台目：合言葉を出せる', !!inv, inv);
const RB = await reg('B');
const joined = await RB.evaluate(async t => { const r = await joinEvent(t); await new Promise(r => setTimeout(r, 2000)); return { r, sync: syncMode, code: syncEventCode, n: products.length }; }, opened.code + '-' + inv);
ok('2台目：合言葉で合流できる', joined.r && joined.sync && joined.code === opened.code && joined.n > 0, joined);

const sell = (p, names, cash) => p.evaluate(async ([names, cash]) => {
  names.forEach(n => addToCart(products.find(x => x.name === n)));
  openCheckout();
  document.getElementById('cash-input').value = String(cash);
  completeTransaction();
  await new Promise(r => setTimeout(r, 400));
}, [names, cash]);
const snap = p => p.evaluate(() => ({ n: salesHistory.length, sum: salesHistory.reduce((a, h) => a + h.total, 0), integ: checkIntegrity().filter(x => !/商品マスタ/.test(x)), stock: products.filter(p => !isUnlimited(p)).map(p => p.name + ':' + p.stock).join(',') }));
// 両方の端末が、決まった件数（と合計）にそろうまで待つ
const settle = async (n, sum) => { for (let i = 0; i < 40; i++) { const [a, c] = [await snap(RA), await snap(RB)]; if (a.n === n && c.n === n && a.sum === c.sum && a.stock === c.stock && (sum == null || a.sum !== sum)) return [a, c]; await L.wait(500); } return [await snap(RA), await snap(RB)]; };

await sell(RA, ['あんぱん', 'メロンパン'], 1000);
await sell(RB, ['塩パン', 'あんぱん', 'あんぱん'], 2000);
await sell(RA, ['クリームパン'], 500);
let [sa, sb] = await settle(3);
ok('両方の会計が、両方の端末に出る（3件）', sa.n === 3 && sb.n === 3 && sa.sum === sb.sum, [sa, sb]);
ok('両方の端末で、在庫が同じ', sa.stock === sb.stock, [sa.stock, sb.stock]);

// 同じ時に両方で会計（客No.がぶつからない）
await Promise.all([sell(RA, ['あんぱん'], 500), sell(RB, ['メロンパン'], 500)]);
[sa, sb] = await settle(5);
const nos = await RA.evaluate(() => salesHistory.map(h => (h.deviceLabel || '') + '#' + h.no));
ok('同じ時の会計も両方に届く（5件）', sa.n === 5 && sb.n === 5, [sa.n, sb.n]);
ok('記録が重ならない', new Set(nos).size === nos.length, nos);

// 1台目で、2台目の会計を取り消す
await RA.evaluate(() => { const i = salesHistory.findIndex(h => h.items.length === 3); voidSale(i); });
[sa, sb] = await settle(4);
ok('取り消しが両方に届く（4件）', sa.n === 4 && sb.n === 4 && sa.sum === sb.sum, [sa, sb]);

// 2台目で、品目を1つ増やす
await RB.evaluate(() => { const i = salesHistory.findIndex(h => h.items.length === 2); const it = salesHistory[i].items[0]; adjustRecordItem(i, recLineKey(it), 1); });
[sa, sb] = await settle(4, sa.sum);
ok('品目の直しが両方に届く', sa.sum === sb.sum && sa.n === 4, [sa, sb]);

// 2台目の電波が切れたまま3件会計 → つながると届く（消えない・二重にならない）
await RB.context().setOffline(true);
await sell(RB, ['あんぱん'], 500);
await sell(RB, ['塩パン'], 500);
await sell(RB, ['メロンパン'], 500);
const offB = await snap(RB);
await L.wait(1500);
const midA = await snap(RA);
ok('電波なしの間も、2台目では会計できる', offB.n === 7, offB);
ok('電波なしの会計は、まだ1台目に届かない', midA.n === 4, midA);
await RB.context().setOffline(false);
[sa, sb] = await settle(7);
ok('つながると、電波なしの会計が1台目に届く（7件・二重にならない）', sa.n === 7 && sb.n === 7 && sa.sum === sb.sum, [sa, sb]);
ok('どちらの端末でも、合計が品目と合う', !sa.integ.length && !sb.integ.length, [sa.integ, sb.integ]);
const remote = (await L.list(`events/${opened.code}/sales`)).filter(r => !r.voided);
ok('置き場の記録も7件', remote.length === 7, remote.length);

// 2台目を読み込み直しても、会計は消えない
await RB.reload();
await RB.waitForFunction(() => typeof syncReady !== 'undefined' && syncReady && salesHistory.length > 0, null, { timeout: 40000 }).catch(() => {});
await L.wait(1500);
const rb = await snap(RB);
ok('読み込み直しても、会計が残る', rb.n === 7 && rb.sum === sa.sum, rb);
ok('ページの中の失敗（エラー）が無い', !RA.errs.length && !RB.errs.length, [RA.errs.slice(0, 3), RB.errs.slice(0, 3)]);
await b.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
