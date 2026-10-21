#!/usr/bin/env python3
"""L34: open GitHub Issues are the work queue; scenario files describe acceptance."""
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

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
# The repository is public: only the user and the loop's own Apps (a stall Issue, a Builder's prerequisite) file work.
AUTHORS = ('saadshahd', 'claude[bot]', 'github-actions[bot]')


# Every Issue and PR, paginated, took 38 s at about 3,100 items (2026-10-21).
GH_TIMEOUT = 120


def gh(*args):
    return json.loads(subprocess.run(['gh', *args], check=True, text=True,
                                   stdout=subprocess.PIPE, timeout=GH_TIMEOUT).stdout)


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


def work_issue(issue):
    """Whether the Issue may run: the user or a loop App filed it; no label lets anyone else's Issue run."""
    return (issue.get('user') or {}).get('login') in AUTHORS


def frozen(issue):
    """Whether the Issue orders loop machinery work, which only the user changes (L118): its Specification is a
    `scenarios/loop-*.md` file."""
    return re.search(r'^Specification: \[scenarios/loop-', issue['body'] or '', re.M) is not None


def order(issue):
    body = issue['body'] or ''
    if not re.search(r'^Key: ', body, re.M):
        # A request filed without queue fields (a bug report): a Builder specifies it before anyone builds it.
        return dict(mode='specify', issue=issue['number'], url=issue['html_url'], ids=issue['title'], file='',
                    slug=f'issue-{issue["number"]}', priority=50, request=True, respecify=False)
    key = field(body, 'Key')
    if not re.fullmatch(r'[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*', key):
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
    names = []
    # A lettered ID such as V4b names one scenario; an unlettered one may open a range such as O1-O6 or LC11-LC13.
    for lettered, prefix, first, last in re.findall(
            r'\b([A-Z]+[0-9]+[a-z])\b|\b([A-Z]+)([0-9]+)(?:\s*(?:–|-|to)\s*[A-Z]*([0-9]+))?\b', row['ids']):
        names.extend([lettered] if lettered else (prefix + str(n) for n in range(int(first), int(last or first) + 1)))
    if row['mode'] == 'implement' and (not names or not Path(row['file']).is_file() or
                                       any(name not in headings for name in names)):
        # Its acceptance is not on this checkout: a Builder specifies it first, then the queue implements it.
        row.update(mode='specify', respecify=True)
    return row


def waits(item):
    """The labels of `WAITS` an Issue or PR carries, in `WAITS` order."""
    names = {label['name'] for label in item['labels']}
    return [label for label in WAITS if label in names]


def holds(dep):
    """Whether a blocker still holds its dependent. One closed as not planned was cancelled by the owner: it never
    completes, so it holds nothing and `classify` reports it instead."""
    return dep['state'] != 'closed' or dep.get('state_reason') not in ('completed', 'not_planned')


def classify(issues, dependencies, prs):
    """Return observable states; malformed orders and unavailable dependencies never become ready."""
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
                elif held := waits(issue):
                    row.update(state='waiting', reason=f'waits on {WAITS[held[0]]} ({held[0]})')
                elif number in cycles:
                    row.update(state='blocked', reason='dependency cycle; engineering must repair the graph')
                elif blocked:
                    row.update(state='waiting', reason='blocked by ' + ', '.join(f'#{dep["number"]}' for dep in blocked))
                else:
                    row.update(state='ready', reason=' '.join(f'ignores cancelled blocker #{n}' for n in row['cancelled']))
        except (KeyError, TypeError, ValueError) as error:
            row.update(state='blocked', reason=f'invalid work order: {error}', invalid=issue.get('state') == 'open',
                       flagged=bool(waits(issue)))
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


def read_orders():
    pages = gh('api', 'repos/{owner}/{repo}/issues?state=all&per_page=100', '--paginate', '--slurp')
    issues = [issue for page in pages for issue in page if 'pull_request' not in issue]
    def dependencies(issue):
        if issue['state'] == 'closed' or issue.get('issue_dependencies_summary', {}).get('total_blocked_by') == 0:
            return issue['number'], []
        pages = gh('api', f'repos/{{owner}}/{{repo}}/issues/{issue["number"]}/dependencies/blocked_by?per_page=100',
                   '--paginate', '--slurp')
        return issue['number'], [dependency for page in pages for dependency in page]
    with ThreadPoolExecutor(max_workers=8) as pool:
        blocked = dict(pool.map(dependencies, issues))
    prs = gh('pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,body,isCrossRepository')
    rows, now = classify(issues, blocked, prs), time.time()
    # A strike comment changes its Issue, so only an Issue changed in the last DAY can be held.
    changed = {issue['number'] for issue in issues if created(issue['updated_at']) > now - DAY}
    ready = [row['issue'] for row in rows if (row['state'] == 'ready' or row.get('invalid')) and row['issue'] in changed]
    with ThreadPoolExecutor(max_workers=8) as pool:
        struck = pool.map(lambda number: [created(c['created_at']) for c in marked(number, STRIKE, now - DAY)], ready)
        return cool(rows, dict(zip(ready, struck)), now)


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
    try:
        row = order(issue)
    except (KeyError, TypeError, ValueError) as error:
        print(f"Work order: {issue['html_url']}\n\n{issue['body']}\n\n"
              f'Repair run: the queue cannot read this work Issue ({error}). Add the missing or malformed field from the '
              "Issue's Scenarios IDs and the scenario file that holds them, edit the Issue, and run "
              f'`python3 loop/orders.py check <body-file>` on the new body before the edit. If you cannot, comment the '
              f'reason on the Issue; label it `{NEEDS_USER}` only when the missing field is a product choice. '
              f'Open no PR; edit Issue #{number}.')
        return
    now = current(number)
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
                      f'does not close it. Use Closes #{number} when that condition holds.')
    print(f"Work order: {issue['html_url']}\n\n{issue['body']}\n\n"
          f"Mode: {row['mode']}. Use this Issue as the canonical work order. Link the PR with Refs #{number}. {completion} "
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
