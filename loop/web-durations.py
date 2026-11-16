#!/usr/bin/env python3
"""L89: refreshes the web shard durations from the vitest output in CI logs on stdin.
Usage: gh run view <main-run-id> --log | loop/web-durations.py > apps/desktop/src/testing/shardDurations.json
A file's duration is the one vitest's reporter prints on its line (`✓  heavy  src/x.test.ts (3 tests) 262635ms`): it holds the
file's hooks, where a browser test does its work. A file without one (skipped) takes its JSON report's endTime - startTime
(which leaves hooks out), in whole seconds. Logs of several runs average each file over the runs that measured it, since one
run's time swings up to half again, and a file no longer in the tree drops out (CI7295a)."""
import json
import re
import sys
from pathlib import Path

durations = {}
printed = {}
for line in sys.stdin:
    line = re.sub(r'\x1b\[[0-9;]*m', '', line)
    if match := re.search(r'[✓❯×]\s+(?:[\w-]+\s+)?(src/\S+) \(.*\) (\d+)ms$', line.rstrip()):
        printed.setdefault(match.group(1), []).append(int(match.group(2)) / 1000)
    if '{"numTotalTestSuites"' not in line:
        continue
    for result in json.loads(line[line.index('{"numTotalTestSuites"'):])['testResults']:
        durations.setdefault(result['name'].split('apps/desktop/', 1)[1], []).append((result['endTime'] - result['startTime']) / 1000)
if not durations:
    sys.exit('no vitest JSON report in the log')
desktop = Path(__file__).resolve().parent.parent / 'apps/desktop'


def mean(seconds):
    return max(1, round(sum(seconds) / len(seconds)))


json.dump(dict(sorted({file: mean(printed.get(file, seconds)) for file, seconds in durations.items() if (desktop / file).exists()}.items())), sys.stdout, indent=1)
print()
