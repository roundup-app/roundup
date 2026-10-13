#!/usr/bin/env python3
"""L106: source-backed daily Retro input and bounded Issue publication."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import time
import threading
import tempfile

import orders

REPORT = '<!-- retro-report -->'
STATE = '<!-- retro-state '
# GitHub re-runs a workflow run at most 30 days after creating it, so no older check completes inside a window.
RERUN_DAYS = 30
# The workflows whose runs call a model; build-issue and fix-branch are the reusable workflows build and fix call.
MODEL_WORKFLOWS = ('build', 'build-issue', 'fix', 'fix-branch', 'review', 'critic', 'retro', 'care')


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.utcoffset() != timedelta(0):
        raise ValueError('timestamp must be UTC')
    return result


def utc(value):
    return value.isoformat().replace('+00:00', 'Z')



def validate_evidence(path, row):
    fields = ()
    if path.startswith('issues?'):
        fields = ('number', 'title', 'body', 'user.login', 'labels', 'state', 'created_at', 'updated_at',
                  'closed_at', 'html_url')
    elif re.search(r'/comments\?', path):
        fields = ('body', 'user.login', 'created_at', 'html_url')
    elif '/events?' in path:
        fields = ('event', 'created_at', 'url')
    elif '/reviews?' in path:
        fields = ('body', 'user.login', 'submitted_at', 'html_url')
    elif '/files?' in path:
        fields = ('filename',)
    elif '/commits?' in path:
        fields = ('sha', 'commit.message', 'commit.committer.date')
    elif '/jobs?' in path:
        fields = ('name', 'status', 'conclusion', 'created_at', 'started_at', 'completed_at', 'html_url', 'steps')
    elif path.startswith('actions/'):
        fields = ('name', 'path', 'head_branch', 'conclusion', 'created_at', 'updated_at', 'html_url')
    elif path.startswith('pulls/'):
        fields = ('number', 'title', 'body', 'head.ref', 'created_at', 'merged_at', 'closed_at', 'html_url')
    for field in fields:
        value = row
        for part in field.split('.'):
            if not isinstance(value, dict) or part not in value:
                raise ValueError(f'missing {field}')
            value = value[part]
        if field in ('title', 'filename', 'sha', 'user.login', 'head.ref', 'name', 'path',
                     'event', 'html_url', 'url') and not isinstance(value, str):
            raise ValueError(f'{field} must be text')
        if field in ('body', 'commit.message') and value is not None and not isinstance(value, str):
            raise ValueError(f'{field} must be text')
        if field in ('labels', 'steps') and not isinstance(value, list):
            raise ValueError(f'{field} must be a list')
        if field.endswith(('_at', '.date')):
            if value is None and field in ('closed_at', 'merged_at', 'started_at', 'completed_at', 'submitted_at'):
                continue
            if not isinstance(value, str):
                raise ValueError(f'{field} must be a timestamp')
            timestamp(value)


def diagnostic(error):
    """A failed `gh api` call's exit, stderr and diagnostic headers, without credentials or collected bodies."""
    # Keep diagnostic headers only: stdout can contain collected Issue bodies and logs.
    blocks = re.findall(r'(?:^|(?<=[\[,]))HTTP/\S+ \d{3}[^\n]*\n(?:[^\n]+\n)*?\n', error.stdout or '')
    headers = re.findall(
        r'(?mi)^(?:HTTP/\S+ \d{3}[^\n]*|x-ratelimit-(?:remaining|reset|limit|resource):[^\n]*|'
        r'x-github-request-id:[^\n]*|retry-after:[^\n]*)', '\n'.join(blocks))
    detail = '\n'.join([f'gh exited {error.returncode}', error.stderr or 'no stderr', *headers[-8:]])
    for name in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'):
        if os.environ.get(name):
            detail = detail.replace(os.environ[name], '[redacted]')
    detail = re.sub(r'(?i)(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+|Bearer\s+[^\s]+', '[redacted]', detail)
    return re.sub(r'(?im)^.*(?:authorization|cookie):.*$', '[redacted]', detail)


