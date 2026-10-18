#!/usr/bin/env python3
"""L23, L24, L79, L81, L82: what GitHub Actions leaves to roundup around Builder runs: which Issues to build, how a run
ended, when a PR gets a fix run and how a review run's answer reaches the PR. Exit 4: GitHub could not be read or
written."""
import base64
import binascii
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import orders  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NEEDS_USER = orders.NEEDS_USER
NEEDS_MAC = orders.NEEDS_MAC
# L79: the model that screens a build run's `ask` (`.agents/screen.md`), and the verdicts it gives.
SCREEN_MODEL = 'claude-haiku-5-5'
VERDICTS = ('user', 'mac', 'loop')
SCREEN_TRIES = 2
SCREEN_SCHEMA = {'type': 'object', 'required': ['verdict', 'reason', 'preview'],
                 'properties': {'verdict': {'enum': list(VERDICTS)}, 'reason': {'type': 'string'}, 'preview': {'type': 'string'}}}
# L23: where claude-code-action trades the job's OIDC token for a Claude App token (its `src/github/token.ts`), and the
# rights `keep` asks for: a push, workflow files included, and a draft PR.
EXCHANGE = 'https://api.anthropic.com/api/github/github-app-token-exchange'
AUDIENCE = 'claude-code-github-action'
RIGHTS = {'contents': 'write', 'pull_requests': 'write', 'issues': 'write', 'workflows': 'write'}
# L23: a build or fix run's token holds `keep`'s rights and reads CI evidence.
RUN_RIGHTS = {**RIGHTS, 'actions': 'read', 'checks': 'read'}
# L23: build and fix runs start on Codex with the user's ChatGPT login and fall back to Claude Code with the Max token when
# it did no work. Neither App lends a workflow a token, so a run's commits name its engine's account and push with a Claude App
# token.
CLAUDE_MODEL = 'claude-sonnet-5-5'
CODEX_MODEL = 'gpt-6.1-sol'
CLAUDE_ACCOUNT = ('claude[bot]', '209825114+claude[bot]@users.noreply.github.com')
CODEX_ACCOUNT = ('chatgpt-codex-connector[bot]', '199175422+chatgpt-codex-connector[bot]@users.noreply.github.com')
# The items of Codex's `--json` event lines that a tool use leaves.
CODEX_TOOLS = {'command_execution', 'file_change', 'mcp_tool_call', 'web_search'}
# L81: a draft's `Stopped:` paragraph, from that line to the next blank one.
STOPPED = re.compile(r'^Stopped:.*(?:\r?\n.*\S.*)*', re.M)
# The Issue a PR body's first `Refs`, `Closes` or `Fixes #<n>` line names.
LINKED = re.compile(r'^(?:Refs|Closes|Fixes) #(\d+)', re.M)
# A scenario id, such as U467 or V4b.
SCENARIO_ID = r'[A-Za-z]+[0-9]+[a-z]?'
# A scenario file's heading line, `**<id> <title>.**`, where a scenario starts.
HEADING = re.compile(rf'\*\*({SCENARIO_ID}) ')
ATTEMPTS = 3
# L82: causes about a PR's plumbing, not its work, start a fix run that posts no comment and counts no attempt: a conflict
# with `main`, and a `rules` failure whose every failed step checks PR shape (a base, `Author-Agent` trailers, scenario ids).
# Actions history counts these runs, and past PLUMBING_RUNS of them on one PR the next such cause counts as any other.
PLUMBING = ('conflict', 'rules')
PLUMBING_STEPS = re.compile(r'rules\.sh (?:base|ci-trailers|scenario-ids)\b')
PLUMBING_RUNS = 6
# L82, L120: a `rules` failure whose only failed step is this one is a merge that kept a stale side of a file.
MERGE_LOSS_STEP = re.compile(r'rules\.sh merge-loss\b')
# L82: the paths a fix run's script regenerates instead of a model resolving them, and the command that regenerates them
# (`crates/contracts` writes `contracts/generated/`).
GENERATED = ('contracts/generated/',)
REGENERATE = ('cargo', 'test', '--quiet', '-p', 'contracts')
# The Issue a build task's first line, `Work order: <url>/issues/<n>`, names.
WORK_ORDER = re.compile(r'\AWork order: \S+/issues/(\d+)')
# How long a reject a fix run answered awaits the next verdict before a fix run starts anyway (L82).
IDLE = 3 * 3600
# A review run whose model did no work (a usage limit) leaves `review` pending; pick reruns it this many times in all.
RERUNS = 6
FAILED = '`{cause}` failed on this head. `gh pr checks {pr}` lists the failed run; `gh run view <id> --log-failed` shows why.'
CAUSES = {
    'check': FAILED,
    'rules': FAILED,
    'review': 'The review run rejected this head; its findings are the last verdict below.',
    'critic': 'The design critic rejected this head (L103); its findings are the last `CRITIC:` comment below. Meet each '
              'finding, or the bar it names, without loosening `docs/design-system.md`, and meet each `NOTE:` line too: '
              'the notes are polish the critic raises once and never blocks on again.',
    'conflict': 'The PR conflicts with `main`: merge `origin/main` and keep the behaviour of both sides.',
    'unfinished': 'The last run left this PR a draft without a `Stopped:` line: finish the work.',
}


def call(*args):
    return subprocess.run(['gh', *args], check=True, text=True, stdout=subprocess.PIPE, timeout=60).stdout


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


def dispatch_fix(pr, head, cause):
    call('workflow', 'run', 'fix.yml', '-f', f'pr={pr}', '-f', f'head={head}', '-f', f'cause={cause}')


def role(name):
    """The prompt `.agents/<name>.md` beside this `loop/`."""
    return (ROOT / '.agents' / f'{name}.md').read_text()


def prompt(task, output, name='builder'):
    """Append the step output `prompt`: `.agents/<name>.md` (the Builder's unless a role is named), a `## Task` heading,
    then the task."""
    delimiter = 'PROMPT_' + secrets.token_hex(8)
    work = WORK_ORDER.match(task)
    if work and name == 'builder' and 'Open no PR' not in task:
        task = '\n\n'.join(part for part in (task.rstrip(), left_off(int(work[1]))) if part)
    with open(output, 'a') as out:
        out.write(f'prompt<<{delimiter}\n{role(name)}\n## Task\n\n{task.rstrip()}\n{delimiter}\n')


