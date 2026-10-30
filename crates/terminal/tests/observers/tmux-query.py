"""Run inside a private tmux session to record any unsolicited DA1 response."""
import json
import os
import select
import sys
import tty

with open(sys.argv[1], "w") as result:
    tty.setraw(0)
    os.write(1, b"\x1b[c")
    ready, _, _ = select.select([0], [], [], 2)
    result.write(json.dumps(list(os.read(0, 1024)) if ready else []))
    result.flush()
