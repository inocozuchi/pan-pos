// 置き場の決まり（firestore.rules）の試験。本物と同じ Firestore エミュレーターで動かす。
//
// 実行（tests/rules で）:
//   npm i
//   npm test        （firebase emulators:exec で、エミュレーターを立てて、この試験を走らせる）
//
// ほかのお店・お客様・外された端末が「できてはいけないこと」が、ちゃんと断られるかを確かめる。
// あわせて、ふだんの使い方（お店を作る・端末を入れる・開店・会計・注文）が通ることも確かめる。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, runTransaction,
  serverTimestamp, Timestamp
} from 'firebase/firestore';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = await initializeTestEnvironment({
  projectId: 'demo-pos',
  firestore: { rules: readFileSync(path.join(here, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8085 }
});
await env.clearFirestore();   // 前の試験の残りを消して、まっさらから始める

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  ' + (e && e.message || e)); fail++; }
}
const db = uid => env.authenticatedContext(uid).firestore();
const anon = env.unauthenticatedContext().firestore();
const admin = fn => env.withSecurityRulesDisabled(c => fn(c.firestore()));
const SHOP = 'Sshopabcdefghijklmnop', SHOP2 = 'Sothershopabcdefghijk', CODE = '482913';
const ownerDb = db('owner1'), staffDb = db('staff1'), dispDb = db('disp1'), strangerDb = db('stranger'), custDb = db('cust1'), cust2Db = db('cust2');
const ev = (d, c = CODE) => doc(d, 'events', c);
const sub = (d, s, id, c = CODE) => doc(d, 'events', c, s, id);
const shop = (d, s = SHOP) => doc(d, 'shops', s);
const mem = (d, uid, s = SHOP) => doc(d, 'shops', s, 'members', uid);
const ss = (d, col, id, s = SHOP) => doc(d, 'shops', s, col, id);
const log = (d, uid, what, s = SHOP) => setDoc(doc(d, 'shops', s, 'log', uid + '-' + Math.random().toString(36).slice(2)), { t: what, by: uid, at: serverTimestamp(), name: '', who: '' });

// ---- お店を作る ----
await t('はじめての端末：お店と、自分をオーナーにする記録を同時に作れる', async () => {
  const b = writeBatch(ownerDb);
  b.set(shop(ownerDb), { event: '', name: '', open: false, at: 1, by: 'owner1' });
  b.set(mem(ownerDb, 'owner1'), { role: 'owner', name: 'レジ1', kind: 'register', at: 1, via: 'shop' });
  await assertSucceeds(b.commit());
});
await t('お店を作らずに、自分をオーナーにすることはできない', () =>
  assertFails(setDoc(mem(strangerDb, 'stranger'), { role: 'owner', name: 'x' })));
await t('ほかの人のお店に、あとから自分をオーナーとして入れない', () =>
  assertFails(setDoc(mem(strangerDb, 'stranger'), { role: 'owner', name: 'x', via: 'shop' })));
await t('ほかの人のお店に、自分をレジとして入れない', () =>
  assertFails(setDoc(mem(strangerDb, 'stranger'), { role: 'staff', name: 'x' })));
await t('ほかの人を作り手にしてお店を作れない', async () => {
  const d = db('x1'); const b = writeBatch(d);
  b.set(shop(d, SHOP2), { event: '', name: '', open: false, at: 1, by: 'owner1' });
  b.set(mem(d, 'x1', SHOP2), { role: 'owner', name: 'x' });
  await assertFails(b.commit());
});
await t('短すぎるお店の印は作れない（当てずっぽうで探されないように）', async () => {
  const d = db('x2'); const b = writeBatch(d);
  b.set(shop(d, 'abc'), { event: '', name: '', open: false, at: 1, by: 'x2' });
  b.set(mem(d, 'x2', 'abc'), { role: 'owner', name: 'x' });
  await assertFails(b.commit());
});

// ---- 端末を入れる（合言葉・お願い・許可）----
const TOKEN = 'K7PQ4XA2';
await t('オーナー：「端末を入れる」の合言葉を作れる（置き場の時刻・10分）', async () => {
  const b = writeBatch(ownerDb);
  b.set(ss(ownerDb, 'adds', TOKEN), { at: serverTimestamp(), min: 10, by: 'owner1' });
  b.set(doc(ownerDb, 'addcodes', TOKEN), { shop: SHOP, at: 1 });
  await assertSucceeds(b.commit());
});
await t('合言葉：作った時刻を端末の時計で書くことはできない（時計のずれで期限がずれない）', () =>
  assertFails(setDoc(ss(ownerDb, 'adds', 'CLOCK234'), { at: Date.now(), min: 10, by: 'owner1' })));
await t('合言葉：30分より長くは開けない', () =>
  assertFails(setDoc(ss(ownerDb, 'adds', 'LONGLONG'), { at: serverTimestamp(), min: 120, by: 'owner1' })));
await t('合言葉：ほかのお店を指す引く印は作れない', () =>
  assertFails(setDoc(doc(strangerDb, 'addcodes', 'FAKEFAKE'), { shop: SHOP, at: 1 })));
await t('合言葉を知っている人：合言葉からお店を引ける', () => assertSucceeds(getDoc(doc(strangerDb, 'addcodes', TOKEN))));
await t('合言葉の一覧・中身は、オーナーしか読めない', async () => {
  await assertFails(getDocs(collection(strangerDb, 'shops', SHOP, 'adds')));
  await assertFails(getDocs(collection(strangerDb, 'addcodes')));
});
await t('合言葉を知っている端末：お店に入れてほしいお願いを出せる', () =>
  assertSucceeds(setDoc(ss(staffDb, 'requests', 'staff1'), { name: 'iPad', kind: 'register', role: 'staff', t: TOKEN, at: 1 })));
await t('お願い：まちがった合言葉では出せない', () =>
  assertFails(setDoc(ss(strangerDb, 'requests', 'stranger'), { name: 'x', kind: 'register', role: 'staff', t: 'WRONG123', at: 1 })));
await t('お願い：オーナーとしては出せない', () =>
  assertFails(setDoc(ss(strangerDb, 'requests', 'stranger'), { name: 'x', role: 'owner', t: TOKEN, at: 1 })));
await t('お願い：ほかの人の名前では出せない', () =>
  assertFails(setDoc(ss(strangerDb, 'requests', 'someone'), { name: 'x', role: 'staff', t: TOKEN, at: 1 })));
await t('お願い：期限が切れた合言葉では出せない', async () => {
  await admin(d => setDoc(ss(d, 'adds', 'OLDOLD12'), { at: Timestamp.fromMillis(Date.now() - 11 * 60000), min: 10, by: 'owner1' }));
  await assertFails(setDoc(ss(strangerDb, 'requests', 'stranger'), { name: 'x', role: 'staff', t: 'OLDOLD12', at: 1 }));
});
await t('お願いを出しても、お店の販売会・メンバーは読めない', async () => {
  await assertFails(getDocs(collection(staffDb, 'shops', SHOP, 'members')));
});
await t('オーナー：お願いの一覧を読める', () => assertSucceeds(getDocs(collection(ownerDb, 'shops', SHOP, 'requests'))));
await t('お願いの一覧は、オーナーしか読めない', () => assertFails(getDocs(collection(strangerDb, 'shops', SHOP, 'requests'))));
await t('オーナー：許可する（メンバーにして、お願いを消す）', async () => {
  const b = writeBatch(ownerDb);
  b.set(mem(ownerDb, 'staff1'), { role: 'staff', name: 'iPad', kind: 'register', at: 2, by: 'owner1', via: 'add' });
  b.delete(ss(ownerDb, 'requests', 'staff1'));
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(mem(ownerDb, 'disp1'), { role: 'display', name: 'CD', kind: 'display', at: 2, by: 'owner1', via: 'add' }));
});
await t('レジ：ほかの端末をメンバーに入れられない', () =>
  assertFails(setDoc(mem(staffDb, 'stranger'), { role: 'staff', name: 'x' })));
