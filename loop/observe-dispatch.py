#!/usr/bin/env python3
"""L23, L118: the observer for a manually dispatched `check` (CI5915). A workflow-owned job holding Actions write, which a
build run's token never has, dispatches `check.yml` on `main`, waits for the run, and comments on the Issue with its URL,
head SHA, event and every job conclusion. Exit 1: the run did not meet CI5915a (the evidence is posted either way);
exit 4: GitHub could not be read or written."""
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import orders  # noqa: E402

WORKFLOW = 'check.yml'
# #5936: the merge that made a dispatched `check` accept its packaging skip. The run's head must hold it.
FIX = '6eca351bbe1cd681542a53b9278ae549963b3cde'
# CI5915a: the jobs of a dispatch that must succeed, `mac-package` (push-only) skipped, and the lanes of a matrix.
SUCCEED = ('plan', 'mac-clippy', 'mac', 'chromium', 'check')
SKIPPED = ('mac-package',)
MATRIX = ('rust', 'web')
# A dispatch lands in the run list within seconds; a `check` run ends in well under two hours.
APPEAR = 5 * 60
FINISH = 110 * 60
POLL = 20


def lane(name):
    """The job a matrix name (`rust 3`) belongs to; any other name is its own."""
    return re.sub(r' \d+$', '', name)


def verdict(jobs):
    """Lines naming each way `jobs` (the run's jobs API entries) miss CI5915a; empty when it holds."""
    seen = {}
    for job in jobs:
        seen.setdefault(lane(job['name']), []).append((job['name'], job['conclusion']))
    wrong = []
    for name in (*SUCCEED, *MATRIX):
        wrong += [f'{n} is {c}, not success' for n, c in seen.get(name, []) if c != 'success']
        if name not in seen:
            wrong.append(f'{name} has no job')
    for name in SKIPPED:
        wrong += [f'{n} is {c}, not skipped' for n, c in seen.get(name, []) if c != 'skipped']
        if name not in seen:
            wrong.append(f'{name} has no job')
    return wrong


def report(run, jobs, holds_fix, wrong):
    rows = '\n'.join(f"| {job['name']} | {job['conclusion']} |" for job in sorted(jobs, key=lambda job: job['name']))
    missing = [] if holds_fix else [f'head does not contain {FIX}']
    problems = [*missing, *wrong]
    return '\n'.join([
        f"Dispatch observation of `{WORKFLOW}` on `main`: **{'PASS' if not problems else 'FAIL'}**",
        '',
        f"- Run: {run['url']}",
        f"- Head SHA: `{run['headSha']}`",
        f"- Event: `{run['event']}`",
        f"- Run conclusion: `{run['conclusion']}`",
        *([f'- Problems: {"; ".join(problems)}'] if problems else []),
        '',
        '| Job | Conclusion |', '| --- | --- |', rows])


def parse_time(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(timezone.utc).timestamp()


def poll(find, limit):
    """The first truthy `find()` within `limit` seconds, else None."""
    deadline = time.time() + limit
    while True:
        found = find()
        if found or time.time() >= deadline:
            return found or None
        time.sleep(POLL)


def dispatch():
    """The run `gh workflow run` starts: the oldest dispatch-event run on `main` created since the call."""
    started = time.time() - 30
    orders.call('workflow', 'run', WORKFLOW, '--ref', 'main')

    def find():
        runs = orders.gh('run', 'list', '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--branch', 'main',
                         '--json', 'databaseId,createdAt', '--limit', '20')
        return min((r for r in runs if parse_time(r['createdAt']) >= started), key=lambda r: r['createdAt'], default=None)
    found = poll(find, APPEAR)
    if not found:
        raise SystemExit(f'no {WORKFLOW} dispatch run appeared within {APPEAR} s')
    return found['databaseId']


def observe(issue):
    run_id = str(dispatch())
    run = poll(lambda: (r if (r := orders.gh('run', 'view', run_id, '--json', 'status,conclusion,url,headSha,event'))['status'] == 'completed' else None), FINISH)
    if not run:
        raise SystemExit(f'run {run_id} did not complete within {FINISH} s')
    pages = orders.gh('api', f'repos/{{owner}}/{{repo}}/actions/runs/{run_id}/jobs?per_page=100', '--paginate', '--slurp')
    jobs = [job for page in pages for job in page['jobs']]
    holds_fix = orders.gh('api', f"repos/{{owner}}/{{repo}}/compare/{FIX}...{run['headSha']}")['status'] in ('ahead', 'identical')
    wrong = verdict(jobs)
    if run['event'] != 'workflow_dispatch':
        wrong.append(f"event is {run['event']}")
    if run['conclusion'] != 'success':
        wrong.append(f"run conclusion is {run['conclusion']}")
    body = report(run, jobs, holds_fix, wrong)
    orders.call('issue', 'comment', str(issue), '--body', body)
    print(body)
    return 0 if holds_fix and not wrong else 1


def main(argv):
    if len(argv) != 2 or not argv[1].isdigit():
        sys.stderr.write('usage: observe-dispatch.py <issue>\n')
        return 2
    try:
        return observe(int(argv[1]))
    except subprocess.CalledProcessError as error:
        sys.stderr.write(f'GitHub failed: {error}\n')
        return 4


if __name__ == '__main__':
    sys.exit(main(sys.argv))
