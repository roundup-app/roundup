#!/usr/bin/env python3
"""L34: open GitHub Issues are the work queue; scenario files describe acceptance."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

NEEDS_USER = 'flag:needs-user'
NEEDS_MAC = 'flag:needs-mac'
# L79: each label that holds an Issue out of the queue, and who it waits on.
WAITS = {NEEDS_USER: 'the user', NEEDS_MAC: "an agent on the user's Mac"}
BOT = 'github-actions[bot]'
STRIKE = '<!-- strike -->'
STRIKES = 3
DAY = 24 * 3600
# The repository is public: only the user and the loop's own Apps (a stall Issue, a Builder's prerequisite) file work.
# L102: the one login whose Issue and PR comments are choices.
OWNER = 'saadshahd'
OWNER_HEADING = '## Owner comments'
AUTHORS = ('saadshahd', 'claude[bot]', 'github-actions[bot]')
# Each GitHub read gets this many tries when it fails transiently: HTTP 5xx, a timeout or a secondary rate limit.
READ_TRIES = 5


def measurement_summary(rows):
    """L114 own attempts come only from request rows; shared counters remain distinct reset intervals."""
    counts, intervals, missing = {}, {}, []
    for row in rows:
        if row['kind'] == 'request':
            key = (row['token_source'], row['protocol'], row['measurement'])
            counts[key] = counts.get(key, 0) + 1
        elif row['kind'] == 'sample':
            if row.get('missing'):
                missing.append(row)
            else:
                key = (row['token_id'], row['resource'], row['reset'])
                intervals.setdefault(key, []).append(row)
        elif row['kind'] == 'missing':
            missing.append(row)
    boundaries = {(row['token_id'], row['resource'], row['boundary']) for row in rows
                  if row['kind'] == 'sample' and not row.get('missing')}
    resources = {}
    for row in rows:
        if row['kind'] == 'request':
            resources.setdefault(row['token_id'], set()).add('graphql' if row['protocol'] == 'GraphQL' else 'core')
        elif row['kind'] == 'sample' and not row.get('missing'):
            resources.setdefault(row['token_id'], set()).add(row['resource'])
        elif row['kind'] == 'complete' and row['pending']:
            missing.append(dict(request_ids=row['pending'], reason='requests still in flight'))
    for token, expected in resources.items():
        for resource in sorted(expected):
            for boundary in ('before', 'after'):
                if (token, resource, boundary) not in boundaries:
                    missing.append(dict(token_id=token, resource=resource, boundary=boundary, used=None, remaining=None,
                                        reset=None, reason='absent sample'))
    return dict(requests=[dict(token_source=source, protocol=protocol, measurement=measurement, attempts=attempts)
                          for (source, protocol, measurement), attempts in sorted(counts.items())],
                intervals=[dict(token_id=token, resource=resource, reset=reset, samples=samples)
                           for (token, resource, reset), samples in sorted(intervals.items())], missing=missing)


def reads(args):
    """Whether a `gh` call only reads: a write keeps the caller's token and gets one try."""
    read = tuple(args[:2]) in (('pr', 'list'), ('pr', 'view'), ('pr', 'diff'), ('pr', 'checks'),
                       ('run', 'list'), ('run', 'view'), ('run', 'download'), ('repo', 'view'),
                       ('issue', 'view'), ('issue', 'list'))
    if args and args[0] == 'api':
        if len(args) > 1 and args[1] == 'graphql':
            query = next((a.removeprefix('query=') for a in args if a.startswith('query=')), '')
            read = bool(re.match(r'\s*(query\b|\{)', query))
        else:
            methods = []
            for index, arg in enumerate(args):
                if arg in ('-X', '--method'):
                    methods.append(args[index + 1] if index + 1 < len(args) else '')
                elif arg.startswith('-X'):
                    methods.append(arg[2:])
                elif arg.startswith('--method='):
                    methods.append(arg.removeprefix('--method='))
            read = methods[-1] in ('GET', 'HEAD') if methods else not any(
                a in ('--input', '--field', '--raw-field') or
                a.startswith(('-f', '-F', '--input=', '--field=', '--raw-field=')) for a in args)
    return read


