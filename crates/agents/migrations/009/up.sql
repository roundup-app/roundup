-- Sources outlive their maker; explicit Home erasure remains authoritative.
CREATE TABLE measurement_owners (
    agent TEXT NOT NULL,
    source TEXT NOT NULL UNIQUE,
    cwd TEXT NOT NULL,
    attempt TEXT,
    home TEXT,
    maker TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
    unresolved INTEGER NOT NULL DEFAULT 0 CHECK(unresolved IN (0,1)),
    PRIMARY KEY (agent, source)
);
CREATE TABLE measurement_positions (
    source TEXT NOT NULL,
    file TEXT NOT NULL,
    position TEXT NOT NULL,
    cause TEXT,
    last_good INTEGER,
    PRIMARY KEY(source,file)
);
CREATE TABLE measurement_revisions (
    revision INTEGER PRIMARY KEY AUTOINCREMENT,
    identity TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source TEXT NOT NULL,
    agent TEXT NOT NULL,
    attempt TEXT,
    home TEXT,
    maker TEXT NOT NULL,
    observed INTEGER NOT NULL,
    value TEXT NOT NULL,
    coverage TEXT NOT NULL,
    UNIQUE(identity,source_revision)
);
CREATE INDEX measurement_latest ON measurement_revisions(identity,revision DESC);
CREATE TRIGGER measurement_home_erased BEFORE DELETE ON nodes WHEN OLD.kind='workstream'
BEGIN
    UPDATE measurement_owners SET disabled=1 WHERE home=CAST(OLD.id AS TEXT);
    DELETE FROM measurement_revisions WHERE home=CAST(OLD.id AS TEXT);
    UPDATE measurement_state SET revision=revision+1;
END;

CREATE TABLE measurement_state (revision INTEGER NOT NULL);
INSERT INTO measurement_state VALUES(0);
CREATE TABLE measurement_erased(identity TEXT PRIMARY KEY NOT NULL);
CREATE TRIGGER measurement_remember_erasure BEFORE DELETE ON measurement_revisions
BEGIN INSERT OR IGNORE INTO measurement_erased(identity) VALUES(OLD.identity); END;

CREATE TABLE measurement_request_attempts (
 identity TEXT PRIMARY KEY NOT NULL,
 agent TEXT NOT NULL,
 source TEXT NOT NULL,
 attempt TEXT NOT NULL
);
CREATE TABLE measurement_attempts (
 agent TEXT NOT NULL,
 source TEXT NOT NULL,
 attempt TEXT NOT NULL,
 PRIMARY KEY(agent,source,attempt)
);

-- Keep the source's last placement even when its maker is removed before the next pass.
-- Accepted contributions retain their original Home and maker bytes.
CREATE TRIGGER measurement_placement AFTER UPDATE OF parent,name ON nodes
BEGIN
 UPDATE measurement_owners SET
  maker=(SELECT name FROM nodes WHERE CAST(id AS TEXT)=measurement_owners.agent),
  home=(WITH RECURSIVE chain(id,parent,kind) AS (
   SELECT id,parent,kind FROM nodes WHERE CAST(id AS TEXT)=measurement_owners.agent
   UNION ALL SELECT n.id,n.parent,n.kind FROM nodes n JOIN chain c ON n.id=c.parent
  ) SELECT CAST(id AS TEXT) FROM chain WHERE kind='workstream' LIMIT 1)
 WHERE disabled=0 AND EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=measurement_owners.agent);
END;