def left_off(issue):
    """L82: the paragraph that sends a build run to continue from the Issue's last Builder PR that used its fix runs and
    closed unmerged (its `<!-- fix-exhausted #<pr> -->` comment): its head, `refs/pull/<pr>/head`, and its last review and
    critic findings; '' when the Issue has none."""
    exhausted = orders.marked(issue, '<!-- fix-exhausted #')
    if not exhausted:
        return ''
    pr = int(re.match(r'<!-- fix-exhausted #(\d+) -->', exhausted[-1]['body'])[1])
    closed = orders.gh('pr', 'view', str(pr), '--json', 'state,mergedAt,url')
    if closed['state'] != 'CLOSED' or closed['mergedAt']:
        return ''
    findings = [c['body'] for marker in ('VERDICT:', 'CRITIC:') for c in orders.marked(pr, marker)[-1:]]
    return '\n\n'.join([
        f"Continue PR #{pr}, do not start over: it used its {ATTEMPTS} fix runs and was closed unmerged ({closed['url']}). "
        f"Instead of starting from `origin/main`, create the branch named above from its head: `git fetch origin "
        f"pull/{pr}/head && git switch -c <that branch> FETCH_HEAD && git merge origin/main`, keeping the behaviour of both "
        f"sides. Its last verdicts follow; meet each finding, keep the work that stands, and name PR #{pr} in your PR body.",
        *findings])


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


def screen(ask):
    """Haiku's verdict on what a run asks the user (L79, `.agents/screen.md`): a dict of `verdict` (one of `VERDICTS`),
    `reason` and `preview`, or None when Claude Code gave no valid one in `SCREEN_TRIES` tries. Each failed try is logged."""
    for attempt in range(1, SCREEN_TRIES + 1):
        try:
            out = subprocess.run(['claude', '-p', '--model', SCREEN_MODEL, '--tools', '', '--max-turns', '3',
                                  '--output-format', 'json', '--json-schema', json.dumps(SCREEN_SCHEMA)],
                                 input=f'{role("screen")}\n## Ask\n\n{ask}\n', text=True, capture_output=True,
                                 timeout=300, check=True)
            verdict = json.loads(out.stdout).get('structured_output')
        except (OSError, subprocess.SubprocessError, ValueError, AttributeError) as error:
            print(f'screen: try {attempt} gave no verdict: {error}', file=sys.stderr)
            continue
        if isinstance(verdict, dict) and verdict.get('verdict') in VERDICTS:
            return verdict
        print(f'screen: try {attempt} gave no valid verdict: {verdict!r}', file=sys.stderr)
    return None


def encode(verdict):
    """A screen `verdict` as a step output: base64, because GitHub drops an output holding a masked value and the
    Codex login's `{` and `}` lines are masked, so a JSON object never arrived (L79). '' for no verdict."""
    return base64.b64encode(json.dumps(verdict).encode()).decode() if verdict else ''


def decode(text):
    """The screen verdict `encode` wrote, or None when `text` is empty or holds no valid one."""
    try:
        verdict = json.loads(base64.b64decode(text, validate=True))
    except (binascii.Error, ValueError):
        return None
    return verdict if isinstance(verdict, dict) and verdict.get('verdict') in VERDICTS else None


def summarise(line):
    """Say `line` as a workflow warning and in the job's run summary, so a failure of the loop shows."""
    print(f'::warning::{line}')
    if path := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(path, 'a') as out:
            out.write(f'{line}\n')


def put(number, ask, verdict, run_url, back):
    """Send what a run asked the user where `screen`'s verdict says (L79): `loop` calls `back` with the screen's reason,
    `mac` holds Issue or PR `number` for an agent on the user's Mac, and `user` asks the user, preview first. With no
    verdict the question goes back to the loop like a `loop` verdict, and the run summary says so: the user is never
    asked unscreened."""
    if verdict is None:
        summarise(f'The screen gave no verdict after {SCREEN_TRIES} tries on #{number}, so the question went back to the loop: {run_url}')
        back('The screen gave no verdict, so a Builder settles the question itself.')
    elif verdict['verdict'] == 'loop':
        back(verdict['reason'])
    elif verdict['verdict'] == 'mac':
        flag(number, f"{verdict['preview']}\n\n{ask}", NEEDS_MAC)
    else:
        flag(number, f"{verdict['preview']}\n\n---\n\n{ask}")


def tool_use(event):
    """Whether one event of a run is its model using a tool: an assistant message holding a `tool_use` part
    (claude-code-action's execution file, Claude Code's `stream-json`) or a completed Codex item of `CODEX_TOOLS`."""
    if event.get('type') == 'assistant':
        return any(part.get('type') == 'tool_use' for part in event.get('message', {}).get('content', []))
    return event.get('item', {}).get('type') in CODEX_TOOLS


def worked(path):
    """A run worked when its model used a tool, read from claude-code-action's execution file (a JSON array) or the
    event lines of Claude Code or Codex; a usage limit or a setup failure leaves no tool use."""
    if not path or not Path(path).is_file():
        return False
    text = Path(path).read_text()
    if text.lstrip().startswith('['):
        return any(map(tool_use, json.loads(text)))
    return any(tool_use(json.loads(line)) for line in text.splitlines() if line.strip())


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


def stream(command, prompt, events, env, account):
    """Run `command` on `prompt` as `account`, `git` and `gh` holding a fresh App token with a run's rights, writing its
    stdout lines to `events`, which the public step log shows only as each event's kind; revokes the token after.
    Returns the exit code."""
    name, email = account
    env = {**env, 'GH_TOKEN': app_token(RUN_RIGHTS), 'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email,
           'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
    try:
        subprocess.run(['gh', 'auth', 'setup-git', '--hostname', 'github.com'], env=env, check=True, timeout=60)
        with open(events, 'w') as log, subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                        text=True, env=env) as run:
            run.stdin.write(prompt)
            run.stdin.close()
            for line in run.stdout:
                log.write(line)
                log.flush()
                try:
                    event = json.loads(line)
                except ValueError:
                    event = {}
                content = event.get('message', {}).get('content', [])
                kinds = [part.get('type', '') for part in content] if isinstance(content, list) else []
                print(event.get('type', 'not an event'), event.get('item', {}).get('type', ''), *kinds, flush=True)
    finally:
        subprocess.run(['gh', 'api', '-X', 'DELETE', '/installation/token'], env=env, timeout=60)
    return run.returncode