await t('レジ：自分をオーナーに上げられない', () => assertFails(updateDoc(mem(staffDb, 'staff1'), { role: 'owner' })));
await t('レジ：自分の名前と、最後に使った時は直せる', () => assertSucceeds(updateDoc(mem(staffDb, 'staff1'), { name: 'iPad 2', seen: 5 })));
await t('レジ：お店のメンバーの一覧を読める', () => assertSucceeds(getDocs(collection(staffDb, 'shops', SHOP, 'members'))));
await t('レジ：合言葉は作れない', () =>
  assertFails(setDoc(ss(staffDb, 'adds', 'ZZZZZZZZ'), { at: serverTimestamp(), min: 10, by: 'staff1' })));
await t('知らない人：お店のメンバーの一覧を読めない', () => assertFails(getDocs(collection(strangerDb, 'shops', SHOP, 'members'))));

// ---- 開店 ----
await t('レジ：自分のお店の販売会を開ける', () =>
  assertSucceeds(setDoc(ev(staffDb), { owner: 'staff1', shop: SHOP, status: 'open', name: 'パン', roundId: 'r1', mobile: { on: true }, products: [{ name: 'あんぱん', price: 180 }] })));
await t('レジ：お店の行き先（いま開いている販売会）を書ける', () =>
  assertSucceeds(updateDoc(shop(staffDb), { event: CODE, open: true, name: 'パン', at: 2, by: 'staff1' })));
