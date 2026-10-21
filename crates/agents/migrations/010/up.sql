-- Older Workstreams stored their default implicitly; retain that exact current value.
UPDATE nodes SET work='{"kind":"clarification","question":"What is this Workstream for?"}'
 WHERE kind IN ('workstream','room','group') AND work IS NULL;
-- Revision ids are Project-scoped identities, never content hashes or clocks.
CREATE TABLE instruction_revisions (
 revision INTEGER PRIMARY KEY AUTOINCREMENT,
 agent TEXT NOT NULL,
 workstream TEXT,
 work TEXT,
 message INTEGER UNIQUE,
 text TEXT,
 CHECK ((work IS NOT NULL AND message IS NULL AND text IS NULL)
     OR (work IS NULL AND message IS NOT NULL AND text IS NOT NULL))
);
CREATE INDEX instruction_orders ON instruction_revisions(agent,revision) WHERE message IS NULL;
CREATE TABLE instruction_homes (agent TEXT PRIMARY KEY NOT NULL, home TEXT);
CREATE VIEW instruction_placement AS
 WITH RECURSIVE chain(agent,id,parent,kind) AS (
  SELECT CAST(id AS TEXT),id,parent,kind FROM nodes
  UNION ALL SELECT c.agent,n.id,n.parent,n.kind FROM nodes n JOIN chain c ON n.id=c.parent
 ) SELECT agent,CAST(id AS TEXT) AS home FROM chain WHERE kind='workstream';
INSERT INTO instruction_homes SELECT CAST(n.id AS TEXT),p.home FROM nodes n
 LEFT JOIN instruction_placement p ON p.agent=CAST(n.id AS TEXT);
INSERT INTO instruction_revisions(agent,workstream,work)
 SELECT CAST(n.id AS TEXT),p.home,n.work FROM nodes n
 LEFT JOIN instruction_placement p ON p.agent=CAST(n.id AS TEXT) WHERE n.work IS NOT NULL;
CREATE TRIGGER instruction_node AFTER INSERT ON nodes BEGIN
 INSERT INTO instruction_homes SELECT CAST(NEW.id AS TEXT),home FROM instruction_placement WHERE agent=CAST(NEW.id AS TEXT);
 INSERT OR IGNORE INTO instruction_homes VALUES(CAST(NEW.id AS TEXT),NULL);
 INSERT INTO instruction_revisions(agent,workstream,work)
 SELECT CAST(NEW.id AS TEXT),home,NEW.work FROM instruction_homes
 WHERE agent=CAST(NEW.id AS TEXT) AND NEW.work IS NOT NULL;
END;
CREATE TRIGGER instruction_order AFTER UPDATE OF work ON nodes WHEN NEW.work IS NOT NULL BEGIN
 INSERT INTO instruction_revisions(agent,workstream,work)
 SELECT CAST(NEW.id AS TEXT),home,NEW.work FROM instruction_homes WHERE agent=CAST(NEW.id AS TEXT);
END;
-- Placement is mutable; original instruction attribution is not.
CREATE TRIGGER instruction_move AFTER UPDATE OF parent ON nodes WHEN OLD.parent IS NOT NEW.parent BEGIN
 UPDATE instruction_homes SET home=(SELECT p.home FROM instruction_placement p WHERE p.agent=instruction_homes.agent)
 WHERE agent IN (SELECT CAST(id AS TEXT) FROM nodes);
END;
CREATE TABLE instruction_deliveries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 revision INTEGER NOT NULL REFERENCES instruction_revisions(revision),
 attempt TEXT NOT NULL,
 text TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','uncertain','submitted','refused')),
 first INTEGER NOT NULL DEFAULT 0 CHECK(first IN (0,1))
);
CREATE UNIQUE INDEX instruction_first ON instruction_deliveries(revision,attempt) WHERE first=1;
