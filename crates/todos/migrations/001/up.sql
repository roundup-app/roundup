CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    creator TEXT NOT NULL DEFAULT '{"kind":"user","id":"you","parent":null}',
    home TEXT,
    pos INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS blockers (
    todo INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    blocker INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    PRIMARY KEY (todo, blocker)
);

CREATE TABLE IF NOT EXISTS changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    todo INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    before_values TEXT,
    after_values TEXT NOT NULL,
    after_touch INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS changes_todo ON changes(todo, seq);
