-- T7708a: the pull request a Todo links, and T7708c the merge (PR number and its mergedAt) that
-- last completed it, so a reopened Todo is not closed again by the same merge.
ALTER TABLE todos ADD COLUMN pr INTEGER;
ALTER TABLE todos ADD COLUMN merge_pr INTEGER;
ALTER TABLE todos ADD COLUMN merged_at TEXT;
