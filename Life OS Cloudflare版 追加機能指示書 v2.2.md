



**前提**: 日記、ToDo、読書記録、AIチャットは実装済み

---

## 追加機能（確定）

### Phase A: ピアちゃんキャラ設定

チャットのAI応答にキャラクター設定を適用する。

名前: ピアちゃん。見た目: もちもちしたピンクのゆるキャラ。性格: のんびり、ポジティブ、さりげなく鋭い。

Geminiシステムプロンプト:

```
あなたは「ピアちゃん」というキャラクターです。
見た目はもちもちしたピンクのゆるキャラ。
性格はのんびりしているけど、実はよく見ている。
口調は「〜だよ」「〜だね」「〜かも！」。
褒めるときは「すごいじゃん！」「がんばったね〜！」としっかり褒める。
気になる点は「ちょっと気になったんだけど〜」とやさしく切り出す。
絶対に説教しない。短めに話す。絵文字を適度に使う。
ユーザーの日記・ToDo・読書データにアクセスできる。
データに基づいた具体的なアドバイスをする。
```

D1のsettingsテーブルに保存し、後でキャラ名・口調を変更可能にする。

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

チャット画面のヘッダーにピアちゃんアイコン（icon-pia.png）を表示。週次レポートのコメントもピアちゃん口調で生成。

---

### Phase B: Googleカレンダー連携（読み取り専用）

アプリからの予定登録はしない。カレンダーの予定を読み取って表示・AI分析に使うのみ。

Google Calendar API + OAuth 2.0でユーザーのカレンダーにアクセス。初回にGoogleログインで認証し、リフレッシュトークンをD1のsettingsテーブルに保存。

環境変数: GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET。

APIエンドポイント: GET /api/calendar/auth（認証URL返却）、GET /api/calendar/callback（トークン保存）、GET /api/calendar/today（今日の予定）、GET /api/calendar/tomorrow（明日の予定）、GET /api/calendar/week（今週の予定）。

Homeダッシュボードに「今日の予定」セクションを追加。チャットで「明日の予定は？」に対応。

---

### Phase C: ToDoタブAI整理

ToDoタブを開いた時にAIがタスクを整理・提案する。

表示セクション: ①AIおすすめ（ピアちゃんが今日やるべきタスクを3〜5件提案、カレンダー予定も考慮）、②期限超過（赤表示）、③今週やること、④来週以降、⑤いつかやる（期限なし）、⑥完了済み（直近10件）。

APIエンドポイント: GET /api/todo/ai-suggest（AIおすすめ）、GET /api/todo?group=true（グループ分け取得）。

---

### Phase D: 生理周期の自動検出・予測

専用UIは作らない。日記テキストに「生理」「生理開始」「生理きた」等が含まれていたらAIが自動検出。

GET /api/menstrual-stats エンドポイントを新設。entriesテーブルから「生理」を含む日記を抽出し、日付間隔の中央値から平均周期と次回予測日を算出。記録3回以上で予測有効。

Homeダッシュボードに「次回予測: 4/15頃」と小さく表示。チャットで「次の生理いつ？」に対応。

---

### Phase E: 週次レポート

Cron Trigger（毎週日曜 UTC 0:00 = JST 9:00）で自動実行。

D1から過去7日分を取得（entries, todos, books）+ Googleカレンダーの予定数。統計算出（日記数、ToDo完了数/残数/期限超過数、読書数、平均mood、予定数）→ Geminiでピアちゃん口調のコメント生成 → HTMLメール送信（Resend API）。

wrangler.toml追加: `crons = ["0 0 * * 0"]`。環境変数追加: RESEND_API_KEY、REPORT_EMAIL。

## Phase E（追加）: フィットネスデータ取り込み

Phase Eを追加し、以降のPhaseを繰り下げます。

### 概要

ユーザーは手動入力しない。Health Connect対応アプリ（Health Sync等）でGoogle Sheetsに自動出力されたデータをCSV/JSONでインポートする。または Google Takeoutのフィットネスデータをインポート。取得項目は歩数と運動時間（アクティブ分）のみ。

### D1テーブル

```sql
CopyCREATE TABLE IF NOT EXISTS fitness (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  steps INTEGER,
  active_minutes INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fitness_date ON fitness(date);
```

### APIエンドポイント

- POST /api/fitness/import → CSV/JSONを受け取りD1に一括挿入（date重複時はUPDATE）
- GET /api/fitness?days=30 → 直近N日分取得

### UI

Homeダッシュボードに「今日の歩数」「運動時間」を小さく表示（データがある日のみ）。設定画面にCSVインポートボタンを配置。

### AI連携

チャットで「今週どれくらい歩いた？」「運動足りてる？」に対応。ピアちゃんが歩数データを見て「今週ちょっと少なめかも〜散歩いこ！もち」のようにアドバイス。

週次レポートに平均歩数・運動時間を含める。mood×歩数のクロス分析にも使用。

---

### Phase F: 目標管理

goalsテーブルを活用。Homeダッシュボードに「目標」セクション追加。

入力: 目標テキスト、種別（習慣/達成/プロジェクト）、数値目標、単位、頻度、期限。表示: 進捗バー付きカード。既存データから自動計算（例: 「月4冊」→ booksから今月の数をカウント）。

APIエンドポイント: POST/GET/PUT /api/goal。

---

### Phase G: データエクスポート

全テーブルをCSV/JSONでダウンロード。設定画面にエクスポートボタン配置。

APIエンドポイント: GET /api/export?table=entries&format=csv（対応テーブル: entries, todos, books, book_notes, goals）。

---

### Phase H: AIクロス分析強化

チャットのGeminiプロンプトを強化し、全データ横断分析を可能にする。

分析パターン: mood×曜日、mood×カレンダー予定数、読書量×mood、タスク完了率×曜日、生理周期×mood。

チャットのプリセットボタン追加: 「月間分析」「mood傾向」「読書の振り返り」。

---

### Phase I: Audibleインポート

Chrome拡張「Audible Library Extractor」のCSVをbooksテーブルにインポート。medium列を「Audible」に自動設定。ISBN重複除外。

APIエンドポイント: POST /api/book/import。

---

### Phase J: 年末レポート

12月最終週にCron Triggerで年間統計をGeminiで分析し、ピアちゃんコメント付きメールを送信。Phase Eの仕組みを流用。

---

## 実装順序
|Phase|機能|工数|
|---|---|---|
|A|ピアちゃんキャラ設定|小|
|B|Googleカレンダー連携|中|
|C|ToDoタブAI整理|中|
|D|生理周期自動検出|小|
|**E**|**フィットネスデータ取り込み**|**小**|
|F|週次レポート|中|
|G|目標管理|中|
|H|データエクスポート|小|
|I|AIクロス分析強化|中|
|J|Audibleインポート|小|
|K|年末レポート|小|


---

## 削除した機能（不要と判断）

位置情報取り込み（Google Timeline）、家計データ取り込み（Zaim/Money Forward）。

---

## 注意事項

- 既存の日記/ToDo/読書/チャット機能は変更しない
- Googleカレンダーは読み取り専用
- 生理記録は日記テキストからの自動検出のみ（専用UI不要）
- ピアちゃんの設定はsettingsテーブルから読み込み変更可能
- 全データはD1に保存しチャットのGeminiから参照可能にする

---

すっきりしましたね。日記・ToDo・読書がコアで、カレンダー連携とAI分析が味付け。