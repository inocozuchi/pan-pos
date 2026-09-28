# pdf.js（前回の集計PDFを取り込む時だけ使う）

- 元: npm の `pdfjs-dist@3.11.174`（Mozilla、Apache License 2.0。`LICENSE` を参照）
- `pdf.min.js` / `pdf.worker.min.js` … 古いブラウザでも動く `legacy/build` のもの
- `cmaps/` … 日本語の文字の読み取りに使う表（`pdfjs-dist/cmaps` から日本語に関係するものだけ）

アプリの起動時には読み込みません。「設定 → 過去の販売会 → 前回の集計PDFを取り込む」で
PDFを選んだ時にだけ読み込みます（会計の速さには関わりません）。
