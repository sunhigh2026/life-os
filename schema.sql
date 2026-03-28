-- 日記
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  datetime TEXT NOT NULL,
  mood INTEGER,
  tag TEXT,
  text TEXT,
  photo_url TEXT,
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
  category TEXT DEFAULT NULL,
  parent_id TEXT DEFAULT NULL,
  start_date TEXT DEFAULT NULL,
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
  tag TEXT,
  end_date TEXT,
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
  memo TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 設定（キャラクター設定等）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- フィットネス（歩数・運動時間・体重・カロリー・睡眠）
CREATE TABLE IF NOT EXISTS fitness (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  steps INTEGER,
  active_minutes INTEGER,
  calories INTEGER,
  weight REAL,
  sleep_minutes INTEGER,
  raw_json TEXT,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- インポート履歴（削除済みASINの再取込防止）
CREATE TABLE IF NOT EXISTS book_import_log (
  asin TEXT PRIMARY KEY,
  imported_at TEXT DEFAULT (datetime('now'))
);

-- チャット履歴（スライディングウィンドウ + RAGエンベディング対象）
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,        -- 'user' / 'assistant'
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- エンベディング管理（バックフィル追跡・重複防止）
CREATE TABLE IF NOT EXISTS embedding_log (
  source_type TEXT NOT NULL,  -- 'entry' / 'chat' / 'book_note'
  source_id TEXT NOT NULL,
  embedded_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (source_type, source_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_entries_datetime ON entries(datetime);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due);
CREATE INDEX IF NOT EXISTS idx_books_datetime ON books(datetime);
CREATE INDEX IF NOT EXISTS idx_book_notes_book_id ON book_notes(book_id);
CREATE INDEX IF NOT EXISTS idx_fitness_date ON fitness(date);
CREATE INDEX IF NOT EXISTS idx_todos_parent_id ON todos(parent_id);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