def gh_env(args):
    """Read with the App budget; mutations keep the caller's token and comment identity (L23)."""
    return ({**os.environ, 'GH_TOKEN': os.environ['GH_READ_TOKEN']}
            if reads(args) and os.environ.get('GH_READ_TOKEN') else None)


def status(detail):
    """The last HTTP status a failed request's diagnostic names, or None when it names none."""
    codes = [int(a or b) for a, b in re.findall(r'(?m)^HTTP/\S+ (\d{3})|\(HTTP (\d{3})\)', detail)]
    return codes[-1] if codes else None


def exhausted(detail):
    """Whether a failed request names an exhausted hourly (primary) rate limit, which no wait under an hour clears."""
    return bool(re.search(r'(?i)API rate limit (?:already )?exceeded|\bRATE_LIMITED\b', detail)) and not re.search(
        r'(?i)secondary rate limit', detail)


def backoff(detail, attempt):
    """Seconds to wait before another try of a failed request, or None when its failure is not transient."""
    code = status(detail)
    after = re.search(r'(?mi)^retry-after: (\d+)', detail)
    # A secondary limit is a 403 or 429 naming it or asking for a wait; an exhausted hourly budget is neither.
    secondary = code in (403, 429) and bool(after or re.search(r'(?i)secondary rate limit', detail))
    transport = code is None and re.search(r'(?i)time(?:d )?out|connection reset|unexpected EOF', detail)
    if not (secondary or transport or (code or 0) >= 500):
        return None
    if after:
        return min(int(after[1]), 600)
    return 60 if secondary else 5 * 2 ** (attempt - 1)


def gh(*args):
    """A `gh` call's JSON output. A read failing transiently (HTTP 5xx, a timeout or a secondary rate limit) gets
    READ_TRIES tries (L23); a write gets one, since GitHub may have acted on a write that failed."""
    tries = READ_TRIES if reads(args) else 1
    for attempt in range(1, tries + 1):
        try:
            return json.loads(subprocess.run(['gh', *args], check=True, text=True, env=gh_env(args),
                                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30).stdout)
        except subprocess.TimeoutExpired:
            detail = 'timed out after 30 seconds'
            if attempt == tries:
                raise
        except subprocess.CalledProcessError as error:
            detail = error.stderr or ''
            if attempt == tries or backoff(detail, attempt) is None:
                raise
        delay = backoff(detail, attempt)
        print(f'gh {" ".join(args[:2])} failed on try {attempt} of {tries}; next try in {delay}s: '
              f'{" ".join(detail.split())[:300]}', file=sys.stderr)
        time.sleep(delay)


def created(item):
    return datetime.fromisoformat(item.replace('Z', '+00:00')).timestamp()


def marked(number, marker, since=0):
    """This bot's comments on an Issue or PR that start with `marker`, made at or after `since`, oldest first."""
    pages = gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}/comments?per_page=100', '--paginate', '--slurp')
    return [c for page in pages for c in page
            if c['user']['login'] == BOT and c['body'].startswith(marker) and created(c['created_at']) >= since]


def owner_comments(*numbers):
    """L102: the owner's comments on Issues and PRs `numbers` as (number, comment), oldest first; any other login's, the
    bot's included, is never one."""
    found = []
    for number in numbers:
        pages = gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}/comments?per_page=100', '--paginate', '--slurp')
        found += [(number, c) for page in pages for c in page if c['user']['login'] == OWNER]
    return sorted(found, key=lambda entry: created(entry[1]['created_at']))


