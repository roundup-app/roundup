-- Legacy BLOBs remain in place. Each identity selects at most one allocation.
CREATE TABLE deliverable_files (
    id TEXT PRIMARY KEY NOT NULL REFERENCES deliverables(id),
    length INTEGER NOT NULL CHECK(length >= 0 AND length <= 33554432)
);
CREATE TRIGGER deliverable_file_exclusive BEFORE INSERT ON deliverable_files
WHEN EXISTS(SELECT 1 FROM deliverable_bytes WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'publication already retains a BLOB'); END;
CREATE TRIGGER deliverable_blob_exclusive BEFORE INSERT ON deliverable_bytes
WHEN EXISTS(SELECT 1 FROM deliverable_files WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'publication already retains a file'); END;
CREATE TRIGGER deliverable_file_identity BEFORE UPDATE OF id ON deliverable_files
BEGIN SELECT RAISE(ABORT, 'publication allocation identity is immutable'); END;
CREATE TRIGGER deliverable_blob_identity BEFORE UPDATE OF id ON deliverable_bytes
BEGIN SELECT RAISE(ABORT, 'publication allocation identity is immutable'); END;
