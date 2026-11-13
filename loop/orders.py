#!/usr/bin/env python3
"""L34: open GitHub Issues are the work queue; scenario files describe acceptance."""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

NEEDS_USER = 'flag:needs-user'
NEEDS_MAC = 'flag:needs-mac'
# L79: each label that holds an Issue out of the queue, and who it waits on.
WAITS = {NEEDS_USER: 'the user', NEEDS_MAC: "an agent on the user's Mac"}
BOT = 'github-actions[bot]'
STRIKE = '<!-- strike -->'
DAY = 24 * 3600
# L34: after its k-th strike in the last DAY an Issue waits COOLDOWN * 2^(k-1) from that strike, at most COOLDOWN_CAP; at
# ASK_STRIKES the loop asks the user (L79).
COOLDOWN = 15 * 60
COOLDOWN_CAP = 4 * 3600
ASK_STRIKES = 6
# The repository is public: only the user and the loop's own Apps (a stall Issue, a Builder's prerequisite) file work. The
# user's Issue builds; an App's waits for the user's thumbs-up on it.
OWNER = 'saadshahd'
APPS = ('claude[bot]', 'github-actions[bot]')


# Every Issue and PR, paginated, took 38 s at about 3,100 items (2026-10-21).
GH_TIMEOUT = 120


# The longest a rate-limited call waits for the quota to come back.
RATE_WAIT_CAP = 300
RATE_LIMITED = re.compile(r'API rate limit exceeded|secondary rate limit', re.I)
# What a job with no better use of its time waits for the hourly quota: a whole window.
RESET_WAIT_CAP = 3600 + 60
# A secondary limit leaves the hourly quota untouched, so there is no reset to wait for.
SECONDARY_WAIT = 60


def rate_wait(stderr, cap=RATE_WAIT_CAP):
    """Seconds, at most `cap`, to wait before a call that `stderr` shows was rate limited: a `Retry-After` hint
    in it, else the time to the hourly quota's reset (`gh api rate_limit` costs none), else SECONDARY_WAIT when quota remains."""
    if hint := re.search(r'retry[- ]after:?\s*(\d+)', stderr, re.I):
        return min(int(hint[1]), cap)
    core = json.loads(subprocess.run(['gh', 'api', 'rate_limit'], check=True, text=True, stdout=subprocess.PIPE,
                                     timeout=60).stdout)['resources']['core']
    if core['remaining'] > 0:
        return SECONDARY_WAIT
    return min(max(core['reset'] - time.time(), 1), cap)


