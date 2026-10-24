-- U3016m: roundup keeps no token or money. Request and money facts go with the table that
-- attributed them; the facts that remain are time, so a reopened Project reads the same time.
DROP TABLE measurement_request_attempts;
DROP TRIGGER measurement_remember_erasure;
DELETE FROM measurement_revisions WHERE json_extract(value, '$.kind') IN ('request', 'money');
CREATE TRIGGER measurement_remember_erasure BEFORE DELETE ON measurement_revisions
BEGIN INSERT OR IGNORE INTO measurement_erased(identity) VALUES(OLD.identity); END;
