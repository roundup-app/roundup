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
                              'actor': {'login': 'github-actions[bot]'},
                              'html_url': f'https://github.com/owner/repo/actions/runs/{len(self.runs) + 1}'})

    def input(self, run, directory):
        (directory / 'retro-input.json').write_text(json.dumps(self.data))
        return self.data

    def finish(self, conclusion='success'):
        self.runs[-1].update(status='completed', conclusion=conclusion)
        self.report['body'] += self.runs[-1]['html_url'] + '\n'


class CollectionGitHub(GitHub):
    def __init__(self):
        super().__init__()
        self.paths = []
        self.jobs = []
        self.input_artifacts = []
        self.orders = [{'number': 1353, 'state': 'open', 'user': {'login': 'saadshahd'},
                        'body': 'This work order authorizes one new diagnostic Retro on main after the terminal failure of run 38327525724.'}]
        self.previous = [{'user': {'login': 'github-actions[bot]'},
                          'body': observer.COLLECTION_MARKER + '\n' + json.dumps({
                              'run_id': 38327525724, 'collected': True, 'conclusion': 'failure',
                              'log': 'https://github.com/owner/repo/actions/runs/38327525724/job/7#step:3:1',
                              'window': None, 'artifacts': []})}]

    def log(self, run, job):
        return ('HTTP 502 Bad Gateway reading actions/runs/38299174806/jobs?filter=all&per_page=100; '
                'request ID D00A:2DCD64:812A50:1A9B0EB:6ACD859E; remaining core budget 2642')

    def object(self, path):
        self.paths.append(path)
        if path.startswith('actions/runs/'):
            return copy.deepcopy(self.runs[-1])
        return super().object(path)

    def read(self, path, key=None):
        self.paths.append(path)
        if path == 'issues?state=open&per_page=100':
            return copy.deepcopy(self.orders)
        if '/comments?' in path:
            return copy.deepcopy(self.previous + self.comments)
        if '/jobs?' in path:
            return copy.deepcopy(self.jobs)
        if '/artifacts?' in path:
            return copy.deepcopy(self.input_artifacts)
        return super().read(path, key)

    def write(self, path, body):
        super().write(path, body)
        if path == 'issues/1315/comments':
            self.comments.append({'user': {'login': 'github-actions[bot]'}, 'body': body['body']})


