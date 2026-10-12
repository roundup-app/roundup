#!/usr/bin/env python3
"""L23, L24, L79, L81, L82, L100: what GitHub Actions leaves to roundup around Builder runs: which Issues to build, how
a run ended, when a PR leaves draft, when it gets a fix run and how a review run's answer reaches the PR. Exit 4: GitHub
could not be read or written."""
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
# `.agents/data/pr.md`: the body lines naming a PR's scenarios and the Checks it moves, the only ones a review run reads
# (L24); one counts with text after its colon (L100).
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
# L82: the jobs a `check` or `rules` cause stands for, and the workflow whose runs on `main` hold their results there.
LANES = {'check': ('check.yml', ('rust', 'web')), 'rules': ('loop.yml', ('rules',))}
# L82: the comment a fix run that only merges `main` posts first, followed by the head it refreshes.
REFRESH = '<!-- fix-refresh'
# L82: the comment a fix run whose task names only a conflict posts first, followed by its head: `main` moved, not the
# PR, so the run counts no attempt.
CONFLICT = '<!-- fix-conflict'
# L82: how many such runs a PR gets. `pick` holds a conflict until its head's review verdict, so each follows a reviewed
# head; #870 spent two of its three attempts on conflicts. A PR gets at most ATTEMPTS + CONFLICTS fix runs, refreshes aside.
CONFLICTS = 3
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


