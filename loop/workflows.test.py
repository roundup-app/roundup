#!/usr/bin/env python3
"""L2, L23, L24, L46, L89, L99: what the workflows grant each run, the scripts they run before a model starts, and the jobs
that post the required checks."""
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parent.parent


def action_inputs(workflow):
    """The `with:` block and env of a workflow's claude-code-action step."""
    source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
    return source.split('uses: anthropics/claude-code-action@v1', 1)[1].split('      - ', 1)[0]


def git(path, *args):
    return subprocess.run(['git', '-C', path, *args], text=True, capture_output=True, check=True).stdout.strip()


def new_repo(path):
    git(path, 'init')
    git(path, 'config', 'user.name', 'test')
    git(path, 'config', 'user.email', 'test@test')


def workflow_expression(expression, run):
    """Evaluate the workflow expression subset used by downstream admission and concurrency."""
    expression = expression.removeprefix('${{').removesuffix('}}').strip()
    values = {'github.repository': 'saadshahd/roundup',
        **{(key if key.startswith(('github.', 'vars.', 'inputs.', 'needs.')) else f'github.event.workflow_run.{key}'): value
                 for key, value in run.items()}}
    expression = re.sub(r'(?:github|vars|inputs|needs)\.[A-Za-z0-9_.]+', lambda match: repr(values[match[0]]), expression)
    expression = expression.replace('\n', ' ').replace('&&', ' and ').replace('||', ' or ')
    import json
    return eval(expression, {'__builtins__': {}, 'format': lambda template, *args: template.format(*args),
                             'fromJSON': json.loads, 'contains': lambda values, value: value in values})