class GitHub:
    def __init__(self, repo):
        self.repo = repo
        self.reads = []
        self.cache = {}
        self.remaining = None
        self.reset = None
        self.budget = threading.Lock()

    def request(self, args, body=None, tries=orders.READ_TRIES):
        # Pace each try; the reserve covers pagination and concurrent loop traffic. A transient failure gets
        # another try after a backoff, and the last one escapes naming the request. A write passes tries=1:
        # GitHub may have acted on a write that failed, so another try could act twice.
        for attempt in range(1, tries + 1):
            with self.budget:
                if self.remaining is not None and self.remaining < 100 and self.reset is not None:
                    print(f'Retro waits for GitHub read budget until {self.reset}', file=sys.stderr)
                    while time.time() <= self.reset:
                        time.sleep(min(60, self.reset - time.time() + 1))
                    self.remaining = None
                if self.remaining is not None:
                    self.remaining -= 1
            try:
                raw = subprocess.run(['gh', 'api', *args, '--include'], input=body, check=True,
                                     capture_output=True, text=True, timeout=180).stdout
                break
            except subprocess.TimeoutExpired as error:
                failure, detail, delay = error, f'timed out after {error.timeout:g} seconds', 5 * 2 ** (attempt - 1)
            except subprocess.CalledProcessError as error:
                failure, detail = error, diagnostic(error)
                delay = orders.backoff(detail, attempt)
            if delay is None or attempt == tries:
                raise RequestFailed(f'GitHub request {args[0]} failed on try {attempt} of {tries}: '
                                    f'{detail[:2000]}', orders.status(detail)) from failure
            print(f'GitHub request {args[0]} failed on try {attempt} of {tries}; next try in {delay}s: '
                  f'{" ".join(detail.split())[:300]}', file=sys.stderr)
            time.sleep(delay)
        header = r'(?:^|(?<=[\[,]))HTTP/\S+ \d{3}[^\n]*\n(?:[^\n]+\n)*?\n'
        headers = re.findall(header, raw)
        for block in headers:
            remaining = re.search(r'(?mi)^x-ratelimit-remaining: (\d+)', block)
            reset = re.search(r'(?mi)^x-ratelimit-reset: (\d+)', block)
            if remaining and reset:
                with self.budget:
                    new_reset, new_remaining = int(reset[1]), int(remaining[1])
                    self.remaining = min(self.remaining, new_remaining) if (
                        self.reset == new_reset and self.remaining is not None) else new_remaining
                    self.reset = new_reset
        return re.sub(header, '', raw)

    def read(self, path, key=None):
        endpoint = f'repos/{self.repo}/{path}'
        if endpoint in self.cache:
            return self.cache[endpoint]
        try:
            if path == 'actions/workflows/check.yml/runs?per_page=100' or (
                    path.startswith('actions/runs?') and key == 'workflow_runs'):
                # Historical checks and seven-day run listings outgrow one call. Bound each page,
                # pacing it against the read budget; a failed page still kills collection.
                pages = []
                while True:
                    page = json.loads(self.request([f'{endpoint}&page={len(pages) + 1}']))
                    if not isinstance(page, dict) or not isinstance(page.get('workflow_runs'), list):
                        raise ValueError('expected list of workflow runs')
                    if 'created=' in path and page.get('total_count', 0) > 1000:
                        raise ReadLimit(endpoint)
                    pages.append(page)
                    if len(page['workflow_runs']) < 100:
                        break
            else:
                raw = self.request([endpoint, '--paginate', '--slurp'])
                pages = json.loads(raw)
            if not isinstance(pages, list) or not pages:
                raise ValueError('missing pages')
            rows = []
            for page in pages:
                values = page[key] if key else page
                if not isinstance(values, list):
                    raise ValueError('expected list')
                rows.extend(values)
            if key == 'workflow_runs' and 'created=' in path and pages[0]['total_count'] > 1000:
                raise ReadLimit(endpoint)
            if not all(isinstance(row, dict) for row in rows):
                raise ValueError('expected object rows')
            if any('id' in row and (type(row['id']) is not int or row['id'] <= 0) for row in rows):
                raise ValueError('expected positive numeric ids')
            for row in rows:
                validate_evidence(path, row)
            unique = {row.get('id', row.get('filename', row.get('sha'))): row for row in rows}
            if key and 'total_count' in pages[0] and len(unique) < pages[0]['total_count']:
                raise RuntimeError(f'GitHub read {endpoint}: truncated results')
            if None in unique:
                raise ValueError('row has no id, filename or sha')
            self.reads.append({'url': f'https://api.github.com/{endpoint}', 'pages': len(pages),
                               'ids': list(unique)})
            self.cache[endpoint] = list(unique.values())
            return self.cache[endpoint]
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f'GitHub read {endpoint}: {error}') from error

    def object(self, path):
        endpoint = f'repos/{self.repo}/{path}'
        if endpoint in self.cache:
            return self.cache[endpoint]
        try:
            value = json.loads(self.request([endpoint]))
            if not isinstance(value, dict) or type(value.get('id')) is not int or value['id'] <= 0:
                raise ValueError('expected object with id')
            validate_evidence(path, value)
            self.reads.append({'url': f'https://api.github.com/{endpoint}', 'ids': [value['id']]})
            self.cache[endpoint] = value
            return value
        except (subprocess.SubprocessError, ValueError, TypeError) as error:
            raise RuntimeError(f'GitHub read {endpoint}: {error}') from error

    def document(self, path, required):
        """Read an immutable commit/compare or branch document through the shared client."""
        endpoint = f'repos/{self.repo}/{path}'
        if endpoint not in self.cache:
            value = json.loads(self.request([endpoint]))
            if not isinstance(value, dict) or any(field not in value for field in required):
                raise RuntimeError(f'GitHub read {endpoint}: missing document fields')
            self.cache[endpoint] = value
            self.reads.append({'url': f'https://api.github.com/{endpoint}', 'ids': [value.get('sha', path)]})
        return self.cache[endpoint]

    def logs(self, job):
        """A job's log, or None when GitHub stores none for it (HTTP 404)."""
        endpoint = f'repos/{self.repo}/actions/jobs/{job["id"]}/logs'
        try:
            raw = self.request([endpoint, '--allow-escape-sequences'])
        except RequestFailed as error:
            if error.code != 404:
                raise
            print(f'Retro reads no log for job {job["id"]}: GitHub stores none (HTTP 404)', file=sys.stderr)
            return None
        self.reads.append({'url': f'https://api.github.com/{endpoint}', 'ids': [job['id']]})
        return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw)

    def write(self, path, method, **fields):
        raw = self.request([f'repos/{self.repo}/{path}', '-X', method, '--input', '-'], json.dumps(fields), tries=1)
        return json.loads(raw)


