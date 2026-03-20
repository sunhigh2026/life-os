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

-- フィットネス（歩数・運動時間・体重）
CREATE TABLE IF NOT EXISTS fitness (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  steps INTEGER,
  active_minutes INTEGER,
  weight REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_entries_datetime ON entries(datetime);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due);
CREATE INDEX IF NOT EXISTS idx_books_datetime ON books(datetime);
CREATE INDEX IF NOT EXISTS idx_book_notes_book_id ON book_notes(book_id);
CREATE INDEX IF NOT EXISTS idx_fitness_date ON fitness(date);
