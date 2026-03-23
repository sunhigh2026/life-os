-- ToDoに開始日カラムを追加（開始日まで「やること」に表示しない）
ALTER TABLE todos ADD COLUMN start_date TEXT DEFAULT NULL;
