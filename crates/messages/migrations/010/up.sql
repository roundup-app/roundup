DROP TABLE reaction_firings;
DROP TABLE reactions;
CREATE TABLE IF NOT EXISTS push_slots (
    door TEXT PRIMARY KEY NOT NULL,
    slot TEXT NOT NULL
);
