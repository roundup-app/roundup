-- Publication metadata is separate from payloads so discovery never reads retained bytes.
CREATE TABLE deliverable_project (id TEXT PRIMARY KEY NOT NULL);
INSERT INTO deliverable_project VALUES (lower(hex(randomblob(16))));
CREATE TABLE deliverables (
    id TEXT PRIMARY KEY NOT NULL,
    maker TEXT NOT NULL,
    publication_key TEXT NOT NULL,
    request TEXT NOT NULL,
    record TEXT NOT NULL,
    home TEXT,
    file_source TEXT,
    access_revoked INTEGER NOT NULL DEFAULT 0,
    user_placed INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0,
    UNIQUE(maker, publication_key)
);
CREATE TABLE deliverable_bytes (
    id TEXT PRIMARY KEY NOT NULL REFERENCES deliverables(id),
    bytes BLOB NOT NULL
);
