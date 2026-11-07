ALTER TABLE todos ADD COLUMN priority TEXT;
ALTER TABLE deleted_todos ADD COLUMN priority TEXT;
-- Preserve pre-priority redo identities by adding the unset priority to each retained target.
UPDATE todo_deletions
SET result = json_set(result, '$.restoredTargets', json((
    SELECT json_group_array(json_insert(value, '$[#]', NULL))
    FROM json_each(todo_deletions.result, '$.restoredTargets')
)))
WHERE json_type(result, '$.restoredTargets') = 'array';
