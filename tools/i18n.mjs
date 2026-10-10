#!/usr/bin/env node
// 英語の表示の辞書を、index.html に入れる・確かめる道具
//
//   node tools/i18n.mjs build    … i18n/en.tsv から辞書を作り、index.html の #i18n-en に入れる
//   node tools/i18n.mjs check    … index.html の辞書が i18n/en.tsv と合っているか確かめる（合っていなければ失敗する）
//
// 【しくみ】画面を作るプログラムは日本語のまま。英語にした端末だけが、出来上がった画面の文字を
//   この辞書で英語に置きかえる（index.html の「英語の表示」のところ）。
//   画面に新しい文を足した時は、i18n/en.tsv に「日本語<TAB>英語」の行を足して build する。
//   足さなかった文は、英語の時も日本語のまま出る（動きには影響しない）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSV = path.join(ROOT, 'i18n', 'en.tsv');
const HTML = path.join(ROOT, 'index.html');
const SLOT = /(<script type="application\/json" id="i18n-en">)([\s\S]*?)(<\/script>)/;

export function buildDict(tsv) {
    const dict = {};
    const problems = [];
    tsv.split('\n').forEach((line, i) => {
        if (!line.trim() || line.startsWith('#')) return;
        const t = line.indexOf('\t');
        if (t < 0) { problems.push(`${i + 1}行目：タブがありません`); return; }
        const ja = line.slice(0, t).trim();
        const en = line.slice(t + 1).replace(/\\n/g, '\n');
        if (!ja || !en.trim()) return;           // 英語が空の行は、訳さない印
        if (ja in dict) return;                  // 同じ日本語は、はじめの行を使う
        // {0} の置き場所が合っているか
        const has = new Set(ja.match(/\{\d+\}/g) || []);
        (en.match(/\{s?\d+\}/g) || []).forEach(x => { if (!has.has(x.replace('{s', '{'))) problems.push(`${i + 1}行目：英語の ${x} が日本語にありません`); });
        // 「◯◯：」の後ろには、次の文字（太字など）が続くので、英語は「: 」と空けておく
        dict[ja] = /：$/.test(ja) && /:$/.test(en) ? en + ' ' : en;
    });
    // 「在庫:{0}{1}」のように、後ろに {n} が続く文は、後ろから1つずつ除いた形も足す（{n} が空の時に合うように）
    for (const [ja0, en0] of Object.entries({ ...dict })) {
        let ja = ja0, en = en0;
        for (;;) {
            const m = ja.match(/\{\d+\}$/);
            if (!m || !en.endsWith(m[0])) break;
            ja = ja.slice(0, -m[0].length);
            en = en.slice(0, -m[0].length);
            const k = ja.trim();
            if (!/[぀-鿿]/.test(k)) break;
            // 英語に、日本語から消えた {n} が残っていたら使わない
            const left = (en.match(/\{s?\d+\}/g) || []).filter(x => !k.includes(x.replace('{s', '{')));
            if (left.length) break;
            if (!(k in dict)) dict[k] = en.trim();
        }
    }
    return { dict, problems };
}
function dictJson(dict) { return JSON.stringify(dict).replace(/</g, '\\u003c'); }

function main(cmd) {
    const { dict, problems } = buildDict(fs.readFileSync(TSV, 'utf8'));
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    const html = fs.readFileSync(HTML, 'utf8');
    const m = html.match(SLOT);
    if (!m) { console.error('index.html に <script type="application/json" id="i18n-en"> が見つかりません'); process.exit(1); }
    const json = dictJson(dict);
    if (cmd === 'build') {
        fs.writeFileSync(HTML, html.replace(SLOT, (all, a, b, c) => a + json + c));
        console.log(`辞書を入れました（${Object.keys(dict).length}件）: index.html`);
    } else if (cmd === 'check') {
        if (m[2] !== json) { console.error('index.html の辞書が i18n/en.tsv と合っていません。node tools/i18n.mjs build を実行してください。'); process.exit(1); }
        console.log(`そろっています（${Object.keys(dict).length}件）`);
    } else {
        console.log('使い方: node tools/i18n.mjs build | check');
        process.exit(1);
    }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv[2]);