def owner_section(*numbers):
    """L102: the `OWNER_HEADING` section a build or fix prompt carries: each owner comment on `numbers`, oldest first,
    with its time and where it was left; '' when there is none, so no heading appears."""
    found = owner_comments(*numbers)
    if not found:
        return ''
    return '\n\n'.join([OWNER_HEADING + '\n\nThe owner left these comments, oldest first. Where one conflicts with the '
                         "Issue body or a scenario's Work table, the comment wins.",
                         *(f"### {c['created_at']} on #{number}\n\n{c['body'].strip()}" for number, c in found)])


def field(body, name, default=None):
    found = re.findall(r'^' + re.escape(name) + r': (.+)$', body, re.M)
    if not found and default is not None:
        return default
    if len(found) != 1:
        raise ValueError(f'needs one {name}: line')
    return found[0].strip()


def linked_issue(body):
    """The Issue number a PR body's first `Refs`, `Closes` or `Fixes #<n>` line names, or None."""
    match = re.search(r'^(?:Refs|Closes|Fixes) #(\d+)', body or '', re.M)
    return int(match[1]) if match else None


def work_issue(issue):
    """Whether the Issue may run: the user or a loop App filed it; no label lets anyone else's Issue run."""
    return ((issue.get('user') or {}).get('login') in AUTHORS
            and not (issue.get('body') or '').startswith('<!-- retro-report -->'))


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
                for name in re.findall(r'^\*\*([A-Z][0-9]+[a-z]?)[ .]', path.read_text(), re.M)}
    names = []
    # A lettered ID such as V4b names one scenario; an unlettered one may open a range such as O1-O6.
    for lettered, first, last in re.findall(r'\b([A-Z][0-9]+[a-z])\b|\b([A-Z][0-9]+)(?:\s*(?:–|-|to)\s*[A-Z]?([0-9]+))?\b',
                                            row['ids']):
        names.extend([lettered] if lettered else (first[0] + str(n) for n in range(int(first[1:]), int(last or first[1:]) + 1)))
    if row['mode'] == 'implement' and (not names or not Path(row['file']).is_file() or
                                       any(name not in headings for name in names)):
        # Its acceptance is not on this checkout: a Builder specifies it first, then the queue implements it.
        row.update(mode='specify', respecify=True)
    return row


def waits(item):
    """The labels of `WAITS` an Issue or PR carries, in `WAITS` order."""
    names = {label['name'] for label in item['labels']}
    return [label for label in WAITS if label in names]


def blockers(number):
    """L102: the open or uncompleted Issues that natively block Issue `number`."""
    pages = gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}/dependencies/blocked_by?per_page=100', '--paginate', '--slurp')
    return [dep for page in pages for dep in page if dep['state'] != 'closed' or dep.get('state_reason') != 'completed']


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
            if dep['state'] != 'closed' or dep.get('state_reason') != 'completed':
                visit(dep['number'], path + [number])
        visited.add(number)
    for number in dependencies:
        visit(number, [])
    for issue in issues:
        number = issue['number']
        row = dict(issue=number, url=issue['html_url'], ids=issue['title'], file='', slug='', priority=100)
        if not work_issue(issue):
            row.update(state='unspecified', reason='Retro report; it never runs' if
                       (issue.get('body') or '').startswith('<!-- retro-report -->') else
                       'filed by someone other than the user or a loop App; it never runs')
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
                blocked = [dep for dep in dependencies.get(number, [])
                           if dep['state'] != 'closed' or dep.get('state_reason') != 'completed']
                if active and blocked:
                    # L102: a blocker added under an open PR holds it; no fix or review run starts on it.
                    row.update(state='waiting', reason='blocked by ' + ', '.join(f'#{dep["number"]}' for dep in blocked))
                elif active:
                    row.update(state='in-flight', reason=' '.join(f'#{n}' for n in active))
                elif (held := waits(issue)) and not row['slug'].startswith('stall-'):
                    row.update(state='waiting', reason=f'waits on {WAITS[held[0]]} ({held[0]})')
                elif number in cycles:
                    row.update(state='blocked', reason='dependency cycle; engineering must repair the graph')
                elif blocked:
                    row.update(state='waiting', reason='blocked by ' + ', '.join(f'#{dep["number"]}' for dep in blocked))
                else:
                    row.update(state='ready', reason='')
        except (KeyError, TypeError, ValueError) as error:
            row.update(state='blocked', reason=f'invalid work order: {error}', invalid=issue.get('state') == 'open',
                       flagged=bool(waits(issue)))
        rows.append(row)
    for row in rows:
        if row['state'] not in ('done', 'cancelled') and len(keys.get(row['slug'], [])) > 1:
            row.update(state='blocked', reason='duplicate work Key; engineering must reconcile the Issues')
    return sorted(rows, key=lambda row: (row['priority'], row['issue']))


