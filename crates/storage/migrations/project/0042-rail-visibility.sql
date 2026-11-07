ALTER TABLE nodes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shown' CHECK (visibility IN ('shown','internal'));
