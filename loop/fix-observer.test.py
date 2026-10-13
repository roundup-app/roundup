import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fix_observer', Path(__file__).with_name('fix-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class Observer(unittest.TestCase):
    def test_l82_short_window_never_reads_or_reports_completion(self):
        class NoReads:
            def read(self, *args):
                raise AssertionError('early collection')
        for now in (observer.START, observer.END):
            with self.subTest(now=now):
                self.assertIsNone(observer.collect(NoReads(), Path('/unused'), now))


class GitHub:
    def __init__(self, rows):
        self.rows = rows
        self.writes = []
        self.closed = []

    def object(self, path):
        return {'total_count': len(self.rows)}

    def read(self, path, key=None):
        if 'comments' in path:
            return []
        if '/jobs?' in path:
            run = next(r for r in self.rows if f'/runs/{r["id"]}/' in path)
            return run['jobs']
        return self.rows

    def summary(self, run, directory):
        if run.get('missing'):
            raise OSError('artifact unavailable')
        return run['summary']

    def write(self, path, body):
        self.writes.append((path, body))

    def close(self, issue):
        self.closed.append(issue)


def run(number, head='a', cause='check', start='01:00:00', end='01:10:00', held=None):
    summary = 'Fix queued for branch `build/example`; it waits.'
    if held:
        summary = f'Skip fix: PR #7, cause {cause}, head `{head * 40}` already held by run {held}.'
    return {'id': number, 'html_url': f'https://github.com/owner/repo/actions/runs/{number}',
            'display_title': f'Fix PR #7: {cause} @ {head * 40}', 'event': 'workflow_dispatch',
            'created_at': f'2026-10-13T{start}Z', 'run_started_at': f'2026-10-13T{start}Z',
            'status': 'completed', 'conclusion': 'success', 'run_attempt': 1, 'summary': summary,
            'jobs': [{'name': 'branch', 'conclusion': 'success', 'completed_at': f'2026-10-13T{start}Z',
                      'steps': [{'name': 'Run actions/checkout@v4', 'conclusion': 'success',
                                 'completed_at': f'2026-10-13T{start}Z'},
                                {'name': 'Run trap summary', 'conclusion': 'success',
                                 'started_at': f'2026-10-13T{start}Z', 'completed_at': f'2026-10-13T{start}Z'}]}] +
                    ([] if held else [{'name': 'fix / task', 'conclusion': 'success',
                                       'completed_at': f'2026-10-13T{end}Z'}])}


