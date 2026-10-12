#!/usr/bin/env python3
"""L23/L82 live branch exclusion, dispatched only by the non-model observer."""
from datetime import datetime, timezone
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

MARKER = '<!-- l23-l82-observer -->'
ISSUE = 1322
COORDINATION = 'c09992956a68546729f0e057c4329cf6de26c639'


class GitHub:
    def __init__(self, repo):
        self.repo = repo

    def object(self, path):
        result = subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}'],
                                capture_output=True, text=True, check=True, timeout=90)
        return json.loads(result.stdout)

    def read(self, path, key=None):
        result = subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}', '--paginate', '--slurp'],
                                capture_output=True, text=True, check=True, timeout=180)
        return [row for page in json.loads(result.stdout) for row in (page[key] if key else page)]

    def write(self, path, body):
        subprocess.run(['gh', 'api', f'repos/{self.repo}/{path}', '-X', 'POST', '--input', '-'],
                       input=json.dumps(body), capture_output=True, text=True, check=True, timeout=90)

    def summary(self, run, name, directory):
        target = directory / name
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(['gh', 'run', 'download', str(run), '--repo', self.repo, '--name', name,
                        '--dir', str(target)], capture_output=True, text=True, check=True, timeout=180)
        return (target / 'summary.md').read_text()


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def assert_evidence(evidence):
    if not (timestamp(evidence['build_started_at']) <= timestamp(evidence['requested_at']) <
            timestamp(evidence['build_completed_at']) <= timestamp(evidence['fix_started_at'])):
        raise ValueError('dispatch must overlap the build; fix task must start after build completion')
    if evidence['observed_head'] != evidence['final_head']:
        raise ValueError('fix did not observe the final branch head')
    if evidence['model_started'] or evidence['attempts_after'] != evidence['attempts_before']:
        raise ValueError('observation started a model or counted a fix attempt')
    if not all(text in evidence['summary'] for text in
               ('Fix queued for branch', 'Fix acquired branch', 'Skip fix: the build or another writer moved the head')):
        raise ValueError('missing wait/acquisition/stale skip summary')


def attempts(api, pr):
    return [c['id'] for c in api.read(f'issues/{pr}/comments?per_page=100')
            if c['body'].startswith('<!-- fix-attempt -->')]