def answer_out(output, answer):
    """Append the step output `structured_output`, `answer`."""
    delimiter = 'ANSWER_' + secrets.token_hex(8)
    with open(output, 'a') as out:
        out.write(f'structured_output<<{delimiter}\n{answer}\n{delimiter}\n')


def claude(prompt, model, schema, output):
    """L23: run `prompt` on Claude Code's `model` in this checkout, signed in with the Max token in
    `CLAUDE_CODE_OAUTH_TOKEN`, answering the JSON Schema `schema` unless it is None. Appends the step output
    `execution_file`, its event lines, before the run starts, then `structured_output` when it answered. Returns its exit
    code."""
    home = Path(os.environ['RUNNER_TEMP']) / 'claude'
    home.mkdir(mode=0o700)
    events = home / 'events.jsonl'
    with open(output, 'a') as out:
        out.write(f'execution_file={events}\n')
    command = ['claude', '-p', '--model', model, '--output-format', 'stream-json', '--verbose',
               '--dangerously-skip-permissions']
    if schema is not None:
        command += ['--json-schema', schema]
    code = stream(command, prompt, events, os.environ, CLAUDE_ACCOUNT)
    results = [event for event in map(json.loads, events.read_text().splitlines()) if event.get('type') == 'result']
    if schema is not None and results and isinstance(results[-1].get('structured_output'), dict):
        answer_out(output, json.dumps(results[-1]['structured_output']))
    return code


def codex(login, prompt, model, schema, output):
    """L23: run `prompt` on Codex's `model` in this checkout, signed in with the ChatGPT login `login`, answering the JSON
    Schema `schema` unless it is None. Appends the step output `execution_file`, Codex's event lines, before the run
    starts, so a run cut off still leaves them, then `structured_output`, its answer. Returns Codex's exit code."""
    auth = json.loads(login or '{}')
    if auth.get('auth_mode') != 'chatgpt' or not auth.get('tokens'):
        raise ValueError('CODEX_AUTH holds no ChatGPT login: seed the CODEX_AUTH_JSON secret with `codex login`')
    # GitHub masks the whole secret, not each token inside it.
    for value in auth['tokens'].values():
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
    code = stream([*command, '-'], prompt, events, {**os.environ, 'CODEX_HOME': str(home)}, CODEX_ACCOUNT)
    if schema is not None and answer.is_file():
        answer_out(output, answer.read_text().strip())
    return code


def engine(prompt, schema, output):
    """L23: run `prompt` on Codex and, when that model used no tool (a usage limit or a setup failure such as a
    broken ChatGPT login, as `worked` reads it, so the checkout is untouched), on Claude Code. The ChatGPT login leaves the
    environment first, so a Claude Code run's shell never holds it. Returns the exit code of the run that was last."""
    login = os.environ.pop('CODEX_AUTH', '')
    temp = Path(os.environ['RUNNER_TEMP'])

    def codex_or_none():
        try:
            return codex(login, prompt, CODEX_MODEL, schema, output)
        except ValueError as error:  # a broken login is a setup failure: no tool use, so the other engine runs
            print(f'::error::Codex did not start: {error}')
            return 1

    engines = {'Claude Code': (lambda: claude(prompt, CLAUDE_MODEL, schema, output), temp / 'claude' / 'events.jsonl'),
               'Codex': (codex_or_none, temp / 'codex' / 'events.jsonl')}
    run, events = engines['Codex']
    code = run()
    if worked(events):
        return code
    print('engine: Codex did no work; falling back to Claude Code', file=sys.stderr)
    return engines['Claude Code'][0]()


def keep(branch, issue, run_url):
    """L23: the action's App token lasts an hour and a run may not. When the commits a run left on `branch` beyond `main`
    are not all on GitHub, or `issue` is still ready with no open PR from `branch`, push them with a fresh token and
    open a draft naming the Issue, which `built` hands to L81, then revoke the token."""
    def rev(ref):
        return subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref], text=True, capture_output=True,
                              timeout=60).stdout.strip()
    ahead = subprocess.run(['git', 'rev-list', '--count', f'refs/remotes/origin/main..refs/heads/{branch}'], text=True,
                           capture_output=True, timeout=60)
    if ahead.returncode or ahead.stdout.strip() == '0':
        print(f'{branch} holds no commit beyond main; nothing to keep')
        return
    # A push the run made moved its remote-tracking ref; a run that pushed and opened its PR needs no token.
    draft = issue is not None and not orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'number') \
        and orders.queued(issue)
    if rev(f'refs/heads/{branch}') == rev(f'refs/remotes/origin/{branch}') and not draft:
        print(f'{branch} is on GitHub; nothing to keep')
        return
    # From here on `gh` acts with the fresh token.
    token = os.environ['GH_TOKEN'] = app_token()
    try:
        remote = f"https://x-access-token:{token}@github.com/{os.environ['GITHUB_REPOSITORY']}.git"
        push = ['git', 'push', remote, f'refs/heads/{branch}:refs/heads/{branch}']
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


def live_fixes():
    """Fix runs that have not ended, including runs waiting on a branch."""
    return [run for status in ('queued', 'in_progress', 'pending', 'waiting', 'requested')
            for page in orders.gh('api', '--paginate', '--slurp',
                                  f'repos/{{owner}}/{{repo}}/actions/workflows/fix.yml/runs?status={status}&per_page=100')
            for run in page['workflow_runs']]


def fixing(run_id=None):
    """(PR, run id) for each live fix run other than `run_id` whose `fix-run` model job has not ended, including runs
    waiting on a branch; the PR is None for a run that names none."""
    held = []
    for run in live_fixes():
        if run['id'] == run_id:
            continue
        jobs = orders.gh('api', f"repos/{{owner}}/{{repo}}/actions/runs/{run['id']}/jobs?per_page=100")['jobs']
        if not any(job['name'] == 'fix-run' and job['status'] == 'completed' for job in jobs):
            number = re.match(r'Fix PR #(\d+):', run['display_title'])
            held.append((int(number[1]) if number else None, run['id']))
    return held


def codex_slots(most, fixes):
    """The Issues build jobs hold and the PRs `fixes` (as `fixing` lists them) hold, and how many of `most` Codex slots
    stay free: each queued or running build job and each such fix run holds one, so a fix run frees its slot when its
    model job ends, as a build job does (L23). Issue and PR numbers never collide."""
    issues = busy()
    return issues | {pr for pr, _ in fixes if pr}, most - len(issues) - len(fixes)


