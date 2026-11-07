-- B3692b: a store made before native questions holds bubbling questions the Daemon no longer passes
-- up the Rail. A pending hop and a held question of the removed kind are never delivered to anyone.
UPDATE messages SET status = 'dropped', reason = 'not accepted'
 WHERE (status = 'pending' AND passed_from IS NOT NULL) OR (status = 'held' AND reason NOT IN ('ask-first', 'takeover', 'inbox'));
UPDATE messages SET reason = 'not accepted' WHERE reason = 'passed';
DROP TABLE IF EXISTS chains;
