/*
 * ★ここ1箇所を書き換えるだけで、レジに表示する商品ラインナップを切り替えられます。
 * --------------------------------------------------
 *   "normal"   … 通常販売（学内）   data/products.normal.js
 *   "festival" … お祭り出店         data/products.festival.js
 *   "rinji"    … 臨時開催のメニュー data/products.normal.js の下のほう
 *
 * ※ URL に ?event=festival を付けると、このファイルを変えずに一時的に切り替えて確認できます。
 */
// ★お祭り期間中は "festival"。お祭りが終わったら "normal" に戻してください。
// （2026年のお祭り出店は終了したため "normal" に戻しました）
// 臨時開催の販売会のため、"rinji" にしています。通常販売に戻す時は "normal" にしてください。
window.ACTIVE_EVENT = "rinji";
