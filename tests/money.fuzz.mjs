// 泰山木POS：お金の流れの乱れ打ちの試験（Playwright / ヘッドレス）
//
// 実行方法:
//   npm i -D playwright
//   node tests/money.fuzz.mjs [回数=400] [乱数の種=1]
//   TAX=ex node tests/money.fuzz.mjs   … 税抜きの値段（外税）で
//
// カートに入れる・減らす・値引き・セット割・支払い方法・分けて会計・予約・予約の受け取り・会計の取り消し・
// 会計の後で品目を増やす・減らす・割引を外す を、でたらめな順で続ける。1回ごとに次を確かめる：
//  ・品目の合計 − 割引 ＋ 外税 ＝ 取引の合計（checkIntegrity）
//  ・どの会計も、合計 0 円以上・お預かり ≧ 合計・お釣り ＝ お預かり − 合計
//  ・在庫：仕入れ数 − 残り ＝ 売れた数 ＋ 予約で取っておいた数 ＋ カートの数
//  ・客No. が重ならない
//  ・ページの中の失敗（エラー）が出ない
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = 'file://' + path.resolve(__dirname, '..', 'index.html') + '?event=normal';
const N = Number(process.argv[2] || 400), SEED = Number(process.argv[3] || 1);

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
await page.addInitScript(() => { window.__POS_TEST_SAMPLE = true; });
const errors = [];
page.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')));
let promptAnswer = '予約 太郎';
page.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAnswer).catch(() => {}) : d.accept().catch(() => {}));
await page.route(/^https?:\/\//, r => r.abort());
await page.goto(indexUrl);
await page.waitForFunction(() => typeof startSession === 'function', null, { timeout: 30000 });

const setup = await page.evaluate(async (tax) => {
  window.print = () => {};
  window.alert = () => {};
  ['disc', 'adj', 'split', 'rsv', 'bulk', 'ppl'].forEach(k => { try { setFeat(k, true); } catch (e) {} });
  try { toggleSetDiscount(true); } catch (e) {}
  if (tax) { try { setTaxOn(true); writeTaxCfg(Object.assign({}, taxCfg, { on: true, ex: true, round: 'floor' }), '試験', true); } catch (e) { return 'tax ' + e.message; } }
  try { togglePayMethod('paypay', true); } catch (e) {}
  openPanel('session', 'open-new');
  document.getElementById('session-name-input').value = 'お金の試験';
  tempSetupProducts.forEach((p, i) => { if (p.initialStock > 0 || p.price > 0) p.initialStock = 30 + i; });
  await startSession();
  await new Promise(r => setTimeout(r, 300));
  return currentSession ? 'ok' : 'no-session';
}, process.env.TAX === 'ex');
console.log('setup', setup);

let pass = 0, fail = 0;
const ok = (name, c, info) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${name}` + (c ? '' : `  ${JSON.stringify(info).slice(0, 2000)}`)); c ? pass++ : fail++; };

const result = await page.evaluate(async ({ N, SEED }) => {
  let s = SEED >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const sellable = () => products.filter(p => p.active !== false && (p.price > 0) && !varsOf(p).length && !(p.wgt));
  const log = [];
  const problems = [];
  const counted = () => {
    const m = {};
    const add = (items) => (items || []).forEach(i => { m[i.id] = (m[i.id] || 0) + 1; });
    salesHistory.forEach(h => add(h.items));
    reservations.forEach(r => add(r.items));
    add(cart);
    return m;
  };
  function check(step) {
    const iss = checkIntegrity().filter(x => !/商品マスタに無い/.test(x));
    if (iss.length) problems.push(step + ' 整合性：' + iss.join(' / '));
    const nos = new Set();
    salesHistory.forEach(h => {
      if (!(h.total >= 0)) problems.push(step + ` 合計がマイナス No.${h.no} ${h.total}`);
      if (h.cash != null && h.cash < h.total) problems.push(step + ` お預かり不足 No.${h.no} ${h.cash}<${h.total}`);
      if (h.cash != null && h.change !== h.cash - h.total) problems.push(step + ` お釣りが合わない No.${h.no}`);
      if (nos.has(h.no)) problems.push(step + ` 客No.が重なる ${h.no}`);
      nos.add(h.no);
    });
    const used = counted();
    products.forEach(p => {
      if (isUnlimited(p) || !(p.initialStock > 0)) return;
      const out = p.initialStock - p.stock, u = used[p.id] || 0;
      if (out !== u) problems.push(step + ` 在庫が合わない ${p.name}：仕入${p.initialStock}−残${p.stock}=${out} ≠ 使った${u}`);
    });
  }
  const ops = {
    add() { const p = pick(sellable()); if (p && p.stock > 0) addToCart(p); return 'add ' + (p && p.name); },
    remove() { if (!cart.length) return 'remove-'; const u = pick(cart); removeOneFromCart(cartKey(u)); return 'remove'; },
    plusLine() { if (!cart.length) return 'plus-'; const u = pick(cart); const p = products.find(x => x.id === u.id); if (!p || p.stock <= 0) return 'plus-'; addOneToCart(cartKey(u)); return 'plus'; },
    clearAll() { if (!cart.length || rnd() < .7) return 'clear-'; clearCartAll(); return 'clear'; },
    async pay() {
      if (!cart.length) return 'pay-';
      const split = featOn('split') && cart.length > 1 && rnd() < .2;
      if (split && typeof openCheckout === 'function') { openCheckout(null, cart.slice(0, Math.max(1, Math.floor(cart.length / 2)))); }
      else openCheckout();
      await wait(20);
      if (rnd() < .3) setCheckoutManual(rnd() < .5 ? { kind: 'yen', amount: 1 + Math.floor(rnd() * 300), reason: '' } : { kind: 'pct', amount: 1 + Math.floor(rnd() * 60), reason: '' });
      const other = rnd() < .2 && payMethods().some(m => m.id !== 'cash');
      if (other) setCheckoutPay(payMethods().find(m => m.id !== 'cash').id); else setCheckoutPay('cash');
      const total = parseInt(document.getElementById('modal-total').textContent);
      if (!other) document.getElementById('cash-input').value = String(total + (rnd() < .5 ? 0 : Math.floor(rnd() * 2000)));
      const n0 = salesHistory.length;
      completeTransaction();
      await wait(20);
      if (document.getElementById('checkout-modal').classList.contains('show') || document.getElementById('checkout-modal').style.display === 'flex') closeModal('checkout-modal');
      return `pay ${salesHistory.length - n0} ¥${total}${split ? ' split' : ''}${other ? ' other' : ''}`;
    },
    reserve() { if (!cart.length || !featOn('rsv')) return 'reserve-'; promptReservation(); return 'reserve'; },
    async settle() {
      if (!reservations.length) return 'settle-';
      const r = pick(reservations);
      openCheckout(r.id);
      await wait(20);
      const total = parseInt(document.getElementById('modal-total').textContent);
      setCheckoutPay('cash');
      document.getElementById('cash-input').value = String(total);
      completeTransaction();
      await wait(20);
      return 'settle ¥' + total;
    },
    cancelRes() { if (!reservations.length) return 'cancelRes-'; cancelReservation(pick(reservations).id); return 'cancelRes'; },
    voidOne() { if (!salesHistory.length) return 'void-'; voidSale(Math.floor(rnd() * salesHistory.length)); return 'void'; },
    edit() {
      if (!salesHistory.length) return 'edit-';
      const idx = Math.floor(rnd() * salesHistory.length);
      const rec = salesHistory[idx];
      if (!rec.items.length || rec.billNo) return 'edit-';
      const it = pick(rec.items);
      const d = rnd() < .5 ? -1 : 1;
      if (d > 0) { const p = products.find(x => x.id === it.id); if (!p || p.stock <= 0) return 'edit-'; }
      adjustRecordItem(idx, recLineKey(it), d);
      return 'edit ' + d;
    },
    undisc() {
      const idx = salesHistory.findIndex(h => h.mdisc || h.coupon || h.setDisc);
      if (idx < 0) return 'undisc-';
      const h = salesHistory[idx];
      removeRecordDiscount(idx, h.mdisc ? 'manual' : (h.coupon ? 'coupon' : 'set'));
      return 'undisc';
    }
  };
  const weights = [['add', 24], ['remove', 6], ['plusLine', 4], ['clearAll', 2], ['pay', 14], ['reserve', 4], ['settle', 4], ['cancelRes', 2], ['voidOne', 4], ['edit', 8], ['undisc', 3]];
  const tot = weights.reduce((a, w) => a + w[1], 0);
  for (let i = 0; i < N; i++) {
    let r = rnd() * tot, name = 'add';
    for (const [k, w] of weights) { if ((r -= w) < 0) { name = k; break; } }
    let res = '';
    try { res = await ops[name](); } catch (e) { problems.push(`#${i} ${name} で失敗：${e.message}`); }
    log.push(`#${i} ${res}`);
    check(`#${i} ${res}`);
    if (problems.length > 5) break;
  }
  const kinds = {}; log.forEach(x => { const k = x.split(' ').slice(1, 3).join(' ').replace(/¥\d+/, '¥').replace(/-?\d+$/, 'n'); kinds[k] = (kinds[k] || 0) + 1; });
  return { kinds, problems, steps: log.length, sales: salesHistory.length, last: log.slice(-12), sum: salesHistory.reduce((a, h) => a + h.total, 0) };
}, { N, SEED });

console.log(JSON.stringify(result.kinds));
ok(`乱れ打ち ${result.steps} 回（会計 ${result.sales} 件・合計 ¥${result.sum}）：お金と在庫が合う`, !result.problems.length, { problems: result.problems, last: result.last });
ok('ページの中の失敗（エラー）が無い', !errors.length, errors.slice(0, 5));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
