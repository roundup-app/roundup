CREATE TABLE todo_deletions (
    operation TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    chosen TEXT NOT NULL,
    result TEXT NOT NULL
);
CREATE TABLE deleted_todos AS SELECT CAST(NULL AS TEXT) AS operation, * FROM todos WHERE 0;
CREATE TABLE deleted_blockers AS SELECT CAST(NULL AS TEXT) AS operation, * FROM blockers WHERE 0;
CREATE TABLE deleted_changes AS SELECT CAST(NULL AS TEXT) AS operation, * FROM changes WHERE 0;
CREATE TABLE deleted_comments AS SELECT CAST(NULL AS TEXT) AS operation, * FROM comments WHERE 0;
CREATE TABLE deleted_refs AS SELECT CAST(NULL AS TEXT) AS operation, * FROM todo_refs WHERE 0;
CREATE INDEX deleted_todos_operation ON deleted_todos(operation);
CREATE INDEX deleted_blockers_operation ON deleted_blockers(operation);
CREATE INDEX deleted_changes_operation ON deleted_changes(operation);
CREATE INDEX deleted_comments_operation ON deleted_comments(operation);
CREATE INDEX deleted_refs_operation ON deleted_refs(operation);