await t('知らない人：ほかのお店の販売会を開けない', () =>
  assertFails(setDoc(ev(strangerDb, '900001'), { owner: 'stranger', shop: SHOP, status: 'open' })));
await t('CD：販売会を開けない', () =>
  assertFails(setDoc(ev(dispDb, '900002'), { owner: 'disp1', shop: SHOP, status: 'open' })));
await t('作ってある販売会を、ほかの人が作り直す（上書きする）ことはできない', () =>
  assertFails(setDoc(ev(strangerDb), { owner: 'stranger', shop: SHOP2, status: 'open' })));
await t('ほかの人：お店の行き先を書きかえられない（偽のお店に連れて行けない）', () =>
  assertFails(updateDoc(shop(strangerDb), { event: '999999' })));
await t('お店の印は、だれも消せない（印刷したQRコードが使えなくならないように）', () => assertFails(deleteDoc(shop(ownerDb))));

// ---- 知らない人 ----
await t('ログインしていない：販売会を読めない', () => assertFails(getDoc(ev(anon))));
await t('知らない人：販売会を読めない', () => assertFails(getDoc(ev(strangerDb))));
await t('知らない人：販売会の一覧を読めない', () => assertFails(getDocs(collection(strangerDb, 'events'))));
await t('知らない人：開いている販売会を探せない', () => assertFails(getDocs(query(collection(strangerDb, 'events'), where('status', '==', 'open')))));
await t('知らない人：会計を書けない（勝手に会計できない）', () => assertFails(setDoc(sub(strangerDb, 'sales', 's1'), { total: 100 })));
await t('知らない人：会計を読めない', () => assertFails(getDocs(collection(strangerDb, 'events', CODE, 'sales'))));
await t('知らない人：販売会の中身を変えられない', () => assertFails(updateDoc(ev(strangerDb), { name: 'のっとり' })));
await t('知らない人：CDの表示（お客様のカゴ）を読めない', () => assertFails(getDoc(sub(strangerDb, 'live', 'cd'))));
await t('知らない人：予約（お客様の名前）を読めない', () => assertFails(getDocs(collection(strangerDb, 'events', CODE, 'reservations'))));
await t('知らない人：お店の印は1件ずつ読める（QRコードの行き先）が、一覧は出ない', async () => {
  await assertSucceeds(getDoc(shop(strangerDb)));
  await assertFails(getDocs(collection(strangerDb, 'shops')));
});

