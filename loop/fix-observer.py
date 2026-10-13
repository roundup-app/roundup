#!/usr/bin/env python3
"""L82 bounded, non-model observation of fix dispatch and branch admission."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

from observer import GitHub as ObserverGitHub

START = '2026-10-13T00:53:38Z'
END = '2026-10-13T06:53:38Z'
MARKER = '<!-- l82-fix-observer -->'
TITLE = re.compile(r'Fix PR #(\d+): (check|rules|review|critic|conflict|unfinished|answered) @ ([0-9a-f]{40})')


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


class GitHub(ObserverGitHub):
    def summary(self, run, directory):
        target = directory / str(run['id'])
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', self.repo,
                        '--name', 'branch-queue-summary', '--dir', str(target)],
                       capture_output=True, text=True, check=True, timeout=180)
        return (target / 'summary.md').read_text()

    def close(self, issue):
        subprocess.run(['gh', 'api', f'repos/{self.repo}/issues/{issue}', '-X', 'PATCH',
                        '--input', '-'], input=json.dumps({'state': 'closed', 'state_reason': 'completed'}),
                       capture_output=True, text=True, check=True, timeout=180)


def collect(api, directory, now):
    if timestamp(now) <= timestamp(END):
        return None
    comments = api.read('issues/1290/comments?per_page=100')
    if any(c['user']['login'] == 'github-actions[bot]' and c['body'].startswith(MARKER) and
           'Final collection: True' in c['body'] for c in comments):
        return None
    directory.mkdir(parents=True, exist_ok=True)
    result = {'start': START, 'end': END, 'collected_at': now, 'runs': [], 'identities': [], 'errors': []}
    errors = result['errors']
    # GitHub caps filtered workflow searches at 1000; never claim a truncated window is complete.
    path = f'actions/workflows/fix.yml/runs?created={START}..{END}&per_page=100'
    count = api.object(path)['total_count']
    if count >= 1000:
        errors.append('GitHub search limit reached; collection is incomplete')
    runs = api.read(path, 'workflow_runs')
    if len(runs) != count or len({r['id'] for r in runs}) != count:
        errors.append('Paginated run count differs from total_count or includes duplicate ids')
    groups = {}
    for run in runs:
        row = {key: run.get(key) for key in ('id', 'html_url', 'display_title', 'event', 'created_at',
                                            'run_started_at', 'updated_at', 'status', 'conclusion', 'run_attempt')}
        result['runs'].append(row)
        if not row['created_at'] or not timestamp(START) <= timestamp(row['created_at']) <= timestamp(END):
            errors.append(f'Run {run["id"]}: outside bounded window')
            continue
        match = TITLE.fullmatch(run['display_title'])
        identity = match.groups() if match else None
        if identity:
            groups.setdefault(identity, []).append(row)
        try:
            jobs = api.read(f'actions/runs/{run["id"]}/jobs?filter=latest&per_page=100', 'jobs')
            row['jobs'] = jobs
            completed = [job['completed_at'] for job in jobs if job.get('completed_at')]
            row['completed_at'] = max(completed) if completed else (run.get('updated_at') if run['status'] == 'completed' else None)
            row['completion_source'] = 'last job completed_at' if completed else 'workflow updated_at'
            if jobs and all(job['conclusion'] == 'skipped' for job in jobs) and run['event'] == 'workflow_run':
                row['admission'] = 'not applicable: workflow trigger skipped before admission'
                continue
            if not identity:
                raise ValueError('missing PR/cause/full head in title')
            row['summary'] = api.summary(run, directory)
            branch = next(job for job in jobs if job['name'] == 'branch')
            step = next(step for step in branch['steps'] if step['name'].startswith('Run trap '))
            row['admission_at'] = step['completed_at']
            if (run['status'] != 'completed' or not run['conclusion'] or run.get('run_attempt', 1) != 1 or
                    not row['admission_at'] or step['conclusion'] != 'success'):
                raise ValueError('unfinished, rerun or failed admission evidence')
            queued = 'Fix queued for branch `' in row['summary']
            reject = re.search(rf'Skip fix: PR #{identity[0]}, cause {identity[1]}, head '
                               rf'`{identity[2]}` already held by run (\d+)\.', row['summary'])
            fix_jobs = [job for job in jobs if job['name'].startswith('fix /') and job['conclusion'] != 'skipped']
            if queued and not reject:
                row['admission'] = 'admitted'
                # The summary has no line timestamp: bound queue entry by the admission step's start.
                row['queued_at'] = step['started_at']
                if not row['queued_at']:
                    raise ValueError('missing admission step start')
                if not fix_jobs or any(not j.get('completed_at') for j in fix_jobs):
                    raise ValueError('missing completed branch fix jobs')
                row['live_until'] = max(j['completed_at'] for j in fix_jobs)
                if timestamp(row['live_until']) < timestamp(row['queued_at']):
                    raise ValueError('branch completion precedes admission')
            elif reject and not queued and not fix_jobs:
                row['admission'] = 'rejected'
                row['held_by'] = int(reject[1])
            else:
                raise ValueError('missing unambiguous admission or duplicate rejection before branch queue')
        except (StopIteration, ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
            row['evidence_error'] = str(error) or 'missing admission job/step'
            errors.append(f'Run {run["id"]}: {row["evidence_error"]}')
    for identity, rows in sorted(groups.items()):
        admitted = [r for r in rows if r.get('admission') == 'admitted' and 'evidence_error' not in r]
        rejected = [r for r in rows if r.get('admission') == 'rejected' and 'evidence_error' not in r]
        overlaps = []
        for i, first in enumerate(admitted):
            for second in admitted[i + 1:]:
                if max(timestamp(first['queued_at']), timestamp(second['queued_at'])) < min(
                        timestamp(first['live_until']), timestamp(second['live_until'])):
                    overlaps.append([first['id'], second['id']])
        for row in rejected:
            holders = [r for r in admitted if r['id'] == row['held_by'] and r['id'] < row['id'] and
                       timestamp(r['created_at']) <= timestamp(row['admission_at']) <= timestamp(r['live_until'])]
            if not holders:
                errors.append(f'Run {row["id"]}: rejection holder has no admitted live evidence')
        if overlaps:
            errors.append(f'Identity {identity}: overlapping admitted runs {overlaps}')
        result['identities'].append({'pr': identity[0], 'cause': identity[1], 'head': identity[2],
                                     'raw_runs': len(rows), 'raw_dispatches': sum(r['event'] == 'workflow_dispatch' for r in rows),
                                     'admitted': len(admitted), 'rejected': len(rejected), 'overlaps': overlaps,
                                     'run_ids': [r['id'] for r in rows]})
    admitted_identities = [g for g in result['identities'] if g['admitted']]
    result['criteria'] = {
        'complete_evidence': not errors,
        'at_most_one_admitted_live': not any(g['overlaps'] for g in result['identities']) and not errors,
        'duplicate_rejection_observed': any(g['rejected'] for g in result['identities']) and not errors,
        'distinct_heads_admitted': any(a['pr'] == b['pr'] and a['cause'] == b['cause'] and a['head'] != b['head']
                                      for a in admitted_identities for b in admitted_identities),
        'distinct_causes_admitted': any(a['pr'] == b['pr'] and a['head'] == b['head'] and a['cause'] != b['cause']
                                       for a in admitted_identities for b in admitted_identities),
        'literal_dispatch_count': bool(groups) and all(g['raw_runs'] <= 1 for g in result['identities']),
    }
    result['result'] = 'pass' if all(result['criteria'].values()) else 'fail'
    (directory / 'evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    lines = [f'L82 six-hour fix observation: {result["result"]}.', f'Window: {START} through {END}.',
             'Raw repeats remain failures of #1290’s literal dispatch-count observer, even when admission rejects them.',
             '', '| PR | Cause | Full head | Raw runs | Dispatches | Admitted | Rejected |',
             '|---|---|---|---:|---:|---:|---:|']
    lines += [f'| #{g["pr"]} | {g["cause"]} | `{g["head"]}` | {g["raw_runs"]} | {g["raw_dispatches"]} | '
              f'{g["admitted"]} | {g["rejected"]} |' for g in result['identities']]
    lines += ['', 'Criteria:'] + [f'- {key}: {value}' for key, value in result['criteria'].items()]
    lines += ['', 'Evidence failures:'] + [f'- {error}' for error in errors]
    lines += ['', 'Runs (full jobs and admission summaries in evidence.json):']
    lines += [f'- [{r["id"]}]({r["html_url"]}): created {r["created_at"]}; started {r["run_started_at"]}; '
              f'ended {r.get("completed_at", "unknown")}; {r["conclusion"]}; {r.get("admission", "unknown")}.'
              for r in result['runs']]
    (directory / 'report.md').write_text('\n'.join(lines) + '\n')
    return result


def publish(api, directory, artifact_url):
    if not (directory / 'evidence.json').exists():
        failure = directory / 'failure.txt'
        if failure.exists():
            body = f'L82 six-hour collection failed: {failure.read_text()}. Evidence: {artifact_url}. Both Issues stay open.'
            for issue in (1290, 1350):
                api.write(f'issues/{issue}/comments', {'body': body})
        return
    evidence = json.loads((directory / 'evidence.json').read_text())
    if evidence['start'] != START or evidence['end'] != END or timestamp(evidence['collected_at']) <= timestamp(END):
        raise ValueError('cannot publish an incomplete window')
    comments = api.read('issues/1290/comments?per_page=100')
    if any(c['body'].startswith(MARKER) and c['user']['login'] == 'github-actions[bot]' and
           'Final collection: True' in c['body'] for c in comments):
        return
    body = (MARKER + '\n' + f'Full six-hour report and per-identity counts: [fix-observer artifact]({artifact_url}).\n\n' +
            f'Result: {evidence["result"]}. Final collection: {evidence["criteria"]["complete_evidence"]}.\n' +
            '\n'.join(f'- {key}: {value}' for key, value in evidence['criteria'].items()) +
            '\n\nRaw dispatch repeats remain visible in report.md and evidence.json. '
            'A rejected race does not pass the literal dispatch-count criterion. '
            'Both Issues remain open unless every criterion passes.')
    api.write('issues/1290/comments', {'body': body})
    api.write('issues/1350/comments', {'body': body})
    if evidence['result'] == 'pass' and all(evidence['criteria'].values()) and not evidence['errors']:
        api.close(1290)
        api.close(1350)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--publish', metavar='ARTIFACT_URL')
    args = parser.parse_args()
    try:
        api = GitHub(args.repo)
        if args.publish:
            publish(api, args.directory, args.publish)
        else:
            collect(api, args.directory, datetime.now(timezone.utc).isoformat())
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        args.directory.mkdir(parents=True, exist_ok=True)
        (args.directory / 'failure.txt').write_text(str(error))
        print(f'L82 fix observer failed: {error}', file=sys.stderr)
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
