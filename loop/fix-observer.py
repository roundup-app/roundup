#!/usr/bin/env python3
"""L82 read-only, fixed post-1452 observation and upload-verified publication."""
import argparse
import base64
import io
import zipfile
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode

from observer import GitHub as PublicationGitHub

START = '2026-10-13T15:58:43Z'
END = '2026-10-13T21:58:43Z'
HISTORICAL = {'artifact': 11797998924, 'result': 'fail', 'dispatches': 48,
              'repeated_identities': 8, 'start': '2026-10-13T00:53:38Z',
              'end': '2026-10-13T06:53:38Z',
              'url': 'https://github.com/saadshahd/roundup/actions/runs/38369332236/artifacts/11797998924'}
CRITERIA = ('complete bounded evidence', 'literal dispatch count', 'live exclusion',
            'duplicate rejection', 'eligible sequential retry', 'distinct identities',
            'worked-attempt accounting and limits', 'required gates')
CAUSES = 'check|rules|review|critic|conflict|unfinished|answered'
TITLE = re.compile(rf'Fix PR #([1-9][0-9]*): ({CAUSES}) @ ([0-9a-f]{{40}})')


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z', value):
        raise ValueError(f'not a complete UTC timestamp: {value!r}')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def window(now):
    if timestamp(now) <= timestamp(END):
        raise ValueError('collect only after the full post-1452 six-hour window ends')
    return {'start': START, 'end': END}


