#!/usr/bin/env python3
"""A hook command: appends {"t", "event", "payload"} to $SPIKE_LOG/hooks.jsonl.

  python3 hook.py EVENT

When $SPIKE_LOG/delay-EVENT exists, the hook first sleeps that many seconds.
When $SPIKE_LOG/decision-EVENT exists, its contents are printed as the hook's output, so a test
can answer a PermissionRequest.
"""
import json
import os
import sys
import time

event = sys.argv[1]
log_dir = os.environ.get("SPIKE_LOG", "/tmp/fake-claude-research/spike/logs")
raw = sys.stdin.read()
try:
    payload = json.loads(raw)
except ValueError:
    payload = {"_raw": raw[:500]}
with open(f"{log_dir}/hooks.jsonl", "a") as out:
    out.write(
        json.dumps({"t": round(time.time(), 3), "event": event, "payload": payload})
        + "\n"
    )
delay = f"{log_dir}/delay-{event}"
if os.path.exists(delay):
    time.sleep(float(open(delay).read()))
decision = f"{log_dir}/decision-{event}"
if os.path.exists(decision):
    sys.stdout.write(open(decision).read())
