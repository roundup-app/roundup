-- P7499a: whether the Pads tab folds the Pad; a Pad stored before this reads shown.
ALTER TABLE pads ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shown';
