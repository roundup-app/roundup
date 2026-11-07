-- B6506: a stored Message is a Note, a Digest or a Wake by its payload, not by its body.
ALTER TABLE messages ADD COLUMN payload TEXT NOT NULL DEFAULT '"Note"';

-- A Wake names its Agents in the body only by name, so a back-filled one holds no ids.
UPDATE messages SET payload = '{"Wake":{"ids":[]}}'
WHERE kind = 'note' AND substr(body, 1, 6) = '[wake]'
  AND json_extract(from_actor, '$.kind') = 'ext' AND json_extract(from_actor, '$.id') = 'rupd'
  AND json_extract(from_actor, '$.parent') IS NULL;

-- A Digest's weight and entries are read from its body by the rules B33 and B34 gave its text.
UPDATE messages SET payload = (
  WITH RECURSIVE
  split(n, line, rest) AS (
    SELECT 0, NULL, messages.body || char(10)
    UNION ALL
    SELECT n + 1, substr(rest, 1, instr(rest, char(10)) - 1), substr(rest, instr(rest, char(10)) + 1)
    FROM split WHERE rest != ''
  ),
  kinds(word) AS (VALUES ('error'), ('needs-you'), ('blocked'), ('working'), ('idle'), ('done')),
  bare(n, line, text) AS (
    SELECT n, line, CASE WHEN substr(line, 1, 9) = '[digest] ' THEN substr(line, 10) ELSE line END
    FROM split WHERE n > 0
  ),
  linked(n, line, text, head, link) AS (
    SELECT n, line, text,
      CASE WHEN substr(text, -1) = ')' AND instr(text, ' (roundup://') > 0
            AND instr(substr(text, instr(text, ' (roundup://') + 2), ' ') = 0
           THEN substr(text, 1, instr(text, ' (roundup://') - 1) ELSE text END,
      CASE WHEN substr(text, -1) = ')' AND instr(text, ' (roundup://') > 0
            AND instr(substr(text, instr(text, ' (roundup://') + 2), ' ') = 0
           THEN substr(text, instr(text, ' (roundup://') + 2, length(text) - instr(text, ' (roundup://') - 2) END
    FROM bare WHERE substr(text, 1, 1) NOT IN (' ', '[')
  ),
  heads(n, name, kind, link) AS (
    SELECT n, substr(head, 1, length(head) - length(' is ' || word)), word, link
    FROM linked JOIN kinds
      ON length(head) > length(' is ' || word) AND substr(head, -length(' is ' || word)) = ' is ' || word
  ),
  ends(n, stop) AS (
    SELECT h.n, COALESCE((SELECT MIN(b.n) FROM bare b WHERE b.n > h.n AND substr(b.line, 1, 2) != '  '), 1000000000)
    FROM heads h
  ),
  fields(n, name, kind, link, last, todos, pads) AS (
    SELECT h.n, h.name, h.kind, h.link,
      COALESCE((SELECT substr(b.line, 9) FROM bare b WHERE b.n > h.n AND b.n < e.stop
                  AND substr(b.line, 1, 8) = '  last: ' ORDER BY b.n DESC LIMIT 1), ''),
      COALESCE((SELECT CAST(substr(b.line, 15) AS INTEGER) FROM bare b WHERE b.n > h.n AND b.n < e.stop
                  AND substr(b.line, 1, 14) = '  open todos: ' ORDER BY b.n DESC LIMIT 1), 0),
      (SELECT substr(b.line, 9) || ', ' FROM bare b WHERE b.n > h.n AND b.n < e.stop
                  AND substr(b.line, 1, 8) = '  pads: ' ORDER BY b.n DESC LIMIT 1)
    FROM heads h JOIN ends e ON e.n = h.n
  ),
  padsplit(n, i, item, rest) AS (
    SELECT n, 0, NULL, pads FROM fields WHERE pads IS NOT NULL
    UNION ALL
    SELECT n, i + 1, substr(rest, 1, instr(rest, ', ') - 1), substr(rest, instr(rest, ', ') + 2)
    FROM padsplit WHERE rest != ''
  ),
  entries(n, json) AS (
    SELECT f.n, json_object('name', f.name, 'kind', f.kind, 'link', f.link, 'last', f.last, 'todos', f.todos,
      'pads', json(COALESCE((SELECT json_group_array(item) FROM (SELECT item FROM padsplit p WHERE p.n = f.n AND p.i > 0 ORDER BY p.i)), '[]')))
    FROM fields f
  ),
  first(text) AS (SELECT text FROM bare WHERE n = 1),
  final(line) AS (SELECT line FROM bare ORDER BY n DESC LIMIT 1),
  counted(w) AS (
    SELECT CASE
      WHEN substr(messages.body, 1, 10) = '[digest] [' THEN
        CASE WHEN CAST(substr(messages.body, 11) AS INTEGER) > 0
              AND (instr(substr(messages.body, 11), CAST(substr(messages.body, 11) AS INTEGER) || ' updates kept back]') = 1
                OR instr(substr(messages.body, 11), CAST(substr(messages.body, 11) AS INTEGER) || ' earlier updates: ') = 1)
             THEN CAST(substr(messages.body, 11) AS INTEGER) ELSE 1 END
      WHEN (SELECT line FROM final) LIKE '  (% changes)' AND (SELECT line FROM final) GLOB '  ([0-9]*'
            AND substr((SELECT line FROM final), 4, length((SELECT line FROM final)) - 12) NOT GLOB '*[^0-9]*'
            AND CAST(substr((SELECT line FROM final), 4) AS INTEGER) > 0
        THEN CAST(substr((SELECT line FROM final), 4) AS INTEGER)
      ELSE 1 END
  )
  SELECT json_object('Digest', json_object(
    'entries', json(COALESCE((SELECT json_group_array(json(json)) FROM (SELECT json FROM entries ORDER BY n)), '[]')),
    'stands_for', (SELECT w FROM counted)))
)
WHERE kind = 'note' AND substr(body, 1, 8) = '[digest]'
  AND json_extract(from_actor, '$.kind') = 'ext' AND json_extract(from_actor, '$.id') = 'rupd'
  AND json_extract(from_actor, '$.parent') IS NULL;
