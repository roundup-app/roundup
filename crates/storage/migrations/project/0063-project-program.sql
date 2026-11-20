-- PG1, PG3: the Project's one program as JSON `{argv, dir}` (null names none), and whether the
-- user stopped it, which holds across a Daemon restart.
ALTER TABLE settings ADD COLUMN program TEXT;
ALTER TABLE settings ADD COLUMN program_stopped INTEGER NOT NULL DEFAULT 0;
