#!/usr/bin/env python3
"""L106: the authorized observer's dispatch/publication boundary."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('observer', Path(__file__).with_name('retro-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class GitHub:
    repo = 'owner/repo'

    def __init__(self):
        self.open = True
        self.comments = []
        self.runs = []
        self.writes = []
        self.artifacts = True
        self.data = {'window': {'start': '2026-10-11T20:00:00Z', 'end': '2026-10-12T20:00:00Z'},
                     'numbers': {'merged': 7, 'model_work_unknown': 2}}
        state = {**self.data, 'repairs': ['https://github.com/owner/repo/issues/9']}
        self.report = {'number': 8, 'title': 'Retro 2026-10-12', 'state': 'open',
                       'html_url': 'https://github.com/owner/repo/issues/8',
                       'user': {'login': 'github-actions[bot]'},
                       'body': observer.retro.REPORT + '\n' + observer.retro.STATE + json.dumps(state) + ' -->\n'}
        self.prior = {**self.report, 'title': 'Retro 2026-10-11', 'number': 7, 'state': 'closed',
                      'state_reason': 'completed', 'html_url': 'https://github.com/owner/repo/issues/7'}

    def object(self, path):
        return {'state': 'open' if self.open else 'closed'}

    def read(self, path, key=None):
        if '/comments?' in path:
            return copy.deepcopy(self.comments)
        if path.startswith('actions/workflows/'):
            return copy.deepcopy(self.runs)
        if '/artifacts?' in path:
            return [{'name': 'l106-observer', 'expired': False}] if self.artifacts else []
        return [copy.deepcopy(self.report), copy.deepcopy(self.prior)]

    def write(self, path, body):
        self.writes.append((path, copy.deepcopy(body)))
        if path == 'issues/1308/comments':
            self.comments.append({'user': {'login': 'github-actions[bot]'}, 'body': body['body']})
        if path.endswith('/dispatches'):
            self.runs.append({'id': len(self.runs) + 1, 'created_at': '2026-10-12T20:00:00Z',
                              'status': 'in_progress', 'conclusion': None,
                              'html_url': f'https://github.com/owner/repo/actions/runs/{len(self.runs) + 1}'})

    def input(self, run, directory):
        (directory / 'retro-input.json').write_text(json.dumps(self.data))
        return self.data

    def finish(self, conclusion='success'):
        self.runs[-1].update(status='completed', conclusion=conclusion)
        self.report['body'] += self.runs[-1]['html_url'] + '\n'


class Observer(unittest.TestCase):
    def tick(self, api, directory):
        with patch.object(observer, 'datetime') as clock, patch.dict(os.environ, GITHUB_RUN_ID='123'):
            clock.now.return_value = datetime(2026, 10, 12, 20, 0, 0, 900000, timezone.utc)
            observer.observe(api, Path(directory))

    def test_l106_two_dispatches_preserve_each_report_and_stop(self):
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            self.assertEqual(len(api.runs), 1)
            self.assertEqual(api.writes[0][0], 'issues/1308/comments')
            self.tick(api, directory)
            self.assertEqual(len(api.runs), 1)
            api.finish()
            self.tick(api, directory)
            first = json.loads((Path(directory) / '1/report.json').read_text())
            self.assertEqual(first['number'], 8)
            self.assertEqual(len(api.runs), 1)  # Upload first report before repeat.
            self.tick(api, directory)
            self.assertEqual(len(api.runs), 2)
            api.finish()
            self.tick(api, directory)
            self.tick(api, directory)
            self.assertEqual(len(api.runs), 2)
            evidence = [b['body'] for p, b in api.writes if p == 'issues/1265/comments']
            self.assertEqual(len(evidence), 2)
            self.assertTrue(all('remain pending' in body for body in evidence))

    def test_l106_failed_publication_never_dispatches_repeat(self):
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish('failure')
            with self.assertRaisesRegex(ValueError, 'Retro failed'):
                self.tick(api, directory)
            self.assertEqual(len(api.runs), 1)

    def test_l106_unknown_dispatch_delivery_never_retries(self):
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.runs.clear()  # Dispatch may have timed out before its run became visible.
            with self.assertRaisesRegex(ValueError, 'delivery unknown'):
                self.tick(api, directory)
            self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)

    def test_l106_closed_work_order_dispatches_nothing(self):
        api = GitHub()
        api.open = False
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
        self.assertEqual(api.writes, [])

    def test_l106_repeat_requires_preserved_first_snapshot(self):
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish()
            self.tick(api, directory)
            api.artifacts = False
            with self.assertRaisesRegex(ValueError, 'snapshot artifact'):
                self.tick(api, directory)
            self.assertEqual(len(api.runs), 1)

    def test_l106_wrong_report_and_open_predecessor_fail_visibly(self):
        for failure in ('wrong-window', 'open-predecessor'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                api = GitHub()
                self.tick(api, directory)
                api.finish()
                if failure == 'wrong-window':
                    api.data['window']['end'] = '2026-10-12T21:00:00Z'
                else:
                    api.prior['state'] = 'open'
                with self.assertRaises(ValueError):
                    self.tick(api, directory)
                self.assertEqual(len(api.runs), 1)


if __name__ == '__main__':
    unittest.main()
