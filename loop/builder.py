#!/usr/bin/env python3
"""L23, L24, L79, L81, L82, L100: what GitHub Actions leaves to roundup around Builder runs: which Issues to build, how
a run ended, when a PR leaves draft, when it gets a fix run and how a review run's answer reaches the PR. Exit 4: GitHub
could not be read or written."""
import json
import hashlib
import http.client
import socket
import fcntl
import base64
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import orders  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NEEDS_USER = orders.NEEDS_USER
NEEDS_MAC = orders.NEEDS_MAC
# L79: the model that screens a build run's `ask` (`.agents/screen.md`), and the verdicts it gives.
SCREEN_MODEL = 'claude-haiku-5-5'
VERDICTS = ('user', 'mac', 'loop')
SCREEN_SCHEMA = {'type': 'object', 'required': ['verdict', 'reason', 'preview'],
                 'properties': {'verdict': {'enum': list(VERDICTS)}, 'reason': {'type': 'string'}, 'preview': {'type': 'string'}}}
# L23: where claude-code-action trades the job's OIDC token for a Claude App token (its `src/github/token.ts`), and the
# rights `keep` asks for: a push, workflow files and L97's renumbering included, and a draft PR.
EXCHANGE = 'https://api.anthropic.com/api/github/github-app-token-exchange'
AUDIENCE = 'claude-code-github-action'
RIGHTS = {'contents': 'write', 'pull_requests': 'write', 'issues': 'write', 'workflows': 'write'}
# L23: a build or fix run's token holds `keep`'s rights and reads CI evidence.
RUN_RIGHTS = {**RIGHTS, 'actions': 'read', 'checks': 'read'}
# L23: build and fix runs run on Codex with the user's ChatGPT login. The Codex App lends a workflow no token, so a run's
# commits name its account and push with a Claude App token.
CODEX_ACCOUNT = ('chatgpt-codex-connector[bot]', '199175422+chatgpt-codex-connector[bot]@users.noreply.github.com')
# The items of Codex's `--json` event lines that a tool use leaves.
CODEX_TOOLS = {'command_execution', 'file_change', 'mcp_tool_call', 'web_search'}
# L81: a draft's `Stopped:` paragraph, from that line to the next blank one.
STOPPED = re.compile(r'^Stopped:.*(?:\r?\n.*\S.*)*', re.M)
# L24/L100: acceptance lines a review run reads; L116 also forwards library evidence separately.
NAMED = re.compile(r'^(Scenarios|Moves):[ \t]*\S.*$', re.M)
# L100: what each of those lines looks like, for a body that lacks it.
SHAPES = {'Scenarios': '`Scenarios: <ids>`', 'Moves': '`Moves: D<n>, …`'}
ATTEMPTS = 3
# A draft PR untouched this long has no live run: build and fix jobs time out after two hours.
IDLE = 3 * 3600
# How long a passed `check` may await its review run's status before `pick` reruns the `check` (L24).
LAUNCH = 1800
# A review run whose model did no work (a usage limit) leaves `review` pending; pick reruns it this many times in all.
RERUNS = 6
FAILED = '`{cause}` failed on this head. `gh pr checks {pr}` lists the failed run; `gh run view <id> --log-failed` shows why.'
# L82: the jobs a `check` or `rules` cause stands for, by check-run name, and the workflow whose runs on `main` hold their
# results there.
LANES = {'check': ('check.yml', ('lint', 'rust 1', 'rust 2', 'mac', 'web')), 'rules': ('loop.yml', ('rules',))}
# L82: the comment a fix run that only merges `main` posts first, followed by the head it refreshes.
REFRESH = '<!-- fix-refresh'
# L82: the comment a fix run whose task names only a conflict posts first, followed by its head: `main` moved, not the
# PR, so the run counts no attempt.
CONFLICT = '<!-- fix-conflict'
NOPUSH = '<!-- fix-nopush'
# L82: how many such runs a PR gets. `pick` holds a conflict until its head's review verdict, so each follows a reviewed
# head; #870 spent two of its three attempts on conflicts. A PR gets at most ATTEMPTS + CONFLICTS fix runs, refreshes aside.
CONFLICTS = 3
# L82: the causes `fix.yml` runs on directly, when `check` or `loop` ends; a fix run for any other cause is dispatched.
DIRECT = {'check', 'rules'}
# Seconds between fix-run listings while GitHub has not yet listed a run it accepted; a dispatch answered 204 can be
# unlisted for several seconds (critic run 38484139687 was listed after its poster gave up one second in).
LISTED = (3, 6, 12, 24)
# L82: the clock skew allowed between a commit's committer date and GitHub's run times.
SKEW = 3600
# Seconds GitHub's run clock may read behind this runner's: a run it stamps in the second before `requested` is still
# the one requested.
BEHIND = 5
# In the order a fix task names them (L82): a conflict first, since its merge changes what the others see.
CAUSES = {
    'conflict': 'The PR conflicts with `main`: merge `origin/main` and keep the behaviour of both sides.',
    'check': FAILED,
    'rules': FAILED,
    'review': 'The review run rejected this head; its findings are the last verdict below.',
    'critic': 'The design critic rejected this head (L103); its findings are the last `CRITIC:` comment below. Meet each '
              'finding, or the bar it names, without loosening `docs/design-system.md`.',
    'unfinished': 'The last run left this PR a draft without a `Stopped:` line: finish the work.',
    'answered': 'The owner answered this draft\'s `Stopped:` question with a comment, the newest under Owner comments '
                'below: act on it, remove the `Stopped:` paragraph from the PR body and finish the work.',
}


class ApiMeasurement:
    """L114 append-only request evidence; shared counters never supply the job's own count."""
    def __init__(self, path, sample):
        self.path, self.sample = Path(path), sample
        self.tokens = {}
        self.pending = {}
        self.identity = {key: os.environ.get(value, '') for key, value in
                         [('workflow', 'GITHUB_WORKFLOW'), ('run', 'GITHUB_RUN_ID'), ('job', 'GITHUB_JOB'),
                          ('run_attempt', 'GITHUB_RUN_ATTEMPT'), ('revision', 'GITHUB_SHA')]}
        self.identity['run_url'] = (f"https://github.com/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/"
                                    f"{self.identity['run']}/attempts/{self.identity['run_attempt'] or '1'}")

    def record(self, kind, **fields):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if kind == 'missing':
            fields = {'token_source': 'unknown', 'resource': 'all', 'used': None, 'remaining': None, 'reset': None, **fields}
        row = dict(self.identity, kind=kind, timestamp=datetime.now(timezone.utc).isoformat(), **fields)
        with self.path.open('a') as output:
            output.write(json.dumps(row, separators=(',', ':')) + '\n')
        return row

    def boundary(self, boundary, source, token_id, token):
        request_id = 'sample-' + secrets.token_hex(16)
        self.record('request', request_id=request_id, token_source=source, token_id=token_id, protocol='REST', measurement=True)
        try:
            resources = self.sample(token)
        except (OSError, ValueError, KeyError, http.client.HTTPException) as error:
            # Diagnostic bodies can hold credentials. Only the failure's type is public evidence.
            self.record('sample', request_id=request_id, boundary=boundary, token_source=source, token_id=token_id,
                        resource='all', used=None, remaining=None, reset=None, missing=type(error).__name__)
            return
        for resource, rate in resources.items():
            self.record('sample', request_id=request_id, boundary=boundary, token_source=source, token_id=token_id,
                        resource=resource, **{key: rate[key] for key in ('used', 'remaining', 'reset')})

    def token(self, source, token):
        token_id = hashlib.sha256(token.encode()).hexdigest()[:24]
        if token_id not in self.tokens:
            self.tokens[token_id] = (source, token)
            self.boundary('before', source, token_id, token)
        return token_id

    def request(self, request_id, source, token, protocol):
        token_id = self.token(source, token)
        self.pending[request_id] = (source, token_id)
        self.record('request', request_id=request_id, token_source=source, token_id=token_id,
                    protocol=protocol, measurement=False)

    def response(self, request_id, status, headers):
        source, token_id = self.pending.pop(request_id)
        self.record('response', request_id=request_id, token_source=source, token_id=token_id, status=status)
        # Each response is a candidate last boundary, even when a token expires or is revoked before job end.
        resource = headers.get('x-ratelimit-resource')
        if resource and all(f'x-ratelimit-{key}' in headers for key in ('used', 'remaining', 'reset')):
            self.record('sample', boundary='response', request_id=request_id, token_source=source, token_id=token_id,
                        resource=resource, **{key: int(headers[f'x-ratelimit-{key}'])
                                              for key in ('used', 'remaining', 'reset')})

    def finish(self):
        for token_id, (source, token) in self.tokens.items():
            self.boundary('after', source, token_id, token)
        self.record('complete', pending=list(self.pending))


def measurement_sample(upstream, token, port=443, context=None):
    """Sample upstream directly; avoid the measuring proxy's hosts entry and count this attempt separately."""
    connection = http.client.HTTPSConnection('api.github.com', port, timeout=30, context=context)
    connection._create_connection = lambda address, timeout, source=None: socket.create_connection(
        (upstream, port), timeout, source)
    try:
        connection.request('GET', '/rate_limit', headers={**({'Authorization': f'Bearer {token}'} if token else {}),
                                                        'User-Agent': 'roundup-loop-measurement'})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError(f'rate sample HTTP {response.status}')
        resources = json.loads(response.read())['resources']
        if any(type(rate.get(key)) is not int for rate in resources.values() for key in ('used', 'remaining', 'reset')):
            raise ValueError('malformed rate sample')
        return resources
    finally:
        connection.close()


class ApiMeasurementProxy:
    """mitmproxy owns TLS and HTTP; this addon stores only counts, counter fields and token fingerprints."""
    def __init__(self):
        self.upstream = os.environ['LOOP_API_UPSTREAM']
        self.control = os.environ['LOOP_API_CONTROL']
        self.workflow_token = os.environ.get('GH_TOKEN', '')
        self.measurement = ApiMeasurement(Path(os.environ['LOOP_API_DIRECTORY']) / 'records.jsonl',
                                          lambda token: measurement_sample(self.upstream, token))

    def running(self):
        self.measurement.token('workflow', self.workflow_token)
        owner = Path(os.environ['LOOP_API_DIRECTORY']).stat()
        os.chown(self.measurement.path, owner.st_uid, owner.st_gid)
        Path(os.environ['LOOP_API_DIRECTORY'], 'ready').touch()

    def server_connect(self, data):
        data.server.sni = 'api.github.com'

    def _transport_error(self, data):
        self.measurement.record('missing', reason='GitHub connection failed before HTTP response headers')

    server_connect_error = _transport_error
    tls_failed_server = _transport_error

    def requestheaders(self, flow):
        from mitmproxy import http
        if flow.request.headers.get('x-loop-api-control') == self.control:
            self.measurement.finish()
            flow.response = http.Response.make(200, b'complete')
            return
        token = flow.request.headers.get('authorization', '').split(' ', 1)[-1]
        source = 'workflow' if token == self.workflow_token else 'installation' if token else 'anonymous'
        protocol = 'GraphQL' if flow.request.path.split('?', 1)[0] == '/graphql' else 'REST'
        self.measurement.request(flow.id, source, token, protocol)

    def responseheaders(self, flow):
        if flow.id in self.measurement.pending:
            self.measurement.response(flow.id, flow.response.status_code, flow.response.headers)

    def error(self, flow):
        if flow.id in self.measurement.pending:
            self.measurement.response(flow.id, None, {})
        else:
            self.measurement.record('missing', request_id=flow.id, reason='GitHub transport failed outside request headers')


def measurement_start():
    """Install a pinned library proxy on this disposable runner, before checkout or any role API operation."""
    directory = Path(os.environ['RUNNER_TEMP']) / 'loop-api-measurement'
    directory.mkdir(mode=0o700, exist_ok=True)
    upstream = socket.gethostbyname('api.github.com')
    control = secrets.token_hex(32)
    (directory / 'control').write_text(control)
    (directory / 'control').chmod(0o600)
    venv = directory / 'venv'
    subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True, timeout=60)
    subprocess.run([str(venv / 'bin/pip'), 'install', '--quiet', 'mitmproxy==12.2.3'], check=True, timeout=300)
    # Store no flows or diagnostic payloads. Only the addon's allowlisted JSONL becomes an artifact.
    addon = directory / 'addon.py'
    addon.write_text(f"import sys\nsys.path.insert(0, {str(Path(__file__).parent)!r})\n"
                     "from builder import ApiMeasurementProxy\naddons = [ApiMeasurementProxy()]\n")
    env = {**os.environ, 'LOOP_API_UPSTREAM': upstream, 'LOOP_API_CONTROL': control,
           'LOOP_API_DIRECTORY': str(directory)}
    with (directory / 'private.log').open('w') as log:
        proxy = subprocess.Popen(['sudo', '--preserve-env=GH_TOKEN,LOOP_API_UPSTREAM,LOOP_API_CONTROL,LOOP_API_DIRECTORY,'
                                  'GITHUB_WORKFLOW,GITHUB_RUN_ID,GITHUB_JOB,GITHUB_RUN_ATTEMPT,GITHUB_REPOSITORY',
                                  str(venv / 'bin/mitmdump'), '--quiet', '--listen-host', '127.0.0.1',
                                  '--mode', f'reverse:https://{upstream}:443@443', '--set', 'keep_host_header=true',
                                  '--set', f'confdir={directory / "ca"}', '-s', str(addon)],
                                 env=env, stdout=log, stderr=log)
    deadline = time.monotonic() + 60
    while not (directory / 'ready').exists():
        if proxy.poll() is not None or time.monotonic() > deadline:
            raise ValueError('API measurement proxy did not become ready; private diagnostics stay on runner')
        time.sleep(0.1)
    cert = directory / 'ca/mitmproxy-ca-cert.pem'
    subprocess.run(['sudo', 'cp', str(cert), '/usr/local/share/ca-certificates/loop-api-measurement.crt'],
                   check=True, timeout=30)
    subprocess.run(['sudo', 'update-ca-certificates'], check=True, capture_output=True, timeout=60)
    # Only api.github.com is redirected. Anthropic, OIDC, artifacts, caches and git traffic are untouched.
    with tempfile.NamedTemporaryFile(mode='w+') as hosts:
        hosts.write('127.0.0.1 api.github.com\n')
        hosts.flush()
        hosts.seek(0)
        subprocess.run(['sudo', 'tee', '-a', '/etc/hosts'], stdin=hosts,
                       stdout=subprocess.DEVNULL, check=True, timeout=30)
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        output.write(f'LOOP_API_MITMDUMP={venv / "bin/mitmdump"}\n')
        for name in ('NO_PROXY', 'no_proxy'):
            output.write(f'{name}={os.environ.get(name, "")},api.github.com\n')
        for name in ('NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'):
            output.write(f'{name}=/etc/ssl/certs/ca-certificates.crt\n')


