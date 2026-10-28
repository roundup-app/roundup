-- A4452: an inbox transport preserves the Work order revision it carries.
ALTER TABLE instruction_deliveries ADD COLUMN message INTEGER;
DROP TRIGGER instruction_message;
DROP TRIGGER instruction_message_outcome;
CREATE TRIGGER instruction_message AFTER INSERT ON message_flight BEGIN
 UPDATE instruction_deliveries SET message=NEW.message_id,state='uncertain'
 WHERE id=(SELECT d.id FROM instruction_deliveries d
 JOIN instruction_revisions r ON r.revision=d.revision
 JOIN messages m ON m.id=NEW.message_id
 WHERE r.agent=m.to_id AND r.work IS NOT NULL AND d.state='prepared'
 AND d.attempt=CAST(m.receiver_attempt AS TEXT)
 AND json_extract(m.from_actor,'$.id')='rupd'
 AND (m.body=d.text OR substr(m.body,1,length(d.text)+20)=d.text || char(10) || char(10) || '<roundup-context>' || char(10))
 ORDER BY d.id LIMIT 1);
 INSERT INTO instruction_revisions(agent,workstream,message,text)
 SELECT m.to_id,h.home,m.id,m.body FROM messages m JOIN instruction_homes h ON h.agent=m.to_id
 WHERE m.id=NEW.message_id AND NOT EXISTS(SELECT 1 FROM instruction_deliveries WHERE message=m.id)
 AND NOT EXISTS(SELECT 1 FROM instruction_revisions WHERE message=m.id);
 INSERT INTO instruction_deliveries(revision,attempt,text,state,message)
 SELECT r.revision,CAST(m.receiver_attempt AS TEXT),m.body,'uncertain',m.id
 FROM messages m JOIN instruction_revisions r ON r.message=m.id WHERE m.id=NEW.message_id;
END;
CREATE TRIGGER instruction_message_outcome AFTER UPDATE OF status ON messages
 WHEN NEW.status IN ('delivered','dropped') BEGIN
 UPDATE instruction_deliveries SET state=CASE NEW.status WHEN 'delivered' THEN 'submitted' ELSE 'refused' END
 WHERE (message=NEW.id OR revision=(SELECT revision FROM instruction_revisions WHERE message=NEW.id))
 AND attempt=CAST(NEW.receiver_attempt AS TEXT) AND state='uncertain';
END;
