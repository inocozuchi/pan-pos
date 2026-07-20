// 泰山木POS 動作検証テスト（Playwright / ヘッドレス）
//
// 実行方法:
//   npm i -D playwright
//   node tests/e2e.mjs
//
// GitHub Pages で配信されるアプリ本体(index.html)には影響しません（開発時のみ使用）。
// 会計取消・部分修正・超過販売が「売上／在庫／客数」に正しく反映されることを中心に検証します。

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = 'file://' + path.resolve(__dirname, '..', 'index.html');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
page.on('dialog', d => d.accept());
await page.goto(indexUrl);
await page.evaluate(() => { window.print = () => {}; });

// 開店（塩パンは仕入2で開始し、超過販売を試す）
await page.evaluate(() => {
  openSettings();
  document.getElementById('session-name-input').value = 'テスト販売会';
  tempSetupProducts.find(x => x.name === '塩パン').initialStock = 2;
  startSession();
});

// 会計1：あんぱん×2＋メロンパン（学生・現金1000）
await page.evaluate(() => {
  ['あんぱん', 'あんぱん', 'メロンパン'].forEach(n => addToCart(products.find(x => x.name === n)));
  openCheckout();
  [...document.getElementsByName('customerType')].find(x => x.value === '学生').checked = true;
  document.getElementById('cash-input').value = '1000';
  completeTransaction();
});
eq('会計の記録（客数・合計・お釣り）',
  await page.evaluate(() => ({ n: salesHistory.length, total: salesHistory[0].total, change: salesHistory[0].change })),
  { n: 1, total: 540, change: 460 });

// 超過販売：塩パン（仕入2）を3個売る → 在庫 -1、oversoldに検出
await page.evaluate(() => {
  const s = products.find(x => x.name === '塩パン');
  for (let i = 0; i < 3; i++) { addToCart(s); openCheckout(); document.getElementById('cash-input').value = '150'; completeTransaction(); }
});
eq('超過販売：在庫がマイナスになる', await page.evaluate(() => products.find(x => x.name === '塩パン').stock), -1);
eq('超過販売：レポートに警告として検出', await page.evaluate(() => buildReportData().oversoldItems.map(o => o.name)), ['塩パン']);

// 部分修正：会計1（idx=0）から あんぱん −1、メロンパン ＋1
await page.evaluate(() => { adjustRecordItem(0, 'あんぱん', -1); adjustRecordItem(0, 'メロンパン', 1); });
eq('部分修正：合計は据え置き（-180+180）', await page.evaluate(() => salesHistory[0].total), 540);
eq('部分修正：在庫に反映（あんぱん+1/メロン-1）',
  await page.evaluate(() => ({ a: products.find(x => x.name === 'あんぱん').stock, m: products.find(x => x.name === 'メロンパン').stock })),
  { a: 49, m: 48 });
eq('部分修正：編集フラグと操作ログ', await page.evaluate(() => ({ edited: !!salesHistory[0].edited, log: operationLog.length > 0 })), { edited: true, log: true });

// 会計取消：直近（塩パン）を取り消し → 在庫が戻り、客数・売上が減る
await page.evaluate(() => {
  const before = { sales: salesHistory.length, rev: salesHistory.reduce((s, h) => s + h.total, 0) };
  window.__before = before;
  const lastIdx = salesHistory.map(h => h.no).indexOf(Math.max(...salesHistory.map(h => h.no)));
  voidSale(lastIdx);
});
eq('取消：客数と在庫と売上に反映',
  await page.evaluate(() => ({
    salesDecreased: salesHistory.length === window.__before.sales - 1,
    voidCount: voidCount >= 1,
    shioRestored: products.find(x => x.name === '塩パン').stock === 0
  })),
  { salesDecreased: true, voidCount: true, shioRestored: true });

// 整合性：品目合計＝取引合計
eq('整合性チェックで問題なし', await page.evaluate(() => checkIntegrity()), []);

// レポートは全7セクションが生成される
await page.evaluate(() => { openSettings(); showTab('analytics'); downloadPDF(); });
eq('レポート7セクション生成', await page.evaluate(() => document.querySelectorAll('#print-report .report-section').length), 7);

console.log(`\n${pass} passed, ${fail} failed`);
console.log('runtime errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