def source(row, at=None):
    result = {'id': row['id'], 'url': row.get('html_url') or row.get('url'),
              'at': at or row.get('created_at')}
    if not result['url'] or not result['at']:
        raise ValueError('source needs URL and timestamp')
    return result


def classify(paths, body):
    if any(p.startswith(('loop/', '.github/', '.agents/', '.claude/')) or
           Path(p).name in ('AGENTS.md', 'CLAUDE.md') for p in paths):
        return 'loop'
    if paths and all(p.startswith(('scenarios/', 'docs/')) for p in paths):
        return 'spec'
    if not paths:
        match = re.search(r'^Scenarios: (.+)$', body or '', re.M)
        ids = re.findall(r'[A-Z]+\d+', match[1]) if match else []
        return 'loop' if ids and all(i.startswith('L') for i in ids) else 'product'
    return 'product'


def flaky_diagnosis(body):
    """Keep only a diagnosis of this Issue's named test failure, never requested capabilities."""
    diagnosis = re.split(r'(?mi)^(?:#+ )?(?:Expected|Observer|Scope|Acceptance|Scenarios)\b', body or '')[0]
    diagnosis = re.sub(r'(?i)^(?:#+ )?Found[^:\n]*:\s*', '', diagnosis.strip())
    # Work orders record observations in Found, before the requested outcome. References to
    # another repair do not assert a failure owned here, even when they name its test.
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n|\n(?=- )', diagnosis) if p.strip()]
    observations = [p for p in paragraphs if not re.match(
        r'(?i)^(?:-\s*)?(?:see\s+)?(?:\[?#\d+|(?:issue|PR)\s+\[?#\d+|for example|e\.g\.)', p)]
    tests = []
    named = []
    for paragraph in observations:
        names = re.findall(
            r'(?i)`([a-zA-Z]\w*)`(?:\s+in\s+`[^`]+`)?\s+'
            r'(?:fail(?:ed|s)?|panick\w*|timed out)\b', paragraph)
        if re.match(r'(?i)^(?:-\s*)?(?:unowned\s+)?flaky tests?\s*:', paragraph):
            names += re.findall(r'`([a-zA-Z]\w*_[\w]+)`', paragraph)
        names += re.findall(r'(?i)\btest\s+`([a-zA-Z]\w*)`', paragraph)
        names += re.findall(r'(?i)\btest\s+([a-zA-Z]\w*)\s*:', paragraph)
        if names and re.search(r'(?i)\b(?:fail\w*|panick\w*|timed out|flaky|flakiness|intermittent)\b', paragraph):
            tests.extend(names)
            named.append(paragraph)
    failures = [p for p in observations if re.search(
        r'(?i)\b(?:fail(?:ed|s|ure|ures)?|panick\w*|timed out|timeout)\b|'
        r'\bread\b.+\bexpected\b', p)]
    flaky = [p for p in observations if (p in named or re.search(
        r'(?is)\btests?\s+(?:fail|fails|reads?|read)\b', p)) and re.search(
        r'(?is)\b(?:flaky|flakiness|intermittent|randomly|race|nondeterministic)\b|'
        r'\bat random\b|\btest\b.+\breads?\b.+\bbefore\b|'
        r'\bpass depends\b.+\b(?:load|runner)\b', p) and not re.search(
        r'(?i)\b(?:not|never|no) (?:flaky|intermittent|race)\b', p)]
    if not tests or not failures or not flaky:
        return None
    return {'tests': list(dict.fromkeys(tests)),
            'failure_evidence': list(dict.fromkeys(failures + flaky))}


