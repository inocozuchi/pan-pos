// 泰山木POS：すべての画面を開いて確かめる試験（Playwright / ヘッドレス）
//
// 実行方法:
//   npm i -D playwright
//   node tests/screens.e2e.mjs
//
// 店舗モード（既製品・ファストフード・レストラン）× 言葉（日本語・英語）× 大きさ（スマホ・タブレット横）で、
// 「レジの機能」を全部オンにし、閉店の時と営業中の時に、すべての画面（設定の中の画面・集計の項目も）を開く。
// 確かめること：ページの中の失敗（エラー）が出ない・画面が横にはみ出さない・押せる物が小さすぎない
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexUrl = 'file://' + path.resolve(__dirname, '..', 'index.html') + '?event=normal';
const ONLY = process.env.ONLY || '';   // 例：ONLY=retail/ja/phone
let pass = 0, fail = 0;
const ok = (name, c, info) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${name}` + (c ? '' : `  ${JSON.stringify(info).slice(0, 1500)}`)); c ? pass++ : fail++; };

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const SIZES = { phone: { width: 390, height: 844 }, tablet: { width: 1180, height: 820 } };

async function crawl(mode, lang, size) {
  const tag = `${mode}/${lang}/${size}`;
  if (ONLY && !tag.startsWith(ONLY)) return;
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1, hasTouch: size === 'phone' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__POS_TEST_SAMPLE = true; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.type() === 'prompt' ? d.dismiss().catch(() => {}) : d.accept().catch(() => {}));
  await page.route(/^https?:\/\//, r => r.abort());   // 外のサイトにはつながない（試験を速く・同じにする）
  await page.goto(indexUrl);
  await page.waitForFunction(() => typeof navTo === 'function' && typeof products !== 'undefined', null, { timeout: 30000 });
  await page.evaluate(([mode, lang]) => {
    window.print = () => {};
    window.open = () => ({ document: { open() {}, write() {}, close() {} }, focus() {}, print() {}, close() {} });
    if (mode !== 'retail') setStoreMode(mode);
    FEAT_KEYS.forEach(k => { try { setFeat(k, true); } catch (e) {} });
    if (lang === 'en') setLang('en');
  }, [mode, lang]);
  await page.waitForTimeout(400);

  // 画面の一覧（ビューと、その中の画面）
  const list = await page.evaluate(() => {
    const out = [];
    PANEL_VIEWS.forEach(v => {
      const root = document.getElementById('view-' + v);
      if (!root) return;
      const subs = [...root.querySelectorAll(':scope > .sub-view')].map(e => e.id.replace(/^sub-/, ''));
      out.push([v, null]);
      subs.forEach(s => out.push([v, s]));
    });
    Object.keys(ANALYTICS_TITLES).forEach(k => out.push(['analytics', 'report:' + k]));
    return out;
  });

  async function visitAll(phase) {
    const found = { err: [], wide: [] };
    for (const [v, s] of list) {
      const before = errors.length;
      const res = await page.evaluate(([v, s]) => {
        try {
          showRegister();
          if (v === 'session' && !s) return { skip: true };
          if (s) { if (v !== 'settings') navTo(v); openPanel(v, s); } else navTo(v);
        } catch (e) { return { err: String(e && e.message || e) }; }
        return {};
      }, [v, s]);
      // 出てくる動きが終わってから測る
      await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity), null, { timeout: 2500 }).catch(() => {});
      if (res.err) found.err.push(`${v}/${s}: ${res.err}`);
      if (errors.length > before) found.err.push(`${v}/${s}: ` + errors.slice(before).join(' || '));
      // 横にはみ出す物（スクロールの入れ物の中は除く）
      const wide = await page.evaluate(() => {
        const W = innerWidth, bad = [];
        if (document.documentElement.scrollWidth > W + 1) bad.push('page ' + document.documentElement.scrollWidth);
        const body = document.getElementById('panel-body');
        if (body && body.offsetParent && body.scrollWidth > body.clientWidth + 2) {
          // どの子がはみ出しているか
          let worst = null;
          body.querySelectorAll('*').forEach(e => {
            if (!e.offsetParent) return;
            const r = e.getBoundingClientRect();
            if (r.right > body.getBoundingClientRect().right + 2) {
              for (let p = e.parentElement; p && p !== body; p = p.parentElement) { const ov = getComputedStyle(p).overflowX; if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') return; }
              if (!worst || r.right > worst.r) worst = { r: Math.round(r.right), el: e.tagName + '.' + String(e.className).slice(0, 40) + ' "' + (e.textContent || '').trim().slice(0, 30) + '"' };
            }
          });
          if (worst) bad.push('panel ' + body.scrollWidth + '>' + body.clientWidth + ' ' + worst.el);
        }
        return bad;
      });
      if (wide.length) found.wide.push(`${v}/${s}: ${wide.join(', ')}`);
    }
    ok(`${tag} ${phase}：どの画面でもエラーが出ない（${list.length}画面）`, !found.err.length, found.err.slice(0, 8));
    ok(`${tag} ${phase}：画面が横にはみ出さない`, !found.wide.length, found.wide.slice(0, 8));
    await page.evaluate(() => showRegister());
  }

  await visitAll('閉店中');
  // 開店して、何件か会計する
  const opened = await page.evaluate(async () => {
    try {
      openPanel('session', 'open-new');
      document.getElementById('session-name-input').value = '画面の試験';
      await startSession();
      await new Promise(r => setTimeout(r, 300));
      if (!currentSession) return 'no-session';
      const ps = products.filter(p => p.active !== false).slice(0, 4);
      for (let i = 0; i < 3; i++) {
        ps.forEach(p => { try { addToCart(p); } catch (e) {} });
        openCheckout();
        const ci = document.getElementById('cash-input');
        if (ci) ci.value = '10000';
        completeTransaction();
        await new Promise(r => setTimeout(r, 120));
      }
      return 'ok ' + salesHistory.length;
    } catch (e) { return 'err ' + e.message; }
  });
  ok(`${tag} 開店して会計できる`, /^ok [1-9]/.test(opened), opened);
  await page.waitForTimeout(300);
  await visitAll('営業中');
  // レジの画面：はみ出し・押せる物の大きさ
  const reg = await page.evaluate(() => {
    showRegister();
    const small = [];
    document.querySelectorAll('#page-register button, #page-register [onclick]').forEach(e => {
      if (!e.offsetParent) return;
      const r = e.getBoundingClientRect();
      if (r.width && r.height && (r.width < 30 || r.height < 30)) small.push(e.tagName + '.' + String(e.className).slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20) + '"');
    });
    return { sw: document.documentElement.scrollWidth, w: innerWidth, small: small.slice(0, 10) };
  });
  ok(`${tag} レジの画面が横にはみ出さない`, reg.sw <= reg.w + 1, reg);
  ok(`${tag} レジの押せる物が小さすぎない（30px 以上）`, !reg.small.length, reg.small);
  await ctx.close();
}

for (const mode of ['retail', 'kitchen', 'restaurant']) for (const lang of ['ja', 'en']) for (const size of ['phone', 'tablet']) await crawl(mode, lang, size);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
