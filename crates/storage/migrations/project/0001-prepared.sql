CREATE TABLE IF NOT EXISTS prepared_config (
    id INTEGER PRIMARY KEY CHECK (id = 0),
    readiness TEXT,
    timeout_ms INTEGER,
    setup TEXT
);

CREATE TABLE IF NOT EXISTS prepared_dirs (
    path TEXT PRIMARY KEY,
    ord INTEGER NOT NULL,
    unavailable TEXT
);
