-- A4452c: the user's saved opening prompt of a Workstream.
ALTER TABLE nodes ADD COLUMN opening_prompt TEXT;
-- U4454d: Time and Timeline are gone, so nothing reads the measurements collected for them.
DROP TRIGGER IF EXISTS measurement_home_erased;
DROP TRIGGER IF EXISTS measurement_placement;
DROP TABLE IF EXISTS measurement_attempts;
DROP TABLE IF EXISTS measurement_erased;
DROP TABLE IF EXISTS measurement_state;
DROP TABLE IF EXISTS measurement_revisions;
DROP TABLE IF EXISTS measurement_positions;
DROP TABLE IF EXISTS measurement_owners;
