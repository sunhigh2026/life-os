---
title: Cloudflare無料枠だけで「AI付き生活管理ダッシュボード」を作った ── Pages + D1 + Gemini 2.5 Flash
tags: Cloudflare CloudflareWorkers D1 GeminiAPI 個人開発
---

## 作ったもの

日記・ToDo・読書・健康・カレンダーを一つに統合した、自分専用の生活管理PWAアプリ **「Life OS」** を作った。

主な機能：

- **ひとこと日記** ── 気分スコア（1-6）＋タグ＋テキスト。10秒で記録完了
- **ToDo管理** ── Must/Want分類、AIによるタスク分解（サブタスク自動生成）、優先順位付け
- **読書記録** ── バーコードスキャンでISBN取得→書籍情報自動入力、読書メモ
- **AIチャット** ── キャラクター「ピアちゃん」が全データを参照して会話・提案
- **AIテキスト分類** ── 入力テキストをtodo/日記/質問に自動振り分け、タグや気分も推定
- **週次レポート** ── 1週間のデータを集計してAIコメント付きHTMLメールを送信
- **Googleカレンダー連携** ── 今日の予定をAIの文脈に注入
- **健康データ管理** ── 歩数・運動時間・体重の記録、生理周期の自動検出・予測
- **目標管理** ── 日次/週次/月次の目標設定と進捗トラッキング
- **日記振り返り** ── N年前の同じ日に何を書いたか表示

**ランニングコスト $0。** Cloudflareの無料枠＋各種無料APIだけで動いている。

開発の経緯や「なぜ作ったか」は note に書いているので、この記事では技術的な構成を中心に紹介する。

