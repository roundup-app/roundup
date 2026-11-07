-- A3195, A3197: the Project's Workstream cap and its Queue, stored with the Project.
ALTER TABLE settings ADD COLUMN workstream_cap INTEGER;
CREATE TABLE workstream_queue (
    workstream INTEGER PRIMARY KEY NOT NULL,
    ord INTEGER NOT NULL,
    after_todo INTEGER,
    failure_code INTEGER,
    failure_message TEXT
);
