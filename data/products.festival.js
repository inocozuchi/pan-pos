/*
 * お祭り用の商品ラインナップ（ダミー例）
 * --------------------------------------------------
 * お祭り出店ではこちらに切り替えます。中身は例なので自由に編集してください。
 *
 * 各商品: { name: 商品名, price: 価格(円), category: 分類, stock?: 既定の仕入れ数 }
 *   category は "パン" / "クッキー" / "ドリンク" のいずれか（表示色の3グループ）。
 */
window.PRODUCT_SETS = window.PRODUCT_SETS || {};
window.PRODUCT_SETS.festival = {
  label: "お祭り出店",
  items: [
    { name: "焼きそばパン",     price: 250, category: "パン" },
    { name: "コロッケパン",     price: 200, category: "パン" },
    { name: "チョコバナナ",     price: 300, category: "クッキー" },
    { name: "ベビーカステラ",   price: 400, category: "クッキー" },
    { name: "ラムネ",           price: 150, category: "ドリンク" },
    { name: "かき氷",           price: 200, category: "ドリンク" }
  ]
};