def measurement_finish():
    """Always-run final samples and an exact-count summary; retain partial evidence when setup or an API failed."""
    directory = Path(os.environ['RUNNER_TEMP']) / 'loop-api-measurement'
    if not (directory / 'ready').exists():
        directory.mkdir(exist_ok=True)
        ApiMeasurement(directory / 'records.jsonl', None).record('missing', boundary='both',
                                                               reason='measurement setup did not complete')
    else:
        request = urllib.request.Request('https://api.github.com/__loop_measurement_finish',
                                        headers={'X-Loop-Api-Control': (directory / 'control').read_text()})
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                response.read()
        except (OSError, ValueError) as error:
            ApiMeasurement(directory / 'records.jsonl', None).record('missing', boundary='after',
                                                                   reason=type(error).__name__)
    rows = [json.loads(line) for line in (directory / 'records.jsonl').read_text().splitlines()]
    (directory / 'summary.json').write_text(json.dumps(orders.measurement_summary(rows), indent=2) + '\n')


def call(*args):
    return subprocess.run(['gh', *args], check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60).stdout


def comment(number, body):
    call('api', f'repos/{{owner}}/{{repo}}/issues/{number}/comments', '-f', f'body={body}')


def labels(number):
    return {label['name'] for label in orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}')['labels']}


def flag(number, why, label=NEEDS_USER):
    """Hold the Issue or PR once for whoever `label` (a key of `orders.WAITS`) names: add the label and a comment marked
    `<!-- needs-user -->` or `<!-- needs-mac -->` saying why, unless that label is already on."""
    if label in labels(number):
        return
    call('api', f'repos/{{owner}}/{{repo}}/issues/{number}/labels', '-f', f'labels[]={label}')
    comment(number, f'<!-- {label.removeprefix("flag:")} -->\n{why}')


def live_fixes():
    """Fix runs that have not ended, including runs waiting on a branch."""
    return [run for status in ('queued', 'in_progress', 'pending', 'waiting', 'requested')
            for page in orders.gh('api', '--paginate', '--slurp',
                                  f'repos/{{owner}}/{{repo}}/actions/workflows/fix.yml/runs?status={status}&per_page=100')
            for run in page['workflow_runs']]


def fix_runs(pr, head, cause):
    """Live fix runs for one dispatch identity, including runs waiting on a branch."""
    title = f'Fix PR #{pr}: {cause} @ {head}'
    return [run for run in live_fixes() if run['display_title'] == title]


def codex_slots(most, run_id=None):
    """The Issues build jobs hold, and how many of `most` Codex slots stay free: each queued or running build job and
    each live fix run other than `run_id` holds one (L23)."""
    taken = busy()
    return taken, most - len(taken) - sum(run['id'] != run_id for run in live_fixes())


def _fix_ref(pr, head, cause):
    if not re.fullmatch(r'[0-9a-f]{40}', head) or cause not in CAUSES or pr < 1:
        raise ValueError('fix identity requires a PR, known cause and full head')
    # The repository containing the ref supplies the repository part of the identity.
    return f'heads/loop-fix/{pr}/{cause}/{head}'


def _fix_read(ref):
    refs = json.loads(call('api', f'repos/{{owner}}/{{repo}}/git/matching-refs/{ref}', '-X', 'GET'))
    exact = [item for item in refs if item['ref'] == f'refs/{ref}']
    if not exact:
        return None, None
    sha = exact[0]['object']['sha']
    commit = json.loads(call('api', f'repos/{{owner}}/{{repo}}/git/commits/{sha}', '-X', 'GET'))
    return sha, json.loads(commit['message'].split('\n\n', 1)[0])


def _fix_api(path, data, method='POST'):
    with tempfile.NamedTemporaryFile('w') as body:
        json.dump(data, body)
        body.flush()
        answer = call('api', path, '-X', method, '--input', body.name)
    return json.loads(answer) if answer.strip() else None


def _fix_save(ref, previous, state):
    """Create once or fast-forward from exactly the version read; siblings cannot both win."""
    base = previous or json.loads(call('api', 'repos/{owner}/{repo}/git/ref/heads/main', '-X', 'GET'))['object']['sha']
    tree = json.loads(call('api', f'repos/{{owner}}/{{repo}}/git/commits/{base}', '-X', 'GET'))['tree']['sha']
    message = json.dumps(dict(state, write=secrets.token_hex(16)), sort_keys=True)
    message += f"\n\nAuthor-Agent: loop-{os.environ.get('GITHUB_RUN_ID', 'fixture')}"
    commit = _fix_api('repos/{owner}/{repo}/git/commits',
                      dict(message=message, tree=tree, parents=[base]))['sha']
    path = 'repos/{owner}/{repo}/git/refs' + (f'/{ref}' if previous else '')
    data = dict(sha=commit, force=False) if previous else dict(ref=f'refs/{ref}', sha=commit)
    try:
        _fix_api(path, data, 'PATCH' if previous else 'POST')
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        # Read back even an uncertain ref write: only our immutable commit proves we own it.
        current, _ = _fix_read(ref)
        if current == commit:
            return commit
        if current and current != previous:
            return None
        raise
    return commit


def _fix_listing(start, end, event):
    """Every fix.yml run created from `start` through `end` (epoch seconds), only `event` runs when one is named. GitHub
    serves at most 1,000 runs for a filtered search, so a window it truncates is read in two halves."""
    window = '..'.join(datetime.fromtimestamp(at, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') for at in (start, end))
    pages = orders.gh('api', '--paginate', '--slurp', f'repos/{{owner}}/{{repo}}/actions/workflows/fix.yml/runs?'
                      f"created={window}{f'&event={event}' if event else ''}&per_page=100")
    runs = [run for page in pages for run in page['workflow_runs']]
    if max((page['total_count'] for page in pages), default=0) <= len(runs):
        return runs
    if end <= start:
        raise ValueError(f'GitHub truncated the fix runs created at {window}; the listing is incomplete')
    middle = (start + end) // 2
    return _fix_listing(start, middle, event) + _fix_listing(middle + 1, end, event)


def _fix_matches(pr, head, cause, since=None):
    """Fix runs titled for this identity, from `since` or else from the head's commit: no run names a head before it
    exists. Only `check` and `rules` start a fix run directly; every other cause is dispatched."""
    title = f'Fix PR #{pr}: {cause} @ {head}'
    start = since if since is not None else orders.created(
        orders.gh('api', f'repos/{{owner}}/{{repo}}/commits/{head}')['commit']['committer']['date']) - SKEW
    runs = _fix_listing(int(start), int(time.time()) + SKEW, None if cause in DIRECT else 'workflow_dispatch')
    matches = []
    for run in runs:
        if run['display_title'] != title or (since is not None and orders.created(run['created_at']) < since - BEHIND):
            continue
        if run['status'] == 'completed':
            pages = orders.gh('api', '--paginate', '--slurp',
                              f"repos/{{owner}}/{{repo}}/actions/runs/{run['id']}/jobs?per_page=100")
            jobs = [job for page in pages for job in page['jobs']]
            # A skipped workflow never entered admission and cannot own or block a fix identity.
            if jobs and all(job['conclusion'] == 'skipped' for job in jobs):
                continue
        matches.append(run)
    return matches


def _fix_run(ref, sha, state, pr, head, cause):
    if state.get('run'):
        run = orders.gh('api', f"repos/{{owner}}/{{repo}}/actions/runs/{state['run']}")
        if run['display_title'] != f'Fix PR #{pr}: {cause} @ {head}':
            raise ValueError(f"owned run {state['run']} does not match {ref}; engineering repair required")
        return sha, state, run
    matches = _fix_matches(pr, head, cause, state['requested'])
    for wait in LISTED if not matches else ():
        time.sleep(wait)
        if matches := _fix_matches(pr, head, cause, state['requested']):
            break
    if len(matches) != 1:
        raise ValueError(f"fix delivery {'ambiguous' if matches else 'unknown'} for {ref}; "
                         f"owner {state['owner']}; matching runs {[run['id'] for run in matches]}; no redispatch")
    run = matches[0]
    adopted = dict(state, run=run['id'], phase='owned')
    saved = _fix_save(ref, sha, adopted)
    if not saved:
        return _fix_run(ref, *_fix_read(ref), pr, head, cause)
    return saved, adopted, run


def _fix_compatible(run):
    definition = json.loads(call('api', f"repos/{{owner}}/{{repo}}/contents/.github/workflows/fix.yml?ref={run['head_sha']}",
                                 '-X', 'GET'))
    return '# L82 retry-contract: 1' in base64.b64decode(definition['content']).decode()


def fix_admit(pr, head, cause, run_id):
    """Reject live duplicates before the branch queue and register the owned run durably."""
    earlier = [run['id'] for run in fix_runs(pr, head, cause) if run['id'] < run_id]
    if earlier:
        print(f'Skip fix: PR #{pr}, cause {cause}, head `{head}` already held by run {min(earlier)}.')
        return False
    ref = _fix_ref(pr, head, cause)
    sha, state = _fix_read(ref)
    if state and state.get('run') not in (None, run_id):
        print(f"Skip fix: {ref} owned by run {state['run']}; retry that run.")
        return False
    if state and not state.get('run'):
        sha, state, _ = _fix_run(ref, sha, state, pr, head, cause)
        if state['run'] != run_id:
            print(f"Skip fix: {ref} owned by run {state['run']}.")
            return False
    if not state:
        run = orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run_id}')
        if run['display_title'] != f'Fix PR #{pr}: {cause} @ {head}':
            raise ValueError('admission run does not match the exact fix identity')
        state = dict(owner=f'run-{run_id}', run=run_id, phase='owned', infrastructure=0)
        if not _fix_save(ref, None, state):
            return fix_admit(pr, head, cause, run_id)
    print(f"Fix owner: run {run_id}, run_attempt {os.environ.get('GITHUB_RUN_ATTEMPT', '1')}.")
    return True


def dispatch_fix(pr, head, cause):
    """One durable raw dispatch per identity; completed owners retry the whole workflow run. Whether it started a run."""
    ref = _fix_ref(pr, head, cause)
    sha, state = _fix_read(ref)
    send = False
    if not state:
        matches = _fix_matches(pr, head, cause)
        if len(matches) > 1:
            raise ValueError(f'fix identity {ref} has ambiguous historical runs {[run["id"] for run in matches]}')
        state = dict(owner=secrets.token_hex(16), requested=int(time.time()), infrastructure=0,
                     phase='owned' if matches else 'dispatch', run=matches[0]['id'] if matches else None)
        sha = _fix_save(ref, None, state)
        if not sha:
            _, owned = _fix_read(ref)
            owner = owned.get('run') or owned['owner']
            print(f'Skip fix dispatch: {ref} already has durable owner {owner}.', file=sys.stderr)
            return
        send = not matches
    if state['phase'] == 'undelivered':
        state = dict(state, owner=secrets.token_hex(16), requested=int(time.time()), phase='dispatch')
        sha = _fix_save(ref, sha, state)
        if not sha:
            return
        send = True
    if send:
        # A direct trigger may have appeared since lookup, including after a confirmed undelivered request.
        matches = _fix_matches(pr, head, cause)
        if len(matches) > 1:
            raise ValueError(f'fix identity {ref} has ambiguous runs {[run["id"] for run in matches]}; no dispatch')
        if matches:
            state = dict(state, run=matches[0]['id'], phase='owned')
            sha = _fix_save(ref, sha, state)
            if not sha:
                return
            send = False
    if send:
        current, owned = _fix_read(ref)
        if current != sha:
            print(f'Skip fix dispatch: {ref} now belongs to owner {owned["owner"]}.', file=sys.stderr)
            return
        try:
            _fix_api('repos/{owner}/{repo}/actions/workflows/fix.yml/dispatches',
                     dict(ref='main', inputs=dict(pr=str(pr), head=head, cause=cause)))
        except subprocess.CalledProcessError as error:
            # Only an explicit validation refusal proves that no run was created.
            if 'HTTP 422' in (error.stderr or ''):
                _fix_save(ref, sha, dict(state, phase='undelivered'))
            raise
    sha, state, run = _fix_run(ref, sha, state, pr, head, cause)
    print(f"Fix identity {ref}: run {run['id']}, run_attempt {run['run_attempt']}; "
          f"counted fix attempts {state.get('fix_attempts', 'unknown (read PR fix-attempt records)')}.", file=sys.stderr)
    if state['phase'] == 'unavailable':
        raise ValueError(f"run {run['id']} retry unavailable: {state['reason']}; no replacement dispatch")
    if state['phase'] == 'rerun':
        if run['run_attempt'] <= state['attempt']:
            raise ValueError(f"rerun delivery unknown for run {run['id']}, attempt {state['attempt'] + 1}; no resend")
        sha = _fix_save(ref, sha, dict(state, phase='owned'))
        if not sha:
            return
        state = dict(state, phase='owned')
    if run['status'] != 'completed':
        print(f"Skip fix dispatch: owned run {run['id']} is {run['status']}.", file=sys.stderr)
        return send
    if state.get('completions', {}).get(str(run['run_attempt'])) == 'pending':
        raise ValueError(f"run {run['id']} completion is unknown; reconcile before another model attempt")
    task = state.get('task', {})
    if state.get('transient_reads', 0) >= 3:
        raise ValueError(f'::error::fix identity {ref} exhausted three transient task read failures; no further retry')
    if task.get('kind') == 'read-failed':
        raise ValueError(f"run {run['id']} has a required read failure: {task['reason']}; engineering repair required")
    if time.time() < task.get('retry_at', 0):
        print(f"Skip fix retry: installation API recovers at {task['retry_at']}.", file=sys.stderr)
        return
    rate = orders.gh('api', '/rate_limit')['resources']['core']
    if not rate['remaining']:
        print(f"Skip fix retry: installation API rate limit; reset {rate['reset']}.", file=sys.stderr)
        return
    if not fix_task(pr, head, cause, run.get('html_url', ''), prepare=False):
        return
    if not _fix_compatible(run):
        raise ValueError(f"run {run['id']} has an incompatible historical workflow definition; engineering repair required")
    infrastructure = not state.get('worked', {}).get(str(run['run_attempt']), False) and (
        task.get('kind') in ('api-limit', 'setup-failed', 'transient-read') or run.get('conclusion') == 'failure')
    if infrastructure and state['infrastructure'] >= RERUNS:
        raise ValueError(f"run {run['id']} exhausted six infrastructure reruns; engineering repair required")
    pending = dict(state, phase='rerun', attempt=run['run_attempt'],
                   infrastructure=state['infrastructure'] + int(infrastructure))
    saved = _fix_save(ref, sha, pending)
    if not saved:
        print(f"Skip fix retry: run {run['id']} already has a pending rerun.", file=sys.stderr)
        return
    # Full rerun, never --failed: admission, branch exclusion and task preparation all run again.
    try:
        _fix_api(f"repos/{{owner}}/{{repo}}/actions/runs/{run['id']}/rerun", {})
    except subprocess.CalledProcessError as error:
        if re.search(r'HTTP (?:401|403|404|422)\b', error.stderr or ''):
            _fix_save(ref, saved, dict(pending, phase='unavailable', reason=error.stderr.strip()))
        raise
    return True


def role(name):
    """The prompt `.agents/<name>.md` beside this `loop/`."""
    return (ROOT / '.agents' / f'{name}.md').read_text()


def prompt(task, output, name='builder'):
    """Append the step output `prompt`: `.agents/<name>.md` (the Builder's unless a role is named), a `## Task` heading,
    then the task."""
    issue = re.search(r'^Work order: https://github\.com/[^/]+/[^/]+/issues/(\d+)\s*$', task, re.M)
    branch = re.search(r'Build on branch (build/[^ ]+) from origin/main\.', task)
    if name == 'builder' and issue and branch:
        exhausted = orders.marked(int(issue[1]), '<!-- fix-exhausted')
        if exhausted:
            last = max(exhausted, key=lambda found: found['created_at'])['body']
            pr = re.match(r'<!-- fix-exhausted #(\d+) -->', last)
            if not pr:
                raise ValueError('the latest fix-exhausted comment names no PR')
            task = task.replace(branch[0], f'Build on branch {branch[1]} from refs/pull/{pr[1]}/head; '
                                'fetch that ref and merge origin/main before repairing its findings. '
                                'Take another approach only when a finding rejects the approach itself.')
            task += f'\n\n## Last exhausted PR\n\n{last}\n'
    delimiter = 'PROMPT_' + secrets.token_hex(8)
    with open(output, 'a') as out:
        out.write(f'prompt<<{delimiter}\n{role(name)}\n## Task\n\n{task.rstrip()}\n{delimiter}\n')


def asked(answer):
    """The `ask` in a build run's JSON `answer`, stripped; '' for none."""
    return (json.loads(answer).get('ask') or '').strip() if answer.strip() else ''


def question(answer, branch):
    """What a run that worked asks the user (L79): the `Stopped:` paragraph of the open draft PR on `branch`, or, with no
    open PR there, the `ask` in the run's JSON `answer`; '' for none."""
    prs = orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'isDraft,body')
    if not prs:
        return asked(answer)
    return stopped(prs[0]) if prs[0]['isDraft'] else ''


