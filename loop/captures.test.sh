#!/usr/bin/env bash
# L112 publication fixtures and reference audit; isolated git repositories, no real GitHub writes.
set -euo pipefail
# Preserve the full-check assertion with captures disabled; L112 retires only the historical merge replay.
if [ "${1:-}" = --checkout ]; then
  checkout=$(realpath "${2:?clean main checkout required}")
  cd "$checkout"
  test -z "$(git status --porcelain)"
  test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
  unset ROUNDUP_CAPTURES
  code=0
  just check || code=$?
  test -z "$(git status --porcelain)"
  echo 'ok: l105_just_check_leaves_no_tracked_change'
  exit "$code"
fi
[ $# = 0 ] || { echo 'usage: loop/captures.test.sh [--checkout <clean-main-checkout>]' >&2; exit 2; }
cd "$(dirname "$0")/.."
python3 - <<'PY'
import io
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

SOURCE = Path.cwd()
def run(*args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs).stdout.strip()
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    run('git', 'init', '-q', '-b', 'main', str(root))
    run('git', '-C', str(root), 'config', 'user.name', 'fixture')
    run('git', '-C', str(root), 'config', 'user.email', 'fixture@example.com')
    (root / 'scenario.md').write_text('base')
    run('git', '-C', str(root), 'add', '.')
    run('git', '-C', str(root), 'commit', '-qm', 'base')
    base = run('git', '-C', str(root), 'rev-parse', 'HEAD')
    run('git', '-C', str(root), 'checkout', '-qb', 'work')
    (root / 'scenario.md').write_text('head')
    run('git', '-C', str(root), 'commit', '-qam', 'head')
    head = run('git', '-C', str(root), 'rev-parse', 'HEAD')
    manifest = {'revision': head, 'observers': [{'ids': ['U361'], 'command': 'just capture U361', 'exit_code': 0,
                'conditions': 'ROUNDUP_CAPTURES=U361; headless Chromium; 1280x800; light',
                'paths': ['artifacts/ux/U361/view.png', 'artifacts/ux/U361/view.checks.json']}]}
    record = {**manifest, 'url': 'https://github.com/saadshahd/roundup/actions/runs/42/artifacts/24', 'retention_days': 14}
    data = {'head': {'sha': head, 'repo': {'full_name': 'saadshahd/roundup'}}, 'base': {'sha': base, 'ref': 'main'},
            'draft': True, 'body': 'Scenarios: U361\nCapture required: U361\nCapture publication: ' + json.dumps(record)}
    artifact = {'name': f'captures-{head}', 'workflow_run': {'id': 42}, 'expired': False,
                'created_at': '2026-10-14T00:00:00Z', 'expires_at': '2026-10-28T00:00:00Z'}
    state = root / 'state.json'
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    archive = root / 'capture.zip'
    def zip_payload(extra=None):
        with zipfile.ZipFile(archive, 'w') as out:
            out.writestr('capture-observers.json', json.dumps(manifest))
            for path in manifest['observers'][0]['paths']:
                out.writestr(path, 'capture fixture')
            if extra:
                out.writestr(extra, 'uncited')
    zip_payload()
    binary = root / 'bin'; binary.mkdir()
    (binary / 'gh').write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
state = Path(os.environ['CAPTURE_FIXTURE'])
d = json.loads(state.read_text())
a = sys.argv[1:]
if a[:2] == ['pr', 'ready']:
    d['pr']['draft'] = True
    state.write_text(json.dumps(d))
    sys.exit(0)
if a[:2] == ['pr', 'comment']:
    d['comment'] = a[-1]
    state.write_text(json.dumps(d))
    sys.exit(0)
if a[0] == 'api' and '-X' in a:
    d['pr']['body'] = json.load(sys.stdin)['body']
    state.write_text(json.dumps(d))
    sys.exit(0)
route = a[1]
if route.endswith('/zip'):
    if d.get('download_failure'):
        print('artifact download failed', file=sys.stderr)
        sys.exit(1)
    sys.stdout.buffer.write(Path(os.environ['CAPTURE_ZIP']).read_bytes())
    sys.exit(0)
if '/actions/artifacts/' in route:
    print(json.dumps([d['artifact']]))
else:
    print(json.dumps([d['pr']]))
''')
    (binary / 'gh').chmod(0o755)
    env = {**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH'],
           'CAPTURE_FIXTURE': str(state), 'CAPTURE_ZIP': str(archive), 'GITHUB_OUTPUT': str(root / 'outputs')}
    def gate(name, want=0, command='captures', *args):
        result = subprocess.run(['bash', str(SOURCE / 'loop/rules.sh'), command, '12', *args], cwd=root,
                                env=env, capture_output=True, text=True)
        assert result.returncode == want, f'{name}: expected {want}, got {result.returncode}: {result.stderr}'
        print('ok: ' + name)
    gate('l112_published_evidence_names_head_and_scenarios')
    for key, value in [('revision', base), ('retention_days', 90), ('url', 'https://example.com/capture.zip')]:
        bad = {**record, key: value}
        data['body'] = 'Scenarios: U361\nCapture publication: ' + json.dumps(bad)
        state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
        gate('l112_malformed_publication_' + key, 1)
    for key, value in [('exit_code', 17), ('command', ''), ('conditions', ''), ('paths', []), ('ids', ['U196'])]:
        bad = json.loads(json.dumps(record)); bad['observers'][0][key] = value
        data['body'] = 'Scenarios: U361\nCapture publication: ' + json.dumps(bad)
        state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
        gate('l112_malformed_observer_' + key, 1)
    data['body'] = 'Scenarios: U361\nCapture publication: ' + json.dumps(record) + '\nCapture publication: ' + json.dumps(record)
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    gate('l112_duplicate_publication_is_rejected', 1)
    data['body'] = 'Scenarios: U361\nCapture publication: ' + json.dumps(record)
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    zip_payload('artifacts/ux/U196/uncited.png')
    gate('l112_uncited_payload_in_download_fails', 1)
    archive.write_bytes(b'failed upload, not a ZIP')
    gate('l112_malformed_download_is_rejected', 1)
    zip_payload()
    artifact['expired'] = True
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    gate('l112_expired_capture_is_not_downloadable', 1)
    artifact['expired'] = False
    artifact['expires_at'] = '2027-01-12T00:00:00Z'
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    gate('l112_upload_without_explicit_fourteen_day_retention_fails', 1)
    artifact['expires_at'] = '2026-10-28T00:00:00Z'
    state.write_text(json.dumps({'pr': data, 'artifact': artifact, 'download_failure': True}))
    gate('l112_failed_download_is_not_a_passing_observer', 1)
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    data['body'] = 'Scenarios: U361\nCapture required: U361'
    data['draft'] = False
    state.write_text(json.dumps({'pr': data, 'artifact': artifact}))
    gate('l112_failed_publication_leaves_draft', 1, 'capture-publish', str(root / 'upload'), '')
    failed = json.loads(state.read_text())
    assert failed['pr']['draft'] and 'failed' in failed['comment'] and 'no observer passes' in failed['comment']
    assert 'Capture publication:' not in failed['pr']['body']
    # Manifest paths are checked before upload, including ordinary and journey ownership.
    metadata = root / '.git/capture-observers.json'
    for path in manifest['observers'][0]['paths']:
        target = root / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text('fixture')
    metadata.write_text(json.dumps(manifest))
    gate('l112_prepare_preserves_partition_and_head', 0, 'capture-prepare', str(root / 'upload'))
    gate('l112_successful_publication_links_without_approval', 0, 'capture-publish', str(root / 'upload'), record['url'])
    final = json.loads(state.read_text())
    assert final['pr']['draft'] and 'Capture publication:' in final['pr']['body']
    for path in ('artifacts/ux/U196/a.png', 'artifacts/ux/journey/README.md', 'artifacts/ux/journey/J13aa/a.png'):
        bad = json.loads(json.dumps(manifest)); bad['observers'][0]['paths'] = [path]
        metadata.write_text(json.dumps(bad))
        gate('l112_uncited_or_malformed_publication_' + path, 1, 'capture-prepare', str(root / 'unused'))
    journey = json.loads(json.dumps(manifest))
    journey['observers'][0]['ids'] = ['J13']
    state.write_text(json.dumps({'pr': {**data, 'body': 'Scenarios: J13'}, 'artifact': artifact}))
    for path, want in [('artifacts/ux/J13/view.png', 1), ('artifacts/ux/journey/J13/view.png', 0)]:
        journey['observers'][0]['paths'] = [path]
        metadata.write_text(json.dumps(journey))
        target = root / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text('fixture')
        gate('l112_journey_publication_keeps_its_partition_' + path, want, 'capture-prepare', str(root / 'journey-upload'))
    # Main's credential/readiness boundary uses the same public commands in build and fix.
    trusted = root / 'loop'; trusted.mkdir()
    (trusted / 'rules.sh').write_bytes((SOURCE / 'loop/rules.sh').read_bytes())
    (trusted / 'builder.py').write_text('''import json, os, re
from pathlib import Path
state = Path(os.environ['CAPTURE_FIXTURE'])
RUN_RIGHTS = {'pull_requests': 'write', 'actions': 'read'}
STOPPED = re.compile(r'^Stopped:', re.M)
class orders:
    @staticmethod
    def gh(*args):
        return [{'number': 12}]
def view(pr):
    row = json.loads(state.read_text())['pr']
    return {'headRefOid': row['head']['sha'], 'body': row['body']}
def related(row):
    return [12]
def owner_closed(*args):
    return json.loads(state.read_text()).get('closed', False)
def event(name):
    data = json.loads(state.read_text())
    data.setdefault('events', []).append(name)
    state.write_text(json.dumps(data))
def app_token(rights):
    assert rights == RUN_RIGHTS
    event('token')
    return 'fixture-only'
def call(*args):
    assert args == ('api', '-X', 'DELETE', '/installation/token')
    event('revoke')
def ready(pr):
    event('ready')
''')
    metadata.write_text(json.dumps(manifest))
    def boundary(name, body, url, want, events, closed=False):
        state.write_text(json.dumps({'pr': {**data, 'body': body}, 'artifact': artifact, 'closed': closed}))
        result = subprocess.run(['bash', str(trusted / 'rules.sh'), 'capture-run', 'publish', '12',
                                 str(root / 'upload'), url], cwd=root, env=env, capture_output=True, text=True)
        assert result.returncode == want, f'{name}: {result.stderr}'
        assert json.loads(state.read_text()).get('events', []) == events, name
        print('ok: ' + name)
    body = 'Scenarios: U361\nCapture required: U361'
    boundary('l112_publication_success_alone_cannot_request_ready', body, record['url'], 0, ['token', 'revoke'])
    boundary('l112_builder_completion_arms_ordinary_gates', body + '\nCapture ready: ' + head, record['url'], 0,
             ['token', 'ready', 'revoke'])
    boundary('l112_failed_upload_revokes_token_without_ready', body + '\nCapture ready: ' + head, '', 1,
             ['token', 'revoke'])
    boundary('l112_owner_closure_stops_publication', body + '\nCapture ready: ' + head, record['url'], 0, [], closed=True)
    state.write_text(json.dumps({'pr': {**data, 'body': 'Scenarios: L112'}, 'artifact': artifact}))
    metadata.unlink()
    gate('l112_specification_only_has_no_upload', 0, 'capture-prepare', str(root / 'no-upload'))
    assert not (root / 'no-upload').exists()

# Surviving citations resolve through publication, not retiring committed payloads.
import re
for folder in ('scenarios', 'docs', '.agents/data'):
    for path in (SOURCE / folder).rglob('*.md'):
        text = path.read_text()
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if not target.startswith(('http://', 'https://')):
                assert not re.search(r'(?:^|/)(?:artifacts/|crates/rpc/r16/|crates/rupd/evidence/)', target), f'{path}: tracked evidence link {target}'
print('ok: l112_scenario_evidence_references_resolve')
PY
