ALTER TABLE nodes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shown' CHECK (visibility IN ('shown','internal'));
ALTER TABLE nodes ADD COLUMN start_attribution TEXT;
