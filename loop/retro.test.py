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


# Complete bodies from the main Retro input, run 38457744271, artifact 11845827923.
DIAGNOSIS_ISSUES = {'1336': {'title': 'L107 daily code care: report maintainability, flaky and useless tests, slop '
                   'and duplication as Work Issues',
          'body': 'Found 2026-10-13: no loop step looks after the code itself.\n'
                  '\n'
                  '- The user asked on 2026-10-13: "The loop should have a daily code ownership '
                  'and care ci where it reports issues about maintainability, test relibality, '
                  'cuts usless tests, and fixes code slop, and dries repetetions and seeks code '
                  'organisation and give the codebase all the care ut deserves".\n'
                  '- `pnpm slop` (`fallow dead-code && fallow dupes`), clippy and `cargo machete` '
                  'only fail a PR that crosses their limits. Nothing reports what sits below those '
                  'limits, and nothing checks Rust code for duplication.\n'
                  '- Retro (L106) files loop machinery repairs only. QA (L66) checks the running '
                  'App. Nobody owns flaky product tests. A local session filed #997, #1004, #1057, '
                  '#1096 and #1319 by hand, after flaky tests failed `main` and used up fix runs.\n'
                  '\n'
                  'Expected:\n'
                  '- `care.yml` runs once a day, in a different hour from Retro, and on '
                  '`workflow_dispatch`. It makes one claude-code-action run on Sonnet with the Max '
                  'token. No Fable.\n'
                  '- A script, not the model, collects the evidence from `main`, so every finding '
                  'can be checked:\n'
                  '  - duplication in TypeScript and Rust that falls below the CI limit, found '
                  'with a library tool such as `fallow dupes` at a lower threshold or `jscpd`, '
                  'never a custom detector;\n'
                  '  - dead code, and clippy lints that CI does not enforce;\n'
                  '  - test reliability over the last 7 days: each test that failed a `check` run '
                  'whose rerun on the same head passed, with run ids, plus the slowest tests;\n'
                  '  - tests that cite no scenario id on `main`, tests for retired ids, and tests '
                  'with no assertion;\n'
                  '  - the largest files and functions, and the files that fix runs changed most '
                  'often.\n'
                  '\n'
                  '  A failed read fails the run red; it never files from partial evidence.\n'
                  '- The model ranks the evidence by cost and files at most 3 Work Issues a day. '
                  'Each Issue:\n'
                  '  - names files and lines, cites the evidence and the command that reproduces '
                  'it, and states the behaviour that must not change;\n'
                  '  - stays inside one module directory (AGENTS.md rule 3);\n'
                  '  - skips files that an open PR changes;\n'
                  '  - uses Priority 60, so work the user filed goes first, except a test that '
                  'failed `main` in the window, which gets Priority 2.\n'
                  '- Cutting a test is allowed only when the Issue names another test that still '
                  "proves the same then-clause, or when the test's scenario id is retired. The "
                  'only proof of a scenario is never cut.\n'
                  '- Before it files, the run searches open Issues and Issues closed in the last 7 '
                  'days. If it finds a match, it comments on that Issue instead of filing a second '
                  'one. It leaves Issues the user closed closed.\n'
                  '- The run never pushes and never edits code. Fixes reach `main` only through '
                  'Builders, review and the required checks. It asks the user only for a choice '
                  'that spends money or sets product direction, through L79.\n'
                  "- The run's job summary lists every finding, ranked, including those it did not "
                  'file.\n'
                  "- The collector and publisher reuse Retro's GitHub search, dedup and publish "
                  'code in `loop/` rather than copying it.\n'
                  "- AGENTS.md's loop table gets a Care row in the same PR.\n"
                  '\n'
                  'Scope: `loop/`, `.github/workflows/care.yml`, `.agents/care.md`, '
                  '`scenarios/loop-rules.md` and AGENTS.md. Loop machinery merges after '
                  'independent review.\n'
                  '\n'
                  'Observer: dispatch `care.yml` on `main`. Expect at most 3 new Issues. Running '
                  "each Issue's cited command must reproduce its finding, and no Issue may repeat "
                  'an open Issue. Tests for the collector live in `loop/` and name the new rule.\n'
                  '\n'
                  'Scenarios: L107\n'
                  'Specification: '
                  '[scenarios/loop-rules.md](https://github.com/saadshahd/roundup/blob/main/scenarios/loop-rules.md)\n'
                  'Key: daily-care\n'
                  'Priority: 10\n'
                  'Mode: specify\n',
          'created_at': '2026-10-12T23:55:25Z',
          'updated_at': '2026-10-13T00:26:55Z'},
 '1357': {'title': 'U356, U351, U146, U166, U177: real-Daemon tests wait for what they read',
          'body': 'Found 2026-10-13: five real-Daemon browser tests fail at random on PR branches, '
                  'and each failure costs a `check` run and often a fix run.\n'
                  '\n'
                  '- A waste audit of 2026-10-12 00:30 to 2026-10-13 00:30 UTC counted 37 failed '
                  '`check` runs (827 runner min) and 27 fix runs (283 model min) on flaky tests. '
                  '24 of the 34 fix runs that pushed nothing answered a `check` failure.\n'
                  '- Unowned flaky tests: `u356_blocked_real_daemon` (2 on `main`, 8 PR branches; '
                  'on `main` 2026-10-13 01:26 it read `working` where it expected `blocked`), '
                  '`u351_kinds_real_daemon` (5 PR branches), and the Door tests '
                  '`u146_door_answers`, `u166_door_permission` and `u177_restarted_door` (5 '
                  'failures in all), all in `apps/desktop/src/testing/`.\n'
                  "- #1321 fixed U445's browser test. #1246's branch makes U356 wait for each "
                  "Agent's row; this Issue covers what that leaves.\n"
                  "- The pattern in U356: the test asked the Daemon's tree for state, then read "
                  'the Rail\'s DOM at once, before the Rail rendered it ("no row 11").\n'
                  '\n'
                  'Expected:\n'
                  '- Each of the five tests waits for the Rail to render what it then reads, with '
                  '`findBy` or `waitFor`, never a bare DOM query right after an RPC read.\n'
                  "- Each passes 20 runs in a row under `check`'s load. Its timeouts stay within "
                  "`check`'s budget.\n"
                  '- No assertion gets weaker: each test still proves its scenario.\n'
                  '\n'
                  'Scope: `apps/desktop/src/testing/` only.\n'
                  '\n'
                  'Observer: 20 repeated runs of the five tests on the Linux runner all pass, and '
                  'the PR body names the run. Over the next 24 hours, no `check` failure on `main` '
                  'or a PR names one of them.\n'
                  '\n'
                  'Scenarios: U356, U351, U146, U166, U177\n'
                  'Specification: '
                  '[scenarios/ui-first-journey.md](https://github.com/saadshahd/roundup/blob/main/scenarios/ui-first-journey.md)\n'
                  'Key: deflake-real-daemon\n'
                  'Priority: 2\n'
                  'Mode: implement\n',
          'created_at': '2026-10-13T01:30:55Z',
          'updated_at': '2026-10-13T06:10:29Z'},
 '1388': {'title': 'A35: the ready-title test waits for the file it reads',
          'body': 'Found 2026-10-13: '
                  '`a35_a_ready_title_before_ack_still_delivers_the_reserved_prompt_first` in '
                  "`crates/agents/tests/scenarios/a35.rs` failed `main`'s Mac `rust` job on a "
                  'loop-only merge.\n'
                  '\n'
                  '- Run 38340562996 (7b7b15b1, #1352) panicked at `scenarios/a35.rs:489` on '
                  '`unwrap()` of `NotFound` ("No such file or directory"). The test reads a file '
                  'before the code under test has written it.\n'
                  '- The test came with #1333 on 2026-10-13. #1380 covers the other flaky A35 '
                  'test, in `crates/rup`.\n'
                  '\n'
                  'Expected:\n'
                  '- The test waits for the file it reads, within a bound, and fails with a '
                  'message naming the file when it never appears.\n'
                  '- No assertion gets weaker: the test still proves that a ready title before the '
                  'acknowledgement still delivers the reserved prompt first.\n'
                  '- If the code under test can skip writing the file, that is a bug: fix it and '
                  'test it, instead of hiding it in the test.\n'
                  '\n'
                  'Scope: `crates/agents/tests/scenarios/a35.rs`, and `crates/agents/src` only if '
                  'it is the cause.\n'
                  '\n'
                  'Observer: the A35 tests in `crates/agents` pass 20 runs in a row under `cargo '
                  'nextest`, and the PR body names the run. Over the next 24 hours, no `main` '
                  '`rust` job fails on them.\n'
                  '\n'
                  'Scenarios: A35\n'
                  'Specification: '
                  '[scenarios/workstream-rewind.md](https://github.com/saadshahd/roundup/blob/main/scenarios/workstream-rewind.md)\n'
                  'Key: deflake-a35-ready-title\n'
                  'Priority: 2\n'
                  'Mode: implement\n',
          'created_at': '2026-10-13T03:21:12Z',
          'updated_at': '2026-10-13T06:10:34Z'},
 '1504': {'title': 'L109 the loop owns flaky tests; tests wait for states, never time',
          'body': 'Found 2026-10-13: no loop step reacts when a test fails by chance, and '
                  'flaky-test fixes raise limits instead of finding the cause.\n'
                  '\n'
                  '- The user, 2026-10-13: "the loop should address and handle any flaky tests or '
                  'timeouts - we should use proper tests only not corelation"\n'
                  '- A local session reran `main` and filed each flaky test by hand: #997, #1004, '
                  '#1057, #1096, #1319, #1357, #1380, #1388, #1404, #1409 and the U170 Issue filed '
                  'today.\n'
                  '- Care (L107) finds flaky tests only once a day, and files at most 3 Issues.\n'
                  '- On PRs, a failure in a flaky test starts a model fix run on a test the PR '
                  'never touched. A 24-hour audit counted 27 such fix runs, 283 model minutes.\n'
                  '- Several fixes made a test less likely to fail without naming a cause: #1420 '
                  'ran browser files one at a time (`web` went from 7–12 min to 18 min), and '
                  'others raised waits. Some Observers asked for N passes in a row, which proves '
                  'nothing about the cause.\n'
                  '\n'
                  'Expected:\n'
                  '- **On `main`.** When `check` completes with a failure on `main`, a script (no '
                  'model) reruns the failed jobs once.\n'
                  '  - If the rerun passes on the same commit, each test that failed and then '
                  'passed gets one Work Issue at Priority 2, or a comment on its open Issue. The '
                  "script parses results with `care.test_results` and reuses Care's and Retro's "
                  'dedup and publish code, so Care and this step never file two Issues for one '
                  'test.\n'
                  '  - If the rerun fails again, the script files a Priority 1 work order to '
                  "revert the merge, per AGENTS.md's red-`main` rule.\n"
                  '  - The trigger filters in `on:` (`workflow_run`, workflow `check`, '
                  '`completed`, branch `main`), so no run starts for other events. Its GitHub API '
                  'calls have a fixed bound.\n'
                  "  - The spec settles how attempt 2's result reaches the script, since a rerun "
                  'requested with `GITHUB_TOKEN` may start no `workflow_run` event. It reuses the '
                  'App token the loop already uses for dispatch.\n'
                  '- **On PRs.** Before a `check`-cause fix run, if every failed test has an open '
                  'flaky-test Issue, the loop reruns the failed jobs once, with no model and no '
                  'fix run counted. A second failure starts a normal fix run.\n'
                  '- **The test standard**, in `.agents/data/gates.md` (or `builder.md`), so '
                  'review enforces it. `tdd` is vendored in `skills-lock.json`, so the standard '
                  'does not go there.\n'
                  '  - A test waits for a state the code publishes: an event, a reply, a DOM '
                  'change. It never waits for time.\n'
                  "  - The runner's timeout is a hang guard only, and a timeout names what the "
                  'test waited for.\n'
                  '  - Never a fix: a sleep, a longer timeout, a retry, a skip, or running files '
                  'one at a time. Resource limits such as the pty-heavy group stay allowed.\n'
                  '  - No assertion gets weaker. A race in the product gets a product fix.\n'
                  '- **Proof of a flaky-test fix.** A test forces the bad ordering (holds a reply, '
                  'delays a step, or uses a fake clock). It fails before the fix and passes after. '
                  'A passing rerun only starts the work. A count of passing runs never proves a '
                  'fix.\n'
                  '- **Existing fixed waits.** A lint in the existing linters fails a new fixed '
                  'wait (`setTimeout` used as a delay, `thread::sleep`, `tokio::time::sleep`) in '
                  "test code. Care's daily evidence ranks the existing ones for repair.\n"
                  '\n'
                  'Scope: `loop/`, `.github/workflows/`, `.agents/data/gates.md` or '
                  '`.agents/builder.md`, `scenarios/loop-rules.md` and the lint config. Loop '
                  'machinery merges after independent review.\n'
                  '\n'
                  'Observer: dispatch the new step with `check` run 38439184909 (U170 failed on '
                  '`main`, then passed on rerun). It comments on the open U170 Issue and files '
                  'nothing new. `loop/` tests name the new rule.\n'
                  '\n'
                  'Scenarios: L109\n'
                  'Specification: '
                  '[scenarios/loop-rules.md](https://github.com/saadshahd/roundup/blob/main/scenarios/loop-rules.md)\n'
                  'Priority: 1\n'
                  'Mode: specify\n',
          'created_at': '2026-10-13T18:01:52Z',
          'updated_at': '2026-10-13T21:50:04Z'}}


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

    def test_l106_input_counts_only_the_four_issues_owned_diagnoses(self):
        issues = [row(int(n), **fields) for n, fields in DIAGNOSIS_ISSUES.items()]
        data = retro.collect(FakeGitHub(issues), retro.timestamp('2026-10-13T19:48:27Z'))
        self.assertEqual(data['numbers']['flaky_issues'], 2)
        findings = {i['number']: i for i in data['flaky_issues']}
        self.assertEqual(set(findings), {1357, 1388})
        self.assertEqual(findings[1357]['tests'], ['u356_blocked_real_daemon',
            'u351_kinds_real_daemon', 'u146_door_answers', 'u166_door_permission',
            'u177_restarted_door'])
        self.assertIn('a35_a_ready_title_before_ack_still_delivers_the_reserved_prompt_first',
                      findings[1388]['tests'])
        self.assertIn('working', ' '.join(findings[1357]['failure_evidence']))
        self.assertIn('38340562996', ' '.join(findings[1388]['failure_evidence']))
        self.assertIn('NotFound', ' '.join(findings[1388]['failure_evidence']))

    def test_l106_input_uses_owned_failure_evidence_instead_of_scenarios_or_labels(self):
        diagnosed = row(1, title='Repair loop test', labels=[], body='''Found: flaky test
`test_l106_input_reads_all_pages_without_duplicates` failed in run #10:
the collector read the listing before the last page arrived.
Expected: repair the test's page ordering.
Scope: loop/retro.test.py
Scenarios: L106''')
        feature = row(2, title='Flaky test reporting', labels=[{'name': 'kind:loop'}],
                      body='''Found: no report lists flaky tests.
- #10 diagnoses flaky test `test_l106_input_reads_all_pages_without_duplicates`,
  which failed in run #11.
Expected: report those diagnoses, including the test failure evidence.
Scenarios: U26''')
        data = collected(FakeGitHub([diagnosed, feature]))
        self.assertEqual(data['numbers']['flaky_issues'], 1)
        self.assertEqual(data['flaky_issues'][0]['number'], 1)
        self.assertEqual(data['flaky_issues'][0]['tests'],
                         ['test_l106_input_reads_all_pages_without_duplicates'])
        self.assertIn('run #10', ' '.join(data['flaky_issues'][0]['failure_evidence']))

    def test_l106_input_does_not_infer_flakiness_from_a_failed_test(self):
        issue = row(1, title='Flaky tests are reported elsewhere', body='''Found: test
`test_l106_input_reads_all_pages_without_duplicates` failed in run #10: it returned one row.
- #11 covers the other flaky test.
Expected: return the second row.
Scenarios: L106''')
        self.assertEqual(collected(FakeGitHub([issue]))['numbers']['flaky_issues'], 0)

    def test_l106_input_does_not_adopt_a_linked_issues_diagnosis(self):
        for reference in ('#10', '[#10](https://github.com/o/r/issues/10)', 'See Issue #10', 'A linked Issue #10'):
            with self.subTest(reference=reference):
                issue = row(1, body=f'Found: {reference} diagnoses flaky test `collect_all_pages`: '
                            'it failed in run #11.\nExpected: add a reporting capability.')
                self.assertEqual(collected(FakeGitHub([issue]))['numbers']['flaky_issues'], 0)

    def test_l106_input_retains_an_explicit_flaky_diagnosis_without_guessing_a_run(self):
        issue = row(1, body='Found: flaky test `collectPages` failed intermittently; '
                    'failure run unknown.\nExpected: fix the test ordering.')
        finding = collected(FakeGitHub([issue]))['flaky_issues'][0]
        self.assertEqual(finding['tests'], ['collectPages'])
        self.assertEqual(finding['failure_evidence'], [
            'flaky test `collectPages` failed intermittently; failure run unknown.'])

    def test_l106_input_does_not_treat_a_requested_command_as_a_failed_test(self):
        issue = row(1, body='Found: the proposed `report_flaky_tests` command would report '
                    'flaky test failures from run #10.\nExpected: build this reporting capability.')
        self.assertEqual(collected(FakeGitHub([issue]))['numbers']['flaky_issues'], 0)

    def test_l106_input_keeps_capability_requests_out_even_when_they_quote_a_failure(self):
        for outcome in ('add a reporting capability for these failures',
                        'build a test standard for flaky-test repairs',
                        'report flaky-test diagnoses with their failure evidence'):
            with self.subTest(outcome=outcome):
                issue = row(1, body='Found: flaky test `collectPages` failed intermittently in run #10.\n'
                            f'Expected: {outcome}.\nScope: loop/retro.py')
                self.assertEqual(collected(FakeGitHub([issue]))['numbers']['flaky_issues'], 0)

    def test_l106_input_reads_a_diagnosis_after_work_metadata(self):
        issue = row(1, body='Scope: loop/retro.test.py\n'
                    'Found: flaky test `collectPages` failed intermittently in run #10.\n'
                    'Expected: repair the page ordering.')
        self.assertEqual(collected(FakeGitHub([issue]))['flaky_issues'][0]['tests'], ['collectPages'])

    def test_l106_input_does_not_count_a_report_that_quotes_a_flaky_diagnosis(self):
        issue = row(1, body=retro.REPORT + '\nAnalysis: flaky test `collectPages` failed '
                    'intermittently in run #10. The repair is #11.')
        self.assertEqual(collected(FakeGitHub([issue]))['numbers']['flaky_issues'], 0)

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

    def test_l106_collector_leaves_half_the_hourly_budget_to_the_loop(self):
        github = retro.GitHub('o/r')
        response = '[HTTP/2.0 200 OK\nX-Ratelimit-Limit: 5000\nX-Ratelimit-Remaining: 2499\nX-Ratelimit-Reset: 60\n\n[]]'
        with patch.object(retro.time, 'time', side_effect=[0, 0, 61]), patch.object(retro.time, 'sleep') as sleep, \
             patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, response)) as run:
            github.read('issues?per_page=100')
            sleep.assert_not_called()
            github.read('pulls?per_page=100')
        self.assertEqual((github.limit, github.reserve()), (5000, 2500))
        sleep.assert_called_once_with(60)
        self.assertEqual(run.call_count, 2)

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

    def test_l106_ordinary_recorded_causes_retain_source_evidence(self):
        records = json.loads((ROOT / 'retro-1595-causes.json').read_text())
        end = retro.timestamp('2026-10-13T19:48:27Z')
        for record in records:
            with self.subTest(pr=record['pr']):
                number = record['pr']
                event = record['closing_event']
                cause = record['comment']
                github = pr_fixture(number, merged_at=None, closed_at=record['pr_closed_at'])
                github.issues[0].update(closed_at=event['created_at'], updated_at=event['created_at'])
                github.responses[f'issues/{number}/comments?per_page=100'] = [cause]
                github.responses[f'issues/{number}/events?per_page=100'] = [event]
                result = retro.collect(github, end)['unmerged'][0]
                self.assertEqual(result['cause'], [cause])
                self.assertEqual(result['closing_events'], [event])

    def test_l106_unrelated_or_untrusted_text_is_not_a_closure_cause(self):
        cases = [
            comment(11, 'VERDICT: reject\nClose this PR', login=orders.OWNER),
            comment(11, "Closed by the owner's session: superseded", login='stranger'),
            comment(11, '<!-- closed --> superseded', login='stranger'),
            comment(11, 'Closed by Claude Code: old closure', at=START),
            comment(11, 'Closed by Claude Code:'),
            comment(11, 'Review quotes: Closed by Claude Code: superseded'),
            comment(11, 'Closed by Claude Code: after end', at=END_TEXT),
        ]
        for text in cases:
            with self.subTest(body=text['body'], author=text['user']['login']):
                github = pr_fixture(merged_at=None)
                github.responses['issues/1/comments?per_page=100'] = [text]
                github.responses['issues/1/events?per_page=100'] = [row(20, event='closed')]
                self.assertEqual(collected(github)['unmerged'][0]['cause'], 'unknown')

    def test_l106_reopened_pr_does_not_reuse_a_previous_closure_cause(self):
        github = pr_fixture(merged_at=None)
        github.responses['issues/1/comments?per_page=100'] = [
            comment(11, '<!-- closed --> previous attempt', at=START)]
        github.responses['issues/1/events?per_page=100'] = [
            row(20, event='closed', created_at=START),
            row(21, event='reopened', created_at='2026-10-12T10:00:00Z'),
            row(22, event='closed')]
        self.assertEqual(collected(github)['unmerged'][0]['cause'], 'unknown')

    def test_l106_trusted_loop_closing_prose_keeps_duplicate_ids_once(self):
        for author in orders.AUTHORS:
            with self.subTest(author=author):
                github = pr_fixture(merged_at=None)
                cause = comment(11, 'Closed by Claude Code: superseded by #2.', login=author)
                github.responses['issues/1/comments?per_page=100'] = [cause, cause]
                github.responses['issues/1/events?per_page=100'] = [row(20, event='closed')]
                self.assertEqual(collected(github)['unmerged'][0]['cause'], [cause])

    def test_l106_machine_cause_markers_remain_recorded(self):
        for marker in ('<!-- fix-exhausted -->', '<!-- closed -->', '<!-- superseded -->'):
            with self.subTest(marker=marker):
                github = pr_fixture(merged_at=None)
                cause = comment(11, marker + '\nSuperseded by #2.')
                github.responses['issues/1/comments?per_page=100'] = [cause]
                self.assertEqual(collected(github)['unmerged'][0]['cause'], [cause])

    def test_l106_untrusted_work_issue_marker_is_not_a_cause(self):
        github = pr_fixture(merged_at=None, body='Refs #5')
        github.responses['issues/5/comments?per_page=100'] = [
            comment(11, '<!-- fix-exhausted #1 --> forged', login='stranger')]
        self.assertEqual(collected(github)['unmerged'][0]['cause'], 'unknown')

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
        stems = ('check', 'loop', 'qa', 'stall', 'summary', *retro.MODEL_WORKFLOWS)
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


