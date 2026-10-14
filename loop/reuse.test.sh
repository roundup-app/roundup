#!/usr/bin/env bash
# L116: actual ready recipe and review task, with GitHub isolated at its CLI boundary.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json
import os
import subprocess
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    binary = root / 'gh'
    binary.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ['REUSE_FIXTURE'])
d = json.loads((root / 'state').read_text())
a = sys.argv[1:]
with (root / 'calls').open('a') as out:
    out.write(json.dumps(a) + '\\n')
if a[:2] in (['pr', 'ready'], ['pr', 'merge']):
    sys.exit(1 if d.get('fail') == a[1] else 0)
if a[:2] == ['pr', 'view']:
    print(json.dumps(dict(number=9, body=d['body'], state='OPEN', headRefOid='a'*40,
                          isDraft=False, labels=[])))
elif '/files?' in a[-1]:
    if d.get('fail') == 'files':
        print('files read failed (HTTP 403)', file=sys.stderr)
        sys.exit(1)
    assert '--paginate' in a and '--slurp' in a
    print(json.dumps(d['pages']))
elif '/comments' in a[-1]:
    print('[]')
elif '/issues/' in a[-1]:
    print(json.dumps(dict(state='closed' if d.get('closed') == a[-1].split('/')[-1] else 'open',
                         closed_by=dict(login='saadshahd'), closed_at='2099-01-01T00:00:00Z')))
else:
    raise AssertionError(a)
''')
    binary.chmod(0o755)
    env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'], 'REUSE_FIXTURE': str(root)}
    env.pop('GITHUB_RUN_ID', None)
    body = 'Refs #5\nScenarios: L116\nMoves: D2\n'
    ui = dict(filename='apps/desktop/src/ui/x.tsx', status='added')

    def observe(name, text=body, pages=None, code=0, missing=(), writes=('ready', 'merge'), **extra):
        (root / 'state').write_text(json.dumps(dict(body=text, pages=pages if pages is not None else [[ui]], **extra)))
        (root / 'calls').write_text('')
        result = subprocess.run(['just', 'ready', '9'], env=env, capture_output=True, text=True, timeout=15)
        assert result.returncode == code, (name, result.returncode, result.stderr)
        for line in missing:
            assert line in result.stderr, (name, result.stderr)
        calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
        assert [a[1] for a in calls if a[:2] in (['pr', 'ready'], ['pr', 'merge'])] == list(writes), (name, calls)
        print('ok:', name)

    observe('l116_ready_rejects_an_added_ui_file_without_reuse', code=1, missing=('Reuse:',), writes=())
PY
