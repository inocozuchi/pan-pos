/**
 * 予約帳 → Google スプレッドシートの控え（Google Apps Script）
 * --------------------------------------------------
 * 使い方は docs/予約帳.md の「Google スプレッドシートの控え」を見てください。
 *
 * ・予約のページ（yoyaku.html）と管理のページ（yoyaku-kanri.html）から、予約が届くたびに送られてくる。
 * ・「予約」のシート：予約1つが1行。同じ予約（予約の印が同じ）は、同じ行を書きかえる（状態が変わった時など）。
 * ・「届いた記録」のシート：届いた中身を、そのまま下へ足していく（書きかえない）。いちばん確かな控え。
 * ・予約は、このシートで消しても、予約帳（Firestore）からは消えない。
 */
var SHEET = '予約';
var LOG = '届いた記録';
var HEAD = ['予約の印', '予約帳', '番号', 'お名前', '学籍番号', '品', '個数', '金額', '状態', 'お支払い', 'お店のメモ', '受け方', '受付の日時', '状態を変えた日時', '最後に届いた日時'];
var ST = { 'new': '予約中', done: '受け取り済み', cancel: '取り消し', backup: '仮の受付（番号なし）' };

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var raw = e && e.postData ? String(e.postData.contents || '') : '';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // 1) まず、届いた中身をそのまま残す
    sheetOf(ss, LOG, ['届いた日時', '中身']).appendRow([new Date(), raw.slice(0, 49000)]);
    // 2) 予約のシートを、予約の印ごとに書きかえる
    var d = JSON.parse(raw);
    var rows = d && d.kind === 'bulk' ? (d.rows || []) : (d && d.row ? [d.row] : []);
    upsert(ss, rows.filter(function (r) { return r && /^[A-Za-z0-9]{20,40}$/.test(String(r.rid || '')); }));
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error');
  } finally {
    lock.releaseLock();
  }
}

// 動いているか確かめる（ブラウザで URL を開くと「動いています」と出る）
function doGet() {
  return ContentService.createTextOutput('予約帳の控え：動いています');
}

function sheetOf(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 表計算ソフトで、文字が式として動かないように
function cell(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function upsert(ss, rows) {
  if (!rows.length) return;
  var sh = sheetOf(ss, SHEET, HEAD);
  var last = sh.getLastRow();
  var ids = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  var at = {};
  ids.forEach(function (r, i) { at[String(r[0])] = { row: i + 2, seq: r[2] }; });
  var now = new Date();
  var add = [];
  rows.forEach(function (r) {
    var line = [cell(r.rid), cell(r.book), r.seq || '', cell(r.name), cell(r.sid), cell(r.items), Number(r.qty) || 0, Number(r.total) || 0,
      ST[r.st] || cell(r.st), r.paid ? '済み' : '', cell(r.snote), r.via === 'shop' ? '店頭・電話' : 'ウェブ', cell(r.at), cell(r.stAt), now];
    var have = at[String(r.rid)];
    // 番号のついた行を、仮の受付（番号なし）で上書きしない
    if (have && r.st === 'backup' && have.seq) return;
    if (have && have.add != null) { add[have.add] = line; have.seq = r.seq; }
    else if (have) { sh.getRange(have.row, 1, 1, line.length).setValues([line]); have.seq = r.seq; }
    else { at[String(r.rid)] = { add: add.length, seq: r.seq }; add.push(line); }
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, HEAD.length).setValues(add);
}
