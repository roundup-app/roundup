#!/usr/bin/env python3
"""T15 perf fixture: just perf --rupd "$PWD/crates/todos/t15_perf.py".

Seeds creation plus 1000 Changes before exec; cold start includes fixture setup.
T15_RUPD selects a separately built main binary for comparison on the same runner.
"""
import json
import os
from pathlib import Path
import sqlite3
import sys

project = Path(sys.argv[1])
legacy = project / '.roundup'
legacy.mkdir(exist_ok=True)
db = sqlite3.connect(legacy / 'todos.db')
db.executescript('''CREATE TABLE todos(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, creator TEXT NOT NULL, home TEXT, pos INTEGER NOT NULL);
CREATE TABLE blockers(todo INTEGER REFERENCES todos(id) ON DELETE CASCADE, blocker INTEGER REFERENCES todos(id) ON DELETE CASCADE, PRIMARY KEY(todo,blocker));
CREATE TABLE changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, todo INTEGER REFERENCES todos(id) ON DELETE CASCADE, before_values TEXT, after_values TEXT NOT NULL, after_touch INTEGER NOT NULL);
CREATE INDEX changes_todo ON changes(todo,seq);''')
db.execute('INSERT INTO todos VALUES(1, ?, ?, 0, 0, ?, NULL, 1)', ('History fixture', '1000', json.dumps({'kind':'user','id':'you','parent':None})))
for n in range(1001):
    values = {'title':'History fixture','body':str(n),'done':False,'blockers':[]}
    before = None if n == 0 else json.dumps({**values, 'body':str(n-1)})
    db.execute('INSERT INTO changes(todo,before_values,after_values,after_touch) VALUES(1,?,?,0)', (before,json.dumps(values)))
db.commit()
assert db.execute('SELECT COUNT(*) FROM changes').fetchone()[0] == 1001
db.close()
os.environ['ROUNDUP_DATA_DIR'] = str(project / 'perf-data')
os.execv(os.environ.get('T15_RUPD', str(Path(__file__).resolve().parents[2] / 'target/release/rupd')), ['rupd', *sys.argv[1:]])
