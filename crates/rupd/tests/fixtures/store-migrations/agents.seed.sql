INSERT INTO nodes(id,kind,name,parent,ord,attempt,iteration,work,spawn_prompt,creator,spawner,model,effort,conversation_id,conversation_cwd,worktree_owner,worktree_commit,worktree_path,worktree_branch,worktree_base,worktree_state) VALUES(7,'workstream','Migration Door',NULL,0,2,3,NULL,'preserve prompt','you',NULL,'model','high','conversation','/project',NULL,NULL,NULL,NULL,NULL,NULL),(9,'agent','Stopped Agent',7,0,4,1,NULL,'child prompt','7','7','model','low',NULL,NULL,'9','abc','/worktree','agent/9','main',NULL);
INSERT INTO settings VALUES(0,1,'just check');
INSERT INTO role_models VALUES('door','model','high');
INSERT INTO allowed_models VALUES(0,'model');
