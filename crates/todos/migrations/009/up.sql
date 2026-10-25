CREATE TABLE IF NOT EXISTS todo_deletions (
    operation TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    chosen TEXT NOT NULL,
    result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted_todos AS SELECT CAST(NULL AS TEXT) AS operation, * FROM todos WHERE 0;
CREATE TABLE IF NOT EXISTS deleted_blockers AS SELECT CAST(NULL AS TEXT) AS operation, * FROM blockers WHERE 0;
CREATE TABLE IF NOT EXISTS deleted_changes AS SELECT CAST(NULL AS TEXT) AS operation, * FROM changes WHERE 0;
CREATE TABLE IF NOT EXISTS deleted_comments AS SELECT CAST(NULL AS TEXT) AS operation, * FROM comments WHERE 0;
CREATE TABLE IF NOT EXISTS deleted_refs AS SELECT CAST(NULL AS TEXT) AS operation, * FROM todo_refs WHERE 0;
CREATE INDEX IF NOT EXISTS deleted_todos_operation ON deleted_todos(operation);
CREATE INDEX IF NOT EXISTS deleted_blockers_operation ON deleted_blockers(operation);
CREATE INDEX IF NOT EXISTS deleted_changes_operation ON deleted_changes(operation);
CREATE INDEX IF NOT EXISTS deleted_comments_operation ON deleted_comments(operation);
CREATE INDEX IF NOT EXISTS deleted_refs_operation ON deleted_refs(operation);
