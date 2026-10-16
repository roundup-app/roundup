CREATE TABLE door_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor TEXT NOT NULL, agent TEXT NOT NULL, attempt TEXT, child_terminal TEXT,
 method TEXT NOT NULL, params TEXT NOT NULL
);
CREATE TABLE door_action_outcomes (
 seq INTEGER PRIMARY KEY, action INTEGER NOT NULL REFERENCES door_actions(id),
 outcome TEXT NOT NULL
);
CREATE INDEX door_action_outcomes_action ON door_action_outcomes(action,seq);
INSERT INTO door_actions(id,actor,agent,attempt,child_terminal,method,params)
 SELECT id,actor,agent,attempt,child_terminal,'terminal.resize',
 json_object('id',terminal,'cols',cols,'rows',rows) FROM resize_actions;
INSERT INTO door_action_outcomes SELECT seq,action,outcome FROM resize_outcomes;
