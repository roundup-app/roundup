import importlib.util
from pathlib import Path
import unittest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location('linux_observer', Path(__file__).with_name('linux-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class L84(unittest.TestCase):
    def test_l84_dispatch_requires_open_same_repository_exact_head(self):
        pr = {'state': 'open', 'head': {'sha': 'a'*40, 'ref': 'build/example', 'repo': {'full_name': 'owner/repo'}}}
        self.assertEqual('build/example', observer.admit(pr, 'owner/repo', 'a'*40))
        for changed in ({**pr, 'state': 'closed'}, {**pr, 'head': {**pr['head'], 'sha': 'b'*40}},
                        {**pr, 'head': {**pr['head'], 'repo': {'full_name': 'fork/repo'}}}):
            with self.assertRaises(ValueError):
                observer.admit(changed, 'owner/repo', 'a'*40)

    def test_l46_observer_has_no_model_or_gate_authority(self):
        source = (Path(__file__).resolve().parent.parent / '.github/workflows/linux-observer.yml').read_text()
        self.assertIn('actions: write', source)
        self.assertIn("github.ref == 'refs/heads/main'", source)
        self.assertIn("github.event.comment.user.login == 'saadshahd'", source)
        self.assertIn('cancel-in-progress: true', source)
        self.assertIn('timeout-minutes: 100', source)
        self.assertIn('ref: main', source)
        self.assertIn('persist-credentials: false', source)
        for forbidden in ('statuses: write', 'checks: write', 'contents: write', 'pull-requests: write', 'anthropics/', 'just ready', 'gh pr merge'):
            self.assertNotIn(forbidden, source)


class GitHubFixture:
    repo = 'owner/repo'

    def __init__(self, moved=False):
        self.writes = []
        self.dispatched = False
        self.moved = moved

    def object(self, path):
        if path.startswith('pulls/'):
            return {'state': 'open', 'head': {'sha': ('b' if self.moved and self.dispatched else 'a')*40,
                    'ref': 'build/example', 'repo': {'full_name': self.repo}}}
        return {'head_sha': 'a'*40, 'event': 'workflow_dispatch', 'status': 'completed'}

    def read(self, path, key):
        if path.endswith('/jobs'):
            return [{'name': 'linux', 'status': 'completed', 'conclusion': 'success',
                     'started_at': '2026-10-13T10:00:00Z', 'completed_at': '2026-10-13T10:03:00Z'}]
        return ([{'id': 123, 'head_branch': 'build/example', 'head_sha': 'a'*40,
                  'html_url': 'https://github.com/owner/repo/actions/runs/123'}] if self.dispatched else [])

    def write(self, path, body):
        self.writes.append((path, body))
        self.dispatched = True


class L84Observation(unittest.TestCase):
    def test_l84_record_verified_run_duration_and_conclusion(self):
        api = GitHubFixture()
        observer.observe(api, 1459, 'a'*40)
        self.assertEqual(('actions/workflows/check.yml/dispatches', {'ref': 'build/example'}), api.writes[0])
        path, body = api.writes[1]
        self.assertEqual('issues/1459/comments', path)
        for evidence in ('a'*40, '180s', '**success**', '/actions/runs/123'):
            self.assertIn(evidence, body['body'])

    def test_l84_moved_head_records_no_result(self):
        api = GitHubFixture(moved=True)
        with self.assertRaises(ValueError):
            observer.observe(api, 1459, 'a'*40)
        self.assertEqual(1, len(api.writes))

class L84Run(unittest.TestCase):
    def test_l84_wrong_run_head_records_no_result(self):
        class WrongHead(GitHubFixture):
            def object(self, path):
                result = super().object(path)
                if path.startswith('actions/runs/'):
                    result['head_sha'] = 'b'*40
                return result
        api = WrongHead()
        with self.assertRaises(ValueError):
            observer.observe(api, 1459, 'a'*40)
        self.assertEqual(1, len(api.writes))

    def test_l84_unidentified_dispatch_is_unknown_without_retry_or_comment(self):
        class MissingRun(GitHubFixture):
            def read(self, path, key):
                return []
        api = MissingRun()
        ticks = iter([0, 0, 5401])
        with self.assertRaises(TimeoutError):
            observer.observe(api, 1459, 'a'*40, pause=lambda seconds: None, clock=lambda: next(ticks))
        self.assertEqual(1, len(api.writes))

    def test_l84_ended_run_without_linux_records_no_result(self):
        class MissingLinux(GitHubFixture):
            def read(self, path, key):
                return [] if path.endswith('/jobs') else super().read(path, key)
        api = MissingLinux()
        with self.assertRaises(ValueError):
            observer.observe(api, 1459, 'a'*40)
        self.assertEqual(1, len(api.writes))


if __name__ == '__main__':
    unittest.main()