def call(*args, timeout=60):
    """`gh *args`'s stdout. A GitHub 5xx (`HTTP 5` in stderr) is retried twice after 2 s then 5 s, and a rate limit once
    after `rate_wait` seconds; any other failure, or a second rate limit, raises at once, stderr re-emitted."""
    pauses, limited = [2, 5], False
    while True:
        run = subprocess.run(['gh', *args], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        if run.returncode == 0:
            return run.stdout
        sys.stderr.write(run.stderr)
        if RATE_LIMITED.search(run.stderr) and not limited:
            limited = True
            time.sleep(rate_wait(run.stderr))
        elif 'HTTP 5' in run.stderr and pauses:
            time.sleep(pauses.pop(0))
        else:
            run.check_returncode()


def after_rate_limit(attempt):
    """`attempt()`. `call` waits out a rate limit for at most RATE_WAIT_CAP; when the quota's reset is further off and the call
    still fails on it, wait for the reset itself (at most RESET_WAIT_CAP) and run `attempt` once more."""
    try:
        return attempt()
    except subprocess.CalledProcessError as error:
        if not RATE_LIMITED.search(error.stderr or ''):
            raise
        time.sleep(rate_wait(error.stderr, RESET_WAIT_CAP))
        return attempt()


def gh(*args):
    return json.loads(call(*args, timeout=GH_TIMEOUT))


def graphql(fields):
    """The repository's `fields` (a GraphQL selection) as one query: GraphQL has its own hourly quota, so a read that took
    a REST call per Issue leaves the REST quota to the jobs that need it."""
    return gh('api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-f',
              f'query=query($owner:String!,$repo:String!){{repository(owner:$owner,name:$repo){{{fields}}}}}')['data']['repository']


def blockers(numbers):
    """{Issue: the Issues blocking it, in the REST shape `classify` reads} for each of `numbers`, in one call."""
    found = graphql(' '.join(f'i{n}:issue(number:{n}){{blockedBy(first:100){{totalCount nodes{{number state stateReason}}}}}}'
                             for n in numbers)) if numbers else {}
    for n in numbers:
        if found[f'i{n}']['blockedBy']['totalCount'] > 100:
            raise ValueError(f'#{n} has more than 100 blockers')
    return {n: [dict(number=d['number'], state=d['state'].lower(), state_reason=(d['stateReason'] or '').lower() or None)
                for d in found[f'i{n}']['blockedBy']['nodes']] for n in numbers}


def strikes(numbers, since):
    """{Issue: the times, at or after `since`, of this bot's `STRIKE` comments among its last 100} for each of `numbers`, in one call."""
    found = graphql(' '.join(f'i{n}:issue(number:{n}){{comments(last:100){{nodes{{author{{login __typename}} body createdAt}}}}}}'
                             for n in numbers)) if numbers else {}
    return {n: [created(c['createdAt']) for c in found[f'i{n}']['comments']['nodes']
                if c['author'] and (c['author']['__typename'], c['author']['login']) == ('Bot', BOT.removesuffix('[bot]'))
                and c['body'].startswith(STRIKE) and created(c['createdAt']) >= since] for n in numbers}


def running(pr):
    """The workflows with a run that has not ended on the PR's head."""
    return {check['workflowName'] for check in pr.get('statusCheckRollup') or []
            if check.get('workflowName') and check.get('status') != 'COMPLETED'}


def reviewing():
    """The branches with a review or critic run that has not ended. Those runs start from `pre` on `main`'s copy of their
    workflow, so they show on no PR head and `running` misses them."""
    runs = [run for status in ('queued', 'in_progress') for run in
            gh('api', f'repos/{{owner}}/{{repo}}/actions/runs?event=workflow_run&status={status}&per_page=100')['workflow_runs']]
    return {run['display_title'].split(' ', 1)[1] for run in runs if run['display_title'].startswith(('Review ', 'Critic '))}


def touches_desktop(pr):
    """Whether PR `pr` changes a file under `apps/desktop/src/` (rule 8). Reads the PR's files list, which answers past
    the 300 files where GitHub refuses `gh pr diff`."""
    return any(changed['filename'].startswith('apps/desktop/src/') for page in gh(
        'api', f'repos/{{owner}}/{{repo}}/pulls/{pr}/files?per_page=100', '--paginate', '--slurp') for changed in page)



def created(item):
    return datetime.fromisoformat(item.replace('Z', '+00:00')).timestamp()


def marked(number, marker, since=0):
    """This bot's comments on an Issue or PR that start with `marker`, made at or after `since`, oldest first."""
    pages = gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}/comments?per_page=100', '--paginate', '--slurp')
    return [c for page in pages for c in page
            if c['user']['login'] == BOT and c['body'].startswith(marker) and created(c['created_at']) >= since]


def field(body, name, default=None):
    found = re.findall(r'^' + re.escape(name) + r': (.+)$', body, re.M)
    if not found and default is not None:
        return default
    if len(found) != 1:
        raise ValueError(f'needs one {name}: line')
    return found[0].strip()


def filer(issue):
    return (issue.get('user') or {}).get('login')


def work_issue(issue):
    """Whether the Issue may be work: the user or a loop App filed it; no label lets anyone else's Issue run."""
    return filer(issue) in (OWNER, *APPS)


