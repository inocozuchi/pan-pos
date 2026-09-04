/*
 * ★ここ1箇所を書き換えるだけで、レジに表示する商品ラインナップを切り替えられます。
 * --------------------------------------------------
 *   "normal"   … 通常販売（学内）   data/products.normal.js
 *   "festival" … お祭り出店         data/products.festival.js
 *
 * ※ URL に ?event=festival を付けると、このファイルを変えずに一時的に切り替えて確認できます。
 */
window.ACTIVE_EVENT = "normal";