def cool(rows, strikes, now):
    """Hold a ready row struck STRIKES times in the last DAY (`strikes` maps an Issue to its strike times) until the oldest
    of those is a DAY old; a stall Issue is never held. Nobody is asked: L94 still counts the Issue as waiting work."""
    for row in rows:
        recent = sorted(t for t in strikes.get(row['issue'], []) if t > now - DAY)
        if row.get('invalid') and len(recent) >= STRIKES:
            # L96: a repair that keeps failing is held, not asked about; the order stays counted.
            row['held'] = True
        elif row['state'] == 'ready' and len(recent) >= STRIKES and not row['slug'].startswith('stall-'):
            until = datetime.fromtimestamp(recent[-STRIKES] + DAY, timezone.utc)
            row.update(state='waiting', reason=f'{STRIKES} strikes in 24 hours; ready again at {until:%Y-%m-%d %H:%M} UTC')
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


def read_orders(prs=None):
    """L23: open Issues, their blockers and recent strikes in one paginated GraphQL read; closed history costs nothing.
    Pick supplies its PR read, so the queue never fetches the same open PRs twice (#1433)."""
    repo = os.environ.get('GITHUB_REPOSITORY') or gh('repo', 'view', '--json', 'nameWithOwner')['nameWithOwner']
    owner, name = repo.split('/')
    cursor, issues, blocked, strikes = None, [], {}, {}
    now = time.time()
    while True:
        query = '''query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
          issues(first:100,states:OPEN,after:$cursor){pageInfo{hasNextPage endCursor} nodes{
            number title body url state stateReason updatedAt author{login __typename}
            labels(first:100){nodes{name} pageInfo{hasNextPage}}
            blockedBy(first:100){nodes{number state stateReason} pageInfo{hasNextPage}}
            comments(last:100){nodes{body createdAt author{login __typename}} pageInfo{hasPreviousPage}}
          }}}}'''
        answer = gh('api', 'graphql', '-f', f'query={query}', '-f', f'owner={owner}', '-f', f'name={name}',
                    '-F', f'cursor={cursor or "null"}')
        if answer.get('errors') or not (answer.get('data') or {}).get('repository'):
            raise ValueError('GitHub queue read failed: ' + json.dumps(answer.get('errors') or 'missing repository'))
        connection = answer['data']['repository']['issues']
        for node in connection['nodes']:
            number = node['number']
            if node['labels']['pageInfo']['hasNextPage']:
                raise ValueError(f'Issue #{number} has more than 100 labels; queue read incomplete')
            author = node['author'] or {}
            login = author.get('login', '') + ('[bot]' if author.get('__typename') == 'Bot' else '')
            item = dict(number=number, title=node['title'], body=node['body'], html_url=node['url'],
                        state=node['state'].lower(), state_reason=(node['stateReason'] or '').lower(),
                        updated_at=node['updatedAt'], user=dict(login=login), labels=node['labels']['nodes'])
            issues.append(item)
            deps = node['blockedBy']
            blocked[number] = (blockers(number) if deps['pageInfo']['hasNextPage'] else
                               [dict(number=d['number'], state=d['state'].lower(),
                                     state_reason=(d['stateReason'] or '').lower()) for d in deps['nodes']])
            comments = node['comments']
            recent = [c for c in comments['nodes'] if created(c['createdAt']) > now - DAY]
            # The tail may omit recent strikes. Read all comment pages only when the day reaches beyond it.
            if comments['pageInfo']['hasPreviousPage'] and (not comments['nodes'] or
                    created(comments['nodes'][0]['createdAt']) > now - DAY):
                strikes[number] = [created(c['created_at']) for c in marked(number, STRIKE, now - DAY)]
            else:
                strikes[number] = [created(c['createdAt']) for c in recent if
                                   (c['author'] or {}).get('login') == 'github-actions' and
                                   (c['author'] or {}).get('__typename') == 'Bot' and c['body'].startswith(STRIKE)]
        if not connection['pageInfo']['hasNextPage']:
            break
        cursor = connection['pageInfo']['endCursor']
        if not cursor:
            raise ValueError('GitHub queue read incomplete: missing next cursor')
    if prs is None:
        prs = gh('pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,body,isCrossRepository')
    return cool(classify(issues, blocked, prs), strikes, now)


