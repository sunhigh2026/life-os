

## プロジェクト概要

「開いたら即メモ。あとはAIがやる。」をコンセプトにした個人ライフダッシュボード。日記・ToDo・読書記録を統合し、Gemini AIが分析・提案する。GAS版のフル機能版として、速度・UI自由度・カメラ対応を実現する。

---

## アーキテクチャ

```
スマホ / PC ブラウザ
    ↓
Cloudflare Pages（フロントエンド: HTML/CSS/JS, PWA）
    ↓
Cloudflare Workers（APIバックエンド: /api/*）
    ↓
Cloudflare D1（SQLiteデータベース）
    ↓（外部API呼び出し）
├── Gemini API（AI分類・分析・レポート生成）
├── Google Books API（書籍情報取得）
└── Google Calendar API（ToDo連携、オプション）
```

---

## 技術スタック

|レイヤー|技術|備考|
|---|---|---|
|フロントエンド|HTML / CSS / JavaScript（vanilla）|フレームワーク不使用。PWA対応|
|ホスティング|Cloudflare Pages|GitHub連携で自動デプロイ|
|API|Cloudflare Workers（Functions）|Pages Functions（/functions/api/ディレクトリ）|
|DB|Cloudflare D1（SQLite）|無料枠: 読み取り10万/日、書き込み1,000/日|
|AI|Gemini API（2.5 Flash）|無料枠: 250回/日|
|書籍検索|Google Books API|無料|
|バーコード|html5-qrcode|カメラでISBN読み取り|
|音声入力|Web Speech API|ブラウザ標準|

---

## ディレクトリ構成

```
life-os/
├── public/
│   ├── index.html          ← メイン画面（日記 + ToDo + ダッシュボード）
│   ├── books.html          ← 読書記録画面
│   ├── chat.html           ← AIチャット画面（Phase 7）
│   ├── style.css           ← 共通スタイル
│   ├── app.js              ← メイン画面ロジック
│   ├── books.js            ← 読書画面ロジック
│   ├── chat.js             ← チャット画面ロジック（Phase 7）
│   ├── manifest.json       ← PWA設定
│   └── icon-192.png        ← PWAアイコン
├── functions/
│   └── api/
│       ├── entry.js        ← POST/GET /api/entry
│       ├── todo.js         ← POST/GET/PUT /api/todo
│       ├── book.js         ← POST/GET /api/book
│       ├── book-search.js  ← GET /api/book-search
│       ├── tag.js          ← GET /api/tag
│       ├── dashboard.js    ← GET /api/dashboard
│       ├── chat.js         ← POST /api/chat（Phase 7）
│       └── _middleware.js  ← 共通認証・CORS
├── schema.sql              ← D1テーブル定義
├── wrangler.toml           ← Cloudflare設定
├── package.json
└── README.md
```

---

## データベース設計（D1 SQLite）

### schema.sql

```sql
-- 日記
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  datetime TEXT NOT NULL,
  mood INTEGER,
  tag TEXT,
  text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ToDo
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  datetime TEXT NOT NULL,
  text TEXT NOT NULL,
  tag TEXT,
  priority TEXT DEFAULT 'mid',
  due TEXT,
  status TEXT DEFAULT 'open',
  done_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 読書記録
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  datetime TEXT NOT NULL,
  isbn TEXT,
  title TEXT,
  author TEXT,
  cover_url TEXT,
  medium TEXT,
  rating INTEGER,
  status TEXT DEFAULT 'done',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 読書メモ（1冊に複数メモ）
CREATE TABLE IF NOT EXISTS book_notes (
  id TEXT PRIMARY KEY,
  datetime TEXT NOT NULL,
  book_id TEXT NOT NULL,
  text TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (book_id) REFERENCES books(id)
);

-- 目標（Phase 5）
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  type TEXT,
  goal TEXT,
  target REAL,
  unit TEXT,
  freq TEXT,
  start TEXT,
  deadline TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_entries_datetime ON entries(datetime);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due);
CREATE INDEX IF NOT EXISTS idx_books_datetime ON books(datetime);
CREATE INDEX IF NOT EXISTS idx_book_notes_book_id ON book_notes(book_id);
```

---

## API設計

すべて `/api/` 配下。レスポンスはJSON。

### 日記

|メソッド|パス|説明|
|---|---|---|
|POST|/api/entry|日記保存。body: { datetime, mood, tag, text }|
|GET|/api/entry?date=YYYY-MM-DD|指定日の日記一覧取得|

