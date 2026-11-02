-- Fresh construction only: existing older Projects are refused before any suffix runs.
-- Current publications retain files; no runtime hook reads a historical BLOB allocation.
DROP TRIGGER deliverable_file_exclusive;
DROP TRIGGER deliverable_blob_exclusive;
DROP TRIGGER deliverable_blob_identity;
DROP TABLE deliverable_bytes;