- [日記もToDo管理も続かない人間が、Google Apps Scriptで「これなら続く」やつを作った話](https://note.com/holy_python7310/n/n3208dcbe78a6)
- [ひとこと日記アプリを育ててたら、ピンクのゆるキャラAIコーチが爆誕した](https://note.com/holy_python7310/n/n64fbc93d85c1)

## アーキテクチャ

```
スマホ (PWA)
  ↓ fetch
Cloudflare Pages（静的HTML/CSS/JS）
  ↓ /api/*
Pages Functions（Workers互換ランタイム）
  ↓ D1 Binding
Cloudflare D1（SQLite）
  ↓ fetch
外部API
  ├─ Gemini 2.5 Flash（AIチャット・分類・タスク分解・レポート生成）
  ├─ OpenBD（ISBN→書籍情報、日本語書籍）
  ├─ 国立国会図書館 OpenSearch API（タイトル検索）
  ├─ Open Library（英語書籍フォールバック）
  ├─ Google Calendar API（OAuth2、読み取り専用）
  └─ Resend API（週次/年次レポートメール送信）
```

Cloudflare Pages + D1 を選んだ理由はシンプルで、**全部無料で、`git push` するだけでデプロイできて、SQLを直書きできる**から。Pages Functions は `functions/api/` にJSファイルを置くだけで自動的にAPIエンドポイントになるので、ルーティング設定も不要。

フレームワークは使っていない。HTML + Vanilla JS + CSS のみ。ビルドステップなし。

## プロジェクト構成

```
life-os/
├── public/              # 静的ファイル（Pagesが配信）
│   ├── index.html       # ダッシュボード
│   ├── todo.html        # ToDo管理
│   ├── books.html       # 読書記録（バーコードスキャン付き）
│   ├── chat.html        # AIチャット
│   ├── history.html     # 日記振り返り
│   ├── settings.html    # 設定
│   ├── app.js / style.css / manifest.json
│   └── ...
├── functions/api/       # Pages Functions → /api/* に自動ルーティング
│   ├── _middleware.js   # Bearer token認証
│   ├── entry.js         # 日記CRUD
│   ├── todo.js          # ToDo CRUD
│   ├── todo-suggest.js  # AI：今日やるべきタスク提案
│   ├── todo-decompose.js # AI：タスクをサブタスクに分解
│   ├── process-input.js # AI：テキスト自動分類
│   ├── chat.js          # AI：チャット（ピアちゃん）
│   ├── book.js          # 読書記録CRUD
│   ├── book-search.js   # 書籍検索（3段フォールバック）
│   ├── book-note.js     # 読書メモ
│   ├── calendar.js      # Google Calendar OAuth2
│   ├── dashboard.js     # 集計データ
│   ├── report.js        # 週次/年次レポート＋メール送信
│   ├── menstrual-stats.js # 生理周期検出・予測
│   ├── fitness.js       # 健康データCRUD
│   ├── goal.js          # 目標管理
│   ├── settings.js      # 設定管理
│   └── export.js        # データエクスポート
├── schema.sql           # D1テーブル定義
└── wrangler.toml        # Cloudflare設定
```

APIは全21エンドポイント。認証は `_middleware.js` で Bearer token を検証するだけのシンプルな方式。個人用なのでこれで十分。

## DB設計（D1 / SQLite）

7テーブル構成。

| テーブル | 用途 | 主なカラム |
|---|---|---|
| `entries` | 日記 | datetime, mood(1-6), tag, text |
| `todos` | ToDo | text, priority(high/mid/low), due, status, category(must/want), parent_id |
| `books` | 読書記録 | isbn, title, author, medium(蔵書/図書館/Kindle/Audible), rating, note |
| `book_notes` | 読書メモ | book_id(FK), text |
| `goals` | 目標 | goal, target, unit, freq(daily/weekly/...), deadline |
| `settings` | 設定 | key-value（キャラ設定、OAuthトークン等） |
| `fitness` | 健康 | date, steps, active_minutes, weight |

10年分のデータ見積もり：全テーブル合計で約16MB。D1の上限5GBの0.3%。

ToDoテーブルの `parent_id` がサブタスク機能の肝で、AIタスク分解で生成されたサブタスクが親タスクに紐付く。UIでは親タスクを展開すると子タスクが表示される仕組み。

## AIまわりの構成

AI機能はすべて Gemini 2.5 Flash のREST APIを直接叩いている。SDK不使用。

### 4つのAIエンドポイント

| エンドポイント | やること |
|---|---|
| `/api/chat` | キャラクターチャット。直近の日記・ToDo・読書・健康・カレンダー予定をシステムプロンプトに注入 |
| `/api/process-input` | テキストをtodo/diary/queryに分類し、タグ・優先度・気分・期限を推定 |
| `/api/todo-decompose` | タスクを3〜6件の具体的サブタスクに分解 |
| `/api/todo-suggest` | 未完了タスク一覧＋カレンダー予定を渡して「今日やるべき3件」を提案 |

共通して工夫した点は、**D1のデータを動的にプロンプトに注入する**こと。たとえばチャット用の `chat.js` では、日記・ToDo・読書・フィットネス・目標・カレンダーを `Promise.all` で並行取得してシステムプロンプトに埋め込む。これにより「ピアちゃん」は「最近mood低めだね〜」「この本の感想まだ書いてないよ？」のように、データに裏打ちされた発言ができる。

### タスク分解のプロンプトエンジニアリング

最初は「タスクを分解してください」だけだったが、「準備する」「実行する」「確認する」のような抽象的なステップしか返ってこなかった。

「**椅子に座って30分で取りかかれる行動**」を基準に、良い例・悪い例を明示することで解決した。

```
悪い例: 元タスク「開店祝い贈る」
× 開店祝いの準備
× 開店祝いを実行

良い例:
○ 予算と贈り物の候補を決める（花/酒/カタログギフト等）
○ 店の住所と開店日を確認する
○ ネットまたは店舗で注文・手配する
```

## 書籍検索の3段フォールバック

Google Books APIは日本語書籍に弱い。そこで3段階のフォールバックを組んだ。

```
ISBN → OpenBD（日本の書籍DB、無料・無制限）
  ↓ ヒットしない
タイトル → 国立国会図書館 OpenSearch API
  ↓ ヒットしない
タイトル → Open Library API（英語圏）
```

国会図書館APIはXMLで返してくるが、Workers環境には `DOMParser` がないので正規表現でパースしている。助詞を除去するクエリ正規化（「ノルウェイの森」→「ノルウェイ 森」）も入れて検索精度を上げた。

スマホのカメラでバーコードをスキャンしてISBN取得→即検索→登録、という流れも実装済み。

## 生理周期の自動検出

日記テキストから生理開始日を自動検出して周期を予測する。

ポイントは**厳密キーワードマッチング + 除外パターン**。最初は `text LIKE '%生理%'` で雑に拾っていたら、「GoogleFitに生理管理ある」のような無関係な言及が誤検出された。

最終的に「生理始まった」「生理きた」「生理来た」「生理1日目」など開始を示すフレーズに限定し、「生理管理」「生理用品」を除外するルールベースに落ち着いた。NLPで頑張るより、ドメイン知識でルールを書くほうが確実。

## コスト

| サービス | 用途 | 月額 |
|---|---|---|
| Cloudflare Pages + Functions | ホスティング + API | $0 |
| Cloudflare D1 | DB | $0（5GB / 500万読み取り/日） |
| Gemini 2.5 Flash API | AI全般 | $0（無料枠） |
| OpenBD / NDL API / Open Library | 書籍検索 | $0 |
| Google Calendar API | カレンダー | $0 |
| Resend | メール送信 | $0（100通/日） |
| **合計** | | **$0/月** |

独自ドメインを使っても年 $10 程度。

## ハマりどころ

### Gemini 2.5 Flash の thinking tokens が maxOutputTokens を食う

Gemini 2.5 Flash は内部推論（thinking）を行うが、その思考トークンが `maxOutputTokens` の予算を消費する。800トークンに設定していたら、JSON出力が途中で切れてパースに失敗した。

REST API では `thinkingConfig` パラメータが使えない（400エラーになる）。対処法は出力トークンを大きめ（4096）に設定するしかない。加えて、AIの応答からJSONを抽出するときは `` ```json ``` `` のコードブロック抽出に加えて、`indexOf('{')` / `lastIndexOf('}')` のフォールバックも入れておくと安心。

### D1の ALTER TABLE は ADD COLUMN のみ

SQLiteなのでカラムの型変更やリネームができない。開発中に `category` や `parent_id` を後から追加することになったが、`ALTER TABLE todos ADD COLUMN category TEXT DEFAULT NULL` しか手段がない。初期設計は慎重に。

### Workers環境のクセ

- `DOMParser` がない → XMLは正規表現パース
- `toLocaleDateString('ja-JP')` が不安定 → JST は `Date.now() + 9 * 60 * 60 * 1000` で手動計算
- `_middleware.js` はディレクトリ以下の全リクエストにかかる → OAuthコールバックのような外部起点のリクエストは明示的にスキップが必要

## まとめ

Cloudflareの無料枠だけで、21エンドポイント・7テーブルのAI付き個人ダッシュボードが動いている。

設計のポイントは**「記録が先、AIが後」**。まずデータを構造化して蓄積する。その上でAIがデータを横断的に読み取って提案する。構造化されたデータは資産になる。AIが進化しても、SQLiteに入った生活記録は腐らない。

開発の経緯やGAS版との比較は [note](https://note.com/holy_python7310/n/n64fbc93d85c1) に書いているので、興味があればそちらもどうぞ。

---

**技術スタック：** Cloudflare Pages / D1 / Pages Functions / Gemini 2.5 Flash / OpenBD / NDL API / Google Calendar API / Resend / Vanilla JS / PWA
