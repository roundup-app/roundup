-- NR3: a standalone store's copy of the Project database's reactions and firings (rupd 0008, 0009).
CREATE TABLE reactions (
    id TEXT PRIMARY KEY NOT NULL,
    actor_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    request TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE(actor_key, operation)
);
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