def observe(api, directory):
    directory.mkdir(parents=True, exist_ok=True)
    if any(api.object(f'issues/{issue}')['state'] != 'open' for issue in (ISSUE, 1288)):
        return
    comments = api.read(f'issues/{ISSUE}/comments?per_page=100')
    ledger = [json.loads(c['body'].split('\n', 1)[1]) for c in comments
              if c['user']['login'] == 'github-actions[bot]' and c['body'].startswith(MARKER + '\n')]
    state = ledger[-1] if ledger else None
    if state and state.get('result'):
        (directory / 'evidence.json').write_text(json.dumps(state, indent=2))
        return
    runs = api.read('actions/workflows/fix.yml/runs?event=workflow_dispatch&per_page=100', 'workflow_runs')
    if state is None:
        prs = api.read('pulls?state=open&per_page=100')
        builds = api.read('actions/workflows/build.yml/runs?status=in_progress&branch=main&per_page=100', 'workflow_runs')
        for build in builds:
            # Old in-flight workflows cannot demonstrate the shared branch group.
            comparison = api.object(f'compare/{COORDINATION}...{build["head_sha"]}')
            if comparison['status'] not in ('ahead', 'identical'):
                continue
            jobs = api.read(f'actions/runs/{build["id"]}/jobs?filter=latest&per_page=100', 'jobs')
            for job in jobs:
                match = re.fullmatch(r'build #(\d+) / build', job['name'])
                if not match or job['status'] != 'in_progress':
                    continue
                issue = api.object(f'issues/{match[1]}')
                key = re.search(r'^Key: ([a-z0-9-]+)$', issue['body'], re.M)
                candidates = [pr for pr in prs if key and pr['head']['ref'] == 'build/' + key[1]
                              and pr['head']['repo'] and pr['head']['repo']['full_name'] == api.repo]
                if len(candidates) != 1:
                    continue
                pr = candidates[0]
                state = {'build_run': build, 'build_job': job, 'pr': pr['number'],
                         'branch': pr['head']['ref'], 'initial_head': pr['head']['sha'],
                         'inputs': {'pr': str(pr['number']), 'head': '0' * 40, 'cause': 'check'},
                         'requested_at': datetime.now(timezone.utc).isoformat(),
                         'before': [r['id'] for r in runs], 'attempts_before': attempts(api, pr['number'])}
                # Intent precedes dispatch: unknown delivery never causes a second dispatch.
                api.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})
                (directory / 'intent.json').write_text(json.dumps(state, indent=2))
                api.write('actions/workflows/fix.yml/dispatches', {'ref': 'main', 'inputs': state['inputs']})
                return
        return
    (directory / 'intent.json').write_text(json.dumps(state, indent=2))
    matches = [run for run in runs if run['id'] not in state['before'] and
               timestamp(run['created_at']) >= timestamp(state['requested_at']).replace(microsecond=0) and
               run['display_title'] == f'Fix PR #{state["pr"]}: check']
    if len(matches) != 1:
        raise ValueError(f'dispatch delivery unknown: {len(matches)} matches; never redispatch')
    fix = matches[0]
    build_job = api.object(f'actions/jobs/{state["build_job"]["id"]}')
    jobs = api.read(f'actions/runs/{fix["id"]}/jobs?filter=latest&per_page=100', 'jobs')
    state.update(fix_run=fix, fix_jobs=jobs, build_final_job=build_job)
    (directory / 'pending.json').write_text(json.dumps(state, indent=2))
    if fix['status'] != 'completed' or build_job['status'] != 'completed':
        return
    try:
        task = next(job for job in jobs if job['name'] == 'fix / task')
        summary = api.summary(fix['id'], 'branch-queue-summary', directory) + api.summary(
            fix['id'], 'branch-task-summary', directory)
        observed = re.search(r'Observed head: `([0-9a-f]{40})`', summary)
        pr = api.object(f'pulls/{state["pr"]}')
        state.update(build_started_at=state['build_job']['started_at'],
                     build_completed_at=build_job['completed_at'], fix_started_at=task['started_at'],
                     final_head=pr['head']['sha'], observed_head=observed[1] if observed else None,
                     summary=summary, attempts_after=attempts(api, state['pr']),
                     model_started=any('/ fix #' in job['name'] and job['conclusion'] != 'skipped' for job in jobs))
        if fix['conclusion'] != 'success' or task['conclusion'] != 'success':
            raise ValueError('fix task or workflow failed')
        assert_evidence(state)
        state['result'] = 'pass'
    except (ValueError, StopIteration, subprocess.SubprocessError) as error:
        state.update(result='fail', error=str(error))
    state['evidence_run'] = f'https://github.com/{api.repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    (directory / 'evidence.json').write_text(json.dumps(state, indent=2))
    body = (f'L23/L82 live exclusion: {state["result"]}. Build: {state["build_run"]["html_url"]}; '
            f'fix: {fix["html_url"]}. Evidence: `branch-observer` artifact on {state["evidence_run"]}. '
            'Both Issues stay open until passing evidence is committed and independently reviewed.\n\n' +
            '```json\n' + json.dumps(state, indent=2) + '\n```')
    api.write('issues/1288/comments', {'body': body})
    api.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})
    if state['result'] != 'pass':
        raise ValueError(state['error'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    try:
        observe(GitHub(args.repo), args.directory)
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        args.directory.mkdir(parents=True, exist_ok=True)
        (args.directory / 'failure.txt').write_text(str(error))
        print(f'L23/L82 observer failed: {error}', file=sys.stderr)
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
