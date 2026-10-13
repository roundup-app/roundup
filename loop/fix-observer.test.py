#!/usr/bin/env python3
"""L82 renewed observation: retained evidence, never a fixture-based live closure."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fix_observer', Path(__file__).with_name('fix-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class L82(unittest.TestCase):
    def test_l82_fixed_window_refuses_early_or_short_collection(self):
        for now in ('2026-10-13T21:58:42Z', observer.END):
            with self.assertRaises(ValueError):
                observer.window(now)
        self.assertEqual(observer.window('2026-10-13T21:58:44Z'),
                         {'start': '2026-10-13T15:58:43Z', 'end': '2026-10-13T21:58:43Z'})

# Fixtures use the native GitHub/claim/log shapes, not a parallel observer protocol.
import base64
import copy
from datetime import timedelta
import json
import re
import tempfile
from unittest.mock import patch

HEAD = 'a' * 40
HEAD2 = 'b' * 40
SHA = 'c' * 40
NOW = '2026-10-13T22:01:00Z'


def group(run=10, head=HEAD, cause='review', created='2026-10-13T16:00:00Z', worked=True):
    identity = ['owner/repo', 7, cause, head]
    beginning = '2026-10-13T16:00:01Z'
    ended = '2026-10-13T16:30:00Z'
    original = {'id': run, 'run_attempt': 1, 'event': 'workflow_dispatch', 'created_at': created,
                'display_title': f'Fix PR #7: {cause} @ {head}', 'head_sha': SHA}
    attempt = {**original, 'status': 'completed', 'run_started_at': beginning, 'updated_at': ended,
               'conclusion': 'success'}
    jobs = [{'id': run * 10, 'name': 'branch', 'status': 'completed', 'conclusion': 'success',
             'started_at': beginning, 'completed_at': '2026-10-13T16:00:05Z', 'steps': []},
            {'id': run * 10 + 1, 'name': 'fix / task', 'status': 'completed', 'conclusion': 'success',
             'started_at': '2026-10-13T16:00:10Z', 'completed_at': '2026-10-13T16:00:20Z', 'steps': []},
            {'id': run * 10 + 2, 'name': 'fix / fix-run', 'status': 'completed', 'conclusion': 'success',
             'started_at': '2026-10-13T16:00:20Z', 'completed_at': '2026-10-13T16:29:00Z',
             'steps': [{'name': 'Run Codex', 'conclusion': 'success'}]}]
    state = {'owner': 'fixture', 'phase': 'owned', 'run': run, 'infrastructure': 0,
             'task': {'kind': 'eligible', 'attempt': 1}, 'completions': {'1': 'done'}, 'worked': {'1': worked}}
    return {'identity': identity, 'runs': [original],
            'attempts': [{'run_id': run, 'run_attempt': 1, 'event': 'workflow_dispatch',
                          'created_at': created, 'queued_at': created, 'attempt': attempt, 'jobs': jobs,
                          'summaries': {str(run * 10): 'retained native summary'},
                          'logs': {str(run * 10): f'Fix owner: run {run}, run_attempt 1.\n',
                                   str(run * 10 + 1): 'Fix acquired branch `build/example`; task preparation waits.'}}],
            'ownership': [{'sha': SHA, 'at': beginning, 'state': state}],
            'comments': [{'id': run, 'user': {'login': 'github-actions[bot]'}, 'created_at': ended,
                          'body': '<!-- fix-attempt -->\nFix run https://github.com/owner/repo/actions/runs/'
                                  f'{run}/attempts/1 answered `{cause}`.'}] if worked else [],
            'pr': {'head': {'ref': 'build/example', 'repo': {'full_name': 'owner/repo'}}, 'base': {'ref': 'main'}},
            'gates': [{'type': 'required_status_checks', 'parameters': {'required_status_checks':
                       [{'context': name} for name in ('check', 'rules', 'review', 'critic')]}}],
            'build_definition': {'content': base64.b64encode(b'group: branch-build/${{ inputs.slug }}\ncancel-in-progress: false').decode()},
            'branch_definitions': {str(run): {'content': base64.b64encode(b'group: branch-${{ inputs.branch }}\ncancel-in-progress: false').decode()}},
            'definitions': {str(run): {'content': base64.b64encode(b'# L82 retry-contract: 1').decode()}}}


def evidence(*groups):
    return {'window': {'start': observer.START, 'end': observer.END}, 'collected_at': NOW,
            'collector_commit': SHA, 'run_id': 100, 'run_attempt': 1, 'repository': 'owner/repo',
            'historical': observer.HISTORICAL, 'errors': [], 'identities': list(groups)}


class L82Criteria(unittest.TestCase):
    def criterion(self, data, name):
        return observer.assess(data)['criteria'][name]['result']

    def test_l82_raw_dispatch_and_run_attempt_accounting_are_separate(self):
        g = group()
        second = copy.deepcopy(g['attempts'][0])
        second.update(run_attempt=2, queued_at='2026-10-13T17:00:00Z')
        second['attempt'].update(run_attempt=2, run_started_at='2026-10-13T17:00:01Z', updated_at='2026-10-13T17:30:00Z')
        second['jobs'][0]['started_at'] = '2026-10-13T17:00:01Z'
        second['jobs'][1]['started_at'] = '2026-10-13T17:00:10Z'
        second['logs']['100'] = 'Fix owner: run 10, run_attempt 2.'
        g['attempts'].append(second)
        state = copy.deepcopy(g['ownership'][0]['state'])
        state.update(phase='rerun', attempt=1)
        g['ownership'].append({'sha': HEAD, 'at': second['queued_at'], 'state': state})
        state = copy.deepcopy(state)
        state.update(phase='owned', task={'kind': 'eligible', 'attempt': 2}, completions={'1': 'done', '2': 'done'},
                     worked={'1': True, '2': True})
        g['ownership'].append({'sha': HEAD2, 'at': second['attempt']['updated_at'], 'state': state})
        g['comments'].append({'id': 11, 'user': {'login': 'github-actions[bot]'}, 'created_at': second['attempt']['updated_at'],
                              'body': '<!-- fix-attempt -->\nFix run https://github.com/owner/repo/actions/runs/10/attempts/2 answered `review`.'})
        result = observer.assess(evidence(g))
        self.assertEqual(result['counts'][0]['window_dispatches'], [10])
        self.assertEqual(result['counts'][0]['worked'], 2)
        self.assertEqual(result['counts'][0]['counted'], 2)
        self.assertEqual(result['criteria']['eligible sequential retry']['result'], 'pass')
        self.assertEqual(result['criteria']['worked-attempt accounting and limits']['result'], 'pass')
        # A replayed completion state changes no count; duplicate PR completion comments are a defect.
        g['ownership'].append(copy.deepcopy(g['ownership'][-1]))
        self.assertEqual(observer.assess(evidence(g))['counts'][0]['counted'], 2)
        g['comments'].append(copy.deepcopy(g['comments'][-1]))
        self.assertEqual(self.criterion(evidence(g), 'worked-attempt accounting and limits'), 'incomplete')

    def test_l82_prior_repeats_alone_do_not_fail_but_new_dispatch_does(self):
        g = group(created='2026-10-13T15:00:00Z')
        g['runs'].append({**g['runs'][0], 'id': 9, 'created_at': '2026-10-13T14:00:00Z'})
        self.assertEqual(self.criterion(evidence(g), 'literal dispatch count'), 'pass')
        g['runs'].append({**g['runs'][0], 'id': 11, 'created_at': '2026-10-13T17:00:00Z'})
        self.assertEqual(self.criterion(evidence(g), 'literal dispatch count'), 'fail')

    def test_l82_rejected_repeat_dispatch_still_fails_raw_count(self):
        g = group()
        g['runs'].append({**g['runs'][0], 'id': 11})
        self.assertEqual(self.criterion(evidence(g), 'literal dispatch count'), 'fail')

    def test_l82_adopted_workflow_run_owns_identity(self):
        g = group(created='2026-10-13T15:00:00Z')
        g['runs'][0]['event'] = 'workflow_run'
        self.assertEqual(self.criterion(evidence(g), 'literal dispatch count'), 'pass')
        g['runs'].append({**g['runs'][0], 'id': 11, 'event': 'workflow_dispatch',
                          'created_at': '2026-10-13T17:00:00Z'})
        self.assertEqual(self.criterion(evidence(g), 'literal dispatch count'), 'fail')
        self.assertEqual(observer.assess(evidence(g))['counts'][0]['adopted_owners'], [10])

    def test_l82_carry_in_and_queued_reruns_after_end_are_relevant(self):
        attempt = group()['attempts'][0]['attempt']
        self.assertTrue(observer.relevant(attempt, '2026-10-13T15:00:00Z'))
        attempt.update(run_started_at='2026-10-13T22:00:00Z', updated_at='2026-10-13T23:00:00Z')
        self.assertTrue(observer.relevant(attempt, '2026-10-13T21:58:42Z'))
        self.assertFalse(observer.relevant(attempt, observer.END))
        attempt.update(run_started_at='2026-10-13T15:00:00Z', updated_at=observer.START)
        self.assertFalse(observer.relevant(attempt, '2026-10-13T14:00:00Z'))

    def test_l82_live_exclusion_rejects_identity_and_branch_overlap(self):
        g = group()
        duplicate = copy.deepcopy(g['attempts'][0])
        duplicate['run_id'] = 11
        duplicate['logs']['100'] = 'Fix owner: run 11, run_attempt 1.'
        g['attempts'].append(duplicate)
        g['branch_definitions']['11'] = g['branch_definitions']['10']
        self.assertEqual(self.criterion(evidence(g), 'live exclusion'), 'fail')
        self.assertEqual(self.criterion(evidence(group(), group(run=11, head=HEAD2)), 'live exclusion'), 'fail')

    def test_l82_duplicate_rejection_needs_live_matching_holder_before_queue(self):
        g = group()
        duplicate = copy.deepcopy(g['attempts'][0])
        duplicate.update(run_id=11, queued_at='2026-10-13T16:05:00Z')
        duplicate['jobs'] = [duplicate['jobs'][0]]
        duplicate['jobs'][0]['started_at'] = '2026-10-13T16:05:01Z'
        duplicate['logs'] = {'110': f'Skip fix: PR #7, cause review, head `{HEAD}` already held by run 10.'}
        g['attempts'].append(duplicate)
        self.assertEqual(self.criterion(evidence(g), 'duplicate rejection'), 'pass')
        duplicate['logs']['110'] = f'Skip fix: PR #7, cause review, head `{HEAD}` already held by run 999.'
        self.assertEqual(self.criterion(evidence(g), 'duplicate rejection'), 'incomplete')

    def test_l82_distinct_head_and_cause_both_need_live_examples(self):
        first, second, third = group(), group(run=11, head=HEAD2), group(run=12, cause='critic')
        self.assertEqual(self.criterion(evidence(first, second), 'distinct identities'), 'incomplete')
        self.assertEqual(self.criterion(evidence(first, second, third), 'distinct identities'), 'pass')

    def test_l82_missing_evidence_unfinished_and_unknown_delivery_never_pass(self):
        for change in ('log', 'ownership', 'pending', 'unfinished', 'queue'):
            g = group()
            if change == 'log':
                g['attempts'][0]['logs'] = {}
            elif change == 'ownership':
                g['ownership'] = []
            elif change == 'pending':
                g['ownership'][0]['state']['phase'] = 'dispatch'
            elif change == 'unfinished':
                g['attempts'][0]['attempt']['status'] = 'in_progress'
            else:
                data = evidence(g)
                data['errors'].append('unknown attempt queue time')
                self.assertEqual(self.criterion(data, 'complete bounded evidence'), 'incomplete')
                continue
            self.assertEqual(self.criterion(evidence(g), 'complete bounded evidence'), 'incomplete', change)

    def test_l82_accounting_exemptions_limits_and_setup_failures(self):
        for marker, cause, expected in (('fix-nopush ' + HEAD, 'unfinished', 'nopush'),
                                        ('fix-conflict ' + HEAD, 'conflict', 'conflict'),
                                        ('fix-refresh ' + HEAD, 'rules', 'refresh')):
            g = group(cause=cause)
            g['comments'][0]['body'] = g['comments'][0]['body'].replace('fix-attempt', marker)
            result = observer.assess(evidence(g))
            self.assertEqual(result['counts'][0][expected], 1)
            self.assertEqual(result['criteria']['worked-attempt accounting and limits']['result'], 'pass')
        g = group(worked=False)
        self.assertEqual(observer.assess(evidence(g))['counts'][0]['worked'], 0)
        g['ownership'][0]['state']['infrastructure'] = 7
        self.assertEqual(self.criterion(evidence(g), 'worked-attempt accounting and limits'), 'incomplete')
        g = group()
        g['comments'] += [{'id': n, 'user': {'login': 'github-actions[bot]'}, 'created_at': '2026-10-13T15:00:00Z', 'body': '<!-- fix-attempt -->'} for n in range(3)]
        self.assertEqual(self.criterion(evidence(g), 'worked-attempt accounting and limits'), 'incomplete')

    def test_l82_missing_or_malformed_counters_are_unknown_not_zero(self):
        g = group()
        del g['ownership'][0]['state']['infrastructure']
        result = observer.assess(evidence(g))
        self.assertIsNone(result['counts'][0]['infrastructure'])
        self.assertEqual(result['criteria']['worked-attempt accounting and limits']['result'], 'incomplete')
        g = group()
        g['ownership'][0]['state']['worked']['1'] = 'false'
        self.assertEqual(self.criterion(evidence(g), 'worked-attempt accounting and limits'), 'incomplete')

    def test_l82_public_comments_cannot_forge_native_attempt_accounting(self):
        g = group()
        g['comments'].extend({'id': n, 'user': {'login': 'outside-contributor'},
                              'created_at': '2026-10-13T15:00:00Z', 'body': '<!-- fix-attempt --> forged'}
                             for n in range(4))
        result = observer.assess(evidence(g))
        self.assertEqual(result['counts'][0]['counted'], 1)
        self.assertEqual(result['criteria']['worked-attempt accounting and limits']['result'], 'pass')

    def test_l82_required_gates_and_absent_live_examples_keep_acceptance_open(self):
        g = group()
        g['gates'][0]['parameters']['required_status_checks'].pop()
        self.assertEqual(self.criterion(evidence(g), 'required gates'), 'fail')
        result = observer.assess(evidence())
        self.assertEqual(result['result'], 'incomplete')
        self.assertEqual(result['criteria']['duplicate rejection']['result'], 'incomplete')
        self.assertEqual(result['criteria']['eligible sequential retry']['result'], 'incomplete')
        self.assertEqual(result['criteria']['distinct identities']['result'], 'incomplete')


class Pages(observer.GitHub):
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path, binary=False):
        self.calls.append(path)
        return self.responses(path)


class L82Reads(unittest.TestCase):
    def test_l82_pagination_retains_later_pages_and_repeated_ids_once(self):
        def responses(path):
            page = int(path.rsplit('=', 1)[1])
            return {'jobs': [{'id': n} for n in range(100)] if page == 1 else [{'id': 99}, {'id': 100}],
                    'total_count': 101}
        github = Pages(responses)
        self.assertEqual(len(github.all('actions/runs/7/attempts/2/jobs', 'jobs')), 101)
        self.assertEqual(len(github.calls), 2)
        self.assertTrue(all('/attempts/2/jobs' in path for path in github.calls))

    def test_l82_caps_partition_and_one_second_truncation_refuses(self):
        def responses(path):
            if '15%3A58%3A43Z..2026-10-13T15%3A58%3A45Z' in path:
                return {'workflow_runs': [{'id': n} for n in range(100)], 'total_count': 1500}
            return {'workflow_runs': [{'id': 200}], 'total_count': 1}
        github = Pages(responses)
        # Repeated page data must be refused, not silently treated as an empty page.
        with self.assertRaises(ValueError):
            github.listing(observer.timestamp(observer.START), observer.timestamp(observer.START) + timedelta(seconds=2))
        github = Pages(lambda path: {'workflow_runs': [{'id': n} for n in range(100)], 'total_count': 1001})
        with self.assertRaises(ValueError):
            github.listing(observer.timestamp(observer.START), observer.timestamp(observer.START))

    def test_l82_search_cap_splits_into_complete_adjacent_ranges(self):
        def responses(path):
            page = int(path.rsplit('=', 1)[1])
            if '15%3A58%3A43Z..2026-10-13T15%3A58%3A45Z' in path:
                total, offset = 1500, 0
            elif '15%3A58%3A43Z..2026-10-13T15%3A58%3A44Z' in path:
                total, offset = 1000, 0
            elif '15%3A58%3A45Z..2026-10-13T15%3A58%3A45Z' in path:
                total, offset = 500, 1000
            else:
                raise AssertionError(path)
            return {'workflow_runs': [{'id': offset + n} for n in range((page - 1) * 100, page * 100)],
                    'total_count': total}
        github = Pages(responses)
        rows = github.listing(observer.timestamp(observer.START), observer.timestamp(observer.START) + timedelta(seconds=2))
        self.assertEqual(len(rows), 1500)
        self.assertEqual(rows[0]['id'], 0)
        self.assertEqual(rows[-1]['id'], 1499)
        self.assertEqual(len(github.calls), 25)

    def test_l82_partition_totals_must_reconcile_the_capped_parent(self):
        def responses(path):
            page = int(path.rsplit('=', 1)[1])
            if '15%3A58%3A43Z..2026-10-13T15%3A58%3A45Z' in path:
                return {'workflow_runs': [{'id': n} for n in range((page - 1) * 100, page * 100)],
                        'total_count': 1500}
            return {'workflow_runs': [{'id': 2000 + page}], 'total_count': 1}
        with self.assertRaisesRegex(ValueError, 'partition'):
            Pages(responses).listing(observer.timestamp(observer.START), observer.timestamp(observer.START) + timedelta(seconds=2))

    def test_l82_raw_pages_logs_and_hash_manifest_survive_reads(self):
        import subprocess
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            github = observer.GitHub('owner/repo', directory)
            outputs = [json.dumps({'jobs': [{'id': n} for n in range(100)], 'total_count': 101}).encode(),
                       json.dumps({'jobs': [{'id': 100}], 'total_count': 101}).encode(), b'native job log']
            outputs[0] = (b'HTTP/2.0 200 OK\r\nLink: <https://api.github.com/repos/owner/repo/actions/runs/10/attempts/2/jobs?per_page=100&page=2>; rel="next"\r\n\r\n' + outputs[0])
            outputs[1] = b'HTTP/2.0 200 OK\r\n\r\n' + outputs[1]
            results = [subprocess.CompletedProcess(['gh'], 0, raw, b'') for raw in outputs]
            with patch.object(observer.subprocess, 'run', side_effect=results):
                self.assertEqual(len(github.all('actions/runs/10/attempts/2/jobs', 'jobs')), 101)
                self.assertEqual(github.get('actions/jobs/100/logs', binary=True), b'native job log')
            reads = json.loads((directory / 'reads.json').read_text())
            self.assertEqual(len(reads), 3)
            self.assertTrue(reads[0]['path'].endswith('page=1'))
            self.assertTrue(reads[1]['path'].endswith('page=2'))
            self.assertEqual([(directory / row['file']).read_bytes() for row in reads], outputs)
            for row in reads:
                self.assertEqual(observer.hashlib.sha256((directory / row['file']).read_bytes()).hexdigest(), row['sha256'])

    def test_l82_follows_next_links_even_when_a_page_is_short(self):
        import subprocess
        first = (b'HTTP/2.0 200 OK\r\nLink: <https://api.github.com/repos/owner/repo/issues/7/comments?per_page=100&page=2>; rel="next"\r\n\r\n'
                 + json.dumps([{'id': 1}]).encode())
        second = b'HTTP/2.0 200 OK\r\n\r\n' + json.dumps([{'id': 2}]).encode()
        with tempfile.TemporaryDirectory() as temp:
            github = observer.GitHub('owner/repo', Path(temp))
            with patch.object(observer.subprocess, 'run', side_effect=[
                    subprocess.CompletedProcess(['gh'], 0, first, b''),
                    subprocess.CompletedProcess(['gh'], 0, second, b'')]):
                self.assertEqual(github.all('issues/7/comments'), [{'id': 1}, {'id': 2}])
            self.assertEqual(len(github.manifest), 2)

    def test_l82_unreadable_page_or_log_does_not_become_zero(self):
        def responses(path):
            raise OSError('expired log or unreadable page')
        with self.assertRaises(OSError):
            Pages(responses).all('actions/runs/7/attempts/2/jobs', 'jobs')
        with self.assertRaises(OSError):
            Pages(responses).get('actions/jobs/1/logs', binary=True)


class Collection:
    repo = 'owner/repo'

    def __init__(self):
        self.calls = []
        self.group = group(created='2026-10-13T15:00:00Z')
        self.group['runs'][0]['run_attempt'] = 2
        self.attempts = {1: copy.deepcopy(self.group['attempts'][0]['attempt']),
                         2: copy.deepcopy(self.group['attempts'][0]['attempt'])}
        self.attempts[2].update(run_attempt=2, run_started_at='2026-10-13T22:00:00Z',
                                updated_at='2026-10-13T22:00:30Z')
        self.claims = copy.deepcopy(self.group['ownership'])
        pending = copy.deepcopy(self.claims[0]['state'])
        pending.update(phase='rerun', attempt=1)
        self.claims.append({'sha': HEAD, 'at': '2026-10-13T21:58:42Z', 'state': pending})

    def listing(self, start, end):
        self.calls.append(('listing', observer.utc(start), observer.utc(end)))
        return copy.deepcopy(self.group['runs'])

    def get(self, path, binary=False):
        self.calls.append(path)
        if path == f'actions/artifacts/{observer.HISTORICAL["artifact"]}':
            return {'expired': False, 'expires_at': '2026-10-20T08:27:10Z'}
        if path == f'actions/artifacts/{observer.HISTORICAL["artifact"]}/zip':
            raw = observer.io.BytesIO()
            with observer.zipfile.ZipFile(raw, 'w') as archive:
                archive.writestr('report.md', 'Historical fail: 48 dispatches, eight repeated identities.')
            return raw.getvalue()
        if path == 'actions/workflows/fix.yml':
            return {'created_at': '2026-10-09T21:51:03.000Z'}
        if '/attempts/' in path:
            return copy.deepcopy(self.attempts[int(path.rsplit('/', 1)[1])])
        if path.startswith('check-runs/'):
            return {'output': {'summary': 'native summary'}}
        if '/logs' in path:
            return b'Fix owner: run 10, run_attempt 1. summary'
        if path == 'pulls/7':
            return copy.deepcopy(self.group['pr'])
        if path == 'rules/branches/main':
            return copy.deepcopy(self.group['gates'])
        if path.startswith('contents/'):
            if 'fix-branch.yml' in path:
                return self.group['branch_definitions']['10']
            if 'build-issue.yml' in path:
                return self.group['build_definition']
            return self.group['definitions']['10']
        raise AssertionError(path)

    def all(self, path, key=None):
        self.calls.append(path)
        if path.endswith('/jobs'):
            return copy.deepcopy(self.group['attempts'][0]['jobs'])
        if path.endswith('/comments'):
            return copy.deepcopy(self.group['comments'])
        if path.endswith('/artifacts'):
            return []
        if path.startswith('rulesets?'):
            return []
        raise AssertionError(path)


class L82Collection(unittest.TestCase):
    def test_l82_collects_older_carry_in_and_attempt_queued_in_window_started_later(self):
        github = Collection()
        with patch.object(observer, 'ownership', return_value={tuple(github.group['identity']): github.claims}):
            data = observer.collect(github, NOW, SHA, 100, 1)
        rows = data['identities'][0]['attempts']
        self.assertEqual([(r['run_id'], r['run_attempt']) for r in rows], [(10, 1), (10, 2)])
        self.assertEqual(rows[1]['queued_at'], '2026-10-13T21:58:42Z')
        self.assertEqual(rows[1]['attempt']['run_started_at'], '2026-10-13T22:00:00Z')
        self.assertIn('actions/runs/10/attempts/1/jobs', github.calls)
        self.assertIn('actions/runs/10/attempts/2/jobs', github.calls)
        self.assertIn('issues/7/comments', github.calls)
        self.assertEqual(github.calls[1][1], '2026-10-09T21:51:03Z')
        self.assertEqual(data['historical']['result'], 'fail')

    def test_l82_claim_intent_is_not_silently_reported_as_proven_rerun_queue_time(self):
        github = Collection()
        with patch.object(observer, 'ownership', return_value={tuple(github.group['identity']): github.claims}):
            data = observer.collect(github, NOW, SHA, 100, 1)
        self.assertIn('actual rerun queue time unproved (claim intent only): 10/2', data['errors'])
        self.assertEqual(observer.assess(data)['criteria']['complete bounded evidence']['result'], 'incomplete')
        github.attempts[2]['created_at'] = '2026-10-13T21:58:42Z'
        with patch.object(observer, 'ownership', return_value={tuple(github.group['identity']): github.claims}):
            data = observer.collect(github, NOW, SHA, 100, 1)
        self.assertEqual(data['errors'], [])
        self.assertEqual(data['identities'][0]['attempts'][1]['queue_source'], 'native attempt creation')

    def test_l82_prior_completed_attempt_is_retained_as_context_not_window_work(self):
        github = Collection()
        github.attempts[1].update(run_started_at='2026-10-13T15:00:01Z', updated_at='2026-10-13T15:30:00Z')
        with patch.object(observer, 'ownership', return_value={tuple(github.group['identity']): github.claims}):
            data = observer.collect(github, NOW, SHA, 100, 1)
        rows = data['identities'][0]['attempts']
        self.assertEqual([row['in_window'] for row in rows], [False, True])
        self.assertIn('actions/runs/10/attempts/1/jobs', github.calls)
        self.assertEqual(observer.assess(data)['counts'][0]['run_attempt_count'], 1)

    def test_l82_malformed_run_attempt_count_cannot_silently_omit_attempts(self):
        github = Collection()
        github.group['runs'][0]['run_attempt'] = 0
        with patch.object(observer, 'ownership', return_value={}):
            with self.assertRaisesRegex(ValueError, 'run/attempt'):
                observer.collect(github, NOW, SHA, 100, 1)

    def test_l82_unknown_rerun_queue_or_unfinished_attempt_is_incomplete(self):
        github = Collection()
        github.attempts[2]['status'] = 'queued'
        with patch.object(observer, 'ownership', return_value={tuple(github.group['identity']): github.claims[:1]}):
            data = observer.collect(github, NOW, SHA, 100, 1)
        self.assertIn('unknown attempt queue time: 10/2', data['errors'])
        self.assertEqual(observer.assess(data)['criteria']['complete bounded evidence']['result'], 'incomplete')

    def test_l82_unknown_delivery_without_any_matching_run_is_incomplete(self):
        github = Collection()
        orphan = ('owner/repo', 99, 'critic', HEAD2)
        claim = [{'sha': SHA, 'at': '2026-10-13T17:00:00Z',
                  'state': {'phase': 'dispatch', 'owner': 'lost-request', 'run': None}}]
        with patch.object(observer, 'ownership', return_value={tuple(github.group['identity']): github.claims, orphan: claim}):
            data = observer.collect(github, NOW, SHA, 100, 1)
        self.assertEqual(data['unresolved_ownership'][0]['identity'], list(orphan))
        self.assertEqual(observer.assess(data)['criteria']['literal dispatch count']['result'], 'incomplete')

    def test_l82_earlier_ownership_history_is_retained_to_main_parent(self):
        github = Pages(lambda path: [])
        github.repo = 'owner/repo'
        states = {'old': {'message': json.dumps({'owner': 'x', 'phase': 'owned', 'run': 1}),
                          'committer': {'date': '2026-10-13T14:00:00Z'}, 'parents': [{'sha': 'main'}]},
                  'new': {'message': json.dumps({'owner': 'x', 'phase': 'owned', 'run': 1, 'infrastructure': 1}),
                          'committer': {'date': '2026-10-13T17:00:00Z'}, 'parents': [{'sha': 'old'}]},
                  'main': {'message': 'Reviewed main commit'}}
        def responses(path):
            if path.startswith('git/matching-refs/'):
                return [{'ref': f'refs/heads/loop-fix/7/review/{HEAD}', 'object': {'sha': 'new'}}]
            return states[path.rsplit('/', 1)[1]]
        github.responses = responses
        claims = observer.ownership(github)
        self.assertEqual([row['sha'] for row in claims[('owner/repo', 7, 'review', HEAD)]], ['old', 'new'])



class Publisher:
    repo = 'owner/repo'

    def __init__(self):
        self.writes = []
        self.artifact = {'name': 'l82-post-1452-1', 'expired': False, 'workflow_run': {'id': 100},
                         'created_at': NOW, 'expires_at': '2027-01-11T22:01:00Z'}
        self.run = {'head_branch': 'main', 'head_sha': SHA, 'run_attempt': 1,
                    'path': '.github/workflows/fix-observer.yml', 'event': 'workflow_dispatch'}

    def object(self, path):
        if path.startswith('actions/artifacts/'):
            return self.artifact
        if path.startswith('actions/runs/'):
            return self.run
        return {'state': 'open'}

    def write(self, path, body):
        self.writes.append((path, body))


class L82Publication(unittest.TestCase):
    def retained(self, directory):
        (directory / 'reads.json').write_text('[]')
        data = evidence(group())
        observer.retain(directory, data, observer.assess(data))

    def test_l82_retention_upload_and_trusted_publication_refusal(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.retained(directory)
            for fault in ('expired', 'short', 'wrongrun', 'branch', 'sha', 'workflow', 'attempt', 'manifest'):
                github = Publisher()
                if fault == 'expired':
                    github.artifact['expired'] = True
                elif fault == 'short':
                    github.artifact['expires_at'] = '2026-10-14T22:01:00Z'
                elif fault == 'wrongrun':
                    github.artifact['workflow_run']['id'] = 999
                elif fault == 'branch':
                    github.run['head_branch'] = 'build/evil'
                elif fault == 'sha':
                    github.run['head_sha'] = HEAD
                elif fault == 'workflow':
                    github.run['path'] = '.github/workflows/fix.yml'
                elif fault == 'attempt':
                    github.run['run_attempt'] = 2
                else:
                    (directory / 'report.md').write_text('fake pass')
                with self.assertRaises(ValueError, msg=fault):
                    observer.publish(github, directory, 99)
                self.assertEqual(github.writes, [])
                self.retained(directory)

    def test_l82_publishes_both_results_after_upload_and_never_closes(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.retained(directory)
            github = Publisher()
            observer.publish(github, directory, 99)
            self.assertEqual([path for path, _ in github.writes], ['issues/1290/comments', 'issues/1350/comments'])
            for _, body in github.writes:
                self.assertIn('**fail**, 48 dispatches, eight repeated identities', body['body'])
                self.assertIn('**incomplete**', body['body'])
                self.assertIn('artifacts/99', body['body'])
                self.assertIn('before the earliest expiry', body['body'])
                self.assertIn('2026-10-13T21:58:43Z', body['body'])

    def test_l82_silent_shorter_window_substitution_refuses_publication(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'reads.json').write_text('[]')
            data = evidence(group())
            data['window']['start'] = '2026-10-13T17:00:00Z'
            observer.retain(directory, data, observer.assess(data))
            github = Publisher()
            with self.assertRaisesRegex(ValueError, 'window substitution'):
                observer.publish(github, directory, 99)
            self.assertEqual(github.writes, [])

    def test_l82_complete_contents_have_a_reviewed_preservation_deadline(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.retained(directory)
            plan = json.loads((directory / 'preservation.json').read_text())
            self.assertEqual(plan['owner_issue'], 1350)
            self.assertEqual(plan['minimum_retention_days'], 90)
            self.assertTrue(plan['complete_contents_required'])
            self.assertTrue(plan['reviewed_pr_required'])
            self.assertEqual(plan['preserve_by'], '2027-01-11T22:01:00Z')
            self.assertIn(observer.HISTORICAL['url'], plan['artifacts'])
            self.assertIn('preservation.json', json.loads((directory / 'manifest.json').read_text()))

    def test_l82_durable_preservation_precedes_the_historical_artifacts_earlier_expiry(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'reads.json').write_text('[]')
            data = evidence(group())
            data['historical_artifact'] = {'expires_at': '2026-10-20T08:27:10Z'}
            observer.retain(directory, data, observer.assess(data))
            self.assertEqual(json.loads((directory / 'preservation.json').read_text())['preserve_by'],
                             '2026-10-20T08:27:10Z')
            github = Publisher()
            observer.publish(github, directory, 99)
            self.assertIn('deadline: 2026-10-20T08:27:10Z', github.writes[0][1]['body'])

    def test_l82_publication_failure_stops_remaining_writes(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.retained(directory)
            github = Publisher()
            with patch.object(github, 'write', side_effect=OSError('publication refused')):
                with self.assertRaises(OSError):
                    observer.publish(github, directory, 99)
            self.assertEqual(github.writes, [])

    def test_l82_workflow_authority_and_upload_before_publication(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/fix-observer.yml').read_text()
        self.assertIn('retention-days: 90', workflow)
        self.assertIn('needs: collect', workflow)
        self.assertIn("needs.collect.result == 'success'", workflow)
        self.assertLess(workflow.index('actions/upload-artifact@v4'), workflow.index('  publish:'))
        collection = workflow.split('  collect:', 1)[1].split('  publish:', 1)[0]
        self.assertEqual(re.findall(r'\w[\w-]*: write', collection), ['id-token: write'])
        self.assertIn('python3 loop/builder.py read-token', collection)
        publication = workflow.split('  publish:', 1)[1].split('  summary:', 1)[0]
        self.assertEqual(re.findall(r'\w[\w-]*: write', publication), ['issues: write'])
        for forbidden in ('claude-code-action', 'codex', 'dispatch_fix', 'gh pr merge', 'statuses/'):
            self.assertNotIn(forbidden, workflow)


if __name__ == '__main__':
    unittest.main()