class NotReady(Exception):
    """The Issue is no longer ready; starting no run is the correct outcome."""


def queued(number):
    """True when the queue would build Issue `number` now: no dependency, PR or missing field holds it."""
    current = next((row for row in read_orders() if row['issue'] == number), None)
    return current is not None and current['state'] == 'ready'


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
    if not queued(number):
        raise NotReady(f'Issue #{number} is no longer ready')
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
    chosen = owner_section(number)
    print(f"Work order: {issue['html_url']}\n\n{issue['body']}\n\n" + (chosen + '\n\n' if chosen else '') +
          f"Issue read at {issue['updated_at']}; to rewrite its body, save the body you read to a file and run "
          f"`python3 loop/orders.py edit {number} {issue['updated_at']} <read-file> <new-file>`.\n\n"
          f"Mode: {row['mode']}. Use this Issue as the canonical work order. Link the PR with Refs #{number}. {completion} "
          "Put progress and unresolved engineering questions on the Issue, not in scenario Work tables.")


def edit(number, read_at, read, new):
    """L102: write `new` as Issue `number`'s body. When the Issue changed after `read_at`, the time the run read it as
    `read`, merge the change into the body now there instead of writing `new` over it (ValueError on a conflict).
    `check` gates the write (L96)."""
    current = gh('api', f'repos/{{owner}}/{{repo}}/issues/{number}')
    body = current['body'] or ''
    if created(current['updated_at']) > created(read_at) and body != read:
        with tempfile.TemporaryDirectory() as tmp:
            files = [Path(tmp) / name for name in ('current', 'read', 'new')]
            for path, text in zip(files, (body, read, new)):
                path.write_text(text)
            merged = subprocess.run(['git', 'merge-file', '-p', *map(str, files)], text=True, stdout=subprocess.PIPE,
                                    timeout=30)
        if merged.returncode:
            raise ValueError(f'Issue #{number} changed after you read it, and your edit conflicts with that change; '
                             're-read it and apply your edit to the body now there')
        new = merged.stdout
    check(new)
    subprocess.run(['gh', 'api', '-X', 'PATCH', f'repos/{{owner}}/{{repo}}/issues/{number}', '-f', f'body={new}'],
                   check=True, stdout=subprocess.DEVNULL, timeout=30)


def main():
    if len(sys.argv) == 6 and sys.argv[1] == 'edit' and sys.argv[2].isdigit():
        try:
            edit(int(sys.argv[2]), sys.argv[3], Path(sys.argv[4]).read_text(), Path(sys.argv[5]).read_text())
        except ValueError as refusal:
            print(f'work orders: {refusal}', file=sys.stderr)
            sys.exit(2)
        return
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
        raise ValueError('usage: orders.py ready [--json] | task <issue> (exit 3: not ready) | check <body-file> | edit <issue> <read-at> <read-file> <new-file>')
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