def choose(rows, taken, free):
    """L96 repair entries for invalid orders, then ready rows, no build job holding either, at most `free` of them."""
    broken = [dict(issue=row['issue'], slug=f"repair-{row['issue']}", repair=True) for row in orders.invalid(rows)
              if row['issue'] not in taken and not row['flagged'] and not row.get('held')]
    ready = [dict(issue=row['issue'], slug=row['slug']) for row in rows if row['state'] == 'ready' and row['issue'] not in taken]
    return (broken + ready)[:max(0, free)]


def failed(pr):
    """The required checks, by name, whose latest result on the PR's head is a failure. A check run counts once no run of
    its workflow is still going on that head, and only if it ended last of its name there: a newer run on the same head
    supersedes an older run's failure (L82)."""
    going = running(pr)
    last = {}
    for check in pr.get('statusCheckRollup') or []:
        name = check.get('name') or check.get('context')
        if name in ('check', 'rules', 'review', 'critic') and check.get('workflowName') not in going and \
                (check.get('completedAt') or '') >= (last.get(name, {}).get('completedAt') or ''):
            last[name] = check
    return [name for name, check in last.items() if (check.get('conclusion') or check.get('state')) == 'FAILURE']


def stopped(pr):
    """The PR body's `Stopped:` paragraph, from that line to the next blank one: the question its Builder ended on for the
    user; '' for none."""
    found = STOPPED.search(pr['body'] or '')
    return found[0].strip() if found else ''


def repairs(prs, now, taken=frozenset()):
    """(pr, head, cause) for each open Builder PR that needs a fix run: a conflict, a failed required check, or a draft
    without a `Stopped:` line whose Issue no build job and which no fix run holds (`taken`, as `codex_slots` reads it)."""
    due = []
    for pr in prs:
        if not pr['headRefName'].startswith('build/') or pr['isCrossRepository']:
            continue
        if pr['isDraft']:
            if not stopped(pr) and not taken & set(related(pr)):
                due.append((pr['number'], pr['headRefOid'], 'unfinished'))
        elif pr['mergeable'] == 'CONFLICTING':
            due.append((pr['number'], pr['headRefOid'], 'conflict'))
        elif causes := failed(pr):
            due.append((pr['number'], pr['headRefOid'], causes[0]))
    return due


def related(pr):
    """The numbers of PR `pr` and the Issue its body links."""
    linked = LINKED.search(pr['body'] or '')
    return [pr['number'], *([int(linked[1])] if linked else [])]


def review_runs(pr, state, context='review'):
    """Ids of the runs behind the PR head's `review` (or, for L103, `critic`) status in `state` (`PENDING`, `FAILURE`, ...)."""
    return [check['targetUrl'].rstrip('/').rsplit('/', 1)[1] for check in pr.get('statusCheckRollup') or []
            if check.get('context') == context and check.get('state') == state]


def running(pr):
    """The workflows with a run that has not ended on the PR's head."""
    return {check['workflowName'] for check in pr.get('statusCheckRollup') or []
            if check.get('workflowName') and check.get('status') != 'COMPLETED'}


def unreviewed(prs):
    """(pr, run id) for each ready PR whose `review` or `critic` status is pending: its run did no model work."""
    return [(pr['number'], run) for pr in prs if not pr['isDraft']
            for context in ('review', 'critic') for run in review_runs(pr, 'PENDING', context)]


def rerun_review(pr, run):
    """Rerun an ended review or critic run that did no model work; after RERUNS attempts, ask the user instead."""
    state = orders.gh('run', 'view', run, '--json', 'status,attempt,url')
    if state['status'] != 'completed':
        return
    if state['attempt'] >= RERUNS:
        flag(pr, f"The run {state['url']} used its {RERUNS} attempts, and the last did no model work: a usage "
                 'limit or a setup failure. Rerun it from that page once it can work.')
        return
    call('run', 'rerun', run)


def pick(most):
    """Start the fix runs open Builder PRs need, ready PRs before drafts, while any of `most` Codex slots is free; rerun
    review runs that did no model work; then print the build matrix for the slots left as JSON."""
    prs = orders.gh('pr', 'list', '--state', 'open', '--limit', '200', '--json',
                    'number,headRefName,headRefOid,isDraft,isCrossRepository,mergeable,body,statusCheckRollup')
    taken, free = codex_slots(most, fixing())
    for pr, head, cause in repairs(sorted(prs, key=lambda pr: pr['isDraft']), time.time(), taken):
        if free < 1:
            print(f'Fix for PR #{pr} ({cause}) waits: build jobs and fix runs hold all {most} Codex slots.', file=sys.stderr)
            continue
        dispatch_fix(pr, head, cause)
        free -= 1
    for pr, run in unreviewed(prs):
        rerun_review(pr, run)
    rows = orders.read_orders()
    print(orders.count_invalid(rows), file=sys.stderr)
    if broken := orders.invalid(rows):
        print('invalid orders: ' + ', '.join(f"#{row['issue']}" for row in broken), file=sys.stderr)
    print(json.dumps(choose(rows, taken, free)))


def changed_scenarios(pr, head):
    """Ids, in file order, of the scenarios PR `pr`'s diff adds or changes: the heading above each changed line of a
    `scenarios/*.md` file at `head`. A deleted heading is a retired scenario and names none."""
    touched, path, hunk, at = {}, None, False, 0
    for line in call('pr', 'diff', str(pr)).splitlines():
        if line.startswith('diff --git'):
            path, hunk = None, False
        elif found := re.fullmatch(r'\+\+\+ b/(scenarios/[^/]+\.md)', line):
            path = found[1]
        elif found := re.match(r'@@ -\d+(?:,\d+)? \+(\d+)', line):
            hunk, at = True, int(found[1])
        elif path and hunk and line.startswith('+'):
            touched.setdefault(path, []).append(at)
            at += 1
        elif path and hunk and line.startswith('-'):
            if not HEADING.match(line[1:]):
                touched.setdefault(path, []).append(max(at - 1, 1))
        elif path and hunk:
            at += 1
    ids = []
    for path, numbers in touched.items():
        text = call('api', f'repos/{{owner}}/{{repo}}/contents/{path}?ref={head}', '-H',
                    'Accept: application/vnd.github.raw').splitlines()
        for number in sorted(set(numbers)):
            above = [m[1] for line in reversed(text[:number]) if (m := HEADING.match(line))][:1]
            ids += [i for i in above if i not in ids]
    return ids