def collect(github, end):
    start = end - timedelta(hours=24)
    inside = lambda at: bool(at) and start <= timestamp(at) < end
    before = lambda at: bool(at) and timestamp(at) < end
    # The all-state Issue listing includes old held Issues, old PRs merged today and historical report baselines.
    issues = github.read('issues?state=all&per_page=100')
    data = {'window': {'start': utc(start), 'end': utc(end), 'interval': '[start, end)'},
            'collected_at': utc(datetime.now(timezone.utc)), 'merged': [], 'unmerged': [], 'fix_attempts': [],
            'fix_nopush': [], 'strikes': [], 'held_by_strikes': [], 'main_failures': [], 'flaky_issues': [],
            'queue': [], 'queue_workflows': list(MODEL_WORKFLOWS), 'model_work': [], 'needs_user': [],
            'owner_comments': []}
    model_ids_by_pr = {}
    comments_by_number = {}
    relevant = [i for i in issues if
                (i['state'] == 'open' and any(l['name'] == orders.NEEDS_USER for l in i['labels'])) or
                timestamp(i['updated_at']) >= start or
                (i.get('closed_at') and timestamp(i['closed_at']) >= start)]
    reads = [(f'issues/{i["number"]}/{kind}?per_page=100', None)
             for i in relevant for kind in ('comments', 'events')]
    reads += [(f'pulls/{i["number"]}/{kind}?per_page=100', None)
              for i in relevant if 'pull_request' in i for kind in ('comments', 'reviews')]
    prefetch(github, reads)
    for issue in relevant:
        number = issue['number']
        comments = list(github.read(f'issues/{number}/comments?per_page=100'))
        if 'pull_request' in issue:
            comments += github.read(f'pulls/{number}/comments?per_page=100')
            reviews = github.read(f'pulls/{number}/reviews?per_page=100')
            comments += [{**r, 'created_at': r['submitted_at']} for r in reviews
                         if r.get('submitted_at') and r.get('body')]
        comments = [c for c in comments if before(c['created_at'])]
        comments_by_number[number] = comments
        events = github.read(f'issues/{number}/events?per_page=100')
        events = sorted([e for e in events if before(e['created_at'])], key=lambda e: e['created_at'])
        recent_strikes = []
        for comment in comments:
            body = comment['body'] or ''
            if inside(comment['created_at']):
                row = {**source(comment), 'number': number, 'body': body}
                if comment['user']['login'] == orders.BOT:
                    if body.startswith('<!-- fix-attempt -->'):
                        data['fix_attempts'].append(row)
                    if body.startswith(('<!-- fix-attempt -->', '<!-- fix-nopush')):
                        run = re.search(r'https://github.com/[^\s)]+/actions/runs/\d+', body)
                        row = {**row, 'run': run[0] if run else 'unknown',
                               'push': 'none' if 'It pushed nothing to ' in body else 'unknown'}
                        data['fix_nopush'].append(row)
                    if body.startswith(orders.STRIKE):
                        recent_strikes.append(row)
                        data['strikes'].append(row)
                if comment['user']['login'] == orders.OWNER:
                    linked = []
                    for candidate in issues:
                        if 'pull_request' in candidate and (candidate['number'] == number or re.search(
                                rf'(?:Refs|Closes|Fixes) #{number}\b', candidate.get('body') or '')):
                            pr = github.object(f'pulls/{candidate["number"]}')
                            commits = github.read(f'pulls/{candidate["number"]}/commits?per_page=100')
                            linked.append({'pr': pr, 'commits': [c for c in commits if before(c['commit']['committer']['date'])],
                                           'files': github.read(f'pulls/{candidate["number"]}/files?per_page=100')})
                    data['owner_comments'].append({**row, 'later_evidence': {
                        'issue_body': issue['body'], 'body_updated_at': issue['updated_at'],
                        'body_available_at_collection': True,
                        'linked_issue': next((i for i in issues if i['number'] ==
                            orders.linked_issue(issue['body'])), None) if 'pull_request' in issue else None,
                        'events': [e for e in events if
                        e['created_at'] > comment['created_at']], 'linked_prs': linked}})
        state_events = [e for e in events if e['event'] in ('closed', 'reopened')]
        open_at_end = (state_events[-1]['event'] == 'reopened' if state_events else
                       issue['state'] == 'open' or not before(issue.get('closed_at')))
        if open_at_end and len(recent_strikes) >= 3:
            data['held_by_strikes'].append({'number': number, **source(issue), 'strikes': recent_strikes})
        held = None
        for event in events:
            if (event.get('label') or {}).get('name') != orders.NEEDS_USER:
                continue
            if event['event'] == 'labeled' and held is None:
                held = event
            elif event['event'] == 'unlabeled' and held:
                add_wait(data, issue, held, event, comments, start, end)
                held = None
        if held:
            add_wait(data, issue, held, None, comments, start, end)
        if inside(issue['created_at']) and 'pull_request' not in issue:
            evidence = flaky_diagnosis(issue['body'])
            if evidence:
                data['flaky_issues'].append({**source(issue), 'number': number, **evidence,
                                            'diagnosis': issue['body'], 'comments': comments})
    for issue in relevant:
        if 'pull_request' not in issue:
            continue
        pr = github.object(f'pulls/{issue["number"]}')
        if inside(pr.get('merged_at')):
            files = github.read(f'pulls/{pr["number"]}/files?per_page=100')
            paths = [f['filename'] for f in files]
            commits = github.read(f'pulls/{pr["number"]}/commits?per_page=100')
            texts = [c['commit']['message'] for c in commits] + [
                c['body'] for c in comments_by_number[pr['number']]
                if c['user']['login'] in orders.AUTHORS]
            ids = set()
            for text in texts:
                ids.update(int(i) for i in re.findall(
                    r'(?:Author-Agent: builder-|Reviewed-by-Agent: (?:reviewer|critic)-)(\d+)', text))
                if text.startswith(('<!-- fix-attempt', '<!-- fix-nopush')):
                    ids.update(int(i) for i in re.findall(r'/actions/runs/(\d+)', text))
            model_ids_by_pr[pr['number']] = ids
            data['merged'].append({**source(pr, pr['merged_at']), 'number': pr['number'], 'title': pr['title'],
                                   'branch': pr['head']['ref'], 'kind': classify(paths, pr['body']),
                                   'paths': paths, 'body': pr['body']})
        elif not pr.get('merged_at') and inside(pr.get('closed_at')):
            closed = [e for e in github.read(f'issues/{pr["number"]}/events?per_page=100')
                      if e['event'] == 'closed' and inside(e['created_at'])]
            causes = [c for c in comments_by_number[pr['number']] if
                      c['body'].startswith(('<!-- fix-exhausted', '<!-- closed', '<!-- superseded'))]
            linked = orders.linked_issue(pr['body'])
            if linked:
                evidence = comments_by_number.get(linked)
                if evidence is None:
                    evidence = github.read(f'issues/{linked}/comments?per_page=100')
                causes += [c for c in evidence if before(c['created_at']) and
                           c['body'].startswith(f'<!-- fix-exhausted #{pr["number"]} -->')]
            data['unmerged'].append({**source(pr, pr['closed_at']), 'number': pr['number'],
                                     'closing_events': closed, 'cause': causes or 'unknown'})
    runs = workflow_runs(github, start, end)
    known_ids = {r['id'] for r in runs}
    for run_id in sorted(set().union(*model_ids_by_pr.values()) if model_ids_by_pr else set()):
        if run_id not in known_ids:
            runs.append(github.object(f'actions/runs/{run_id}'))
    # A main check created before the window can complete inside it, also as a re-run within RERUN_DAYS.
    failures = workflow_runs(github, start - timedelta(days=RERUN_DAYS), end, 'check.yml', 'main')
    failures = [r for r in failures if r['head_branch'] == 'main' and
                (r['conclusion'] == 'failure' or r.get('run_attempt', 1) > 1)]
    runs = list({r['id']: r for r in runs + failures if before(r['created_at'])}.values())
    selected = []
    for run in runs:
        # Only a model run's wait is measured: reading every run's jobs exceeds the hourly read budget.
        queue = inside(run['created_at']) and Path(run.get('path', '')).stem in MODEL_WORKFLOWS
        failure = (Path(run.get('path', '')).stem == 'check' and run['head_branch'] == 'main' and
                   (run['conclusion'] == 'failure' or run.get('run_attempt', 1) > 1) and
                   timestamp(run['updated_at']) >= start)
        associated = [pr for pr in data['merged'] if run['id'] in model_ids_by_pr[pr['number']] or
                      (before(run['created_at']) and timestamp(run['created_at']) < timestamp(pr['at']) and (
                      pr['branch'] == run['head_branch'] or
                      re.search(rf'(?<![\w/.-]){re.escape(pr["branch"])}(?![\w/.-])',
                                run.get('display_title', '')) or
                      re.search(rf'PR #{pr["number"]}\b', run.get('display_title', '')) or
                      any(p['number'] == pr['number'] for p in run.get('pull_requests', []))))]
        role = Path(run.get('path', '')).stem
        if role == 'build-issue':
            role = 'build'
        model = role in ('build', 'fix', 'review', 'critic') and (associated or role == 'build')
        if not (queue or failure or model):
            continue
        selected.append((run, queue, failure, associated, role, model))
    prefetch(github, [(f'actions/runs/{r[0]["id"]}/jobs?filter=all&per_page=100', 'jobs') for r in selected])
    for run, queue, failure, associated, role, model in selected:
        jobs = github.read(f'actions/runs/{run["id"]}/jobs?filter=all&per_page=100', 'jobs')
        evidence = {**source(run), 'workflow': Path(run['path']).stem,
                    'display_title': run.get('display_title', run['name']), 'jobs': jobs}
        if queue:
            starts = [timestamp(j['started_at']) for j in jobs if j.get('status') != 'queued' and
                      j.get('started_at') and before(j['started_at'])]
            seconds = ((min(starts) if starts else end) - timestamp(run['created_at'])).total_seconds()
            data['queue'].append({**evidence, 'seconds': seconds, 'still_queued': not starts})
        if failure:
            attempts = []
            for attempt in sorted({j.get('run_attempt', 1) for j in jobs}):
                attempt_jobs = [j for j in jobs if j.get('run_attempt', 1) == attempt]
                finished = max((j['completed_at'] for j in attempt_jobs if j.get('completed_at')), default=None)
                failed_jobs = [j for j in attempt_jobs if j['conclusion'] == 'failure']
                if finished and inside(finished) and failed_jobs:
                    attempts.append({'run_attempt': attempt, 'completed_at': finished, 'failed_jobs': failed_jobs})
            if attempts:
                data['main_failures'].append({**evidence, 'completed_at': attempts[-1]['completed_at'],
                    'attempts': attempts, 'failed_jobs': [j for a in attempts for j in a['failed_jobs']]})
        if model:
            for pr in data['merged']:
                linked_issue = orders.linked_issue(pr['body'])
                # build.yml is a matrix of reusable build-issue jobs; each is named by its Work Issue.
                relevant_jobs = [j for j in jobs if role != 'build' or
                                 (linked_issue and re.search(rf'(?<!\d){linked_issue}(?!\d)', j['name']))]
                if pr not in associated:
                    continue
                model_jobs = [j for j in relevant_jobs if any(
                    s['name'] == 'Run Codex' or 'claude-code-action' in s['name']
                    for s in j.get('steps', []))]
                if role == 'build' and not relevant_jobs:
                    continue
                post_jobs = [j for j in relevant_jobs if j['name'].split('/')[-1].strip() in ('after', 'post')
                             and j.get('conclusion') not in (None, 'skipped') and
                             j.get('completed_at') and before(j['completed_at'])]
                worked = 'unknown'
                logs = []
                for job in post_jobs:
                    log = github.logs(job)
                    if log is None:
                        logs.append({'job': source(job), 'worked_values': [], 'log': 'missing'})
                        continue
                    values = re.findall(r'\bRAN: (true|false)\b', log)
                    logs.append({'job': source(job), 'worked_values': values})
                    if values:
                        worked = values[-1] == 'true'
                model_steps = [s for j in model_jobs for s in j.get('steps', [])
                               if s['name'] == 'Run Codex' or 'claude-code-action' in s['name']]
                role_jobs = [j for j in relevant_jobs if j['name'].split('/')[-1].strip() in
                             ('build', 'fix-run', 'review-run', 'critic-run')]
                if ((model_steps and all(s['conclusion'] == 'skipped' for s in model_steps)) or
                        (role_jobs and all(j.get('conclusion') == 'skipped' for j in role_jobs))):
                    worked = False
                data['model_work'].append({**evidence, 'role': role, 'prs': [pr['number']],
                    'worked': worked, 'worked_evidence': logs,
                    'elapsed_seconds': sum((timestamp(j['completed_at']) - timestamp(j['started_at'])).total_seconds()
                        for j in model_jobs if j.get('started_at') and j.get('completed_at')),
                    'evidence': 'L23 RAN output in after/post logs; absent output is unknown'})
    counts = {kind: sum(p['kind'] == kind for p in data['merged']) for kind in ('product', 'loop', 'spec')}
    data['numbers'] = {'merged': len(data['merged']), **counts, 'closed_unmerged': len(data['unmerged']),
                       'fix_attempts': len(data['fix_attempts']),
                       'fix_nopush': sum(r['push'] == 'none' for r in data['fix_nopush']),
                       'fix_push_unknown': sum(r['push'] == 'unknown' for r in data['fix_nopush']),
                       'strikes': len(data['strikes']), 'held_by_strikes': len(data['held_by_strikes']),
                       'main_failures': len(data['main_failures']), 'flaky_issues': len(data['flaky_issues']),
                       'needs_user': len(data['needs_user']),
                       'needs_user_seconds': sum(r['window_seconds'] for r in data['needs_user']),
                       'confirmed_model_runs': sum(r['worked'] is True for r in data['model_work']),
                       'model_work_unknown': sum(r['worked'] == 'unknown' for r in data['model_work'])}
    data['numbers']['model_runs_per_merged_pr'] = (data['numbers']['confirmed_model_runs'] / len(data['merged'])
        if data['merged'] and not data['numbers']['model_work_unknown'] else 'n/a')
    data['queue_by_workflow'] = {}
    for name in sorted({r['workflow'] for r in data['queue']}):
        rows = [r for r in data['queue'] if r['workflow'] == name]
        waits = [r['seconds'] for r in rows if not r['still_queued']]
        data['queue_by_workflow'][name] = {'count': len(waits), 'median_seconds': statistics.median(waits) if waits else 'n/a',
            'max_seconds': max(waits) if waits else 'n/a', 'runs': [r['id'] for r in rows],
            'still_queued': sum(r['still_queued'] for r in rows)}
    data['model_work_by_pr'] = {str(p['number']): {role: [r for r in data['model_work'] if
        p['number'] in r['prs'] and r['role'] == role] for role in ('build', 'fix', 'review', 'critic')}
        for p in data['merged']}
    data['model_counts_by_pr'] = {}
    for pr, roles in data['model_work_by_pr'].items():
        counts_by_role = {role: {'confirmed': sum(r['worked'] is True for r in rows),
                                'unknown': sum(r['worked'] == 'unknown' for r in rows)}
                          for role, rows in roles.items()}
        data['model_counts_by_pr'][pr] = {**counts_by_role,
            'confirmed_total': sum(c['confirmed'] for c in counts_by_role.values()),
            'unknown_total': sum(c['unknown'] for c in counts_by_role.values())}
    data['reports'] = [i for i in issues if is_report(i)]
    data['repair_candidates'] = candidates(issues, end)
    data['sources'] = github.reads
    return data




