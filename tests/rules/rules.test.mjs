// 置き場の決まり（firestore.rules）の試験。本物と同じ Firestore エミュレーターで動かす。
//
// 実行（tests/rules で）:
//   npm i
//   npm test        （firebase emulators:exec で、エミュレーターを立てて、この試験を走らせる）
//
// ほかのお店・お客様・外された端末が「できてはいけないこと」が、ちゃんと断られるかを確かめる。
// あわせて、ふだんの使い方（開店・合流・会計・注文）が通ることも確かめる。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, runTransaction
} from 'firebase/firestore';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await initializeTestEnvironment({
  projectId: 'demo-pos',
  firestore: { rules: readFileSync(path.join(here, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8085 }
});

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  ' + (e && e.message || e)); fail++; }
}
const db = uid => env.authenticatedContext(uid).firestore();
const anon = env.unauthenticatedContext().firestore();
const CODE = '482913', SHOP = 'shop-abcdefghijklmnop';
const ownerDb = db('owner1'), staffDb = db('staff1'), dispDb = db('disp1'), strangerDb = db('stranger'), custDb = db('cust1'), cust2Db = db('cust2');
const ev = (d, c = CODE) => doc(d, 'events', c);
const sub = (d, s, id, c = CODE) => doc(d, 'events', c, s, id);

// ---- 開店 ----
await t('オーナー：販売会と自分のメンバーを同時に作れる', async () => {
  const b = writeBatch(ownerDb);
  b.set(ev(ownerDb), { owner: 'owner1', shop: SHOP, status: 'open', name: 'パン', roundId: 'r1', mobile: { on: true }, products: [{ name: 'あんぱん', price: 180 }] });
  b.set(sub(ownerDb, 'members', 'owner1'), { role: 'owner', name: 'レジ1', at: 1 });
  await assertSucceeds(b.commit());
});
await t('ほかの人をオーナーにして販売会を作ることはできない', () =>
  assertFails(setDoc(ev(strangerDb, '900001'), { owner: 'owner1', status: 'open' })));
await t('ほかの人の販売会に、あとから自分をオーナーとして入れない', () =>
  assertFails(setDoc(sub(strangerDb, 'members', 'stranger'), { role: 'owner', name: 'x' })));
await t('作ってある販売会を、ほかの人が作り直す（上書きする）ことはできない', () =>
  assertFails(setDoc(ev(strangerDb), { owner: 'stranger', status: 'open' })));

// ---- 知らない人 ----
await t('ログインしていない：販売会を読めない', () => assertFails(getDoc(ev(anon))));
await t('知らない人：販売会を読めない', () => assertFails(getDoc(ev(strangerDb))));
await t('知らない人：販売会の一覧を読めない', () => assertFails(getDocs(collection(strangerDb, 'events'))));
await t('知らない人：開いている販売会を探せない', () => assertFails(getDocs(query(collection(strangerDb, 'events'), where('status', '==', 'open')))));
await t('知らない人：会計を書けない（勝手に会計できない）', () =>
  assertFails(setDoc(sub(strangerDb, 'sales', 's1'), { total: 100 })));
await t('知らない人：会計を読めない', () => assertFails(getDocs(collection(strangerDb, 'events', CODE, 'sales'))));
await t('知らない人：販売会の中身を変えられない', () => assertFails(updateDoc(ev(strangerDb), { name: 'のっとり' })));
await t('知らない人：メンバーの一覧を読めない', () => assertFails(getDocs(collection(strangerDb, 'events', CODE, 'members'))));
await t('知らない人：CDの表示（お客様のカゴ）を読めない', () => assertFails(getDoc(sub(strangerDb, 'live', 'cd'))));
await t('知らない人：予約（お客様の名前）を読めない', () => assertFails(getDocs(collection(strangerDb, 'events', CODE, 'reservations'))));

// ---- 合流のお願い ----
await t('共有コードを知っている人：合流のお願いを出せる', () =>
  assertSucceeds(setDoc(sub(strangerDb, 'requests', 'stranger'), { name: 'iPad', role: 'staff', at: 1, kind: 'register' })));
await t('合流のお願い：ほかの人の名前では出せない', () =>
  assertFails(setDoc(sub(strangerDb, 'requests', 'someone'), { name: 'iPad', role: 'staff', at: 1 })));
await t('合流のお願い：オーナーとしては出せない', () =>
  assertFails(setDoc(sub(strangerDb, 'requests', 'stranger'), { name: 'iPad', role: 'owner', at: 1 })));
await t('合流のお願い：お願いを出しても、中身は読めない', () => assertFails(getDoc(ev(strangerDb))));
await t('オーナー：お願いの一覧を読める', () => assertSucceeds(getDocs(collection(ownerDb, 'events', CODE, 'requests'))));
await t('オーナー：許可する（メンバーに足す）', () =>
  assertSucceeds(setDoc(sub(ownerDb, 'members', 'staff1'), { role: 'staff', name: 'レジ2', via: 'approve', at: 2 })));
await t('許可された端末：販売会を読める', () => assertSucceeds(getDoc(ev(staffDb))));
await t('許可された端末：会計を書ける', () => assertSucceeds(setDoc(sub(staffDb, 'sales', 's1'), { total: 100, items: [] })));
await t('許可された端末：自分をオーナーに上げられない', () =>
  assertFails(updateDoc(sub(staffDb, 'members', 'staff1'), { role: 'owner' })));
await t('許可された端末：自分の名前は直せる', () =>
  assertSucceeds(updateDoc(sub(staffDb, 'members', 'staff1'), { name: 'レジ2号' })));
await t('レジ：ほかの端末をメンバーに足せない', () =>
  assertFails(setDoc(sub(staffDb, 'members', 'stranger'), { role: 'staff', name: 'x' })));
await t('レジ：販売会のオーナーを書きかえられない', () => assertFails(updateDoc(ev(staffDb), { owner: 'staff1' })));
await t('レジ：お店の印を書きかえられない', () => assertFails(updateDoc(ev(staffDb), { shop: 'shop-zzzzzzzzzzzzzzzz' })));
await t('レジ：お店の設定は変えられる', () => assertSucceeds(updateDoc(ev(staffDb), { name: 'パン2' })));
await t('レジ：営業中は、ほかの端末を外せない', () => assertFails(deleteDoc(sub(staffDb, 'members', 'owner1'))));
await t('レジ：営業中は会計を消せない', () => assertFails(deleteDoc(sub(staffDb, 'sales', 's1'))));
await t('お店の人が「お願いを受け付けない」にすると、お願いを出せない', async () => {
  await updateDoc(ev(ownerDb), { reqOff: true });
  await assertFails(setDoc(sub(db('x9'), 'requests', 'x9'), { name: 'a', role: 'staff', at: 1 }));
  await updateDoc(ev(ownerDb), { reqOff: false });
});

// ---- 合流の合言葉 ----
const TOKEN = 'K7PQ4XA2', exp = Date.now() + 15 * 60000;
await t('オーナー：合流の合言葉を作れる', () =>
  assertSucceeds(setDoc(sub(ownerDb, 'invites', TOKEN), { role: 'display', exp, by: 'owner1', at: 1 })));
await t('レジ：合流の合言葉は作れない', () =>
  assertFails(setDoc(sub(staffDb, 'invites', 'ZZZZZZZZ'), { role: 'staff', exp, by: 'staff1', at: 1 })));
await t('合言葉の一覧は、オーナーしか読めない', () => assertFails(getDocs(collection(staffDb, 'events', CODE, 'invites'))));
await t('合言葉を知っている端末：同じ役割でメンバーになれる', () =>
  assertSucceeds(setDoc(sub(dispDb, 'members', 'disp1'), { role: 'display', name: 'CD', inv: TOKEN, at: 3 })));
await t('合言葉：違う役割（レジ）では入れない', () =>
  assertFails(setDoc(sub(db('d2'), 'members', 'd2'), { role: 'staff', name: 'x', inv: TOKEN })));
await t('合言葉：まちがった合言葉では入れない', () =>
  assertFails(setDoc(sub(db('d3'), 'members', 'd3'), { role: 'display', name: 'x', inv: 'WRONG123' })));
await t('合言葉：期限切れでは入れない', async () => {
  await setDoc(sub(ownerDb, 'invites', 'OLDOLD12'), { role: 'staff', exp: Date.now() - 1000, by: 'owner1', at: 1 });
  await assertFails(setDoc(sub(db('d4'), 'members', 'd4'), { role: 'staff', name: 'x', inv: 'OLDOLD12' }));
});
await t('合言葉：1日より長い期限は作れない', () =>
  assertFails(setDoc(sub(ownerDb, 'invites', 'LONGLONG'), { role: 'staff', exp: Date.now() + 3 * 86400000, by: 'owner1', at: 1 })));

// ---- CD（映すだけ）----
await t('CD：販売会とCDの表示を読める', async () => {
  await setDoc(sub(ownerDb, 'live', 'cd'), { state: 'idle' });
  await assertSucceeds(getDoc(ev(dispDb)));
  await assertSucceeds(getDoc(sub(dispDb, 'live', 'cd')));
});
await t('CD：会計は書けない', () => assertFails(setDoc(sub(dispDb, 'sales', 's9'), { total: 1 })));
await t('CD：会計は読めない', () => assertFails(getDocs(collection(dispDb, 'events', CODE, 'sales'))));
await t('CD：販売会の設定は変えられない', () => assertFails(updateDoc(ev(dispDb), { name: 'x' })));
await t('CD：筆談と、自分の在席は書ける', async () => {
  await assertSucceeds(setDoc(sub(dispDb, 'live', 'hitsu'), { c: [], open: true }, { merge: true }));
  await assertSucceeds(setDoc(sub(dispDb, 'devices', 'dev-cd'), { at: 1, role: 'display' }));
});
await t('CD：CDの表示は書きかえられない', () => assertFails(setDoc(sub(dispDb, 'live', 'cd'), { state: 'done' })));

// ---- お客様（モバイルオーダー）----
await t('お客様：メニュー・公開用の設定・待っている組を読める', async () => {
  await setDoc(sub(ownerDb, 'live', 'menu'), { on: true, items: [] });
  await setDoc(sub(ownerDb, 'live', 'pub'), { name: 'パン', status: 'open' });
  await setDoc(sub(ownerDb, 'live', 'queue'), { s: [] });
  await assertSucceeds(getDoc(sub(custDb, 'live', 'menu')));
  await assertSucceeds(getDoc(sub(custDb, 'live', 'pub')));
  await assertSucceeds(getDoc(sub(custDb, 'live', 'queue')));
});
await t('お客様：お店の中の文書（CD・筆談）は読めない', async () => {
  await assertFails(getDoc(sub(custDb, 'live', 'cd')));
  await assertFails(getDoc(sub(custDb, 'live', 'hitsu')));
});
await t('お客様：販売会の文書（クーポンの印・担当者など）は読めない', () => assertFails(getDoc(ev(custDb))));
const order = (uid, extra = {}) => Object.assign({
  id: 'm-' + uid, no: 'M0001', at: 1, dine: 'take', items: [{ name: 'あんぱん', qty: 1, price: 180 }], st: 'cook', channel: 'mobile',
  paid: false, total: 180, uid, roundId: 'r1', upd: 1, chk: [], t: {}, dev: ''
}, extra);
await t('お客様：自分の注文を作れる', () => assertSucceeds(setDoc(sub(custDb, 'orders', 'm-cust1'), order('cust1'))));
await t('お客様：「払った」として注文を作れない', () => assertFails(setDoc(sub(custDb, 'orders', 'm-x1'), order('cust1', { id: 'm-x1', paid: true }))));
await t('お客様：「できあがり」として注文を作れない', () => assertFails(setDoc(sub(custDb, 'orders', 'm-x2'), order('cust1', { id: 'm-x2', st: 'ready' }))));
await t('お客様：ほかの人の名義で注文を作れない', () => assertFails(setDoc(sub(custDb, 'orders', 'm-x3'), order('cust2', { id: 'm-x3' }))));
await t('お客様：決まりに無い項目は付けられない', () => assertFails(setDoc(sub(custDb, 'orders', 'm-x4'), order('cust1', { id: 'm-x4', key: 'x' }))));
await t('お客様：前の回の注文は作れない', () => assertFails(setDoc(sub(custDb, 'orders', 'm-x5'), order('cust1', { id: 'm-x5', roundId: 'old' }))));
await t('お客様：自分の注文を読める', () => assertSucceeds(getDoc(sub(custDb, 'orders', 'm-cust1'))));
await t('お客様：自分の注文だけの一覧は読める', () => assertSucceeds(getDocs(query(collection(custDb, 'events', CODE, 'orders'), where('uid', '==', 'cust1')))));
await t('お客様：ほかの人の注文は読めない', () => assertFails(getDoc(sub(cust2Db, 'orders', 'm-cust1'))));
await t('お客様：注文の一覧（ほかの人の分）は読めない', () => assertFails(getDocs(collection(cust2Db, 'events', CODE, 'orders'))));
await t('お客様：自分の注文でも、あとから書きかえられない（払った・取り消し）', () =>
  assertFails(updateDoc(sub(custDb, 'orders', 'm-cust1'), { paid: true })));
await t('お客様：番号札を1つ数えられる', () => assertSucceeds(setDoc(sub(custDb, 'live', 'mseq'), { n: 1 })));
await t('お客様：番号札を飛ばして数えられない', () => assertFails(setDoc(sub(custDb, 'live', 'mseq'), { n: 50 })));
await t('お客様：受付を止めている時は注文できない', async () => {
  await updateDoc(ev(ownerDb), { 'mobile.on': false });
  await assertFails(setDoc(sub(cust2Db, 'orders', 'm-cust2'), order('cust2')));
  await updateDoc(ev(ownerDb), { 'mobile.on': true });
});
await t('レジ：お客様の注文を「できあがり」にできる', () => assertSucceeds(updateDoc(sub(staffDb, 'orders', 'm-cust1'), { st: 'ready' })));
await t('CD（呼び出し番号）：注文を読める', () => assertSucceeds(getDocs(collection(dispDb, 'events', CODE, 'orders'))));

// ---- レストラン（テーブルから注文）----
const tableTx = (d, table, billId) => runTransaction(d, async tx => {
  const tref = sub(d, 'tables', table), sref = sub(d, 'live', 'bseq');
  const ts = await tx.get(tref);
  const ss = await tx.get(sref);
  const n = (ss.exists() ? ss.data().n : 0) + 1;
  tx.set(sub(d, 'bills', billId), { id: billId, no: n, table, st: 'open', at: 1, by: 'mobile', roundId: 'r1', paid: {}, pays: [] });
  tx.set(tref, { bill: billId, roundId: 'r1' });
  tx.set(sref, { n });
  return ts.exists() ? ts.data() : null;
});
await t('お客様：空いているテーブルの伝票を開ける', () => assertSucceeds(tableTx(custDb, '5', 'b-111')));
await t('お客様：開いている伝票を、別の伝票で横取りできない', () => assertFails(tableTx(cust2Db, '5', 'b-222')));
await t('お客様：そのテーブルの伝票に注文を足せる', () =>
  assertSucceeds(setDoc(sub(cust2Db, 'orders', 'm-t5'), order('cust2', { id: 'm-t5', dine: 'eat', table: '5', billId: 'b-111' }))));
await t('お客様：ほかのテーブルの伝票に注文を付けられない', () =>
  assertFails(setDoc(sub(cust2Db, 'orders', 'm-t6'), order('cust2', { id: 'm-t6', dine: 'eat', table: '6', billId: 'b-111' }))));
await t('お客様：伝票を「払った」にできない', () => assertFails(updateDoc(sub(custDb, 'bills', 'b-111'), { st: 'paid' })));

// ---- お店の印（QRコードの行き先）----
await t('オーナー：お店の印を作れる', () =>
  assertSucceeds(setDoc(doc(ownerDb, 'shops', SHOP), { owners: ['owner1'], event: CODE, name: 'パン', at: 1, open: true })));
await t('お客様：お店の印からいまの販売会が分かる', () => assertSucceeds(getDoc(doc(custDb, 'shops', SHOP))));
await t('お店の一覧は、だれも読めない', () => assertFails(getDocs(collection(custDb, 'shops'))));
await t('ほかの人：お店の行き先を書きかえられない（偽のお店に連れて行けない）', () =>
  assertFails(updateDoc(doc(strangerDb, 'shops', SHOP), { event: '999999' })));
await t('ほかの人：自分をお店のオーナーに足せない', () =>
  assertFails(updateDoc(doc(strangerDb, 'shops', SHOP), { owners: ['owner1', 'stranger'] })));
await t('短すぎるお店の印は作れない（当てずっぽうで探されないように）', () =>
  assertFails(setDoc(doc(strangerDb, 'shops', 'abc'), { owners: ['stranger'], event: '', name: '', at: 1 })));

// ---- いつもの端末へ「合流しますか」 ----
await t('オーナー：メンバーにした端末へ、合流の知らせを送れる', () =>
  assertSucceeds(setDoc(doc(ownerDb, 'users', 'staff1', 'inbox', CODE), { code: CODE, name: 'パン', at: 1, from: 'owner1', role: 'staff' })));
await t('オーナー：メンバーでない端末へは送れない', () =>
  assertFails(setDoc(doc(ownerDb, 'users', 'stranger', 'inbox', CODE), { code: CODE, name: 'パン', at: 1, from: 'owner1' })));
await t('レジ：合流の知らせは送れない', () =>
  assertFails(setDoc(doc(staffDb, 'users', 'disp1', 'inbox', CODE), { code: CODE, name: 'パン', at: 1, from: 'staff1' })));
await t('知らせは本人だけが読める', async () => {
  await assertSucceeds(getDocs(collection(staffDb, 'users', 'staff1', 'inbox')));
  await assertFails(getDocs(collection(strangerDb, 'users', 'staff1', 'inbox')));
});

// ---- 外す ----
await t('オーナー：端末を外せる。外された端末は、もう読めない', async () => {
  await assertSucceeds(deleteDoc(sub(ownerDb, 'members', 'disp1')));
  await assertFails(getDoc(ev(dispDb)));
  await assertFails(getDoc(sub(dispDb, 'live', 'cd')));
});
await t('ほかのオーナーでも、開店した端末は外せない', async () => {
  await setDoc(sub(ownerDb, 'members', 'owner2'), { role: 'owner', name: 'レジ3' });
  await assertFails(deleteDoc(sub(db('owner2'), 'members', 'owner1')));
});

// ---- 閉店と片づけ ----
await t('閉店した後は、レジが片づけ（会計・メンバーを消す）できる', async () => {
  await updateDoc(ev(staffDb), { status: 'closed' });
  await assertSucceeds(deleteDoc(sub(staffDb, 'sales', 's1')));
  await assertSucceeds(deleteDoc(sub(staffDb, 'requests', 'stranger')));
  await assertSucceeds(deleteDoc(sub(staffDb, 'invites', TOKEN)));
  await assertSucceeds(deleteDoc(ev(staffDb)));
  await assertSucceeds(deleteDoc(sub(staffDb, 'members', 'owner2')));
  await assertSucceeds(deleteDoc(sub(staffDb, 'members', 'staff1')));
});
await t('閉店した販売会には、お願いを出せない', () =>
  assertFails(setDoc(sub(db('late'), 'requests', 'late'), { name: 'a', role: 'staff', at: 1 })));

await env.cleanup();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
