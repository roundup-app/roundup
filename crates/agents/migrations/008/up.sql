-- No foreign keys: published source identities survive explicit Rail removal.
CREATE TABLE closed_sources (
    source TEXT PRIMARY KEY NOT NULL,
    workstream INTEGER NOT NULL UNIQUE,
    agent INTEGER NOT NULL UNIQUE,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    copy BLOB,
    refusal TEXT
);
