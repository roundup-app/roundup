#!/usr/bin/env python3
"""Nextest run-wrapper: bracket the unchanged command with execution timestamps."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

output = Path(os.environ["E14_RUST_EVENTS"]) / f"{os.getpid()}.json"
row = dict(id=os.environ["NEXTEST_BINARY_ID"] + "::" + os.environ["NEXTEST_TEST_NAME"],
           start=time.time_ns() / 1_000_000)
# A killed wrapper leaves an incomplete record, which report validation rejects.
with output.open("x") as stream:
    json.dump(row, stream)
result = subprocess.run(sys.argv[1:])
row.update(end=time.time_ns() / 1_000_000, exit_code=result.returncode)
output.write_text(json.dumps(row) + "\n")
sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
