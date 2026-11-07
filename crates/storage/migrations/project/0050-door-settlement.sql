-- DCL6: per Door, the child-change marker its last settled note answered and the one being published,
-- so a crash between the two neither loses nor repeats a settled note.
CREATE TABLE IF NOT EXISTS door_settlement (
    door TEXT PRIMARY KEY NOT NULL,
    settled TEXT,
    publishing TEXT
);
