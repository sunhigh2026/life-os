-- Phase 2: チャット履歴テーブル（スライディングウィンドウ用）
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,        -- 'user' / 'assistant'
  content TEXT NOT NULL,
  model TEXT,                -- 使用モデル（assistantメッセージのみ）
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);

-- Phase 3-4: エンベディング管理テーブル（バックフィル・重複防止）
CREATE TABLE IF NOT EXISTS embedding_log (
  source_type TEXT NOT NULL,  -- 'entry' / 'chat' / 'book_note'
  source_id TEXT NOT NULL,
  embedded_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (source_type, source_id)
);
