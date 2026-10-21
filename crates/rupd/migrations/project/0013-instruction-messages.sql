-- Both inbox and typed Messages enter flight under the existing receiver guards.
-- Retention commits with that admission, even if the Daemon ends before confirmation.
CREATE TRIGGER instruction_message AFTER INSERT ON message_flight BEGIN
 INSERT INTO instruction_revisions(agent,workstream,message,text)
 SELECT m.to_id,h.home,m.id,m.body FROM messages m JOIN instruction_homes h ON h.agent=m.to_id
 WHERE m.id=NEW.message_id AND NOT EXISTS(SELECT 1 FROM instruction_revisions WHERE message=m.id);
 INSERT INTO instruction_deliveries(revision,attempt,text,state)
 SELECT r.revision,CAST(m.receiver_attempt AS TEXT),m.body,'uncertain'
 FROM messages m JOIN instruction_revisions r ON r.message=m.id
 WHERE m.id=NEW.message_id;
END;
CREATE TRIGGER instruction_message_outcome AFTER UPDATE OF status ON messages
 WHEN NEW.status IN ('delivered','dropped') BEGIN
 UPDATE instruction_deliveries SET state=CASE NEW.status WHEN 'delivered' THEN 'submitted' ELSE 'refused' END
 WHERE revision=(SELECT revision FROM instruction_revisions WHERE message=NEW.id)
 AND attempt=CAST(NEW.receiver_attempt AS TEXT) AND state='uncertain';
END;
