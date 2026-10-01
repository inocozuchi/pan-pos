// モバイルオーダーの商品の絵（写真が無い商品に、商品名から自動で付ける）
// ・レジ（index.html）とお客様の注文ページ（order.html）の両方で読む
// ・絵はすべてこのファイルの中の SVG（外から読み込まない。電波が悪くても出る）
// ・MENU_ART.pick(商品名, 分類の印, 分類の名前) … いちばん合う絵の印を返す
//   いちばん長く一致した言葉の絵を選ぶ（「クリームソーダ」は「クリーム」より「クリームソーダ」）。
//   飲み物の分類の商品は飲み物の絵から、それ以外は食べ物の絵から先に探す
//   （「ミルクパン」が牛乳の絵にならないように）。
//   どれにも合わない時は、分類に合わせた絵（パン・焼き菓子・飲み物・お皿）にする
(function () {
    'use strict';
    var sh = '<ellipse cx="50" cy="87" rx="30" ry="4" fill="#000" opacity=".08"/>';
    var steam = '<path d="M40 24c-4-4 4-8 0-12M50 22c-4-4 4-8 0-12M60 24c-4-4 4-8 0-12" fill="none" stroke="#9AA3B2" stroke-width="3" stroke-linecap="round" opacity=".55"/>';
    var A = [
        // ---- パン ----
        { id: 'anpan', label: 'あんぱん', food: 1, keys: ['あんぱん', 'アンパン', 'あん', 'つぶあん', 'こしあん', 'あんこ', 'まんじゅう', '饅頭'],
          svg: sh + '<ellipse cx="50" cy="58" rx="35" ry="25" fill="#C97A33"/><ellipse cx="44" cy="49" rx="20" ry="9" fill="#E8A35A" opacity=".7"/><circle cx="48" cy="44" r="2.2" fill="#3A2A20"/><circle cx="53" cy="43" r="2.2" fill="#3A2A20"/><circle cx="51" cy="47.5" r="2.2" fill="#3A2A20"/>' },
        { id: 'melon', label: 'メロンパン', food: 1, keys: ['メロンパン', 'メロン'],
          svg: sh + '<path d="M14 64Q14 28 50 28Q86 28 86 64Z" fill="#F4CB6E"/><ellipse cx="50" cy="64" rx="36" ry="9" fill="#E2A64B"/><path d="M27 41L50 64M39 33L69 63M55 30L81 56M73 41L50 64M61 33L31 63M45 30L19 56" stroke="#E2A64B" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="40" cy="38" rx="10" ry="4" fill="#fff" opacity=".35"/>' },
        { id: 'croissant', label: 'クロワッサン', food: 1, keys: ['クロワッサン', 'クロワ', 'パイ生地', 'デニッシュ'],
          svg: sh + '<path d="M12 66Q24 30 50 30Q76 30 88 66Q74 54 50 54Q26 54 12 66Z" fill="#D58A3B"/><path d="M33 37Q38 47 35 56M50 30V54M67 37Q62 47 65 56" stroke="#A9652A" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M38 34Q50 30 62 34" stroke="#F0B866" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>' },
        { id: 'shokupan', label: '食パン', food: 1, keys: ['食パン', 'しょくぱん', '食ぱん', 'トースト', '山型', '角食', 'ラスク', 'フレンチトースト'],
          svg: sh + '<path d="M24 42Q22 22 42 24Q50 17 58 24Q78 22 76 42L74 82H26Z" fill="#C97A33"/><path d="M31 43Q30 31 43 32Q50 26 57 32Q70 31 69 43L67 76H33Z" fill="#FBE6BE"/>' },
        { id: 'curry', label: 'カレーパン', food: 1, keys: ['カレーパン', 'カレー', '揚げパン', 'ピロシキ'],
          svg: sh + '<ellipse cx="50" cy="57" rx="37" ry="23" fill="#B9692A"/><g fill="#E7A65A"><circle cx="30" cy="50" r="3"/><circle cx="40" cy="44" r="2.5"/><circle cx="52" cy="46" r="3"/><circle cx="64" cy="43" r="2.5"/><circle cx="72" cy="52" r="3"/><circle cx="36" cy="60" r="2.5"/><circle cx="50" cy="58" r="3"/><circle cx="62" cy="62" r="2.5"/><circle cx="26" cy="61" r="2"/><circle cx="76" cy="62" r="2"/></g>' },
        { id: 'donut', label: 'ドーナツ', food: 1, keys: ['ドーナツ', 'ドーナッツ', 'ポンデ', 'オールドファッション'],
          svg: sh + '<circle cx="50" cy="55" r="22" fill="none" stroke="#D08A3E" stroke-width="20"/><circle cx="50" cy="53" r="21" fill="none" stroke="#F48FB1" stroke-width="15"/><g stroke-width="3" stroke-linecap="round"><path d="M36 40l4 2" stroke="#fff"/><path d="M62 38l3 3" stroke="#FFE066"/><path d="M68 56l1 4" stroke="#7FD1F5"/><path d="M33 62l3-2" stroke="#FFE066"/><path d="M52 72l4-1" stroke="#fff"/><path d="M48 34l4 0" stroke="#7FD1F5"/></g>' },
        { id: 'bagel', label: 'ベーグル', food: 1, keys: ['ベーグル'],
          svg: sh + '<circle cx="50" cy="55" r="21" fill="none" stroke="#C3833F" stroke-width="22"/><path d="M33 42Q50 30 67 42" stroke="#E2AC6A" stroke-width="6" fill="none" stroke-linecap="round"/><g fill="#FFF6E2"><ellipse cx="40" cy="38" rx="2" ry="1.2"/><ellipse cx="58" cy="36" rx="2" ry="1.2"/><ellipse cx="70" cy="50" rx="2" ry="1.2"/><ellipse cx="30" cy="54" rx="2" ry="1.2"/></g>' },
        { id: 'baguette', label: 'フランスパン', food: 1, keys: ['フランスパン', 'バゲット', 'バタール', 'カンパーニュ', 'ライ麦', 'ハード系', 'ブール'],
          svg: sh + '<g transform="rotate(-28 50 55)"><rect x="10" y="44" width="80" height="22" rx="11" fill="#C97A33"/><path d="M26 50l8 10M42 50l8 10M58 50l8 10M74 50l6 8" stroke="#F0BA70" stroke-width="3.5" stroke-linecap="round"/></g>' },
        { id: 'sandwich', label: 'サンドイッチ', food: 1, keys: ['サンドイッチ', 'サンド', 'ホットサンド', 'バインミー'],
          svg: sh + '<path d="M18 82H82L80 72H20Z" fill="#F7DFAD"/><path d="M18 72q4-5 8 0t8 0 8 0 8 0 8 0 8 0 8 0 8 0" fill="none" stroke="#56B65A" stroke-width="4" stroke-linecap="round"/><rect x="22" y="66" width="56" height="5" rx="2" fill="#E5484D"/><path d="M20 66L50 20L80 66Z" fill="#F7DFAD" stroke="#D08A3E" stroke-width="4" stroke-linejoin="round"/>' },
        { id: 'hotdog', label: 'ウィンナーパン', food: 1, keys: ['ウィンナー', 'ソーセージ', 'ホットドッグ', 'ドッグ', 'フランクフルト', 'フランク', 'アメリカンドッグ'],
          svg: sh + '<ellipse cx="50" cy="56" rx="38" ry="14" fill="#E9A65A"/><rect x="14" y="44" width="72" height="15" rx="7.5" fill="#C0392B"/><path d="M22 50q5-4 10 0t10 0 10 0 10 0 10 0 10 0" fill="none" stroke="#FFD43B" stroke-width="3" stroke-linecap="round"/><path d="M12 58Q50 82 88 58Q88 70 50 74Q12 70 12 58Z" fill="#D08A3E"/>' },
        { id: 'pizza', label: 'ピザ', food: 1, keys: ['ピザ', 'ピッツァ', 'マルゲリータ'],
          svg: sh + '<path d="M50 86L18 28Q50 14 82 28Z" fill="#F7C948"/><path d="M18 28Q50 14 82 28L79 34Q50 21 21 34Z" fill="#D08A3E"/><g fill="#D9433A"><circle cx="40" cy="40" r="6"/><circle cx="60" cy="43" r="6"/><circle cx="50" cy="60" r="5.5"/></g><g fill="#4CAF50"><circle cx="46" cy="48" r="2"/><circle cx="56" cy="54" r="2"/><circle cx="42" cy="56" r="1.8"/></g>' },
        { id: 'cream', label: 'クリームパン', food: 1, keys: ['クリームパン', 'クリーム', 'カスタード'],
          svg: sh + '<path d="M18 64Q14 40 30 36Q32 25 43 27Q48 20 57 25Q66 21 71 30Q86 34 82 60Q79 76 50 76Q22 76 18 64Z" fill="#E7A65A"/><path d="M37 33L41 46M52 28L54 43M66 33L62 46" stroke="#B9692A" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="44" cy="58" rx="16" ry="6" fill="#F6C987" opacity=".7"/>' },
        { id: 'cinnamon', label: 'シナモンロール', food: 1, keys: ['シナモン', 'シナモンロール', 'うずまき', '渦巻'],
          svg: sh + '<circle cx="50" cy="54" r="31" fill="#D49553"/><path d="M50 54a4 4 0 1 1 6 3a11 11 0 1 1-15-10a18 18 0 1 1 22 25a24 24 0 0 1-30-6" fill="none" stroke="#8E5634" stroke-width="4" stroke-linecap="round"/><path d="M26 44q8-6 14 2t14 0 14 2" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".9"/>' },
        { id: 'pan', label: 'パン', food: 1, keys: ['パン', 'ブレッド', 'ロールパン', 'ブリオッシュ', 'バンズ', 'ベーカリー', 'ちぎりパン'],
          svg: sh + '<path d="M14 66Q12 36 50 34Q88 36 86 66Q86 76 50 76Q14 76 14 66Z" fill="#CF8137"/><path d="M34 44q6 6 4 14M50 40q6 7 4 16M66 44q6 6 4 14" stroke="#F2BE77" stroke-width="4" fill="none" stroke-linecap="round"/>' },
        // ---- 焼き菓子・甘いもの ----
        { id: 'cookie', label: 'クッキー', food: 1, keys: ['クッキー', 'サブレ', 'ビスケット', 'ガレット', 'フロランタン', 'ショートブレッド', 'スノーボール'],
          svg: sh + '<circle cx="50" cy="54" r="32" fill="#DFA25C" stroke="#C6853E" stroke-width="3"/><g fill="#6B3B22"><ellipse cx="38" cy="42" rx="4" ry="3"/><ellipse cx="60" cy="40" rx="3.5" ry="3"/><ellipse cx="50" cy="56" rx="4" ry="3"/><ellipse cx="34" cy="62" rx="3.5" ry="3"/><ellipse cx="66" cy="62" rx="4" ry="3"/><ellipse cx="56" cy="72" rx="3" ry="2.5"/></g>' },
        { id: 'choco', label: 'チョコ', food: 1, keys: ['チョコ', 'ショコラ', 'ブラウニー', 'ココア', 'ガトーショコラ', 'トリュフ'],
          svg: sh + '<rect x="27" y="18" width="46" height="66" rx="6" fill="#6B3B22"/><g fill="#8E5634"><rect x="32" y="23" width="16" height="13" rx="2"/><rect x="52" y="23" width="16" height="13" rx="2"/><rect x="32" y="40" width="16" height="13" rx="2"/><rect x="52" y="40" width="16" height="13" rx="2"/></g><path d="M25 58H75V82Q75 86 71 86H29Q25 86 25 82Z" fill="#E5484D"/><rect x="25" y="58" width="50" height="5" fill="#F4C542"/>' },
        { id: 'madeleine', label: 'マドレーヌ', food: 1, keys: ['マドレーヌ', 'フィナンシェ', '焼き菓子', '焼菓子', 'カヌレ'],
          svg: sh + '<path d="M18 62Q20 28 50 24Q80 28 82 62Q66 72 50 72Q34 72 18 62Z" fill="#EAB062"/><path d="M50 70L27 44M50 70L37 33M50 70V28M50 70L63 33M50 70L73 44" stroke="#CC8A3A" stroke-width="3" stroke-linecap="round"/>' },
        { id: 'cake', label: 'ケーキ', food: 1, keys: ['ケーキ', 'ショートケーキ', 'チーズケーキ', 'タルト', 'パウンド', 'ロールケーキ', 'シフォン', 'パイ', 'モンブラン', 'プリン', 'ゼリー', 'スコーン'],
          svg: sh + '<rect x="18" y="44" width="64" height="38" rx="5" fill="#FBE3B0"/><rect x="18" y="58" width="64" height="6" fill="#fff"/><rect x="18" y="68" width="64" height="4" fill="#F48FB1"/><rect x="16" y="38" width="68" height="12" rx="6" fill="#fff"/><path d="M50 37c-8 0-11-9-6-14 3-3 9-3 12 0 5 5 2 14-6 14z" fill="#E5484D"/><path d="M46 22l4 4 4-4" stroke="#4CAF50" stroke-width="3" fill="none" stroke-linecap="round"/>' },
        { id: 'cupcake', label: 'カップケーキ', food: 1, keys: ['カップケーキ', 'マフィン'],
          svg: sh + '<path d="M28 56H72L66 84H34Z" fill="#7FB2F0"/><path d="M38 56l2 28M50 56v28M62 56l-2 28" stroke="#5A93D6" stroke-width="2.5"/><path d="M24 58Q22 44 36 42Q38 28 50 30Q62 28 64 42Q78 44 76 58Z" fill="#FFF4D6"/><circle cx="50" cy="27" r="5.5" fill="#E5484D"/>' },
        { id: 'pancake', label: 'パンケーキ', food: 1, keys: ['パンケーキ', 'ホットケーキ', 'ワッフル'],
          svg: sh + '<ellipse cx="50" cy="74" rx="34" ry="8" fill="#C97A33"/><rect x="16" y="62" width="68" height="12" fill="#E9A65A"/><ellipse cx="50" cy="62" rx="34" ry="8" fill="#C97A33"/><rect x="16" y="50" width="68" height="12" fill="#E9A65A"/><ellipse cx="50" cy="50" rx="34" ry="8" fill="#D9893A"/><rect x="42" y="42" width="16" height="9" rx="2" fill="#FFE58A"/><path d="M30 50q2 10 0 16M70 50q-1 8 1 12" stroke="#A65A1F" stroke-width="4" stroke-linecap="round" fill="none" opacity=".8"/>' },
        { id: 'crepe', label: 'クレープ', food: 1, keys: ['クレープ'],
          svg: sh + '<path d="M50 88L22 40H78Z" fill="#F2C47A"/><path d="M50 88L30 48" stroke="#E0A458" stroke-width="3"/><path d="M22 42Q24 26 38 30Q44 18 56 24Q70 20 78 40Z" fill="#fff"/><circle cx="40" cy="34" r="5" fill="#E5484D"/><circle cx="58" cy="30" r="5" fill="#E5484D"/>' },
        { id: 'icecream', label: 'アイス', food: 1, keys: ['アイス', 'ソフトクリーム', 'ジェラート', 'パフェ'],
          svg: sh + '<path d="M50 88L32 46H68Z" fill="#E7A65A"/><path d="M36 54L58 66M40 64L54 52M44 74L62 56M36 50L60 76" stroke="#C6853E" stroke-width="2"/><circle cx="50" cy="36" r="18" fill="#FFF4D6"/><circle cx="42" cy="30" r="5" fill="#fff" opacity=".7"/>' },
        { id: 'kakigori', label: 'かき氷', food: 1, keys: ['かき氷', 'かきごおり', 'カキ氷', 'フラッペ'],
          svg: sh + '<path d="M26 60H74L66 86H34Z" fill="#7FD1F5"/><path d="M20 62Q20 30 50 26Q80 30 80 62Z" fill="#fff" stroke="#DDE6F0" stroke-width="2"/><path d="M28 46Q50 20 72 46Q60 40 50 44Q40 40 28 46Z" fill="#E5484D" opacity=".85"/>' },
        { id: 'dango', label: 'だんご', food: 1, keys: ['だんご', '団子', 'みたらし', '餅', 'もち', '大福', '和菓子', 'どら焼', 'どらやき', 'たい焼', '鯛焼', '今川焼'],
          svg: sh + '<path d="M50 14V90" stroke="#C9A36B" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="28" r="13" fill="#F6A6B8"/><circle cx="50" cy="52" r="13" fill="#FFF8EC" stroke="#EADFCB" stroke-width="2"/><circle cx="50" cy="76" r="13" fill="#9CCB63"/>' },
        // ---- 食べ物 ----
        { id: 'takoyaki', label: 'たこ焼き', food: 1, keys: ['たこ焼', 'たこやき', 'タコ焼', '明石焼'],
          svg: sh + '<path d="M14 62H86L76 82H24Z" fill="#E8C08A"/><circle cx="33" cy="56" r="12" fill="#D9893A"/><circle cx="50" cy="51" r="12" fill="#D9893A"/><circle cx="67" cy="56" r="12" fill="#D9893A"/><path d="M24 52q9-8 18-4t18 0 18 4" fill="none" stroke="#5A321C" stroke-width="7" stroke-linecap="round"/><path d="M28 50q4-3 8 0t8 0 8 0 8 0 8 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><g fill="#4CAF50"><circle cx="40" cy="44" r="1.5"/><circle cx="56" cy="43" r="1.5"/><circle cx="64" cy="48" r="1.5"/></g>' },
        { id: 'yakisoba', label: '焼きそば', food: 1, keys: ['焼きそば', 'やきそば', '焼そば', 'そば', 'うどん', 'ラーメン', '麺', 'パスタ', 'スパゲッティ'],
          svg: sh + '<ellipse cx="50" cy="66" rx="38" ry="14" fill="#fff" stroke="#DDE2EA" stroke-width="2"/><path d="M22 64Q24 40 50 38Q76 40 78 64Q64 70 50 70Q36 70 22 64Z" fill="#C98A45"/><path d="M28 58q6-8 12 0t12 0 12 0 10-2M30 50q6-6 12 0t12 0 10 0" fill="none" stroke="#E7B36E" stroke-width="3" stroke-linecap="round"/><g fill="#E5484D"><rect x="46" y="40" width="7" height="3" rx="1.5"/><rect x="58" y="46" width="6" height="3" rx="1.5"/></g><path d="M36 44q4-4 8 0" stroke="#56B65A" stroke-width="4" fill="none" stroke-linecap="round"/>' },
        { id: 'onigiri', label: 'おにぎり', food: 1, keys: ['おにぎり', 'おむすび', 'ごはん', 'ご飯', 'ライス', '丼', 'いなり', '寿司', 'すし', '弁当'],
          svg: sh + '<path d="M50 20Q57 20 83 66Q87 78 76 80H24Q13 78 17 66Q43 20 50 20Z" fill="#fff" stroke="#DDE2EA" stroke-width="2"/><rect x="36" y="60" width="28" height="20" rx="2" fill="#2F3B33"/>' },
        { id: 'fries', label: 'ポテト', food: 1, keys: ['ポテト', 'フライドポテト', 'いも', '芋', 'チップス'],
          svg: sh + '<g fill="#F7C948"><rect x="30" y="20" width="7" height="40" rx="2"/><rect x="40" y="14" width="7" height="46" rx="2"/><rect x="50" y="18" width="7" height="42" rx="2"/><rect x="60" y="22" width="7" height="38" rx="2"/><rect x="35" y="26" width="7" height="34" rx="2" transform="rotate(-10 38 43)"/><rect x="56" y="26" width="7" height="34" rx="2" transform="rotate(10 59 43)"/></g><path d="M24 46H76L70 86H30Z" fill="#E5484D"/><path d="M24 46Q50 58 76 46" fill="#C9302C"/>' },
        { id: 'karaage', label: 'からあげ', food: 1, keys: ['からあげ', '唐揚', 'から揚げ', 'チキン', 'ナゲット', '焼き鳥', 'やきとり', '串カツ', 'フライ'],
          svg: sh + '<path d="M18 60q-2-14 12-16q4-10 14-6q10-4 14 6q12 0 12 12q4 10-6 14q-6 8-16 4q-10 6-18-2q-14 0-12-12z" fill="#C97A33"/><path d="M28 54q6-4 10 0M46 46q6-3 10 1M50 62q6-4 10 0" stroke="#E7A65A" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M66 66l16-10a10 10 0 0 1-2 14z" fill="#FFE066" stroke="#F4C542" stroke-width="2"/>' },
        { id: 'burger', label: 'ハンバーガー', food: 1, keys: ['バーガー', 'ハンバーガー', 'ハンバーグ'],
          svg: sh + '<path d="M18 46Q18 22 50 22Q82 22 82 46Z" fill="#D9893A"/><g fill="#FFF4D6"><ellipse cx="40" cy="32" rx="2.5" ry="1.4"/><ellipse cx="55" cy="29" rx="2.5" ry="1.4"/><ellipse cx="64" cy="36" rx="2.5" ry="1.4"/></g><path d="M16 50q5-6 10 0t10 0 10 0 10 0 10 0 10 0 10 0" fill="none" stroke="#56B65A" stroke-width="5" stroke-linecap="round"/><path d="M18 52H82L72 60H28Z" fill="#FFC93C"/><rect x="18" y="58" width="64" height="11" rx="5.5" fill="#6B3B22"/><path d="M18 70H82Q82 82 70 82H30Q18 82 18 70Z" fill="#D9893A"/>' },
        // ---- 飲み物 ----
        { id: 'coffee', label: 'コーヒー', drink: 1, keys: ['コーヒー', '珈琲', 'ブレンド', 'アメリカーノ', 'エスプレッソ', 'カフェ', 'ラテ', 'カプチーノ', 'モカ', 'カフェオレ'],
          svg: steam + '<ellipse cx="48" cy="84" rx="32" ry="5" fill="#E3E7EE"/><path d="M71 48Q86 48 84 60Q82 70 68 68" fill="none" stroke="#C9CED8" stroke-width="5"/><path d="M22 38H74L70 76Q68 82 62 82H34Q28 82 26 76Z" fill="#fff" stroke="#C9CED8" stroke-width="2"/><ellipse cx="48" cy="39" rx="25" ry="5" fill="#6B3B22"/>' },
        { id: 'tea', label: '紅茶', drink: 1, keys: ['紅茶', 'ティー', 'アールグレイ', 'ダージリン', 'ミルクティー', 'チャイ', 'ハーブティー', 'レモンティー'],
          svg: steam + '<ellipse cx="48" cy="84" rx="32" ry="5" fill="#E3E7EE"/><path d="M71 48Q86 48 84 60Q82 70 68 68" fill="none" stroke="#C9CED8" stroke-width="5"/><path d="M22 38H74L70 76Q68 82 62 82H34Q28 82 26 76Z" fill="#fff" stroke="#C9CED8" stroke-width="2"/><ellipse cx="48" cy="39" rx="25" ry="5" fill="#C27C3A"/><path d="M62 39V58" stroke="#B0B6C3" stroke-width="1.5"/><rect x="57" y="56" width="10" height="9" rx="1.5" fill="#F4C542"/>' },
        { id: 'greentea', label: 'お茶', drink: 1, keys: ['緑茶', 'お茶', '煎茶', 'ほうじ茶', '抹茶', '麦茶', 'ウーロン', '烏龍', '玄米茶'],
          svg: steam + '<path d="M28 34H72L68 80Q67 86 60 86H40Q33 86 32 80Z" fill="#E7EEE2" stroke="#C7D4BE" stroke-width="2"/><rect x="29" y="54" width="42" height="9" fill="#7FA36A"/><ellipse cx="50" cy="35" rx="22" ry="4.5" fill="#8DC05A"/>' },
        { id: 'juice', label: 'ジュース', drink: 1, keys: ['ジュース', 'オレンジ', 'りんご', 'リンゴ', 'アップルジュース', 'グレープ', 'ぶどう', '果汁', 'スムージー', 'ネクター', 'ミックス'],
          svg: sh + '<rect x="52" y="10" width="6" height="40" rx="3" fill="#E5484D" transform="rotate(14 55 30)"/><path d="M28 30H72L65 86H35Z" fill="#EAF6FF" stroke="#C9DCEB" stroke-width="2"/><path d="M30 44H70L65 86H35Z" fill="#FFA43A"/><circle cx="70" cy="32" r="10" fill="#FFC15E" stroke="#F49A1A" stroke-width="2"/><path d="M70 22V42M60 32H80M63 25l14 14M77 25L63 39" stroke="#F49A1A" stroke-width="1.5"/>' },
        { id: 'soda', label: 'ソーダ', drink: 1, keys: ['ソーダ', 'サイダー', 'コーラ', 'ラムネ', '炭酸', 'レモネード', 'ジンジャー', 'クリームソーダ', 'レモンスカッシュ'],
          svg: sh + '<rect x="50" y="8" width="6" height="40" rx="3" fill="#5AA2FF" transform="rotate(12 53 28)"/><path d="M28 30H72L65 86H35Z" fill="#EAF6FF" stroke="#C9DCEB" stroke-width="2"/><path d="M30 42H70L65 86H35Z" fill="#7FDB9A"/><g fill="#fff" opacity=".85"><circle cx="42" cy="56" r="3"/><circle cx="56" cy="64" r="2.5"/><circle cx="48" cy="74" r="2"/><circle cx="60" cy="50" r="2"/></g><circle cx="44" cy="30" r="9" fill="#E5484D"/>' },
        { id: 'milk', label: '牛乳', drink: 1, keys: ['牛乳', 'ミルク', 'ラッシー', 'ヨーグルト', 'カルピス', '乳酸'],
          svg: sh + '<path d="M30 40H58V86H30Z" fill="#fff" stroke="#DDE2EA" stroke-width="2"/><path d="M58 40L72 32V78L58 86Z" fill="#E6E9EF"/><path d="M30 40L44 22L58 40Z" fill="#F3F5F8" stroke="#DDE2EA" stroke-width="2"/><path d="M44 22L58 14L72 32L58 40Z" fill="#DCE1EA"/><rect x="30" y="56" width="28" height="14" fill="#5AA2FF"/><path d="M44 58q-5 6 0 9 5-3 0-9z" fill="#fff"/>' },
        { id: 'water', label: '水', drink: 1, keys: ['水', 'ミネラルウォーター', 'ウォーター', '天然水'],
          svg: sh + '<rect x="40" y="12" width="20" height="9" rx="2" fill="#2F7DE0"/><path d="M42 21H58V28Q70 34 70 46V82Q70 88 64 88H36Q30 88 30 82V46Q30 34 42 28Z" fill="#D7EEFF" stroke="#A9D2F5" stroke-width="2"/><rect x="30" y="52" width="40" height="16" fill="#5AA2FF" opacity=".85"/><path d="M50 55q-5 6 0 10 5-4 0-10z" fill="#fff"/>' },
        { id: 'drink', label: '飲み物', drink: 1, keys: ['ドリンク', '飲み物', 'ジュース類'],
          svg: sh + '<rect x="52" y="6" width="6" height="30" rx="3" fill="#5AA2FF" transform="rotate(12 55 21)"/><rect x="26" y="26" width="48" height="10" rx="5" fill="#9AA3B2"/><path d="M29 36H71L65 86H35Z" fill="#fff" stroke="#C9CED8" stroke-width="2"/><rect x="31" y="52" width="38" height="14" fill="#7FB2F0"/>' },
        // ---- どれにも合わない時 ----
        { id: 'dish', label: 'お皿', food: 1, keys: [],
          svg: sh + '<ellipse cx="50" cy="74" rx="40" ry="10" fill="#fff" stroke="#DDE2EA" stroke-width="2"/><path d="M18 72Q18 36 50 36Q82 36 82 72Z" fill="#D8DEE8"/><path d="M28 60Q30 44 48 42" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/><circle cx="50" cy="32" r="5" fill="#B8C0CD"/>' }
    ];
    var byId = {};
    A.forEach(function (a) { byId[a.id] = a; });
    // 分類の印・名前から、飲み物の分類かどうか
    function isDrinkCat(type, catLabel) {
        return type === 'drink' || /ドリンク|飲み物|飲物|のみもの|drink/i.test(String(catLabel || ''));
    }
    function norm(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ''); }
    function best(name, list) {
        var hit = null, len = 0;
        list.forEach(function (a) {
            a.keys.forEach(function (k) {
                var kk = norm(k);
                if (kk.length > len && name.indexOf(kk) >= 0) { hit = a; len = kk.length; }
            });
        });
        return hit;
    }
    function pick(name, type, catLabel) {
        var n = norm(name);
        var drink = isDrinkCat(type, catLabel);
        var foods = A.filter(function (a) { return a.food; }), drinks = A.filter(function (a) { return a.drink; });
        var hit = best(n, drink ? drinks : foods) || best(n, drink ? foods : drinks);
        if (hit) return hit.id;
        if (drink) return 'drink';
        if (type === 'sweet' || /パン/.test(String(catLabel || ''))) return 'pan';
        if (type === 'savory' || /クッキー|菓子|スイーツ/.test(String(catLabel || ''))) return 'cookie';
        return 'dish';
    }
    function svg(id) {
        var a = byId[id];
        return a ? '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + a.svg + '</svg>' : '';
    }
    window.MENU_ART = { list: A.map(function (a) { return { id: a.id, label: a.label }; }), pick: pick, svg: svg, has: function (id) { return !!byId[id]; } };
})();
