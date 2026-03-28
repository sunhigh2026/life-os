-- Google Fit API 直接連携用カラム追加
ALTER TABLE fitness ADD COLUMN calories INTEGER;
ALTER TABLE fitness ADD COLUMN sleep_minutes INTEGER;
ALTER TABLE fitness ADD COLUMN raw_json TEXT;
ALTER TABLE fitness ADD COLUMN synced_at TEXT;
