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
    if d.get('fail') == 'view':
        print('PR read failed (HTTP 403)', file=sys.stderr)
        sys.exit(1)
    print(json.dumps(dict(number=9, body=d['body'], state='OPEN', headRefOid='a'*40,
                          isDraft=False, labels=[])))
elif any('/files?' in arg for arg in a):
    if d.get('fail') == 'files':
        print('files read failed (HTTP 403)', file=sys.stderr)
        sys.exit(1)
    assert '--paginate' in a and '--slurp' in a
    print(json.dumps(d['pages']))
elif any('/comments' in arg or '/dependencies/' in arg for arg in a):
    print('[]')
elif any('/issues/' in arg for arg in a):
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
    observe('l116_ready_accepts_an_added_ui_file_with_reuse', text=body + 'Reuse: library evidence\n')
    for empty in ('Reuse:', 'Reuse: \t\n\n', 'Reuse:\nScenarios: L116\n', 'Reuse:\nRefs #5\n',
                  'Reuse:\nCloses #5\n', 'Reuse:\n## Rationale\nauthor rationale'):
        observe('l116_empty_reuse_stays_draft', text=body + empty, code=1, missing=('Reuse:',), writes=())
    observe('l116_multiline_reuse_counts', text=body + 'Reuse:\n\n- candidate and release evidence\n\n- selection\n')
    for path in ('crates/messages/src/x.rs', 'apps/desktop/src/ui/x.tsx', 'loop/x.py'):
        observe('l116_new_file_paths_require_reuse', pages=[[dict(filename=path, status='added')]],
                code=1, missing=('Reuse:',), writes=())
    for status in ('modified', 'renamed', 'removed'):
        observe('l116_only_existing_files_need_no_reuse', pages=[[dict(ui, status=status, previous_filename='loop/old.py')]])
    for path in ('crates/x/tests/x.rs', 'crates/src/x.rs', 'apps/desktop/src-other/x.ts', 'loop-other/x.py', 'docs/x.md'):
        observe('l116_files_outside_source_roots_need_no_reuse', pages=[[dict(filename=path, status='added')]])
    observe('l116_paginated_files_are_checked', pages=[[dict(filename=f'docs/{n}.md', status='modified') for n in range(100)], [ui]],
            code=1, missing=('Reuse:',), writes=())
    for text, missing in (('Reuse: evidence', ('Scenarios:', 'Moves:')),
                          ('Scenarios: L116\nReuse: evidence', ('Moves:',)),
                          ('Moves: D2\nReuse: evidence', ('Scenarios:',))):
        observe('l116_reuse_does_not_replace_scenarios_or_moves', text=text, code=1, missing=missing, writes=())
    for closed in ('9', '5'):
        observe('l116_closed_owner_stays_closed', text=body + 'Reuse: evidence', closed=closed,
                code=1, missing=('owner closed',), writes=())
    observe('l116_files_api_failure_exits_four', fail='files', code=4, missing=('files read failed',), writes=())
    observe('l116_github_read_failure_exits_four', fail='view', code=4, missing=('PR read failed',), writes=())
    observe('l116_malformed_files_exit_four', pages=[[dict(filename=ui['filename'])]], code=4, missing=('status',), writes=())
    # Exercise the CLI's real timeout handler without waiting for three 30-second network deadlines.
    (root / 'state').write_text(json.dumps(dict(body=body, pages=[[ui]])))
    (root / 'calls').write_text('')
    timeout_runner = '''
import runpy, subprocess, sys
from unittest.mock import patch
run = subprocess.run
def github(args, **kwargs):
    if args[0] == 'gh' and any('/files?' in arg for arg in args):
        raise subprocess.TimeoutExpired(args, kwargs['timeout'])
    return run(args, **kwargs)
sys.argv = ['loop/builder.py', 'ready', '9']
with patch('subprocess.run', github), patch('time.sleep'):
    runpy.run_path('loop/builder.py', run_name='__main__')
'''
    result = subprocess.run(['python3', '-c', timeout_runner], env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode == 4 and 'timed out' in result.stderr, result
    assert not any(json.loads(line)[:2] in (['pr', 'ready'], ['pr', 'merge'])
                   for line in (root / 'calls').read_text().splitlines())
    print('ok: l116_files_timeout_exits_four')
    for fail, writes in (('ready', ('ready',)), ('merge', ('ready', 'merge'))):
        observe('l116_ready_or_merge_write_failure_exits_four', text=body + 'Reuse: evidence', fail=fail, code=4, writes=writes)
    for args in (['ready'], ['ready', 'no-number']):
        (root / 'calls').write_text('')
        result = subprocess.run(['python3', 'loop/builder.py', *args], env=env, capture_output=True, text=True, timeout=15)
        assert result.returncode == 2 and 'usage:' in result.stderr, result
        assert not (root / 'calls').read_text(), 'bad input made a network call'
        print('ok: l116_bad_input_exits_two')

    evidence = 'Reuse:\n\nCandidates: https://example.org and release\n\nSelected: library\n'
    for ending in ('## Rationale\nauthor rationale after', 'Rationale: author rationale after', 'Stopped: author rationale after',
                   'Closes #5\nauthor rationale after'):
        (root / 'state').write_text(json.dumps(dict(body='author rationale before\n' + body + evidence + ending, pages=[[ui]])))
        result = subprocess.run(['python3', 'loop/builder.py', 'review-task', '9', 'a'*40], env=env,
                                capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        assert evidence.strip() in result.stdout and 'Scenarios: L116' in result.stdout and 'Moves: D2' in result.stdout
        assert 'author rationale' not in result.stdout, result.stdout
        print('ok: l116_review_reads_only_reuse_evidence')
PY
