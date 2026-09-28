# 施設ごとのフォルダ（sites/）

同じプログラムを、施設（お店）ごとに**別のURL**で動かすためのフォルダです。
GitHub のアカウントやリポジトリを増やす必要はありません。

| フォルダ | URL（今のアプリのURLのうしろに付ける） | 中身 |
|---|---|---|
| （いちばん上） | そのまま | 泰山木のパン・クッキーの販売会 |
| `sites/kitchen/` | `sites/kitchen/` | ファストフード（キッチン・呼び出し）の見本（試し用。最初から店舗モードがファストフード） |

## しくみ

- プログラム（`index.html` と、お客様の注文ページ `order.html`）は、いちばん上の1つだけを直します。
  `sites/施設名/` の同じ名前のファイルは、`node tools/sites.mjs build` で作る**写し**です（手で直さない）。
- 店舗モード（既製品の販売／ファストフード）は、どの施設でも「設定 → 店舗モード」で切り替えられます。
  `data/site.js` の `mode` は、はじめのモードです。
- 施設ごとに違うのは `sites/施設名/data/` と `manifest.webmanifest` だけです。
  - `data/site.js` … 施設の印・アプリの名前・店舗モード・客層・分類の名前
  - `data/products.normal.js` … 商品
  - `data/shop.js` … 領収書の店名
  - `data/firebase-config.js` … 共有に使う Firebase（施設ごとに別のプロジェクトにするのがおすすめ）
- 同じドメインに置いても、`site.js` の `id` が違うので、**端末の中の記録は施設ごとに分かれます**。
  泰山木（いちばん上）は `id` が空なので、今までと同じ保存場所を使います。

## 新しい施設を足す

```
node tools/sites.mjs new 施設の印     （例：node tools/sites.mjs new school-b）
```

できた `sites/施設の印/data/` を、その施設に合わせて書き換えます。
`index.html` を直した時は `node tools/sites.mjs build` を1回実行してからコミットします
（忘れると GitHub の「施設のフォルダの確認」が失敗して知らせます）。

## キッチンの見本で、複数の端末を使うには

見本は、泰山木の共有の置き場と混ざらないよう、最初は Firebase を使わない設定にしてあります
（1台で「レジ」と「キッチン」のタブを行き来して試せます）。複数の端末で試すには、次のどちらかをします。

1. **別の Firebase プロジェクトを作る（おすすめ）**
   `docs/firebase-sync.md` の手順でプロジェクトを作り、`sites/kitchen/data/firebase-config.js` に貼ります。
2. **泰山木と同じプロジェクトを使う**
   `sites/kitchen/data/firebase-config.js` に泰山木と同じ設定を貼り、Firestore のルールに次の3行を足します
   （置き場の名前が `kitchen_events` なので、泰山木の `events` とは混ざりません）。

```
    match /kitchen_events/{eventCode}/{document=**} {
      allow read, write: if request.auth != null;
    }
```
