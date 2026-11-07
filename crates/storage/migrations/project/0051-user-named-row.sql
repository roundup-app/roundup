-- U6380c: a row the user named keeps its name against every automatic rename.
ALTER TABLE nodes ADD COLUMN user_named INTEGER NOT NULL DEFAULT 0;
