#!/usr/bin/env python3
"""L107: Care collects complete evidence and publishes bounded Work Issues."""
import importlib.util
from pathlib import Path
import sys
import unittest
from datetime import timedelta
import subprocess

sys.path.insert(0, str(Path(__file__).parent))
import retro

spec = importlib.util.spec_from_file_location('retro_tests', Path(__file__).with_name('retro.test.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


def input_fixture(count=1, category='size_files'):
    import care
    rows = [dict(id=f'evidence-{n}', category=category, sha='a'*40,
                 files=['loop/example.py'], locations=[dict(path='loop/example.py', start=1, end=10)],
                 observation=dict(lines=10), tool_version='fixture 1', invocation='python3 fixture.py',
                 reproduce='python3 fixture.py', sources=['https://github.com/o/r/blob/'+'a'*40+'/loop/example.py#L1-L10'])
            for n in range(count)]
    return dict(schema=1, sha='a'*40, window=dict(start='2026-10-05T12:00:00Z', end=fixtures.END_TEXT,
                interval='[start, end)'), findings=rows,
                categories={c: [r['id'] for r in rows if r['category'] == c] for c in care.CATEGORIES},
                inventory=dict(tests=[]), repair_candidates=[], open_pr_paths={}, daily_created=[], daily_remaining=3)


def plan_fixture(data, disposition='deferred'):
    return dict(entries=[dict(id=r['id'], cost='10 observed lines; estimated repair 5 minutes',
        explanation='Repeated maintenance cost', module='loop', disposition=disposition) for r in data['findings']], ask='')


def proposal_fixture(data, index=0):
    row = data['findings'][index]
    return dict(title='Care repair '+row['id'], files=['loop/example.py'], removes_tests=[], body=f"""Found: {row['id']} loop/example.py:1 {row['sources'][0]}
Expected: improve maintainability without changing results
Observer: run the cited command: {row['reproduce']}
Scope: loop/
Preserve: all caller results and scenario proofs
Scenarios: L107
Specification: [scenarios/loop-rules.md](https://github.com/o/r/blob/main/scenarios/loop-rules.md)
Key: care-{row['id']}
Priority: {'2' if row['category'] == 'main_failures' else '60'}
Mode: implement
""")


class Care(unittest.TestCase):
    def setUp(self):
        import contextlib
        import io
        import os
        from unittest.mock import patch
        environment = {k: v for k, v in os.environ.items() if k not in ('GITHUB_STEP_SUMMARY', 'CARE_WRITES')}
        patcher = patch.dict(os.environ, environment, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        quiet = contextlib.redirect_stderr(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def test_l107_run_pages_wait_for_budget_without_losing_evidence(self):
        import json
        from unittest.mock import patch
        github = retro.GitHub('o/r')
        path = 'actions/runs?created=2026-10-05T12:00:00Z..2026-10-12T12:00:00Z&per_page=100'
        rows = [fixtures.row(n, name='check', path='check.yml', head_branch='main', conclusion='success')
                for n in range(1, 102)]
        pages = [rows[:100], rows[100:]]
        calls = []

        def response(args, **kwargs):
            calls.append(args[2])
            if '--paginate' in args:
                raise subprocess.CalledProcessError(1, args, stderr='API rate limit exceeded (HTTP 403)')
            page = int(args[2].split('&page=')[-1])
            return subprocess.CompletedProcess(args, 0,
                'HTTP/2.0 200 OK\nX-Ratelimit-Remaining: 99\nX-Ratelimit-Reset: 60\n\n' +
                json.dumps({'total_count': 101, 'workflow_runs': pages[page - 1]}))

        with patch.object(retro.subprocess, 'run', side_effect=response), \
             patch.object(retro.time, 'time', side_effect=[0, 0, 61]), \
             patch.object(retro.time, 'sleep') as sleep:
            values = github.read(path, 'workflow_runs')
        self.assertEqual([r['id'] for r in values], list(range(1, 102)))
        self.assertEqual(calls, [f'repos/o/r/{path}&page=1', f'repos/o/r/{path}&page=2'])
        self.assertEqual(github.reads[0]['pages'], 2)
        sleep.assert_called_once_with(60)

    def test_l107_capped_run_window_splits_before_spending_more_budget(self):
        import json
        from unittest.mock import patch
        github = retro.GitHub('o/r')
        path = 'actions/runs?created=2026-10-05T12:00:00Z..2026-10-12T12:00:00Z&per_page=100'
        rows = [fixtures.row(n, name='check', path='check.yml', head_branch='main', conclusion='success')
                for n in range(1, 101)]
        responses = [subprocess.CompletedProcess([], 0, json.dumps({'total_count': 1001, 'workflow_runs': rows})),
                     RuntimeError('a capped window must split before the next page')]
        with patch.object(retro.subprocess, 'run', side_effect=responses) as run:
            with self.assertRaises(retro.ReadLimit):
                github.read(path, 'workflow_runs')
        run.assert_called_once()
        self.assertEqual(github.reads, [])
        self.assertEqual(github.cache, {})

    def test_l107_failed_run_page_keeps_partial_input_unavailable(self):
        import json
        from unittest.mock import patch
        github = retro.GitHub('o/r')
        path = 'actions/runs?created=2026-10-05T12:00:00Z..2026-10-12T12:00:00Z&per_page=100'
        rows = [fixtures.row(n, name='check', path='check.yml', head_branch='main', conclusion='success')
                for n in range(1, 101)]
        responses = [subprocess.CompletedProcess([], 0, json.dumps({'total_count': 101, 'workflow_runs': rows})),
                     subprocess.CalledProcessError(1, [], stderr='Forbidden (HTTP 403)')]
        with patch.object(retro.subprocess, 'run', side_effect=responses):
            with self.assertRaisesRegex(RuntimeError, r'page=2.*failed'):
                github.read(path, 'workflow_runs')
        self.assertEqual(github.reads, [])
        self.assertEqual(github.cache, {})

    def test_l107_same_head_rerun_proves_test_recovery(self):
        import care
        records = [dict(name='u1_renders', file='apps/desktop/src/view.test.ts', status='failed',
                        seconds=0.01, sha='a'*40, branch='main', run=10, attempt=1,
                        at='2026-10-12T10:00:00Z', url='https://github.com/o/r/actions/runs/10'),
                   dict(name='u1_renders', file='apps/desktop/src/view.test.ts', status='passed',
                        seconds=0.02, sha='a'*40, branch='main', run=10, attempt=2,
                        at='2026-10-12T11:00:00Z', url='https://github.com/o/r/actions/runs/10')]
        result = care.reliability(records)
        self.assertEqual(2, result['recoveries'][0]['passed']['attempt'])
        self.assertEqual(0.02, result['slowest'][0]['seconds'])
        self.assertEqual('u1_renders', result['main_failures'][0]['name'])
        records[1]['run'] = 11
        records[1]['attempt'] = 1
        self.assertEqual(11, care.reliability(records)['recoveries'][0]['passed']['run'])

    def test_l107_other_head_or_unexecuted_test_is_not_recovery(self):
        import care
        base = dict(name='u1_renders', file='view.test.ts', seconds=1, branch='main', run=10,
                    at='2026-10-12T10:00:00Z', url='https://github.com/o/r/actions/runs/10')
        failure = dict(base, status='failed', sha='a'*40, attempt=1)
        for changed in ({'sha': 'b'*40}, {'name': 'different'}, {'status': 'pending'}):
            passed = dict(base, status='passed', sha='a'*40, attempt=2, at='2026-10-12T11:00:00Z')
            passed.update(changed)
            self.assertEqual([], care.reliability([failure, passed])['recoveries'])

    def test_l107_collects_main_failures_and_slowest_tests(self):
        import care
        rows = [dict(name=f'test{i:02}', file='view.test.ts', seconds=i, branch='main', run=10,
                     at='2026-10-12T10:00:00Z', sha='a'*40, attempt=1, status='failed' if i == 0 else 'passed') for i in range(25)]
        result = care.reliability(rows)
        self.assertEqual([24, 23], [r['seconds'] for r in result['slowest'][:2]])
        self.assertEqual(20, len(result['slowest']))
        self.assertEqual('test00', result['main_failures'][0]['name'])

    def test_l107_read_failure_prevents_model_and_publication(self):
        import care
        github = fixtures.FakeGitHub()
        job = dict(id=1, name='web', html_url='https://github.com/o/r/actions/jobs/1',
                   run_attempt=1, completed_at=fixtures.NOW,
                   steps=[dict(name='Run just check-web', conclusion='success')])
        run = dict(id=10, head_sha='a'*40, head_branch='main')
        with self.assertRaises(RuntimeError):
            care.test_results('Test Files 10 passed\nTests 100 passed', job, run)
        self.assertEqual([], github.writes)

    def test_l107_inventory_distinguishes_missing_retired_and_active_ids(self):
        import care
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scenarios').mkdir()
            (root / 'scenarios/rules.md').write_text('**U1 active.** renders\nRetired scenario U2: replaced\n')
            (root / 'view.test.ts').write_text("test('u1_renders', () => { expect(1).toBe(1); });\n"
                "test(`u1_width at ${width}x${height}`, () => { expect(1).toBe(1); });\n"
                "test('u2_old', () => {});\ntest('u999_missing', () => {});\ntest('unnamed', () => {});\n")
            inventory = care.source_inventory(root, ['scenarios/rules.md', 'view.test.ts'])
            tests = {t['name']: t for t in inventory['tests']}
            self.assertEqual([], tests['u1_renders']['categories'])
            import re
            self.assertIsNotNone(re.search(tests['u1_width at ${width}x${height}']['runtime_name_pattern'], 'u1_width at 1280x800'))
            self.assertIn('retired_scenario', tests['u2_old']['categories'])
            self.assertIn('unresolved_scenario', tests['u999_missing']['categories'])
            self.assertEqual({}, tests['u999_missing']['retirement'])
            self.assertIn('no_scenario', tests['unnamed']['categories'])
            self.assertIn('no_assertion', tests['unnamed']['categories'])

    def test_l107_assertion_inventory_follows_helpers_and_expected_errors(self):
        import care
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'view.test.ts').write_text("function proves() { expect(1).toBe(1); }\n"
                "test('u1_helper', () => { proves(); });\n"
                "test('u1_unknown', () => { outsideHelper(); });\n")
            (root / 'view.rs').write_text('#[test]\n#[should_panic]\nfn u1_error() { panic!("expected"); }\n')
            tests = care.source_inventory(root, ['view.test.ts', 'view.rs'])['tests']
            self.assertEqual(['asserted', 'inspection', 'asserted'], [t['assertion'] for t in tests])

    def test_l107_collects_largest_files_and_functions(self):
        import care
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'small.ts').write_text('function small() {}\n')
            (root / 'large.rs').write_text('fn large() {\n let one = 1;\n let two = 2;\n}\n')
            inventory = care.source_inventory(root, ['small.ts', 'large.rs'])
            self.assertEqual('large.rs', inventory['largest_files'][0]['path'])
            self.assertEqual('large', inventory['largest_functions'][0]['name'])
            self.assertEqual(4, inventory['largest_functions'][0]['end'])

    def test_l107_summary_covers_every_finding(self):
        import care
        data = input_fixture(3)
        plan = plan_fixture(data)
        plan['entries'][0]['disposition'] = 'excluded'
        care.validate_plan(data, plan, [], {1: ['loop/example.py']})
        report = care.summary(data, plan, 'o/r')
        for row in data['findings']:
            self.assertIn(row['id'], report)
        self.assertIn('deferred', report)
        self.assertIn('excluded', report)
        self.assertIn('#artifacts', report)

    def test_l107_plan_cannot_invent_or_omit_evidence(self):
        import care
        data = input_fixture(2)
        for entries in ([], [plan_fixture(data)['entries'][0]]*2):
            with self.assertRaises(care.InvalidPlan):
                care.validate_plan(data, dict(entries=entries), [], {})

    def test_l107_orders_have_evidence_invariants_scope_and_priority(self):
        import care
        for category in ('size_files', 'main_failures'):
            data = input_fixture(category=category)
            plan = plan_fixture(data, 'new')
            plan['entries'][0]['proposal'] = proposal_fixture(data)
            github = fixtures.FakeGitHub()
            care.publish(github, data, plan, [])
            self.assertEqual(1, len(github.writes))
            self.assertEqual(['loop:work'], github.writes[0][2]['labels'])
            self.assertIn('Priority: '+('2' if category == 'main_failures' else '60'), github.writes[0][2]['body'])

    def test_l107_open_pr_paths_are_excluded_at_publication(self):
        import care
        data = input_fixture()
        plan = plan_fixture(data, 'new')
        plan['entries'][0]['proposal'] = proposal_fixture(data)
        github = fixtures.FakeGitHub()
        github.responses['pulls?state=open&per_page=100'] = [dict(id=1, number=1, changed_files=1)]
        github.responses['pulls/1/files?per_page=100'] = [dict(filename='loop/example.py')]
        care.publish(github, data, plan, [])
        self.assertEqual([], github.writes)
        self.assertEqual('excluded', plan['entries'][0]['disposition'])

    def test_l107_invalid_plan_mutates_nothing(self):
        import care
        data = input_fixture(2)
        plan = plan_fixture(data, 'new')
        for n, entry in enumerate(plan['entries']):
            entry['proposal'] = proposal_fixture(data, n)
        plan['entries'][1]['proposal']['body'] = plan['entries'][1]['proposal']['body'].replace('Priority: 60', 'Priority: 2')
        github = fixtures.FakeGitHub()
        with self.assertRaises(care.InvalidPlan):
            care.publish(github, data, plan, [])
        self.assertEqual([], github.writes)

    def test_l107_matches_open_and_recent_closed_issues_without_reopening(self):
        import care
        data = input_fixture(2)
        plan = plan_fixture(data, 'match')
        issues = [fixtures.row(1, body='Work'), fixtures.row(2, body='Work', state='closed', closed_at=fixtures.NOW)]
        for n, entry in enumerate(plan['entries'], 1):
            entry['proposal'] = dict(match=n, evidence='New evidence '+entry['id'])
        github = fixtures.FakeGitHub(issues)
        care.publish(github, data, plan, [])
        self.assertEqual(['issues/1/comments', 'issues/2/comments'], [w[0] for w in github.writes])
        self.assertEqual('closed', issues[1]['state'])

    def test_l107_repeat_dispatch_and_partial_publication_keep_daily_cap(self):
        import care
        data = input_fixture(3)
        plan = plan_fixture(data, 'new')
        for n, entry in enumerate(plan['entries']):
            entry['proposal'] = proposal_fixture(data, n)
        github = fixtures.FakeGitHub()
        care.publish(github, data, plan, [])
        import copy
        care.publish(github, data, copy.deepcopy(plan), [])
        self.assertEqual(3, sum(w[0] == 'issues' for w in github.writes))
        extra = input_fixture(4)
        extra_plan = plan_fixture(extra)
        extra_plan['entries'][3]['disposition'] = 'new'
        extra_plan['entries'][3]['proposal'] = proposal_fixture(extra, 3)
        with self.assertRaises(care.InvalidPlan):
            care.publish(github, extra, extra_plan, [])
        self.assertEqual(3, sum(w[0] == 'issues' for w in github.writes))

    def test_l107_publication_read_failure_mutates_nothing(self):
        import care
        data = input_fixture()
        plan = plan_fixture(data, 'new')
        plan['entries'][0]['proposal'] = proposal_fixture(data)
        github = fixtures.FakeGitHub()
        github.failure = 'pulls?'
        with self.assertRaises(RuntimeError):
            care.publish(github, data, plan, [])
        self.assertEqual([], github.writes)

    def test_l107_write_failure_stops_and_retry_counts_completed_issues(self):
        import care
        data = input_fixture(3)
        plan = plan_fixture(data, 'new')
        for n, entry in enumerate(plan['entries']):
            entry['proposal'] = proposal_fixture(data, n)
        class FailedWrite(fixtures.FakeGitHub):
            def write(self, *args, **kwargs):
                if len(self.writes) == 1:
                    raise RuntimeError('unknown write outcome')
                return super().write(*args, **kwargs)
        github = FailedWrite()
        completed = []
        with self.assertRaises(RuntimeError):
            care.publish(github, data, plan, completed)
        self.assertEqual(1, len(completed))
        retry = fixtures.FakeGitHub(github.issues)
        care.publish(retry, data, plan, [])
        self.assertEqual(2, sum(w[0] == 'issues' for w in retry.writes))
        self.assertEqual(3, len(retry.issues))

    def test_l107_test_removal_requires_replacement_or_retirement(self):
        import care
        data = input_fixture()
        data['inventory']['tests'] = [dict(path='loop/example.py', name='l107_only_proof',
            scenario_ids=['L107'], retirement={}, assertion='asserted')]
        plan = plan_fixture(data, 'new')
        proposal = proposal_fixture(data)
        proposal['removes_tests'] = [dict(file='loop/example.py', name='l107_only_proof')]
        plan['entries'][0]['proposal'] = proposal
        with self.assertRaises(care.InvalidPlan):
            care.publish(fixtures.FakeGitHub(), data, plan, [])

    def test_l107_empty_categories_are_valid(self):
        import care
        github = fixtures.FakeGitHub()
        care.publish(github, input_fixture(0), dict(entries=[], ask=''), [])
        self.assertEqual([], github.writes)

    def test_l107_input_pins_main_window_and_reproduction(self):
        import care
        data = input_fixture()
        self.assertEqual(fixtures.END, care.validate_input(data))
        data['findings'][0]['sha'] = 'b'*40
        with self.assertRaises(RuntimeError):
            care.validate_input(data)

    def test_l107_input_reads_all_pages_once(self):
        from unittest.mock import patch
        import json
        github = retro.GitHub('o/r')
        pages = [[dict(id=1, filename='a.rs')], [dict(id=1, filename='a.rs'), dict(id=2, filename='b.rs')]]
        with patch.object(github, 'request', return_value=json.dumps(pages)) as request:
            rows = github.read('pulls/1/files?per_page=100')
            self.assertEqual(['a.rs', 'b.rs'], [r['filename'] for r in rows])
            self.assertEqual(rows, github.read('pulls/1/files?per_page=100'))
            self.assertEqual(1, request.call_count)
            self.assertEqual(2, github.reads[0]['pages'])

    def test_l107_tool_failure_is_not_an_empty_result(self):
        import care
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(OSError):
                care.command(['missing-care-fixture-tool'], Path(directory))
            with self.assertRaises(RuntimeError):
                care.command([sys.executable, '-c', 'raise SystemExit(7)'], Path(directory))
            from unittest.mock import patch
            def malformed(args, cwd, allowed=(0,)):
                Path(args[args.index('--output')+1], 'jscpd-report.json').write_text('{}')
                return ''
            with patch('care.command', side_effect=malformed), self.assertRaises(RuntimeError):
                care.tool_evidence(Path(directory), Path(directory)/'raw')

    def test_l107_script_exit_codes(self):
        import care
        import json
        import tempfile
        self.assertEqual(0, care.main(['--repo', 'o/r', 'publish', *self.write_plan_files(input_fixture(0), dict(entries=[], ask=''))]))
        with self.assertRaises(SystemExit) as failure:
            care.main(['--repo', 'o/r', 'history', '--end', 'bad'])
        self.assertEqual(2, failure.exception.code)
        data = input_fixture()
        self.assertEqual(2, care.main(['--repo', 'o/r', 'publish', *self.write_plan_files(data, dict(entries=[], ask=''))]))
        self.assertEqual(4, care.main(['--repo', 'o/r', 'publish', '/missing-input', '/missing-plan']))

    def write_plan_files(self, data, plan):
        import tempfile
        import json
        from unittest.mock import patch
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        paths = [root / 'input.json', root / 'plan.json']
        for path, value in zip(paths, (data, plan)):
            path.write_text(json.dumps(value))
        patcher = patch('retro.GitHub', return_value=fixtures.FakeGitHub())
        patcher.start()
        self.addCleanup(patcher.stop)
        return [str(p) for p in paths]

    def test_l107_collects_typescript_and_rust_clones_below_ci_limits(self):
        import care
        import tempfile
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'package.json').write_text('{"name":"care-fixture","private":true}')
            ts = 'export function clone(input: number) {\n const value = input + input * (input - 2) + (input % 3);\n return value * 2 + value / 4 - value % 5;\n}\n'
            rust = 'fn clone(input: i32) -> i32 {\n let value = input + input * (input - 2) + (input % 3);\n value * 2 + value / 4 - value % 5\n}\n'
            for name in ('first', 'second'):
                (root / (name+'.ts')).write_text(ts)
                (root / (name+'.rs')).write_text(rust)
            args = ['npm', 'exec', '--yes', '--package=jscpd@5.4.1', '--', 'jscpd', '--format',
                'typescript,rust', '--min-lines', '3', '--min-tokens', '25', '--reporters', 'json',
                '--output', str(root/'raw'), '--silent', '.']
            care.command(args, root)
            clones = json.loads((root/'raw/jscpd-report.json').read_text())['duplicates']
            self.assertEqual({'typescript', 'rust'}, {c['format'] for c in clones})
            self.assertTrue(all(c['lines'] < 5 for c in clones))
            output = care.command(['pnpm', 'exec', 'fallow', 'dupes', '--root', str(root), '--format', 'json'], Path.cwd())
            self.assertEqual([], json.loads(output)['clone_groups'])

    def test_l107_collects_dead_code_and_unenforced_clippy_lints(self):
        import care
        from unittest.mock import patch
        import tempfile
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def tool(args, cwd, allowed=(0,)):
                if 'jscpd' in args:
                    output = Path(args[args.index('--output')+1])
                    (output/'jscpd-report.json').write_text('{"duplicates":[],"statistics":{}}')
                    return ''
                if 'fallow' in args:
                    return json.dumps({'runs':[{'results':[{'ruleId':'fallow/unused-export'}],
                        'tool':{'driver':{'version':'3.31.0'}}}]})
                if '--version' in args:
                    return 'clippy fixture 1'
                if '-D' in args:
                    return '{"reason":"build-finished","success":true}\n'
                return json.dumps(dict(reason='compiler-message', message=dict(code=dict(code='clippy::too_many_lines'),
                    spans=[dict(file_name='crates/example/src/lib.rs', line_start=1, line_end=101, is_primary=True)]))) + '\n' + '{"reason":"build-finished","success":true}\n'
            with patch('care.command', side_effect=tool):
                result = care.tool_evidence(root, root/'raw')
            self.assertEqual('clippy::too_many_lines', result['clippy']['raw'][0]['code']['code'])
            self.assertEqual('none', result['duplication']['ci_threshold']['rust'])
            self.assertEqual('fallow/unused-export', result['dead_code']['raw']['runs'][0]['results'][0]['ruleId'])

    def test_l107_fix_churn_counts_each_run_file_once(self):
        import care
        run = dict(id=10, path='.github/workflows/fix.yml', created_at=fixtures.NOW,
            updated_at=fixtures.NOW, html_url='https://github.com/o/r/actions/runs/10')
        github = fixtures.FakeGitHub(runs=[run])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [dict(id=1,
            name='fix #5 '+'a'*40, status='completed', conclusion='success', steps=[])]
        github.responses['pulls/5/commits?per_page=100'] = [dict(sha='b'*40,
            commit=dict(message='repair\n\nAuthor-Agent: builder-10')), dict(sha='c'*40,
            commit=dict(message='repair again\n\nAuthor-Agent: builder-10'))]
        for sha in ('b'*40, 'c'*40):
            github.responses['commits/'+sha+'?per_page=100'] = [dict(filename='crates/example/src/lib.rs')]
        result = care.historical(github, fixtures.END)
        self.assertEqual(1, result['fix_churn'][0]['count'])
        self.assertEqual('a'*40, result['fix_churn'][0]['runs'][0]['before'])
        self.assertEqual('c'*40, result['fix_churn'][0]['runs'][0]['after'])

    def test_l107_a_name_reported_twice_in_a_job_is_a_finding(self):
        import care
        import json
        run = dict(id=10, path='.github/workflows/check.yml', head_sha='a'*40, head_branch='main',
                   created_at=fixtures.NOW, updated_at=fixtures.NOW)
        github = fixtures.FakeGitHub(runs=[run])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [dict(id=1, name='web',
            status='completed', conclusion='failure', completed_at=fixtures.NOW, run_attempt=1,
            html_url='https://github.com/o/r/actions/jobs/1', steps=[])]
        report = dict(numTotalTestSuites=1, numTotalTests=3, numPassedTests=2, numFailedTests=1,
            testResults=[dict(name='/checkout/apps/desktop/src/view.test.ts', assertionResults=[
                dict(fullName='u1_regress 1280', status='passed', duration=1),
                dict(fullName='u1_regress 1280', status='failed', duration=2),
                dict(fullName='u1_renders', status='passed', duration=3)])])
        github.responses['logs/1'] = json.dumps(report)
        result = care.historical(github, fixtures.END, results_since=retro.timestamp(fixtures.START))
        self.assertEqual(['u1_renders'], [r['name'] for r in result['records']])
        self.assertEqual([], result['main_failures'])
        self.assertEqual([('apps/desktop/src/view.test.ts', 'u1_regress 1280', 1, 2)],
                         [(d['file'], d['name'], d['jobs'], d['latest']['count']) for d in result['duplicate_names']])

    def test_l107_runs_before_complete_results_hold_no_test_records(self):
        import care
        run = dict(id=10, path='.github/workflows/check.yml', head_sha='a'*40, head_branch='main',
                   created_at=fixtures.NOW, updated_at=fixtures.NOW)
        github = fixtures.FakeGitHub(runs=[run])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [dict(id=1, name='web',
            status='completed', conclusion='failure', completed_at=fixtures.NOW, run_attempt=1,
            html_url='https://github.com/o/r/actions/jobs/1', steps=[])]
        # Before #1347 a failing desktop run printed only Vitest's totals.
        github.responses['logs/1'] = ' FAIL  src/view.test.ts\n Test Files  1 failed | 3 passed (4)\n'
        after = retro.timestamp(fixtures.NOW) + timedelta(seconds=1)
        self.assertEqual([], care.historical(github, fixtures.END, results_since=after)['records'])
        with self.assertRaisesRegex(RuntimeError, 'no complete records'):
            care.historical(github, fixtures.END, results_since=retro.timestamp(fixtures.START))

    def test_l107_cancelled_job_without_steps_holds_no_test_records(self):
        import care
        import io
        import json
        from contextlib import redirect_stdout
        from unittest.mock import patch
        at = '2026-10-13T14:00:00Z'
        run = dict(id=10, path='.github/workflows/check.yml', head_sha='a'*40, head_branch='main',
                   created_at=at, updated_at=at)
        github = fixtures.FakeGitHub(runs=[run])
        github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [dict(id=1, name='rust',
            status='completed', conclusion='cancelled', completed_at=at, run_attempt=1,
            html_url='https://github.com/o/r/actions/jobs/1', steps=[])]
        github.responses['logs/1'] = None
        output = io.StringIO()
        with patch.object(retro, 'GitHub', return_value=github), redirect_stdout(output):
            self.assertEqual(0, care.main(['--repo', 'o/r', 'history', '--end', '2026-10-13T15:00:00Z']))
        self.assertEqual([], json.loads(output.getvalue())['records'])
        self.assertEqual([], github.writes)

    def test_l107_missing_required_log_exits_four(self):
        import care
        import io
        from contextlib import redirect_stderr
        from unittest.mock import patch
        at = '2026-10-13T14:00:00Z'
        run = dict(id=10, path='.github/workflows/check.yml', head_sha='a'*40, head_branch='main',
                   created_at=at, updated_at=at)
        for conclusion, steps in [('success', []), ('cancelled', [{'name': 'Run cargo nextest'}])]:
            for log in (None, '', '  '):
                with self.subTest(conclusion=conclusion, log=log):
                    github = fixtures.FakeGitHub(runs=[run])
                    github.responses['actions/runs/10/jobs?filter=all&per_page=100'] = [dict(id=1, name='rust',
                        status='completed', conclusion=conclusion, completed_at=at, run_attempt=1,
                        html_url='https://github.com/o/r/actions/jobs/1', steps=steps)]
                    github.responses['logs/1'] = log
                    error = io.StringIO()
                    with patch.object(retro, 'GitHub', return_value=github), redirect_stderr(error):
                        self.assertEqual(4, care.main(['--repo', 'o/r', 'history', '--end', '2026-10-13T15:00:00Z']))
                    self.assertIn('https://github.com/o/r/actions/jobs/1', error.getvalue())
                    self.assertEqual([], github.writes)

    def test_l107_results_missing_log_names_the_job(self):
        import care
        import io
        from contextlib import redirect_stderr
        from unittest.mock import patch
        github = fixtures.FakeGitHub()
        job = dict(id=1, run_attempt=1, completed_at='2026-10-13T14:00:00Z',
                   html_url='https://github.com/o/r/actions/jobs/1')
        run = dict(id=10, head_sha='a'*40, head_branch='main')
        github.responses['actions/runs/10/attempts/1/jobs?per_page=100'] = [job]
        github.responses['logs/1'] = None
        error = io.StringIO()
        with patch.object(retro, 'GitHub', return_value=github), patch.object(github, 'object', return_value=run), redirect_stderr(error):
            self.assertEqual(4, care.main(['--repo', 'o/r', 'results', '10', '1', '1']))
        self.assertIn(job['html_url'], error.getvalue())
        self.assertEqual([], github.writes)

    def test_l107_shared_publication_preserves_l106(self):
        # The unchanged Retro seam exercises loop-only matching, report reuse and its existing cap.
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('retro.test.py'))],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_l107_completed_runner_records_reconcile_fast_passes_and_failures(self):
        import care
        import json
        job = dict(id=1, name='linux', html_url='https://github.com/o/r/actions/jobs/1',
                   run_attempt=1, completed_at=fixtures.NOW,
                   steps=[dict(name='Run just check', conclusion='success')])
        run = dict(id=10, head_sha='a'*40, head_branch='main')
        report = dict(numTotalTestSuites=1, numTotalTests=3, numPassedTests=1, numFailedTests=1,
            testResults=[dict(name='/checkout/apps/desktop/src/view.test.ts', assertionResults=[
                dict(fullName='u1_fast', status='passed', duration=0.1),
                dict(fullName='u1_failure', status='failed', duration=2),
                dict(fullName='u1_skip', status='pending', duration=None)])])
        log = 'PASS [0.003s] ( 1/2) example::scenarios u1::u1_renders\nFAIL [0.010s] ( 2/2) example::scenarios u1::u1_fails\nSummary [1.00s] 2 tests run: 1 passed, 1 failed\n' + json.dumps(report)
        rows = care.test_results(log, job, run)
        self.assertEqual(5, len(rows))
        self.assertEqual('u1::u1_renders', rows[3]['name'])
        self.assertEqual(0.0001, rows[0]['seconds'])
        with self.assertRaises(RuntimeError):
            care.test_results(log.replace('2 tests run:', '3 tests run:'), job, run)
        job['name'] = 'rust'
        job['conclusion'] = 'cancelled'
        job['steps'] = []
        interrupted = care.test_results('PASS [0.003s] ( 1/2) example::scenarios u1::u1_renders\n', job, run)
        self.assertEqual(['u1::u1_renders'], [r['name'] for r in interrupted])

    def test_l107_fail_fast_nextest_summary_counts_each_test_once(self):
        import care
        job = dict(id=2, name='linux', conclusion='failure', html_url='https://github.com/o/r/actions/jobs/2',
                   run_attempt=1, completed_at=fixtures.NOW, steps=[])
        run = dict(id=11, head_sha='b'*40, head_branch='main')
        # A failing nextest run cancels the rest, counts `run/total` and lists each failure again under its Summary.
        # A leaky test passed, then leaked a handle; nextest counts it among the passed.
        log = ('        PASS [   0.012s] (1/5) rup::a35 a35_a_restores_files\n'
               '        LEAK [   0.380s] (2/5) desktop::h18 h18_the_proof_is_in_no_argument_environment_file_or_log\n'
               '        FAIL [  30.441s] (3/5) rup::a35 a35_a_clear_makes_earlier_marks_unusable\n'
               '  Cancelling due to test failure\n'
               '     Summary [ 208.956s] 3/5 tests run: 2 passed (1 leaky), 1 failed, 0 skipped\n'
               '        FAIL [  30.441s] (3/5) rup::a35 a35_a_clear_makes_earlier_marks_unusable\n'
               'warning: 2/5 tests were not run due to test failure (run with --no-fail-fast to run all tests)\n')
        rows = care.test_results(log, job, run)
        self.assertEqual(['passed', 'passed', 'failed'], [r['status'] for r in rows])
        self.assertEqual(3, len({(r['file'], r['name']) for r in rows}))
        with self.assertRaisesRegex(RuntimeError, 'jobs/2'):
            care.test_results(log.replace('3/5 tests run: 2 passed', '4/5 tests run: 2 passed'), job, run)

    def test_l107_comments_and_strings_never_count_as_assertions(self):
        import care
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'view.test.ts').write_text("test('u1_empty', () => { /* expect(1).toBe(1); */ });\n"
                "test('u1_string', () => { const note = 'expect(1).toBe(1)'; });\n")
            tests = care.source_inventory(root, ['view.test.ts'])['tests']
            self.assertEqual(['none', 'none'], [t['assertion'] for t in tests])

    def test_l107_model_view_keeps_every_id_and_observed_cost(self):
        import care
        data = input_fixture(2)
        view = care.model_input(data, '/fixed/care-input.json')
        self.assertEqual([r['id'] for r in data['findings']], [r['id'] for r in view['findings']])
        self.assertEqual({'lines': 10}, view['findings'][0]['observed'])
        self.assertEqual('/fixed/care-input.json', view['complete_input'])
        self.assertEqual(3, view['daily_remaining'])

    def test_l107_clippy_shared_paths_use_canonical_pinned_locations(self):
        import care
        tools = dict(duplication=dict(raw=dict(duplicates=[]), invocation=['jscpd', '--output', '/tmp/raw']),
            dead_code=dict(raw=dict(runs=[dict(results=[])])),
            clippy=dict(raw=[dict(code=dict(code='clippy::too_many_lines'), message='shared helper',
                spans=[dict(file_name='crates/rup/tests/e2e/../../../rupd/tests/support.rs',
                            line_start=10, line_end=20, is_primary=True)])],
                invocation=['cargo', 'clippy'], version='fixture'))
        inventory = dict(tests=[], largest_files=[], largest_functions=[])
        history = dict(recoveries=[], main_failures=[], slowest=[], duplicate_names=[], fix_churn=[])
        rows = care.evidence_rows('o/r', 'a'*40, inventory, tools, history, fixtures.END)
        self.assertEqual(['crates/rupd/tests/support.rs'], rows[0]['files'])
        data = input_fixture(category='clippy')
        data['findings'] = rows
        data['categories']['clippy'] = [rows[0]['id']]
        care.validate_input(data)

    def test_l107_care_and_retro_share_read_search_and_publication(self):
        product = fixtures.row(1, body='Repair code', labels=[])
        loop = fixtures.row(2, body='Repair loop', labels=[{'name': 'kind:loop'}])
        self.assertEqual([2], [i['number'] for i in retro.candidates([product, loop], fixtures.END)])
        self.assertEqual([1, 2], [i['number'] for i in retro.candidates([product, loop], fixtures.END, loop_only=False)])


if __name__ == '__main__':
    unittest.main()
