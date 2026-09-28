#!/usr/bin/env node
// 施設ごとのフォルダ（sites/施設名/）を作る・そろえる・確かめる道具
//
//   node tools/sites.mjs build            … すべての施設の index.html を、いちばん上の index.html から作り直す
//   node tools/sites.mjs check            … 作り直しが要る施設があれば知らせて失敗する（GitHub Actions でも使う）
//   node tools/sites.mjs new 施設の印     … 新しい施設のフォルダを作る（data/ はいちばん上の data/ を写す）
//
// 【しくみ】プログラム（index.html）は1つだけ。施設のフォルダには、その写しを置く。
//   写しは、共有の部品（vendor/・icons/）を2つ上のフォルダから読むように書き換えるだけで、
//   中身はいちばん上と同じ。施設ごとに違うのは、施設のフォルダの data/ と manifest.webmanifest だけ。
//   index.html を直したら build を1回実行する（しないと check が失敗して気づける）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITES = path.join(ROOT, 'sites');
const UP = '../../';

// いちばん上の index.html → 施設のフォルダ用の写し
export function siteHtml(src) {
    let out = src;
    const swaps = [
        ['<link rel="apple-touch-icon" href="icons/', `<link rel="apple-touch-icon" href="${UP}icons/`],
        ['<link rel="icon" href="icons/', `<link rel="icon" href="${UP}icons/`],
        ['<script src="vendor/', `<script src="${UP}vendor/`],
        ["const PDFJS_DIR = 'vendor/pdfjs/';", `const PDFJS_DIR = '${UP}vendor/pdfjs/';`]
    ];
    for (const [a, b] of swaps) {
        if (!out.includes(a)) throw new Error('index.html に、書き換えるはずの所が見つかりません: ' + a);
        out = out.split(a).join(b);
    }
    return '<!-- このファイルは tools/sites.mjs が作った写しです。直すときは、いちばん上の index.html を直して build してください。 -->\n' + out;
}

function listSites() {
    if (!fs.existsSync(SITES)) return [];
    return fs.readdirSync(SITES).filter(n => fs.existsSync(path.join(SITES, n, 'data', 'site.js')));
}

function build() {
    const html = siteHtml(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    for (const id of listSites()) {
        fs.writeFileSync(path.join(SITES, id, 'index.html'), html);
        console.log('作り直しました: sites/' + id + '/index.html');
    }
}

function check() {
    const html = siteHtml(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    let bad = 0;
    for (const id of listSites()) {
        const f = path.join(SITES, id, 'index.html');
        const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
        if (cur !== html) { bad++; console.log('古いままです: sites/' + id + '/index.html（node tools/sites.mjs build を実行してください）'); }
        else console.log('そろっています: sites/' + id + '/index.html');
    }
    if (bad) process.exit(1);
}

function create(id) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id || '')) { console.error('施設の印は、英数字と - _ で32文字までにしてください'); process.exit(1); }
    const dir = path.join(SITES, id);
    if (fs.existsSync(dir)) { console.error('sites/' + id + ' はもうあります'); process.exit(1); }
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
        if (!f.endsWith('.js')) continue;
        let body = fs.readFileSync(path.join(ROOT, 'data', f), 'utf8');
        if (f === 'site.js') body = body.replace(/id: ""/, `id: "${id}"`);
        // 共有の置き場は、施設ごとに別の Firebase プロジェクトにする（混ざらないように、最初は空にしておく）
        if (f === 'firebase-config.js') body = body.replace(/^window\.FIREBASE_CONFIG = \{[\s\S]*?^\};/m, 'window.FIREBASE_CONFIG = null;');
        fs.writeFileSync(path.join(dir, 'data', f), body);
    }
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
        name: id, short_name: id, start_url: './index.html', scope: './', display: 'standalone',
        background_color: '#F4F3F0', theme_color: '#C25E3E',
        icons: [{ src: UP + 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: UP + 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
    }, null, 2) + '\n');
    build();
    console.log('sites/' + id + '/data/ の中身（名前・商品・客層・Firebase）を、その施設に合わせて書き換えてください。');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'build') build();
else if (cmd === 'check') check();
else if (cmd === 'new') create(arg);
else { console.log('使い方: node tools/sites.mjs build | check | new 施設の印'); process.exit(cmd ? 1 : 0); }
