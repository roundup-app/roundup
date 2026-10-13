#!/usr/bin/env python3
"""L107 authorized live observer at the GitHub boundary."""
import copy
from datetime import datetime, timezone
from unittest.mock import patch
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('care_observer', Path(__file__).with_name('care-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class GitHub:
    repo = 'owner/repo'

    def __init__(self):
        self.comments = []
        self.runs = []
        self.calls = []
        self.fail_dispatch = False
        self.failure = False
        self.jobs = [{'steps': [
            {'name': 'Collect complete main evidence', 'conclusion': 'success'},
            {'name': 'Publish complete summary and bounded Work Issues', 'conclusion': 'success'}]}]

    def object(self, path):
        if path.startswith('actions/runs/'):
            return copy.deepcopy(self.runs[-1])
        return {'state': 'open'}

    def read(self, path, key=None):
        if '/comments?' in path:
            return copy.deepcopy(self.comments)
        if path.startswith('issues?'):
            return []
        if '/jobs?' in path:
            return copy.deepcopy(self.jobs)
        if '/artifacts?' in path:
            return [{'name': 'l107-observer', 'expired': False}]
        return copy.deepcopy(self.runs)

    def write(self, path, body):
        self.calls.append((path, copy.deepcopy(body)))
        if '/comments' in path:
            self.comments.append({'user': {'login': 'github-actions[bot]'}, **body})
        elif self.fail_dispatch:
            raise TimeoutError('unknown delivery')

    def collect(self, run, directory):
        if self.failure:
            raise OSError('artifact read failed')
        target = directory / 'care-input'
        target.mkdir()
        (target / 'care-input.json').write_text(json.dumps({'sha': 'abc', 'categories': {}, 'window': {
            'start': '2026-10-12T03:00:00Z',
            'end': datetime.now(timezone.utc).isoformat()}}))
        target = directory / 'care-plan-and-writes'
        target.mkdir()
        (target / 'care-plan.json').write_text('{"entries": [], "ask": ""}')
        (target / 'care-writes.json').write_text('{"completed": []}')

    def run(self):
        self.runs = [{'id': 7, 'actor': {'login': 'github-actions[bot]'}, 'head_branch': 'main',
                      'created_at': datetime.now(timezone.utc).isoformat(),
                      'html_url': 'https://github.com/owner/repo/actions/runs/7',
                      'head_sha': 'abc', 'status': 'in_progress', 'conclusion': None}]


class CareObserver(unittest.TestCase):
    def test_l107_authorized_dispatch_persists_intent_before_delivery(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
        self.assertEqual(github.calls[0][0], 'issues/1387/comments')
        self.assertEqual(github.calls[1], ('actions/workflows/care.yml/dispatches', {'ref': 'main'}))

    def test_l107_unknown_delivery_never_retries(self):
        github = GitHub()
        github.fail_dispatch = True
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(TimeoutError):
                observer.observe(github, Path(directory))
            with self.assertRaisesRegex(ValueError, 'delivery unknown'):
                observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 1)

    def test_l107_run_correlation_is_durable_across_collection_failure(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
            github.run()
            observer.observe(github, Path(directory))
            github.runs[-1].update(status='completed', conclusion='success')
            github.failure = True
            with self.assertRaises(OSError):
                observer.observe(github, Path(directory))
        record = json.loads([c['body'] for c in github.comments if c['body'].startswith(observer.MARKER)][-1].split('\n', 1)[1])
        self.assertEqual(record['dispatches'][-1]['run_id'], 7)
        self.assertNotIn('terminal', record['dispatches'][-1])
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 1)

    def test_l107_terminal_collection_failure_is_no_publication_or_repeat(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
            github.run()
            github.runs[-1].update(status='completed', conclusion='failure')
            github.jobs[0]['steps'][0]['conclusion'] = 'failure'
            observer.observe(github, Path(directory))
            observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 1)
        self.assertIn('incomplete collection/publication', github.calls[-2][1]['body'])

    def test_l107_success_repeats_same_date_only_after_persisted_evidence(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'GITHUB_RUN_ID': '99'}):
            observer.observe(github, Path(directory))
            github.run()
            github.runs[-1].update(status='completed', conclusion='success')
            observer.observe(github, Path(directory))
            observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 2)

    def test_l107_repeat_does_not_cross_utc_date(self):
        github = GitHub()
        state = {'dispatches': [{'terminal': True, 'conclusion': 'success',
                                 'date': '2000-01-01', 'evidence_run': '99'}]}
        github.comments.append({'user': {'login': 'github-actions[bot]'},
                                'body': observer.MARKER + '\n' + json.dumps(state)})
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'same-date repeat elapsed'):
                observer.observe(github, Path(directory))
        self.assertEqual(github.calls, [])

    def test_l107_ambiguous_delivery_never_chooses_or_redispatches(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
            github.run()
            github.runs.append({**github.runs[0], 'id': 8})
            with self.assertRaisesRegex(ValueError, '2 matches'):
                observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 1)

    def test_l107_preserved_first_snapshot_is_required_for_repeat(self):
        github = GitHub()
        state = {'dispatches': [{'terminal': True, 'conclusion': 'success',
                                 'date': datetime.now(timezone.utc).date().isoformat(), 'evidence_run': '99'}]}
        github.comments.append({'user': {'login': 'github-actions[bot]'},
                                'body': observer.MARKER + '\n' + json.dumps(state)})
        original = github.read
        github.read = lambda path, key=None: [] if '/artifacts?' in path else original(path, key)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'first evidence artifact unavailable'):
                observer.observe(github, Path(directory))
        self.assertEqual(github.calls, [])

    def test_l107_independent_issue_count_blocks_repeat_above_three(self):
        github = GitHub()
        original = github.read
        date = datetime.now(timezone.utc).date().isoformat()
        issues = [{'html_url': f'https://github.com/owner/repo/issues/{i}',
                   'user': {'login': 'github-actions[bot]'},
                   'body': f'<!-- care-repair {date} -->', 'state': 'closed' if i == 1 else 'open'}
                  for i in range(1, 5)]
        github.read = lambda path, key=None: issues if path.startswith('issues?') else original(path, key)
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
            github.run()
            github.runs[-1].update(status='completed', conclusion='success')
            with self.assertRaisesRegex(ValueError, 'cumulative Care Issue count exceeds three'):
                observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 1)

    def test_l107_owner_closure_stops_dispatch(self):
        github = GitHub()
        github.object = lambda path: {'state': 'closed', 'state_reason': 'not_planned'}
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory))
        self.assertEqual(github.calls, [])

    def test_l107_upload_completed_step_never_starts_an_initial_dispatch(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            observer.observe(github, Path(directory), repeat=True)
        self.assertEqual(github.calls, [])

    def test_l107_two_successful_publications_end_dispatch(self):
        github = GitHub()
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'GITHUB_RUN_ID': '99'}):
            observer.observe(github, Path(directory))
            github.run()
            github.runs[-1].update(status='completed', conclusion='success')
            observer.observe(github, Path(directory))
            observer.observe(github, Path(directory), repeat=True)
            github.runs.append({**github.runs[0], 'id': 8,
                                'created_at': datetime.now(timezone.utc).isoformat(),
                                'html_url': 'https://github.com/owner/repo/actions/runs/8'})
            observer.observe(github, Path(directory))
            observer.observe(github, Path(directory), repeat=True)
            observer.observe(github, Path(directory))
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in github.calls), 2)
        records = [json.loads(c['body'].split('\n', 1)[1]) for c in github.comments
                   if c['body'].startswith(observer.MARKER + '\n')]
        self.assertEqual([e['run_id'] for e in records[-1]['dispatches']], [7, 8])
        self.assertTrue(all(e['terminal'] for e in records[-1]['dispatches']))

    def test_l107_repeat_count_keeps_first_snapshot_after_issue_edits(self):
        github = GitHub()
        github.run()
        github.runs[0].update(id=8, status='completed', conclusion='success')
        date = datetime.now(timezone.utc).date().isoformat()
        state = {'dispatches': [
            {'terminal': True, 'conclusion': 'success', 'date': date,
             'created': [f'https://github.com/owner/repo/issues/{i}' for i in range(1, 4)]},
            {'run_id': 8, 'run': github.runs[0]['html_url'], 'sha': 'abc'}]}
        github.comments.append({'user': {'login': 'github-actions[bot]'},
                                'body': observer.MARKER + '\n' + json.dumps(state)})
        original = github.read
        github.read = lambda path, key=None: [
            {'html_url': 'https://github.com/owner/repo/issues/4',
             'user': {'login': 'github-actions[bot]'}, 'body': f'<!-- care-repair {date} -->'}
        ] if path.startswith('issues?') else original(path, key)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'cumulative Care Issue count exceeds three'):
                observer.observe(github, Path(directory))
        self.assertEqual(github.calls, [])

    def test_l107_care_publication_cannot_write_dispatch_ledger(self):
        issue = {'number': observer.PR, 'user': {'login': 'github-actions[bot]'},
                 'pull_request': {}, 'state': 'open', 'body': 'Refs #1385', 'labels': []}
        self.assertEqual(observer.care.retro.candidates([issue], datetime.now(timezone.utc), loop_only=False), [])

    def test_l107_observer_can_persist_intent_on_a_pr(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / '.github/workflows/build.yml').read_text()
        job = workflow.split('  care-observer:', 1)[1].split('  branch-observer:', 1)[0]
        permissions = job.split('    permissions:', 1)[1].split('    steps:', 1)[0]
        self.assertIn('pull-requests: write', permissions)

    def test_l107_workflow_authority_preserves_builder_care_permissions(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / '.github/workflows/build.yml').read_text()
        job = workflow.split('  care-observer:', 1)[1].split('\n  summary:', 1)[0]
        self.assertIn('actions: write', job)
        self.assertIn('group: l107-observer', job)
        self.assertIn('--repeat --repo', job)
        self.assertIn("steps.evidence.outputs.artifact-url != ''", job)
        self.assertNotIn('claude-code-action', job)
        self.assertIn('workflows: [check, retro, care]', workflow)
        care = (root / '.github/workflows/care.yml').read_text()
        self.assertIn('actions: read', care)
        self.assertNotIn('actions: write', care)
        builder = (root / '.github/workflows/build-issue.yml').read_text().split('  build:', 1)[1].split('  after:', 1)[0]
        self.assertIn('contents: read', builder)
        self.assertNotIn('actions: write', builder)


if __name__ == '__main__':
    unittest.main()
