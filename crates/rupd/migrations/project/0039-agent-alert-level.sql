ALTER TABLE nodes ADD COLUMN alert_level TEXT NOT NULL DEFAULT '"default"' CHECK (alert_level IN ('"default"', '"all"', '"quiet"'));
