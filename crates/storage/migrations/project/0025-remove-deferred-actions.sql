-- B3563e: Door actions no longer wait, so one a store made before still holds as waiting or
-- started will never run. It gets a terminal outcome saying why; its earlier outcomes and every
-- completed one stay as they were.
INSERT INTO door_action_outcomes(action, outcome)
SELECT a.id, '{"status":"dropped","reason":"deferred execution was removed"}'
  FROM door_actions a
 WHERE COALESCE(json_extract(
         (SELECT o.outcome FROM door_action_outcomes o WHERE o.action = a.id ORDER BY o.seq DESC LIMIT 1),
         '$.status'), 'waiting') IN ('waiting', 'in-progress');
