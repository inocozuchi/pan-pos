/*
 * キッチン調理＋呼び出しの見本の商品
 * category は data/site.js の categories の名前（フード / サイド / ドリンク）で書く。
 */
window.PRODUCT_SETS = window.PRODUCT_SETS || {};
window.PRODUCT_SETS.normal = {
  label: "模擬店（見本）",
  items: [
    { name: "焼きそば", price: 400, category: "フード", stock: 60 },
    { name: "たこ焼き 6個", price: 400, category: "フード", stock: 60 },
    { name: "たこ焼き 8個", price: 500, category: "フード", stock: 40 },
    { name: "フランクフルト", price: 250, category: "サイド", stock: 50 },
    { name: "フライドポテト", price: 300, category: "サイド", stock: 50 },
    { name: "ラムネ", price: 150, category: "ドリンク", stock: 80 },
    { name: "クリームソーダ", price: 300, category: "ドリンク", stock: 40 },
    { name: "タピオカ", price: 350, category: "ドリンク", stock: 40 }
  ]
};