def utc(value):
    return value.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class GitHub:
    """Every GET page and log survives independently, including reads preceding a failure."""
    def __init__(self, repo, directory):
        self.repo = repo
        self.directory = directory
        self.manifest = []
        (directory / 'raw').mkdir(parents=True, exist_ok=True)

    def save(self, path, raw, status=0):
        name = f'raw/{len(self.manifest):06d}'
        (self.directory / name).write_bytes(raw)
        self.manifest.append({'path': path, 'file': name, 'sha256': hashlib.sha256(raw).hexdigest(),
                              'bytes': len(raw), 'exit': status, 'read_at': utc(datetime.now(timezone.utc))})
        (self.directory / 'reads.json').write_text(json.dumps(self.manifest, indent=2))

    def get(self, path, binary=False):
        result = subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}'],
                                capture_output=True, timeout=180)
        self.save(path, result.stdout, result.returncode)
        if result.returncode:
            self.save(path + ' [stderr]', result.stderr, result.returncode)
            raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
        return result.stdout if binary else json.loads(result.stdout)

    def pages(self, path, key=None):
        # Explicit pages allow cap accounting and retain the exact response of every read.
        rows = {}
        expected = None
        page = 1
        while True:
            data = self.get(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            values = data[key] if key else data
            if not isinstance(values, list):
                raise ValueError(f'malformed page: {path}')
            if key and 'total_count' in data:
                if expected is not None and expected != data['total_count']:
                    raise ValueError(f'listing changed during collection: {path}')
                expected = data['total_count']
            before = len(rows)
            for row in values:
                if row['id'] in rows and rows[row['id']] != row:
                    raise ValueError(f'conflicting duplicate id: {path}')
                rows[row['id']] = row
            if len(values) < 100 or (expected is not None and len(rows) >= expected) or (key == 'workflow_runs' and 'created=' in path and page == 10):
                return list(rows.values()), expected
            if len(rows) == before:
                raise ValueError(f'pagination made no progress: {path}')
            page += 1

    def listing(self, start, end):
        query = urlencode({'created': f'{utc(start)}..{utc(end)}'})
        rows, expected = self.pages(f'actions/workflows/fix.yml/runs?{query}', 'workflow_runs')
        if expected is None:
            raise ValueError('fix listing has no total_count')
        if len(rows) >= expected:
            return rows
        if start >= end:
            raise ValueError('one-second fix listing truncated; never infer zero')
        middle = start + timedelta(seconds=int((end - start).total_seconds()) // 2)
        return self.listing(start, middle) + self.listing(middle + timedelta(seconds=1), end)

    def all(self, path, key=None):
        rows, expected = self.pages(path, key)
        if expected is not None and len(rows) != expected:
            raise ValueError(f'incomplete required listing: {path}')
        return rows


def ownership(github):
    records = {}
    for ref in github.get('git/matching-refs/heads/loop-fix/'):
        match = re.fullmatch(rf'refs/heads/loop-fix/([1-9][0-9]*)/({CAUSES})/([0-9a-f]{{40}})', ref['ref'])
        if not match:
            raise ValueError('unknown ownership identity')
        identity = (github.repo, int(match[1]), match[2], match[3])
        chain = []
        sha = ref['object']['sha']
        seen = set()
        while sha:
            if sha in seen:
                raise ValueError('ownership history cycle')
            seen.add(sha)
            commit = github.get(f'git/commits/{sha}')
            text = commit['message'].split('\n\n', 1)[0]
            if not text.startswith('{'):
                break  # parent is the main commit from which the first claim was made
            state = json.loads(text)
            if 'phase' not in state or 'owner' not in state:
                raise ValueError('malformed ownership commit')
            chain.append({'sha': sha, 'at': commit['committer']['date'], 'state': state})
            parents = commit['parents']
            if len(parents) != 1:
                raise ValueError('ownership record needs one parent')
            sha = parents[0]['sha']
        records[identity] = list(reversed(chain))
    return records


def relevant(attempt, queue):
    start, end = timestamp(START), timestamp(END)
    queued = timestamp(queue)
    began = timestamp(attempt['run_started_at']) if attempt.get('run_started_at') else None
    finished = timestamp(attempt['updated_at']) if attempt['status'] == 'completed' else None
    return (start <= queued < end or began is not None and start <= began < end or
            queued < start and (finished is None or finished > start))


def collect(github, now, commit, run_id, run_attempt):
    bounds = window(now)
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('collector requires the full pinned main commit')
    workflow = github.get('actions/workflows/fix.yml')
    # Read all fix workflow creation history: no run predates the workflow's creation.
    runs = github.listing(timestamp(workflow['created_at']).replace(microsecond=0), timestamp(now))
    runs = {run['id']: run for run in runs}
    claims = ownership(github)
    evidence = {'window': bounds, 'collected_at': now, 'collector_commit': commit,
                'run_id': run_id, 'run_attempt': run_attempt, 'repository': github.repo,
                'historical': HISTORICAL, 'identities': [], 'errors': []}
    historical_artifact = github.get(f'actions/artifacts/{HISTORICAL["artifact"]}')
    evidence['historical_artifact'] = historical_artifact
    if historical_artifact['expired']:
        evidence['errors'].append('historical raw artifact expired; durable complete contents unproved')
    else:
        # Copy the complete historical archive into the new retained raw evidence before its original expiry.
        historical_zip = github.get(f'actions/artifacts/{HISTORICAL["artifact"]}/zip', binary=True)
        with zipfile.ZipFile(io.BytesIO(historical_zip)) as archive:
            if not archive.namelist() or archive.testzip() is not None:
                raise ValueError('historical archive is empty or corrupt; complete contents unproved')
    identities = {}
    for run in runs.values():
        match = TITLE.fullmatch(run['display_title'])
        if not match:
            if run.get('status') == 'completed' and timestamp(run['updated_at']) <= timestamp(START):
                continue
            if timestamp(run['created_at']) >= timestamp(END):
                continue
            for number in range(1, run['run_attempt'] + 1):
                attempt = github.get(f'actions/runs/{run["id"]}/attempts/{number}')
                if number > 1 or relevant(attempt, run['created_at']):
                    evidence['errors'].append(f'unknown full identity: run {run["id"]}/{number}')
                    jobs = github.all(f'actions/runs/{run["id"]}/attempts/{number}/jobs', 'jobs')
                    for job in jobs:
                        if job['status'] == 'completed' and job['conclusion'] != 'skipped':
                            github.get(f'actions/jobs/{job["id"]}/logs', binary=True)
            continue
        identity = (github.repo, int(match[1]), match[2], match[3])
        group = identities.setdefault(identity, {'identity': list(identity), 'runs': [], 'attempts': [],
                                                'ownership': claims.get(identity, [])})
        group['runs'].append(run)
        if run.get('status') == 'completed' and timestamp(run['updated_at']) <= timestamp(START):
            continue  # the latest attempt ended before the window; its earlier attempts did too
        if timestamp(run['created_at']) >= timestamp(END):
            continue  # an attempt cannot queue before its original run exists
        for number in range(1, run['run_attempt'] + 1):
            attempt = github.get(f'actions/runs/{run["id"]}/attempts/{number}')
            if attempt['id'] != run['id'] or attempt['run_attempt'] != number:
                raise ValueError('attempt endpoint returned a different run/attempt')
            queue_source = 'original run creation'
            if number == 1:
                queue = run['created_at']
            else:
                pending = [entry for entry in group['ownership'] if entry['state']['phase'] == 'rerun' and
                           entry['state'].get('run') == run['id'] and entry['state'].get('attempt') == number - 1]
                queue = pending[0]['at'] if len(pending) == 1 else None
                queue_source = 'claim intent lower bound; actual queue time unproved'
                if attempt['created_at'] != run['created_at']:
                    queue = attempt['created_at']
                    queue_source = 'native attempt creation'
                elif queue is not None and not (attempt['status'] == 'completed' and timestamp(attempt['updated_at']) <= timestamp(START)):
                    evidence['errors'].append(f'actual rerun queue time unproved (claim intent only): {run["id"]}/{number}')
            ended_before_window = attempt['status'] == 'completed' and timestamp(attempt['updated_at']) <= timestamp(START)
            if queue is None and ended_before_window:
                queue = attempt.get('run_started_at') or run['created_at']
            if queue is None:
                # Cannot safely exclude an old run's rerun on its original creation timestamp.
                evidence['errors'].append(f'unknown attempt queue time: {run["id"]}/{number}')
                queue = attempt.get('run_started_at') or now
                include = True
            else:
                include = relevant(attempt, queue)
            jobs = github.all(f'actions/runs/{run["id"]}/attempts/{number}/jobs', 'jobs')
            logs = {}
            summaries = {}
            for job in jobs:
                check = github.get(f'check-runs/{job["id"]}')
                summaries[str(job['id'])] = check['output'].get('summary')
                if job['status'] == 'completed' and job['conclusion'] != 'skipped':
                    logs[str(job['id'])] = github.get(f'actions/jobs/{job["id"]}/logs', binary=True).decode('utf-8')
            group['attempts'].append({'run_id': run['id'], 'run_attempt': number, 'event': run['event'],
                                      'created_at': run['created_at'], 'queued_at': queue,
                                      'attempt': attempt, 'jobs': jobs, 'logs': logs, 'summaries': summaries, 'in_window': include, 'queue_source': queue_source})
    evidence['unresolved_ownership'] = []
    for identity, chain in claims.items():
        if identity in identities or not chain:
            continue
        touches_window = any(timestamp(START) <= timestamp(entry['at']) < timestamp(END) for entry in chain)
        unresolved_carry = timestamp(chain[-1]['at']) < timestamp(END) and chain[-1]['state']['phase'] in ('dispatch', 'rerun')
        if touches_window or unresolved_carry:
            evidence['unresolved_ownership'].append({'identity': list(identity), 'ownership': chain})
            evidence['errors'].append(f'ownership has no resolved matching run: {identity}')
    for identity, group in identities.items():
        if not any(row['in_window'] for row in group['attempts']) and not any(timestamp(START) <= timestamp(run['created_at']) < timestamp(END) for run in group['runs']):
            continue
        group['artifacts'] = []
        for run in group['runs']:
            artifacts = github.all(f'actions/runs/{run["id"]}/artifacts', 'artifacts')
            group['artifacts'].extend(artifacts)
            for row in group['attempts']:
                if row['run_id'] != run['id']:
                    continue
                for job in row['jobs']:
                    names = (f'job-summary-{job["id"]}-attempt-{row["run_attempt"]}',
                             f'{job["name"].split(" / ")[-1]}-summary' if row['run_attempt'] == 1 and run['run_attempt'] == 1 else '')
                    matches = [artifact for artifact in artifacts if artifact['name'] in names]
                    if len(matches) > 1 or any(artifact['expired'] for artifact in matches):
                        evidence['errors'].append(f'ambiguous/expired summary artifact: {run["id"]}/{row["run_attempt"]}/{job["id"]}')
                    elif matches:
                        archive = github.get(f'actions/artifacts/{matches[0]["id"]}/zip', binary=True)
                        with zipfile.ZipFile(io.BytesIO(archive)) as contents:
                            files = [name for name in contents.namelist() if name.endswith('summary.md')]
                            if len(files) != 1:
                                raise ValueError('summary artifact has no unique summary.md')
                            row['summaries'][str(job['id'])] = contents.read(files[0]).decode('utf-8')
        group['comments'] = github.all(f'issues/{identity[1]}/comments')
        group['pr'] = github.get(f'pulls/{identity[1]}')
        # Effective branch rules are readable without administration authority.
        group['gates'] = github.get('rules/branches/main')
        # Workflow at the original event SHA is immutable. Never infer compatibility from today's main.
        group['definitions'] = {str(run['id']): github.get(
            f'contents/.github/workflows/fix.yml?ref={run["head_sha"]}') for run in group['runs']}
        group['branch_definitions'] = {str(run['id']): github.get(
            f'contents/.github/workflows/fix-branch.yml?ref={run["head_sha"]}') for run in group['runs']}
        group['build_definition'] = github.get(f'contents/.github/workflows/build-issue.yml?ref={commit}')
        evidence['identities'].append(group)
    return evidence


def outcome(result, reason, sources=()):
    return {'result': result, 'reason': reason, 'sources': list(sources)}


def assess(evidence):
    """Derive criteria from retained native job logs, immutable claim history and PR records."""
    results = {name: outcome('incomplete', 'required live example or proof absent') for name in CRITERIA}
    errors = list(evidence['errors'])
    counts = []
    admitted = []
    rejection = []
    retry = []
    accounting_errors = []
    gate_errors = []
    violations = []
    for group in evidence['identities']:
        identity = group['identity']
        chain = group['ownership']
        comments = [comment for comment in group['comments'] if comment['user']['login'] == 'github-actions[bot]']
        dispatches = {run['id'] for run in group['runs'] if run['event'] == 'workflow_dispatch' and
                      timestamp(START) <= timestamp(run['created_at']) < timestamp(END)}
        previous = {run['id'] for run in group['runs'] if run['event'] == 'workflow_dispatch' and timestamp(run['created_at']) < timestamp(START)}
        direct = {run['id'] for run in group['runs'] if run['event'] == 'workflow_run'}
        adopted = {entry['state'].get('run') for entry in chain if entry['state'].get('run') in direct and
                   entry['state']['phase'] == 'owned' and timestamp(entry['at']) < timestamp(END)}
        counts.append({'identity': identity, 'window_dispatches': sorted(dispatches),
                       'earlier_dispatches': sorted(previous), 'workflow_run_triggers': sorted(direct),
                       'adopted_owners': sorted(adopted), 'attempts': [], 'worked': 0, 'counted': 0,
                       'nopush': 0, 'conflict': 0, 'refresh': 0, 'infrastructure': 0})
        tally = counts[-1]
        adopted_before_dispatch = any(entry['state'].get('run') in adopted and
                                      timestamp(entry['at']) <= timestamp(run['created_at'])
                                      for entry in chain for run in group['runs'] if run['id'] in dispatches)
        if len(dispatches) > 1 or dispatches and (previous or adopted_before_dispatch):
            violations.append(str(identity))
        if any(entry['state']['phase'] in ('dispatch', 'rerun') and timestamp(entry['at']) < timestamp(END) for entry in chain[-1:]):
            errors.append(f'unresolved delivery: {identity}')
        if not chain:
            errors.append(f'missing ownership: {identity}')
        if group['pr']['base']['ref'] != 'main' or group['pr']['head']['repo']['full_name'] != identity[0]:
            gate_errors.append(f'PR is not a same-repository main Builder PR: {identity}')
        for row in group['attempts']:
            if not row.get('in_window', True):
                continue
            pair = (row['run_id'], row['run_attempt'])
            source = f'https://github.com/{identity[0]}/actions/runs/{pair[0]}/attempts/{pair[1]}'
            log = '\n'.join(row['logs'].values()) + '\n' + '\n'.join(value for value in row['summaries'].values() if value)
            if not any(row['summaries'].values()) and any(job['conclusion'] != 'skipped' for job in row['jobs']):
                errors.append(f'admission/branch summaries inaccessible: {source}')
            attempt = row['attempt']
            jobs = row['jobs']
            item = {'run_id': pair[0], 'run_attempt': pair[1], 'source': source,
                    'event': row['event'], 'created_at': row['created_at'], 'queued_at': row['queued_at'],
                    'queue_source': row.get('queue_source', 'native attempt creation'),
                    'started_at': attempt.get('run_started_at'), 'ended_at': attempt['updated_at'],
                    'conclusion': attempt['conclusion']}
            tally['attempts'].append(item)
            if attempt['status'] != 'completed' or any(job['status'] != 'completed' for job in jobs):
                errors.append(f'unfinished attempt: {source}')
            branches = [job for job in jobs if job['name'] == 'branch']
            accepted = f'Fix owner: run {pair[0]}, run_attempt {pair[1]}.' in log
            rejected = re.search(rf'Skip fix: PR #{identity[1]}, cause {identity[2]}, head `{identity[3]}` already held by run ([0-9]+)\.', log)
            acquired = re.search(r'Fix acquired branch `(build/[^`]+)`', log)
            item.update(admitted=accepted, rejection=rejected.group(0) if rejected else None,
                        holder=int(rejected[1]) if rejected else None,
                        branch=acquired[1] if acquired else None)
            if not branches:
                errors.append(f'missing admission job: {source}')
            elif branches[0]['conclusion'] == 'skipped':
                item['admission'] = 'skipped trigger'
                continue
            elif not accepted and not rejected:
                errors.append(f'unproved admission: {source}')
            if rejected:
                holder = next((r for r in group['attempts'] if r['run_id'] == int(rejected[1]) and
                               timestamp(r['queued_at']) <= timestamp(branches[0]['started_at']) <
                               timestamp(r['attempt']['updated_at'])), None)
                if holder and not acquired and not any(j['name'] != 'branch' and j['conclusion'] != 'skipped' for j in jobs):
                    rejection.append(source)
                else:
                    errors.append(f'duplicate holder/queue proof missing: {source}')
            if not accepted:
                continue
            branch_definition = base64.b64decode(group['branch_definitions'][str(pair[0])]['content']).decode()
            build_definition = base64.b64decode(group['build_definition']['content']).decode()
            if ('group: branch-${{ inputs.branch }}' not in branch_definition or
                    'cancel-in-progress: false' not in branch_definition or
                    'group: branch-build/${{ inputs.slug }}' not in build_definition or
                    'cancel-in-progress: false' not in build_definition):
                errors.append(f'branch lock definition unproved: {source}')
            if not acquired or not group['pr']['head']['ref'].startswith('build/'):
                errors.append(f'missing branch exclusion evidence: {source}')
            item['branch_interval'] = [next((job['started_at'] for job in jobs if job['name'].endswith('/ task')), None),
                                       attempt['updated_at']]
            if not item['branch_interval'][0]:
                errors.append(f'missing task interval: {source}')
            admitted.append((identity, row, item))
            states = [entry['state'] for entry in chain if entry['state'].get('run') == pair[0]]
            completions = [state for state in states if state.get('completions', {}).get(str(pair[1])) == 'done']
            worked = completions[-1].get('worked', {}).get(str(pair[1])) if completions else None
            item['worked'] = worked
            item['jobs'] = [{key: job[key] for key in ('id', 'name', 'conclusion', 'started_at', 'completed_at')}
                            for job in jobs]
            markers = []
            for comment in comments:
                body = comment['body']
                # Original attempt-one URLs are accepted only for attempt one, never every rerun.
                urls = [source] + ([source.removesuffix('/attempts/1')] if pair[1] == 1 else [])
                if any(f'Fix run {url} ' in body for url in urls):
                    for marker, kind in (('fix-attempt', 'counted'), ('fix-nopush', 'nopush'),
                                         ('fix-conflict', 'conflict'), ('fix-refresh', 'refresh')):
                        if re.search(r'<!-- ' + marker + r'(?: | -->)', body):
                            markers.append((comment['id'], kind))
            kinds = {kind for _, kind in markers}
            if worked is None:
                # A failed/refused task never reaches completion; retained logs must prove the refusal.
                if not any('Run Codex' == step['name'] and step['conclusion'] != 'skipped'
                           for job in jobs for step in job.get('steps', [])) and ('No fix model started.' in log or
                                                                                  'HTTP 403' in log):
                    worked = False
                    item['worked'] = False
                else:
                    accounting_errors.append(f'unknown tool use/completion: {source}')
            previous_counted = [c for c in comments if c['body'].startswith('<!-- fix-attempt -->') and
                                c['created_at'] < (item['branch_interval'][0] or row['queued_at'])]
            if worked and len(previous_counted) >= 3 and not kinds & {'conflict', 'refresh', 'nopush'}:
                accounting_errors.append(f'fourth counted model attempt: {source}')
            if worked and not any(step['name'] == 'Run Codex' and step['conclusion'] != 'skipped'
                                  for job in jobs for step in job.get('steps', [])):
                accounting_errors.append(f'worked completion has no model execution: {source}')
            if worked:
                tally['worked'] += 1
                if len(markers) != 1:
                    accounting_errors.append(f'missing/duplicate accounting: {source}')
                else:
                    kind = markers[0][1]
                    tally[kind] += 1
                    item['accounting'] = kind
                    if kind == 'conflict' and identity[2] != 'conflict':
                        accounting_errors.append(f'conflict-only exemption on another cause: {source}')
                    if kind == 'refresh' and identity[2] not in ('check', 'rules'):
                        accounting_errors.append(f'refresh exemption on another cause: {source}')
            elif kinds:
                accounting_errors.append(f'unworked attempt has accounting: {source}')
            if pair[1] > 1:
                pending = [entry for entry in chain if entry['state']['phase'] == 'rerun' and
                           entry['state'].get('run') == pair[0] and entry['state'].get('attempt') == pair[1] - 1]
                previous_attempt = next((r for r in group['attempts'] if r['run_id'] == pair[0] and
                                         r['run_attempt'] == pair[1] - 1), None)
                definition = base64.b64decode(group['definitions'][str(pair[0])]['content']).decode()
                if (len(pending) == 1 and pending[0]['state'].get('task', {}).get('kind') == 'eligible' and
                        previous_attempt and previous_attempt['attempt']['status'] == 'completed' and
                        timestamp(previous_attempt['attempt']['updated_at']) <= timestamp(row['queued_at']) and
                        '# L82 retry-contract: 1' in definition and acquired and
                        any(state.get('task', {}).get('kind') == 'eligible' and
                            state.get('task', {}).get('attempt') == pair[1] for state in states)):
                    retry.append(source)
                else:
                    item['retry'] = 'eligibility/head/workflow checks not proved'
            maximum = max([state.get('infrastructure', 0) for state in states] or [0])
            tally['infrastructure'] = max(tally['infrastructure'], maximum)
            if maximum > 6:
                accounting_errors.append(f'infrastructure limit exceeded: {source}')
        # PR-wide budgets include earlier causes/heads, not only this group's window counts.
        for marker, limit in (('fix-attempt', 3), ('fix-conflict', 3)):
            total = len([c for c in comments if c['body'].startswith(f'<!-- {marker}')])
            if total > limit:
                accounting_errors.append(f'PR {identity[1]} exceeds {marker} limit')
        for head in {identity[3]}:
            if len([c for c in comments if c['body'].startswith(f'<!-- fix-nopush {head} -->')]) > 1:
                accounting_errors.append(f'repeated first no-push exemption: {identity}')
        required = {check['context'] for rule in group['gates'] if rule['type'] == 'required_status_checks'
                    for check in rule['parameters']['required_status_checks']}
        if not {'check', 'rules', 'review', 'critic'} <= required:
            gate_errors.append(f'missing required gates: PR {identity[1]}')
    overlap = []
    branch_overlap = []
    for index, (identity, row, item) in enumerate(admitted):
        for other_identity, other, other_item in admitted[index + 1:]:
            if timestamp(row['queued_at']) < timestamp(other['attempt']['updated_at']) and timestamp(other['queued_at']) < timestamp(row['attempt']['updated_at']):
                if identity == other_identity:
                    overlap.append(item['source'])
            left, right = item['branch_interval'], other_item['branch_interval']
            if item['branch'] == other_item['branch'] and left[0] and right[0] and left[0] < right[1] and right[0] < left[1]:
                branch_overlap.append(item['source'])
    results['complete bounded evidence'] = outcome('incomplete' if errors else 'pass', '; '.join(errors) or 'all bounded reads and attempts retained')
    results['literal dispatch count'] = outcome('fail' if violations else 'incomplete' if errors else 'pass',
                                                '; '.join(violations) or 'window dispatch counts separate from prior ownership')
    results['live exclusion'] = outcome('fail' if overlap or branch_overlap else 'incomplete' if errors or not admitted else 'pass',
                                       '; '.join(overlap + branch_overlap) or 'identity and branch intervals reconciled')
    results['duplicate rejection'] = outcome('fail' if overlap else 'pass' if rejection else 'incomplete', 'live holder and pre-queue rejection required', rejection)
    results['eligible sequential retry'] = outcome('pass' if retry else 'incomplete', 'same-run higher-attempt fresh eligibility required', retry)
    head_examples = [(a[2]['source'], b[2]['source']) for a in admitted for b in admitted if a[0][:3] == b[0][:3] and a[0][3] != b[0][3]]
    cause_examples = [(a[2]['source'], b[2]['source']) for a in admitted for b in admitted if a[0][:2] == b[0][:2] and a[0][3] == b[0][3] and a[0][2] != b[0][2]]
    results['distinct identities'] = outcome('pass' if head_examples and cause_examples else 'incomplete',
                                            'both full-head and cause examples required', head_examples[:1] + cause_examples[:1])
    results['worked-attempt accounting and limits'] = outcome('incomplete' if accounting_errors or errors or not admitted else 'pass',
                                                             '; '.join(accounting_errors) or 'PR-wide accounting reconciled')
    results['required gates'] = outcome('fail' if gate_errors else 'incomplete' if not counts else 'pass',
                                       '; '.join(gate_errors) or 'check/rules/review/critic required; observer has no gate authority')
    for item in counts:
        item['raw_dispatch_count'] = len(item['window_dispatches'])
        item['run_attempt_count'] = len(item['attempts'])
    return {'criteria': results, 'counts': counts, 'result': 'fail' if any(r['result'] == 'fail' for r in results.values()) else
            'pass' if all(r['result'] == 'pass' for r in results.values()) else 'incomplete'}


def report(evidence, result):
    lines = ['# L82 post-1452 six-hour window', f'`[{START}, {END})` UTC. Result: **{result["result"]}**.',
             f'Collector `{evidence["collector_commit"]}`, run {evidence["run_id"]}, attempt {evidence["run_attempt"]}, '
             f'collected {evidence["collected_at"]}.',
             f'Historical [{HISTORICAL["artifact"]}]({HISTORICAL["url"]}): **fail**, 48 dispatches, eight repeated identities; '
             f'`[{HISTORICAL["start"]}, {HISTORICAL["end"]})` UTC.',
             '| Criterion | Result | Evidence |', '| --- | --- | --- |']
    for name, item in result['criteria'].items():
        lines.append(f'| {name} | {item["result"]} | {item["reason"].replace("|", "/")} {json.dumps(item["sources"])} |')
    lines += ['', 'Raw dispatch counts and worked/counted/exempt attempts are separate in counts.json.',
              '#1350 owns independent validation and the reviewed evidence PR. No Issue is closed by this collector.',
              'Before expiry preserve the complete new artifact and historical artifact through a reviewed repository evidence PR; '
              'a link alone does not preserve contents. Any missing/unobserved criterion leaves #1290/#1350 open.']
    return '\n\n'.join(lines[:4]) + '\n\n' + '\n'.join(lines[4:]) + '\n'


def retain(directory, evidence, result):
    for name, value in (('evidence.json', evidence), ('counts.json', result['counts']), ('results.json', result)):
        (directory / name).write_text(json.dumps(value, indent=2))
    (directory / 'report.md').write_text(report(evidence, result))
    deadline = timestamp(evidence['collected_at']) + timedelta(days=90)
    historical_expiry = evidence.get('historical_artifact', {}).get('expires_at')
    if historical_expiry:
        deadline = min(deadline, timestamp(historical_expiry))
    (directory / 'preservation.json').write_text(json.dumps({
        'owner_issue': 1350, 'minimum_retention_days': 90,
        'preserve_by': utc(deadline),
        'reviewed_pr_required': True, 'complete_contents_required': True,
        'artifacts': ['this complete artifact', HISTORICAL['url']]}, indent=2))
    manifest = {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(directory.rglob('*')) if path.is_file() and path.name != 'manifest.json'}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2))


