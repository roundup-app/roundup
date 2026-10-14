-- R16 query attribution: the non-covering index opens nodes even for a missing Terminal.
-- SQLite maintains these receiver facts in the same transaction as every lifecycle write.
DROP INDEX nodes_terminal;
CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL;