class CollectionObserver(unittest.TestCase):
    def tick(self, api, directory):
        with patch.object(observer, 'datetime') as clock, patch.dict(os.environ, GITHUB_RUN_ID='123'):
            clock.now.return_value = datetime(2026, 10, 12, 20, 0, tzinfo=timezone.utc)
            observer.observe_collection(api, Path(directory))

    def test_l106_collection_dispatch_records_intent_before_one_main_dispatch(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
        self.assertEqual(api.writes[0][0], 'issues/1315/comments')
        intent = json.loads(api.writes[0][1]['body'].split('\n', 1)[1])
        self.assertEqual(intent['before'], [])
        self.assertEqual(intent['work_order'], 1353)
        self.assertEqual(intent['after_run'], 38327525724)
        self.assertEqual(api.writes[1], ('actions/workflows/retro.yml/dispatches', {'ref': 'main'}))

    def test_l106_collection_unknown_delivery_preserves_intent_without_retry(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(api, 'write', wraps=api.write) as write:
                def timeout(path, body):
                    if path.endswith('/dispatches'):
                        api.writes.append((path, copy.deepcopy(body)))
                        raise TimeoutError('delivery unknown')
                    return original(path, body)
                original = CollectionGitHub.write.__get__(api)
                write.side_effect = timeout
                with self.assertRaises(TimeoutError):
                    self.tick(api, directory)
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, 'delivery unknown'):
                    self.tick(api, directory)
        self.assertEqual(len(api.comments), 1)
        self.assertIn('requested_at', api.comments[0]['body'])
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)

    def test_l106_collection_ambiguous_delivery_never_chooses_or_redispatches(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.runs.append({**api.runs[0], 'id': 2})
            with self.assertRaisesRegex(ValueError, '2 matching runs'):
                self.tick(api, directory)
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)
        self.assertEqual(len(api.comments), 1)

    def test_l106_collection_unknown_delivery_does_not_claim_a_manual_dispatch(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.runs[0]['actor']['login'] = 'saadshahd'
            with self.assertRaisesRegex(ValueError, '0 matching runs'):
                self.tick(api, directory)
        self.assertEqual(len(api.comments), 1)
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)

    def test_l106_collection_failed_step_records_log_without_redispatch(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish('failure')
            api.jobs = [{'html_url': api.runs[0]['html_url'] + '/job/7', 'steps': [
                {'name': 'Collect fixed-window input', 'number': 2,
                 'status': 'completed', 'conclusion': 'failure'}]}]
            self.tick(api, directory)
            self.tick(api, directory)
        evidence = [b['body'] for p, b in api.writes if b.get('body', '').startswith('L106 diagnostic collection:')]
        self.assertEqual(len(evidence), 1)
        self.assertIn('/job/7#step:2:1', evidence[0])
        self.assertIn('unavailable:', evidence[0])
        self.assertIn('HTTP 502 Bad Gateway', evidence[0])
        self.assertIn('actions/runs/38299174806/jobs?filter=all&per_page=100', evidence[0])
        self.assertIn('#1315 owns diagnosis', evidence[0])
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)

    def test_l106_collection_success_links_exact_artifact_window(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish()
            api.jobs = [{'html_url': api.runs[0]['html_url'] + '/job/7', 'steps': [
                {'name': 'Collect fixed-window input', 'number': 2,
                 'status': 'completed', 'conclusion': 'success'}]}]
            api.input_artifacts = [{'name': 'retro-input', 'expired': False, 'id': 99}]
            self.tick(api, directory)
            self.tick(api, directory)
        evidence = [b['body'] for p, b in api.writes if b.get('body', '').startswith('L106 diagnostic collection:')]
        self.assertEqual(len(evidence), 1)
        self.assertIn('[2026-10-11T20:00:00Z, 2026-10-12T20:00:00Z)', evidence[0])
        self.assertIn('/artifacts/99', evidence[0])

    def test_l106_collection_waits_for_artifact_upload_without_redispatch(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.jobs = [{'html_url': api.runs[0]['html_url'] + '/job/7', 'steps': [
                {'name': 'Collect fixed-window input', 'number': 2,
                 'status': 'completed', 'conclusion': 'success'}]}]
            self.tick(api, directory)
            self.assertFalse(any(b.get('body', '').startswith('L106 diagnostic collection:')
                                 for _, b in api.writes))
            api.input_artifacts = [{'name': 'retro-input', 'expired': False, 'id': 99}]
            self.tick(api, directory)
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)
        self.assertTrue(any('/artifacts/99' in b.get('body', '') for _, b in api.writes))

    def test_l106_collection_correlated_run_is_not_replaced_by_later_dispatch(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            self.tick(api, directory)
            api.runs.append({**api.runs[0], 'id': 2})
            # Read the persisted run id even though another diagnostic-sized candidate appears later.
            with patch.object(api, 'object', side_effect=lambda path:
                              api.runs[0] if path == 'actions/runs/1' else {'state': 'open'}):
                self.tick(api, directory)
        records = [json.loads(c['body'].split('\n', 1)[1]) for c in api.comments
                   if c['body'].startswith(observer.COLLECTION_MARKER)]
        self.assertEqual(records[-1]['run_id'], 1)
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)

    def test_l106_collection_does_not_read_or_change_publication_ledger(self):
        api = CollectionGitHub()
        original = {'user': {'login': 'github-actions[bot]'}, 'body': observer.MARKER + '\n' +
                    json.dumps({'dispatches': [{'run': 'https://github.com/owner/repo/actions/runs/38309102644'}]})}
        api.comments.append(copy.deepcopy(original))
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            self.tick(api, directory)
        self.assertEqual(api.comments[0], original)
        self.assertFalse(any('1308' in p for p in api.paths))
        self.assertTrue(all(p in ('issues/1315/comments', 'actions/workflows/retro.yml/dispatches')
                            for p, _ in api.writes))

    def test_l106_collection_closed_work_order_dispatches_nothing(self):
        api = CollectionGitHub()
        api.open = False
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
        self.assertEqual(api.writes, [])

    def test_l106_failed_collection_never_uses_a_partial_artifact_window(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish('failure')
            api.jobs = [{'html_url': api.runs[0]['html_url'] + '/job/7', 'steps': [
                {'name': 'Collect fixed-window input', 'number': 2,
                 'status': 'completed', 'conclusion': 'failure'}]}]
            api.input_artifacts = [{'name': 'retro-input', 'expired': False, 'id': 99}]
            with patch.object(api, 'input', side_effect=AssertionError('partial input must not be read')):
                self.tick(api, directory)
            state = json.loads(api.comments[-1]['body'].split('\n', 1)[1])
            self.assertIsNone(state['window'])
            self.assertIn('HTTP 502', (Path(directory) / '1/collector.log').read_text())

    def test_l106_success_without_complete_input_retains_intent_without_redispatch(self):
        api = CollectionGitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish()
            api.jobs = [{'html_url': api.runs[0]['html_url'] + '/job/7', 'steps': [
                {'name': 'Collect fixed-window input', 'number': 2,
                 'status': 'completed', 'conclusion': 'success'}]}]
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, 'no complete input artifact'):
                    self.tick(api, directory)
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 1)
        records = [c for c in api.comments if c['body'].startswith(observer.COLLECTION_MARKER)]
        state = json.loads(records[-1]['body'].split('\n', 1)[1])
        self.assertNotIn('collected', state)

    def test_l106_failure_log_retains_collector_endpoint_without_other_steps(self):
        api = observer.GitHub('owner/repo')
        with patch.object(observer.subprocess, 'run') as run:
            run.return_value.stdout = ('Retro\tCollect fixed-window input\tHTTP 502 Bad Gateway reading actions/runs/38299174806/jobs?filter=all&per_page=100\n'
                                       'Retro\tPublish\tunrelated output\n')
            result = api.log({'id': 1}, {'id': 7})
        self.assertIn('HTTP 502 Bad Gateway reading actions/runs/38299174806/jobs?filter=all&per_page=100', result)
        self.assertNotIn('unrelated output', result)
        self.assertEqual(run.call_args.args[0], ['gh', 'run', 'view', '1', '--repo', 'owner/repo', '--job', '7', '--log'])

    def test_l106_later_work_order_owns_one_dispatch_without_resetting_evidence(self):
        api = CollectionGitHub()
        original = copy.deepcopy(api.previous)
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish('failure')
            api.jobs = [{'html_url': api.runs[0]['html_url'] + '/job/7', 'steps': [
                {'name': 'Collect fixed-window input', 'number': 2,
                 'status': 'completed', 'conclusion': 'failure'}]}]
            self.tick(api, directory)
            earlier = copy.deepcopy(api.comments)
            api.orders.append({'number': 1400, 'state': 'open', 'user': {'login': 'saadshahd'},
                               'body': 'This work order authorizes one new diagnostic Retro on main after the terminal failure of run 1.'})
            self.tick(api, directory)
            self.tick(api, directory)
            self.tick(api, directory)
        self.assertEqual(api.previous, original)
        self.assertEqual(api.comments[:len(earlier)], earlier)
        self.assertEqual(sum(p.endswith('/dispatches') for p, _ in api.writes), 2)
        intents = [json.loads(c['body'].split('\n', 1)[1]) for c in api.comments
                   if c['body'].startswith(observer.COLLECTION_MARKER)]
        self.assertEqual({r['work_order'] for r in intents}, {1353, 1400})

    def test_l106_untrusted_or_closed_or_unrecorded_authorization_dispatches_nothing(self):
        for failure in ('untrusted', 'closed', 'closure-after-list', 'unrecorded', 'successful'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                api = CollectionGitHub()
                if failure == 'untrusted':
                    api.orders[0]['user']['login'] = 'stranger'
                elif failure == 'closed':
                    api.orders[0]['state'] = 'closed'
                elif failure == 'closure-after-list':
                    original = api.object
                    api.object = lambda path: {'state': 'closed'} if path == 'issues/1353' else original(path)
                elif failure == 'unrecorded':
                    api.previous = []
                else:
                    api.previous[0]['body'] = api.previous[0]['body'].replace('"failure"', '"success"')
                if failure in ('unrecorded', 'successful'):
                    with self.assertRaisesRegex(ValueError, 'recorded terminal'):
                        self.tick(api, directory)
                else:
                    self.tick(api, directory)
                self.assertEqual(api.writes, [])

    def test_l106_unknown_prior_delivery_blocks_a_new_work_order(self):
        api = CollectionGitHub()
        api.previous.append({'user': {'login': 'github-actions[bot]'},
                             'body': observer.COLLECTION_MARKER + '\n' + json.dumps({
                                 'work_order': 1340, 'requested_at': '2026-10-12T19:00:00Z', 'before': []})})
        before = copy.deepcopy(api.previous)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'earlier collector delivery unresolved'):
                self.tick(api, directory)
        self.assertEqual(api.writes, [])
        self.assertEqual(api.previous, before)

    def test_l106_concurrent_workflow_ticks_are_serialized_without_changing_permissions(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / '.github/workflows/build.yml').read_text()
        job = workflow.split('\n  retro-observer:\n', 1)[1].split('\n  branch-observer:', 1)[0]
        self.assertIn('group: l106-observer\n      cancel-in-progress: false', job)
        self.assertIn('actions: write', job)
        builder = (root / '.github/workflows/build-issue.yml').read_text().split('\n  build:\n', 1)[1].split('\n  after:', 1)[0]
        self.assertNotIn('actions: write', builder)
        self.assertNotIn('actions: write', (root / '.github/workflows/retro.yml').read_text())



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

    def test_l106_repeat_rejects_another_report_or_four_repairs(self):
        for failure in ('another-report', 'four-repairs'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                api = GitHub()
                self.tick(api, directory)
                api.finish()
                self.tick(api, directory)
                self.tick(api, directory)
                api.finish()
                if failure == 'another-report':
                    api.report['html_url'] += '-duplicate'
                else:
                    api.report['body'] = api.report['body'].replace(
                        '"repairs": ["https://github.com/owner/repo/issues/9"]',
                        '"repairs": ["a", "b", "c", "d"]')
                with self.assertRaises(ValueError):
                    self.tick(api, directory)
                self.assertEqual(len(api.runs), 2)

    def test_l106_repeat_never_consumes_another_dates_repair_allowance(self):
        api = GitHub()
        with tempfile.TemporaryDirectory() as directory:
            self.tick(api, directory)
            api.finish()
            self.tick(api, directory)
            with patch.object(observer, 'datetime') as clock:
                clock.now.return_value = datetime(2026, 10, 13, 0, 0, tzinfo=timezone.utc)
                with self.assertRaisesRegex(ValueError, 'same-date'):
                    observer.observe(api, Path(directory))
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
