/* =========================================================
   ChemFlash 同期サーバ設定（アプリ所有者が一度だけ設定）

   無料の Firebase Realtime Database を同期先に使います。
   ここに URL を書いておくと、全端末で同期タブの設定入力が不要になります。
   （空のままでも、同期タブから各端末で URL を設定できます）

   ▼ 設定手順（5分・無料・クレジットカード不要）
   1. https://console.firebase.google.com で Google アカウントでログイン
   2. 「プロジェクトを追加」→ 名前は何でもOK（Analytics は無効でOK）
   3. 左メニュー「構築」→「Realtime Database」→「データベースを作成」
      （ロケーションは asia-southeast1 など任意、「テストモード」で開始）
   4. 「ルール」タブで以下のように設定して公開:
        {
          "rules": {
            "chemflash": { ".read": true, ".write": true }
          }
        }
   5. 「データ」タブ上部に表示される URL（例:
      https://xxxx-default-rtdb.asia-southeast1.firebasedatabase.app）
      を下の '' の中に貼り付ける
   ========================================================= */
window.CHEMFLASH_SYNC_URL = 'https://chemflash-e0a01-default-rtdb.asia-southeast1.firebasedatabase.app';
