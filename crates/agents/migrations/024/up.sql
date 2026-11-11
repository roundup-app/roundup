-- A4452c: a Mode is a root Agent carrying its saved prompt, never a Workstream. A saved Mode row
-- converts in place: its id, prompt bytes, conversation and nested Agents stay as they were.
UPDATE nodes SET kind='agent', auto=0 WHERE kind='workstream' AND parent IS NULL AND opening_prompt IS NOT NULL;
UPDATE nodes SET opening_prompt=NULL WHERE kind='workstream' AND opening_prompt IS NOT NULL;
