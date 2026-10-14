INSERT INTO todos(id,title,body,done,created_at,home,pos) VALUES(5,'Kept Todo','payload α',0,111,'7',2),(8,'Blocker','complete body',1,112,NULL,1);
INSERT INTO blockers VALUES(5,8);
INSERT INTO changes(seq,todo,before_values,after_values,after_touch) VALUES(10,5,NULL,'{"title":"Kept Todo","body":"payload α","done":false,"blockers":[8]}',3),(12,8,NULL,'{"title":"Blocker","body":"complete body","done":true,"blockers":[]}',4);
