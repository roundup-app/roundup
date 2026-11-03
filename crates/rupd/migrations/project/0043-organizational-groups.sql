-- Organizational Groups are transparent to instruction Home lookup.
DROP VIEW instruction_placement;
CREATE VIEW instruction_placement AS
 WITH RECURSIVE chain(agent,id,parent,kind) AS (
  SELECT CAST(id AS TEXT),id,parent,kind FROM nodes
  UNION ALL SELECT c.agent,n.id,n.parent,n.kind FROM nodes n JOIN chain c ON n.id=c.parent
  WHERE c.kind <> 'workstream'
 ) SELECT agent,CAST(id AS TEXT) AS home FROM chain WHERE kind='workstream';
