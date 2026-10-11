#!/usr/bin/env python3
"""L23, L24, L79, L81, L82: what GitHub Actions leaves to roundup around Builder runs: which Issues to build, how a run
ended, when a PR gets a fix run and how a review run's answer reaches the PR. Exit 4: GitHub could not be read or
written."""
import json
import os
import re
import secrets
import subprocess
import sys
import time
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
# L81: a draft's `Stopped:` paragraph, from that line to the next blank one.
STOPPED = re.compile(r'^Stopped:.*(?:\r?\n.*\S.*)*', re.M)
ATTEMPTS = 3
# A draft PR untouched this long has no live run: build and fix jobs time out after two hours.
IDLE = 3 * 3600
# A review run whose model did no work (a usage limit) leaves `review` pending; pick reruns it this many times in all.
RERUNS = 6
FAILED = '`{cause}` failed on this head. `gh pr checks {pr}` lists the failed run; `gh run view <id> --log-failed` shows why.'
CAUSES = {
    'check': FAILED,
    'rules': FAILED,
    'review': 'The review run rejected this head; its findings are the last verdict below.',
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


def prompt(task, output):
    """Append the step output `prompt`: `.agents/builder.md`, a `## Task` heading, then the task."""
    delimiter = 'PROMPT_' + secrets.token_hex(8)
    with open(output, 'a') as out:
        out.write(f'prompt<<{delimiter}\n{role("builder")}\n## Task\n\n{task.rstrip()}\n{delimiter}\n')


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
    """A run worked when its model used a tool; a usage limit or a setup failure leaves no tool use."""
    if not path or not Path(path).is_file():
        return False
    return any(entry.get('type') == 'assistant' and
               any(part.get('type') == 'tool_use' for part in entry.get('message', {}).get('content', []))
               for entry in json.loads(Path(path).read_text()))


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


def failing(pr):
    """The first required check, by name, that failed on the PR's head."""
    for check in pr.get('statusCheckRollup') or []:
        name = check.get('name') or check.get('context')
        if name in ('check', 'rules', 'review') and (check.get('conclusion') or check.get('state')) == 'FAILURE':
            return name
    return None


def stopped(pr):
    """The PR body's `Stopped:` paragraph, from that line to the next blank one: the question its Builder ended on for the
    user; '' for none."""
    found = STOPPED.search(pr['body'] or '')
    return found[0].strip() if found else ''


def repairs(prs, now):
    """(pr, head, cause) for each open Builder PR that needs a fix run: a conflict, a failed required check, or a draft
    without a `Stopped:` line that no run has touched for IDLE seconds."""
    due = []
    for pr in prs:
        if not pr['headRefName'].startswith('build/') or pr['isCrossRepository']:
            continue
        if pr['isDraft']:
            if now - orders.created(pr['updatedAt']) >= IDLE and not stopped(pr):
                due.append((pr['number'], pr['headRefOid'], 'unfinished'))
        elif pr['mergeable'] == 'CONFLICTING':
            due.append((pr['number'], pr['headRefOid'], 'conflict'))
        elif cause := failing(pr):
            due.append((pr['number'], pr['headRefOid'], cause))
    return due


def review_runs(pr, state):
    """Ids of the review runs behind the PR head's `review` status in `state` (`PENDING`, `FAILURE`, ...)."""
    return [check['targetUrl'].rstrip('/').rsplit('/', 1)[1] for check in pr.get('statusCheckRollup') or []
            if check.get('context') == 'review' and check.get('state') == state]


def checking(pr):
    """Whether a `check` run has not ended on the PR's head."""
    return any(check.get('workflowName') == 'check' and check.get('status') != 'COMPLETED'
               for check in pr.get('statusCheckRollup') or [])


def unreviewed(prs):
    """(pr, run id) for each ready PR whose `review` status is pending: its review run did no model work."""
    return [(pr['number'], run) for pr in prs if not pr['isDraft'] for run in review_runs(pr, 'PENDING')]


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


def view(pr):
    return orders.gh('pr', 'view', str(pr), '--json',
                     'number,url,state,headRefOid,headRefName,isDraft,isCrossRepository,body,statusCheckRollup')


def started(attempt):
    """When the fix run an attempt comment links began, or None when its run is not readable."""
    run = re.search(r'/runs/(\d+)', attempt)
    began = (orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run[1]}') if run else {}).get('run_started_at')
    return orders.created(began) if began else None


def fix_task(pr, head, cause):
    """The fix run's task, or None when the PR moved past `head`, is not a Builder PR, or used its ATTEMPTS."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or not current['headRefName'].startswith('build/'):
        return None
    attempts = orders.marked(pr, '<!-- fix-attempt -->')
    verdicts = orders.marked(pr, 'VERDICT:')
    answered = orders.created(attempts[-1]['created_at']) if attempts else 0
    if cause == 'review' and verdicts and answered > orders.created(verdicts[-1]['created_at']) and \
            time.time() - answered < IDLE:
        # A fix run answered the last reject, and its push or `fixed` starts a new review: that verdict decides, not the old one.
        return None
    if len(attempts) >= ATTEMPTS:
        exhaust(current, attempts, verdicts, cause)
        return None
    findings = [c['body'] for c in verdicts][-1:] if cause == 'review' else []
    return '\n\n'.join([f"Fix PR #{pr} on branch `{current['headRefName']}`, head {head}. " +
                        CAUSES[cause].format(cause=cause, pr=pr), *findings,
                        'Push to that branch. End as `.agents/builder.md` says: a ready PR with auto-merge armed, or a '
                        'draft with a `Stopped:` line.'])


def exhaust(current, attempts, verdicts, cause):
    """A Builder PR out of fix runs: tell its work Issue what failed, close the PR unmerged, delete its branch and strike
    the Issue, once per PR. The closed PR keeps its diff at `refs/pull/<pr>/head`. A PR naming no Issue asks the user."""
    pr, branch = current['number'], current['headRefName']
    match = re.search(r'^(?:Refs|Closes|Fixes) #(\d+)', current['body'] or '', re.M)
    if not match:
        flag(pr, f'{ATTEMPTS} fix runs did not get this PR to merge, and its body names no Issue to record that on.')
        return
    issue = int(match[1])
    if orders.marked(issue, f'<!-- fix-exhausted #{pr} -->'):
        return
    commits = orders.gh('pr', 'view', str(pr), '--json', 'commits')['commits']

    def reason(cause, before):
        found = [c['body'] for c in verdicts if orders.created(c['created_at']) <= before][-1:] or ['']
        return f"review rejected: {found[0].split(chr(10) * 2, 1)[-1].strip()}" if cause == 'review' else f'{cause} failed'

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
                   + '\n'.join(lines) + f'\n- `{cause}` ({reason(cause, time.time())}): no fix run left\n\nTake another approach.')
    strike(issue, f'PR #{pr} used its {ATTEMPTS} fix runs: {current["url"]}')
    call('pr', 'close', str(pr), '--delete-branch')


def fixed(pr, cause, ran, run_url, verdict=None):
    """After a fix run that worked (`ran`): count the attempt on the PR, then hand the PR on with its screen `verdict`.
    A ready head that still holds the reject this run answered, with no `check` running on it, gets its review run
    again: with no push or re-ready, no `check` ends to start one (L24)."""
    if not ran:
        print('the run made no tool call; it counts as no attempt')
        return
    comment(pr, f'<!-- fix-attempt -->\nFix run {run_url} answered `{cause}`.')
    current = view(pr)
    ended(current, verdict, run_url)
    if cause == 'review' and not current['isDraft'] and not checking(current):
        for run in review_runs(current, 'FAILURE'):
            call('run', 'rerun', run)


def review_task(pr, head):
    """The review run's task, or None when the PR is not open at `head` or is a draft."""
    current = view(pr)
    if current['state'] != 'OPEN' or current['headRefOid'] != head or current['isDraft']:
        return None
    lines = [f'Review PR #{pr}, head {head}.', *re.findall(r'^(?:Scenarios|Moves):.*$', current['body'] or '', re.M)]
    if any(path.startswith('apps/desktop/src/') for path in call('pr', 'diff', str(pr), '--name-only').split()):
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


def status(head, state, description, run_url):
    call('api', f'repos/{{owner}}/{{repo}}/statuses/{head}', '-f', f'state={state}', '-f', 'context=review',
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


def task_or_nothing(task):
    """Print a task and exit 0, or exit 3 when there is none: the run has nothing to do."""
    print(task or '', end='')
    return 0 if task else 3


def main(args):
    run_url = (f"{os.environ.get('GITHUB_SERVER_URL', '')}/{os.environ.get('GITHUB_REPOSITORY', '')}"
               f"/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}")
    match args:
        case ['prompt']:
            prompt(sys.stdin.read(), os.environ['GITHUB_OUTPUT'])
        case ['worked', path]:
            return 0 if worked(path) else 1
        case ['pick', most] if most.isdigit():
            pick(int(most))
        case ['screen', branch]:
            if ask := question(sys.stdin.read(), branch):
                print(json.dumps(screen(ask)))
        case ['built', issue, slug, ran, verdict] if issue.isdigit() and ran in ('true', 'false'):
            built(int(issue), slug, ran == 'true', sys.stdin.read(), run_url, json.loads(verdict or 'null'))
        case ['fix-task', pr, head, cause] if pr.isdigit() and cause in CAUSES:
            return task_or_nothing(fix_task(int(pr), head, cause))
        case ['fixed', pr, cause, ran, verdict] if pr.isdigit() and ran in ('true', 'false'):
            fixed(int(pr), cause, ran == 'true', run_url, json.loads(verdict or 'null'))
        case ['review-task', pr, head] if pr.isdigit():
            return task_or_nothing(review_task(int(pr), head))
        case ['review-post', pr, head, reviewer, ran] if pr.isdigit() and ran in ('true', 'false'):
            return 0 if review_post(int(pr), head, reviewer, sys.stdin.read(), ran == 'true', run_url) else 1
        case _:
            print('usage: builder.py prompt | worked <file> | pick <most> | screen <branch> | built <issue> <slug> <ran> '
                  '<verdict> | fix-task <pr> <head> <cause> | fixed <pr> <cause> <ran> <verdict> | review-task <pr> <head> | '
                  'review-post <pr> <head> <reviewer> <ran>', file=sys.stderr)
            return 2
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'builder: {error}', file=sys.stderr)
        sys.exit(4)
