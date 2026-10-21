-- `matched` already distinguishes automatic acceptances from explicit runs in persisted rows.
-- Copy every accepted byte and identity; qualifying retry keys must not rewrite historical evidence.
CREATE TABLE reaction_firings_scoped (
    id TEXT PRIMARY KEY NOT NULL,
    reaction TEXT NOT NULL REFERENCES reactions(id),
    operation TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    message INTEGER NOT NULL,
    matched INTEGER NOT NULL,
    definition TEXT NOT NULL,
    evidence TEXT NOT NULL,
    UNIQUE(reaction, matched, operation),
    UNIQUE(reaction, ordinal)
);
INSERT INTO reaction_firings_scoped
    (id, reaction, operation, ordinal, message, matched, definition, evidence)
SELECT id, reaction, operation, ordinal, message, matched, definition, evidence
FROM reaction_firings;
DROP TABLE reaction_firings;
ALTER TABLE reaction_firings_scoped RENAME TO reaction_firings;
