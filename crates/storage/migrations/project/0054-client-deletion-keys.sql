-- P9b: a client's deletion key lives under `client:`. Receipts stored before that keep their
-- bare client key unless the Daemon named it: a Rail participant or a fresh 32-hex retention key.
UPDATE pad_deletions SET operation = 'client:' || operation
WHERE operation NOT LIKE 'client:%'
  AND NOT (length(operation) = 32 AND operation NOT GLOB '*[^0-9a-f]*')
  AND operation NOT IN (SELECT participant FROM rail_removal_items WHERE participant IS NOT NULL);
