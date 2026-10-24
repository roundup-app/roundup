-- A3564d: a Project made before native questions holds Decision data the Daemon no longer reads.
DROP TABLE IF EXISTS decision_answers;
DELETE FROM measurement_revisions WHERE json_extract(value, '$.activity.kind') = 'decision';
UPDATE measurement_state SET revision = revision + 1;
DELETE FROM events WHERE json_extract(event, '$.name') IN ('decision.opened', 'decision.cleared');
