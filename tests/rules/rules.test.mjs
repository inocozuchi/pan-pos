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
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, runTransaction,
  serverTimestamp, Timestamp, arrayUnion, arrayRemove
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

// ---- 合流の合言葉（30分・1回だけ。時刻は置き場の時刻）----
const TOKEN = 'K7PQ4XA2';
const inv = (role, min = 30) => ({ role, min, by: 'owner1', at: serverTimestamp() });
// 合言葉で入る：メンバーになるのと同時に、その合言葉を消す（1回だけ）
const useInvite = (uid, role, token) => { const d = db(uid); const b = writeBatch(d); b.set(sub(d, 'members', uid), { role, name: uid, inv: token, at: 3 }); b.delete(sub(d, 'invites', token)); return b.commit(); };
await t('オーナー：合流の合言葉を作れる', () => assertSucceeds(setDoc(sub(ownerDb, 'invites', TOKEN), inv('display'))));
await t('合言葉：作った時刻を端末の時計で書くことはできない（時計のずれで期限がずれない）', () =>
  assertFails(setDoc(sub(ownerDb, 'invites', 'CLOCK234'), { role: 'staff', min: 30, by: 'owner1', at: Date.now() })));
await t('合言葉：1時間より長い合言葉は作れない', () => assertFails(setDoc(sub(ownerDb, 'invites', 'LONGLONG'), inv('staff', 600))));
await t('レジ：合流の合言葉は作れない', () =>
  assertFails(setDoc(sub(staffDb, 'invites', 'ZZZZZZZZ'), { role: 'staff', min: 30, by: 'staff1', at: serverTimestamp() })));
await t('合言葉の一覧は、オーナーしか読めない', () => assertFails(getDocs(collection(staffDb, 'events', CODE, 'invites'))));
await t('合言葉：違う役割（レジ）では入れない', () => assertFails(useInvite('d2', 'staff', TOKEN)));
await t('合言葉：使ったことにしない（消さない）と入れない', () =>
  assertFails(setDoc(sub(db('d6'), 'members', 'd6'), { role: 'display', name: 'x', inv: TOKEN })));
await t('合言葉：入らずに合言葉だけを消すことはできない', () => assertFails(deleteDoc(sub(db('d7'), 'invites', TOKEN))));
await t('合言葉を知っている端末：同じ役割でメンバーになれる', () => assertSucceeds(useInvite('disp1', 'display', TOKEN)));
await t('合言葉：一度使った合言葉は、もう使えない（写真に撮られても入れない）', () => assertFails(useInvite('d5', 'display', TOKEN)));
await t('合言葉：まちがった合言葉では入れない', () => assertFails(useInvite('d3', 'display', 'WRONG123')));
await t('合言葉：期限切れでは入れない', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'events', CODE, 'invites', 'OLDOLD12'), { role: 'staff', min: 30, by: 'owner1', at: Timestamp.fromMillis(Date.now() - 31 * 60000) }));
  await assertFails(useInvite('d4', 'staff', 'OLDOLD12'));
});

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
await t('お店の印は、だれも消せない（印刷したQRコードが使えなくならないように）', () => assertFails(deleteDoc(doc(ownerDb, 'shops', SHOP))));

// ---- 開店した端末の電池が切れた・なくした時の控え ----
await t('オーナー：ほかの端末を、お店のオーナーに足せる', () =>
  assertSucceeds(updateDoc(doc(ownerDb, 'shops', SHOP), { owners: arrayUnion('backup1') })));
await t('お店のオーナーの端末：そのお店の販売会のオーナーになれる（開店した端末がいなくても）', () =>
  assertSucceeds(setDoc(sub(db('backup1'), 'members', 'backup1'), { role: 'owner', name: '控え', via: 'shop', at: 5 })));
await t('お店のオーナーでない端末は、販売会のオーナーになれない', () =>
  assertFails(setDoc(sub(db('x8'), 'members', 'x8'), { role: 'owner', name: 'x', via: 'shop', at: 5 })));
await t('お店のオーナーでない端末は、ほかのお店の印を付けた販売会でも、オーナーになれない', async () => {
  // 自分で作った販売会に、ほかのお店の印を付けても、そのお店のオーナーの記録は増えない
  const d = db('evil1');
  const b = writeBatch(d);
  b.set(ev(d, '700001'), { owner: 'evil1', shop: SHOP, status: 'open' });
  b.set(sub(d, 'members', 'evil1', '700001'), { role: 'owner', name: 'x', at: 1 });
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(d, 'shops', SHOP), { event: '700001' }));
});
await t('お店の鍵：オーナーは作れる・読める', async () => {
  await assertSucceeds(setDoc(doc(ownerDb, 'shops', SHOP, 'keys', 'KEYKEYKEYKEYKEYKEY2345'), { at: 1, by: 'owner1' }));
  await assertSucceeds(getDocs(collection(ownerDb, 'shops', SHOP, 'keys')));
});
await t('お店の鍵：鍵からお店を引く印を作れる（鍵を知っている人だけが引ける）', async () => {
  const b = writeBatch(ownerDb);
  b.set(doc(ownerDb, 'shops', SHOP, 'keys', 'LOOKUPLOOKUPLOOKUP23'), { at: 1, by: 'owner1' });
  b.set(doc(ownerDb, 'shopkeys', 'LOOKUPLOOKUPLOOKUP23'), { shop: SHOP, at: 1 });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDoc(doc(db('anyone'), 'shopkeys', 'LOOKUPLOOKUPLOOKUP23')));
  await assertFails(getDocs(collection(db('anyone'), 'shopkeys')));
});
await t('お店の鍵：ほかのお店を指す引く印は作れない', () =>
  assertFails(setDoc(doc(strangerDb, 'shopkeys', 'FAKEFAKEFAKEFAKEFAKE'), { shop: SHOP, at: 1 })));
