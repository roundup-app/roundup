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