// ---- お店のメンバー（レジ・オーナー）----
await t('レジ：販売会を読める・会計を書ける', async () => {
  await assertSucceeds(getDoc(ev(staffDb)));
  await assertSucceeds(setDoc(sub(staffDb, 'sales', 's1'), { total: 100, items: [] }));
});
await t('オーナー：レジが開いた販売会も読める', () => assertSucceeds(getDoc(ev(ownerDb))));
await t('レジ：販売会の開いた端末・お店を書きかえられない', async () => {
  await assertFails(updateDoc(ev(staffDb), { owner: 'owner1' }));
  await assertFails(updateDoc(ev(staffDb), { shop: SHOP2 }));
});
await t('レジ：お店の設定は変えられる', () => assertSucceeds(updateDoc(ev(staffDb), { name: 'パン2' })));
await t('レジ：営業中は会計を消せない', () => assertFails(deleteDoc(sub(staffDb, 'sales', 's1'))));

// ---- CD（映すだけ）----
await t('CD：販売会とCDの表示を読める', async () => {
  await setDoc(sub(staffDb, 'live', 'cd'), { state: 'idle' });
  await assertSucceeds(getDoc(ev(dispDb)));
  await assertSucceeds(getDoc(sub(dispDb, 'live', 'cd')));
});
await t('CD：会計は書けない・読めない', async () => {
  await assertFails(setDoc(sub(dispDb, 'sales', 's9'), { total: 1 }));
  await assertFails(getDocs(collection(dispDb, 'events', CODE, 'sales')));
});
await t('CD：販売会の設定は変えられない', () => assertFails(updateDoc(ev(dispDb), { name: 'x' })));
await t('CD：筆談と、自分の在席は書ける', async () => {
  await assertSucceeds(setDoc(sub(dispDb, 'live', 'hitsu'), { c: [], open: true }, { merge: true }));
  await assertSucceeds(setDoc(sub(dispDb, 'devices', 'dev-cd'), { at: 1, role: 'display' }));
});
await t('CD：CDの表示は書きかえられない', () => assertFails(setDoc(sub(dispDb, 'live', 'cd'), { state: 'done' })));
await t('CD：お店の行き先は書けない', () => assertFails(updateDoc(shop(dispDb), { event: '' })));