await t('お店の鍵：ほかの人は、鍵を読めない・作れない', async () => {
  await assertFails(getDocs(collection(strangerDb, 'shops', SHOP, 'keys')));
  await assertFails(getDoc(doc(strangerDb, 'shops', SHOP, 'keys', 'KEYKEYKEYKEYKEYKEY2345')));
  await assertFails(setDoc(doc(strangerDb, 'shops', SHOP, 'keys', 'MYKEYMYKEYMYKEYMYKEY22'), { at: 1, by: 'stranger' }));
});
await t('お店の鍵：まちがった鍵では「持っています」を書けない', () =>
  assertFails(setDoc(doc(db('newdev'), 'shops', SHOP, 'claims', 'newdev'), { k: 'WRONGWRONGWRONGWRONG22', at: serverTimestamp() })));
await t('お店の鍵：鍵が無いと、お店のオーナーに自分を足せない', () =>
  assertFails(updateDoc(doc(db('newdev'), 'shops', SHOP), { owners: arrayUnion('newdev') })));
await t('お店の鍵：正しい鍵を使うと、お店のオーナーに自分を足せる（なくした端末の代わり）', async () => {
  const d = db('newdev');
  await assertSucceeds(setDoc(doc(d, 'shops', SHOP, 'claims', 'newdev'), { k: 'KEYKEYKEYKEYKEYKEY2345', at: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(d, 'shops', SHOP), { owners: arrayUnion('newdev') }));
  await assertSucceeds(setDoc(sub(d, 'members', 'newdev'), { role: 'owner', name: '新しい端末', via: 'shop', at: 6 }));
});
await t('お店の鍵：「持っています」の時刻を、端末の時計で書くことはできない', () =>
  assertFails(setDoc(doc(db('newdev2'), 'shops', SHOP, 'claims', 'newdev2'), { k: 'KEYKEYKEYKEYKEYKEY2345', at: Date.now() })));
await t('お店の鍵：古い「持っています」（10分より前）では、オーナーに足せない', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'shops', SHOP, 'claims', 'olddev'), { k: 'KEYKEYKEYKEYKEYKEY2345', at: Timestamp.fromMillis(Date.now() - 11 * 60000) }));
  await assertFails(updateDoc(doc(db('olddev'), 'shops', SHOP), { owners: arrayUnion('olddev') }));
});
await t('お店の鍵：作り直すと、前の鍵は使えない', async () => {
  await assertSucceeds(deleteDoc(doc(ownerDb, 'shops', SHOP, 'keys', 'KEYKEYKEYKEYKEYKEY2345')));
  await assertFails(setDoc(doc(db('newdev3'), 'shops', SHOP, 'claims', 'newdev3'), { k: 'KEYKEYKEYKEYKEYKEY2345', at: serverTimestamp() }));
});
await t('お店のオーナー：なくした端末を、お店のオーナーから外せる', () =>
  assertSucceeds(updateDoc(doc(db('newdev'), 'shops', SHOP), { owners: arrayRemove('owner1') })));
