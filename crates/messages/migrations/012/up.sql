-- DCL4: a change a Door was told and that is not yet in the push ledger. Written with its told row,
-- removed in the ledger's own transaction, so a kill between the two loses and repeats nothing.
CREATE TABLE IF NOT EXISTS push_intents (
    door TEXT NOT NULL,
    child TEXT NOT NULL,
    entry TEXT NOT NULL,
    weight INTEGER NOT NULL,
    PRIMARY KEY (door, child)
);