def approvals(issues):
    """The numbers of the open Issues among `issues` that a loop App filed and the user approved with a thumbs-up, in one call.
    A reaction's author is GitHub's own record, so no loop App can forge the user's."""
    numbers = [issue['number'] for issue in issues if issue['state'] == 'open' and filer(issue) in APPS]
    found = graphql(' '.join(f'i{n}:issue(number:{n}){{reactions(content:THUMBS_UP,last:100){{nodes{{user{{login}}}}}}}}'
                             for n in numbers)) if numbers else {}
    return {n for n in numbers
            if any((reaction['user'] or {}).get('login') == OWNER for reaction in found[f'i{n}']['reactions']['nodes'])}


def released(issues, dependencies, approved):
    """The numbers of the open Issues among `issues` that may build: the user filed them, `approved` (from `approvals`)
    holds them, or they block an open Issue that may build, so a Builder's prerequisite or split builds as the Issue it
    serves does. `dependencies` maps an Issue to its blockers, as `classify` reads them."""
    work = {issue['number'] for issue in issues if issue['state'] == 'open' and work_issue(issue)}
    may = {issue['number'] for issue in issues if issue['number'] in work and (filer(issue) == OWNER or issue['number'] in approved)}
    pending = list(may)
    while pending:
        for dep in dependencies.get(pending.pop(), []):
            if dep['number'] in work and dep['number'] not in may:
                may.add(dep['number'])
                pending.append(dep['number'])
    return may


def frozen(issue):
    """Whether the Issue orders loop machinery work, which only the user changes (L118): its Specification is a
    `scenarios/loop-*.md` file."""
    return re.search(r'^Specification: \[scenarios/loop-', issue['body'] or '', re.M) is not None


def scenario_ids(text):
    """The scenario ids a `Scenarios:` line names. A lettered ID such as V4b names one scenario; an unlettered one may
    open a range such as O1-O6 or LC11-LC13, which names each id in it."""
    names = []
    for lettered, prefix, first, last in re.findall(
            r'\b([A-Z]+[0-9]+[a-z])\b|\b([A-Z]+)([0-9]+)(?:\s*(?:–|-|to)\s*[A-Z]*([0-9]+))?\b', text):
        names.extend([lettered] if lettered else (prefix + str(n) for n in range(int(first), int(last or first) + 1)))
    return names


def order(issue):
    body = issue['body'] or ''
    if not re.search(r'^Key: ', body, re.M):
        # A request filed without queue fields (a bug report): a Builder specifies it before anyone builds it.
        return dict(mode='specify', issue=issue['number'], url=issue['html_url'], ids=issue['title'], file='',
                    slug=f'issue-{issue["number"]}', priority=50, request=True, respecify=False)
    key = field(body, 'Key')
    # `repair-<number>` is the slug of the repair run of this Issue (L96); a Key of that name would run as one.
    if not re.fullmatch(r'[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*', key) or key == f'repair-{issue["number"]}':
        raise ValueError('invalid Key')
    spec = field(body, 'Specification')
    # The Issue form displays the specification as a clickable repository link.
    match = re.fullmatch(r'\[(scenarios/[A-Za-z0-9_-]+\.md)\]\(https://github\.com/[^\s]+\)', spec)
    if not match:
        raise ValueError('Specification must link one scenario file')
    priority = int(field(body, 'Priority'))
    if not 0 <= priority <= 100:
        raise ValueError('Priority must be between 0 and 100')
    mode = field(body, 'Mode', 'implement')
    if mode not in ('implement', 'specify'):
        raise ValueError('invalid Mode')
    row = dict(mode=mode, issue=issue['number'], url=issue['html_url'], ids=field(body, 'Scenarios'),
               file=match[1], slug=key, priority=priority, request=False, respecify=False)
    headings = {name for path in Path('scenarios').glob('*.md')
                for name in re.findall(r'^\*\*([A-Z]+[0-9]+[a-z]?)[ .]', path.read_text(), re.M)}
    names = scenario_ids(row['ids'])
    if row['mode'] == 'implement' and (not names or not Path(row['file']).is_file() or
                                       any(name not in headings for name in names)):
        # Its acceptance is not on this checkout: a Builder specifies it first, then the queue implements it.
        row.update(mode='specify', respecify=True)
    return row


