"""Reuse P2544a's identical 1000-key observer and fixture; isolate its outputs here.

python3 artifacts/ux/P2544d/perf.py <baseline-commit> <head-commit>
Baseline/head Vite development servers listen on 5201/5202.
"""
from pathlib import Path
import subprocess
import sys

# Reject invalid source metadata before launching the isolated observer.
for commit in sys.argv[1:3]:
    subprocess.run(['git', 'rev-parse', '--verify', commit + '^{commit}'], check=True, capture_output=True)

observer = Path(__file__).resolve().parent.parent / 'P2544a' / 'perf.py'
source = observer.read_text().replace("SESSION = 'p2544-perf'", "SESSION = 'p2544d-perf'")
source = source.replace('python3 artifacts/ux/P2544a/perf.py ', 'python3 artifacts/ux/P2544d/perf.py ')
source = source.replace("        ab('open',", "        print(f'{side}: starting 1000 keys', flush=True)\n        ab('open',")
source = source.replace("        p95 = sorted(samples)[949]", "        p95 = sorted(samples)[949]\n        print(f'{side}: p95 {p95} ms', flush=True)")
source = source.replace('json.dumps(report, indent=2)', "json.dumps(report, separators=(',', ':'))")
# The existing observer derives root and output from __file__; use this wrapper's location.
exec(compile(source, str(observer), 'exec'))
