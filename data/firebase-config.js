/*
 * 複数端末リアルタイム同期（Cloud Firestore）の接続設定
 * --------------------------------------------------
 * ここに値を入れると「複数端末で同時に会計 → 売上をリアルタイム共有」が有効になります。
 * 空（null）のままなら、同期は使わず従来どおり各端末の中だけで動作します（オフラインでも安全）。
 *
 * 【設定手順】
 *  1) Firebaseコンソール（https://console.firebase.google.com/）でプロジェクト作成
 *  2) Firestore Database を作成（本番モード／ロケーション asia-northeast1）
 *  3) Authentication →「匿名」を有効化
 *  4) プロジェクト設定 → マイアプリ → ウェブ（</>）で firebaseConfig を取得
 *  5) Firestore の「ルール」に data/README や手順書のルールを貼って公開
 *  6) 下の null を消して、取得した firebaseConfig を貼り付け → GitHubへコミット/Push
 *
 *   window.FIREBASE_CONFIG = {
 *     apiKey: "…",
 *     authDomain: "…",
 *     projectId: "…",
 *     storageBucket: "…",
 *     messagingSenderId: "…",
 *     appId: "…"
 *   };
 *
 * ※ Web用のAPIキーは公開前提の識別子で、貼り付けても問題ありません。
 *   データ保護は上記5)の「セキュリティルール（匿名認証必須）」で行います。
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBeM2lU-6N0H2fM0KXoBt1Iywlzg--FlmI",
  authDomain: "zemipos.firebaseapp.com",
  projectId: "zemipos",
  storageBucket: "zemipos.firebasestorage.app",
  messagingSenderId: "1092656588118",
  appId: "1:1092656588118:web:0aae7fe0dbebf7c8a922f7"
};