def issue_of(branch):
    """The Issue whose work Key names `build/<key>`, or None."""
    return next((row['issue'] for row in orders.read_orders() if row['slug'] and f"build/{row['slug']}" == branch), None)


def link(pr, issue=None):
    """L82: the loop writes PR `pr`'s `Refs #<issue>` and `Scenarios:` lines, never the Builder: the Issue is `issue`, else
    the one the branch's work Key names, else the one the body links; `Scenarios:` comes from that Issue's own line, else
    from the scenarios the diff adds or changes. A wrong or missing line is replaced in place, with no comment and no fix
    run; a `Closes` or `Fixes` line already naming the Issue stays. Returns the PR with its new body."""
    body = original = pr['body'] or ''
    found = LINKED.search(body)
    issue = issue or issue_of(pr['headRefName']) or (int(found[1]) if found else None)
    ids = ''
    if issue is None:
        print(f"PR #{pr['number']} names no Issue and no work Key finds one; no Refs line to write", file=sys.stderr)
    else:
        if not found or int(found[1]) != issue:
            body = f"Refs #{issue}\n{re.sub(r'^(?:Refs|Closes|Fixes):? #?\d+.*\n?', '', body, count=1, flags=re.M)}"
        ids = orders.field(orders.gh('api', f'repos/{{owner}}/{{repo}}/issues/{issue}')['body'] or '', 'Scenarios', '')
    ids = ids or ', '.join(changed_scenarios(pr['number'], pr['headRefOid']))
    if ids and f'Scenarios: {ids}' not in body.splitlines():
        line = f'Scenarios: {ids}'
        body = re.sub(r'^Scenarios:.*\n?', '', body, count=1, flags=re.M)
        body = re.sub(r'^((?:Refs|Closes|Fixes) #\d+.*)$', lambda m: f'{m[1]}\n{line}', body, count=1, flags=re.M) \
            if LINKED.search(body) else f'{line}\n{body}'
    if body != original:
        call('api', '-X', 'PATCH', f"repos/{{owner}}/{{repo}}/pulls/{pr['number']}", '-f', f'body={body}')
    return dict(pr, body=body)


def ended(pr, verdict, run_url):
    """After a run that worked: a draft's `Stopped:` question goes where its screen `verdict` says (`put`), and one the
    screen sends back to the loop resumes (`resume`); another draft gets a fix run."""
    if not pr['isDraft']:
        return
    if ask := stopped(pr):
        put(pr['number'], ask, verdict, run_url, lambda reason: resume(pr, ask, reason, run_url))
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
    prs = orders.gh('pr', 'list', '--head', f'build/{slug}', '--state', 'open', '--json',
                    'number,headRefName,headRefOid,isDraft,body')
    if prs:
        ended(link(prs[0], issue), verdict, run_url)
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


def view(pr):
    return orders.gh('pr', 'view', str(pr), '--json',
                     'number,url,state,createdAt,headRefOid,headRefName,isDraft,isCrossRepository,body,statusCheckRollup')


def started(attempt):
    """When the fix run an attempt comment links began, or None when its run is not readable."""
    run = re.search(r'/runs/(\d+)', attempt)
    began = (orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run[1]}') if run else {}).get('run_started_at')
    return orders.created(began) if began else None


def rules_failed_only(current, steps):
    """True when the PR head's latest `rules` failure has failed steps, every one matching the pattern `steps`."""
    check = max((c for c in current.get('statusCheckRollup') or [] if c.get('name') == 'rules'),
                key=lambda c: c.get('completedAt') or '', default=None)
    if not check or check.get('conclusion') != 'FAILURE':
        return False
    job = re.search(r'/job/(\d+)', check.get('detailsUrl') or '')
    if not job:
        return False
    ran = orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/jobs/{job[1]}')['steps']
    return (bad := [step['name'] for step in ran if step['conclusion'] == 'failure']) != [] and \
        all(steps.search(name) for name in bad)


def plumbing_runs(pr, opened, run_id):
    """How many fix runs other than `run_id` answered a PLUMBING cause on PR `pr` since `opened`, read from Actions
    history: a run counts once its `fix-run` model job started."""
    title = re.compile(rf"Fix PR #{pr}: (?:{'|'.join(PLUMBING)})\Z")
    runs = [run for page in orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/workflows/fix.yml/runs?created=%3E%3D{opened}&per_page=100',
                                      '--paginate', '--slurp')
            for run in page['workflow_runs'] if run['id'] != run_id and title.match(run['display_title'])]
    return sum(any(job['name'] == 'fix-run' and job['conclusion'] in ('success', 'failure')
                   for job in orders.gh('api', f"repos/{{owner}}/{{repo}}/actions/runs/{run['id']}/jobs?per_page=100")['jobs'])
               for run in runs)


def git(*args):
    """`git <args>` as the Claude App's account, since a merge needs a committer even before it commits."""
    name, email = CLAUDE_ACCOUNT
    return subprocess.run(['git', '-c', f'user.name={name}', '-c', f'user.email={email}', *args], text=True, capture_output=True, timeout=3600)


def resolve_generated(regenerate=REGENERATE):
    """L82: merge `origin/main` into the checked-out branch and commit it when every conflicted path is GENERATED: take
    main's side, run `regenerate`, and require no conflict marker and no change from a second run. Returns whether it
    committed; any other conflict, a failed `regenerate` or a changed second run leaves the branch as it was."""
    def undo(why):
        print(f'resolve-generated: {why}; the branch is left as it was', file=sys.stderr)
        # `merge --abort` refuses a file the index and the worktree hold differently, so the reset comes first.
        git('reset', '-q', '--hard', 'HEAD')
        git('merge', '--abort')
        git('clean', '-fdq', '--', *GENERATED)
        return False

    merge = git('merge', '--no-commit', '--no-ff', 'origin/main')
    conflicted = git('diff', '--name-only', '--diff-filter=U').stdout.split()
    if merge.returncode and not conflicted:
        return undo(f'the merge failed: {merge.stderr.strip()}')
    if other := [path for path in conflicted if not path.startswith(GENERATED)]:
        return undo(f'{", ".join(other)} conflict and are not generated')
    for path in conflicted:
        if git('cat-file', '-e', f'origin/main:{path}').returncode:
            git('rm', '-q', '-f', '--', path)
        else:
            git('checkout', 'origin/main', '--', path)
    if subprocess.run(regenerate, timeout=3600).returncode:
        return undo('the regenerate command failed')
    git('add', '-A', '--', *GENERATED)
    # The second run must leave the worktree as the index holds it: no change, and no file the first run left unstaged.
    if subprocess.run(regenerate, timeout=3600).returncode:
        return undo('the second regenerate failed')
    if changed := git('status', '--porcelain', '--untracked-files=all').stdout:
        unstaged = [line for line in changed.splitlines() if line[1] != ' ']
        if unstaged:
            return undo(f'the regenerate left changes: {unstaged}')
    if git('grep', '--cached', '-lE', r'^(<{7}|>{7})( |$)', '--', *GENERATED).stdout:
        return undo('a conflict marker remains')
    commit = git('commit', '--no-edit')
    return not commit.returncode or undo(f'the commit failed: {commit.stderr.strip()} {commit.stdout.strip()}')


