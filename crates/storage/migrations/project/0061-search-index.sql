-- C7707c, C7707d: the words of Messages, Pads and Todos, kept by triggers in the transaction of each write.
-- Messages and Todos have an integer key the index follows; a Pad has none VACUUM keeps, so its index holds its own copy.
CREATE VIRTUAL TABLE todos_fts USING fts5(title, body, content='todos', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER todos_fts_insert AFTER INSERT ON todos BEGIN
    INSERT INTO todos_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER todos_fts_delete AFTER DELETE ON todos BEGIN
    INSERT INTO todos_fts(todos_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER todos_fts_update AFTER UPDATE OF title, body ON todos BEGIN
    INSERT INTO todos_fts(todos_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO todos_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
INSERT INTO todos_fts(todos_fts) VALUES ('rebuild');

CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER messages_fts_update AFTER UPDATE OF body ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
    INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');

CREATE VIRTUAL TABLE pads_fts USING fts5(name, text, key UNINDEXED, tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER pads_fts_insert AFTER INSERT ON pads BEGIN
    INSERT INTO pads_fts(name, text, key) VALUES (new.name, new.text, new.key);
END;
CREATE TRIGGER pads_fts_delete AFTER DELETE ON pads BEGIN
    DELETE FROM pads_fts WHERE key = old.key;
END;
CREATE TRIGGER pads_fts_update AFTER UPDATE OF key, name, text ON pads BEGIN
    DELETE FROM pads_fts WHERE key = old.key;
    INSERT INTO pads_fts(name, text, key) VALUES (new.name, new.text, new.key);
END;
INSERT INTO pads_fts(name, text, key) SELECT name, text, key FROM pads;
