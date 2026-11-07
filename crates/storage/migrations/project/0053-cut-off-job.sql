-- DCR1: a Job a quit ended mid-turn; only such a Job resumes for an Agent without a mode.
ALTER TABLE nodes ADD COLUMN cut_off INTEGER NOT NULL DEFAULT 0;
