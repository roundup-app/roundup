#!/usr/bin/env python3
"""L89: refreshes the web shard durations from the vitest output in CI logs on stdin.
Usage: gh run view <main-run-id> --log | loop/web-durations.py > apps/desktop/src/testing/shardDurations.json
A file's duration is the one vitest's reporter prints on its line (`✓ src/x.test.ts (3 tests) 262635ms`): it holds the
file's hooks, where a browser test does its work. A file without one (skipped) takes its JSON report's endTime - startTime
(which leaves hooks out), in whole seconds."""
import json
import re
import sys

durations = {}
printed = {}
for line in sys.stdin:
    line = re.sub(r'\x1b\[[0-9;]*m', '', line)
    if match := re.search(r'[✓❯×] (src/\S+) \(.*\) (\d+)ms$', line.rstrip()):
        printed[match.group(1)] = max(1, round(int(match.group(2)) / 1000))
    if '{"numTotalTestSuites"' not in line:
        continue
    for result in json.loads(line[line.index('{"numTotalTestSuites"'):])['testResults']:
        durations[result['name'].split('apps/desktop/', 1)[1]] = max(1, round((result['endTime'] - result['startTime']) / 1000))
if not durations:
    sys.exit('no vitest JSON report in the log')
json.dump(dict(sorted({file: printed.get(file, seconds) for file, seconds in durations.items()}.items())), sys.stdout, indent=1)
print()
