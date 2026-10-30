ALTER TABLE todos ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE todos SET updated_at = COALESCE((SELECT MAX(changed_at) FROM changes WHERE changes.todo = todos.id), created_at);
ALTER TABLE deleted_todos ADD COLUMN updated_at INTEGER;
UPDATE deleted_todos SET updated_at = COALESCE((SELECT MAX(changed_at) FROM deleted_changes c WHERE c.todo = deleted_todos.id AND c.operation = deleted_todos.operation), created_at);
