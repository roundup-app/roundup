import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('branch_observer', Path(__file__).with_name('branch-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class Observer(unittest.TestCase):
    def evidence(self):
        return {'requested_at': '2026-10-12T20:00:00Z',
                'build_started_at': '2026-10-12T19:00:00Z',
                'build_completed_at': '2026-10-12T20:01:00Z',
                'fix_created_at': '2026-10-12T20:00:00Z',
                'fix_started_at': '2026-10-12T20:01:01Z',
                'final_head': 'a' * 40, 'observed_head': 'a' * 40,
                'summary': 'Fix queued for branch `build/test`; it waits for any build or fix holding the branch.\n'
                           'Fix acquired branch `build/test`; task preparation waits for any build or fix holding it to end.\n'
                           'Skip fix: the build or another writer moved the head',
                'model_started': False, 'attempts_before': [], 'attempts_after': []}

    def test_l23_l82_live_exclusion_requires_order_head_and_no_attempt(self):
        observer.assert_evidence(self.evidence())
        for field, value in [('fix_started_at', '2026-10-12T20:00:30Z'),
                             ('fix_started_at', '2026-10-12T20:01:00Z'),
                             ('requested_at', '2026-10-12T20:02:00Z'),
                             ('fix_created_at', '2026-10-12T20:01:00Z'),
                             ('observed_head', 'b' * 40), ('model_started', True),
                             ('attempts_after', [1]), ('summary', '')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                observer.assert_evidence({**self.evidence(), field: value})

class GitHub:
    repo = 'owner/repo'

    def __init__(self):
        self.comments = []
        self.writes = []
        self.closed = False
        self.runs = []
        self.complete = False
        self.job = {'id': 10, 'name': 'build #7 / build', 'status': 'in_progress',
                    'started_at': '2026-10-12T19:00:00Z', 'completed_at': None}
        self.build = {'id': 1, 'head_sha': observer.COORDINATION, 'html_url': 'https://build'}
        self.head = 'a' * 40

    def object(self, path):
        if path.startswith('compare/'):
            return {'status': 'identical'}
        if path == 'actions/jobs/10':
            return {**self.job, 'status': 'completed' if self.complete else 'in_progress',
                    'completed_at': '2026-10-12T20:01:00Z' if self.complete else None}
        if path.startswith('pulls/'):
            return {'head': {'sha': self.head}}
        return {'state': 'closed' if self.closed else 'open', 'body': 'Key: test'}

    def read(self, path, key=None):
        if path.startswith('issues/1322/comments'):
            return self.comments
        if path.startswith('issues/'):
            return []
        if path.startswith('pulls?'):
            return [{'number': 2, 'head': {'ref': 'build/test', 'sha': 'b' * 40,
                                          'repo': {'full_name': self.repo}}}]
        if 'workflows/build' in path:
            return [self.build]
        if 'workflows/fix' in path:
            return self.runs
        if 'runs/1/jobs' in path:
            return [self.job]
        if 'runs/3/jobs' in path:
            return [{'name': 'fix / task', 'started_at': '2026-10-12T20:01:01Z', 'conclusion': 'success'},
                    {'name': 'fix / fix #', 'conclusion': 'skipped'}]
        raise AssertionError(path)

    def write(self, path, body):
        self.writes.append((path, body))
        if path == 'issues/1322/comments':
            self.comments.append({'user': {'login': 'github-actions[bot]'}, 'body': body['body']})
        if path.endswith('/dispatches'):
            self.runs = [{'id': 3, 'created_at': '2026-10-12T20:00:00Z',
                          'display_title': 'Fix PR #2: check @ ' + '0' * 40, 'status': 'in_progress',
                          'conclusion': None, 'html_url': 'https://fix'}]

    def summary(self, run, name, directory):
        if name == 'branch-queue-summary':
            return 'Fix queued for branch `build/test`; it waits.\n'
        return ('Fix acquired branch `build/test`; task preparation waits.\n'
                f'Observed head: `{self.head}`; cause head: `{"0" * 40}`.\n'
                'Skip fix: the build or another writer moved the head')


class LiveObserver(unittest.TestCase):
    def tick(self, api, directory):
        from datetime import datetime, timezone
        from unittest.mock import patch
        with patch.object(observer, 'datetime', wraps=datetime) as clock, patch.dict(observer.os.environ, GITHUB_RUN_ID='99'):
            clock.now.return_value = datetime(2026, 10, 12, 20, 0, tzinfo=timezone.utc)
            observer.observe(api, Path(directory))

    def test_l23_l82_dispatch_wait_and_commit_ready_evidence(self):
        import json
        import tempfile
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            self.assertEqual(api.writes[0][0], 'issues/1322/comments')
            self.assertEqual(api.writes[1][1]['inputs'], {'pr': '2', 'head': '0' * 40, 'cause': 'check'})
            self.tick(api, directory)
            self.assertFalse((Path(directory) / 'evidence.json').exists())
            api.complete = True
            api.runs[0].update(status='completed', conclusion='success')
            self.tick(api, directory)
            evidence = json.loads((Path(directory) / 'evidence.json').read_text())
            self.assertEqual(evidence['result'], 'pass')
            self.assertEqual(evidence['final_head'], 'a' * 40)
            self.assertEqual(evidence['build_completed_at'], '2026-10-12T20:01:00Z')
            self.assertEqual(evidence['fix_started_at'], '2026-10-12T20:01:01Z')
            self.tick(api, directory)
            self.assertEqual(sum(path.endswith('/dispatches') for path, _ in api.writes), 1)
            self.assertTrue(any(path == 'issues/1288/comments' for path, _ in api.writes))
            self.assertFalse(any('statuses' in path or 'reviews' in path for path, _ in api.writes))

    def test_l23_l82_unknown_delivery_never_redispatches(self):
        import tempfile
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.runs = []
            with self.assertRaisesRegex(ValueError, 'delivery unknown'):
                self.tick(api, directory)
            self.assertEqual(sum(path.endswith('/dispatches') for path, _ in api.writes), 1)

    def test_l23_l82_failure_preserves_evidence_without_closing_issues(self):
        import json
        import tempfile
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.complete = True
            api.runs[0].update(status='completed', conclusion='failure')
            with self.assertRaisesRegex(ValueError, 'workflow failed'):
                self.tick(api, directory)
            self.assertEqual(json.loads((Path(directory) / 'evidence.json').read_text())['result'], 'fail')
            self.assertTrue(any(path == 'issues/1288/comments' for path, _ in api.writes))
            self.assertFalse(any(body.get('state') == 'closed' for _, body in api.writes))

    def test_l23_l82_owner_closure_dispatches_nothing(self):
        import tempfile
        api = GitHub()
        api.closed = True
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            self.assertEqual(api.writes, [])


if __name__ == '__main__':
    unittest.main()
