ALTER TABLE nodes RENAME COLUMN opening_prompt TO mode_prompt;

UPDATE nodes
SET kind = 'agent', auto = 0, work = NULL
WHERE kind = 'workstream' AND mode_prompt IS NOT NULL;