def _window_ask(ask):
    """Remove native window observations from an open PR's ask; keep unknown questions for the user.

    L79 forbids a waiting label even when Haiku fails or misclassifies. Split independent clauses before matching so
    a product or real-Claude question beside a window observation survives that guard.
    """
    native = re.compile(r"just app|native (?:Mac |App )?(?:window|observer|behavio[ur]+|title[- ]?bar)|traffic[- ]lights?|"
                        r"(?:Mac|App) (?:window|title[- ]?bar)|Window menu|Mission Control|"
                        r"(?:actual|native) (?:drag|zoom)|modifier clicks?", re.I)
    if not native.search(ask):
        return ask
    clauses = re.split(r'(?<=[.?!;])\s+|\n+|\s+(?:and|but|also)\s+'
                       r'(?=(?:should|does|whether|which|check|verify|observe|native|real|logged[- ]in)\b)',
                       ask.removeprefix('Stopped:').strip(), flags=re.I)
    kept = []
    for clause in clauses:
        if re.search(r'logged[- ]in.*\bclaude|real\s+`?claude', clause, re.I):
            kept.append(clause)
        elif native.search(clause):
            choice = re.search(r'should\b.*\b(?:show|hide|include|offer|support)|'
                               r'which\b.*\b(?:choose|prefer)|unresolved product', clause, re.I)
            observation = re.search(r'\b(?:correct(?:ly)?|right|pass|current|work(?:ing)?|expected|matches)\b',
                                    clause, re.I)
            if choice and not observation:
                kept.append(clause)
        elif re.search(r'^(?:Recommend.*(?:observer|that commit)|all passes allow readiness|'
                       r'any failure names the repair|recording each pass)', clause, re.I):
            continue
        else:
            kept.append(clause)
    return ' '.join(kept).strip()


def screen(ask, open_pr=False):
    """Haiku's verdict on what a run asks the user (L79, `.agents/screen.md`): a dict of `verdict` (one of `VERDICTS`),
    `reason` and `preview`. A native-only open-PR ask stays `loop` on failure; other failures return None."""
    context = '\nThis ask belongs to an open PR.\n' if open_pr else ''
    failure = ''
    try:
        out = subprocess.run(['claude', '-p', '--model', SCREEN_MODEL, '--tools', '', '--max-turns', '3',
                              '--output-format', 'json', '--json-schema', json.dumps(SCREEN_SCHEMA)],
                             input=f'{role("screen")}{context}\n## Ask\n\n{ask}\n', text=True, capture_output=True,
                             timeout=300, check=True)
        verdict = json.loads(out.stdout).get('structured_output')
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError) as error:
        print(f'screen: Claude Code gave no verdict: {error}', file=sys.stderr)
        failure, verdict = str(error), None
    if not (isinstance(verdict, dict) and verdict.get('verdict') in VERDICTS and
            all(isinstance(verdict.get(field), str) and verdict[field].strip() for field in ('reason', 'preview'))):
        failure = failure or 'missing or malformed structured output'
        verdict = None
    if open_pr and not _window_ask(ask):
        reason = 'An open PR never waits on a native window check (L79).'
        if failure:
            reason += f' The screen gave no valid verdict: {failure}; repair screening in the loop.'
        return dict(verdict='loop', reason=reason,
                    preview='Finish Linux and Chromium checks and make the PR ready with auto-merge armed.')
    return verdict


def put(number, ask, verdict, run_url, back):
    """Send what a run asked the user where `screen`'s verdict says (L79): `loop` calls `back` with the screen's reason,
    `mac` holds Issue or PR `number` for an agent on the user's Mac, and `user` asks the user, preview first. With no
    verdict the user gets the ask, told it went unscreened."""
    if verdict is None:
        flag(number, f'{ask}\n\nThe screen gave no verdict, so this reached you unscreened: {run_url}')
    elif verdict['verdict'] == 'loop':
        back(verdict['reason'])
    elif verdict['verdict'] == 'mac':
        flag(number, f"{verdict['preview']}\n\n{ask}", NEEDS_MAC)
    else:
        flag(number, f"{verdict['preview']}\n\n---\n\n{ask}")


def worked(path):
    """A run worked when its model used a tool, read from claude-code-action's execution file (a JSON array) or Codex's
    `--json` event lines; a usage limit or a setup failure leaves no tool use."""
    if not path or not Path(path).is_file():
        return False
    text = Path(path).read_text()
    if text.lstrip().startswith('['):
        return any(entry.get('type') == 'assistant' and
                   any(part.get('type') == 'tool_use' for part in entry.get('message', {}).get('content', []))
                   for entry in json.loads(text))
    return any(json.loads(line).get('item', {}).get('type') in CODEX_TOOLS for line in text.splitlines() if line.strip())


