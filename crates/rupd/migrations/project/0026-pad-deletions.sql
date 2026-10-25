-- Standalone Pad stores use the same Project identity contract as project.db.
CREATE TABLE IF NOT EXISTS deliverable_project (id TEXT PRIMARY KEY NOT NULL);
INSERT INTO deliverable_project SELECT lower(hex(randomblob(16))) WHERE NOT EXISTS (SELECT 1 FROM deliverable_project);
CREATE TABLE pad_deletions (
    operation TEXT PRIMARY KEY NOT NULL,
    actor TEXT NOT NULL,
    request TEXT NOT NULL,
    record TEXT NOT NULL,
    incarnation INTEGER NOT NULL,
    pad_key TEXT NOT NULL,
    restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1))
);
ALTER TABLE pad_sources ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1));
-- A restore reconnects the retained source before inserting its row. Normal creation
-- still allocates exactly one new incarnation; a restored source never allocates one.
DROP TRIGGER pad_source_created;
CREATE TRIGGER pad_source_created AFTER INSERT ON pads
WHEN NOT EXISTS (SELECT 1 FROM pad_sources WHERE pad_key=NEW.key) BEGIN
    INSERT INTO pad_sources(pad_key) VALUES(NEW.key);
END;
