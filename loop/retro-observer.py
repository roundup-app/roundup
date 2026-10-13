#!/usr/bin/env python3
"""L106: observe diagnostic collection and live Retro publications outside the Builder."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import retro
import orders
from observer import GitHub as ObserverGitHub

MARKER = '<!-- l106-observer -->'
ISSUE = 1308


class GitHub(ObserverGitHub):
    def log(self, run, job):
        result = subprocess.run(['gh', 'run', 'view', str(run['id']), '--repo', self.repo,
                                 '--job', str(job['id']), '--log'],
                                capture_output=True, text=True, check=True, timeout=180)
        return '\n'.join(line for line in result.stdout.splitlines()
                         if 'Collect fixed-window input' in line)

    def input(self, run, directory):
        subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', self.repo,
                        '--name', 'retro-input', '--dir', str(directory)],
                       capture_output=True, text=True, check=True, timeout=180)
        return json.loads((directory / 'retro-input.json').read_text())


def observe(github, directory, recover_run=None):
    # Owner closure ends the observer too. Only this serialized, non-model job owns its ledger.
    if github.object(f'issues/{ISSUE}')['state'] != 'open':
        return
    comments = github.read(f'issues/{ISSUE}/comments?per_page=100')
    ledger = [json.loads(c['body'].split('\n', 1)[1]) for c in comments
              if c['user']['login'] == 'github-actions[bot]' and c['body'].startswith(MARKER + '\n')]
    state = ledger[-1] if ledger else {'dispatches': []}
    dispatches = state['dispatches']
    if len(dispatches) == 2 and dispatches[-1].get('report'):
        return
    runs = github.read('actions/workflows/retro.yml/runs?branch=main&event=workflow_dispatch&per_page=100',
                       'workflow_runs')
    if not dispatches or dispatches[-1].get('report'):
        # Record intent BEFORE dispatch. A timeout/crash leaves unknown delivery and never blindly retries.
        if dispatches:
            if datetime.now(timezone.utc).date() != retro.timestamp(dispatches[-1]['window']['end']).date():
                raise ValueError('same-date repeat window has elapsed; preserve first evidence and investigate')
            artifacts = github.read(f'actions/runs/{dispatches[-1]["evidence_run"]}/artifacts?per_page=100', 'artifacts')
            if not any(a['name'] == 'l106-observer' and not a['expired'] for a in artifacts):
                raise ValueError('first snapshot artifact is not preserved; do not dispatch repeat')
        entry = {'requested_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                 'before': [r['id'] for r in runs]}
        dispatches.append(entry)
        github.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})
        github.write('actions/workflows/retro.yml/dispatches', {'ref': 'main'})
        return
    entry = dispatches[-1]
    if 'run_id' not in entry:
        requested = retro.timestamp(entry['requested_at'])
        # Admission is bounded to this dispatch, not every later diagnostic dispatch.
        # Late or ambiguous delivery remains unknown; never choose the earliest candidate.
        matches = [r for r in runs if r['id'] not in entry['before'] and
                   r['actor']['login'] == 'github-actions[bot]' and
                   requested <= retro.timestamp(r['created_at']) <= requested + timedelta(minutes=5)]
        if len(matches) != 1:
            raise ValueError(f'dispatch delivery unknown: {len(matches)} matching runs; inspect intent, never redispatch')
        entry.update(run_id=matches[0]['id'], run=matches[0]['html_url'])
        github.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})
    run = github.object(f'actions/runs/{entry["run_id"]}')
    if run['status'] != 'completed':
        return
    if run['conclusion'] != 'success':
        if run['id'] == recover_run and run['conclusion'] == 'failure':
            entry['conclusion'] = run['conclusion']
            state.setdefault('failed_dispatches', []).append(entry)
            state['dispatches'] = []
            github.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})
            return
        raise ValueError(f'Retro failed: {run["html_url"]}; repeat requires successful publication')
    target = directory / str(run['id'])
    target.mkdir(parents=True, exist_ok=True)
    data = github.input(run, target)
    issues = github.read('issues?state=all&per_page=100')
    title = 'Retro ' + retro.timestamp(data['window']['end']).date().isoformat()
    reports = [i for i in issues if retro.is_report(i) and i['title'] == title]
    if len(reports) != 1:
        raise ValueError('expected exactly one dated Retro report')
    report = reports[0]
    (target / 'report.json').write_text(json.dumps(report, indent=2))
    (target / 'issues.json').write_text(json.dumps(issues, indent=2))
    published = retro.report_state(report)
    if published['window'] != data['window'] or published['numbers'] != data['numbers']:
        raise ValueError('report no longer matches this dispatch input; preserve evidence and investigate')
    if run['html_url'] not in report['body']:
        raise ValueError('report does not link the completed dispatch')
    if len(published['repairs']) > 3:
        raise ValueError('more than three daily repairs')
    predecessors = [i for i in issues if retro.is_report(i) and
                    re.fullmatch(r'Retro \d{4}-\d{2}-\d{2}', i['title']) and i['title'] < title]
    prior = max(predecessors, key=lambda i: i['title']) if predecessors else None
    if prior and (prior['state'] != 'closed' or prior.get('state_reason') != 'completed'):
        raise ValueError('predecessor was not closed as completed')
    if len(dispatches) == 2:
        first = dispatches[0]
        if first['report'] != report['html_url']:
            raise ValueError('repeat did not reuse the same-date report')
        if not set(first['repairs']).issubset(published['repairs']):
            raise ValueError('repeat lost earlier daily repairs')
    entry.update(run=run['html_url'], report=report['html_url'], window=data['window'],
                 repairs=published['repairs'], predecessor=prior['html_url'] if prior else None,
                 evidence_run=os.environ['GITHUB_RUN_ID'],
                 evidence=f'https://github.com/{github.repo}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "unknown")}')
    body = (f'L106 dispatch {len(dispatches)} → {entry["report"]}\n\n'
            f'Run: {entry["run"]}\n\n'
            f'Fixed window: `[{data["window"]["start"]}, {data["window"]["end"]})`.\n\n'
            f'Repairs: {", ".join(entry["repairs"]) or "none"}.\n\n'
            f'Predecessor: {entry["predecessor"] or "n/a"}.\n\n'
            f'Input, report and Issue snapshots: `l106-observer` artifact on {entry["evidence"]}.\n\n'
            'Independent metric counts and semantic repair matching remain pending on #1308; this is no acceptance claim.')
    github.write('issues/1265/comments', {'body': body})
    github.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})
    # End this tick so upload-artifact preserves the first report before a later tick starts the repeat.


COLLECTION_MARKER = '<!-- l106-collector-observer -->'


def observe_collection(github, directory):
    """Observe one dispatch per explicitly authorized Work Issue, serialized by build.yml."""
    if github.object('issues/1315')['state'] != 'open':
        return
    comments = github.read('issues/1315/comments?per_page=100')
    records = [json.loads(c['body'].split('\n', 1)[1]) for c in comments
               if c['user']['login'] == 'github-actions[bot]' and
               c['body'].startswith(COLLECTION_MARKER + '\n')]
    # Old unscoped records remain evidence; never relabel or reset their consumed intent.
    latest = {}
    for record in records:
        latest[record.get('work_order')] = record
    for issue in github.read('issues?state=open&per_page=100'):
        authorization = re.search(
            r'This work order authorizes one new diagnostic Retro on main after the terminal failure of run (\d+)\.',
            issue.get('body') or '')
        if not orders.work_issue(issue) or not authorization or issue['state'] != 'open':
            continue
        work_order, after_run = issue['number'], int(authorization[1])
        state = latest.get(work_order)
        if state and state.get('collected'):
            continue
        if state is None:
            if any(not r.get('collected') for r in latest.values()):
                raise ValueError('earlier collector delivery unresolved; never dispatch another intent')
            prior = [r for r in latest.values() if r.get('run_id') == after_run and
                     r.get('collected') and r.get('conclusion') == 'failure' and r.get('log')]
            if len(prior) != 1:
                raise ValueError('authorization needs recorded terminal collection failure')
        # Re-read closure at the write boundary, rather than trusting the list snapshot.
        if github.object(f'issues/{work_order}')['state'] != 'open':
            continue
        break
    else:
        return
    if state is None:
        runs = github.read('actions/workflows/retro.yml/runs?branch=main&event=workflow_dispatch&per_page=100',
                           'workflow_runs')
        state = {'work_order': work_order, 'after_run': after_run,
                 'requested_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                 'before': [r['id'] for r in runs],
                 'observer': f'https://github.com/{github.repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'}
        # Persist before the non-idempotent call. Even a lost response must never cause a retry.
        github.write('issues/1315/comments', {'body': COLLECTION_MARKER + '\n' + json.dumps(state)})
        github.write('actions/workflows/retro.yml/dispatches', {'ref': 'main'})
        return
    if 'run_id' not in state:
        runs = github.read('actions/workflows/retro.yml/runs?branch=main&event=workflow_dispatch&per_page=100',
                           'workflow_runs')
        matches = [r for r in runs if r['id'] not in state['before'] and
                   r['actor']['login'] == 'github-actions[bot]' and
                   retro.timestamp(r['created_at']) >= retro.timestamp(state['requested_at'])]
        if len(matches) != 1:
            raise ValueError(f'collector dispatch delivery unknown: {len(matches)} matching runs; never redispatch')
        run = matches[0]
        state.update(run_id=run['id'], run=run['html_url'])
        github.write('issues/1315/comments', {'body': COLLECTION_MARKER + '\n' + json.dumps(state)})
        github.write('issues/1315/comments', {'body': f'L106 diagnostic Retro: {state["run"]}\n\n'
                      f'Authorized main observer: {state["observer"]}. No publication acceptance claim.'})
    else:
        run = github.object(f'actions/runs/{state["run_id"]}')
    jobs = github.read(f'actions/runs/{run["id"]}/jobs?per_page=100', 'jobs')
    collected = [(job, step) for job in jobs for step in job['steps']
                 if step['name'] == 'Collect fixed-window input' and step['status'] == 'completed']
    if not collected:
        if run['status'] == 'completed':
            raise ValueError(f'collector step evidence missing: {state["run"]}; never redispatch')
        return
    if len(collected) != 1:
        raise ValueError('ambiguous collector step evidence; never redispatch')
    job, step = collected[0]
    artifacts = github.read(f'actions/runs/{run["id"]}/artifacts?per_page=100', 'artifacts')
    inputs = [a for a in artifacts if a['name'] == 'retro-input' and not a['expired']]
    # A successful step can precede artifact upload; revisit it without dispatching again.
    if step['conclusion'] == 'success' and not inputs and run['status'] != 'completed':
        return
    window = None
    if step['conclusion'] == 'success' and not inputs:
        raise ValueError('successful collector has no complete input artifact; never redispatch')
    if inputs and step['conclusion'] == 'success':
        target = directory / str(run['id'])
        target.mkdir(parents=True, exist_ok=True)
        window = github.input(run, target)['window']
    log = f'{job["html_url"]}#step:{step["number"]}:1'
    artifact_links = [f'{state["run"]}/artifacts/{a["id"]}' for a in inputs]
    failure = None
    if step['conclusion'] != 'success':
        if run['status'] != 'completed':
            return
        target = directory / str(run['id'])
        target.mkdir(parents=True, exist_ok=True)
        failure = github.log(run, job)
        if not failure.strip():
            raise ValueError('collector failure log unavailable; retain intent, never redispatch')
        (target / 'collector.log').write_text(failure)
    state.update(collected=True, failure=failure[-8000:] if failure else None, conclusion=step['conclusion'], log=log,
                 window=window, artifacts=artifact_links)
    interval = (f'`[{window["start"]}, {window["end"]})`' if window else
                'unavailable: collection produced no complete input; do not infer it from a subdivided read')
    body = (f'L106 diagnostic collection: {step["conclusion"]}.\n\n'
            f'Run: {state["run"]}\n\nDiagnostic log: {log}\n\n'
            f'Fixed window: {interval}.\n\n'
            f'retro-input: {", ".join(artifact_links) or "none"}.\n\n'
            'This records the dispatch prerequisite only. #1315 owns diagnosis, repair and complete input; '
            '#1308 owns ledger recovery, two publications and independent reconciliation.')
    if failure:
        body += '\n\nCollector failure (endpoint and cause retained):\n```text\n' + failure[-8000:] + '\n```'
    github.write('issues/1315/comments', {'body': body})
    github.write('issues/1315/comments', {'body': COLLECTION_MARKER + '\n' + json.dumps(state)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--collector', action='store_true')
    parser.add_argument('--recover-run', type=int, help='Work Issue authorizes recovery of this terminal failed dispatch only')
    args = parser.parse_args()
    try:
        if args.collector:
            observe_collection(GitHub(args.repo), args.directory)
        else:
            observe(GitHub(args.repo), args.directory, args.recover_run)
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f'L106 observer failed: {error}', file=sys.stderr)
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
