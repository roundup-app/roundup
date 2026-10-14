CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    parent INTEGER REFERENCES nodes(id),
    ord INTEGER NOT NULL,
    meta INTEGER NOT NULL DEFAULT 0,
    terminal_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    worktree_owner TEXT,
    worktree_commit TEXT,
    worktree_path TEXT,
    worktree_branch TEXT,
    worktree_base TEXT,
    worktree_state TEXT,
    conversation_id TEXT,
    conversation_cwd TEXT,
    work TEXT,
    spawn_prompt TEXT,
    creator TEXT,
    spawner TEXT,
    model TEXT,
    effort TEXT,
    iteration INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 0),
    worktrees_on INTEGER NOT NULL DEFAULT 0,
    worktrees_check TEXT
);

CREATE TABLE IF NOT EXISTS role_models (
    role TEXT PRIMARY KEY,
    model TEXT,
    effort TEXT
);

CREATE TABLE IF NOT EXISTS allowed_models (
    ord INTEGER PRIMARY KEY,
    model TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS nodes_terminal ON nodes(terminal_id);