def restore_merge_loss(main_ref='origin/main', rules=None):
    """L120: when `rules.sh merge-loss` fails on the checked-out branch, restore main's version of each file it lists
    (removing one main lacks), commit that, and rerun it. Returns whether it then passes; a rerun that still fails
    resets the branch to where it began, so the engine runs as for any fix."""
    rules = rules or ROOT / 'loop/rules.sh'
    check = lambda: subprocess.run(['bash', str(rules), 'merge-loss', main_ref], text=True, capture_output=True, timeout=600)
    start = git('rev-parse', 'HEAD').stdout.strip()
    first = check()
    lost = [line.strip() for line in first.stderr.splitlines() if line.startswith('  ')]
    if not first.returncode or not lost:
        print(f'restore-merge-loss: no file to restore: {first.stderr.strip()}', file=sys.stderr)
        return False
    for path in lost:
        if git('cat-file', '-e', f'{main_ref}:{path}').returncode:
            git('rm', '-q', '-f', '--', path)
        else:
            git('checkout', main_ref, '--', path)
    author = os.environ.get('GITHUB_RUN_ID', '0')
    commit = git('commit', '-q', '-m', f"Restore main's version of {len(lost)} file(s) a merge lost",
                 '-m', f'Author-Agent: builder-{author}')
    after = commit if commit.returncode else check()
    if after.returncode:
        print(f'restore-merge-loss: {after.stderr.strip()}; the branch is left as it was', file=sys.stderr)
        git('reset', '-q', '--hard', start)
    return not after.returncode


def fix_task(pr, head, cause, run_id=0, output=None):
    """The fix run's task, or None when the PR moved past `head`, is not a Builder PR, no longer fails a `check` or
    `rules` cause there, or used its ATTEMPTS. A plumbing cause (L82) is exempt from ATTEMPTS and writes `plumbing=true`
    to the step output file `output`, so its run posts no attempt."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or not current['headRefName'].startswith('build/'):
        return None
    if cause in ('check', 'rules') and cause not in failed(current):
        # A newer run on this head superseded the failure, or is still going and will decide.
        return None
    plumbing = cause in PLUMBING and (cause == 'conflict' or rules_failed_only(current, PLUMBING_STEPS)) and \
        plumbing_runs(pr, current['createdAt'], run_id) < PLUMBING_RUNS
    # L120: the restore script may repair it before any model runs; it counts no attempt (`fixed` sees no model work).
    merge_loss = cause == 'rules' and rules_failed_only(current, MERGE_LOSS_STEP)
    linked = LINKED.search(current['body'] or '')
    if output:
        with open(output, 'a') as out:
            # The Issue's number picks the engine (L23), so a PR's fix runs start where its build did.
            out.write('plumbing=true\n' * plumbing + 'merge_loss=true\n' * merge_loss + f'issue={linked[1]}\n' * bool(linked))
    attempts = orders.marked(pr, '<!-- fix-attempt -->')
    verdicts = orders.marked(pr, 'VERDICT:')
    answered = orders.created(attempts[-1]['created_at']) if attempts else 0
    if cause == 'review' and verdicts and answered > orders.created(verdicts[-1]['created_at']) and \
            time.time() - answered < IDLE:
        # A fix run answered the last reject, and its push or `fixed` starts a new review: that verdict decides, not the old one.
        return None
    criticisms = orders.marked(pr, 'CRITIC:')
    if cause == 'critic' and not (criticisms and criticisms[-1]['body'].startswith('CRITIC: reject') and
                                  orders.field(criticisms[-1]['body'], 'Head', '') == head and
                                  orders.created(criticisms[-1]['created_at']) > answered):
        # The head moved, or a fix run answered this reject: its next critic run decides.
        return None
    if len(attempts) >= ATTEMPTS and not plumbing:
        exhaust(current, attempts, verdicts, cause)
        return None
    findings = [c['body'] for c in {'review': verdicts, 'critic': criticisms}.get(cause, [])][-1:]
    return '\n\n'.join([f"Fix PR #{pr} on branch `{current['headRefName']}`, head {head}. " +
                        CAUSES[cause].format(cause=cause, pr=pr), *findings,
                        'Push to that branch. End as `.agents/builder.md` says: a ready PR with auto-merge armed, or a '
                        'draft with a `Stopped:` line.'])


def exhaust(current, attempts, verdicts, cause):
    """A Builder PR out of fix runs: tell its work Issue what failed, close the PR unmerged, delete its branch and strike
    the Issue, once per PR. The closed PR keeps its diff at `refs/pull/<pr>/head`. A PR naming no Issue asks the user."""
    pr, branch = current['number'], current['headRefName']
    match = LINKED.search(current['body'] or '')
    if not match:
        flag(pr, f'{ATTEMPTS} fix runs did not get this PR to merge, and its body names no Issue to record that on.')
        return
    issue = int(match[1])
    if orders.marked(issue, f'<!-- fix-exhausted #{pr} -->'):
        return
    commits = orders.gh('pr', 'view', str(pr), '--json', 'commits')['commits']

    def reason(cause, before):
        if cause not in ('review', 'critic'):
            return f'{cause} failed'
        marked = verdicts if cause == 'review' else orders.marked(pr, 'CRITIC:')
        found = [c['body'] for c in marked if orders.created(c['created_at']) <= before][-1:] or ['']
        return f"{cause} rejected: {found[0].split(chr(10) * 2, 1)[-1].strip()}"

    lines, since = [], None
    for attempt in attempts:
        ended_at = orders.created(attempt['created_at'])
        cause_ran = (re.search(r'answered `(\w+)`', attempt['body']) or [None, '?'])[1]
        if since is None:
            since = started(attempt['body']) or ended_at
        subjects = [c['messageHeadline'] for c in commits if since < orders.created(c['committedDate']) <= ended_at]
        lines.append(f"- `{cause_ran}` ({reason(cause_ran, ended_at)}): " + ('; '.join(subjects) or 'no commit'))
        since = ended_at
    comment(issue, f'<!-- fix-exhausted #{pr} -->\nPR #{pr} ({current["url"]}) used its {ATTEMPTS} fix runs and was closed '
                   f'unmerged; its diff stays at that link, head `{current["headRefOid"]}`. Each line is a cause a fix '
                   f'run answered, its failing check or review finding, and the commits it pushed; the last is the cause '
                   f'that found no run left.\n\n'
                   + '\n'.join(lines) + f'\n- `{cause}` ({reason(cause, time.time())}): no fix run left\n\nThe next build run continues from that head.')
    strike(issue, f'PR #{pr} used its {ATTEMPTS} fix runs: {current["url"]}')
    call('pr', 'close', str(pr), '--delete-branch')


def fixed(pr, cause, ran, run_url, verdict=None, plumbing=False):
    """After a fix run that worked (`ran`): count the attempt on the PR (a `plumbing` run, L82, counts none), then hand the PR on with its screen `verdict`.
    A ready head that still holds the reject this run answered, with no `check` running on it, gets its review run
    again: with no push or re-ready, no `check` ends to start one (L24)."""
    if not ran:
        print('the run made no tool call; it counts as no attempt')
        return
    if not plumbing:
        comment(pr, f'<!-- fix-attempt -->\nFix run {run_url} answered `{cause}`.')
    current = link(view(pr))
    ended(current, verdict, run_url)
    if cause in ('review', 'critic') and not current['isDraft'] and 'check' not in running(current):
        for run in review_runs(current, 'FAILURE', cause):
            call('run', 'rerun', run)


def clauses(ids):
    """The full text of each scenario `ids` names, as this checkout's `scenarios/` holds it: its heading line through the
    line before the next scenario or Markdown heading, in file order. An id no heading holds gets a line saying so."""
    wanted, found = set(re.findall(rf'\b{SCENARIO_ID}\b', ids)), {}
    for path in sorted((ROOT / 'scenarios').glob('*.md')):
        current = None
        for line in path.read_text().splitlines():
            heading = HEADING.match(line)
            if heading or re.match(r'#+ ', line):
                current = heading[1] if heading and heading[1] in wanted else None
                if current:
                    found[current] = [f'From `scenarios/{path.name}`:', '']
            if current:
                found[current].append(line)
    missing = [f'No scenario on `main` holds {name}.' for name in sorted(wanted - found.keys())]
    return '\n\n'.join(['\n'.join(text).rstrip() for text in found.values()] + missing)


def review_task(pr, head):
    """The review run's task, or None when the PR is not open at `head` or is a draft: the body's `Scenarios:` and
    `Moves:` lines and never the rest of the body (rule 5), the full text of each scenario the `Scenarios:` line names
    as `main` holds it, then the earlier verdicts, whose findings the run re-derives."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or current['isDraft']:
        return None
    named = re.findall(r'^(?:Scenarios|Moves):.*$', current['body'] or '', re.M)
    ids = ' '.join(line for line in named if line.startswith('Scenarios:'))
    lines = [f'Review PR #{pr}, head {head}.', *named, '\nThe scenarios, as `main` holds them:\n\n' +
             (clauses(ids) or 'The PR names none.')]
    earlier = [c['body'] for c in orders.marked(pr, 'VERDICT:')]
    if earlier:
        lines += ['\nEarlier verdicts, oldest first. Each finding is a claim to re-derive as Review run step 3 says, '
                  'never one to repeat:\n\n' + '\n\n---\n\n'.join(earlier)]
    return '\n'.join(lines)


