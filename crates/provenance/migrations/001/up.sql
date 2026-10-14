CREATE TABLE IF NOT EXISTS touches (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_parent TEXT,
    verb TEXT NOT NULL,
    item TEXT NOT NULL,
    at INTEGER NOT NULL,
    todo_revision INTEGER
);

CREATE INDEX IF NOT EXISTS touches_item ON touches(item, seq);

CREATE INDEX IF NOT EXISTS touches_actor ON touches(actor_id, seq);
