-- DCL10d: whether the told change wakes its Door (DTC2), kept so a restart replays it as it was
-- told. A row written before this reads as quiet.
ALTER TABLE push_intents ADD COLUMN waking INTEGER NOT NULL DEFAULT 0;
