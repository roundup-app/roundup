-- Source incarnations outlive names and rows; AUTOINCREMENT never reuses a committed id.
CREATE TABLE pad_sources (
    incarnation INTEGER PRIMARY KEY AUTOINCREMENT,
    pad_key TEXT UNIQUE,
    deletion TEXT CHECK (deletion IN ('user', 'owner', 'cleanup')),
    CHECK ((pad_key IS NOT NULL AND deletion IS NULL)
        OR (pad_key IS NULL AND deletion IS NOT NULL))
);

INSERT INTO pad_sources(pad_key) SELECT key FROM pads ORDER BY key;

CREATE TRIGGER pad_source_created AFTER INSERT ON pads BEGIN
    INSERT INTO pad_sources(pad_key) VALUES (NEW.key);
END;

-- Explicit deletion records its cause before removing the row. Coordinated Workstream
-- cleanup deletes rows directly and must never acquire the user's revocation cause.
CREATE TRIGGER pad_source_removed AFTER DELETE ON pads BEGIN
    UPDATE pad_sources SET pad_key = NULL, deletion = 'cleanup' WHERE pad_key = OLD.key;
END;
