#!/usr/bin/env python3
"""A process below `claude` that answers a Decision over the Daemon's socket (H21).

  answer_as.py WAIT OUT DECISION DOOR_FILE DATA_DIR MODE

It waits for the file WAIT. MODE is `plain`: it sends `decision.answer` {id: DECISION, answer:
"allow"} with no `proof`. `identify`: it first claims the Door whose id is in DOOR_FILE with
`daemon.identify`. `files`: it first reads that Door's launch files in DATA_DIR/agents and the
environment it inherited, as any process of the user can, and then claims the Door. The reply is
written to OUT.<pid of its parent>.
"""
import json
import os
import socket
import sys
import time

wait, out, decision, door_file, data_dir, mode = sys.argv[1:7]
while not os.path.exists(wait):
    time.sleep(0.02)
door = open(door_file).read().strip()
if mode == "files":
    for suffix in ("mcp.json", "settings.json", "brief.md"):
        open(os.path.join(data_dir, "agents", f"{door}.{suffix}")).read()
    json.dumps(dict(os.environ))
conn = socket.socket(socket.AF_UNIX)
conn.connect(os.environ["RUPD_SOCKET"])
reader = conn.makefile("r")


def request(n, method, params):
    conn.sendall((json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params}) + "\n").encode())
    return json.loads(reader.readline())


if mode in ("identify", "files"):
    request(1, "daemon.identify", {"actor": {"kind": "agent", "id": door, "parent": None}})
reply = request(2, "decision.answer", {"id": decision, "answer": "allow"})
path = f"{out}.{os.getppid()}"
with open(path + ".tmp", "w") as file:
    json.dump(reply, file)
os.rename(path + ".tmp", path)
