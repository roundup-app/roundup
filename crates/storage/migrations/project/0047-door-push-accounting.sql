-- DCL8: what each Door was told and the pushes kept back for it, so a restart loses neither.
CREATE TABLE IF NOT EXISTS door_told (
    door TEXT NOT NULL,
    child TEXT NOT NULL,
    told TEXT NOT NULL,
    PRIMARY KEY (door, child)
);
CREATE TABLE IF NOT EXISTS push_slots (
    door TEXT PRIMARY KEY NOT NULL,
    slot TEXT NOT NULL
);