def delivers(pr, issue):
    """L82: whether PR number `pr` delivers all the work of `issue` (its JSON): an implementation order whose scenarios
    `main` holds, a change outside `scenarios/`, and for each scenario id a line the diff adds that names a test after it
    (`u1_…`). An order the queue cannot read, or a diff GitHub refuses (over 300 files), delivers nothing."""
    try:
        row = order(issue)
        if row['mode'] != 'implement':
            return False
        diff = call('pr', 'diff', str(pr), '--allow-escape-sequences')
    except (KeyError, TypeError, ValueError, subprocess.CalledProcessError) as error:
        print(f'PR #{pr}: the Issue order or the diff is unreadable, so no Closes line: {error}', file=sys.stderr)
        return False
    added = '\n'.join(line for line in diff.splitlines() if line.startswith('+') and not line.startswith('+++ '))
    return any(not path.startswith('scenarios/') for path in re.findall(r'^diff --git a/(\S+) b/', diff, re.M)) and \
        all(re.search(rf'\b{name.lower()}_', added) for name in scenario_ids(row['ids']))


def waits(item):
    """The labels of `WAITS` an Issue or PR carries, in `WAITS` order."""
    names = {label['name'] for label in item['labels']}
    return [label for label in WAITS if label in names]


def holds(dep):
    """Whether a blocker still holds its dependent. One closed as not planned was cancelled by the owner: it never
    completes, so it holds nothing and `classify` reports it instead."""
    return dep['state'] != 'closed' or dep.get('state_reason') not in ('completed', 'not_planned')


def classify(issues, dependencies, prs, approved=frozenset()):
    """Return observable states; malformed orders and unavailable dependencies never become ready. An open Issue a loop
    App filed is `waiting` unless `released` finds it may build."""
    may_build = released(issues, dependencies, approved)
    rows = []
    keys = {}
    cycles = set()
    visited = set()
    def visit(number, path):
        if number in path:
            cycles.update(path[path.index(number):])
            return
        if number in visited:
            return
        for dep in dependencies.get(number, []):
            if holds(dep):
                visit(dep['number'], path + [number])
        visited.add(number)
    for number in dependencies:
        visit(number, [])
    for issue in issues:
        number = issue['number']
        row = dict(issue=number, url=issue['html_url'], ids=issue['title'], file='', slug='', priority=100)
        if not work_issue(issue):
            row.update(state='unspecified', reason='filed by someone other than the user or a loop App; it never runs')
            rows.append(row)
            continue
        try:
            row = order(issue)
            keys.setdefault(row['slug'], []).append(number)
            if issue['state'] == 'closed':
                row.update(state='done' if issue.get('state_reason') == 'completed' else 'cancelled', reason='Issue closed')
            else:
                active = [pr['number'] for pr in prs if not pr.get('isCrossRepository', False) and
                          (pr['headRefName'] == 'build/' + row['slug'] or
                           re.search(r'^(?:Refs|Closes|Fixes|Resolves) #' + str(number) + r'\b', pr.get('body') or '', re.M | re.I))]
                blocked = [dep for dep in dependencies.get(number, []) if holds(dep)]
                row['cancelled'] = [dep['number'] for dep in dependencies.get(number, [])
                                    if dep['state'] == 'closed' and dep.get('state_reason') == 'not_planned']
                if active:
                    row.update(state='in-flight', reason=' '.join(f'#{n}' for n in active))
                elif frozen(issue):
                    row.update(state='waiting', reason='loop machinery; only the user changes it (L118)')
                elif number not in may_build:
                    row.update(state='waiting', reason="filed by a loop App; waits for the user's thumbs-up")
                elif held := waits(issue):
                    row.update(state='waiting', reason=f'waits on {WAITS[held[0]]} ({held[0]})')
                elif number in cycles:
                    row.update(state='blocked', reason='dependency cycle; engineering must repair the graph')
                elif blocked:
                    row.update(state='waiting', reason='blocked by ' + ', '.join(f'#{dep["number"]}' for dep in blocked))
                else:
                    row.update(state='ready', reason=' '.join(f'ignores cancelled blocker #{n}' for n in row['cancelled']))
        except (KeyError, TypeError, ValueError) as error:
            # An Issue still waiting for the user's thumbs-up gets no repair run: that run would build before the approval.
            row.update(state='blocked', reason=f'invalid work order: {error}',
                       invalid=issue.get('state') == 'open' and number in may_build, flagged=bool(waits(issue)))
        rows.append(row)
    for row in rows:
        if row['state'] not in ('done', 'cancelled') and len(keys.get(row['slug'], [])) > 1:
            row.update(state='blocked', reason='duplicate work Key; engineering must reconcile the Issues')
    return sorted(rows, key=lambda row: (row['priority'], row['issue']))