await t('お店のオーナー：自分を外して、だれもいないお店にはできない', () =>
  assertFails(updateDoc(doc(db('backup1'), 'shops', SHOP), { owners: ['newdev'] })));

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
await t('ほかのオーナーは、開店した端末も外せる（なくした・盗まれた時）', async () => {
  await setDoc(sub(ownerDb, 'members', 'owner2'), { role: 'owner', name: 'レジ3' });
  await assertSucceeds(deleteDoc(sub(db('owner2'), 'members', 'owner1')));
});
await t('外された開店した端末は、自分をオーナーに戻せない', async () => {
  await assertFails(setDoc(sub(ownerDb, 'members', 'owner1'), { role: 'owner', name: 'レジ1', at: 9 }));
  await assertFails(getDoc(ev(ownerDb)));
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

// ---- 販売会の予定と予約フォーム（plans）----
const PID = 'planABCDEFGHJKLMNPQRS';
const planDoc = (d, p = PID) => doc(d, 'plans', p);
const plan = (owner, over = {}) => Object.assign({ owners: [owner], name: '臨時販売会', date: '2026-10-20', start: '10:00', end: '12:00', place: '公民館', org: '泰山木', collab: '', comment: '',
  shop: '泰山木', on: true, from: Date.now() - 60000, to: Date.now() + 3600000, pickups: ['10:00'], items: [{ id: '1', name: 'あんぱん', price: 180, cat: 'パン', cap: 3 }],
  tel: 'opt', memo: true, maxQty: 10, note: '', at: 1 }, over);
// お客様の予約：数えを1つ進めるのと、予約を作るのを、1回でいっしょに書く
const reserve = async (d, uid, n, over = {}) => {
  const b = writeBatch(d);
  b.set(doc(d, 'plans', PID, 'tally', 'c'), { n, c: { '1': n } });
  b.set(doc(d, 'plans', PID, 'resv', 'r' + n), Object.assign({ uid, seq: n, name: '山田', tel: '', memo: '', pickup: '10:00', items: [{ id: '1', name: 'あんぱん', price: 180, n: 1 }], total: 180, st: 'new', at: serverTimestamp() }, over));
  return b.commit();
};
await t('予定：作った端末だけを持ち主にして作れる', () => assertSucceeds(setDoc(planDoc(ownerDb), plan('owner1'))));
await t('予定：ほかの人を持ち主にして作れない', () => assertFails(setDoc(planDoc(strangerDb, 'planZZZZZZZZZZZZZZZZZZ'), plan('owner1'))));
await t('予定：決まっていない項目は書けない', () => assertFails(setDoc(planDoc(ownerDb, 'planYYYYYYYYYYYYYYYYYY'), plan('owner1', { secret: 1 }))));
await t('予定：お客様は読めるが、一覧は出せない', async () => {
  await assertSucceeds(getDoc(planDoc(custDb)));
  await assertFails(getDocs(collection(custDb, 'plans')));
});
await t('予定：ログインしていない人は読めない', () => assertFails(getDoc(planDoc(anon))));
await t('予定：お客様は書きかえられない', () => assertFails(updateDoc(planDoc(custDb), { on: false })));
await t('予約：受付の期間なら、数えを進めて予約できる', () => assertSucceeds(reserve(custDb, 'cust1', 1)));
await t('予約：数えを進めずに予約だけは書けない', () => assertFails(setDoc(doc(cust2Db, 'plans', PID, 'resv', 'r5'), { uid: 'cust2', seq: 5, name: 'x', tel: '', memo: '', pickup: '', items: [{ id: '1', n: 1 }], total: 1, st: 'new', at: serverTimestamp() })));
await t('予約：数えを2つ以上進められない', () => assertFails(reserve(cust2Db, 'cust2', 3)));
await t('予約：ほかの人の名前（uid）では予約できない', () => assertFails(reserve(cust2Db, 'cust1', 2)));
await t('予約：はじめから「受け取り済み」では作れない', () => assertFails(reserve(cust2Db, 'cust2', 2, { st: 'done' })));
await t('予約：自分の予約は読める・ほかの人の予約は読めない', async () => {
  await assertSucceeds(getDoc(doc(custDb, 'plans', PID, 'resv', 'r1')));
  await assertFails(getDoc(doc(cust2Db, 'plans', PID, 'resv', 'r1')));
  await assertFails(getDocs(collection(cust2Db, 'plans', PID, 'resv')));
});
await t('予約：持ち主は一覧を読めて、受け取り・取り消しを書ける', async () => {
  await assertSucceeds(getDocs(collection(ownerDb, 'plans', PID, 'resv')));
  await assertSucceeds(updateDoc(doc(ownerDb, 'plans', PID, 'resv', 'r1'), { st: 'done', stAt: 1 }));
  await assertFails(updateDoc(doc(ownerDb, 'plans', PID, 'resv', 'r1'), { name: '書きかえ' }));
});
await t('予約：お客様は自分の予約の中身を変えられない', () => assertFails(updateDoc(doc(custDb, 'plans', PID, 'resv', 'r1'), { st: 'cancel' })));
await t('予約：受付を止めると、予約できない', async () => {
  await updateDoc(planDoc(ownerDb), { on: false });
  await assertFails(reserve(cust2Db, 'cust2', 2));
});
await t('予約：受付の期間が終わると、予約できない', async () => {
  await updateDoc(planDoc(ownerDb), { on: true, to: Date.now() - 1000 });
  await assertFails(reserve(cust2Db, 'cust2', 2));
});
await t('予約：持ち主は閉店の後に予約を消せる・お客様は消せない', async () => {
  await assertFails(deleteDoc(doc(custDb, 'plans', PID, 'resv', 'r1')));
  await assertSucceeds(deleteDoc(doc(ownerDb, 'plans', PID, 'resv', 'r1')));
  await assertSucceeds(deleteDoc(doc(ownerDb, 'plans', PID, 'tally', 'c')));
});

await env.cleanup();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