### ToDo

|メソッド|パス|説明|
|---|---|---|
|POST|/api/todo|ToDo保存。body: { datetime, text, tag, priority, due }|
|GET|/api/todo?status=open|未完了ToDo一覧取得|
|PUT|/api/todo|ToDo更新。body: { id, status, due, priority }|

### 読書

|メソッド|パス|説明|
|---|---|---|
|POST|/api/book|読書記録保存。body: { isbn, title, author, cover_url, medium, rating, status, note }|
|GET|/api/book?limit=10|最近の読書一覧取得|
|PUT|/api/book|読書記録更新。body: { id, status, rating, note }|
|GET|/api/book-search?q=xxx|Google Books APIで書籍検索。ISBNまたはタイトル|
|POST|/api/book-note|読書メモ保存。body: { book_id, text }|
|GET|/api/book-note?book_id=xxx|特定書籍のメモ一覧|

### ダッシュボード

|メソッド|パス|説明|
|---|---|---|
|GET|/api/dashboard|今日の記録、未完了ToDo、同日振り返り、30日ストリーク、最近の完了をまとめて返す|

### タグ

|メソッド|パス|説明|
|---|---|---|
|GET|/api/tag?q=xxx|entries + todos テーブルからタグ使用頻度を集計し返す。qがあれば部分一致フィルタ|

### AIチャット（Phase 7）

|メソッド|パス|説明|
|---|---|---|
|POST|/api/chat|body: { message }。Gemini APIにコンテキスト付きで問い合わせ、ゆるキャラ口調で応答|

---

## 画面設計

### 共通

画面下部に固定タブバー: Home / 読書 / Chat（Phase 7）。全画面共通のスタイル（style.css）。PWA対応でホーム画面追加可能。

### メイン画面（index.html）

画面上部に入力エリアを固定配置。autofocusでキーボード即表示。

入力エリア構成:

- datetime-local入力 + 「今」ボタン（現在時刻セット、修正可能）
- テキスト入力欄（1行）
- モード切替ボタン: 📝日記 / ☑ToDo
- タグ入力欄（自由入力、部分一致サジェスト、よく使う上位5つをボタン表示）
- 日記モード時: 気分絵文字6段階（😢😞😐🙂😊🤩）
- ToDoモード時: 期限日（date入力）、優先度（🔴高/🟡普通/🔵低）
- 音声入力ボタン（Web Speech API）
- 「記録する」ボタン

ダッシュボード（入力エリアの下、スクロール）:

- 📝 今日の記録（時刻、mood絵文字、タグ、テキスト）
- ☑ やること（件数、期限超過は赤、タップで完了）
- 📅 この日の振り返り（過去同月日のエントリ、あれば表示）
- ✅ 最近の完了（直近5件）
- 🔥 30日ストリーク（GitHub風タイル）
- スプレッドシートリンク → D1エクスポートリンクに変更

### 読書画面（books.html）

- 検索入力（ISBNまたはタイトル）+ 検索ボタン
- バーコードスキャンボタン（html5-qrcode使用、カメラ起動）
- 検索結果: 表紙、タイトル、著者のカード一覧（タップで選択）
- 登録フォーム: 表紙プレビュー、媒体選択（本/Kindle/Audible/電子書籍/その他）、星評価（1-5）、ステータス（読みたい/読書中/読了）、感想テキスト（音声入力可）
- 最近の読書一覧

### AIチャット画面（chat.html）Phase 7

- チャットUI（メッセージ履歴 + 入力欄）
- ゆるキャラ口調のAI応答
- 「今日何やる？」でデイリーブリーフィング
- 「先月の読書量は？」等の自然言語クエリ

---

## 認証

シンプルなAPIキー認証。wrangler.tomlの環境変数 `AUTH_KEY` を設定し、`_middleware.js` で `Authorization: Bearer xxx` ヘッダーを検証。フロントエンドのJSにもキーを埋め込む（個人利用のため許容）。

---

## wrangler.toml

```toml
name = "life-os"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "life-os-db"
database_id = "<作成後に記入>"

[vars]
AUTH_KEY = "<自分で決めたAPIキー>"
GEMINI_API_KEY = "<Gemini APIキー>"
```

---

## 環境変数

