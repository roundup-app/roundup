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

-- R16 query attribution: the non-covering index opens nodes even for a missing Terminal.
-- SQLite maintains these receiver facts in the same transaction as every lifecycle write.
DROP INDEX nodes_terminal;
CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS pads (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    home TEXT
);

CREATE TABLE IF NOT EXISTS pad_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_actor TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    reply_to INTEGER,
    status TEXT NOT NULL,
    reason TEXT,
    at INTEGER NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    receiver_attempt INTEGER NOT NULL DEFAULT 0,
    receiver_revision INTEGER NOT NULL DEFAULT 0,
    passed_from INTEGER
);

CREATE TABLE IF NOT EXISTS message_retirements (
    agent TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS message_restarts (
    agent TEXT NOT NULL,
    key TEXT NOT NULL,
    before INTEGER NOT NULL,
    prompt TEXT,
    note INTEGER,
    released INTEGER,
    published INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(agent, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_message_restart ON message_restarts(agent) WHERE released IS NULL;

CREATE VIEW IF NOT EXISTS message_protection AS
    SELECT agent FROM message_restarts WHERE released IS NULL
    UNION SELECT agent FROM message_retirements;

CREATE TABLE IF NOT EXISTS routes (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    delivery TEXT NOT NULL,
    set_by TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS chains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    body TEXT NOT NULL,
    rest TEXT NOT NULL,
    current INTEGER NOT NULL,
    armed_at INTEGER,
    done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS iterations (
    door TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    upto INTEGER NOT NULL,
    PRIMARY KEY (door, iteration)
);

CREATE TABLE IF NOT EXISTS receiver_generations (
    id TEXT PRIMARY KEY,
    attempt INTEGER NOT NULL,
    closed INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    closed_revision INTEGER NOT NULL DEFAULT -1
);

CREATE TABLE IF NOT EXISTS pad_cursors (
    door TEXT NOT NULL,
    child TEXT NOT NULL,
    newest INTEGER NOT NULL,
    PRIMARY KEY (door, child)
);

CREATE TABLE IF NOT EXISTS checkpoints (
    workstream TEXT NOT NULL,
    id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    title TEXT NOT NULL,
    blocks TEXT NOT NULL,
    PRIMARY KEY (workstream, id)
);

CREATE TABLE IF NOT EXISTS marks (
    workstream TEXT NOT NULL,
    checkpoint INTEGER NOT NULL,
    iteration INTEGER NOT NULL,
    usable INTEGER NOT NULL DEFAULT 1,
    content TEXT NOT NULL,
    PRIMARY KEY (workstream, checkpoint)
);