// ---- お客様（モバイルオーダー）----
await t('お客様：メニュー・公開用の設定・待っている組を読める', async () => {
  await setDoc(sub(staffDb, 'live', 'menu'), { on: true, items: [] });
  await setDoc(sub(staffDb, 'live', 'pub'), { name: 'パン', status: 'open' });
  await setDoc(sub(staffDb, 'live', 'queue'), { s: [] });
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
// お客様の注文は、自分の注文の数（cust）を1つ数えるのと同時に作る
const sendOrder = async (d, uid, id, extra = {}) => {
  const c = doc(d, 'events', CODE, 'cust', uid);
  return runTransaction(d, async tx => {
    const s = await tx.get(c);
    const n = (s.exists() ? s.data().n : 0) + 1;
    tx.set(c, { n });
    tx.set(sub(d, 'orders', id), order(uid, Object.assign({ id }, extra)));
  });
};
await t('お客様：自分の注文を作れる', () => assertSucceeds(sendOrder(custDb, 'cust1', 'm-cust1')));
await t('お客様：注文の数を数えずに、注文だけを作ることはできない', () => assertFails(setDoc(sub(custDb, 'orders', 'm-x0'), order('cust1', { id: 'm-x0' }))));
await t('お客様：「払った」として注文を作れない', () => assertFails(sendOrder(custDb, 'cust1', 'm-x1', { paid: true })));
await t('お客様：「できあがり」として注文を作れない', () => assertFails(sendOrder(custDb, 'cust1', 'm-x2', { st: 'ready' })));
await t('お客様：ほかの人の名義で注文を作れない', () => assertFails(sendOrder(custDb, 'cust1', 'm-x3', { uid: 'cust2' })));
await t('お客様：決まりに無い項目は付けられない', () => assertFails(sendOrder(custDb, 'cust1', 'm-x4', { key: 'x' })));
await t('お客様：前の回の注文は作れない', () => assertFails(sendOrder(custDb, 'cust1', 'm-x5', { roundId: 'old' })));
await t('お客様：自分の注文を読める', () => assertSucceeds(getDoc(sub(custDb, 'orders', 'm-cust1'))));
await t('お客様：自分の注文だけの一覧は読める', () => assertSucceeds(getDocs(query(collection(custDb, 'events', CODE, 'orders'), where('uid', '==', 'cust1')))));
await t('お客様：ほかの人の注文は読めない', () => assertFails(getDoc(sub(cust2Db, 'orders', 'm-cust1'))));
await t('お客様：注文の一覧（ほかの人の分）は読めない', () => assertFails(getDocs(collection(cust2Db, 'events', CODE, 'orders'))));
await t('お客様：自分の注文でも、あとから書きかえられない（払った・取り消し）', () =>
  assertFails(updateDoc(sub(custDb, 'orders', 'm-cust1'), { paid: true })));
await t('お客様：注文の数を飛ばして数えられない', () => assertFails(setDoc(doc(custDb, 'events', CODE, 'cust', 'cust1'), { n: 29 })));
await t('お客様：1回の販売会で30件より多くは注文できない（いたずらの大量注文を止める）', async () => {
  await admin(d => setDoc(doc(d, 'events', CODE, 'cust', 'cust3'), { n: 30 }));
  await assertFails(sendOrder(db('cust3'), 'cust3', 'm-cust3'));
});
await t('お客様：番号札を1つ数えられる', () => assertSucceeds(setDoc(sub(custDb, 'live', 'mseq'), { n: 1 })));
await t('お客様：番号札を飛ばして数えられない', () => assertFails(setDoc(sub(custDb, 'live', 'mseq'), { n: 50 })));
await t('お客様：受付を止めている時は注文できない', async () => {
  await updateDoc(ev(staffDb), { 'mobile.on': false });
  await assertFails(sendOrder(cust2Db, 'cust2', 'm-cust2'));
  await updateDoc(ev(staffDb), { 'mobile.on': true });
});
await t('レジ：お客様の注文を「できあがり」にできる', () => assertSucceeds(updateDoc(sub(staffDb, 'orders', 'm-cust1'), { st: 'ready' })));
await t('CD（呼び出し番号）：注文を読める', () => assertSucceeds(getDocs(collection(dispDb, 'events', CODE, 'orders'))));

// ---- レストラン（テーブルから注文）----
const tableTx = (d, uid, table, billId) => runTransaction(d, async tx => {
  const tref = sub(d, 'tables', table), sref = sub(d, 'live', 'bseq');
  const ts = await tx.get(tref);
  const s2 = await tx.get(sref);
  const n = (s2.exists() ? s2.data().n : 0) + 1;
  tx.set(sub(d, 'bills', billId), { id: billId, no: n, table, st: 'open', at: 1, by: 'mobile', roundId: 'r1', paid: {}, pays: [] });
  tx.set(tref, { bill: billId, roundId: 'r1' });
  tx.set(sref, { n });
  return ts.exists() ? ts.data() : null;
});
await t('お客様：空いているテーブルの伝票を開ける', () => assertSucceeds(tableTx(custDb, 'cust1', '5', 'b-111')));
await t('お客様：開いている伝票を、別の伝票で横取りできない', () => assertFails(tableTx(cust2Db, 'cust2', '5', 'b-222')));
await t('お客様：そのテーブルの伝票に注文を足せる', () => assertSucceeds(sendOrder(cust2Db, 'cust2', 'm-t5', { dine: 'eat', table: '5', billId: 'b-111' })));
await t('お客様：ほかのテーブルの伝票に注文を付けられない', () => assertFails(sendOrder(cust2Db, 'cust2', 'm-t6', { dine: 'eat', table: '6', billId: 'b-111' })));
await t('お客様：伝票を「払った」にできない', () => assertFails(updateDoc(sub(custDb, 'bills', 'b-111'), { st: 'paid' })));

// ---- オーナーにする・控え ----
await t('オーナー：ほかの端末をオーナーにできる（電池切れの控え）', () => assertSucceeds(updateDoc(mem(ownerDb, 'staff1'), { role: 'owner' })));
await t('控えのオーナー：端末を入れる合言葉を作れる', () =>
  assertSucceeds(setDoc(ss(staffDb, 'adds', 'BACKUP23'), { at: serverTimestamp(), min: 10, by: 'staff1' })));
await t('オーナー：レジに戻せる', () => assertSucceeds(updateDoc(mem(ownerDb, 'staff1'), { role: 'staff' })));

// ---- お店の鍵 ----
const KEY = 'KEYKEYKEYKEYKEYKEY23';
await t('お店の鍵：オーナーは作れる・読める（鍵からお店を引く印も）', async () => {
  const b = writeBatch(ownerDb);
  b.set(ss(ownerDb, 'keys', KEY), { at: 1, by: 'owner1' });
  b.set(doc(ownerDb, 'shopkeys', KEY), { shop: SHOP, at: 1 });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDocs(collection(ownerDb, 'shops', SHOP, 'keys')));
});
await t('お店の鍵：レジ・ほかの人は、鍵を読めない・作れない', async () => {
  await assertFails(getDocs(collection(staffDb, 'shops', SHOP, 'keys')));
  await assertFails(getDoc(ss(strangerDb, 'keys', KEY)));
  await assertFails(setDoc(ss(strangerDb, 'keys', 'MYKEYMYKEYMYKEYMYKEY'), { at: 1, by: 'stranger' }));
  await assertFails(setDoc(doc(strangerDb, 'shopkeys', 'FAKEFAKEFAKEFAKEFAKE'), { shop: SHOP, at: 1 }));
});
await t('お店の鍵：まちがった鍵では「持っています」を書けない', () =>
  assertFails(setDoc(ss(db('newdev'), 'claims', 'newdev'), { k: 'WRONGWRONGWRONGWRONG', at: serverTimestamp() })));
await t('お店の鍵：鍵が無いと、オーナーになれない', () =>
  assertFails(setDoc(mem(db('newdev'), 'newdev'), { role: 'owner', name: 'x' })));
await t('お店の鍵：正しい鍵を使うと、オーナーになれる（なくした端末の代わり）', async () => {
  const d = db('newdev');
  await assertSucceeds(setDoc(ss(d, 'claims', 'newdev'), { k: KEY, at: serverTimestamp() }));
  await assertSucceeds(setDoc(mem(d, 'newdev'), { role: 'owner', name: '新しい端末', via: 'key', at: 6 }));
  await assertSucceeds(getDoc(ev(d)));
});
await t('お店の鍵：「持っています」の時刻を、端末の時計で書くことはできない', () =>
  assertFails(setDoc(ss(db('newdev2'), 'claims', 'newdev2'), { k: KEY, at: Date.now() })));
await t('お店の鍵：古い「持っています」（10分より前）では、オーナーになれない', async () => {
  await admin(d => setDoc(ss(d, 'claims', 'olddev'), { k: KEY, at: Timestamp.fromMillis(Date.now() - 11 * 60000) }));
  await assertFails(setDoc(mem(db('olddev'), 'olddev'), { role: 'owner', name: 'x' }));
});
await t('お店の鍵：作り直すと、前の鍵は使えない', async () => {
  await assertSucceeds(deleteDoc(ss(ownerDb, 'keys', KEY)));
  await assertFails(setDoc(ss(db('newdev3'), 'claims', 'newdev3'), { k: KEY, at: serverTimestamp() }));
});

// ---- お店の記録 ----
await t('お店の記録：メンバーは書き足せる（自分の名前・置き場の時刻で）', () => assertSucceeds(log(staffDb, 'staff1', 'join')));
await t('お店の記録：ほかの人の名前・端末の時計では書けない', async () => {
  await assertFails(setDoc(doc(staffDb, 'shops', SHOP, 'log', 'z1'), { t: 'join', by: 'owner1', at: serverTimestamp() }));
  await assertFails(setDoc(doc(staffDb, 'shops', SHOP, 'log', 'z2'), { t: 'join', by: 'staff1', at: Date.now() }));
});
await t('お店の記録：知らない人は書けない', () => assertFails(log(strangerDb, 'stranger', 'join')));
await t('お店の記録：オーナーだけが読める。だれも直せない・消せない', async () => {
  const q = await getDocs(collection(ownerDb, 'shops', SHOP, 'log'));
  const id = q.docs[0].id;
  await assertFails(getDocs(collection(staffDb, 'shops', SHOP, 'log')));
  await assertFails(updateDoc(doc(ownerDb, 'shops', SHOP, 'log', id), { t: 'x' }));
  await assertFails(deleteDoc(doc(ownerDb, 'shops', SHOP, 'log', id)));
});

// ---- 前の版のお店（owners に書いてある端末）----
await t('前の版のお店：owners に書いてある端末は、オーナーになれる（印刷したQRコードがそのまま使える）', async () => {
  await admin(d => setDoc(shop(d, SHOP2), { owners: ['old1'], event: '', name: '前の店', at: 1, open: false }));
  await assertSucceeds(setDoc(mem(db('old1'), 'old1', SHOP2), { role: 'owner', name: '前の端末', via: 'legacy' }));
  await assertFails(setDoc(mem(db('old2'), 'old2', SHOP2), { role: 'owner', name: 'x', via: 'legacy' }));
});
await t('前の版のお店：owners は書きかえられない', () =>
  assertFails(updateDoc(shop(db('old1'), SHOP2), { owners: ['old1', 'evil'] })));

// ---- 外す ----
await t('オーナー：端末を外せる。外された端末は、すぐに読めなくなる', async () => {
  await assertSucceeds(deleteDoc(mem(ownerDb, 'disp1')));
  await assertFails(getDoc(ev(dispDb)));
  await assertFails(getDoc(sub(dispDb, 'live', 'cd')));
});
await t('ほかのオーナーは、お店を作った端末も外せる（なくした・盗まれた時）', () => assertSucceeds(deleteDoc(mem(db('newdev'), 'owner1'))));
await t('外されたお店の作り手は、自分をオーナーに戻せない', async () => {
  await assertFails(setDoc(mem(ownerDb, 'owner1'), { role: 'owner', name: 'レジ1' }));
  await assertFails(getDoc(ev(ownerDb)));
});
await t('レジ：ほかの端末を外せない', () => assertFails(deleteDoc(mem(staffDb, 'newdev'))));
await t('レジ：自分でお店から抜けられる', async () => {
  await setDoc(mem(db('newdev'), 'tmp1'), { role: 'staff', name: 'x' });
  await assertSucceeds(deleteDoc(mem(db('tmp1'), 'tmp1')));
});

// ---- 閉店と片づけ ----
await t('閉店した後は、レジが片づけ（会計・注文の数・販売会を消す）できる', async () => {
  await updateDoc(ev(staffDb), { status: 'closed' });
  await assertSucceeds(deleteDoc(sub(staffDb, 'sales', 's1')));
  await assertSucceeds(getDocs(collection(staffDb, 'events', CODE, 'cust')));
  await assertSucceeds(deleteDoc(doc(staffDb, 'events', CODE, 'cust', 'cust1')));
  await assertSucceeds(deleteDoc(ev(staffDb)));
});
await t('閉店した販売会には、お客様は注文できない', () => assertFails(setDoc(doc(cust2Db, 'events', CODE, 'cust', 'cust2'), { n: 2 })));

await env.cleanup();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
