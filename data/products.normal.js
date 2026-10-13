/*
 * 通常販売（学内）の商品ラインナップ
 * --------------------------------------------------
 * ここを編集すると「通常販売」の商品が変わります（コード本体 index.html は触りません）。
 *
 * 各商品: { name: 商品名, price: 価格(円), category: 分類, stock?: 既定の仕入れ数 }
 *   category は "パン" / "クッキー" / "ドリンク" のいずれか（表示色の3グループ）。
 *   stock は省略可（省略時は 50）。開店時に「仕入れ数設定」で当日の実数に調整できます。
 */
window.PRODUCT_SETS = window.PRODUCT_SETS || {};
window.PRODUCT_SETS.normal = {
  label: "通常販売（学内）",
  items: [
    // パン
    { name: "アップルシナモン",     price: 200, category: "パン" },
    { name: "あんぱん",             price: 180, category: "パン" },
    { name: "ウィンナーパン",       price: 180, category: "パン" },
    { name: "クリームパン",         price: 180, category: "パン" },
    { name: "塩パン",               price: 150, category: "パン" },
    { name: "チーズパン",           price: 180, category: "パン" },
    { name: "ミルクパン",           price: 150, category: "パン" },
    { name: "メロンパン",           price: 180, category: "パン" },
    { name: "枝豆コーンパン",       price: 160, category: "パン" },
    { name: "夏野菜のピザパン",     price: 180, category: "パン" },
    { name: "コーンマヨピザパン",   price: 180, category: "パン" },
    { name: "レモンはちみつパン",   price: 200, category: "パン" },
    // クッキー・焼き菓子
    { name: "ふじもっちゃんの全粒粉クッキー", price: 200, category: "クッキー" },
    { name: "ダンちゃんのアーモンドクッキー", price: 200, category: "クッキー" },
    { name: "杉ちゃんのココナッツクッキー",   price: 200, category: "クッキー" },
    { name: "ケンちゃんのフロランタン",       price: 200, category: "クッキー" },
    { name: "なっちゃんのチョコクッキー",     price: 100, category: "クッキー" },
    { name: "なっちゃんの紅茶クッキー",       price: 100, category: "クッキー" },
    { name: "フィナンシェ",         price: 150, category: "クッキー" },
    { name: "カップケーキ",         price: 150, category: "クッキー" },
    { name: "ハイジのチーズケーキ", price: 300, category: "クッキー" },
    { name: "パウンドケーキ",       price: 350, category: "クッキー" },
    // ドリンク（クッキーと同じ会計で買うとセット割で10円引き。設定でオン・オフできる）
    { name: "コーヒー",             price: 100, category: "ドリンク" }
  ]
};

// ---- デモ販売会のメニュー（いまの既定）----
// 開店の準備で、商品がまだ無い端末にはこのメニューが最初から入る。
// 前の販売会の商品が残っている端末には「デモ販売会のメニュー（21品）に入れ替える」が出る。
window.PRODUCT_SETS.rinji = {
  label: "デモ販売会のメニュー",
  items: [
    // パン類
    { name: "あんぱん",                 price: 180, category: "パン" },
    { name: "ウィンナーパン",           price: 180, category: "パン" },
    { name: "カメのメロンパン",         price: 180, category: "パン" },
    { name: "塩パン",                   price: 150, category: "パン" },
    { name: "チーズパン",               price: 180, category: "パン" },
    { name: "ミルクパン",               price: 150, category: "パン" },
    { name: "りんごさつまいもパン",     price: 200, category: "パン" },
    { name: "レモンはちみつパン",       price: 200, category: "パン" },
    // クッキー類（パウンドケーキも、焼き菓子としてここに入れる）
    { name: "オリジナルクッキー",               price: 200, category: "クッキー" },
    { name: "チーズスティック",                 price: 200, category: "クッキー" },
    { name: "スノーボール（抹茶）",             price: 200, category: "クッキー" },
    { name: "スノーボール（プレーン）",         price: 200, category: "クッキー" },
    { name: "ケンちゃんのチョコチップクッキー", price: 200, category: "クッキー" },
    { name: "杉ちゃんのココナッツクッキー",     price: 200, category: "クッキー" },
    { name: "ダンちゃんのアーモンドクッキー",   price: 200, category: "クッキー" },
    { name: "ふじもっちゃんの全粒粉クッキー",   price: 200, category: "クッキー" },
    { name: "なっちゃんの紅茶クッキー",         price: 100, category: "クッキー" },
    { name: "なっちゃんのチョコクッキー",       price: 100, category: "クッキー" },
    { name: "クッキーつめ合わせ",               price: 500, category: "クッキー" },
    { name: "パウンドケーキ",                   price: 350, category: "クッキー" },
    // コーヒー
    { name: "KENJIブレンド",                    price: 100, category: "ドリンク" }
  ]
};