def app_token(rights=RIGHTS):
    """A fresh Claude App token for this job holding `rights`, traded for its OIDC token as claude-code-action does
    (L23), masked in the log."""
    request = urllib.request.Request(f"{os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']}&audience={AUDIENCE}",
                                     headers={'Authorization': f"bearer {os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        oidc = json.load(response)['value']
    request = urllib.request.Request(EXCHANGE, data=json.dumps({'permissions': rights}).encode(), method='POST',
                                     headers={'Authorization': f'Bearer {oidc}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        answer = json.load(response)
    token = answer.get('token') or answer.get('app_token')
    if not token:
        raise ValueError('the App token exchange answered no token')
    print(f'::add-mask::{token}')
    return token


def read_call(cli, args, token_file):
    """Run a CLI read with the shared App token; one 401 renews it, a second remains a failed read (L107)."""
    with token_file.open() as shared:
        fcntl.flock(shared, fcntl.LOCK_SH)
        token = shared.read()
    env = {**os.environ, 'GH_TOKEN': token}
    result = subprocess.run([cli, *args], env=env, capture_output=True, timeout=180)
    if result.returncode and orders.status(result.stderr.decode(errors='replace')) == 401:
        # Collectors read concurrently: a renewal another reader finished already supplies the retry's token.
        with token_file.open('r+') as shared:
            fcntl.flock(shared, fcntl.LOCK_EX)
            fresh = shared.read()
            if fresh == token:
                with redirect_stdout(sys.stderr):
                    fresh = app_token({'contents': 'read', 'issues': 'read', 'pull_requests': 'read',
                                       'actions': 'read', 'checks': 'read'})
                shared.seek(0)
                shared.write(fresh)
                shared.truncate()
                shared.flush()
        result = subprocess.run([cli, *args], env={**env, 'GH_TOKEN': fresh}, capture_output=True, timeout=180)
    result.check_returncode()
    return result


def codex(prompt, model, schema, output):
    """L23: run `prompt` on Codex's `model` in this checkout, signed in with the ChatGPT login in `CODEX_AUTH`, `git` and
    `gh` holding a fresh App token with a run's rights, answering the JSON Schema `schema` unless it is None. Appends the
    step output `execution_file`, Codex's event lines, before the run starts, so a run cut off still leaves them, then
    `structured_output`, its answer; revokes the token after. Returns Codex's exit code."""
    login = os.environ.pop('CODEX_AUTH', '')
    auth = json.loads(login or '{}')
    if auth.get('auth_mode') != 'chatgpt' or not auth.get('tokens'):
        raise ValueError('CODEX_AUTH holds no ChatGPT login: seed the CODEX_AUTH_JSON secret with `codex login`')
    # GitHub masks the whole secret, not each token inside it.
    tokens = sorted({value for value in auth['tokens'].values() if isinstance(value, str) and value},
                    key=len, reverse=True)
    for value in auth['tokens'].values():
        if isinstance(value, str) and value:
            print(f'::add-mask::{value}')
    # Outside the checkout, so no commit takes the login.
    home = Path(os.environ['RUNNER_TEMP']) / 'codex'
    home.mkdir(mode=0o700)
    (home / 'auth.json').write_text(login)
    (home / 'config.toml').write_text('cli_auth_credentials_store = "file"\n')
    events, answer = home / 'events.jsonl', home / 'answer.json'
    with open(output, 'a') as out:
        out.write(f'execution_file={events}\n')
    command = ['codex', 'exec', '--json', '--model', model, '--sandbox', 'danger-full-access',
               '--output-last-message', str(answer)]
    if schema is not None:
        (home / 'schema.json').write_text(schema)
        command += ['--output-schema', str(home / 'schema.json')]
    name, email = CODEX_ACCOUNT
    env = {**os.environ, 'CODEX_HOME': str(home), 'GH_TOKEN': app_token(RUN_RIGHTS), 'GIT_AUTHOR_NAME': name,
           'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
    facts = dict(error=False, messages=[], worked=False, exit=None)
    try:
        subprocess.run(['gh', 'auth', 'setup-git', '--hostname', 'github.com'], env=env, check=True, timeout=60)
        # Public logs keep event kinds and masked failures; commands, outputs and agent text stay private.
        with open(events, 'w') as log, (home / 'stderr.log').open('w') as errors, subprocess.Popen(
                [*command, '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                text=True, env=env, stderr=errors) as run:
            run.stdin.write(prompt)
            run.stdin.close()
            for line in run.stdout:
                log.write(line)
                log.flush()
                try:
                    event = json.loads(line)
                except ValueError:
                    event = {}
                if not isinstance(event, dict):
                    event = {}
                kind = event.get('type') if isinstance(event.get('type'), str) else 'not an event'
                error = event.get('error')
                item = event.get('item')
                item_kind = item.get('type', '') if isinstance(item, dict) else ''
                if not isinstance(item_kind, str):
                    item_kind = ''
                message = event.get('message') if kind == 'error' else (
                    error.get('message') if kind == 'turn.failed' and isinstance(error, dict) else None)
                facts['error'] |= kind == 'error'
                facts['worked'] |= item_kind in CODEX_TOOLS
                if isinstance(message, str):
                    for token in tokens:
                        message = message.replace(token, '***')
                    facts['messages'].append(message)
                # JSON escapes keep an error's newlines from becoming Actions commands or forged evidence rows.
                print(kind, json.dumps(message, ensure_ascii=False)[1:-1] if isinstance(message, str) else
                      item_kind, flush=True)
                # A timeout may prevent the final row; tool-use facts still prove recovery.
                print('CODEX_COMPLETION ' + json.dumps(facts), flush=True)
        facts['exit'] = run.returncode
        print('CODEX_COMPLETION ' + json.dumps(facts), flush=True)
    finally:
        subprocess.run(['gh', 'api', '-X', 'DELETE', '/installation/token'], env=env, timeout=60)
    if schema is not None and answer.is_file():
        delimiter = 'ANSWER_' + secrets.token_hex(8)
        with open(output, 'a') as out:
            out.write(f'structured_output<<{delimiter}\n{answer.read_text().strip()}\n{delimiter}\n')
    return run.returncode


def codex_login():
    """Main's serial L23 completion observer. Read only masked facts from model-job logs, never the private events."""
    issues = [issue for page in orders.gh('api', '--paginate', '--slurp',
                                         'repos/{owner}/{repo}/issues?state=open&per_page=100')
              for issue in page if not issue.get('pull_request') and issue['user']['login'] == orders.BOT and
              re.search(r'^Key: codex-login$', issue.get('body') or '', re.M)]
    opened = [issue for issue in issues if issue['state'] == 'open']
    for issue in opened:
        order = re.search(r'<!-- codex-order (\S+) (\d+) (\d+) -->', issue.get('body') or '')
        issue['order'] = (order[1], int(order[2]), int(order[3])) if order else (issue['created_at'], 0, 0)
    runs = []
    for workflow in ('build', 'fix'):
        pages = orders.gh('api', '--paginate', '--slurp',
                          f'repos/{{owner}}/{{repo}}/actions/workflows/{workflow}.yml/runs?per_page=100')
        found = list({run['id']: run for page in pages for run in page['workflow_runs']}.values())
        if pages and len(found) < pages[0]['total_count']:
            raise ValueError('Codex completion history was truncated')
        runs.extend(found)
    runs = list({run['id']: run for run in runs}.values())
    # A completed run's update is an upper bound on its jobs' completion times. Live runs have no such bound.
    runs.sort(key=lambda run: (run['status'] != 'completed', run['updated_at']), reverse=True)
    jobs = []
    for run in runs:
        if run['status'] == 'queued':
            continue
        cutoff = min([jobs[-2]['completed_at']] + [issue['order'][0] for issue in opened]) if len(jobs) >= 2 else ''
        if run['status'] == 'completed' and cutoff and run['updated_at'] < cutoff:
            break
        pages = orders.gh('api', '--paginate', '--slurp',
                          f"repos/{{owner}}/{{repo}}/actions/runs/{run['id']}/jobs?filter=all&per_page=100")
        for page in pages:
            for job in page['jobs']:
                if job['status'] == 'completed' and (
                        re.fullmatch(r'build #\d+ / build', job['name']) or
                        job['name'].startswith('fix / fix #')):
                    jobs.append(dict(job, run_id=run['id']))
        jobs = sorted({job['id']: job for job in jobs}.values(),
                      key=lambda job: (job['completed_at'], job['run_id'], job['id']))
    if not jobs:
        return
    jobs = [job for job in jobs if job in jobs[-2:] or
            any(job['completed_at'] >= issue['order'][0] for issue in opened)]
    for job in jobs:
        # A cancelled or skipped job breaks the pair, including jobs whose model never started.
        job['facts'] = dict(error=False, messages=[], worked=False, exit=None)
        if job['conclusion'] == 'skipped':
            continue
        for attempt in range(1, orders.READ_TRIES + 1):
            try:
                log = call('api', f"repos/{{owner}}/{{repo}}/actions/jobs/{job['id']}/logs")
                break
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                detail = (error.stderr or '') if isinstance(error, subprocess.CalledProcessError) else 'timed out'
                delay = orders.backoff(detail, attempt)
                if attempt == orders.READ_TRIES or delay is None:
                    raise
                print(f"Codex job {job['id']} log read failed; retry in {delay}s", file=sys.stderr)
                time.sleep(delay)
        rows = re.findall(r'^\S+ CODEX_COMPLETION (.*)$', log, re.M)
        if not rows:
            # In-flight runs can still use main's previous kind-only logger when this observer first lands.
            job['facts']['error'] = bool(re.search(r'^\S+ error(?:[ \t]|$)', log, re.M))
            tools = '|'.join(sorted(CODEX_TOOLS))
            job['facts']['worked'] = bool(re.search(rf'^\S+ item\.\S+ ({tools})(?:[ \t]|$)', log, re.M))
        else:
            facts = json.loads(rows[-1])
            if (set(facts) != {'error', 'messages', 'worked', 'exit'} or
                    type(facts['error']) is not bool or type(facts['worked']) is not bool or
                    (facts['exit'] is not None and type(facts['exit']) is not int) or not isinstance(facts['messages'], list) or
                    any(not isinstance(message, str) for message in facts['messages'])):
                raise ValueError('invalid masked Codex completion facts')
            job['facts'] = facts
    latest = jobs[-1]
    # GitHub's since filter is exclusive; include alerts updated in the job's completion second.
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(orders.created(latest['completed_at']) - 1))
    # Recently closed alerts retain replay identity without scanning the repository's closed Issue history.
    issues.extend(issue for page in orders.gh('api', '--paginate', '--slurp',
                  f"repos/{{owner}}/{{repo}}/issues?state=closed&since={since}&per_page=100")
                  for issue in page if not issue.get('pull_request') and issue['user']['login'] == orders.BOT and
                  re.search(r'^Key: codex-login$', issue.get('body') or '', re.M))
    # A tool-using job proves recovery even when a later engineering step fails.
    recovered = []
    for issue in opened:
        recovery = next((job for job in jobs if job['facts']['worked'] and
                         (job['completed_at'], job['run_id'], job['id']) > issue['order']), None)
        if recovery is None:
            continue
        marker = f"<!-- codex-recovery {recovery['id']} -->"
        notes = orders.marked(issue['number'], '<!--')
        if not any(marker in note['body'] for note in notes):
            comment(issue['number'], f"{marker}\nCodex used a tool again: {recovery['html_url']}")
        if NEEDS_USER in {label['name'] for label in issue['labels']}:
            call('api', f"repos/{{owner}}/{{repo}}/issues/{issue['number']}/labels/{NEEDS_USER}", '-X', 'DELETE')
        call('issue', 'close', str(issue['number']), '--reason', 'completed')
        recovered.append(issue['number'])
    opened = [issue for issue in opened if issue['number'] not in recovered]
    qualifies = lambda job: (job['conclusion'] not in ('success', 'cancelled', 'skipped') and
                             job['facts']['error'] and not job['facts']['worked'])
    jobs = jobs[-2:]
    if len(jobs) != 2 or not all(qualifies(job) for job in jobs):
        return
    marker = f"<!-- codex-failure {latest['id']} -->"
    if any(issue['state'] == 'closed' and marker in (issue.get('body') or '') for issue in issues):
        return
    messages = [message for job in jobs for message in job['facts']['messages']]
    quote = '\n'.join('> ' + line for message in messages for line in message.splitlines()) or '> No masked error message was published.'
    usage = any(re.search(r'usage.?limit|rate.?limit|quota|limit.*reached', message, re.I)
                for job in jobs for message in job['facts']['messages'])
    if usage:
        reset = any(re.search(r'\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|'
                              r'(?:try again|resets?|retry)\s+(?:at|in|after|on)\s+\S+', message, re.I)
                    for message in messages)
        instruction = ('Wait until the reset time supplied in the error before retrying.' if reset else
                       'The error supplied no reset time. Wait for usage to reset before retrying.')
    else:
        instruction = ('Run `codex login` in a separate `CODEX_HOME` with '
                       '`cli_auth_credentials_store = "file"`, then replace the repository’s '
                       '`CODEX_AUTH_JSON` secret with that home’s `auth.json`.')
    body = (f"{marker}\n<!-- codex-order {latest['completed_at']} {latest['run_id']} {latest['id']} -->\n"
            "Key: codex-login\n\nTwo consecutive Codex jobs failed before using a tool.\n\n"
            f"{quote}\n\n{jobs[0]['html_url']}\n{latest['html_url']}\n\n{instruction}")
    if opened:
        # Repair a partially published alert without asking a second time.
        issue = opened[0]
    else:
        issue = _fix_api('repos/{owner}/{repo}/issues',
                         dict(title='Codex login needs the owner', body=body, labels=[NEEDS_USER]))
    notes = orders.marked(issue['number'], '<!--')
    if not any('<!-- needs-user -->' in note['body'] for note in notes):
        comment(issue['number'], '<!-- needs-user -->\n' + body)
    if NEEDS_USER not in {label['name'] for label in issue.get('labels', [])}:
        call('api', f"repos/{{owner}}/{{repo}}/issues/{issue['number']}/labels", '-f', f'labels[]={NEEDS_USER}')


def keep(branch, issue, run_url):
    """L23: the action's App token lasts an hour and a run may not. When the commits a run left beyond `main` for `branch`
    are not all on GitHub, or `issue` is still ready with no open PR from `branch`, push them with a fresh token and
    open a draft naming the Issue, which `built` hands to L81, then revoke the token."""
    def is_descendant(tip, ref):
        return subprocess.run(['git', 'merge-base', '--is-ancestor', ref, tip], capture_output=True,
                              timeout=60).returncode == 0
    # A fix run may commit on another branch and push HEAD to the PR's branch, leaving its local branch stale.
    source = f'refs/heads/{branch}'
    refs = subprocess.run(['git', 'for-each-ref', '--format=%(refname)', f'--contains={source}', 'refs/heads/'],
                          text=True, capture_output=True, timeout=60)
    if refs.returncode == 0:
        tips = refs.stdout.splitlines()
        if is_descendant('HEAD', source):
            tips.insert(0, 'HEAD')
        source = next((tip for tip in tips if all(is_descendant(tip, other) for other in tips)), None)
        if source is None:
            raise ValueError(f'{branch} has divergent local branches; cannot keep all commits with one push')
    ahead = subprocess.run(['git', 'rev-list', '--count', f'refs/remotes/origin/main..{source}'], text=True,
                           capture_output=True, timeout=60)
    if ahead.returncode or ahead.stdout.strip() == '0':
        print(f'{branch} holds no commit beyond main; nothing to keep')
        return
    if owner_closed(*([issue] if issue else []), *closed_prs(branch)):
        print(f'the owner closed #{issue} or a PR on {branch}; nothing to push')
        return
    # A push the run made moved its remote-tracking ref; a run that pushed and opened its PR needs no token.
    draft = issue is not None and not orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'number') \
        and orders.queued(issue)
    pushed = is_descendant(f'refs/remotes/origin/{branch}', source)
    if pushed and not draft:
        print(f'{branch} is on GitHub; nothing to keep')
        return
    # From here on `gh`, and L97's pre-push hook under `git push`, act with the fresh token.
    token = os.environ['GH_TOKEN'] = app_token()
    try:
        remote = f"https://x-access-token:{token}@github.com/{os.environ['GITHUB_REPOSITORY']}.git"
        push = ['git', 'push', remote, f'{source}:refs/heads/{branch}']
        # L97's hook may renumber a scenario id in a new commit and fail the push; the second push carries that commit.
        if not pushed and subprocess.run(push, timeout=300).returncode:
            subprocess.run(push, timeout=300, check=True)
        if not draft:
            return
        order = orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{issue}')
        ids = orders.field(order['body'] or '', 'Scenarios', '')
        # `.agents/data/pr.md`'s title and body lines, which the fix run finishing the draft keeps.
        print(call('pr', 'create', '--draft', '--base', 'main', '--head', branch, '--title',
                   f"{ids}: {order['title']}" if ids else order['title'], '--body',
                   f'Refs #{issue}\n' + (f'Scenarios: {ids}\n' if ids else '') + f'\nThe run {run_url} ended with these '
                   'commits and no open PR, so `keep` pushed them with a fresh App token and opened this draft (L23); a '
                   'fix run finishes it.'), end='')
    finally:
        call('api', '-X', 'DELETE', '/installation/token')


def busy():
    """Issues whose `build #<issue> / build` job (`build #<issue>` before build-issue.yml) has not completed in any
    unfinished build.yml run; its `after` job holds no slot."""
    issues = set()
    for status in ('requested', 'pending', 'waiting', 'queued', 'in_progress'):
        runs = orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/workflows/build.yml/runs?status={status}&per_page=100')
        for run in runs['workflow_runs']:
            for job in orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run["id"]}/jobs?per_page=100')['jobs']:
                match = re.fullmatch(r'build #(\d+)(?: / build)?', job['name'])
                if match and job['status'] != 'completed':
                    issues.add(int(match[1]))
    return issues


def choose(rows, taken, free):
    """L96 repair entries for invalid orders, then ready rows, no build job holding either, at most `free` of them."""
    broken = [dict(issue=row['issue'], slug=f"repair-{row['issue']}", repair=True) for row in orders.invalid(rows)
              if row['issue'] not in taken and not row['flagged'] and not row.get('held')]
    ready = [dict(issue=row['issue'], slug=row['slug']) for row in rows if row['state'] == 'ready' and row['issue'] not in taken]
    return (broken + ready)[:max(0, free)]


def latest(pr, names):
    """The check run of each of `names` that ended last on the PR's head. A name counts once no run of its workflow is
    still going on that head: a newer run on the same head supersedes an older run's result (L82)."""
    going = running(pr)
    last = {}
    for check in pr.get('statusCheckRollup') or []:
        name = check.get('name') or check.get('context')
        if name in names and check.get('workflowName') not in going and \
                (check.get('completedAt') or '') >= (last.get(name, {}).get('completedAt') or ''):
            last[name] = check
    return last


def read_failures(pr, *, rerun=False):
    """Failed required checks on this head; an exhausted rules API read reruns its job, never a fix (L82)."""
    failures = []
    for name, check in latest(pr, ('check', 'rules', 'review', 'critic')).items():
        if (check.get('conclusion') or check.get('state')) != 'FAILURE':
            continue
        job = re.search(r'/actions/runs/(\d+)/job/(\d+)$', check.get('detailsUrl') or '')
        if name == 'rules' and job:
            log = call('run', 'view', job[1], '--job', job[2], '--log-failed')
            exhausted = re.search(r'(?:^|[\t ])LOOP_RULES_API_LIMIT: GitHub refused the rules read; rerun this job\.$', log, re.M)
            # Heads checked before retry support must not spend a fix attempt after main learns to retry.
            legacy = (re.search(r'Run loop/rules\.sh (ci-trailers|keeps-main|overturned|captures) ', log) and
                      'gh: API rate limit exceeded' in log and 'Process completed with exit code 4.' in log)
            if exhausted or legacy:
                if rerun:
                    call('run', 'rerun', job[1], '--job', job[2])
                continue
        failures.append(name)
    return failures


def blame(pr, cause):
    """Who failed the `check` or `rules` cause on the PR's head, judged on the jobs that failed it (L82): 'pr' when one
    of them passed on each `main` push the PR's run could have merged, from its merge base until that job started;
    'main-failed' while `main`'s latest result still fails, 'main-pending' for an unfinished push; 'base' once `main`
    passes each again. A job a newer push cancelled on `main` gives no result."""
    workflow, names = LANES[cause]
    jobs = {name: check for name, check in latest(pr, names).items() if check.get('conclusion') == 'FAILURE'}
    if not jobs:
        return 'pr'
    compare = orders.gh('api', f'repos/{{owner}}/{{repo}}/compare/{pr["headRefOid"]}...main')
    window = {compare['merge_base_commit']['sha'], *(commit['sha'] for commit in compare['commits'])}
    pushes = orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/workflows/{workflow}/runs?branch=main&event=push'
                              '&per_page=100')['workflow_runs']
    seen = {}

    def result(push, name):
        """The job's conclusion on that `main` push, 'pending' before it ends, or None when the push has no such job."""
        if push['id'] not in seen:
            listed = orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{push["id"]}/jobs')['jobs']
            seen[push['id']] = {job['name']: job for job in listed}
        job = seen[push['id']].get(name)
        if job is None:
            return 'pending' if push['status'] != 'completed' else None
        return job['conclusion'] if job['status'] == 'completed' else 'pending'

    verdicts = set()
    for name, check in jobs.items():
        merged = [result(push, name) for push in pushes
                  if push['head_sha'] in window and orders.created(push['created_at']) < orders.created(check['startedAt'])]
        if 'failure' not in merged:
            verdicts.add('main-pending' if 'pending' in merged else 'pr')
            continue
        now = next((found for push in pushes if (found := result(push, name)) in ('success', 'failure')), None)
        verdicts.add('base' if now == 'success' else 'main-failed' if now == 'failure' else 'main-pending')
    return next(verdict for verdict in ('pr', 'main-pending', 'main-failed', 'base') if verdict in verdicts)


def stopped(pr):
    """The PR body's `Stopped:` paragraph, from that line to the next blank one: the question its Builder ended on for the
    user; '' for none."""
    found = STOPPED.search(pr['body'] or '')
    return found[0].strip() if found else ''


def held(pr):
    """L102: whether the PR's Issue has an open native blocked-by dependency, so no fix or review run starts on the PR."""
    issue = orders.linked_issue(pr['body'])
    return bool(issue) and bool(orders.blockers(issue))


def owner_answered(pr):
    """L102: whether a draft PR holding a `Stopped:` line has an owner comment, on it or on its Issue, newer than its last
    commit and than the last fix run that answered it."""
    if not pr['isDraft'] or not stopped(pr):
        return False
    commit = orders.gh('api', f"repos/{{owner}}/{{repo}}/commits/{pr['headRefOid']}")['commit']['committer']['date']
    since = max([orders.created(commit)] + [orders.created(a['created_at']) for a in orders.marked(pr['number'], '<!-- fix-attempt -->')])
    issue = orders.linked_issue(pr['body'])
    return any(orders.created(c['created_at']) > since for _, c in orders.owner_comments(pr['number'], *([issue] if issue else [])))


def repairs(prs, now):
    """(pr, head, cause) for each open Builder PR that needs a fix run: a conflict whose head awaits no review verdict,
    a failed required check, a draft whose `Stopped:` line the owner answered (L102), or a draft without a `Stopped:` line
    that no run has touched for IDLE seconds. A PR whose Issue a dependency blocks gets none (L102)."""
    due = []
    for pr in prs:
        if not pr['headRefName'].startswith('build/') or pr['isCrossRepository']:
            continue
        if pr['isDraft']:
            if stopped(pr):
                cause = 'answered' if owner_answered(pr) else None
            else:
                cause = 'unfinished' if now - orders.created(pr['updatedAt']) >= IDLE else None
        elif pr['mergeable'] == 'CONFLICTING' and not reviewing(pr, now):
            cause = 'conflict'
        else:
            cause = (read_failures(pr, rerun=True) or [None])[0]
        if cause and not held(pr):
            due.append((pr['number'], pr['headRefOid'], cause))
    return due


def review_runs(pr, state, context='review'):
    """Ids of the runs behind the PR head's `review` (or, for L103, `critic`) status in `state` (`PENDING`, `FAILURE`, ...)."""
    return [check['targetUrl'].rstrip('/').rsplit('/', 1)[1] for check in pr.get('statusCheckRollup') or []
            if check.get('context') == context and check.get('state') == state]


def running(pr):
    """The workflows with a run that has not ended on the PR's head."""
    return {check['workflowName'] for check in pr.get('statusCheckRollup') or []
            if check.get('workflowName') and check.get('status') != 'COMPLETED'}


def reviewing(pr, now):
    """Whether the PR's head awaits its review verdict (L24): its `check` has not ended, or passed under IDLE seconds
    before `now` and the head holds no `review` status other than a pending one."""
    rollup = pr.get('statusCheckRollup') or []
    passed = [orders.created(check['completedAt']) for check in rollup if check.get('workflowName') == 'check' and
              check.get('name') == 'check' and check.get('conclusion') == 'SUCCESS']
    judged = any(check.get('context') == 'review' and check.get('state') != 'PENDING' for check in rollup)
    return 'check' in running(pr) or (bool(passed) and now - max(passed) < IDLE and not judged)


def unreviewed(prs):
    """(pr, run id) for ready PRs awaiting a usable verdict or model work from `review` or `critic`."""
    return [(pr['number'], run) for pr in prs if not pr['isDraft']
            for context in ('review', 'critic') for run in review_runs(pr, 'PENDING', context)]


def open_reviews():
    """The branches with a queued or running review.yml run. Its run name is `Review <branch>`; the run is a `workflow_run`
    run on `main`, so the PR's status rollup never shows it."""
    return {run['display_title'].removeprefix('Review ') for status in ('queued', 'in_progress')
            for page in orders.gh('api',
                f'repos/{{owner}}/{{repo}}/actions/workflows/review.yml/runs?status={status}&per_page=100',
                '--paginate', '--slurp') for run in page['workflow_runs']}


def unlaunched(prs, now, reviews=frozenset()):
    """(pr, run id) for each ready, unheld Builder PR whose head passed `check` over LAUNCH seconds ago, with no run still
    open (`reviews` holds the branches whose review run is) and no `review` status: its review run found the PR held (L102)
    or never started. Rerunning that `check` run starts the review."""
    found = []
    for pr in prs:
        rollup = pr.get('statusCheckRollup') or []
        passed = [check for check in rollup if check.get('workflowName') == 'check' and check.get('name') == 'check' and
                  check.get('conclusion') == 'SUCCESS' and now - orders.created(check['completedAt']) >= LAUNCH]
        if pr['isDraft'] or not pr['headRefName'].startswith('build/') or pr['isCrossRepository'] or not passed or \
                running(pr) or pr['headRefName'] in reviews or any(check.get('context') == 'review' for check in rollup) or held(pr):
            continue
        found.append((pr['number'], re.search(r'/runs/(\d+)', passed[0]['detailsUrl'])[1]))
    return found


def rerun_review(pr, run):
    """Rerun an ended review or critic run with no usable verdict, or no model work (L24/L103)."""
    state = orders.gh('run', 'view', run, '--json', 'status,attempt,url')
    if state['status'] != 'completed':
        return
    failures = orders.marked(pr, '<!-- no-verdict ')
    retry = any(c['body'].splitlines()[1] == f"{state['url'].rstrip('/')}/attempts/{state['attempt']}" for c in failures)
    if state['attempt'] >= RERUNS and not retry:
        flag(pr, f"The review run {state['url']} used its {RERUNS} attempts, and the last did no model work: a usage "
                 'limit or a setup failure. Rerun it from that page once it can work.')
        return
    call('run', 'rerun', run)


def pick(most):
    """Start the fix runs open Builder PRs need, ready PRs before drafts, while any of `most` Codex slots is free; rerun
    pending review and critic runs; then print the build matrix for the slots left as JSON."""
    prs = orders.gh('pr', 'list', '--state', 'open', '--limit', '1000', '--json',
                    'number,headRefName,headRefOid,isDraft,isCrossRepository,mergeable,body,updatedAt,statusCheckRollup')
    taken, free = codex_slots(most)
    for pr, head, cause in repairs(sorted(prs, key=lambda pr: pr['isDraft']), time.time()):
        if free < 1:
            print(f'Fix for PR #{pr} ({cause}) waits: build jobs and fix runs hold all {most} Codex slots.', file=sys.stderr)
            continue
        try:
            free -= bool(dispatch_fix(pr, head, cause))
        except Exception as error:  # noqa: BLE001 - one PR's repair must not stop every build (L23)
            print(f'::error::fix dispatch for PR #{pr} ({cause} @ {head}) failed: {error}', file=sys.stderr)
    for pr, run in unreviewed(prs):
        rerun_review(pr, run)
    for _, run in unlaunched(prs, time.time(), open_reviews()):
        call('run', 'rerun', run)
    rows = orders.read_orders(prs)
    print(orders.count_invalid(rows), file=sys.stderr)
    if broken := orders.invalid(rows):
        print('invalid orders: ' + ', '.join(f"#{row['issue']}" for row in broken), file=sys.stderr)
    print(json.dumps(choose(rows, taken, free)))


def ended(pr, verdict, run_url):
    """After a run that worked: a draft's `Stopped:` question goes where its screen `verdict` says (`put`), and one the
    screen sends back to the loop resumes (`resume`); another draft gets a fix run."""
    if not pr['isDraft']:
        return
    if ask := stopped(pr):
        remaining = _window_ask(ask)
        if not remaining:
            reason = 'An open PR never waits on a native window check (L79).'
            if verdict is not None and verdict.get('verdict') == 'loop':
                reason = verdict['reason']
            if verdict is None:
                reason += ' The screen gave no valid verdict; repair screening in the loop.'
            resume(pr, ask, reason, run_url)
        else:
            if remaining != ask and verdict is not None:
                verdict = dict(verdict, preview=remaining)
            put(pr['number'], remaining, verdict, run_url, lambda reason: resume(pr, ask, reason, run_url))
    else:
        dispatch_fix(pr['number'], pr['headRefOid'], 'unfinished')


def resume(pr, ask, reason, run_url):
    """Send a draft whose `Stopped:` question the screen sent back to the loop (L81) back to work: that paragraph becomes
    the question and the screen's reason, so the draft no longer counts as stopped and the next fix run reads both; a
    comment keeps the same record, and an `unfinished` fix run starts (L82 bounds the tries)."""
    sent = (f"The run {run_url} stopped on: {ask.removeprefix('Stopped:').strip()}\n\n"
            f'The screen sent it back to the loop: {reason}')
    body = STOPPED.sub(lambda _: sent, pr['body'], count=1)
    call('api', '-X', 'PATCH', f"repos/{{owner}}/{{repo}}/pulls/{pr['number']}", '-f', f'body={body}')
    comment(pr['number'], sent)
    dispatch_fix(pr['number'], pr['headRefOid'], 'unfinished')


def built(issue, slug, ran, answer, run_url, verdict=None):
    """After a build run: hand its PR on, or settle the Issue it left. A run that made no tool call (`ran` false)
    records nothing. With no open PR, an Issue a person closed, one closed after its `build/<slug>` PR merged, or one a
    dependency, PR or label of `orders.WAITS` holds, records nothing; one a bot closed otherwise reopens; an `ask` in the
    run's `answer` (JSON) goes where its screen `verdict` says (`put`); one still ready is struck. An open PR's
    `Stopped:` question goes where `verdict` says too (`ended`)."""
    ask = asked(answer)
    if not ran:
        print('the run made no tool call; nothing to record')
        return
    if slug.startswith('repair-'):
        # L96: a repair run opens no PR; it failed when the Issue still does not parse.
        current = orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{issue}')
        if current['state'] == 'open' and not orders.waits(current):
            try:
                orders.check(current['body'] or '')
            except ValueError as error:
                strike(issue, f'The repair run {run_url} left the order unreadable: {error}.')
        return
    if owner_closed(issue, *closed_prs(f'build/{slug}')):
        print(f'the owner closed #{issue} or its PR; nothing to record')
        return
    prs = orders.gh('pr', 'list', '--head', f'build/{slug}', '--state', 'open', '--json', 'number,headRefOid,isDraft,body')
    if prs:
        ended(prs[0], verdict, run_url)
        return
    current = orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{issue}')
    if current['state'] == 'closed':
        if slug.startswith('stall-') or (current.get('closed_by') or {}).get('type') != 'Bot' or \
                orders.gh('pr', 'list', '--head', f'build/{slug}', '--state', 'merged', '--json', 'number'):
            print(f'#{issue} closed by a person or after its build/{slug} PR merged; nothing to record')
            return
        call('issue', 'reopen', str(issue))
    elif held := orders.waits(current):
        print(f'#{issue} waits on {orders.WAITS[held[0]]}; nothing to record')
        return
    elif ask:
        put(issue, ask, verdict, run_url, lambda reason: strike(
            issue, f'The build run {run_url} asked: {ask}\n\nThe screen sent it back to the loop: {reason}'))
        return
    elif not orders.queued(issue):
        print(f'#{issue} is no longer ready; nothing to record')
        return
    strike(issue, f'The build run {run_url} ended with no PR, no settled Issue and no ask.')


def strike(issue, why):
    """Record one failed try on the Issue; L34 holds an Issue struck `orders.STRIKES` times in a day, asking nobody."""
    comment(issue, f'{orders.STRIKE}\n{why}')


def run_started():
    """When this Actions run began, or 0 outside one."""
    run = os.environ.get('GITHUB_RUN_ID')
    began = (orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run}') if run else {}).get('run_started_at')
    return orders.created(began) if began else 0


def owner_closed(*numbers):
    """L102: whether the owner closed any of Issues or PRs `numbers` after this run started. A run that started before
    the close leaves them closed."""
    since = run_started()
    for number in numbers:
        item = orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}')
        if item['state'] == 'closed' and (item.get('closed_by') or {}).get('login') == orders.OWNER and \
                orders.created(item.get('closed_at') or '1970-01-01T00:00:00Z') >= since:
            return True
    return False


def related(pr):
    """The numbers of PR `pr` (as `view` reads it) and its Issue."""
    issue = orders.linked_issue(pr['body'])
    return [pr['number'], *([issue] if issue else [])]


def closed_prs(branch):
    """The numbers of PRs on `branch` closed without merging."""
    return [found['number'] for found in orders.gh('pr', 'list', '--head', branch, '--state', 'closed', '--json', 'number')]


def view(pr):
    return orders.gh('pr', 'view', str(pr), '--json',
                     'number,url,state,headRefOid,headRefName,isDraft,isCrossRepository,mergeable,body,statusCheckRollup')


def started(attempt):
    """When the fix run an attempt comment links began, or None when its run is not readable."""
    run = re.search(r'/runs/(\d+)', attempt)
    attempt = re.search(r'/attempts/(\d+)', attempt)
    path = f'repos/{{owner}}/{{repo}}/actions/runs/{run[1]}' + (f'/attempts/{attempt[1]}' if attempt else '') if run else ''
    began = (orders.gh('api', path) if path else {}).get('run_started_at')
    return orders.created(began) if began else None


def _fix_refusal(reason, event):
    print(f'Skip fix: {reason}. Recheck after {event}. No fix model started.', file=sys.stderr)
    return None


def _fix_record(pr, head, cause, record):
    ref = _fix_ref(pr, head, cause)
    attempt = int(os.environ.get('GITHUB_RUN_ATTEMPT', '1'))
    for _ in range(8):
        sha, state = _fix_read(ref)
        if not state:
            raise ValueError('task has no durable run owner; old workflow definition requires engineering repair')
        if state.get('run') != int(os.environ['GITHUB_RUN_ID']):
            raise ValueError('task has no durable run owner')
        if _fix_save(ref, sha, dict(state,
                transient_reads=state.get('transient_reads', 0) + int(record['kind'] == 'transient-read' and
                    state.get('task', {}).get('attempt') != attempt),
                task=dict(record, attempt=attempt))):
            return
    raise ValueError('fix task record changed concurrently; no model starts')


def _fix_prepare(pr, head, cause):
    # Capture the read adapter's stderr at the job boundary; orders.gh retains its normal visible failures elsewhere.
    result = subprocess.run([sys.executable, str(Path(__file__).resolve()), 'fix-task', str(pr), head, cause],
                            env={**os.environ, 'LOOP_FIX_TASK_READ': '1'}, capture_output=True, text=True, timeout=900)
    record = dict(kind='eligible' if result.returncode == 0 else 'refused' if result.returncode == 3 else 'read-failed',
                  reason=result.stderr.strip(), code=result.returncode)
    delay = orders.backoff(result.stderr.strip().split('\n')[-1], 1)
    if result.returncode not in (0, 3) and delay is not None:
        record.update(kind='transient-read', retry_at=int(time.time()) + max(1, delay))
    if result.returncode != 0 and 'API rate limit exceeded' in result.stderr:
        _fix_record(pr, head, cause, record)
        rate = orders.gh('api', '/rate_limit')['resources']['core']
        if not rate['remaining'] and rate['reset'] > time.time():
            record.update(kind='api-limit', retry_at=rate['reset'])
        else:
            record['reason'] += '\nNo reported installation recovery time; engineering repair required.'
    _fix_record(pr, head, cause, record)
    if result.stderr:
        print(result.stderr, end='', file=sys.stderr)
    if result.returncode == 0:
        print(result.stdout, end='')
    return result.returncode


def fix_task(pr, head, cause, run_url, *, prepare=True):
    """The fix run's task, or None when the PR moved past `head`, is not a Builder PR, no longer fails a `check` or
    `rules` cause there, failed it because `main` does, or used its ATTEMPTS. A failure an older `main` caused that
    `main` passes now gets a task to merge `main` only, once per head, which counts no attempt. Whatever `cause`, the
    task also names a conflict with `main`, first, and a reject of `head` that no fix run answered, so one run answers
    each. A task that names only a conflict counts no attempt, CONFLICTS times per PR, even after ATTEMPTS."""
    current = view(pr)
    if current['state'] != 'OPEN':
        return _fix_refusal('PR is closed', 'a new open PR')
    if current['headRefOid'] != head:
        return _fix_refusal('full head moved', 'checks on the new head')
    if current.get('isCrossRepository') or not current['headRefName'].startswith('build/'):
        return _fix_refusal('PR is not a same-repository Builder PR', 'a same-repository build branch')
    if held(current):
        return _fix_refusal('work Issue has an open prerequisite', 'prerequisite completion')
    if owner_closed(*related(current)):
        return _fix_refusal('owner closed the PR or work Issue', 'an owner reopening')
    if waits := labels(pr) & set(orders.WAITS):
        return _fix_refusal(f'PR is held by {sorted(waits)}', 'label removal')
    if issue := orders.linked_issue(current['body']):
        work = orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{issue}')
        if work['state'] != 'open':
            return _fix_refusal('work Issue is closed', 'Issue reopening')
        if wait := orders.waits(work):
            return _fix_refusal(f'work Issue is held by {wait[0]}', 'label removal')
    if cause == 'unfinished' and (not current['isDraft'] or stopped(current)):
        return _fix_refusal('unfinished cause no longer has a draft without Stopped', 'a new unfinished draft')
    if cause == 'conflict' and current['mergeable'] != 'CONFLICTING':
        return _fix_refusal('conflict with main is gone', 'a new conflicting head')
    if cause == 'answered' and not owner_answered(current):
        return _fix_refusal('Stopped question has no new owner answer', 'an owner answer')
    if cause in ('check', 'rules') and cause not in read_failures(current):
        workflow = 'check' if cause == 'check' else 'loop'
        if workflow in running(current):
            return _fix_refusal(f'{workflow} is still running on this head', 'its completed latest result')
        check = latest(current, (cause,)).get(cause)
        if not check:
            return _fix_refusal(f'{cause} has no completed result on this head', 'a completed latest result')
        result = check.get('conclusion') or check.get('state')
        if result == 'FAILURE':
            return _fix_refusal('rules failed only on installation API reads', 'API recovery and the rules job rerun')
        return _fix_refusal(f'{cause} latest result is {result}; the original failure is superseded', 'a new real failure')
    verdict = blame(current, cause) if cause in ('check', 'rules') else 'pr'
    if verdict == 'main-pending':
        return _fix_refusal('a main push this head could merge has not completed the failing job', 'that main job completing')
    if verdict == 'main-failed':
        return _fix_refusal('main latest result still fails the same job', 'main completing a passing check')
    if verdict == 'base' and current['mergeable'] != 'CONFLICTING' and not orders.marked(pr, f'{REFRESH} {head} -->'):
        if prepare:
            comment(pr, f'{REFRESH} {head} -->\nFix run {run_url} merges `main`: `main` failed `{cause}` on a push this head '
                    f'merged and passes it now. It counts no fix attempt.')
        return (f"Refresh PR #{pr} on branch `{current['headRefName']}`, head {head}: `main` failed `{cause}` on a push "
                'this head merged and passes it now. Merge `origin/main` into that branch and push it, changing nothing '
                'else; this run counts no fix attempt. End as `.agents/builder.md` says: a ready PR with auto-merge armed.')
    attempts = orders.marked(pr, '<!-- fix-attempt -->')
    verdicts = orders.marked(pr, 'VERDICT:')
    idle = [c for c in orders.marked(pr, '<!-- fix-') if pushed_nothing(head) in c['body']]
    answered = orders.created(attempts[-1]['created_at']) if attempts else 0
    if cause == 'review' and verdicts and answered > orders.created(verdicts[-1]['created_at']) and \
            time.time() - answered < IDLE:
        # A fix run answered the last reject, and its push or `fixed` starts a new review: that verdict decides, not the old one.
        return _fix_refusal('review reject already answered less than three hours ago', 'a new verdict or three hours')
    last = verdicts[-1]['body'] if verdicts else ''
    if cause == 'review' and (not last.startswith('VERDICT: reject') or orders.field(last, 'Head', '') != head):
        return _fix_refusal('review cause has no current-head reject', 'a new reject on this full head')
    rejected = last.startswith('VERDICT: reject') and orders.field(last, 'Head', '') == head and \
        orders.created(verdicts[-1]['created_at']) > answered
    criticisms = orders.marked(pr, 'CRITIC:')
    seen = criticisms[-1]['body'] if criticisms else ''
    criticized = seen.startswith('CRITIC: reject') and orders.field(seen, 'Head', '') == head and \
        orders.created(criticisms[-1]['created_at']) > answered
    if cause == 'critic' and not criticized:
        # The head moved, or a fix run answered this reject: its next critic run decides.
        return _fix_refusal('critic reject is stale or answered', 'a new critic reject')
    also = {'conflict': current['mergeable'] == 'CONFLICTING', 'review': rejected, 'critic': criticized}
    causes = [name for name in CAUSES if name == cause or also.get(name)]
    free = causes == ['conflict'] and len(conflicts := orders.marked(pr, CONFLICT)) < CONFLICTS
    if free:
        if prepare:
            comment(pr, f'{CONFLICT} {head} -->\nFix run {run_url} merges `main` into this head, which conflicts with it. It '
                    f'counts no fix attempt ({len(conflicts) + 1} of {CONFLICTS} such runs).')
    elif len(attempts) >= ATTEMPTS:
        if not prepare:
            # Only task preparation inside the shared branch group performs the exhaustion handoff.
            return 'Exhaustion handoff: rerun task preparation only; its exhausted budget starts no model.'
        exhaust(current, attempts, verdicts, cause)
        return _fix_refusal('three counted fix attempts exhausted', 'the replacement build PR')
    findings = [last] if 'review' in causes and last else []
    if idle:
        findings.insert(0, 'The last fix run pushed nothing to this head: change the tree this time, or end as a draft with a `Stopped:` line.')
    findings += [seen] if 'critic' in causes else []
    chosen = orders.owner_section(pr, *([issue] if (issue := orders.linked_issue(current['body'])) else []))
    return '\n\n'.join([f"Fix PR #{pr} on branch `{current['headRefName']}`, head {head}. " +
                        ' '.join(CAUSES[name].format(cause=name, pr=pr) for name in causes) +
                        (' Change nothing the merge does not need, and leave a failure already on this head to the merged '
                         "head's runs; this run counts no fix attempt." if free else ''),
                        *findings, *([chosen] if chosen else []), 'Push to that branch. End as `.agents/builder.md` says: a ready PR with auto-merge '
                        'armed, or a draft with a `Stopped:` line.'])


def exhaust(current, attempts, verdicts, cause):
    """A Builder PR out of fix runs: tell its work Issue what failed, close the PR unmerged, delete its branch and strike
    the Issue, once per PR. The closed PR keeps its diff at `refs/pull/<pr>/head`. A PR naming no Issue asks the user."""
    pr, branch = current['number'], current['headRefName']
    issue = orders.linked_issue(current['body'])
    if not issue:
        flag(pr, f'{ATTEMPTS} fix runs did not get this PR to merge, and its body names no Issue to record that on.')
        return
    if orders.marked(issue, f'<!-- fix-exhausted #{pr} -->'):
        return
    commits = orders.gh('pr', 'view', str(pr), '--json', 'commits')['commits']

    def reason(cause, before):
        found = [c['body'] for c in verdicts if orders.created(c['created_at']) <= before][-1:] or ['']
        if cause == 'critic':
            found = [c['body'] for c in orders.marked(pr, 'CRITIC:') if orders.created(c['created_at']) <= before][-1:] or ['']
            return f"critic rejected: {found[0].split(chr(10) * 2, 1)[-1].strip()}"
        return f"review rejected: {found[0].split(chr(10) * 2, 1)[-1].strip()}" if cause == 'review' else f'{cause} failed'

    lines, since = [], None
    for attempt in attempts:
        ended_at = orders.created(attempt['created_at'])
        cause_ran = (re.search(r'answered `(\w+)`', attempt['body']) or [None, '?'])[1]
        # From the run's own start, so a merge that counted no attempt (L82) shows under no attempt.
        since = started(attempt['body']) or since or ended_at
        subjects = [c['messageHeadline'] for c in commits if since < orders.created(c['committedDate']) <= ended_at]
        lines.append(f"- `{cause_ran}` ({reason(cause_ran, ended_at)}): " + ('; '.join(subjects) or 'no commit'))
        since = ended_at
    comment(issue, f'<!-- fix-exhausted #{pr} -->\nPR #{pr} ({current["url"]}) used its {ATTEMPTS} fix runs and was closed '
                   f'unmerged; its diff stays at that link, head `{current["headRefOid"]}`. Each line is a cause a fix '
                   f'run answered, its failing check or review finding, and the commits it pushed; the last is the cause '
                   f'that found no run left.\n\n'
                   + '\n'.join(lines) + f'\n- `{cause}` ({reason(cause, time.time())}): no fix run left\n\n'
                   'Continue from this head merged with origin/main and answer these findings first; '
                   'take another approach only when a finding rejects the approach itself.')
    strike(issue, f'PR #{pr} used its {ATTEMPTS} fix runs: {current["url"]}')
    call('pr', 'close', str(pr), '--delete-branch')


def pushed_nothing(head):
    return f'It pushed nothing to {head}.'


def fixed(pr, cause, ran, run_url, verdict=None, head=None):
    """Serialize completion per workflow attempt; replay never spends a second worked attempt."""
    run_id = os.environ.get('GITHUB_RUN_ID')
    if not run_id or not head:
        return _fixed(pr, cause, ran, run_url, verdict, head)
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    if '/attempts/' not in run_url:
        run_url += f'/attempts/{attempt}'
    ref = _fix_ref(pr, head, cause)
    sha, state = _fix_read(ref)
    if not state:
        run = json.loads(call('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run_id}', '-X', 'GET'))
        if run['display_title'] != f'Fix PR #{pr}: {cause} @ {head}':
            raise ValueError('completion run does not match the exact fix identity')
        if not _fix_compatible(run):
            # Old jobs have contents: read. Keep their worked count under their existing branch exclusion;
            # a current dispatcher adopts their id, then refuses the incompatible definition before any rerun.
            recorded = [note for marker in ('<!-- fix-attempt -->', NOPUSH) for note in orders.marked(pr, marker)
                        if f'Fix run {run_url} ' in note['body']]
            if not recorded:
                _fixed(pr, cause, ran, run_url, verdict, head)
            print(f'Legacy completion: run {run_id}, run_attempt {attempt}; automatic retry requires engineering repair.')
            return
        if not fix_admit(pr, head, cause, int(run_id)):
            raise ValueError('completion run already has a different durable owner')
        sha, state = _fix_read(ref)
    if state.get('run') != int(run_id):
        raise ValueError('completion has no durable run owner')
    seen = state.get('completions', {}).get(attempt)
    if seen == 'done':
        print(f'Completion already recorded: run {run_id}, run_attempt {attempt}.')
        return
    if seen:
        raise ValueError(f'completion delivery unknown for run {run_id}, run_attempt {attempt}; reconcile before retry')
    pending = dict(state, completions={**state.get('completions', {}), attempt: 'pending'})
    if not _fix_save(ref, sha, pending):
        return fixed(pr, cause, ran, run_url, verdict, head)
    _fixed(pr, cause, ran, run_url, verdict, head)
    sha, state = _fix_read(ref)
    done = dict(state, completions={**state['completions'], attempt: 'done'},
                worked={**state.get('worked', {}), attempt: ran},
                fix_attempts=len(orders.marked(pr, '<!-- fix-attempt -->')))
    if not ran and state.get('task', {}).get('kind') == 'eligible':
        done['task'] = dict(kind='setup-failed', attempt=int(attempt), reason='model made no tool call')
    if not _fix_save(ref, sha, done):
        raise ValueError('completion changed concurrently; engineering reconciliation required')


def _fixed(pr, cause, ran, run_url, verdict=None, head=None):
    """After a fix run that worked (`ran`): count the attempt on the PR, unless the run only merged `main` (L82), then
    hand the PR on with its screen `verdict`. A ready head that still holds the reject this run answered, with no `check`
    running on it, gets its review run again: with no push or re-ready, no `check` ends to start one (L24). A run that
    did not work deletes its refresh or conflict comment, so it records nothing and the PR keeps that run. A run that
    leaves the `head` it was given, with no `Stopped:` draft, pushed nothing, unless its cause is a `review` or `critic` reject, which a body edit answers: it starts no review, says so on the PR,
    and counts no attempt the first time on a head, one the second (L82)."""
    urls = [run_url, *([run_url.removesuffix('/attempts/1')] if run_url.endswith('/attempts/1') else [])]
    free = [note for marker in (REFRESH, CONFLICT) for note in orders.marked(pr, marker)
            if any(f'Fix run {url} ' in note['body'] for url in urls)]
    if not ran:
        for note in free:
            call('api', '-X', 'DELETE', f"repos/{{owner}}/{{repo}}/issues/comments/{note['id']}")
        print('the run made no tool call; it counts as no attempt')
        return
    current = view(pr)
    if owner_closed(*related(current)):
        print('the owner closed this PR or its Issue; it stays closed')
        return
    idle = head and cause not in ('review', 'critic') and current['headRefOid'] == head and not (current['isDraft'] and STOPPED.search(current['body'] or ''))
    if idle and not free:
        if orders.marked(pr, f'{NOPUSH} {head} -->'):
            comment(pr, f'<!-- fix-attempt -->\nFix run {run_url} answered `{cause}`. {pushed_nothing(head)}')
        else:
            comment(pr, f'{NOPUSH} {head} -->\nFix run {run_url} answered `{cause}`. {pushed_nothing(head)} It counts no '
                        'fix attempt, the first time on a head.')
    elif not free:
        comment(pr, f'<!-- fix-attempt -->\nFix run {run_url} answered `{cause}`.')
    ended(current, verdict, run_url)
    if idle:
        print('the run pushed nothing; no review starts')
        return
    if cause in ('review', 'critic') and not current['isDraft'] and 'check' not in running(current):
        for run in review_runs(current, 'FAILURE', cause):
            call('run', 'rerun', run)


def reuse_section(body):
    """L116: library evidence from `Reuse:` to the next ATX heading or PR body field. Blank lines belong to
    the section; acceptance fields and following rationale sections do not."""
    match = re.search(r'^Reuse:[^\r\n]*(?:\r?\n(?! {0,3}#{1,6}\s|(?:Scenarios|Moves|Principles|Stopped|Rationale|'
                      r'Validation|Tests|Testing|Summary|Capture (?:ready|required|publication)):|'
                      r'(?:Refs|Closes) #\d+\b)[^\r\n]*)*', body, re.M)
    return match[0].rstrip() if match else ''


def review_task(pr, head):
    """The review run's task, or None when the PR is not open at `head` or is a draft."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or current['isDraft'] or held(current):
        return None
    lines = [f'Review PR #{pr}, head {head}.', *(line[0] for line in NAMED.finditer(current['body'] or ''))]
    evidence = reuse_section(current['body'] or '')
    if evidence:
        lines += ['\nLibrary evidence only; verify against the diff and sources (rule 9):', evidence]
    earlier = [c['body'] for c in orders.marked(pr, 'VERDICT:')]
    if earlier:
        lines += ['If an earlier approval names an ancestor, focus on the changes since that head, including conflict '
                  'resolutions and their effects. Your verdict still covers the current head; do not repeat unchanged '
                  'findings.', '\nEarlier verdicts, oldest first:\n\n' + '\n\n---\n\n'.join(earlier)]
    return '\n'.join(lines)


def touches_desktop(pr):
    """Whether PR `pr` changes a file under `apps/desktop/src/` (rule 8). Reads the PR's files list, which answers past
    the 300 files where GitHub refuses `gh pr diff`."""
    return any(changed['filename'].startswith('apps/desktop/src/') for changed in pr_files(pr))


def pr_files(pr):
    """Read every changed file with its GitHub change status, for ready and desktop review selection."""
    return [changed for page in orders.gh('api', '--paginate', '--slurp',
                                         f'repos/{{owner}}/{{repo}}/pulls/{pr}/files?per_page=100') for changed in page]


def ready(pr):
    """L100: mark PR `pr` ready and arm auto-merge once its body holds a `Scenarios:` line and, when it touches
    `apps/desktop/src/`, a `Moves:` line. L116 also requires library evidence for added source files. Missing body
    requirements change nothing, name each missing section on stderr and return False."""
    current = view(pr)
    if owner_closed(*related(current)):
        print(f'PR #{pr} stays as it is: the owner closed it or its Issue, and a closure outlasts its run (L102).',
              file=sys.stderr)
        return False
    files = pr_files(pr)
    needed = ('Scenarios', 'Moves') if any(f['filename'].startswith('apps/desktop/src/') for f in files) else ('Scenarios',)
    held = {line[1] for line in NAMED.finditer(current['body'] or '')}
    missing = [SHAPES[name] for name in needed if name not in held]
    added = any(f['status'] == 'added' and re.match(r'^(?:crates/[^/]+/src/|apps/desktop/src/|loop/).+', f['filename'])
                for f in files)
    if added and not reuse_section(current['body'] or '').removeprefix('Reuse:').strip():
        missing.append('`Reuse: <library evidence>`')
    if missing:
        print(f'PR #{pr} stays as it is: its body lacks {" and ".join(missing)} (.agents/data/pr.md). Add them with '
              f'`gh pr edit {pr} --body-file <file>`, then run `just ready {pr}` again.', file=sys.stderr)
        return False
    call('pr', 'ready', str(pr))
    call('pr', 'merge', str(pr), '--auto', '--merge')
    return True


def status(head, state, description, run_url, context='review'):
    call('api', f'repos/{{owner}}/{{repo}}/statuses/{head}', '-f', f'state={state}', '-f', f'context={context}',
         '-f', f'description={description}', '-f', f'target_url={run_url}')


def post_missing_verdict(pr, head, run_url, context):
    """L24/L103: retry one unusable verdict per head and gate, then file one loop repair."""
    marker = f'<!-- no-verdict {context} {head} -->'
    run = f"{run_url.rstrip('/')}/attempts/{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"
    previous = orders.marked(pr, marker)
    if not any(run == c['body'].splitlines()[1] for c in previous):
        comment(pr, f'{marker}\n{run}')
    runs = list(dict.fromkeys([c['body'].splitlines()[1] for c in previous] + [run]))
    if len(runs) < 2:
        status(head, 'pending', f'The {context} run gave no usable verdict; pick reruns it once', run_url, context)
        return True
    status(head, 'error', f'Two {context} runs gave no usable verdict', run_url, context)
    reported = f'<!-- no-verdict-repair {context} {head} -->'
    if not orders.marked(pr, reported):
        body = (f'Two {context} runs gave no usable verdict on PR #{pr}, head {head}:\n\n' +
                '\n'.join(runs[:2]) +
                f'\n\nRepair the {context} run failure so this head can receive an independent verdict. '
                'Keep every required gate and add a regression test for the diagnosed cause.\n\n'
                f'Scope: loop review/critic execution and verdict posting.\nScenarios: L24, L103\n'
                'Specification: [scenarios/loop-rules.md](https://github.com/saadshahd/roundup/blob/main/scenarios/loop-rules.md)\n'
                f'Key: verdict-{context}-{pr}-{head[:12]}\nPriority: 5\nMode: implement\n')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'issue.md'
            path.write_text(body)
            subprocess.run(['python3', str(ROOT / 'loop/orders.py'), 'check', str(path)], check=True, timeout=30)
            issue = call('issue', 'create', '--title', f'L24 L103: repair {context} verdict for PR #{pr}',
                         '--label', 'kind:loop', '--body', body)
        comment(pr, f'{reported}\n{issue}')
    return False


def review_post(pr, head, reviewer, answer, ran, run_url):
    """Publish a review run's answer on `head`: a VERDICT comment and the `review` status; a reject on a Builder PR
    starts a fix run. Lines that would forge a verdict field are dropped. A run whose model did no work (`ran` false)
    leaves `review` pending for pick to rerun. An unusable verdict retries once, then files a loop repair and returns
    False."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head:
        print(f'PR #{pr} moved past {head}; the newer head gets its own review')
        return True
    answer = json.loads(answer) if answer.strip() else {}
    verdict = answer.get('verdict')
    if verdict not in ('approve', 'reject') and not ran:
        status(head, 'pending', 'The review run did no model work; the next build pick reruns it', run_url)
        return True
    if verdict not in ('approve', 'reject') or (verdict == 'reject' and not any(
            line.strip() and not line.startswith(('NOTE:', 'VERDICT:', 'Head:', 'Reviewed-by-Agent:'))
            for line in str(answer.get('findings', '')).splitlines())):
        return post_missing_verdict(pr, head, run_url, 'review')
    findings = '\n'.join(line for line in str(answer.get('findings', '')).splitlines()
                         if not re.match(r'(VERDICT|Head|Reviewed-by-Agent):', line))
    comment(pr, f'VERDICT: {verdict}\nHead: {head}\n\n{findings}\n\nReviewed-by-Agent: {reviewer}')
    status(head, 'success' if verdict == 'approve' else 'failure', f'The review run answered {verdict}', run_url)
    if verdict == 'reject' and current['headRefName'].startswith('build/') and not current['isCrossRepository']:
        dispatch_fix(pr, head, 'review')
    return True


BAR = 'elegant, well designed and tasteful. That is the bar'
# L103: a reject's finding, either of a check of `docs/design-system.md` or of the bar where no check reaches. What a
# finding saw may hold commas, as `rgba(0,0,0,0.1)` does, so only the element is comma-free.
FINDING = re.compile(r'^(rule \S+, scenario \S+, step [^,]+, \S.*|bar, [^,]+, \S.*, \S.*)$')


def critic_task(pr, head):
    """The design critic's task (L103), or None when the PR is not open at `head`, is a draft or is held. A PR that
    changes nothing under `apps/desktop/src/` gets its `critic` status `success` here, with no model run."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or current['isDraft'] or held(current):
        return None
    if not touches_desktop(pr):
        status(head, 'success', 'The PR changes nothing under apps/desktop/src: no design critic run', '', 'critic')
        return None
    lines = [f'Critique PR #{pr}, head {head}, as `.agents/design-critic.md` says.',
             *(line[0] for line in NAMED.finditer(current['body'] or '')),
             f'The user\'s bar for UI work, set in #400: "{BAR}". Judge the diff (`gh pr diff {pr}`, or `git diff origin/main...HEAD` when GitHub refuses a diff over 300 files) against it and '
             '`docs/design-system.md`, `docs/wireframes.md` and `GLOSSARY.md`. Capture `origin/main` and this head on the '
             'seeds and at the viewports of `.agents/data/harness.md`. Nothing the author wrote counts as intent (rule 5).']
    earlier = [c['body'] for c in orders.marked(pr, 'CRITIC:')]
    if earlier:
        lines += ['\nEarlier critic findings, oldest first:\n\n' + '\n\n---\n\n'.join(earlier)]
    return '\n'.join(lines)


def critic_post(pr, head, critic, answer, ran, run_url):
    """Publish a design critic's answer on `head` (L103): a `CRITIC:` comment and the `critic` status; a reject on a
    Builder PR starts a fix run with cause `critic`. A reject with no finding of FINDING's shape retries once, as no
    verdict does. A run whose model did no work (`ran` false) leaves `critic` pending for pick to rerun. False when a run
    that worked holds no usable verdict."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head:
        print(f'PR #{pr} moved past {head}; the newer head gets its own critic run')
        return True
    answer = json.loads(answer) if answer.strip() else {}
    verdict = answer.get('verdict')
    findings = [re.sub(r'^\s*[-*+]\s+', '', line) for line in str(answer.get('findings', '')).splitlines()]
    findings = [line for line in findings if not re.match(r'(CRITIC|Head|Reviewed-by-Agent):', line)]
    if verdict not in ('approve', 'reject') and not ran:
        status(head, 'pending', 'The critic run did no model work; the next build pick reruns it', run_url, 'critic')
        return True
    if verdict not in ('approve', 'reject') or (verdict == 'reject' and not any(FINDING.match(line) for line in findings)):
        return post_missing_verdict(pr, head, run_url, 'critic')
    comment(pr, f'CRITIC: {verdict}\nHead: {head}\n\n' + '\n'.join(findings) + f'\n\nReviewed-by-Agent: {critic}')
    status(head, 'success' if verdict == 'approve' else 'failure', f'The critic run answered {verdict}', run_url, 'critic')
    if verdict == 'reject' and current['headRefName'].startswith('build/') and not current['isCrossRepository']:
        dispatch_fix(pr, head, 'critic')
    return True


def task_or_nothing(task):
    """Print a task and exit 0, or exit 3 when there is none: the run has nothing to do."""
    print(task or '', end='')
    return 0 if task else 3


def main(args):
    run_url = (f"{os.environ.get('GITHUB_SERVER_URL', '')}/{os.environ.get('GITHUB_REPOSITORY', '')}"
               f"/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}")
    if args and args[0] in ('fix-task', 'fixed'):
        run_url += f"/attempts/{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"
    match args:
        case ['prompt', *name] if len(name) < 2:
            prompt(sys.stdin.read(), os.environ['GITHUB_OUTPUT'], *name)
        case ['codex-login']:
            codex_login()
        case ['worked', path]:
            return 0 if worked(path) else 1
        case ['codex', model, *schema] if len(schema) < 2:
            return codex(sys.stdin.read(), model, schema[0] if schema else None, os.environ['GITHUB_OUTPUT'])
        case ['start-measurement']:
            measurement_start()
        case ['finish-measurement']:
            measurement_finish()
        case ['read-token']:
            token = app_token({'contents': 'read', 'issues': 'read', 'pull_requests': 'read', 'actions': 'read', 'checks': 'read'})
            cli = os.environ.get('GH_LOOP_CLI') or shutil.which('gh')
            if not cli:
                raise ValueError('read-token needs gh')
            directory = Path(os.environ['RUNNER_TEMP']) / 'loop-gh'
            directory.mkdir(exist_ok=True)
            # Observers and collectors also call gh directly. One adapter keeps their POST identity unchanged.
            token_file = directory / 'read-token'
            token_file.touch(mode=0o600, exist_ok=True)
            token_file.write_text(token)
            wrapper = directory / 'gh'
            wrapper.write_text(f"#!{sys.executable}\nimport os, sys\nsys.path.insert(0, {str(Path(__file__).resolve().parent)!r})\n"
                               f"import orders, builder, subprocess\nfrom pathlib import Path\nargs = tuple(sys.argv[1:])\n"
                               f"if not orders.reads(args): os.execve({cli!r}, ['gh', *args], os.environ)\n"
                               f"try: result = builder.read_call({cli!r}, args, Path({str(token_file)!r}))\n"
                               "except subprocess.CalledProcessError as error: result = error\n"
                               "sys.stdout.buffer.write(result.stdout or b'')\nsys.stderr.buffer.write(result.stderr or b'')\n"
                               "sys.exit(result.returncode)\n")
            wrapper.chmod(0o755)
            with open(os.environ['GITHUB_ENV'], 'a') as env:
                env.write(f'GH_READ_TOKEN={token}\nGH_LOOP_CLI={cli}\n')
            with open(os.environ['GITHUB_PATH'], 'a') as paths:
                paths.write(f'{directory}\n')
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write(f'token={token}\n')
        case ['pick', most] if most.isdigit():
            try:
                pick(int(most))
            except subprocess.CalledProcessError as error:
                if not orders.exhausted(error.stderr or ''):
                    raise
                # Only the hourly reset clears it; the next merge, run end or hourly pick builds then (L23).
                print(f'::warning::pick waits for the rate limit reset: {" ".join(error.stderr.split())[:300]}',
                      file=sys.stderr)
                print('[]')
        case ['keep', branch, *issue] if len(issue) < 2 and all(number.isdigit() for number in issue):
            keep(branch, int(issue[0]) if issue else None, run_url)
        case ['screen', branch]:
            if ask := question(sys.stdin.read(), branch):
                open_pr = bool(orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'))
                print(json.dumps(screen(ask, open_pr=open_pr)))
        case ['built', issue, slug, ran, verdict] if issue.isdigit() and ran in ('true', 'false'):
            built(int(issue), slug, ran == 'true', sys.stdin.read(), run_url, json.loads(verdict or 'null'))
        case ['fix-admit', pr, head, cause] if pr.isdigit() and cause in CAUSES:
            run_id = int(os.environ['GITHUB_RUN_ID'])
            if codex_slots(int(os.environ['CODEX_RUNS']), run_id)[1] < 1:
                print('Skip fix: build jobs and other fix runs hold every Codex slot (L23); a later pick starts the '
                      'repair this PR still needs.')
                return 3
            return 0 if fix_admit(int(pr), head, cause, run_id) else 3
        case ['fix-task', pr, head, cause] if pr.isdigit() and cause in CAUSES:
            if not os.environ.get('LOOP_FIX_TASK_READ'):
                return _fix_prepare(int(pr), head, cause)
            return task_or_nothing(fix_task(int(pr), head, cause, run_url))
        case ['fixed', pr, cause, ran, verdict, *head] if pr.isdigit() and ran in ('true', 'false') and len(head) < 2:
            fixed(int(pr), cause, ran == 'true', run_url, json.loads(verdict or 'null'), *head)
        case ['review-task', pr, head] if pr.isdigit():
            return task_or_nothing(review_task(int(pr), head))
        case ['review-post', pr, head, reviewer, ran] if pr.isdigit() and ran in ('true', 'false'):
            return 0 if review_post(int(pr), head, reviewer, sys.stdin.read(), ran == 'true', run_url) else 1
        case ['critic-task', pr, head] if pr.isdigit():
            return task_or_nothing(critic_task(int(pr), head))
        case ['critic-post', pr, head, critic, ran] if pr.isdigit() and ran in ('true', 'false'):
            return 0 if critic_post(int(pr), head, critic, sys.stdin.read(), ran == 'true', run_url) else 1
        case ['closed', *numbers] if numbers and all(number.isdigit() for number in numbers):
            if owner_closed(*map(int, numbers)):
                print('the owner closed one of them after this run started: change neither, push nothing, reopen nothing')
                return 1
        case ['ready', pr] if pr.isdigit():
            return 0 if ready(int(pr)) else 1
        case _:
            print('usage: builder.py start-measurement | finish-measurement | read-token | prompt | worked <file> | codex <model> [<schema>] | codex-login | keep <branch> [<issue>] | pick <most> | screen <branch> | '
                  'built <issue> <slug> <ran> '
                  '<verdict> | fix-admit <pr> <head> <cause> | fix-task <pr> <head> <cause> | fixed <pr> <cause> <ran> <verdict> | review-task <pr> <head> | '
                  'review-post <pr> <head> <reviewer> <ran> | critic-task <pr> <head> | critic-post <pr> <head> <critic> <ran> | ready <pr> | closed <number>...', file=sys.stderr)
            return 2
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        detail = f'\n{error.stderr.strip()}' if isinstance(error, subprocess.CalledProcessError) and error.stderr else ''
        print(f'builder: {error}{detail}', file=sys.stderr)
        sys.exit(4)
