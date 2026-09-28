/*
 * キッチン調理＋呼び出しの見本（試し用の施設）
 * --------------------------------------------------
 * 文化祭の模擬店のような「レジで注文 → キッチンで作る → 番号で呼ぶ」お店の見本です。
 * 設定の意味は、いちばん上の data/site.js を見てください。
 */
window.SITE = {
  id: "kitchen",
  appName: "キッチン注文（試し）",
  mode: "kitchen",
  customerTypes: [],
  categories: {
    sweet:  { label: "フード",   total: "フード" },
    savory: { label: "サイド",   total: "サイド" },
    drink:  { label: "ドリンク", total: "ドリンク" }
  },
  setDiscount: false,
  eventsCollection: "kitchen_events"
};