def cool(rows, strikes, now):
    """Hold a ready row struck in the last DAY (`strikes` maps an Issue to its strike times) until its cooldown from the
    latest strike ends: COOLDOWN doubled for each earlier strike in that DAY, at most COOLDOWN_CAP. It asks nobody (`builder.strike`
    asks at ASK_STRIKES): L94 still counts the Issue as waiting work."""
    for row in rows:
        recent = sorted(t for t in strikes.get(row['issue'], []) if t > now - DAY)
        if not recent:
            continue
        until = recent[-1] + min(COOLDOWN * 2 ** (len(recent) - 1), COOLDOWN_CAP)
        if until <= now:
            continue
        if row.get('invalid'):
            # L96: a repair that keeps failing is held, not repaired again; the order stays counted.
            row['held'] = True
        elif row['state'] == 'ready':
            ready_at = datetime.fromtimestamp(until, timezone.utc)
            row.update(state='waiting',
                       reason=f'{len(recent)} strike{"s" * (len(recent) > 1)}; ready again at {ready_at:%Y-%m-%d %H:%M} UTC')
    return rows


def invalid(rows):
    """L96: the open orders the queue cannot read."""
    return [row for row in rows if row.get('invalid') and row['state'] == 'blocked']


def count_invalid(rows):
    return f'invalid orders: {len(invalid(rows))}'


def check(body):
    """L96: raise ValueError('invalid work order: ...') when the queue cannot read a work Issue body."""
    try:
        order(dict(number=0, html_url='', title='', body=body))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f'invalid work order: {error}') from None


def graphql_issue(item):
    """A `gh issue list` item in the REST Issue shape `classify` reads; an App author `app/x` is REST's `x[bot]`."""
    login = item['author']['login']
    return dict(number=item['number'], html_url=item['url'], title=item['title'], body=item['body'],
                state=item['state'].lower(), state_reason=(item['stateReason'] or '').lower() or None,
                labels=item['labels'], updated_at=item['updatedAt'],
                user=dict(login=f'{login[4:]}[bot]' if login.startswith('app/') else login))


# A file holding the closed Issues as of the last read; `list_issues` then fetches only what changed since.
CLOSED_CACHE = 'ORDERS_CLOSED_CACHE'
# What `classify` and `read_orders` read of an Issue.
KEPT = ('number', 'html_url', 'title', 'body', 'state', 'state_reason', 'labels', 'updated_at', 'user')
# A read starts this long before the last one ended, so an Issue changed while that read ran is fetched again.
CACHE_OVERLAP = 120


def rest_issues(query):
    """The Issues, no PRs, `repos/{owner}/{repo}/issues?<query>` lists, every page."""
    pages = gh('api', f'repos/{{owner}}/{{repo}}/issues?{query}&per_page=100', '--paginate', '--slurp')
    return [issue for page in pages for issue in page if 'pull_request' not in issue]


