-- NR3: an accepted firing, written in the same transaction as its Message. `definition` and `evidence`
-- are the bytes accepted and never change; `matched` is 0 for an explicit run, which claims no condition.
CREATE TABLE reaction_firings (
    id TEXT PRIMARY KEY NOT NULL,
    reaction TEXT NOT NULL REFERENCES reactions(id),
    operation TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    message INTEGER NOT NULL,
    matched INTEGER NOT NULL,
    definition TEXT NOT NULL,
    evidence TEXT NOT NULL,
    UNIQUE(reaction, operation),
    UNIQUE(reaction, ordinal)
);
