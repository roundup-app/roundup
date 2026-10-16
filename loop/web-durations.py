#!/usr/bin/env python3
"""L89: refreshes the web shard durations from the vitest JSON reports in CI logs on stdin.
Usage: gh run view <main-run-id> --log | loop/web-durations.py > apps/desktop/src/testing/shardDurations.json
Each `web` job's log holds one report; a file's duration is its report's endTime - startTime, in whole seconds."""
import json
import sys

durations = {}
for line in sys.stdin:
    if '{"numTotalTestSuites"' not in line:
        continue
    for result in json.loads(line[line.index('{"numTotalTestSuites"'):])['testResults']:
        durations[result['name'].split('apps/desktop/', 1)[1]] = max(1, round((result['endTime'] - result['startTime']) / 1000))
if not durations:
    sys.exit('no vitest JSON report in the log')
json.dump(dict(sorted(durations.items())), sys.stdout, indent=1)
print()
