CREATE TABLE message_results (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    request_key TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE(agent, request_key)
);
CREATE TABLE message_result_facts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    report TEXT NOT NULL,
    kind TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE(report, kind, record)
);
