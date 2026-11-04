CREATE TABLE IF NOT EXISTS pad_cursors (
    door TEXT NOT NULL,
    child TEXT NOT NULL,
    newest INTEGER NOT NULL,
    PRIMARY KEY (door, child)
);
CREATE TABLE IF NOT EXISTS door_told (
    door TEXT NOT NULL,
    child TEXT NOT NULL,
    told TEXT NOT NULL,
    PRIMARY KEY (door, child)
);