def status(head, state, description, run_url, context='review'):
    call('api', f'repos/{{owner}}/{{repo}}/statuses/{head}', '-f', f'state={state}', '-f', f'context={context}',
         '-f', f'description={description}', '-f', f'target_url={run_url}')


def review_post(pr, head, reviewer, answer, ran, run_url):
    """Publish a review run's answer on `head`: a VERDICT comment and the `review` status; a reject on a Builder PR
    starts a fix run. Lines that would forge a verdict field are dropped. A run whose model did no work (`ran` false)
    leaves `review` pending for pick to rerun. False when a run that worked holds no verdict."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head:
        print(f'PR #{pr} moved past {head}; the newer head gets its own review')
        return True
    answer = json.loads(answer) if answer.strip() else {}
    verdict = answer.get('verdict')
    if verdict not in ('approve', 'reject') and not ran:
        status(head, 'pending', 'The review run did no model work; the next build pick reruns it', run_url)
        return True
    if verdict not in ('approve', 'reject'):
        status(head, 'error', 'The review run gave no verdict', run_url)
        flag(pr, f'The review run {run_url} gave no verdict on {head}; rerun it from that page.')
        return False
    findings = '\n'.join(line for line in str(answer.get('findings', '')).splitlines()
                         if not re.match(r'(VERDICT|Head|Reviewed-by-Agent):', line))
    comment(pr, f'VERDICT: {verdict}\nHead: {head}\n\n{findings}\n\nReviewed-by-Agent: {reviewer}')
    status(head, 'success' if verdict == 'approve' else 'failure', f'The review run answered {verdict}', run_url)
    if verdict == 'reject' and current['headRefName'].startswith('build/') and not current['isCrossRepository']:
        dispatch_fix(pr, head, 'review')
    return True


BAR = 'elegant, well designed and tasteful. That is the bar'
# L103: a reject posts as the critic wrote it, up to this many characters.
CRITIC_CAP = 6000
# L103: a finding line starting so is polish or an idea; it never blocks.
POLISH = re.compile(r'(NOTE:|ideas\b)')


def touches_desktop(pr):
    """Whether PR `pr` changes a file under `apps/desktop/src/` (rule 8). Reads the PR's files list, which answers past
    the 300 files where GitHub refuses `gh pr diff`."""
    return any(changed['filename'].startswith('apps/desktop/src/') for page in orders.gh(
        'api', f'repos/{{owner}}/{{repo}}/pulls/{pr}/files?per_page=100', '--paginate', '--slurp') for changed in page)


def critic_task(pr, head):
    """The design critic's task (L103), or None when the PR is not open at `head` or is a draft. A PR that changes
    nothing under `apps/desktop/src/` gets its `critic` status `success` here, with no model run."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or current['isDraft']:
        return None
    if not touches_desktop(pr):
        status(head, 'success', 'The PR changes nothing under apps/desktop/src: no design critic run', '', 'critic')
        return None
    lines = [f'Critique PR #{pr}, head {head}, as `.agents/design-critic.md` says.',
             *re.findall(r'^(?:Scenarios|Moves):.*$', current['body'] or '', re.M),
             f'The user\'s bar for UI work, set in #400: "{BAR}". Judge the diff (`gh pr diff {pr}`, or `git diff '
             'origin/main...HEAD` when GitHub refuses a diff over 300 files) against it and `docs/design-system.md`, '
             '`docs/wireframes.md` and `GLOSSARY.md`. Capture `origin/main` and this head on the seeds and at the '
             'viewports of `.agents/data/harness.md`. Nothing the author wrote counts as intent (rule 5).']
    earlier = [c['body'] for c in orders.marked(pr, 'CRITIC:')]
    if earlier:
        last = orders.field(earlier[-1], 'Head', '')
        lines += ['\nThis is a later round (`.agents/design-critic.md`, Later rounds): judge the earlier findings below and '
                  + (f'`git diff {last}...HEAD`' if last else 'the commits since the last judged head') + ' only. Block '
                  'only on a block: an unfixed earlier block, a new block, a failure of the scenario\'s goal, or ugly or '
                  'hacky UI or code; raise no new polish and never block on an earlier `NOTE:`.',
                  '\nEarlier critic findings, oldest first:\n\n' + '\n\n---\n\n'.join(earlier)]
    return '\n'.join(lines)