class DownstreamDraft(unittest.TestCase):
    def check_title(self, draft, event='pull_request', title='Draft check'):
        source = (ROOT / '.github/workflows/pre.yml').read_text()
        run_name = next(line.removeprefix('run-name: ') for line in source.splitlines()
                        if line.startswith('run-name: '))
        context = {'github.event_name': event, 'github.event.pull_request.draft': draft,
                   'github.event.pull_request.title': title}
        return re.sub(r'\$\{\{.*?\}\}', lambda match: str(workflow_expression(match[0], context)), run_name)

    def setUp(self):
        self.real = {'id': 101, 'display_title': self.check_title(False), 'head_branch': 'build/example',
                     'head_sha': 'a' * 40, 'conclusion': 'success', 'event': 'pull_request',
                     'head_repository.full_name': 'saadshahd/roundup'}
        self.draft = {**self.real, 'id': 102, 'display_title': self.check_title(True)}

    def test_l24_check_marks_only_draft_pull_request_events(self):
        for draft, event, expected in ((True, 'pull_request', 'Draft check'),
                                        (False, 'pull_request', 'Check'),
                                        (True, 'push', 'Check'),
                                        (True, 'workflow_dispatch', 'Check')):
            with self.subTest(draft=draft, event=event):
                self.assertEqual(self.check_title(draft, event), expected)

    def group(self, workflow, run):
        source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
        concurrency = source.split('\nconcurrency:\n', 1)[1].split('\n\n', 1)[0]
        self.assertIn('cancel-in-progress: true', concurrency)
        group = next(line.strip().removeprefix('group: ') for line in concurrency.splitlines()
                     if line.strip().startswith('group: '))
        return re.sub(r'\$\{\{.*?\}\}', lambda match: str(workflow_expression(match[0], run)), group)

    def test_l24_late_draft_completion_cannot_replace_real_review(self):
        for workflow in ('review', 'critic'):
            with self.subTest(workflow=workflow):
                self.assertNotEqual(self.group(workflow, self.real), self.group(workflow, self.draft))
                self.assertNotEqual(self.group(workflow, self.draft),
                                    self.group(workflow, {**self.draft, 'id': 103}))

    def test_l24_new_real_heads_supersede_older_real_reviews(self):
        for workflow in ('review', 'critic'):
            with self.subTest(workflow=workflow):
                self.assertEqual(self.group(workflow, self.real),
                                 self.group(workflow, {**self.real, 'id': 103, 'head_sha': 'b' * 40}))

    def test_l24_draft_event_never_admits_a_task_after_readiness(self):
        for workflow in ('review', 'critic'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            admission = source.split('\n  task:\n    if: >-\n', 1)[1].split('    runs-on:', 1)[0].strip()
            for run, expected in ((self.draft, False), (self.real, True),
                                  ({**self.real, 'conclusion': 'failure'}, False),
                                  ({**self.real, 'event': 'push'}, False),
                                  ({**self.real, 'head_repository.full_name': 'other/roundup'}, False)):
                with self.subTest(workflow=workflow, run=run):
                    self.assertEqual(bool(workflow_expression(admission, run)), expected)
            model = source.split(f'\n  {workflow}-run:', 1)[1].split('    runs-on:', 1)[0]
            self.assertIn('needs: task', model)
            self.assertIn("if: needs.task.outputs.pr != ''", model)

    def test_l24_gate_definitions_and_publishers_remain_trusted(self):
        for workflow in ('review', 'critic'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            self.assertIn('workflow_run:\n    workflows: [pre]', source)
            self.assertNotIn('pull_request_target:', source)
            for name in ('task', 'post'):
                job = re.split(r'\n  [a-z][a-z-]*:', source.split(f'\n  {name}:\n', 1)[1], maxsplit=1)[0]
                self.assertIn('ref: main', job)
            self.assertIn('git show origin/main:loop/review-checkout.sh | bash', source)


class Permissions(unittest.TestCase):
    def test_l23_build_and_fix_runs_run_the_engine_with_the_max_token_and_the_chatgpt_login(self):
        # builder.test.py proves `builder.py engine` runs Sonnet first, falls back to Codex and asks the App for workflow changes.
        for workflow, loop in (('build-issue', '$RUNNER_TEMP/loop'), ('fix', '$RUNNER_TEMP/main/loop')):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            self.assertNotIn('claude-code-action', source, workflow)
            self.assertIn("builder: 'true'", source, workflow)
            step = source.split('      - id: engine\n', 1)[1].split('\n      - ', 1)[0]
            self.assertIn('CODEX_AUTH: ${{ secrets.CODEX_AUTH_JSON }}', step, workflow)
            self.assertIn("CLAUDE_CODE_OAUTH_TOKEN: ${{ vars.CLAUDE_API == '' && secrets.CLAUDE_CODE_OAUTH_TOKEN || '' }}", step, workflow)
            self.assertIn(f'python3 "{loop}/builder.py" engine', step, workflow)
            self.assertNotIn('github.token', step, workflow)

    def test_l23_only_the_attach_step_after_the_model_holds_the_attach_token_and_its_failure_stops_nothing(self):
        for workflow in ('build-issue', 'fix'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            holders = [step for step in source.split('\n      - ') if 'PR_ATTACH_TOKEN' in step]
            self.assertEqual(len(holders), 1, workflow)
            self.assertIn('id: attach', holders[0], workflow)
            self.assertIn('continue-on-error: true', holders[0], workflow)
            self.assertNotIn('PR_ATTACH_TOKEN', source.split('      - id: engine\n', 1)[1].split('\n      - ', 1)[0], workflow)
        self.assertNotIn('PR_ATTACH_TOKEN', (ROOT / '.agents/builder.md').read_text())

    def test_l23_with_claude_api_no_step_receives_the_max_token_and_no_claude_code_action_runs(self):
        for workflow in ('build-issue', 'fix', 'review', 'critic'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            for use in re.findall(r'^ *CLAUDE_CODE_OAUTH_TOKEN:.*$', source, re.M):
                self.assertIn("vars.CLAUDE_API == '' &&", use, workflow)
            for key in re.findall(r'^ *ANTHROPIC_API_KEY:.*$', source, re.M):
                self.assertTrue("vars.CLAUDE_API != '' &&" in key or workflow in ('review', 'critic'), workflow)
            for action in re.findall(r'(?:^|\n)      - id: claude\n        if: ([^\n]*)', source):
                self.assertIn("vars.CLAUDE_API == ''", action, workflow)

    def test_l23_a_job_that_runs_claude_read_only_installs_claude_code_first(self):
        for workflow in ('review', 'critic'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            install = source.index('claude.ai/install.sh | bash -s -- 2.1.296')
            self.assertLess(install, source.index('builder.py" claude-read-only'), workflow)
            self.assertIn('>>"$GITHUB_PATH"', source[install:], workflow)

    def test_l82_the_engine_waits_for_the_merge_script(self):
        source = (ROOT / '.github/workflows/fix.yml').read_text()
        resolve = source.split('      - id: resolve\n', 1)[1].split('\n      - ', 1)[0]
        engine = source.split('      - id: engine\n', 1)[1].split('\n      - ', 1)[0]
        self.assertIn("needs.task.outputs.cause == 'conflict'", resolve)
        self.assertIn('builder.py" merge-main', resolve)
        self.assertIn("if: steps.resolve.outputs.resolved != 'true'", engine)
        self.assertLess(source.index('      - id: resolve'), source.index('      - id: engine'))

    def test_l82_a_conflict_engine_run_is_capped_and_short(self):
        source = (ROOT / '.github/workflows/fix.yml').read_text()
        engine = source.split('      - id: engine\n', 1)[1].split('\n      - ', 1)[0]
        self.assertIn("timeout-minutes: ${{ needs.task.outputs.cause == 'conflict' && 15 || 105 }}", engine)
        self.assertIn('engine$([ "$CAUSE" = conflict ] && echo -conflict)', engine)
        task = source.split('      - id: task\n', 1)[1].split('\n  fix-run:', 1)[0]
        self.assertIn('prompt $([ "$CAUSE" = conflict ] && echo conflict)', task)

    def test_l120_the_engine_waits_for_the_merge_loss_restore(self):
        source = (ROOT / '.github/workflows/fix.yml').read_text()
        restore = source.split('      - id: restore\n', 1)[1].split('\n      - ', 1)[0]
        engine = source.split('      - id: engine\n', 1)[1].split('\n      - ', 1)[0]
        self.assertIn("needs.task.outputs.merge_loss == 'true'", restore)
        self.assertIn('builder.py" restore-merge-loss', restore)
        self.assertIn("steps.restore.outputs.restored != 'true'", engine)
        self.assertLess(source.index('      - id: restore'), source.index('      - id: engine'))

    def test_l24_the_review_run_keeps_the_read_only_workflow_token(self):
        inputs = action_inputs('review')
        self.assertIn('github_token: ${{ github.token }}', inputs)
        self.assertNotIn('additional_permissions:', inputs)
        source = (ROOT / '.github/workflows/review.yml').read_text()
        job = source.split('  review-run:', 1)[1].split('    steps:', 1)[0]
        self.assertNotIn(': write', job)

    def test_l24_the_review_run_runs_on_sonnet(self):
        self.assertIn('--model claude-sonnet-5-5\n', action_inputs('review'))

    def test_l103_the_critic_reads_main_rules_not_the_heads(self):
        source = (ROOT / '.github/workflows/critic.yml').read_text()
        self.assertIn('git restore --source=origin/main --worktree -- docs/design-system.md', source)
        self.assertIn('--model claude-opus-5-5\n', action_inputs('critic'))
        job = source.split('  critic-run:', 1)[1].split('    steps:', 1)[0]
        self.assertNotIn(': write', job)
        self.assertIn('github_token: ${{ github.token }}', action_inputs('critic'))


class Build(unittest.TestCase):
    def test_l121_paid_runners_require_an_explicit_owner_opt_in(self):
        for workflow, job, variable, scope in (('build-issue', 'build', 'BOXD_ISSUES', 'inputs.issue'),
                                               ('fix', 'fix-run', 'BOXD_PRS', 'needs.task.outputs.pr')):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            expression = source.split(f'\n  {job}:', 1)[1].split('runs-on: ', 1)[1].split('\n', 1)[0]
            context = {scope: 123 if job == 'build' else '123', f'vars.{variable}': '',
                       'github.run_id': 7, 'github.run_attempt': 2}
            for setting in ('', '[]', '[124]'):
                with self.subTest(workflow=workflow, setting=setting):
                    self.assertEqual(workflow_expression(expression, {**context, f'vars.{variable}': setting}),
                                     ['ubuntu-latest'])
            self.assertEqual(workflow_expression(expression, {**context, f'vars.{variable}': '[123]'}),
                             ['self-hosted', 'boxd', f'roundup-{"build" if job == "build" else "fix"}-123-7-2'])
        for workflow in ('review', 'critic'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            runner = source.split(f'\n  {workflow}-run:', 1)[1].split('runs-on: ', 1)[1].split('\n', 1)[0]
            self.assertEqual(runner, 'ubuntu-latest')

    def test_l23_the_builder_job_holds_no_actions_issue_or_pr_write(self):
        source = (ROOT / '.github/workflows/build-issue.yml').read_text()
        build = source.split('  build:', 1)[1].split('\n  after:', 1)[0]
        for grant in ('actions: write', 'issues: write', 'pull-requests: write'):
            self.assertNotIn(grant, build)


class Stall(unittest.TestCase):
    def test_l94_workflow_calls_no_model_and_holds_only_issue_writes(self):
        source = (ROOT / '.github/workflows/stall.yml').read_text()
        for name in ('build.yml', 'claude-code-action', 'claude', 'anthropic'):
            self.assertNotIn(name, source.lower().replace('loop/stall.py', ''), name)
        block = source.split('permissions:\n', 1)[1].split('\n\n', 1)[0]
        self.assertEqual({line.strip() for line in block.splitlines()},
                         {'issues: write', 'contents: read', 'pull-requests: read', 'actions: read'})
        self.assertIn("cron: '41 * * * *'", source)
        self.assertNotIn(': write', source.split('jobs:', 1)[1])


class Scripts(unittest.TestCase):
    def test_l24_proposed_instructions_do_not_control_the_reviewer(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            new_repo(path)
            trusted = ['AGENTS.md', 'CLAUDE.md', '.claude/rule.md', '.agents/builder.md', 'loop/rules.sh']
            for name in trusted:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('trusted')
            git(path, 'add', '.')
            git(path, 'commit', '-m', 'main')
            base = git(path, 'rev-parse', 'HEAD')
            for name in trusted + ['apps/AGENTS.md', '.claude/added.md']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('proposed')
            (root / 'product.txt').write_text('proposed product')
            git(path, 'add', '.')
            git(path, 'commit', '-m', 'PR')
            head = git(path, 'rev-parse', 'HEAD')
            subprocess.run(['bash', str(ROOT / 'loop/review-checkout.sh'), base], cwd=path, check=True)
            self.assertEqual(git(path, 'rev-parse', 'HEAD'), head)
            self.assertEqual((root / 'product.txt').read_text(), 'proposed product')
            for name in trusted:
                self.assertEqual((root / name).read_text(), 'trusted')
            self.assertFalse((root / 'apps/AGENTS.md').exists())
            self.assertFalse((root / '.claude/added.md').exists())

    def test_l2_builder_hook_stamps_commits_and_preserves_existing_attribution(self):
        with tempfile.TemporaryDirectory() as path:
            new_repo(path)
            subprocess.run(['bash', str(ROOT / 'loop/author.sh'), 'builder-test'], cwd=path,
                           env={**os.environ, 'RUNNER_TEMP': path}, check=True)
            git(path, 'commit', '--allow-empty', '-m', 'change')
            self.assertEqual(git(path, 'log', '-1', '--format=%(trailers:key=Author-Agent,valueonly)'), 'builder-test')
            git(path, 'commit', '--amend', '--allow-empty', '--no-edit')
            self.assertEqual(git(path, 'log', '-1', '--format=%(trailers:key=Author-Agent,valueonly)'), 'builder-test')
            git(path, 'commit', '--allow-empty', '-m', 'change', '-m', 'Author-Agent: another-author')
            self.assertEqual(git(path, 'log', '-1', '--format=%(trailers:key=Author-Agent,valueonly)'), 'another-author')


class L89(unittest.TestCase):
    def test_l121_boxd_tests_follow_their_integration_paths(self):
        import sys
        sys.path.insert(0, str(ROOT / 'loop'))
        import affected
        for path in ('loop/agent-runners/runner.mjs', 'loop/agent-runners/memory.test.py', 'loop/builder.py',
                     'loop/affected.py', 'loop/workflows.test.py', '.github/workflows/build-issue.yml',
                     '.github/workflows/loop.yml', '.github/actions/setup/action.yml', '.github/actionlint.yaml',
                     'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.npmrc', 'justfile',
                     'AGENTS.md', 'scenarios/loop-boxd.md'):
            with self.subTest(path=path):
                self.assertEqual(affected.boxd([path]), 'all')
        for changed in ([], ['apps/desktop/src/App.tsx'], ['crates/rupd/src/lib.rs'],
                        ['README.md', 'docs/perf.md'], ['loop/agent-runners-other/runner.mjs']):
            with self.subTest(changed=changed):
                self.assertEqual(affected.boxd(changed), [])

    def test_l89_a_pr_tests_what_its_diff_reaches(self):
        import sys
        sys.path.insert(0, str(ROOT / 'loop'))
        import affected
        workspace = {'contracts': ('crates/contracts', set()), 'rpc': ('crates/rpc', {'contracts'}),
                     'rupd': ('crates/rupd', {'rpc'}), 'rup': ('crates/rup', {'rpc', 'rupd'}), 'perf': ('crates/perf', set())}
        for changed, crates in ((['crates/rpc/src/lib.rs'], ['rpc', 'rup', 'rupd']),
                                (['crates/rup/tests/e2e/fake_claude.py'], ['rup', 'rupd']),
                                (['contracts/generated/Event.ts'], ['contracts', 'rpc', 'rup', 'rupd']),
                                (['docs/perf.md', 'apps/desktop/src/App.tsx'], []),
                                (['crates/perf/src/lib.rs', 'Cargo.lock'], 'all'), (['crates/gone/src/lib.rs'], 'all')):
            self.assertEqual(crates, affected.crates(changed, workspace), changed)
        test = 'apps/desktop/src/rail/u1_rail.test.tsx'
        for changed, tests in (([test, 'docs/perf.md'], [test]), (['crates/rupd/src/lib.rs'], [affected.DAEMON]),
                               (['scenarios/loop-rules.md'], []),
                               (['apps/desktop/observers/U1/run.py'], []), (['loop/builder.py'], []),
                               ([test, 'apps/desktop/src/rail/Rail.tsx'], ['apps/desktop/src/rail/Rail.tsx', test]),
                               (['apps/desktop/vite.config.ts'], 'all'), (['apps/desktop/index.html'], 'all'), (['scenarios/app.md'], 'all'),
                               (['pnpm-lock.yaml'], 'all')):
            self.assertEqual(tests, affected.web(changed), changed)

    def test_l89_the_gate_accepts_a_skipped_lane_only_on_a_pull_request(self):
        gate = (ROOT / '.github/workflows/check.yml').read_text().split('\n  check:\n', 1)[1].split('\n  summary:\n', 1)[0]
        script = gate.split('        run: |\n', 1)[1]

        def passes(event, **results):
            lanes = {'plan': 'success', 'lint': 'success', 'rust': 'success', 'web': 'success', **results}
            needs = json.dumps({lane: {'result': result} for lane, result in lanes.items()})
            return subprocess.run(['bash', '-c', script], env={**os.environ, 'NEEDS': needs, 'EVENT': event},
                                  capture_output=True).returncode == 0

        self.assertTrue(passes('pull_request', rust='skipped', web='skipped'))
        self.assertFalse(passes('push', rust='skipped'))
        self.assertFalse(passes('pull_request', rust='failure'))
        self.assertFalse(passes('pull_request', plan='skipped'))
        self.assertFalse(passes('pull_request', plan='failure', rust='skipped'))

    def test_l89_a_pr_runs_one_web_shard_per_fifty_selected_files_and_main_runs_seven(self):
        import sys
        sys.path.insert(0, str(ROOT / 'loop'))
        import affected
        for files, shards in ((0, [1]), (1, [1]), (50, [1]), (51, [1, 2]), (120, [1, 2, 3]), (9999, [1, 2, 3, 4, 5, 6, 7]),
                              ('all', [1, 2, 3, 4, 5, 6, 7])):
            self.assertEqual(shards, affected.shards(files), files)

    def test_l89_a_builder_check_reaches_its_uncommitted_and_untracked_files(self):
        import io
        import sys
        from contextlib import redirect_stdout
        from unittest.mock import patch
        sys.path.insert(0, str(ROOT / 'loop'))
        import affected
        test = 'apps/desktop/src/rail/u357_fold_line.test.ts'
        out = {'merge-base': 'fork\n', 'diff': 'docs/perf.md\n', 'ls-files': f'{test}\n'}
        calls = []

        def git(args, **_):
            calls.append(args[1:])
            return subprocess.CompletedProcess(args, 0, out[args[1]])
        with patch.object(affected.subprocess, 'run', side_effect=git), redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(affected.main(['affected.py', 'web', 'origin/main']), 0)
        self.assertEqual([['merge-base', 'origin/main', 'HEAD'], ['diff', '--name-only', '--no-renames', 'fork'],
                          ['ls-files', '--others', '--exclude-standard']], calls)
        # An App source file also reaches the tests that read the App's files as text, outside vitest's module graph.
        scans = ['apps/desktop/src/copy.test.ts', 'apps/desktop/src/testing/captures.test.ts', 'apps/desktop/src/a35_surface.test.ts']
        reached = printed.getvalue().split()
        self.assertIn(str(ROOT / test), reached)
        for scan in scans:
            self.assertIn(str(ROOT / scan), reached)
        self.assertIn('apps/desktop/src/a35_surface.test.ts', affected.app_scans([test]))
        self.assertEqual([], affected.app_scans(['docs/perf.md']))

    def test_l89_the_mac_lane_names_every_file_with_a_macos_path(self):
        # A new `target_os = "macos"` path needs its tests in `.config/nextest.toml`'s `mac` profile, then a line here.
        files = subprocess.check_output(['git', 'grep', '-l', 'target_os = "macos"', '--', 'crates'], cwd=ROOT, text=True)
        self.assertEqual(['crates/agents/tests/working_files.rs', 'crates/checkpoints/src/marks_tests.rs',
                          'crates/desktop/src/open.rs', 'crates/pads/tests/pads.rs', 'crates/rup/tests/project_data.rs',
                          'crates/rupd/src/data.rs'], files.split())

    def test_l89_every_setup_input_a_step_reads_or_a_job_passes_is_declared(self):
        # An undeclared input reads as an empty string: `inputs.node != 'false'` stays true and the step runs anyway.
        action = (ROOT / '.github/actions/setup/action.yml').read_text()
        declared = set(re.findall(r'^  ([a-z-]+):\n    description:', action.split('\nruns:', 1)[0], re.M))
        self.assertEqual(declared, set(re.findall(r'inputs\.([a-z-]+)', action)))
        for workflow in (ROOT / '.github/workflows').glob('*.yml'):
            for uses in re.finditer(r'uses: \./\.github/actions/setup\n(?:\s+with:\n((?:\s+[a-z-]+: .*\n)+))?', workflow.read_text()):
                passed = set(re.findall(r'^\s+([a-z-]+): ', uses[1] or '', re.M))
                self.assertLessEqual(passed, declared, workflow.name)

    def test_l89_a_check_recipe_runs_every_line_and_names_each_failed_one(self):
        with tempfile.TemporaryDirectory() as path:
            (Path(path) / 'justfile').write_text(f"[script('{ROOT}/loop/keep-going.sh')]\nlines:\n"
                                                 '    false\n    touch second\n    exit 7\n    touch fourth\n')
            result = subprocess.run(['just', 'lines'], cwd=path, capture_output=True, text=True, timeout=60)
            self.assertEqual(1, result.returncode)
            self.assertTrue((Path(path) / 'second').exists() and (Path(path) / 'fourth').exists())
            self.assertIn('failed lines:\n  false (exit 1)\n  exit 7 (exit 7)\n', result.stderr)

    def test_l89_nextest_runs_every_test_after_a_failure(self):
        import tomllib
        config = tomllib.loads((ROOT / '.config/nextest.toml').read_text())
        self.assertIs(False, config['profile']['default']['fail-fast'])


class L99(unittest.TestCase):
    def test_l99_no_test_runs_cargo(self):
        for path in (ROOT / 'crates').glob('*/*/**/*.rs'):
            if path.relative_to(ROOT / 'crates').parts[1] in ('tests', 'src'):
                text = path.read_text()
                self.assertNotIn('Command::new("cargo")', text, path)
                self.assertNotIn('env!("CARGO")', text, path)


class L82(unittest.TestCase):
    def test_l82_draft_check_cannot_cancel_a_ready_check(self):
        for workflow in ('check', 'pre'):
            with self.subTest(workflow=workflow):
                self.draft_check_cannot_cancel_a_ready_check(workflow)

    def draft_check_cannot_cancel_a_ready_check(self, workflow):
        source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
        group = source.split('concurrency:\n', 1)[1].split('  cancel-in-progress:', 1)[0]
        import json
        expression = group.split('${{', 1)[1].split('}}', 1)[0]

        def evaluate(draft, run, ref='refs/pull/1465/merge', sha='head'):
            context = {'event_name': 'pull_request', 'event': {'pull_request': {'draft': draft}},
                       'ref': ref, 'sha': sha, 'run_id': run}
            script = "const github = JSON.parse(process.argv[1]); const format = (s, v) => s.replace('{0}', v);"
            return subprocess.check_output(['node', '-e', script + f'console.log({expression});',
                                            json.dumps(context)], text=True).strip()

        self.assertNotEqual(evaluate(True, 1), evaluate(False, 2))
        self.assertEqual(evaluate(True, 1), evaluate(True, 2, sha='new-head'))
        self.assertEqual(evaluate(False, 2), evaluate(False, 3, sha='new-head'))
        self.assertIn('cancel-in-progress: true', source.split('jobs:', 1)[0])

    def test_l82_a_cancelled_check_run_ends_its_gate_cancelled_not_failed(self):
        gate = (ROOT / '.github/workflows/check.yml').read_text().split('\n  check:\n', 1)[1].split('\n  summary:\n', 1)[0]
        self.assertIn('${{ !cancelled() && ', gate)
        self.assertNotIn('always()', gate)


class L24(unittest.TestCase):
    def jobs(self, workflow):
        source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
        return {name: body for name, body in re.findall(r'^  ([a-z-]+):\n((?:(?:    .*)?\n)+)', source.split('\njobs:\n', 1)[1], re.M)}

    def test_l24_review_and_critic_wait_for_the_lints_alone_and_fix_answers_them(self):
        for workflow in ('review', 'critic'):
            self.assertIn('workflow_run:\n    workflows: [pre]', (ROOT / f'.github/workflows/{workflow}.yml').read_text())
        self.assertEqual({'plan', 'lint', 'lint-web', 'rekick', 'pre', 'summary'}, set(self.jobs('pre')))
        self.assertIn('workflows: [check, loop, pre]', (ROOT / '.github/workflows/fix.yml').read_text())

    def test_l24_no_test_lane_starts_before_the_approval(self):
        jobs = self.jobs('check')
        self.assertEqual({'approved', 'plan', 'rust', 'mac-clippy', 'mac', 'web', 'check', 'summary'}, set(jobs))
        self.assertIn('needs: approved\n', jobs['plan'])
        for lane in ('rust', 'mac-clippy', 'mac', 'web'):
            self.assertIn('needs: plan\n', jobs[lane], lane)
        self.assertRegex(jobs['check'], r'needs: \[plan, ')

    def approved(self, event, statuses):
        """Run the `approved` job's script with `gh` answering `statuses`; the gh calls, and the exit code."""
        job = self.jobs('check')['approved']
        self.assertIn('GH_REPO: ${{ github.repository }}', job)  # no checkout: `gh run cancel` has no git remote to read
        script = textwrap.dedent(job.rsplit('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'bin').mkdir()
            for name, body in (('gh', 'echo "$*" >>"$CALLS"\n[ "$1" != api ] || echo "$STATUSES"'), ('sleep', 'true')):
                (root / 'bin' / name).write_text(f'#!/bin/bash\n{body}\n')
                (root / 'bin' / name).chmod(0o755)
            result = subprocess.run(['bash', '-eo', 'pipefail', '-c', script], text=True, capture_output=True,
                                    env={**os.environ, 'PATH': f'{root}/bin:{os.environ["PATH"]}', 'CALLS': f'{root}/calls',
                                         'GITHUB_EVENT_NAME': event, 'GITHUB_REPOSITORY': 'o/r', 'GITHUB_RUN_ID': '7',
                                         'HEAD': 'h', 'GH_TOKEN': 't', 'STATUSES': json.dumps(dict(statuses=statuses))})
            calls = (root / 'calls').read_text().splitlines() if (root / 'calls').exists() else []
            return calls, result.returncode

    def test_l24_a_pr_head_passes_only_with_review_and_critic_success_else_its_run_is_cancelled(self):
        both = [dict(context='review', state='success'), dict(context='critic', state='success')]
        self.assertEqual(self.approved('pull_request', both), (['api repos/o/r/commits/h/status'], 0))
        for statuses in (both[:1], [both[0], dict(context='critic', state='pending')],
                         [dict(context='review', state='failure'), both[1]], []):
            with self.subTest(statuses=statuses):
                self.assertEqual(self.approved('pull_request', statuses),
                                 (['api repos/o/r/commits/h/status', 'run cancel 7'], 1))
        self.assertEqual(self.approved('push', []), ([], 0))


class L46(unittest.TestCase):
    def test_l46_the_rules_job_runs_the_empty_diff_gate_on_every_pull_request(self):
        source = (ROOT / '.github/workflows/loop.yml').read_text()
        step = source.split('run: loop/rules.sh empty-diff "$PR"', 1)[0].rsplit('      - ', 1)[1]
        self.assertIn("github.event_name == 'pull_request'", step)

    def test_l46_a_workflow_job_posts_each_required_check(self):
        for workflow, job in (('check', 'check'), ('loop', 'rules'), ('review', 'post'), ('critic', 'post')):
            self.assertIn(f'\n  {job}:\n', (ROOT / f'.github/workflows/{workflow}.yml').read_text(), workflow)
        self.assertIn("f'context={context}'", (ROOT / 'loop/builder.py').read_text())


if __name__ == '__main__':
    unittest.main()
