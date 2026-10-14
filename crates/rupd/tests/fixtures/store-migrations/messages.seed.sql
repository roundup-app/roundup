INSERT INTO messages(id,from_actor,to_id,kind,body,reply_to,status,reason,at,rank,receiver_attempt,receiver_revision,passed_from) VALUES(13,'{"kind":"user","id":"you","parent":null}','9','note','stored payload α',NULL,'pending',NULL,114,2,4,3,NULL),(16,'{"kind":"agent","id":"9","parent":"7"}','7','question','question payload',13,'held','ask-first',115,3,2,1,9);
INSERT INTO message_retirements VALUES('9','retirement',1);
INSERT INTO message_restarts VALUES('9','restart',4,'reserved prompt',13,5,1);
INSERT INTO routes VALUES('9','7','auto','user');
INSERT INTO chains VALUES(2,'{"kind":"agent","id":"9","parent":"7"}','chain body','["7"]',16,116,0);
INSERT INTO iterations VALUES('7',2,13);
INSERT INTO receiver_generations VALUES('9',4,0,3,-1);
