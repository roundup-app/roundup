#!/usr/bin/env python3
"""L107: workflow-owned Care dispatch; #1338 owns publication acceptance."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

import care
from observer import GitHub as ObserverGitHub

MARKER = '<!-- l107-observer -->'
ISSUE = 1385


class GitHub(ObserverGitHub):
    def collect(self, run, directory):
        artifacts = self.read(f'actions/runs/{run["id"]}/artifacts?per_page=100', 'artifacts')
        (directory / 'artifacts.json').write_text(json.dumps(artifacts, indent=2))
        if any(not a['expired'] for a in artifacts):
            subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', self.repo,
                            '--dir', str(directory)], capture_output=True, text=True,
                           check=True, timeout=180)
        result = subprocess.run(['gh', 'run', 'view', str(run['id']), '--repo', self.repo, '--log'],
                                capture_output=True, text=True, check=True, timeout=180)
        (directory / 'run.log').write_text(result.stdout)


def observe(github, directory, repeat=False):
    authority = github.object(f'issues/{ISSUE}')
    if (authority['state'] != 'open' and authority.get('state_reason') != 'completed' or
            github.object('issues/1338')['state'] != 'open'):
        return
    records = [json.loads(c['body'].split('\n', 1)[1])
               for c in github.read(f'issues/{ISSUE}/comments?per_page=100')
               if c['user']['login'] == 'github-actions[bot]' and c['body'].startswith(MARKER + '\n')]
    if not records and authority['state'] != 'open':
        return
    state = records[-1] if records else {'dispatches': []}
    entries = state['dispatches']
    if repeat and not (len(entries) == 1 and entries[0].get('terminal') and
                       entries[0]['conclusion'] == 'success'):
        return

    def save():
        github.write(f'issues/{ISSUE}/comments', {'body': MARKER + '\n' + json.dumps(state)})

    if entries and entries[-1].get('terminal'):
        if entries[-1]['conclusion'] != 'success' or len(entries) == 2:
            return
        first = entries[0]
        if datetime.now(timezone.utc).date().isoformat() != first['date']:
            raise ValueError('same-date repeat elapsed; preserve evidence, never reset intent')
        artifacts = github.read(f'actions/runs/{first["evidence_run"]}/artifacts?per_page=100', 'artifacts')
        if not any(a['name'] == 'l107-observer' and not a['expired'] for a in artifacts):
            raise ValueError('first evidence artifact unavailable; do not repeat')
    if not entries or entries[-1].get('terminal'):
        runs = github.read('actions/workflows/care.yml/runs?branch=main&event=workflow_dispatch&per_page=100',
                           'workflow_runs')
        entries.append({'requested_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                        'before': [r['id'] for r in runs],
                        'observer': f'https://github.com/{github.repo}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "unknown")}'})
        save()
        github.write('actions/workflows/care.yml/dispatches', {'ref': 'main'})
        return
    entry = entries[-1]
    if 'run_id' not in entry:
        runs = github.read('actions/workflows/care.yml/runs?branch=main&event=workflow_dispatch&per_page=100',
                           'workflow_runs')
        matches = [r for r in runs if r['id'] not in entry['before'] and
                   r['actor']['login'] == 'github-actions[bot]' and r['head_branch'] == 'main' and
                   datetime.fromisoformat(r['created_at'].replace('Z', '+00:00')) >=
                   datetime.fromisoformat(entry['requested_at'])]
        if len(matches) != 1:
            raise ValueError(f'dispatch delivery unknown: {len(matches)} matches; never redispatch')
        run = matches[0]
        entry.update(run_id=run['id'], run=run['html_url'], sha=run['head_sha'])
        save()
        github.write('issues/1338/comments', {'body': f'L107 authorized main dispatch: {entry["run"]}\n\nSHA: `{entry["sha"]}`. Dispatch evidence only; publication acceptance remains pending.'})
        github.write(f'issues/{ISSUE}/comments', {'body': f'Authorized main Care run: {entry["run"]}\n\nSHA: `{entry["sha"]}`. #1338 owns collector repairs and full acceptance.'})
    else:
        run = github.object(f'actions/runs/{entry["run_id"]}')
    if run['status'] != 'completed':
        return
    target = directory / str(run['id'])
    target.mkdir(parents=True, exist_ok=True)
    # Snapshot run/jobs even if artifact or log retrieval fails. Keep intent pinned for a later collection tick.
    (target / 'run.json').write_text(json.dumps(run, indent=2))
    jobs = github.read(f'actions/runs/{run["id"]}/jobs?per_page=100', 'jobs')
    (target / 'jobs.json').write_text(json.dumps(jobs, indent=2))
    github.collect(run, target)
    steps = [s for j in jobs for s in j['steps']]
    collected = [s for s in steps if s['name'] == 'Collect complete main evidence']
    published = [s for s in steps if s['name'] == 'Publish complete summary and bounded Work Issues']
    success = (run['conclusion'] == 'success' and len(collected) == 1 and
               collected[0]['conclusion'] == 'success' and len(published) == 1 and
               published[0]['conclusion'] == 'success')
    if success:
        data = json.loads((target / 'care-input' / 'care-input.json').read_text())
        plan = json.loads((target / 'care-plan-and-writes' / 'care-plan.json').read_text())
        writes = json.loads((target / 'care-plan-and-writes' / 'care-writes.json').read_text())
        entry.update(source_sha=data['sha'], window=data['window'], date=data['window']['end'][:10])
        if len(entries) == 2 and entry['date'] != entries[0]['date']:
            raise ValueError('repeat publication crossed UTC date; no same-date acceptance claim')
        issues = github.read('issues?state=all&per_page=100')
        (target / 'issues.json').write_text(json.dumps(issues, indent=2))
        marker = f'{care.MARKER}{entry["date"]} -->'
        created = [i['html_url'] for i in issues if not i.get('pull_request') and
                   i['user']['login'] == 'github-actions[bot]' and
                   (i.get('body') or '').startswith(marker)]
        if len(created) > 3:
            raise ValueError('independent cumulative Care Issue count exceeds three; do not repeat')
        entry['created'] = created
        rendered = care.summary(data, plan, github.repo)
        current = f'https://github.com/{github.repo}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "unknown")}'
        (target / 'summary.md').write_text(rendered.replace(current, entry['run']))
        (target / 'publication.json').write_text(json.dumps({'plan': plan, 'writes': writes}, indent=2))
    entry.update(terminal=True, conclusion='success' if success else 'failure',
                 evidence_run=os.environ.get('GITHUB_RUN_ID', 'unknown'))
    if success:
        body = ((target / 'summary.md').read_text() + '\n\nCumulative Care-created Issues: ' +
                (', '.join(entry['created']) or 'none') + '\n\nIssue/comment publication links: ' +
                json.dumps(writes['completed']))
        # GitHub comments have a smaller limit than Actions summaries. Preserve every character.
        for offset in range(0, len(body), 60000):
            github.write('issues/1338/comments', {'body': f'L107 {entry["run"]} evidence part {offset // 60000 + 1}\n\n' + body[offset:offset + 60000]})
    github.write('issues/1338/comments', {'body': f'L107 Care {entry["run"]}: {entry["conclusion"]}.\n\nWorkflow SHA: `{entry["sha"]}`. Pinned source SHA: `{entry.get("source_sha", "unavailable")}`. Fixed window: {entry.get("window", "unavailable: incomplete collection/publication")}.\n\nFull artifacts and log snapshot: `l107-observer` on https://github.com/{github.repo}/actions/runs/{entry["evidence_run"]}.\n\nDispatch evidence only. #1338 remains open for independent command reproduction, ranked summary reconciliation and cumulative Issue count; a failed collection is no publication claim.'})
    save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--repeat', action='store_true')
    args = parser.parse_args()
    try:
        observe(GitHub(args.repo), args.directory, args.repeat)
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f'L107 observer failed: {error}', file=sys.stderr)
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
