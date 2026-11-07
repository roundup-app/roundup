-- DCL9: each Subagent's role. Existing Subagents migrate as Jobs with their retained order; no completed Job is inferred.
ALTER TABLE nodes ADD COLUMN role TEXT CHECK (role IN ('job','consult'));
UPDATE nodes SET role = 'job' WHERE kind = 'agent' AND spawner IS NOT NULL;
