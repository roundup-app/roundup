-- NR1: saved reaction definitions. `record` is the definition as accepted; stopping rewrites its state only.
CREATE TABLE reaction_project (id TEXT PRIMARY KEY NOT NULL);
INSERT INTO reaction_project VALUES (lower(hex(randomblob(16))));
CREATE TABLE reactions (
    id TEXT PRIMARY KEY NOT NULL,
    actor_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    request TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE(actor_key, operation)
);
