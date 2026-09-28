/*
 * この施設（アプリ）の設定
 * --------------------------------------------------
 * 同じプログラム（index.html）を、施設ごとに別のURLで動かすための設定です。
 * 施設ごとのフォルダ（sites/施設名/data/site.js）で中身を変えます。
 * ここ（いちばん上のフォルダ）は、泰山木のパン・クッキーの販売会の設定です。
 *
 *   id        … 施設の印（英数字）。空のままなら、今までと同じ保存場所を使う。
 *               同じドメインに置いたほかの施設と、端末の中の記録が混ざらないようにするための印。
 *               ★ 一度使い始めたら変えないこと（変えると、その端末の記録が見えなくなる）
 *   appName   … 画面の上・タブ・ホーム画面に出るアプリの名前
 *   mode      … 店舗モード
 *                 'retail'  … 既製品の販売（レジで会計したら完了。今のパン・クッキーの販売会）
 *                 'kitchen' … キッチン調理＋呼び出し（レジの注文がキッチンの画面に出て、作り終えたら番号で呼ぶ）
 *   customerTypes … 会計の時に選べる客層（「不明」は自動で足される）
 *   categories    … 商品の3つの分類の名前（色は分類ごとに決まっている）
 *                   label … レジや商品の編集で出る名前（products の category にもこの名前を書く）
 *                   total … 集計の表に出る名前
 *   setDiscount   … セット割を最初からオンにするか（あとから設定で変えられる）
 *   eventsCollection … 共有に使う Firebase の置き場の名前。
 *                   施設ごとに別の Firebase プロジェクトを使うなら 'events' のままでよい。
 */
window.SITE = {
  id: "",
  appName: "泰山木POS",
  mode: "retail",
  customerTypes: ["学生", "教員", "職員", "その他"],
  categories: {
    sweet:  { label: "パン",     total: "パン類" },
    savory: { label: "クッキー", total: "クッキー類" },
    drink:  { label: "ドリンク", total: "ドリンク" }
  },
  setDiscount: true,
  eventsCollection: "events"
};
