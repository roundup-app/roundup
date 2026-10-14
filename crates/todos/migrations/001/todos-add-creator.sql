ALTER TABLE todos ADD COLUMN creator TEXT NOT NULL DEFAULT '{"kind":"user","id":"you","parent":null}';