class Fixtures(unittest.TestCase):
    def collect(self, rows):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            return observer.collect(GitHub(rows), Path(directory), '2026-10-13T07:00:00Z')

    def test_l82_rejected_race_keeps_raw_dispatch_repeat_visible(self):
        result = self.collect([run(1), run(2, start='01:01:00', held=1)])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['identities'][0]['raw_dispatches'], 2)
        self.assertEqual(result['identities'][0]['admitted'], 1)
        self.assertTrue(result['criteria']['duplicate_rejection_observed'])
        self.assertFalse(result['criteria']['literal_dispatch_count'])
        self.assertEqual(result['result'], 'fail')

    def test_l82_overlapping_admitted_runs_fail(self):
        result = self.collect([run(1), run(2, start='01:01:00')])
        self.assertEqual(result['identities'][0]['overlaps'], [[1, 2]])
        self.assertFalse(result['criteria']['at_most_one_admitted_live'])

    def test_l82_same_second_admission_cannot_prove_no_overlap(self):
        result = self.collect([run(1), run(2, start='01:10:00', end='01:20:00')])
        self.assertFalse(result['criteria']['at_most_one_admitted_live'])

    def test_l82_sequential_repeats_still_fail_literal_count(self):
        result = self.collect([run(1), run(2, start='01:11:00', end='01:20:00')])
        self.assertTrue(result['criteria']['at_most_one_admitted_live'])
        self.assertFalse(result['criteria']['literal_dispatch_count'])

    def test_l82_missing_summary_never_proves_admission(self):
        result = self.collect([{**run(1), 'missing': True}])
        self.assertIn('artifact unavailable', result['errors'][0])
        self.assertFalse(result['criteria']['complete_evidence'])

    def test_l82_distinct_heads_and_causes_are_admitted(self):
        result = self.collect([run(1), run(2, head='b'), run(3, cause='review')])
        self.assertTrue(result['criteria']['distinct_heads_admitted'])
        self.assertTrue(result['criteria']['distinct_causes_admitted'])
        self.assertEqual([g['admitted'] for g in result['identities']], [1, 1, 1])

    def test_l82_race_before_holder_admission_is_rejected_before_queue(self):
        holder = run(1)
        holder['jobs'][0]['steps'][1]['completed_at'] = '2026-10-13T01:02:00Z'
        result = self.collect([holder, run(2, start='01:01:00', held=1)])
        self.assertEqual(result['errors'], [])
        self.assertTrue(result['criteria']['duplicate_rejection_observed'])

    def test_l82_rejection_without_a_live_holder_fails(self):
        result = self.collect([run(1), run(2, start='01:11:00', held=1)])
        self.assertIn('no admitted live evidence', result['errors'][0])

    def test_l82_skipped_workflow_triggers_remain_in_raw_evidence(self):
        row = {**run(1), 'display_title': 'Fix PR #: check @ ' + 'a' * 40, 'event': 'workflow_run',
               'jobs': [{'name': 'branch', 'conclusion': 'skipped'}]}
        result = self.collect([row])
        self.assertEqual(result['errors'], [])
        self.assertIn('not applicable', result['runs'][0]['admission'])
        self.assertEqual(result['result'], 'fail')

    def test_l82_unknown_title_is_not_silently_dropped(self):
        result = self.collect([{**run(1), 'display_title': 'Fix PR #7: check'}])
        self.assertIn('missing PR/cause/full head', result['errors'][0])

    def test_l82_artifact_keeps_counts_times_and_rejection_reason(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            observer.collect(GitHub([run(1), run(2, start='01:01:00', held=1)]),
                             Path(directory), '2026-10-13T07:00:00Z')
            evidence = json.loads((Path(directory) / 'evidence.json').read_text())
            report = (Path(directory) / 'report.md').read_text()
            self.assertIn('| 2 | 2 | 1 | 1 |', report)
            self.assertIn('already held by run 1', evidence['runs'][1]['summary'])
            self.assertEqual(evidence['runs'][0]['created_at'], '2026-10-13T01:00:00Z')
            self.assertEqual(evidence['runs'][0]['run_started_at'], '2026-10-13T01:00:00Z')
            self.assertEqual(evidence['runs'][0]['completed_at'], '2026-10-13T01:10:00Z')

    def test_l82_paginated_github_read_collects_every_page(self):
        import json
        import subprocess
        from unittest.mock import patch
        rows = [run(i, head='a' if i == 1 else 'b') for i in (1, 2)]
        with patch('observer.subprocess.run', return_value=subprocess.CompletedProcess(
                [], 0, json.dumps([{'workflow_runs': rows[:1]}, {'workflow_runs': rows[1:]}]))):
            self.assertEqual(observer.GitHub('owner/repo').read('runs', 'workflow_runs'), rows)

    def test_l82_missing_pagination_page_fails_complete_evidence(self):
        import tempfile
        api = GitHub([run(1)])
        api.object = lambda path: {'total_count': 2}
        with tempfile.TemporaryDirectory() as directory:
            result = observer.collect(api, Path(directory), '2026-10-13T07:00:00Z')
        self.assertIn('Paginated run count', result['errors'][0])
        self.assertFalse(result['criteria']['complete_evidence'])

    def test_l82_search_limit_is_not_a_complete_window(self):
        import tempfile
        api = GitHub([run(1)])
        api.object = lambda path: {'total_count': 1000}
        with tempfile.TemporaryDirectory() as directory:
            result = observer.collect(api, Path(directory), '2026-10-13T07:00:00Z')
        self.assertIn('search limit reached', result['errors'][0])
        self.assertFalse(result['criteria']['complete_evidence'])

    def test_l82_rejection_that_entered_branch_queue_fails(self):
        duplicate = run(2, start='01:01:00', held=1)
        duplicate['summary'] += '\nFix queued for branch `build/example`; it waits.'
        result = self.collect([run(1), duplicate])
        self.assertIn('before branch queue', result['errors'][0])

    def test_l82_unfinished_run_requires_later_collection(self):
        row = {**run(1), 'status': 'in_progress', 'conclusion': None}
        result = self.collect([row])
        self.assertIn('unfinished', result['errors'][0])
        self.assertIsNone(result['runs'][0]['completed_at'])
        self.assertFalse(result['criteria']['complete_evidence'])

    def test_l82_published_complete_report_is_not_collected_twice(self):
        api = GitHub([])
        api.read = lambda *args: [{'user': {'login': 'github-actions[bot]'},
                                  'body': observer.MARKER + '\nFinal collection: True'}]
        self.assertIsNone(observer.collect(api, Path('/unused'), '2026-10-13T07:00:00Z'))

    def test_l82_automatic_repeat_cannot_pass_literal_dispatch_observer(self):
        duplicate = {**run(2, start='01:01:00', held=1), 'event': 'workflow_run'}
        result = self.collect([run(1), duplicate])
        self.assertTrue(result['criteria']['duplicate_rejection_observed'])
        self.assertFalse(result['criteria']['literal_dispatch_count'])
        self.assertEqual(result['result'], 'fail')

    def test_l82_collection_failure_is_linked_without_closing_issues(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            api = GitHub([])
            (Path(directory) / 'failure.txt').write_text('GitHub read timed out')
            observer.publish(api, Path(directory), 'https://github.com/artifact/99')
            self.assertEqual(api.closed, [])
            self.assertIn('GitHub read timed out', api.writes[0][1]['body'])

    def test_l82_observer_job_reads_trusted_main_without_fix_authority(self):
        source = (Path(__file__).resolve().parent.parent / '.github/workflows/build.yml').read_text()
        job = source.split('\n  fix-observer:\n', 1)[1].split('\n  summary:', 1)[0]
        self.assertIn('ref: main', job)
        self.assertIn('actions: read', job)
        self.assertNotIn('actions: write', job)
        self.assertNotIn('codex', job)
        self.assertNotIn('claude-code-action', job)
        self.assertLess(job.index('fix-observer.test.py'), job.index('fix-observer.py'))
        self.assertLess(job.index('actions/upload-artifact'), job.index('--publish'))

    def test_l82_failed_result_is_linked_without_closing_either_issue(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            api = GitHub([run(1)])
            observer.collect(api, Path(directory), '2026-10-13T07:00:00Z')
            observer.publish(api, Path(directory), 'https://github.com/artifact/99')
            self.assertEqual(api.closed, [])
            self.assertEqual([p for p, _ in api.writes], ['issues/1290/comments', 'issues/1350/comments'])
            self.assertIn('https://github.com/artifact/99', api.writes[0][1]['body'])


if __name__ == '__main__':
    unittest.main()
