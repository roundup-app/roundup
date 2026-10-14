#!/usr/bin/env python3
"""L106: daily Retro observes GitHub through a fixed-window command."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('orders', ROOT / 'orders.py')
orders = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orders)


class Retro(unittest.TestCase):
    def test_l106_report_does_not_enter_work_queue(self):
        self.assertFalse(orders.work_issue({'user': {'login': 'saadshahd'}, 'body': '<!-- retro-report -->\nNumbers'}))

    def test_l106_report_title_alone_does_not_hide_work(self):
        self.assertTrue(orders.work_issue({'user': {'login': 'saadshahd'}, 'title': 'Retro 2026-10-12', 'body': 'Repair this'}))


from datetime import datetime, timezone
import json
import re
import subprocess
from unittest.mock import patch
import sys
sys.path.insert(0, str(ROOT))
import retro

END = datetime(2026, 10, 12, 12, tzinfo=timezone.utc)
START = '2026-10-11T12:00:00Z'
NOW = '2026-10-12T11:00:00Z'
END_TEXT = '2026-10-12T12:00:00Z'


def row(number, **fields):
    return {'id': number, 'number': number, 'html_url': f'https://github.com/o/r/issues/{number}',
            'created_at': NOW, 'updated_at': NOW, 'closed_at': None, 'state': 'open', 'title': 'Work',
            'body': '', 'user': {'login': 'saadshahd'}, 'labels': [], **fields}


def comment(number, body, at=NOW, login=orders.BOT):
    return row(number, body=body, created_at=at, user={'login': login})


class FakeGitHub:
    repo = 'o/r'

    def __init__(self, issues=None, runs=None):
        self.issues = issues or []
        self.runs = runs or []
        self.responses = {}
        self.reads = []
        self.writes = []
        self.failure = None

    def read(self, path, key=None):
        self.reads.append({'url': 'https://api.github.com/repos/o/r/' + path, 'ids': []})
        if self.failure and self.failure in path:
            raise RuntimeError('GitHub read ' + path)
        if path.startswith('issues?'):
            return self.issues
        if '/runs?' in path:
            # GitHub's run listings filter by workflow file, head branch and creation range.
            workflow = re.match(r'actions/workflows/([^/]+)/runs\?', path)
            branch = re.search(r'[?&]branch=([^&]+)', path)
            match = re.search(r'created=(.+)\.\.(.+)&per_page=', path)
            return [r for r in self.runs if (not workflow or Path(r.get('path', '')).name == workflow[1]) and
                    (not branch or r['head_branch'] == branch[1]) and (not match or
                    retro.timestamp(match[1]) <= retro.timestamp(r['created_at']) <= retro.timestamp(match[2]))]
        return self.responses.get(path, [])

    def object(self, path):
        if path.startswith('actions/runs/'):
            return next(r for r in self.runs if path == f'actions/runs/{r["id"]}')
        return self.responses[path]

    def logs(self, job):
        return self.responses.get(f'logs/{job["id"]}', '')

    def write(self, path, method, **fields):
        self.writes.append((path, method, fields))
        if path == 'issues':
            issue = row(100 + len(self.writes), **fields)
            if 'labels' in fields:
                issue['labels'] = [{'name': label} for label in fields['labels']]
            self.issues.append(issue)
            return issue
        if method == 'PATCH':
            issue = next(i for i in self.issues if path == f'issues/{i["number"]}')
            issue.update(fields)
            return issue
        return row(1000 + len(self.writes), **fields)


def collected(github=None):
    return retro.collect(github or FakeGitHub(), END)


def pr_fixture(number=1, paths=None, **fields):
    issue = row(number, created_at='2026-10-01T00:00:00Z', pull_request={}, state='closed', closed_at=NOW)
    pr = row(number, **({'created_at': issue['created_at'], 'merged_at': NOW, 'closed_at': NOW,
             'head': {'ref': f'build/issue-{number}'}} | fields))
    github = FakeGitHub([issue])
    github.responses[f'pulls/{number}'] = pr
    github.responses[f'pulls/{number}/files?per_page=100'] = [{'filename': p} for p in paths or []]
    return github


def plan(repairs=None):
    return {'analysis': 'Ranked causes with evidence.', 'repairs': repairs or [], 'ask': ''}


def proposal():
    return {'title': 'Bound loop retries', 'evidence': 'Run #12 repeated.', 'body': '''Found: PR #12 repeated a failed run.
Expected: the repeated run stops.
Observer: replay PR #12 and see one run.
Scope: loop/builder.py
Scenarios: L82
Specification: [scenarios/loop-rules.md](https://github.com/o/r/blob/main/scenarios/loop-rules.md)
Key: bound-retry
Priority: 20
Mode: implement
'''}


class Input(unittest.TestCase):
    def test_l106_input_has_a_fixed_window_and_sources(self):
        github = FakeGitHub([row(1)])
        github.responses['issues/1/comments?per_page=100'] = [
            comment(11, orders.STRIKE, START), comment(12, orders.STRIKE, END_TEXT),
            comment(13, orders.STRIKE, '2026-10-11T11:59:59Z')]
        data = collected(github)
        self.assertEqual(data['window'], {'start': START, 'end': END_TEXT, 'interval': '[start, end)'})
        self.assertEqual([c['id'] for c in data['strikes']], [11])
        self.assertEqual(data['strikes'][0]['at'], START)
        self.assertTrue(data['sources'])

    def test_l106_input_reads_all_pages_without_duplicates(self):
        github = retro.GitHub('o/r')
        pages = [[row(1)], [row(1), row(2)]]
        with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(pages))) as run:
            values = github.read('issues?per_page=1')
        self.assertEqual([r['id'] for r in values], [1, 2])
        self.assertIn('--paginate', run.call_args.args[0])
        self.assertEqual(github.reads[0]['pages'], 2)

    def test_l106_input_counts_merged_kinds_and_unmerged_causes(self):
        for paths, body, kind in [(['loop/a.py', 'apps/a'], '', 'loop'), (['docs/a', 'scenarios/a'], '', 'spec'),
                                  (['apps/a'], '', 'product'), ([], 'Scenarios: L106', 'loop'),
                                  ([], 'Scenarios: U1', 'product')]:
            with self.subTest(paths=paths):
                github = pr_fixture(paths=paths, body=body)
                self.assertEqual(collected(github)['merged'][0]['kind'], kind)
        github = pr_fixture(merged_at=None)
        self.assertEqual(collected(github)['unmerged'][0]['cause'], 'unknown')

    def test_l106_input_counts_attempts_nopush_and_strikes(self):
        github = FakeGitHub([row(1)])
        github.responses['issues/1/comments?per_page=100'] = [
            comment(11, '<!-- fix-attempt -->\nFix run https://github.com/o/r/actions/runs/9. It pushed nothing to abc.'),
            comment(12, '<!-- fix-nopush abc -->\nFix run https://github.com/o/r/actions/runs/10 It pushed nothing to abc.'),
            comment(13, '<!-- fix-attempt -->\nFix run https://github.com/o/r/actions/runs/11'),
            *[comment(n, orders.STRIKE) for n in (14, 15, 16)]]
        data = collected(github)
        self.assertEqual(data['numbers']['fix_attempts'], 2)
        self.assertEqual(data['numbers']['fix_nopush'], 2)
        self.assertEqual(data['numbers']['fix_push_unknown'], 1)
        self.assertEqual(data['held_by_strikes'][0]['number'], 1)

    def test_l106_input_counts_main_failures_and_flaky_issues(self):
        run = row(10, name='check', path='.github/workflows/check.yml', head_branch='main', conclusion='failure')
        github = FakeGitHub([row(1, body='Flaky test t1: failures in run #10')], [run])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, name='tests', conclusion='failure', started_at=NOW, completed_at=NOW, steps=[])]
        data = collected(github)
        self.assertEqual(data['main_failures'][0]['failed_jobs'][0]['id'], 20)
        self.assertEqual(data['flaky_issues'][0]['diagnosis'], 'Flaky test t1: failures in run #10')

    def test_l106_input_measures_queue_wait_from_first_job(self):
        runs = [row(10, name='review', path='review.yml', head_branch='main', conclusion=None),
                row(11, name='review', path='review.yml', head_branch='main', conclusion=None)]
        github = FakeGitHub(runs=runs)
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, started_at='2026-10-12T11:03:00Z'), row(21, started_at='2026-10-12T11:01:00Z')]
        data = collected(github)
        self.assertEqual(data['queue_by_workflow']['review']['median_seconds'], 60)
        self.assertEqual(data['queue_by_workflow']['review']['count'], 1)
        self.assertEqual(data['queue'][1]['seconds'], 3600)
        self.assertTrue(data['queue'][1]['still_queued'])

    def test_l106_input_links_model_runs_per_merged_pr(self):
        github = pr_fixture(body='Refs #5', paths=['apps/a'])
        github.runs = [row(10, name='Review build/issue-1', display_title='Review build/issue-1',
            path='.github/workflows/review.yml', head_branch='main', conclusion='success',
            created_at='2026-10-10T11:00:00Z')]
        github.responses['issues/1/comments?per_page=100'] = [comment(30, 'VERDICT: approve\nReviewed-by-Agent: reviewer-10')]
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, name='review-run', steps=[{'name': 'Run anthropics/claude-code-action@v1', 'conclusion': 'success'}],
                started_at=NOW, completed_at=NOW, conclusion='success'),
            row(21, name='post', steps=[], conclusion='success', started_at=NOW, completed_at=NOW)]
        github.responses['logs/21'] = '2026-10-12Z   RAN: true\n'
        data = collected(github)
        self.assertEqual(data['numbers']['model_runs_per_merged_pr'], 1)
        self.assertEqual(data['model_work_by_pr']['1']['review'][0]['id'], 10)
        self.assertEqual(data['queue'], [])

    def test_l106_input_reports_unknown_model_work(self):
        github = pr_fixture(paths=['apps/a'])
        github.runs = [row(10, name='review', display_title='Review build/issue-1', path='review.yml', created_at='2026-10-12T10:00:00Z',
                           head_branch='main', conclusion='success')]
        data = collected(github)
        self.assertEqual(data['numbers']['model_work_unknown'], 1)
        self.assertEqual(data['numbers']['model_runs_per_merged_pr'], 'n/a')

    def test_l106_input_reports_missing_job_log_as_unknown_model_work(self):
        github = pr_fixture(paths=['apps/a'])
        github.runs = [row(10, name='review', display_title='Review build/issue-1', path='review.yml',
                           created_at='2026-10-12T10:00:00Z', head_branch='main', conclusion='success')]
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, name='review-run', steps=[{'name': 'Run anthropics/claude-code-action@v1', 'conclusion': 'success'}],
                started_at=NOW, completed_at=NOW, conclusion='success'),
            row(21, name='post', steps=[], conclusion='success', started_at=NOW, completed_at=NOW)]
        github.responses['logs/21'] = None
        data = collected(github)
        self.assertEqual(data['numbers']['model_work_unknown'], 1)
        self.assertEqual(data['model_work'][0]['worked_evidence'][0]['log'], 'missing')

    def test_l106_input_measures_needs_user_waits(self):
        github = FakeGitHub([row(1)])
        github.responses['issues/1/events?per_page=100'] = [
            row(11, event='labeled', label={'name': orders.NEEDS_USER}, created_at='2026-10-10T12:00:00Z'),
            row(12, event='unlabeled', label={'name': orders.NEEDS_USER}, created_at='2026-10-11T13:00:00Z'),
            row(13, event='labeled', label={'name': orders.NEEDS_USER}, created_at=NOW)]
        data = collected(github)
        self.assertEqual([r['window_seconds'] for r in data['needs_user']], [3600, 3600])
        self.assertEqual(data['needs_user'][0]['total_seconds'], 90000)

    def test_l106_old_closed_retained_label_is_measured_without_reopening_work(self):
        github = FakeGitHub([row(615, state='closed', created_at='2026-10-01T00:00:00Z',
            updated_at='2026-10-10T18:45:46Z', closed_at='2026-10-10T18:45:46Z',
            labels=[{'name': orders.NEEDS_USER}])])
        added = row(11, event='labeled', label={'name': orders.NEEDS_USER},
                    created_at='2026-10-10T17:58:47Z')
        closed = row(12, event='closed', created_at='2026-10-10T18:45:46Z')
        github.responses['issues/615/events?per_page=100'] = [added, closed]
        data = collected(github)
        self.assertEqual(len(data['needs_user']), 1)
        wait = data['needs_user'][0]
        self.assertEqual(wait['window_seconds'], 86400)
        self.assertEqual(wait['added'], retro.source(added))
        self.assertEqual(wait['closed'], [retro.source(closed)])
        self.assertEqual(wait['total_seconds'], 'unknown')
        self.assertEqual(wait['end_evidence'], {'kind': 'fixed_end', 'at': END_TEXT})
        self.assertFalse(wait['open_at_end'])
        self.assertEqual(data['numbers']['needs_user_end_unknown'], 1)
        self.assertEqual(github.writes, [])

    def test_l106_closure_inside_window_does_not_remove_label_boundary(self):
        github = FakeGitHub([row(1295, state='closed', closed_at=NOW,
            created_at='2026-10-10T00:00:00Z', labels=[{'name': orders.NEEDS_USER}])])
        added = row(11, event='labeled', label={'name': orders.NEEDS_USER}, created_at=START)
        closed = row(12, event='closed', created_at=NOW)
        github.responses['issues/1295/events?per_page=100'] = [added, closed]
        data = collected(github)
        wait = data['needs_user'][0]
        self.assertEqual(wait['window_seconds'], 86400)
        self.assertEqual(wait['closed'], [retro.source(closed)])
        self.assertEqual(wait['total_seconds'], 'unknown')
        self.assertEqual(wait['end_evidence']['at'], END_TEXT)

    def test_l106_old_open_label_uses_fixed_end(self):
        github = FakeGitHub([row(1, created_at='2026-10-10T00:00:00Z',
            updated_at='2026-10-10T00:00:00Z', labels=[{'name': orders.NEEDS_USER}])])
        added = row(11, event='labeled', label={'name': orders.NEEDS_USER},
                    created_at='2026-10-10T12:00:00Z')
        github.responses['issues/1/events?per_page=100'] = [added]
        wait = collected(github)['needs_user'][0]
        self.assertEqual(wait['window_seconds'], 86400)
        self.assertEqual(wait['total_seconds'], 172800)
        self.assertEqual(wait['added'], retro.source(added))
        self.assertTrue(wait['open_at_end'])

    def test_l106_removal_evidence_controls_overlap_without_updated_at(self):
        for removed_at, expected in [('2026-10-11T11:59:59Z', []),
                                     ('2026-10-11T13:00:00Z', [3600])]:
            with self.subTest(removed_at=removed_at):
                github = FakeGitHub([row(1, created_at='2026-10-10T00:00:00Z',
                    updated_at='2026-10-10T00:00:00Z')])
                added = row(11, event='labeled', label={'name': orders.NEEDS_USER},
                            created_at='2026-10-10T12:00:00Z')
                removed = row(12, event='unlabeled', label={'name': orders.NEEDS_USER},
                              created_at=removed_at)
                github.responses['issues/1/events?per_page=100'] = [added, removed]
                data = collected(github)
                self.assertEqual([w['window_seconds'] for w in data['needs_user']], expected)
                if expected:
                    self.assertEqual(data['needs_user'][0]['removed'], retro.source(removed))
                    self.assertEqual(data['needs_user'][0]['end_evidence'],
                                     {'kind': 'removal', **retro.source(removed)})

    def test_l106_old_closed_pr_retained_label_uses_same_boundary(self):
        issue = row(2, pull_request={}, state='closed', created_at='2026-10-10T00:00:00Z',
                    updated_at='2026-10-10T01:00:00Z', closed_at='2026-10-10T01:00:00Z',
                    labels=[{'name': orders.NEEDS_USER}])
        github = FakeGitHub([issue])
        github.responses['pulls/2'] = {**issue, 'merged_at': None}
        added = row(11, event='labeled', label={'name': orders.NEEDS_USER},
                    created_at='2026-10-10T00:00:00Z')
        github.responses['issues/2/events?per_page=100'] = [added]
        wait = collected(github)['needs_user'][0]
        self.assertEqual(wait['window_seconds'], 86400)
        self.assertEqual(wait['total_seconds'], 'unknown')
        self.assertEqual(wait['closed_at'], '2026-10-10T01:00:00Z')
        self.assertFalse(wait['open_at_end'])

    def test_l106_missing_closed_boundary_stays_unknown(self):
        github = FakeGitHub([row(1, state='closed', closed_at=None)])
        github.responses['issues/1/events?per_page=100'] = [
            row(11, event='labeled', label={'name': orders.NEEDS_USER}, created_at=START)]
        wait = collected(github)['needs_user'][0]
        self.assertEqual(wait['total_seconds'], 'unknown')
        self.assertEqual(wait['open_at_end'], 'unknown')
        self.assertEqual(wait['window_seconds'], 86400)

    def test_l106_historical_event_read_failure_stops_collection(self):
        github = FakeGitHub([row(1, state='closed', created_at='2026-10-01T00:00:00Z',
            updated_at='2026-10-01T00:00:00Z', closed_at='2026-10-01T00:00:00Z')])
        github.failure = 'issues/1/events?'
        with self.assertRaisesRegex(RuntimeError, 'issues/1/events'):
            collected(github)
        self.assertEqual(github.writes, [])

    def test_l106_input_supplies_owner_comments_and_later_evidence(self):
        github = FakeGitHub([row(1, body='Later body')])
        github.responses['issues/1/comments?per_page=100'] = [comment(11, 'Change direction', login=orders.OWNER)]
        data = collected(github)
        self.assertEqual(data['owner_comments'][0]['body'], 'Change direction')
        self.assertEqual(data['owner_comments'][0]['later_evidence']['issue_body'], 'Later body')

    def test_l106_read_failure_posts_nothing(self):
        github = FakeGitHub([row(1)])
        github.failure = '/comments'
        with self.assertRaisesRegex(RuntimeError, 'comments'):
            collected(github)
        self.assertEqual(github.writes, [])

    def test_l106_empty_window_is_not_a_read_failure(self):
        data = collected()
        self.assertEqual(data['numbers']['merged'], 0)
        self.assertEqual(data['numbers']['model_runs_per_merged_pr'], 'n/a')
        self.assertTrue(data['sources'])

    def test_l106_input_exit_codes(self):
        with patch.object(sys, 'argv', ['retro.py', '--repo', 'o/r', 'input', '--end', 'wrong']):
            with self.assertRaises(SystemExit) as error:
                retro.main()
            self.assertEqual(error.exception.code, 2)
        for stdout, code in [('[]', 4), ('[[]]', 0), ('{"broken":1}', 4), ('[[1]]', 4), ('[[{"id":false}]]', 4)]:
            def response(args, **kwargs):
                value = stdout
                if stdout == '[[]]' and '/runs?' in args[2]:
                    page = {'workflow_runs': [], 'total_count': 0}
                    value = json.dumps(page if '/actions/runs?' in args[2] else [page])
                return subprocess.CompletedProcess(args, 0, value)

            with self.subTest(stdout=stdout), patch.object(sys, 'argv', ['retro.py', '--repo', 'o/r', 'input']), \
                 patch.object(retro.subprocess, 'run', side_effect=response), \
                 patch('builtins.print'):
                self.assertEqual(retro.main(), code)


class Publication(unittest.TestCase):
    def test_l106_first_report_has_no_fake_baseline(self):
        github = FakeGitHub()
        report = retro.publish(github, collected(), plan())
        self.assertTrue(report['body'].startswith(retro.REPORT))
        self.assertIn('Previous: n/a', report['body'])
        self.assertEqual(report['title'], 'Retro 2026-10-12')

    def test_l106_report_separates_label_measurement_from_work_authority(self):
        data = collected()
        report = retro.publish(FakeGitHub(), data, plan())
        self.assertIn(data['needs_user_policy'], report['body'])
        self.assertIn('window seconds measure the label, not whether the work needs action', report['body'])
        self.assertIn('| needs_user_end_unknown | 0 | n/a |', report['body'])

    def test_l106_report_compares_previous_and_closes_it_after_publish(self):
        previous = row(1, title='Retro 2026-10-11', body=retro.REPORT + '\n' + retro.STATE + json.dumps({
            'window': {'start': 'a', 'end': 'b'}, 'numbers': {'merged': 7}, 'repairs': []}) + ' -->')
        github = FakeGitHub([previous])
        report = retro.publish(github, collected(), plan())
        self.assertIn('| merged | 0 | 7 |', report['body'])
        self.assertEqual(github.writes[-1][2], {'state': 'closed', 'state_reason': 'completed'})
        self.assertEqual(github.writes[0][0], 'issues')

    def test_l106_busy_day_report_links_input_without_rendering_thousands_of_runs(self):
        data = collected()
        data['queue_by_workflow'] = {'review': {'count': 2500, 'median_seconds': 5, 'max_seconds': 40,
                                               'still_queued': 0, 'runs': list(range(2500))}}
        report = retro.publish(FakeGitHub(), data, plan())
        self.assertLess(len(report['body']), 65000)
        self.assertNotIn('"runs":', report['body'])
        self.assertIn('2500', report['body'])

    def test_l106_same_date_reuses_the_report(self):
        github = FakeGitHub()
        first = retro.publish(github, collected(), plan())
        second = retro.publish(github, collected(), plan())
        self.assertEqual(first['number'], second['number'])
        self.assertEqual(sum(p == 'issues' for p, _, _ in github.writes), 1)

    def test_l106_repairs_are_bounded_valid_and_cited(self):
        for proposals in ([proposal()] * 4, [{**proposal(), 'body': 'No evidence'}]):
            github = FakeGitHub()
            with self.assertRaises(ValueError):
                retro.publish(github, collected(), plan(proposals))
            self.assertEqual(github.writes, [])
        github = FakeGitHub()
        retro.publish(github, collected(), plan([proposal()]))
        self.assertEqual(github.writes[0][2]['labels'], ['kind:loop', 'area:loop'])

    def test_l106_matching_open_or_recent_closed_issue_gets_a_comment(self):
        for state in ('open', 'closed'):
            with self.subTest(state=state):
                issue = row(1, state=state, closed_at=NOW if state == 'closed' else None,
                            labels=[{'name': 'kind:loop'}])
                github = FakeGitHub([issue])
                retro.publish(github, collected(), plan([{**proposal(), 'match': 1}]))
                self.assertEqual(github.writes[0][0], 'issues/1/comments')
                self.assertEqual(issue['state'], state)

    def test_l106_repeat_dispatch_keeps_the_daily_limit(self):
        github = FakeGitHub()
        retro.publish(github, collected(), plan([{**proposal(), 'title': f'Repair {n}',
            'body': proposal()['body'].replace('bound-retry', f'bound-retry-{n}')} for n in range(3)]))
        before = len(github.writes)
        with self.assertRaisesRegex(ValueError, 'daily'):
            retro.publish(github, collected(), plan([proposal()]))
        self.assertEqual(len(github.writes), before)

    def test_l106_failed_duplicate_search_files_nothing(self):
        github = FakeGitHub()
        github.failure = 'issues?'
        with self.assertRaises(RuntimeError):
            retro.publish(github, collected(), plan([proposal()]))
        self.assertEqual(github.writes, [])


class EvidenceRegression(unittest.TestCase):
    def test_l106_failed_read_reports_cause_without_credentials_or_partial_input(self):
        import contextlib
        import io
        import os
        endpoint = 'repos/o/r/issues?state=all&per_page=100'
        failure = subprocess.CalledProcessError(1, ['gh', 'api', endpoint],
            output='[HTTP/2.0 403 Forbidden\nX-Ratelimit-Remaining: 0\nX-Github-Request-Id: ABC:123\nAuthorization: Bearer workflow-secret\n\n' +
                   '{"message":"API rate limit exceeded", "body":"collected private text"}\n' +
                   'X-Github-Request-Id: collected-body-line\n',
            stderr='gh: API rate limit exceeded (HTTP 403) workflow-secret github_pat_example_secret')
        output, errors = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {'GH_TOKEN': 'workflow-secret'}), \
             patch.object(retro.sys, 'argv', ['retro.py', '--repo', 'o/r', 'input', '--end', END_TEXT]), \
             patch.object(retro.subprocess, 'run', side_effect=failure), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(retro.main(), 4)
        self.assertEqual(output.getvalue(), '')
        self.assertIn(endpoint, errors.getvalue())
        self.assertIn('API rate limit exceeded (HTTP 403)', errors.getvalue())
        self.assertIn('HTTP/2.0 403 Forbidden', errors.getvalue())
        self.assertIn('X-Ratelimit-Remaining: 0', errors.getvalue())
        self.assertIn('X-Github-Request-Id: ABC:123', errors.getvalue())
        self.assertNotIn('workflow-secret', errors.getvalue())
        self.assertNotIn('github_pat_example_secret', errors.getvalue())
        self.assertNotIn('Authorization', errors.getvalue())
        self.assertNotIn('collected private text', errors.getvalue())
        self.assertNotIn('collected-body-line', errors.getvalue())

    def test_l106_historical_check_pages_have_individual_timeouts(self):
        github = retro.GitHub('o/r')
        path = 'actions/workflows/check.yml/runs?per_page=100'
        runs = [row(n, name='check', path='check.yml', head_branch='main', conclusion='failure')
                for n in range(1, 1202)]
        calls = []

        def response(args, **kwargs):
            calls.append(args[2])
            self.assertEqual(kwargs['timeout'], 180)
            # The workflow-token run timed out across historical pages, not one bounded page.
            if '--paginate' in args:
                raise subprocess.TimeoutExpired(args, 180)
            page = int(args[2].split('&page=')[-1])
            return subprocess.CompletedProcess(args, 0, json.dumps({
                'total_count': 1201, 'workflow_runs': runs[(page - 1) * 100:page * 100]}))

        with patch.object(retro.subprocess, 'run', side_effect=response):
            values = github.read(path, 'workflow_runs')
        self.assertEqual([r['id'] for r in values], list(range(1, 1202)))
        self.assertEqual(calls, [f'repos/o/r/{path}&page={n}' for n in range(1, 14)])
        self.assertEqual(github.reads[0]['pages'], 13)

    def test_l106_malformed_historical_page_stops_before_next_read(self):
        github = retro.GitHub('o/r')
        malformed = {'total_count': 100, 'workflow_runs': 'x' * 100}
        with patch.object(retro.subprocess, 'run', side_effect=[
                subprocess.CompletedProcess([], 0, json.dumps(malformed)),
                RuntimeError('unexpected second read')]) as run:
            with self.assertRaisesRegex(RuntimeError, 'expected list'):
                github.read('actions/workflows/check.yml/runs?per_page=100', 'workflow_runs')
        run.assert_called_once()
        self.assertEqual(github.reads, [])
        self.assertEqual(github.cache, {})

    def test_l106_rate_headers_preserve_paginated_input(self):
        github = retro.GitHub('o/r')
        response = '[HTTP/2.0 200 OK\nX-Ratelimit-Remaining: 42\nX-Ratelimit-Reset: 61\n\n' + json.dumps([row(1)]) + ']'
        with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, response)):
            self.assertEqual(github.read('issues?per_page=100'), [row(1)])
        self.assertEqual(github.remaining, 42)

    def test_l106_missing_required_evidence_names_the_read(self):
        github = retro.GitHub('o/r')
        with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '[[{"id":1}]]')):
            with self.assertRaisesRegex(RuntimeError, r'GitHub read repos/o/r/issues.*missing number'):
                github.read('issues?per_page=100')

    def test_l106_low_budget_waits_before_read_without_retry(self):
        github = retro.GitHub('o/r')
        github.remaining, github.reset = 0, 60
        with patch.object(retro.time, 'time', side_effect=[0, 0, 61]), patch.object(retro.time, 'sleep') as sleep, \
             patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '[[]]')) as run:
            self.assertEqual(github.read('issues?per_page=100'), [])
        sleep.assert_called_once_with(60)
        run.assert_called_once()

    def test_l106_filtered_run_limit_splits_the_window(self):
        class Dense(FakeGitHub):
            def read(self, path, key=None):
                if '2026-10-11T12:00:00Z..2026-10-12T12:00:00Z' in path:
                    raise retro.ReadLimit(path)
                return [row(1)]
        self.assertEqual(len(retro.workflow_runs(Dense(), END.replace(day=11), END)), 1)

    def test_l106_file_pages_identify_paths_without_numeric_ids(self):
        github = retro.GitHub('o/r')
        with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0,
            '[[{"filename":"loop/retro.py","sha":"abc"}]]')):
            self.assertEqual(github.read('pulls/1/files?per_page=100')[0]['filename'], 'loop/retro.py')

    def test_l106_cause_links_the_recorded_closure(self):
        github = pr_fixture(merged_at=None)
        cause = comment(11, '<!-- fix-exhausted -->\nPR #1 exhausted fixes')
        github.responses['issues/1/comments?per_page=100'] = [cause]
        self.assertEqual(collected(github)['unmerged'][0]['cause'][0]['html_url'], cause['html_url'])

    def test_l106_exhaustion_cause_is_read_from_the_work_issue(self):
        github = pr_fixture(merged_at=None, body='Refs #5')
        cause = comment(11, '<!-- fix-exhausted #1 -->\nPR #1 used three attempts')
        github.responses['issues/5/comments?per_page=100'] = [cause]
        self.assertEqual(collected(github)['unmerged'][0]['cause'][0]['id'], 11)

    def test_l106_requirements_about_flaky_tests_are_not_diagnoses(self):
        github = FakeGitHub([row(1, body='Found: #1 has no Retro.\nExpected: count flaky test Issues.')])
        self.assertEqual(collected(github)['numbers']['flaky_issues'], 0)

    def test_l106_historical_build_uses_commit_evidence_not_shared_work_issue(self):
        github = pr_fixture(body='Refs #5', paths=['apps/a'])
        github.responses['pulls/1/commits?per_page=100'] = [
            {'sha': 'abc', 'commit': {'message': 'Fix\nAuthor-Agent: builder-10'}}]
        github.runs = [row(n, name='build', path='build.yml', head_branch='main', conclusion='success',
            created_at='2026-10-10T11:00:00Z' if n == 10 else '2026-10-12T10:00:00Z') for n in (10, 11)]
        for n in (10, 11):
            github.responses[f'actions/runs/{n}/jobs?filter=all&per_page=100'] = [
                row(n * 10, name='build #5 / build', started_at=NOW, completed_at=NOW, conclusion='success',
                    steps=[{'name': 'Run Codex', 'conclusion': 'success'}]),
                row(n * 10 + 1, name='build #5 / after', conclusion='success', steps=[], completed_at=NOW)]
            github.responses[f'logs/{n * 10 + 1}'] = 'RAN: true'
        data = collected(github)
        self.assertEqual([r['id'] for r in data['model_work']], [10])

    def test_l106_future_worked_evidence_is_unknown_at_the_fixed_end(self):
        github = pr_fixture(paths=['apps/a'])
        github.runs = [row(10, name='review', display_title='Review build/issue-1', path='review.yml',
                           created_at='2026-10-12T10:00:00Z', head_branch='main', conclusion='success')]
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(21, name='post', conclusion='success', steps=[], completed_at='2026-10-12T13:00:00Z')]
        github.responses['logs/21'] = 'RAN: true'
        self.assertEqual(collected(github)['model_work'][0]['worked'], 'unknown')

    def test_l106_similar_branch_name_does_not_associate_another_pr(self):
        github = pr_fixture(paths=['apps/a'])
        github.runs = [row(10, name='review', display_title='Review build/issue-10', path='review.yml',
                           created_at='2026-10-12T10:00:00Z', head_branch='main', conclusion='success')]
        self.assertEqual(collected(github)['model_work'], [])

    def test_l106_main_failure_can_start_before_the_window(self):
        github = FakeGitHub(runs=[row(10, path='check.yml', name='check', head_branch='main', conclusion='failure',
                                      created_at='2026-10-11T11:00:00Z')])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, name='tests', conclusion='failure', started_at=START, completed_at=NOW, steps=[])]
        self.assertEqual(collected(github)['numbers']['main_failures'], 1)

    def test_l106_successful_rerun_keeps_the_earlier_main_failure(self):
        github = FakeGitHub(runs=[row(10, path='check.yml', name='check', head_branch='main',
                                     conclusion='success', run_attempt=2)])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, run_attempt=1, name='tests', conclusion='failure', started_at=NOW, completed_at=NOW, steps=[]),
            row(21, run_attempt=2, name='tests', conclusion='success', started_at=NOW, completed_at=NOW, steps=[])]
        self.assertEqual(collected(github)['numbers']['main_failures'], 1)

    def test_l106_workflow_wait_groups_variable_run_titles(self):
        github = FakeGitHub(runs=[row(10, path='review.yml', name='Review PR #5',
                                     head_branch='main', conclusion=None)])
        self.assertIn('review', collected(github)['queue_by_workflow'])

    def test_l106_ask_comment_can_follow_the_label(self):
        github = FakeGitHub([row(1)])
        github.responses['issues/1/events?per_page=100'] = [
            row(11, event='labeled', label={'name': orders.NEEDS_USER}, created_at=NOW)]
        ask = comment(12, '<!-- needs-user -->\nChoose the product direction', '2026-10-12T11:00:02Z')
        github.responses['issues/1/comments?per_page=100'] = [ask]
        self.assertEqual(collected(github)['needs_user'][0]['ask']['id'], 12)

    def test_l106_inline_owner_comment_has_pr_change_evidence(self):
        github = pr_fixture(paths=['apps/a'])
        github.responses['pulls/1/comments?per_page=100'] = [comment(11, 'Change this line', login=orders.OWNER)]
        github.responses['pulls/1/commits?per_page=100'] = []
        comments = collected(github)['owner_comments']
        self.assertEqual(comments[0]['later_evidence']['linked_prs'][0]['files'][0]['filename'], 'apps/a')

    def test_l106_skipped_model_does_not_count_as_model_work(self):
        github = pr_fixture(paths=['apps/a'])
        github.runs = [row(10, name='review', display_title='Review build/issue-1', path='review.yml', created_at='2026-10-12T10:00:00Z',
                           head_branch='main', conclusion='success')]
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [
            row(20, name='task', steps=[], conclusion='success'),
            row(21, name='review-run', steps=[], conclusion='skipped')]
        data = collected(github)
        self.assertFalse(data['model_work'][0]['worked'])
        self.assertEqual(data['numbers']['model_work_unknown'], 0)

    def test_l106_repair_after_interrupted_publication_still_consumes_allowance(self):
        github = FakeGitHub([row(n, body='<!-- retro-repair 2026-10-12 -->\nFound: #1',
                                 labels=[{'name': 'kind:loop'}]) for n in range(1, 14)])
        with self.assertRaisesRegex(ValueError, 'daily'):
            retro.publish(github, collected(), plan([proposal()]))
        self.assertEqual(github.writes, [])

    def test_l106_untrusted_marker_cannot_replace_the_report(self):
        github = FakeGitHub([row(1, title='Retro 2026-10-12', body=retro.REPORT,
                                 user={'login': 'outsider'})])
        report = retro.publish(github, collected(), plan())
        self.assertNotEqual(report['number'], 1)
        self.assertEqual(github.writes[0][0], 'issues')

    def test_l106_old_closed_issue_cannot_be_a_match(self):
        github = FakeGitHub([row(1, state='closed', closed_at='2026-10-01T00:00:00Z',
                                 labels=[{'name': 'kind:loop'}])])
        with self.assertRaisesRegex(ValueError, 'match outside'):
            retro.publish(github, collected(), plan([{**proposal(), 'match': 1}]))
        self.assertEqual(github.writes, [])


def failed(code, reason, message):
    return subprocess.CalledProcessError(1, ['gh', 'api'], stderr=f'gh: {message} (HTTP {code})',
        output=f'[HTTP/2.0 {code} {reason}\nX-Github-Request-Id: A:1\n\n{{"message":"{message}"}}]')


class Reads(unittest.TestCase):
    def test_l106_transient_read_failure_gets_another_try(self):
        page = subprocess.CompletedProcess([], 0, json.dumps([[row(1)]]))
        for failure in (failed(503, 'Service Unavailable', 'No server is currently available'),
                        failed(502, 'Bad Gateway', 'Server Error'), subprocess.TimeoutExpired(['gh'], 180),
                        failed(403, 'Forbidden', 'You have exceeded a secondary rate limit')):
            with self.subTest(failure=failure), patch.object(retro.subprocess, 'run', side_effect=[failure, page]) as run, \
                 patch.object(retro.time, 'sleep') as sleep, patch('sys.stderr'):
                self.assertEqual(retro.GitHub('o/r').read('issues?per_page=100'), [row(1)])
            self.assertEqual(run.call_count, 2)
            sleep.assert_called_once()

    def test_l106_missing_job_log_reads_as_none_without_retry(self):
        missing = failed(404, 'The specified blob does not exist.', 'The specified blob does not exist.')
        with patch.object(retro.subprocess, 'run', side_effect=missing) as run, \
             patch.object(retro.time, 'sleep') as sleep, patch('sys.stderr'):
            self.assertIsNone(retro.GitHub('o/r').logs({'id': 7}))
        self.assertEqual(run.call_count, 1)
        sleep.assert_not_called()

    def test_l106_job_log_refusal_fails_loud(self):
        with patch.object(retro.subprocess, 'run', side_effect=failed(401, 'Unauthorized', 'Bad credentials')), \
             patch('sys.stderr'), self.assertRaisesRegex(retro.RequestFailed, 'HTTP 401'):
            retro.GitHub('o/r').logs({'id': 7})

    def test_l106_read_fails_loud_after_five_transient_failures(self):
        import contextlib
        import io
        output, errors = io.StringIO(), io.StringIO()
        endpoint = 'repos/o/r/issues?state=all&per_page=100'
        with patch.object(retro.sys, 'argv', ['retro.py', '--repo', 'o/r', 'input', '--end', END_TEXT]), \
             patch.object(retro.subprocess, 'run', side_effect=failed(503, 'Service Unavailable', 'No server')) as run, \
             patch.object(retro.time, 'sleep') as sleep, \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(retro.main(), 4)
        self.assertEqual(run.call_count, 5)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [5, 10, 20, 40])
        self.assertEqual(output.getvalue(), '')
        self.assertIn(f'Retro failed: GitHub request {endpoint} failed on try 5 of 5', errors.getvalue())
        self.assertIn('HTTP/2.0 503 Service Unavailable', errors.getvalue())

    def test_l106_write_or_lasting_failure_gets_one_try(self):
        for name, call, failure in (
                ('write', lambda g: g.write('issues', 'POST', title='Retro'), failed(502, 'Bad Gateway', 'Server Error')),
                ('missing', lambda g: g.read('issues/1/comments?per_page=100'), failed(404, 'Not Found', 'Not Found')),
                ('hourly budget', lambda g: g.read('issues?per_page=100'), failed(403, 'Forbidden', 'API rate limit exceeded'))):
            with self.subTest(name), patch.object(retro.subprocess, 'run', side_effect=failure) as run, \
                 patch.object(retro.time, 'sleep') as sleep:
                with self.assertRaisesRegex(RuntimeError, 'failed on try 1 of'):
                    call(retro.GitHub('o/r'))
            run.assert_called_once()
            sleep.assert_not_called()

    def test_l106_run_lists_are_bounded_to_the_window(self):
        github = FakeGitHub()
        collected(github)
        lists = [r['url'].removeprefix('https://api.github.com/repos/o/r/') for r in github.reads if '/runs?' in r['url']]
        self.assertEqual(lists, [f'actions/runs?created={START}..{END_TEXT}&per_page=100',
                                 f'actions/workflows/check.yml/runs?branch=main&created=2026-09-11T12:00:00Z..{END_TEXT}'
                                 '&per_page=100'])
        dense = subprocess.CompletedProcess([], 0, json.dumps([{'total_count': 1001, 'workflow_runs': []}]))
        with patch.object(retro.subprocess, 'run', return_value=dense), self.assertRaises(retro.ReadLimit):
            retro.GitHub('o/r').read(lists[1], 'workflow_runs')

    def test_l106_jobs_are_read_only_for_model_runs_and_main_failures(self):
        stems = ('activity', 'check', 'loop', 'qa', 'stall', 'summary', *retro.MODEL_WORKFLOWS)
        runs = [row(n, name=stem, path=f'.github/workflows/{stem}.yml', head_branch='build/x', conclusion='success')
                for n, stem in enumerate(stems, 10)]
        failure = row(99, name='check', path='.github/workflows/check.yml', head_branch='main', conclusion='failure')
        github = FakeGitHub(runs=[*runs, failure])
        data = collected(github)
        jobs = {int(m[1]) for r in github.reads for m in [re.search(r'actions/runs/(\d+)/jobs\?', r['url'])] if m}
        self.assertEqual(jobs, {r['id'] for r in runs if r['name'] in retro.MODEL_WORKFLOWS} | {99})
        self.assertEqual(data['queue_workflows'], list(retro.MODEL_WORKFLOWS))

    def test_l106_model_workflows_are_the_workflows_that_call_a_model(self):
        files = {p.stem: p.read_text() for p in (ROOT.parent / '.github/workflows').glob('*.yml')}
        direct = {stem for stem, text in files.items() if 'claude-code-action' in text or 'Run Codex' in text}
        callers = {stem for stem, text in files.items()
                   if set(re.findall(r'uses: \./\.github/workflows/([\w-]+)\.yml', text)) & direct}
        self.assertEqual(set(retro.MODEL_WORKFLOWS), direct | callers)


if __name__ == '__main__':
    unittest.main()