def publish(github, directory, artifact_id):
    manifest = json.loads((directory / 'manifest.json').read_text())
    for name in ('report.md', 'evidence.json', 'reads.json', 'counts.json', 'results.json', 'preservation.json'):
        if name not in manifest:
            raise ValueError('required retained file absent')
    for name, digest in manifest.items():
        path = directory / name
        if path.resolve().is_relative_to(directory.resolve()) is False or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('retained evidence manifest does not match')
    evidence = json.loads((directory / 'evidence.json').read_text())
    if evidence['window'] != {'start': START, 'end': END}:
        raise ValueError('silent window substitution refused')
    window(evidence['collected_at'])
    reads = json.loads((directory / 'reads.json').read_text())
    if any(read['file'] not in manifest or manifest[read['file']] != read['sha256'] for read in reads):
        raise ValueError('raw read/page evidence missing from retained manifest')
    derived = assess(evidence)
    if derived != json.loads((directory / 'results.json').read_text()) or report(evidence, derived) != (directory / 'report.md').read_text():
        raise ValueError('publication results do not reconcile with retained evidence')
    artifact = github.object(f'actions/artifacts/{artifact_id}')
    if artifact['expired'] or artifact['name'] != f'l82-post-1452-{evidence["run_attempt"]}' or artifact['workflow_run']['id'] != evidence['run_id']:
        raise ValueError('publication requires this run’s completed evidence upload')
    if timestamp(artifact['expires_at']) - timestamp(artifact['created_at']) < timedelta(days=90):
        raise ValueError('publication requires at least 90 days retention')
    run = github.object(f'actions/runs/{evidence["run_id"]}')
    if run['head_branch'] != 'main' or run['head_sha'] != evidence['collector_commit'] or run['run_attempt'] != evidence['run_attempt']:
        raise ValueError('publication requires the pinned trusted main run/attempt')
    if run['path'] != '.github/workflows/fix-observer.yml' or run['event'] != 'workflow_dispatch':
        raise ValueError('publication requires the trusted non-model observer workflow')
    url = f'https://github.com/{github.repo}/actions/runs/{evidence["run_id"]}/artifacts/{artifact_id}'
    body = (directory / 'report.md').read_text() + f'\nComplete retained artifact: [{artifact_id}]({url}).\n'
    preservation = json.loads((directory / 'preservation.json').read_text())
    if timestamp(preservation['preserve_by']) > timestamp(artifact['expires_at']):
        raise ValueError('durable preservation deadline exceeds artifact expiry')
    body += f'\nDurable preservation deadline: {preservation["preserve_by"]}; #1350 owns the reviewed evidence PR before the earliest expiry.\n'
    # Complete validation and closure reads precede either write. Publication never closes or edits Issues.
    issues = [github.object(f'issues/{number}') for number in (1290, 1350)]
    if any(issue['state'] != 'open' for issue in issues):
        raise ValueError('canonical live Issues must remain open until independent evidence review')
    for number in (1290, 1350):
        github.write(f'issues/{number}/comments', {'body': body})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('collect', 'publish'))
    parser.add_argument('--repo', required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--artifact-id', type=int)
    args = parser.parse_args()
    try:
        if args.mode == 'collect':
            args.directory.mkdir(parents=True, exist_ok=False)
            now = utc(datetime.now(timezone.utc))
            github = GitHub(args.repo, args.directory)
            evidence = collect(github, now, os.environ['GITHUB_SHA'], int(os.environ['GITHUB_RUN_ID']),
                               int(os.environ['GITHUB_RUN_ATTEMPT']))
            result = assess(evidence)
            retain(args.directory, evidence, result)
        else:
            if not args.artifact_id:
                raise ValueError('publication requires the uploaded artifact id')
            publish(PublicationGitHub(args.repo), args.directory, args.artifact_id)
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        if args.mode == 'collect' and args.directory.is_dir():
            failed = {'window': {'start': START, 'end': END}, 'collected_at': utc(datetime.now(timezone.utc)),
                      'collector_commit': os.environ.get('GITHUB_SHA', 'unknown'),
                      'run_id': int(os.environ.get('GITHUB_RUN_ID', '0')),
                      'run_attempt': int(os.environ.get('GITHUB_RUN_ATTEMPT', '0')),
                      'repository': args.repo, 'historical': HISTORICAL, 'identities': [],
                      'errors': [f'required evidence read failed: {error}']}
            retain(args.directory, failed, assess(failed))
        print(f'L82 observer incomplete: {error}', file=sys.stderr)
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
