"""Dispatch and record a Linux observation; never publish a merge gate."""
import datetime
import json
import os
import re
import time

from observer import GitHub


def admit(pr, repo, head):
    if (not re.fullmatch(r'[0-9a-f]{40}', head) or pr['state'] != 'open'
            or pr['head']['sha'] != head or not pr['head']['repo']
            or pr['head']['repo']['full_name'] != repo):
        raise ValueError('Observation requires an open same-repository PR at the requested full SHA')
    return pr['head']['ref']


def observe(api, number, head, pause=time.sleep, clock=time.monotonic):
    branch = admit(api.object(f'pulls/{number}'), api.repo, head)
    runs = f'actions/workflows/check.yml/runs?event=workflow_dispatch&head_sha={head}&per_page=100'
    before = {r['id'] for r in api.read(runs, 'workflow_runs')}
    api.write('actions/workflows/check.yml/dispatches', {'ref': branch})
    deadline = clock() + 5400
    run = None
    while clock() < deadline:
        admit(api.object(f'pulls/{number}'), api.repo, head)
        if run is None:
            matches = [r for r in api.read(runs, 'workflow_runs')
                       if r['id'] not in before and r['head_branch'] == branch and r['head_sha'] == head]
            if len(matches) > 1:
                raise ValueError('Dispatch result unknown: multiple matching runs; no observation recorded')
            if matches:
                run = matches[0]
        if run:
            current = api.object(f"actions/runs/{run['id']}")
            if current['head_sha'] != head or current['event'] != 'workflow_dispatch':
                raise ValueError('Dispatched run does not match requested head')
            jobs = api.read(f"actions/runs/{run['id']}/jobs", 'jobs')
            linux = [j for j in jobs if j['name'] == 'linux']
            if len(linux) == 1 and linux[0]['status'] == 'completed':
                job = linux[0]
                duration = 'unavailable'
                if job['started_at'] and job['completed_at']:
                    start = datetime.datetime.fromisoformat(job['started_at'].replace('Z', '+00:00'))
                    end = datetime.datetime.fromisoformat(job['completed_at'].replace('Z', '+00:00'))
                    duration = f'{(end-start).total_seconds():.0f}s'
                admit(api.object(f'pulls/{number}'), api.repo, head)
                api.write(f'issues/{number}/comments', {'body':
                          f"Linux observation: {run['html_url']}\nHead: `{head}`\n"
                          f"Linux: **{job['conclusion']}**\nDuration: {duration}\n"
                          'Observation only; required merge gates remain unchanged.'})
                return
            if current['status'] == 'completed':
                raise ValueError('Run ended without a completed Linux job')
        pause(15)
    raise TimeoutError('Dispatch result unknown or Linux observation timed out; no observation recorded')


if __name__ == '__main__':
    head = os.environ.get('HEAD', '')
    if not head and os.environ['GITHUB_EVENT_NAME'] == 'push':
        head = GitHub(os.environ['GITHUB_REPOSITORY']).object(f"pulls/{int(os.environ['PR'])}")['head']['sha']
    if not head:
        event = json.loads(open(os.environ['GITHUB_EVENT_PATH']).read())
        command = re.fullmatch(r'/observe-linux ([0-9a-f]{40})\s*', event['comment']['body'])
        if not command:
            raise ValueError('Expected /observe-linux followed by a full SHA')
        head = command[1]
    observe(GitHub(os.environ['GITHUB_REPOSITORY']), int(os.environ['PR']), head)