def prefetch(github, reads):
    # Four independent reads hide network latency while staying below GitHub's concurrency limit.
    # Joining every future propagates any failed read before a model or publisher can run.
    pool = ThreadPoolExecutor(max_workers=4)
    try:
        list(pool.map(lambda entry: github.read(*entry), reads))
    finally:
        pool.shutdown(wait=True, cancel_futures=True)


def workflow_runs(github, start, end, workflow=None, branch=None):
    # GitHub caps filtered Actions searches at 1,000 results; split dense intervals, not pages off the end.
    listing = f'actions/workflows/{workflow}/runs?' if workflow else 'actions/runs?'
    path = listing + (f'branch={branch}&' if branch else '') + f'created={utc(start)}..{utc(end)}&per_page=100'
    try:
        rows = github.read(path, 'workflow_runs')
    except ReadLimit:
        if (end - start).total_seconds() <= 1:
            raise RuntimeError('more than 1000 workflow runs in one second')
        middle = start + timedelta(seconds=int((end - start).total_seconds() / 2))
        rows = (workflow_runs(github, start, middle, workflow, branch) +
                workflow_runs(github, middle, end, workflow, branch))
    return list({r['id']: r for r in rows if timestamp(r['created_at']) < end}.values())


class ReadLimit(RuntimeError):
    pass


