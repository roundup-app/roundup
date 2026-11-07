CREATE TABLE resize_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    agent TEXT NOT NULL,
    attempt TEXT,
    child_terminal TEXT,
    terminal TEXT NOT NULL,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL
);
CREATE TABLE resize_outcomes (
    seq INTEGER PRIMARY KEY,
    action INTEGER NOT NULL REFERENCES resize_actions(id),
    outcome TEXT NOT NULL
);
CREATE INDEX resize_outcomes_action ON resize_outcomes(action, seq);
