CREATE TABLE decision_answers (
    seq INTEGER PRIMARY KEY,
    decision TEXT NOT NULL UNIQUE,
    agent TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    record TEXT NOT NULL
);
CREATE INDEX decision_answers_agent ON decision_answers(agent, seq);
