# ChemFlash — Claude Code 仕様書

## 作業ルール

* **デプロイは push のみ**: `main` に push すると GitHub Pages（`https://oimo-taruto.github.io/chemflash/`）へ即反映。ビルド工程なし。
* **問題データの配布フロー（新）**: admin.html で追加・編集後、「🚀 アプリに配信する」ボタンを押す → Firebase の `/chemflash/official_questions.json` に保存 → 生徒が次回アプリを開いたとき自動反映。seed.js の直接編集・push は不要。
* **seed.js は初期データ兼フォールバック**: Firebase 未到達時（オフライン等）は seed.js の問題リストを使う。seed.js を更新する場合も push するだけでよいが、Firebase 側が優先される点に注意。
* **絵文字の扱い**: ヘッダー以外（パネル見出し・グレード判定ボタン 🙅🤔🙆 等）の絵文字は意図的に残している。アイコン化はヘッダーのみ（lucide の生SVGをインライン）。

## プロジェクト概要

高校化学（阪大薬学レベル）の暗記事項を、忘却曲線で定着管理するフラッシュカード型 PWA。阪大薬学志望の高三生が受験まで毎日使う前提。現在 713 問を内蔵。ログイン不要・無料・登録不要で、URL を開くだけで使える。作者（管理者）が生徒に配布して使ってもらう運用。

## 技術スタック

* **DB**: Firebase Realtime Database（`https://chemflash-e0a01-default-rtdb.asia-southeast1.firebasedatabase.app`）。REST API のみ使用、SDK は読み込まない。ルールは `/chemflash/*` を read/write 公開（認証なし）。
* **サーバー**: なし（静的ホスティング）。本番は GitHub Pages、ローカル開発は `serve.ps1`（PowerShell 静的サーバ, port 4173）。
* **フロントエンド**: 素の HTML/CSS/JS（ビルドステップなし、フレームワークなし）。永続化は localStorage（キー `chemflash_data_v1`）。
* **その他**: PWA（manifest.json + sw.js、オフライン一部対応）。アイコンは lucide の生SVGをインライン。Supabase は不使用。

## ディレクトリ構造

```
chem-flashcards/
├── CLAUDE.md          # このファイル
├── DESIGN.md          # 壁打ちで決めた仕様の根拠（忘却曲線・3段階評価など）
├── README.md          # ユーザー/配布者向け説明
├── index.html         # 生徒用アプリ本体（演習/復習/書庫/分析/保存/同期 + 使い方モーダル）
├── admin.html         # 管理画面（作問・CSV入出力・利用状況・フィードバック）
├── manifest.json      # PWA マニフェスト
├── sw.js              # Service Worker（公開ドメインのみ登録）
├── serve.ps1          # ローカル開発用 静的サーバ
├── icon.svg / qr.svg
├── css/
│   └── style.css
├── js/
│   ├── sync-config.js # Firebase URL を1箇所で設定（window.CHEMFLASH_SYNC_URL）
│   ├── seed.js        # 公式問題の原本（713問）。これを編集して配信
│   ├── store.js       # データ層（localStorage / 同期 / 採点 / 分析 / CSV）
│   ├── app.js         # 生徒用アプリの画面ロジック
│   └── admin.js       # 管理画面のロジック
└── .claude/
    └── launch.json    # preview_start 用（dev専用・gitには載せていない）
```

## データベーススキーマ（Firebase RTDB）

```
/chemflash
  ├── official_questions  # 管理画面から配信した公式問題リスト（配列）。PUT で上書き、GET で全取得
  ├── <syncId>            # 同期IDごとの学習データ全量（任意・同期機能を使った端末のみ）
  │     └── { questions, progress, comments, bookmarks, ... }
  ├── feedback            # 生徒からのテキストフィードバック（POSTでpush生成）
  │     └── <autoId>: { text, at }
  └── pings               # 匿名デバイスping（利用端末数の把握）
        └── <deviceId>: { at }   # deviceId は乱数。個人情報なし。PUTで上書き
```