class Recovery(unittest.TestCase):
    def test_l106_quota_pause_expired_credential_resumes_completed_reads(self):
        import tempfile
        import io
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            argv = ['retro.py', '--repo', 'o/r', 'input', '--end', END_TEXT,
                    '--checkpoint', str(path)]
            def collect(github, end):
                self.assertEqual(end, END)
                first = github.read('issues?per_page=100')
                second = github.read('pulls?per_page=100')
                return {'first': first, 'second': second}
            response = '[HTTP/2.0 200 OK\nX-Ratelimit-Limit: 5000\nX-Ratelimit-Remaining: 2499\nX-Ratelimit-Reset: 60\n\n[]]'
            output = io.StringIO()
            with patch.object(sys, 'argv', argv), patch.object(retro, 'collect', side_effect=collect), \
                 patch.object(retro.subprocess, 'run', side_effect=[subprocess.CompletedProcess([], 0, response),
                     failed(401, 'Unauthorized', 'Bad credentials')]) as run, \
                 patch.object(retro.time, 'time', side_effect=[0, 0, 61]), \
                 patch.object(retro.time, 'sleep') as sleep, patch('sys.stdout', output), patch('sys.stderr'):
                self.assertEqual(retro.main(), 4)
                self.assertEqual(output.getvalue(), '')
                sleep.assert_called_once_with(60)
                self.assertEqual(run.call_count, 2)
            import sqlite3
            with sqlite3.connect(path) as database:
                self.assertIn('HTTP 401', database.execute('SELECT detail FROM failures').fetchone()[0])
                self.assertEqual(database.execute('SELECT count(*) FROM responses').fetchone()[0], 1)
            with patch.object(sys, 'argv', argv), patch.object(retro, 'collect', side_effect=collect), \
                 patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '[[]]')) as run, \
                 patch('sys.stdout', output):
                self.assertEqual(retro.main(), 0)
                run.assert_called_once()
                self.assertIn('pulls?', run.call_args.args[0][2])
                self.assertEqual(json.loads(output.getvalue()), {'first': [], 'second': []})
            with sqlite3.connect(path) as database:
                self.assertEqual(database.execute('SELECT count(*) FROM failures').fetchone()[0], 0)


    def test_l106_recovery_keeps_pages_and_duplicate_handling(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            github = retro.GitHub('o/r', path, END)
            endpoint = 'actions/runs?created=2026-10-11T12:00:00Z..2026-10-12T12:00:00Z&per_page=100'
            run = row(1, name='Review', path='.github/workflows/review.yml', head_branch='build/x', conclusion='success')
            page = json.dumps({'total_count': 2, 'workflow_runs': [run] * 100})
            with patch.object(retro.subprocess, 'run', side_effect=[subprocess.CompletedProcess([], 0, page),
                        failed(401, 'Unauthorized', 'Bad credentials')]), self.assertRaises(retro.RequestFailed):
                github.read(endpoint, 'workflow_runs')
            github = retro.GitHub('o/r', path, END)
            last = json.dumps({'total_count': 2, 'workflow_runs': [run, dict(run, id=2)]})
            with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, last)) as read:
                self.assertEqual([r['id'] for r in github.read(endpoint, 'workflow_runs')], [1, 2])
                read.assert_called_once()
                self.assertIn('&page=2', read.call_args.args[0][2])
                self.assertEqual(github.reads[0]['pages'], 2)

    def test_l106_recovery_rejects_other_windows_repositories_and_versions(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            retro.GitHub('o/r', path, END)
            for repo, end in [('other/repo', END), ('o/r', retro.timestamp(START))]:
                with self.subTest(repo=repo, end=end), self.assertRaisesRegex(ValueError, 'differs'):
                    retro.GitHub(repo, path, end)
            with patch.object(retro.Path, 'read_bytes', return_value=b'changed collector'), \
                 self.assertRaisesRegex(ValueError, 'differs'):
                retro.GitHub('o/r', path, END)

    def test_l106_recovery_is_private_and_does_not_store_credentials(self):
        import tempfile
        import os
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            github = retro.GitHub('o/r', path, END)
            with patch.dict(os.environ, {'GH_TOKEN': 'credential-value'}), \
                 patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0,
                    'HTTP/2.0 200 OK\nAuthorization: credential-value\n\ncredential-value ghp_example Bearer other')):
                self.assertEqual(github.request(['read']), '[redacted] [redacted] [redacted]')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(b'credential-value', path.read_bytes())

    def test_l106_recovery_redaction_preserves_json_evidence(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            github = retro.GitHub('o/r', path, END)
            evidence = {'body': 'Bearer example', 'id': 17}
            with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(evidence))):
                result = github.request(['read'])
                self.assertEqual(json.loads(result), {'body': '[redacted]', 'id': 17})
            with patch.object(retro.subprocess, 'run') as read:
                self.assertEqual(retro.GitHub('o/r', path, END).request(['read']), result)
                read.assert_not_called()

    def test_l106_full_recovery_storage_preserves_completed_reads(self):
        import tempfile
        import sqlite3
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            github = retro.GitHub('o/r', path, END)
            with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'completed')):
                github.request(['read'])
            with patch.object(retro, 'RECOVERY_PAGES', 20), patch.object(retro.subprocess, 'run',
                    return_value=subprocess.CompletedProcess([], 0, 'x' * 100000)), \
                 self.assertRaises(sqlite3.DatabaseError):
                github.request(['too-large'])
            with patch.object(retro.subprocess, 'run') as read:
                self.assertEqual(retro.GitHub('o/r', path, END).request(['read']), 'completed')
                read.assert_not_called()

    def test_l106_recovery_never_replays_writes(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            github = retro.GitHub('o/r', Path(directory) / 'reads.sqlite', END)
            with patch.object(retro.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '{}')) as write:
                for _ in range(2):
                    github.write('issues', 'POST', body='Report')
                self.assertEqual(write.call_count, 2)

    def test_l106_recovery_requires_fixed_end(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            path.write_text('not a database')
            argv = ['retro.py', '--repo', 'o/r', 'input', '--checkpoint', str(path)]
            with patch.object(sys, 'argv', argv), patch('sys.stderr'), self.assertRaises(SystemExit) as error:
                retro.main()
            self.assertEqual(error.exception.code, 2)

    def test_l106_corrupt_recovery_storage_posts_nothing(self):
        import tempfile
        import io
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reads.sqlite'
            path.write_text('not a database')
            argv = ['retro.py', '--repo', 'o/r', 'input', '--checkpoint', str(path)]
            output = io.StringIO()
            with patch.object(sys, 'argv', argv + ['--end', END_TEXT]), patch('sys.stderr'), \
                 patch('sys.stdout', output), patch.object(retro.subprocess, 'run') as request:
                self.assertEqual(retro.main(), 4)
                self.assertEqual(output.getvalue(), '')
                request.assert_not_called()


class BoundedRecovery(unittest.TestCase):
    def test_l109_api_budget_is_fixed_and_overflow_mutates_nothing(self):
        github = retro.GitHub('o/r', bounded=True)
        response = subprocess.CompletedProcess([], 0, '{}')
        with patch.object(retro.subprocess, 'run', return_value=response) as transport:
            for index in range(512):
                self.assertEqual(github.request([f'repos/o/r/read/{index}']), '{}')
            with self.assertRaisesRegex(retro.ReadLimit, '512'):
                github.write('issues', 'POST', title='must not publish')
        self.assertEqual(transport.call_count, 512)
        self.assertTrue(all('-X' not in call.args[0] for call in transport.call_args_list))


if __name__ == '__main__':
    unittest.main()