def screen(ask):
    """Haiku's verdict on what a run asks the user (L79, `.agents/screen.md`): a dict of `verdict` (one of `VERDICTS`),
    `reason` and `preview`, or None when Claude Code gave no valid one."""
    try:
        out = subprocess.run(['claude', '-p', '--model', SCREEN_MODEL, '--tools', '', '--max-turns', '3',
                              '--output-format', 'json', '--json-schema', json.dumps(SCREEN_SCHEMA)],
                             input=f'{role("screen")}\n## Ask\n\n{ask}\n', text=True, capture_output=True,
                             timeout=300, check=True)
        verdict = json.loads(out.stdout).get('structured_output')
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError) as error:
        print(f'screen: Claude Code gave no verdict: {error}', file=sys.stderr)
        return None
    return verdict if isinstance(verdict, dict) and verdict.get('verdict') in VERDICTS else None


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
    name, email = CODEX_ACCOUNT
    env = {**os.environ, 'CODEX_HOME': str(home), 'GH_TOKEN': app_token(RUN_RIGHTS), 'GIT_AUTHOR_NAME': name,
           'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
    try:
        subprocess.run(['gh', 'auth', 'setup-git', '--hostname', 'github.com'], env=env, check=True, timeout=60)
        # The step log shows each event as the event file keeps it.
        with open(events, 'w') as log, subprocess.Popen([*command, '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                        text=True, env=env) as run:
            run.stdin.write(prompt)
            run.stdin.close()
            for line in run.stdout:
                log.write(line)
                log.flush()
                print(line, end='', flush=True)
    finally:
        subprocess.run(['gh', 'api', '-X', 'DELETE', '/installation/token'], env=env, timeout=60)
    if schema is not None and answer.is_file():
        delimiter = 'ANSWER_' + secrets.token_hex(8)
        with open(output, 'a') as out:
            out.write(f'structured_output<<{delimiter}\n{answer.read_text().strip()}\n{delimiter}\n')
    return run.returncode


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
    if owner_closed(*([issue] if issue else []), *closed_prs(branch)):
        print(f'the owner closed #{issue} or a PR on {branch}; nothing to push')
        return
    # A push the run made moved its remote-tracking ref; a run that pushed and opened its PR needs no token.
    draft = issue is not None and not orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'number') \
        and orders.queued(issue)
    if rev(f'refs/heads/{branch}') == rev(f'refs/remotes/origin/{branch}') and not draft:
        print(f'{branch} is on GitHub; nothing to keep')
        return
    # From here on `gh`, and L97's pre-push hook under `git push`, act with the fresh token.
    token = os.environ['GH_TOKEN'] = app_token()
    try:
        remote = f"https://x-access-token:{token}@github.com/{os.environ['GITHUB_REPOSITORY']}.git"
        push = ['git', 'push', remote, f'refs/heads/{branch}:refs/heads/{branch}']
        # L97's hook may renumber a scenario id in a new commit and fail the push; the second push carries that commit.
        if subprocess.run(push, timeout=300).returncode:
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


def choose(rows, taken, most):
    """L96 repair entries for invalid orders, then ready rows, no build job holding either, filling the slots `most`
    leaves after `taken`."""
    broken = [dict(issue=row['issue'], slug=f"repair-{row['issue']}", repair=True) for row in orders.invalid(rows)
              if row['issue'] not in taken and not row['flagged'] and not row.get('held')]
    free = [dict(issue=row['issue'], slug=row['slug']) for row in rows if row['state'] == 'ready' and row['issue'] not in taken]
    return (broken + free)[:max(0, most - len(taken))]


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


def failed(pr):
    """The required checks, by name, whose latest result on the PR's head is a failure (L82)."""
    return [name for name, check in latest(pr, ('check', 'rules', 'review', 'critic')).items()
            if (check.get('conclusion') or check.get('state')) == 'FAILURE']


def blame(pr, cause):
    """Who failed the `check` or `rules` cause on the PR's head, judged on the jobs that failed it (L82): 'pr' when one
    of them passed on each `main` push the PR's run could have merged, from its merge base until that job started;
    'main' while `main`'s latest result for each still fails, or one of those pushes has not ended it; 'base' once `main`
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
            verdicts.add('main' if 'pending' in merged else 'pr')
            continue
        now = next((found for push in pushes if (found := result(push, name)) in ('success', 'failure')), None)
        verdicts.add('base' if now == 'success' else 'main')
    return next(verdict for verdict in ('pr', 'main', 'base') if verdict in verdicts)


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
            cause = (failed(pr) or [None])[0]
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
    """(pr, run id) for each ready PR whose `review` or `critic` status is pending: that run did no model work."""
    return [(pr['number'], run) for pr in prs if not pr['isDraft']
            for context in ('review', 'critic') for run in review_runs(pr, 'PENDING', context)]


def open_reviews():
    """The branches with a queued or running review.yml run. Its run name is `Review <branch>`; the run is a `workflow_run`
    run on `main`, so the PR's status rollup never shows it."""
    return {run['displayTitle'].removeprefix('Review ') for status in ('queued', 'in_progress')
            for run in orders.gh('run', 'list', '--workflow', 'review.yml', '--status', status, '--json', 'displayTitle')}


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
    """Rerun an ended review run that did no model work; after RERUNS attempts, ask the user instead."""
    state = orders.gh('run', 'view', run, '--json', 'status,attempt,url')
    if state['status'] != 'completed':
        return
    if state['attempt'] >= RERUNS:
        flag(pr, f"The review run {state['url']} used its {RERUNS} attempts, and the last did no model work: a usage "
                 'limit or a setup failure. Rerun it from that page once it can work.')
        return
    call('run', 'rerun', run)


def pick(most):
    """Start the fix runs open Builder PRs need, rerun review runs that did no model work, then print the build matrix
    as JSON."""
    prs = orders.gh('pr', 'list', '--state', 'open', '--limit', '200', '--json',
                    'number,headRefName,headRefOid,isDraft,isCrossRepository,mergeable,body,updatedAt,statusCheckRollup')
    for pr, head, cause in repairs(prs, time.time()):
        dispatch_fix(pr, head, cause)
    for pr, run in unreviewed(prs):
        rerun_review(pr, run)
    for _, run in unlaunched(prs, time.time(), open_reviews()):
        call('run', 'rerun', run)
    rows = orders.read_orders()
    print(orders.count_invalid(rows), file=sys.stderr)
    if broken := orders.invalid(rows):
        print('invalid orders: ' + ', '.join(f"#{row['issue']}" for row in broken), file=sys.stderr)
    print(json.dumps(choose(rows, busy(), most)))


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
    began = (orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run[1]}') if run else {}).get('run_started_at')
    return orders.created(began) if began else None


def fix_task(pr, head, cause, run_url):
    """The fix run's task, or None when the PR moved past `head`, is not a Builder PR, no longer fails a `check` or
    `rules` cause there, failed it because `main` does, or used its ATTEMPTS. A failure an older `main` caused that
    `main` passes now gets a task to merge `main` only, once per head, which counts no attempt. Whatever `cause`, the
    task also names a conflict with `main`, first, and a reject of `head` that no fix run answered, so one run answers
    each. A task that names only a conflict counts no attempt, CONFLICTS times per PR, even after ATTEMPTS."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or not current['headRefName'].startswith('build/'):
        return None
    if held(current) or owner_closed(*related(current)):
        return None
    if cause == 'answered' and not owner_answered(current):
        return None
    if cause in ('check', 'rules') and cause not in failed(current):
        # A newer run on this head superseded the failure, or is still going and will decide.
        return None
    verdict = blame(current, cause) if cause in ('check', 'rules') else 'pr'
    if verdict == 'main':
        # A fix run would answer `main`'s failure: no run, no attempt. `pick` dispatches the cause again until `main` passes.
        return None
    if verdict == 'base' and current['mergeable'] != 'CONFLICTING' and not orders.marked(pr, f'{REFRESH} {head} -->'):
        comment(pr, f'{REFRESH} {head} -->\nFix run {run_url} merges `main`: `main` failed `{cause}` on a push this head '
                    f'merged and passes it now. It counts no fix attempt.')
        return (f"Refresh PR #{pr} on branch `{current['headRefName']}`, head {head}: `main` failed `{cause}` on a push "
                'this head merged and passes it now. Merge `origin/main` into that branch and push it, changing nothing '
                'else; this run counts no fix attempt. End as `.agents/builder.md` says: a ready PR with auto-merge armed.')
    attempts = orders.marked(pr, '<!-- fix-attempt -->')
    verdicts = orders.marked(pr, 'VERDICT:')
    answered = orders.created(attempts[-1]['created_at']) if attempts else 0
    if cause == 'review' and verdicts and answered > orders.created(verdicts[-1]['created_at']) and \
            time.time() - answered < IDLE:
        # A fix run answered the last reject, and its push or `fixed` starts a new review: that verdict decides, not the old one.
        return None
    last = verdicts[-1]['body'] if verdicts else ''
    rejected = last.startswith('VERDICT: reject') and orders.field(last, 'Head', '') == head and \
        orders.created(verdicts[-1]['created_at']) > answered
    criticisms = orders.marked(pr, 'CRITIC:')
    seen = criticisms[-1]['body'] if criticisms else ''
    criticized = seen.startswith('CRITIC: reject') and orders.field(seen, 'Head', '') == head and \
        orders.created(criticisms[-1]['created_at']) > answered
    if cause == 'critic' and not criticized:
        # The head moved, or a fix run answered this reject: its next critic run decides.
        return None
    also = {'conflict': current['mergeable'] == 'CONFLICTING', 'review': rejected, 'critic': criticized}
    causes = [name for name in CAUSES if name == cause or also.get(name)]
    free = causes == ['conflict'] and len(conflicts := orders.marked(pr, CONFLICT)) < CONFLICTS
    if free:
        comment(pr, f'{CONFLICT} {head} -->\nFix run {run_url} merges `main` into this head, which conflicts with it. It '
                    f'counts no fix attempt ({len(conflicts) + 1} of {CONFLICTS} such runs).')
    elif len(attempts) >= ATTEMPTS:
        exhaust(current, attempts, verdicts, cause)
        return None
    findings = [last] if 'review' in causes and last else []
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
                   + '\n'.join(lines) + f'\n- `{cause}` ({reason(cause, time.time())}): no fix run left\n\nTake another approach.')
    strike(issue, f'PR #{pr} used its {ATTEMPTS} fix runs: {current["url"]}')
    call('pr', 'close', str(pr), '--delete-branch')


def fixed(pr, cause, ran, run_url, verdict=None):
    """After a fix run that worked (`ran`): count the attempt on the PR, unless the run only merged `main` (L82), then
    hand the PR on with its screen `verdict`. A ready head that still holds the reject this run answered, with no `check`
    running on it, gets its review run again: with no push or re-ready, no `check` ends to start one (L24). A run that
    did not work deletes its refresh or conflict comment, so it records nothing and the PR keeps that run."""
    free = [note for marker in (REFRESH, CONFLICT) for note in orders.marked(pr, marker)
            if f'Fix run {run_url} ' in note['body']]
    if not ran:
        for note in free:
            call('api', '-X', 'DELETE', f"repos/{{owner}}/{{repo}}/issues/comments/{note['id']}")
        print('the run made no tool call; it counts as no attempt')
        return
    current = view(pr)
    if owner_closed(*related(current)):
        print('the owner closed this PR or its Issue; it stays closed')
        return
    if not free:
        comment(pr, f'<!-- fix-attempt -->\nFix run {run_url} answered `{cause}`.')
    ended(current, verdict, run_url)
    if cause in ('review', 'critic') and not current['isDraft'] and 'check' not in running(current):
        for run in review_runs(current, 'FAILURE', cause):
            call('run', 'rerun', run)


def review_task(pr, head):
    """The review run's task, or None when the PR is not open at `head` or is a draft."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or current['isDraft'] or held(current):
        return None
    lines = [f'Review PR #{pr}, head {head}.', *(line[0] for line in NAMED.finditer(current['body'] or ''))]
    if touches_desktop(pr):
        percy = subprocess.run(['loop/percy.sh', 'build', head], text=True, stdout=subprocess.PIPE)
        if percy.returncode == 0:
            lines.append(f'It touches apps/desktop/src: run percy-review on Percy build {percy.stdout.strip()}, made for '
                         'this head; with a build id it needs no .percy/config.yml. Each diff must match a then-clause of '
                         'the scenarios above or a D check the Moves: line names; nothing the author wrote counts as '
                         'intent (rule 5).')
        elif percy.returncode == 1:
            lines.append('It touches apps/desktop/src, but no Percy build exists for this head: review the code alone and '
                         'say so in a NOTE.')
        else:
            raise OSError('the Percy API failed')
    earlier = [c['body'] for c in orders.marked(pr, 'VERDICT:')]
    if earlier:
        lines += ['If an earlier approval names an ancestor, focus on the changes since that head, including conflict '
                  'resolutions and their effects. Your verdict still covers the current head; do not repeat unchanged '
                  'findings.', '\nEarlier verdicts, oldest first:\n\n' + '\n\n---\n\n'.join(earlier)]
    return '\n'.join(lines)


def touches_desktop(pr):
    """Whether PR `pr` changes a file under `apps/desktop/src/` (rule 8)."""
    return any(path.startswith('apps/desktop/src/') for path in call('pr', 'diff', str(pr), '--name-only').split())


def ready(pr):
    """L100: mark PR `pr` ready and arm auto-merge once its body holds a `Scenarios:` line and, when it touches
    `apps/desktop/src/`, a `Moves:` line. Otherwise change nothing, name each missing line on stderr and return False."""
    current = view(pr)
    if owner_closed(*related(current)):
        print(f'PR #{pr} stays as it is: the owner closed it or its Issue, and a closure outlasts its run (L102).',
              file=sys.stderr)
        return False
    needed = ('Scenarios', 'Moves') if touches_desktop(pr) else ('Scenarios',)
    held = {line[1] for line in NAMED.finditer(current['body'] or '')}
    missing = [SHAPES[name] for name in needed if name not in held]
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
# L103: a reject's finding, either of a check of `docs/design-system.md` or of the bar where no check reaches.
FINDING = re.compile(r'^(rule \S+, scenario \S+, step [^,]+, \S.*|bar, [^,]+, [^,]+, \S.*)$')


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
             f'The user\'s bar for UI work, set in #400: "{BAR}". Judge the diff (`gh pr diff {pr}`) against it and '
             '`docs/design-system.md`, `docs/wireframes.md` and `GLOSSARY.md`. Capture `origin/main` and this head on the '
             'seeds and at the viewports of `.agents/data/harness.md`. Nothing the author wrote counts as intent (rule 5).']
    percy = subprocess.run(['loop/percy.sh', 'build', head], text=True, stdout=subprocess.PIPE)
    if percy.returncode == 0:
        lines.append(f'The Percy build of this head is {percy.stdout.strip()}; run percy-review on it.')
    elif percy.returncode == 1:
        lines.append('No Percy build exists for this head: judge the harness captures alone.')
    else:
        raise OSError('the Percy API failed')
    return '\n'.join(lines)


def critic_post(pr, head, critic, answer, ran, run_url):
    """Publish a design critic's answer on `head` (L103): a `CRITIC:` comment and the `critic` status; a reject on a
    Builder PR starts a fix run with cause `critic`. A reject with no finding of FINDING's shape is an error, as no
    verdict is. A run whose model did no work (`ran` false) leaves `critic` pending for pick to rerun. False when a run
    that worked holds no usable verdict."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head:
        print(f'PR #{pr} moved past {head}; the newer head gets its own critic run')
        return True
    answer = json.loads(answer) if answer.strip() else {}
    verdict = answer.get('verdict')
    findings = [line for line in str(answer.get('findings', '')).splitlines()
                if not re.match(r'(CRITIC|Head|Reviewed-by-Agent):', line)]
    if verdict not in ('approve', 'reject') and not ran:
        status(head, 'pending', 'The critic run did no model work; the next build pick reruns it', run_url, 'critic')
        return True
    if verdict not in ('approve', 'reject') or (verdict == 'reject' and not any(FINDING.match(line) for line in findings)):
        status(head, 'error', 'The critic run gave no verdict with a named cause', run_url, 'critic')
        flag(pr, f'The critic run {run_url} gave no verdict with a named cause on {head}; rerun it from that page.')
        return False
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
    match args:
        case ['prompt', *name] if len(name) < 2:
            prompt(sys.stdin.read(), os.environ['GITHUB_OUTPUT'], *name)
        case ['worked', path]:
            return 0 if worked(path) else 1
        case ['codex', model, *schema] if len(schema) < 2:
            return codex(sys.stdin.read(), model, schema[0] if schema else None, os.environ['GITHUB_OUTPUT'])
        case ['pick', most] if most.isdigit():
            pick(int(most))
        case ['keep', branch, *issue] if len(issue) < 2 and all(number.isdigit() for number in issue):
            keep(branch, int(issue[0]) if issue else None, run_url)
        case ['screen', branch]:
            if ask := question(sys.stdin.read(), branch):
                print(json.dumps(screen(ask)))
        case ['built', issue, slug, ran, verdict] if issue.isdigit() and ran in ('true', 'false'):
            built(int(issue), slug, ran == 'true', sys.stdin.read(), run_url, json.loads(verdict or 'null'))
        case ['fix-task', pr, head, cause] if pr.isdigit() and cause in CAUSES:
            return task_or_nothing(fix_task(int(pr), head, cause, run_url))
        case ['fixed', pr, cause, ran, verdict] if pr.isdigit() and ran in ('true', 'false'):
            fixed(int(pr), cause, ran == 'true', run_url, json.loads(verdict or 'null'))
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
            print('usage: builder.py prompt | worked <file> | codex <model> [<schema>] | keep <branch> [<issue>] | pick <most> | screen <branch> | '
                  'built <issue> <slug> <ran> '
                  '<verdict> | fix-task <pr> <head> <cause> | fixed <pr> <cause> <ran> <verdict> | review-task <pr> <head> | '
                  'review-post <pr> <head> <reviewer> <ran> | critic-task <pr> <head> | critic-post <pr> <head> <critic> <ran> | ready <pr> | closed <number>...', file=sys.stderr)
            return 2
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'builder: {error}', file=sys.stderr)
        sys.exit(4)