def critic_post(pr, head, critic, answer, ran, run_url):
    """Publish a design critic's answer on `head` (L103): a `CRITIC:` comment and the `critic` status; a reject on a
    Builder PR starts a fix run with cause `critic`. A run whose model did no work (`ran` false) leaves `critic` pending
    for pick to rerun. A reject posts its findings text as written, capped at CRITIC_CAP characters, and starts the fix run
    even when no line has the shape the prompt asks for. False when a run that worked holds no verdict, or a reject with
    no text."""
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
    if verdict not in ('approve', 'reject') or (verdict == 'reject' and not any(line.strip() for line in findings)):
        status(head, 'error', 'The critic run gave no usable verdict', run_url, 'critic')
        flag(pr, f'The critic run {run_url} gave no usable verdict on {head}; rerun it from that page.')
        return False
    if verdict == 'reject' and all(POLISH.match(line) for line in findings if line.strip()):
        verdict = 'approve'  # polish alone never blocks, in any round
    text = '\n'.join(findings)
    if len(text) > CRITIC_CAP:
        text = text[:CRITIC_CAP].rstrip() + '\n[cut: the critic wrote more than ' + str(CRITIC_CAP) + ' characters]'
    comment(pr, f'CRITIC: {verdict}\nHead: {head}\n\n' + text + f'\n\nReviewed-by-Agent: {critic}')
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
    match args:
        case ['prompt', *name] if len(name) < 2:
            prompt(sys.stdin.read(), os.environ['GITHUB_OUTPUT'], *name)
        case ['worked', path]:
            return 0 if worked(path) else 1
        case ['engine', *schema] if len(schema) < 2:
            return engine(sys.stdin.read(), schema[0] if schema else None, os.environ['GITHUB_OUTPUT'])
        case ['pick', most] if most.isdigit():
            pick(int(most))
        case ['keep', branch, *issue] if len(issue) < 2 and all(number.isdigit() for number in issue):
            keep(branch, int(issue[0]) if issue else None, run_url)
        case ['screen', branch]:
            if ask := question(sys.stdin.read(), branch):
                print(encode(screen(ask)))
        case ['built', issue, slug, ran, verdict] if issue.isdigit() and ran in ('true', 'false'):
            built(int(issue), slug, ran == 'true', sys.stdin.read(), run_url, decode(verdict))
        case ['resolve-generated']:
            return 0 if resolve_generated() else 1
        case ['restore-merge-loss']:
            return 0 if restore_merge_loss() else 1
        case ['fix-task', pr, head, cause] if pr.isdigit() and cause in CAUSES:
            if codex_slots(int(os.environ['CODEX_RUNS']), fixing(int(os.environ['GITHUB_RUN_ID'])))[1] < 1:
                print('Skip fix: build jobs and other fix runs hold every Codex slot (L23); a later pick starts the '
                      'repair this PR still needs.', file=sys.stderr)
                return 3
            return task_or_nothing(fix_task(int(pr), head, cause, int(os.environ['GITHUB_RUN_ID']), os.environ['GITHUB_OUTPUT']))
        case ['fixed', pr, cause, ran, verdict, plumbing] if pr.isdigit() and ran in ('true', 'false') and \
                plumbing in ('true', 'false'):
            fixed(int(pr), cause, ran == 'true', run_url, decode(verdict), plumbing == 'true')
        case ['review-task', pr, head] if pr.isdigit():
            return task_or_nothing(review_task(int(pr), head))
        case ['review-post', pr, head, reviewer, ran] if pr.isdigit() and ran in ('true', 'false'):
            return 0 if review_post(int(pr), head, reviewer, sys.stdin.read(), ran == 'true', run_url) else 1
        case ['critic-task', pr, head] if pr.isdigit():
            return task_or_nothing(critic_task(int(pr), head))
        case ['critic-post', pr, head, critic, ran] if pr.isdigit() and ran in ('true', 'false'):
            return 0 if critic_post(int(pr), head, critic, sys.stdin.read(), ran == 'true', run_url) else 1
        case _:
            print('usage: builder.py prompt [<role>] | worked <file> | engine [<schema>] | keep <branch> [<issue>] | resolve-generated | restore-merge-loss | pick <most> | screen <branch> | '
                  'built <issue> <slug> <ran> '
                  '<verdict> | fix-task <pr> <head> <cause> | fixed <pr> <cause> <ran> <verdict> <plumbing> | review-task <pr> <head> | '
                  'review-post <pr> <head> <reviewer> <ran> | critic-task <pr> <head> | critic-post <pr> <head> <critic> <ran>',
                  file=sys.stderr)
            return 2
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'builder: {error}', file=sys.stderr)
        sys.exit(4)