def all_issues():
    """Every Issue. The REST list came back empty during a GitHub Issues incident (2026-10-22) while GraphQL still
    answered, so an empty or failed REST list falls back to `gh issue list`; both failing raises."""
    try:
        issues = rest_issues('state=all')
        if issues:
            return issues
    except subprocess.CalledProcessError as error:
        print(f'::warning::REST Issue list failed ({error.returncode}); reading Issues through GraphQL', file=sys.stderr)
    else:
        print('::warning::REST Issue list came back empty; reading Issues through GraphQL', file=sys.stderr)
    issues = [graphql_issue(item) for item in gh('issue', 'list', '--state', 'all', '--limit', '100000', '--json',
                                                   'number,url,title,body,state,stateReason,labels,updatedAt,author')]
    if not issues:
        raise SystemExit('::error::both the REST and GraphQL Issue lists came back empty')
    return issues


def list_issues():
    """Every Issue. With `$ORDERS_CLOSED_CACHE` naming an existing file, the open Issues plus the closed ones that file
    holds, updated with those changed since its read: two calls once it is warm. With the variable and no file, every
    page, once, and the file is written; without the variable, every page. An empty or failed warm open read
    recovers every Issue before replacing the cache. The file is rewritten only after a successful read."""
    path = os.environ.get(CLOSED_CACHE)
    if not path:
        return all_issues()
    file, started = Path(path), time.time()
    opened = []
    if file.is_file():
        cache = json.loads(file.read_text())
        try:
            opened = rest_issues('state=open')
        except subprocess.CalledProcessError as error:
            print(f'::warning::REST open-Issue list failed ({error.returncode}); reading every Issue', file=sys.stderr)
    if opened:
        since = datetime.fromtimestamp(cache['read'] - CACHE_OVERLAP, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        closed = {int(number): issue for number, issue in cache['closed'].items()}
        closed.update({issue['number']: {key: issue.get(key) for key in KEPT} for issue in rest_issues(f'state=closed&since={since}')})
        for issue in opened:
            closed.pop(issue['number'], None)
    else:
        everything = all_issues()
        opened = [issue for issue in everything if issue['state'] != 'closed']
        closed = {issue['number']: {key: issue.get(key) for key in KEPT} for issue in everything if issue['state'] == 'closed'}
    file.write_text(json.dumps(dict(read=started, closed=closed)))
    return opened + list(closed.values())


def read_orders():
    issues = list_issues()
    owed = [issue['number'] for issue in issues
            if issue['state'] != 'closed' and issue.get('issue_dependencies_summary', {}).get('total_blocked_by') != 0]
    blocked = {issue['number']: [] for issue in issues} | blockers(owed)
    prs = gh('pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,body,isCrossRepository')
    rows, now = classify(issues, blocked, prs, approvals(issues)), time.time()
    # A strike comment changes its Issue, so only an Issue changed in the last DAY can be held.
    changed = {issue['number'] for issue in issues if created(issue['updated_at']) > now - DAY}
    ready = [row['issue'] for row in rows if (row['state'] == 'ready' or row.get('invalid')) and row['issue'] in changed]
    return cool(rows, strikes(ready, now - DAY), now)


class NotReady(Exception):
    """The Issue is no longer ready; starting no run is the correct outcome."""


def current(number):
    """The queue's row for Issue `number` now, or None."""
    return next((row for row in read_orders() if row['issue'] == number), None)


def queued(number):
    """True when the queue would build Issue `number` now: no dependency, PR or missing field holds it."""
    row = current(number)
    return row is not None and row['state'] == 'ready'


def task(number):
    """Print the Builder's task for a ready Issue; raise NotReady when another run or a person took it."""
    issue = gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}')
    if issue['state'] != 'open' or not work_issue(issue):
        raise NotReady(f'Issue #{number} is no longer authorized for execution')
    now = current(number)
    try:
        row = order(issue)
    except (KeyError, TypeError, ValueError) as error:
        # A repair run edits the Issue, so only an order the queue itself counts as invalid gets one: not one waiting for a thumbs-up.
        if now is None or not now.get('invalid'):
            raise NotReady(f'Issue #{number} is no longer authorized for a repair run')
        print(f"Work order: {issue['html_url']}\n\n{issue['body']}\n\n"
              f'Repair run: the queue cannot read this work Issue ({error}). Add the missing or malformed field from the '
              "Issue's Scenarios IDs and the scenario file that holds them, edit the Issue, and run "
              f'`python3 loop/orders.py check <body-file>` on the new body before the edit. If you cannot, comment the '
              f'reason on the Issue; label it `{NEEDS_USER}` only when the missing field is a product choice. '
              f'Open no PR; edit Issue #{number}.')
        return
    if now is None or now['state'] != 'ready':
        raise NotReady(f'Issue #{number} is no longer ready')
    # L34: a cancelled blocker holds nothing, so the Builder is told which ones to weigh.
    cancelled = ''.join(f' Blocker #{n} was closed as not planned and holds nothing: if this work truly needs what it '
                        f'would have built, comment that on Issue #{number}, label it `{NEEDS_USER}` and open no PR.'
                        for n in now.get('cancelled', []))
    if row['request']:
        completion = ('This Issue is a request without queue fields. Add its acceptance as scenarios, then edit this Issue '
                      'to add Key, Priority, Specification and Scenarios lines and Mode: implement, so the queue builds it '
                      'once the scenarios are on main. Never close it from this PR.')
    elif row['respecify']:
        completion = (f"This implementation Issue names scenarios ({row['ids']}) that {row['file']} on main does not hold. "
                      'Add its acceptance as scenarios, then edit this Issue so its Scenarios line names their IDs and it '
                      'keeps Mode: implement, so the queue builds it once the scenarios are on main. Never close it from this PR.')
    elif row['mode'] == 'specify':
        completion = ('Close this specification Issue only after its specification acceptance is demonstrated; implementation '
                      f'stays in its dependent Issue. Use Closes #{number} when that condition holds.')
    else:
        completion = ('Close this implementation Issue only when its full acceptance is demonstrated; a specification-only PR '
                      f'does not close it. The loop writes Closes #{number} instead when the PR changes a file outside '
                      'scenarios/ and adds a test named after each scenario id; write it yourself only for acceptance that rule '
                      'cannot see.')
    print(f"Work order: {issue['html_url']}\n\n{issue['body']}\n\n"
          f"Mode: {row['mode']}. Use this Issue as the canonical work order. The loop links the PR with Refs #{number} (L82). {completion} "
          "Put progress and unresolved engineering questions on the Issue, not in scenario Work tables." + cancelled)


