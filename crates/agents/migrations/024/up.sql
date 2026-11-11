-- A4452c: a Mode is a root Agent carrying its saved Mode prompt, never a Workstream. A saved Mode
-- row converts in place: its id, Home, prompt bytes and nested Agents stay; its Door order goes.
ALTER TABLE nodes RENAME COLUMN opening_prompt TO mode_prompt;

UPDATE nodes
SET kind = 'agent', auto = 0, work = NULL
WHERE kind = 'workstream' AND mode_prompt IS NOT NULL;
