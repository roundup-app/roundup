-- A3308: old Workstreams start with Auto off.
ALTER TABLE nodes ADD COLUMN auto INTEGER NOT NULL DEFAULT 0 CHECK (auto IN (0, 1));
