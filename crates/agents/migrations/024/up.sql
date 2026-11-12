-- MC13: the Machine an Agent runs on, an ssh name; null runs on this Mac.
ALTER TABLE nodes ADD COLUMN machine TEXT;