class RequestFailed(RuntimeError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code

def add_wait(data, issue, added, removed, comments, start, end):
    begin = timestamp(added['created_at'])
    finish = timestamp(removed['created_at']) if removed else end
    if finish <= start or begin >= end:
        return
    asks = sorted([c for c in comments if c['user']['login'] in orders.AUTHORS and c['body'].startswith('<!-- needs-user -->') and
                   begin <= timestamp(c['created_at']) < finish], key=lambda c: c['created_at'])
    before_label = sorted([c for c in comments if c['user']['login'] in orders.AUTHORS and c['body'].startswith('<!-- needs-user -->') and
                          begin - timedelta(seconds=60) <= timestamp(c['created_at']) < begin],
                          key=lambda c: c['created_at'])
    ask = asks[0] if asks else before_label[-1] if before_label else 'unknown'
    data['needs_user'].append({'number': issue['number'], 'issue': issue['html_url'],
        'added': source(added), 'removed': source(removed) if removed else None,
        'ask': ask, 'total_seconds': (finish - begin).total_seconds(),
        'window_seconds': (min(end, finish) - max(start, begin)).total_seconds()})


def candidates(issues, end, *, loop_only=True):
    return [i for i in issues if 'pull_request' not in i and orders.work_issue(i) and
            (not loop_only or any(l['name'] in ('kind:loop', 'area:loop') for l in i['labels'])) and
            (i['state'] == 'open' or (i.get('closed_at') and
             end - timedelta(days=7) <= timestamp(i['closed_at'])))]



def is_report(issue):
    return ((issue.get('body') or '').startswith(REPORT) and
            (issue.get('user') or {}).get('login') in orders.AUTHORS)

def report_state(issue):
    match = re.search(re.escape(STATE) + r'(.+?) -->', issue['body'], re.S)
    if not match:
        raise ValueError(f'Retro #{issue["number"]} has no script state')
    return json.loads(match[1])


def validate_repairs(issues, proposals, allowed, repair_marker, *, product=False):
    new = [p for p in proposals if not p.get('match')]
    new_keys = [orders.field(p['body'], 'Key') for p in new]
    existing_keys = {m[1] for i in issues if orders.work_issue(i) for m in [re.search(r'^Key: (.+)$', i['body'] or '', re.M)] if m}
    if len(set(new_keys)) != len(new_keys) or existing_keys.intersection(new_keys):
        raise ValueError('duplicate Work Issue Key; comment on its Issue')
    if len({p['title'].strip().casefold() for p in new}) != len(new):
        raise ValueError('duplicate proposed repair title')
    for proposal in proposals:
        if proposal.get('match'):
            if proposal['match'] not in allowed:
                raise ValueError('match outside open/recent closed Work Issues')
        else:
            for field in ('Scenarios', 'Specification', 'Key', 'Priority', 'Mode'):
                orders.field(proposal['body'], field)
            with tempfile.TemporaryDirectory(prefix='retro-order-') as directory:
                body_file = Path(directory) / 'work.md'
                body_file.write_text(repair_marker + '\n' + proposal['body'])
                subprocess.run([sys.executable, str(Path(orders.__file__)), 'check', str(body_file)],
                               check=True, capture_output=True, text=True, timeout=30)
            for heading in ('Found', 'Expected', 'Observer'):
                if not re.search(rf'(?m)^(?:#+ )?{heading}\b', proposal['body']):
                    raise ValueError(f'repair needs {heading}')
            if not re.search(r'(?:#\d+|/actions/runs/\d+)', proposal['body']) and not product:
                raise ValueError('repair needs PR or run evidence')
            if 'Scope:' not in proposal['body']:
                raise ValueError('repair needs bounded Scope')


def publish_repairs(github, proposals, marker, labels, completed=None):
    """Publish prevalidated orders; a failed/unknown write escapes, stopping further writes."""
    urls = []
    for proposal in proposals:
        if proposal.get('match'):
            result = github.write(f'issues/{proposal["match"]}/comments', 'POST', body=proposal['evidence'])
        else:
            result = github.write('issues', 'POST', title=proposal['title'],
                                  body=marker + '\n' + proposal['body'], labels=labels)
            urls.append(result['html_url'])
        if completed is not None:
            completed.append(result['html_url'])
    return urls


def publish(github, data, plan):
    end = timestamp(data['window']['end'])
    title = f'Retro {end.date()}'
    # Re-read before any mutation. A failed search cannot turn into a duplicate Issue.
    issues = github.read('issues?state=all&per_page=100')
    matches = candidates(issues, end)
    allowed = {i['number'] for i in matches}
    reports = [i for i in issues if is_report(i)]
    same = [i for i in reports if i['title'] == title]
    if len(same) > 1:
        raise ValueError('multiple reports for this date')
    prior = sorted([i for i in reports if re.fullmatch(r'Retro \d{4}-\d{2}-\d{2}', i['title']) and
                    i['title'] < title], key=lambda i: i['title'])
    baseline = prior[-1] if prior else None
    previous = report_state(baseline) if baseline else None
    repair_marker = f'<!-- retro-repair {end.date()} -->'
    repairs = list(dict.fromkeys((report_state(same[0]).get('repairs', []) if same else []) +
                   [i['html_url'] for i in issues if orders.work_issue(i) and (i['body'] or '').startswith(repair_marker)]))
    proposals = plan['repairs']
    if len(proposals) > 3:
        raise ValueError('at most three causes')
    new = [p for p in proposals if not p.get('match')]
    if len(repairs) + len(new) > 3:
        raise ValueError('daily three-new-Issue limit')
    validate_repairs(issues, proposals, allowed, repair_marker)
    rows = ['| Metric | Today | Previous |', '|---|---:|---:|']
    for key, value in data['numbers'].items():
        rows.append(f'| {key} | {value} | {previous["numbers"].get(key, "n/a") if previous else "n/a"} |')
    repairs += publish_repairs(github, proposals, repair_marker, ['kind:loop', 'area:loop'])
    queue_summary = {name: {k: v for k, v in values.items() if k != 'runs'}
                     for name, values in data['queue_by_workflow'].items()}
    state = {'window': data['window'], 'numbers': data['numbers'], 'repairs': repairs,
             'queue_by_workflow': queue_summary}
    model_rows = ['| Merged PR | build | fix | review | critic | Confirmed total | Unknown total |',
                  '|---|---:|---:|---:|---:|---:|---:|']
    for pr in data['merged']:
        counts = data['model_counts_by_pr'][str(pr['number'])]
        roles = [f'{counts[role]["confirmed"]} (+{counts[role]["unknown"]} unknown)'
                 for role in ('build', 'fix', 'review', 'critic')]
        model_rows.append(f'| [#{pr["number"]}]({pr["url"]}) | ' + ' | '.join(roles) +
                          f' | {counts["confirmed_total"]} | {counts["unknown_total"]} |')
    body = '\n\n'.join([REPORT, f'{STATE}{json.dumps(state)} -->',
        f'Window: `{data["window"]["start"]}` to `{data["window"]["end"]}` (end excluded).',
        f'Previous: {baseline["html_url"]} — {previous["window"]}' if baseline else 'Previous: n/a',
        '\n'.join(rows), 'Queue by workflow:\n```json\n' + json.dumps({'today': queue_summary,
            'previous': previous.get('queue_by_workflow', 'n/a') if previous else 'n/a'}, indent=2) + '\n```',
        'Model runs by merged PR:\n' + '\n'.join(model_rows),
        plan['analysis'], 'Repairs:\n' + '\n'.join(repairs),
        'Sources: the fixed input artifact holds every contributing PR, run, job and event link, with timestamps.\n' +
        f'https://github.com/{github.repo}/actions/runs/' + os.environ.get('GITHUB_RUN_ID', 'unknown')])
    if len(body) > 65000:
        raise ValueError('report exceeds GitHub Issue size')
    if same:
        report = github.write(f'issues/{same[0]["number"]}', 'PATCH', body=body)
    else:
        report = github.write('issues', 'POST', title=title, body=body)
    if baseline and baseline['state'] == 'open':
        github.write(f'issues/{baseline["number"]}/comments', 'POST', body=f'Succeeded by {report["html_url"]}')
        github.write(f'issues/{baseline["number"]}', 'PATCH', state='closed', state_reason='completed')
    if plan.get('ask'):
        github.write(f'issues/{report["number"]}/comments', 'POST', body='<!-- needs-user -->\n' + plan['ask'])
        github.write(f'issues/{report["number"]}/labels', 'POST', labels=[orders.NEEDS_USER])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    read = sub.add_parser('input')
    read.add_argument('--end')
    post = sub.add_parser('publish')
    post.add_argument('input')
    post.add_argument('plan')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
        parser.error('--repo must be owner/repository')
    if args.command == 'publish' and not all(Path(p).is_file() for p in (args.input, args.plan)):
        parser.error('publish needs readable input and plan files')
    try:
        end = timestamp(args.end) if args.command == 'input' and args.end else datetime.now(timezone.utc).replace(microsecond=0)
    except ValueError as error:
        parser.error(str(error))
    try:
        github = GitHub(args.repo)
        if args.command == 'input':
            result = collect(github, end)
        else:
            result = publish(github, json.loads(Path(args.input).read_text()), json.loads(Path(args.plan).read_text()))
        print(json.dumps(result, indent=2))
        return 0
    except (RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'Retro failed: {error}', file=sys.stderr)
        return 4


if __name__ == '__main__':
    sys.exit(main())
