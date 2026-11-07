CREATE TABLE ask_submissions (
    submission TEXT PRIMARY KEY NOT NULL,
    ask TEXT NOT NULL UNIQUE REFERENCES asks(id),
    workstream TEXT
);
