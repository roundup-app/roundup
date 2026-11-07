CREATE TABLE continuation_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    agent TEXT NOT NULL,
    request TEXT NOT NULL,
    payload TEXT NOT NULL,
    message INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    UNIQUE(agent, request)
);
CREATE TABLE continuation_actions (
    action TEXT PRIMARY KEY NOT NULL,
    decision TEXT NOT NULL REFERENCES continuation_decisions(id)
);