|変数名|説明|
|---|---|
|AUTH_KEY|API認証キー（自分で決める文字列）|
|GEMINI_API_KEY|Gemini API キー（Google AI Studioで取得）|

---

## ビルドフェーズ（実装順序）

### Phase 0: プロジェクト初期設定

- wrangler CLIインストール
- D1データベース作成: `wrangler d1 create life-os-db`
- schema.sql実行: `wrangler d1 execute life-os-db --file=schema.sql`
- GitHubリポジトリ作成、Cloudflare Pages連携
- 動作確認用の最小HTMLをデプロイ

### Phase 1: APIバックエンド

- functions/api/_middleware.js（AUTH_KEY検証）
- functions/api/entry.js（日記CRUD）
- functions/api/todo.js（ToDo CRUD + 完了）
- functions/api/tag.js（タグサジェスト）
- functions/api/dashboard.js（ダッシュボード集約）
- ローカルテスト: `wrangler pages dev`

### Phase 2: メイン画面

- public/index.html + public/style.css + public/app.js
- 入力エリア（日記/ToDo切替、タグサジェスト、mood、音声入力）
- ダッシュボード（今日の記録、やること、振り返り、完了、ストリーク）
- PWA: manifest.json + icon

### Phase 3: 読書記録

- functions/api/book.js（読書CRUD）
- functions/api/book-search.js（Google Books API検索）
- public/books.html + public/books.js
- バーコードスキャン（html5-qrcode）
- 書籍検索・選択・登録フォーム
- 読書メモ機能（book_notes）

### Phase 4: AI補助（Gemini連携）

- functions/api/chat.js
- タグ・mood自動提案（保存後にGeminiで推定、ユーザーが採用/無視）
- デイリーブリーフィング

### Phase 5: 目標管理

- goals テーブル活用
- 目標定義・進捗表示

### Phase 6: 週次レポート

- Cron Trigger（Workers）で毎週日曜に実行
- Gemini APIで分析テキスト生成
- ゆるキャラコメント付き
- メール送信（Mailchannels or 外部SMTP）

### Phase 7: チャット画面

- public/chat.html + public/chat.js
- ゆるキャラ口調のAI応答
- D1データ参照型のクエリ応答

### Phase 8: データエクスポート

- CSV/JSONエクスポートAPI: GET /api/export?table=entries&format=csv
- Google Sheetsへの定期エクスポート（オプション）

---

## GAS版との対応表

|機能|GAS版|Cloudflare版|
|---|---|---|
|データ保存|Google Spreadsheet|Cloudflare D1|
|API|google.script.run|fetch(‘/api/xxx’)|
|ホスティング|GASウェブアプリ|Cloudflare Pages|
|カメラ|不可（iframe制約）|可能|
|表示速度|2-5秒|50ms以下|
|データ直接編集|スプシで直接編集|エクスポート→編集→インポート|
|AI|GASからGemini API|WorkersからGemini API|
|認証|Googleアカウント|APIキー|
|コスト|完全無料|ドメイン代のみ（年$10程度）|

---

## UI/UXガイドライン

- ライトモード（白ベース #fafafa）
- フォント: システムフォント（-apple-system, BlinkMacSystemFont, Hiragino Sans）
- 角丸: カード16px、ボタン10px、チップ20px
- 影: box-shadow 0 1px 4px rgba(0,0,0,0.08)
- アクセントカラー: #4a9eff（青）、ToDo: #ff6b6b（赤）
- レスポンシブ: max-width 520px中央寄せ、768px以上で640px
- トースト通知: 画面下部中央、2秒で消える
- autofocus: ページ表示時にテキスト入力欄にフォーカス

---

## GAS版から移行するデータ

既存のGoogle Spreadsheetデータ（diary, todo, booksシート）をCSVエクスポートし、D1にインポートする。インポート用スクリプトをPhase 8で用意する。

---

## 注意事項

- フレームワーク（React, Vue等）は使わない。vanilla JS のみ
- ビルドツール（webpack, vite等）は使わない。そのまま配信
- CSSフレームワークは使わない。手書きCSS
- 外部ライブラリは html5-qrcode のみ（CDN読み込み）
- 全ファイルを1つずつ完成させてから次に進む
- 各PhaseごとにGitHubにpushして動作確認

---

以上です。Claude Codeにこの仕様書を渡して「Phase 0から順に実装して」と指示すればOKです。何か追加・修正したい点はありますか？