def main():
    if sys.argv[1:] == ['lint']:
        stale = [str(path) for path in Path('scenarios').glob('*.md')
                 if re.search(r'^## Work$', path.read_text(), re.M)]
        if stale:
            raise ValueError('work orders belong in GitHub Issues, not tables: ' + ', '.join(stale))
        return
    if len(sys.argv) == 3 and sys.argv[1] == 'task' and sys.argv[2].isdigit():
        try:
            task(int(sys.argv[2]))
        except NotReady as refusal:
            print(f'work orders: {refusal}', file=sys.stderr)
            sys.exit(3)
        return
    if len(sys.argv) == 3 and sys.argv[1] == 'check':
        try:
            check(sys.stdin.read() if sys.argv[2] == '-' else Path(sys.argv[2]).read_text())
        except ValueError as refusal:
            print(f'work orders: {refusal}', file=sys.stderr)
            sys.exit(2)
        return
    if sys.argv[1:] not in (['ready'], ['ready', '--json']):
        raise ValueError('usage: orders.py ready [--json] | task <issue> (exit 3: not ready) | check <body-file>')
    rows = read_orders()
    if sys.argv[-1] == '--json':
        print(json.dumps(rows))
    else:
        for row in rows:
            print(row['state'], row['ids'], row['file'], f'#{row["issue"]}', row['reason'])
        print(count_invalid(rows))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'work orders: {error}', file=sys.stderr)
        sys.exit(4)
