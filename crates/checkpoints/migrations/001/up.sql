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