localStorage 側の構造（`chemflash_data_v1`）は `store.js` の `defaultData()` 参照:
`questions / progress(qid→{first,status,attempts,last,srs}) / comments / bookmarks / unlearned / removedOfficial / session / totalCycles / syncId / dbUrl / lastSync`

## 主要な仕様・ロジック

設計の根拠は **DESIGN.md** に集約。要点のみ:

* **自己評価は3段階**（🙅ng / 🤔vague / 🙆ok）。集めるのは3段階、分析の判定は2値、見せ方は3色。
* **忘却曲線（Leitner式・`SRS_INTERVALS=[7,30]`日）**: 期限が来た問題に「完璧」を付けたときだけ段階アップ（1日1回まで）。完璧3回で🎓卒業。`js/store.js`。
* **復習は2本立て**: 🔁間違い復習（完璧以外を今すぐ）/ 📅今日の復習（期限到来分）。**今日の復習は1セッション20問キャップ**（`DUE_CAP=20`, app.js）。残りは「続けて復習する」で継続。やる気を削がないため。
* **問題IDは問題文のハッシュ**（`hashId`）。ただし `updateQuestion()` は ID を据え置く設計なので、**管理画面経由の編集は問題文を変えても進捗を引き継ぐ**（旧 seed.js 直接編集方式より有利）。seed.js を手動編集して push した場合は問題文変更で ID が変わり、その1問の進捗リセットが起きる点に注意。
* **公式/自作の区別（origin）**: official は seed.js が原本で push 配信。custom は生徒の個人問題で配信に触れない。詳細は DESIGN.md。
* **利用人数の把握**: アプリ起動時に `S.pingDevice()` が匿名 deviceId を `/chemflash/pings` に記録。管理画面が件数を shallow query で数える。同期IDの数（旧方式）ではなく、開いた端末数で実利用を計測。

## 現在の状態

* [x] 使い方ページ（ヘッダー「使い方」ボタン → モーダル、機能説明をアコーディオン化）
* [x] フィードバック機能（同期タブから送信 → 管理画面で閲覧/削除）
* [x] ヘッダー絵文字を lucide アイコンに置換
* [x] 復習20問キャップ、グレード判定ボタンの改行修正（white-space:nowrap + 小画面 font-size）
* [x] 管理画面に「利用状況」パネル（匿名デバイスping方式で実利用端末数を表示）
* [x] ヘリウムの問題を「理想気体に最も近い理由」に差し替え（理論化学/気体の法則/難易度2）
* [x] 管理画面「🚀 アプリに配信する」ボタン（Firebase `/chemflash/official_questions.json` に PUT → 生徒が次回起動時に自動取得）
* [x] 配信ボタンを問題一覧の上下両方に配置
* [x] 管理画面の各問題行にチェックボックス（管理者メモ用・`chemflash_admin_checked` キーで localStorage 保存、生徒側に影響なし）

**直近の作業**: 管理画面配信機能の追加（Firebase経由でリアルタイム反映）。

**次のTODO**: なし（配布済み端末は次回起動で自動更新される）。

**既知の問題**:
* localStorage を消すと同一生徒が複数端末としてカウントされる（ping方式の宿命・実用上は軽微）。
* `preview_screenshot` がこの環境でタイムアウトしがち（harness 由来。`preview_inspect`/`preview_snapshot` で代替）。
* `store.js` 冒頭コメントに旧実装（jsonblob.com）の記述が残存（実体は Firebase）。

## 禁止事項

* **Firebase ルールを安易に締めない**: 認証なし read/write 公開は学校内利用の前提での許容。変更時は同期・ping・フィードバックの全機能への影響を確認。
* **ビルドツール/フレームワーク/npm 依存を導入しない**: 「ビルド不要・静的配信」が本プロジェクトの設計思想。lucide も SDK ではなく生SVGをインラインで使う。
* **生徒の進捗を壊す変更を不用意にしない**: 問題文の変更はID変化＝進捗リセットを伴う。修正前に影響範囲（その1問だけか）を明示して確認を取る。
* **管理画面へのリンクをアプリ側に置かない**（admin.html は作者専用の作問デスク）。
