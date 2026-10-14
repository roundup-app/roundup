#!/usr/bin/env python3
"""L2, L23, L24, L46, L82, L89, L99: what the workflows grant each run, the scripts they run before a model starts, and the jobs
that post the required checks."""
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


def action_inputs(workflow):
    """The `with:` block and env of a workflow's claude-code-action step."""
    source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
    return source.split('uses: anthropics/claude-code-action@v1', 1)[1].split('      - ', 1)[0]


def check_lanes():
    """The check-run names of the jobs `check`'s gate needs, each matrix partition expanded as GitHub names it."""
    source = (ROOT / '.github/workflows/check.yml').read_text()
    gate = source.split('\n  check:\n', 1)[1]
    names = []
    for job in re.search(r'needs: \[(.*?)\]', gate)[1].split(', '):
        block = source.split(f'\n  {job}:\n', 1)[1].split('\n\n', 1)[0]
        name = re.search(r'(?m)^    name: (.+)$', block)
        partitions = re.search(r'(?m)^        partition: \[(.*?)\]$', block)
        names += [name[1].replace('${{ matrix.partition }}', part) for part in partitions[1].split(', ')] if partitions else [job]
    return names


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
              **{(key if key.startswith('github.') else f'github.event.workflow_run.{key}'): value
                 for key, value in run.items()}}
    expression = re.sub(r'github\.[a-z_.]+', lambda match: repr(values[match[0]]), expression)
    expression = expression.replace('\n', ' ').replace('&&', ' and ').replace('||', ' or ')
    return eval(expression, {'__builtins__': {}, 'format': lambda template, *args: template.format(*args)})


class CodexCompletion(unittest.TestCase):
    def test_l23_failed_build_and_fix_jobs_run_login_observation(self):
        for name in ('build-issue', 'fix-branch'):
            with self.subTest(workflow=name):
                source = (ROOT / f'.github/workflows/{name}.yml').read_text()
                observer = source.split('\n  codex-completion:\n', 1)[1].split('\n  summary:', 1)[0]
                self.assertIn('ref: main', observer)
                self.assertIn('persist-credentials: false', observer)
                observe = observer.split('- name: Observe masked Codex completion', 1)[1]
                self.assertIn('if: always()', observe)
                self.assertIn('python3 loop/builder.py codex-login', observe)
                for forbidden in ("ran == 'true'", 'CODEX_AUTH', 'execution_file',
                                  'actions: write', 'contents: write', 'pull-requests: write', 'statuses: write'):
                    self.assertNotIn(forbidden, observer)


class DownstreamDraft(unittest.TestCase):
    def check_title(self, draft, event='pull_request', title='Draft check'):
        source = (ROOT / '.github/workflows/check.yml').read_text()
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

    def test_l24_l103_check_marks_only_draft_pull_request_events(self):
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

    def test_l24_l103_late_draft_completion_cannot_replace_real_review(self):
        for workflow in ('review', 'critic'):
            with self.subTest(workflow=workflow):
                self.assertNotEqual(self.group(workflow, self.real), self.group(workflow, self.draft))
                self.assertNotEqual(self.group(workflow, self.draft),
                                    self.group(workflow, {**self.draft, 'id': 103}))

    def test_l24_l103_new_real_heads_supersede_older_real_reviews(self):
        for workflow in ('review', 'critic'):
            with self.subTest(workflow=workflow):
                self.assertEqual(self.group(workflow, self.real),
                                 self.group(workflow, {**self.real, 'id': 103, 'head_sha': 'b' * 40}))

    def test_l24_l103_draft_event_never_admits_a_task_after_readiness(self):
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

    def test_l24_l103_gate_definitions_and_publishers_remain_trusted(self):
        for workflow in ('review', 'critic'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            self.assertIn('workflow_run:\n    workflows: [check]', source)
            self.assertNotIn('pull_request_target:', source)
            for name in ('task', 'post'):
                job = re.split(r'\n  [a-z][a-z-]*:', source.split(f'\n  {name}:\n', 1)[1], maxsplit=1)[0]
                self.assertIn('ref: main', job)
            self.assertIn('git show origin/main:loop/review-checkout.sh | bash', source)


class L23Budget(unittest.TestCase):
    def test_l23_trusted_reads_use_the_app_while_gates_keep_the_workflow_token(self):
        selected = {'build': ['pick'], 'build-issue': ['after'], 'fix': ['branch'],
                    'fix-branch': ['task', 'after'], 'review': ['task', 'post'], 'critic': ['task', 'post']}
        import re
        for workflow, jobs in selected.items():
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            for name in jobs:
                job = source.split(f'\n  {name}:\n',1)[1]
                job = re.split(r'\n  [a-z][a-z-]*:\n', job, maxsplit=1)[0]
                self.assertIn('id-token: write', job)
                self.assertIn('run: python3 loop/builder.py read-token', job)
                self.assertIn('ref: main', job)
                self.assertIn('GH_TOKEN: ${{ github.token }}', job)
        for workflow in ('review', 'critic'):
            model = (ROOT / f'.github/workflows/{workflow}.yml').read_text().split(
                f'\n  {workflow}-run:',1)[1].split('\n  post:',1)[0]
            self.assertNotIn('id-token:', model)
            self.assertNotIn('builder.py read-token', model)
            self.assertIn('github_token: ${{ github.token }}', model)

    def test_l23_collectors_cannot_lend_exchange_authority_to_models(self):
        for workflow in ('retro', 'care'):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            collect, model = source.split(f'\n  {workflow}:\n', 1)
            self.assertIn('id-token: write', collect)
            self.assertIn('run: python3 loop/builder.py read-token', collect)
            self.assertIn('GH_TOKEN: ${{ github.token }}', collect)
            self.assertNotIn('issues: write', collect.split('\n  collect:',1)[1])
            self.assertNotIn('id-token:', model)
            self.assertIn('needs: collect', model)
            self.assertIn('ref: ${{ needs.collect.outputs.head }}', model)
            self.assertIn('actions/download-artifact@v4', model)


class Care(unittest.TestCase):
    def test_l107_daily_dispatch_uses_one_sonnet_run(self):
        source = (ROOT / '.github/workflows/care.yml').read_text()
        self.assertIn('workflow_dispatch:', source)
        self.assertEqual(1, source.count('uses: anthropics/claude-code-action'))
        self.assertIn('--model claude-sonnet-5-5', source)
        self.assertIn('CLAUDE_CODE_OAUTH_TOKEN', source)
        self.assertNotIn('FABLE', source.upper())
        self.assertLess(source.index('loop/care.py --repo "$REPOSITORY" input'), source.index('uses: anthropics/'))

    def test_l107_workflow_cannot_push_or_edit_code(self):
        source = (ROOT / '.github/workflows/care.yml').read_text()
        permissions = source.split('permissions:', 1)[1].split('defaults:', 1)[0]
        self.assertEqual({'contents: read', 'actions: read', 'pull-requests: read', 'issues: write'},
                         {line.strip() for line in permissions.splitlines() if line.strip()})
        self.assertIn('persist-credentials: false', source)
        self.assertIn('ref: main', source)
        self.assertNotIn('git push', source)
        self.assertNotIn('loop/builder.py', source.split('\n  care:', 1)[1])
        self.assertNotIn('Edit,', source)
        self.assertNotIn('Write,', source)
        self.assertNotIn('Bash', action_inputs('care'))
        self.assertIn('git diff --exit-code', source)

    def test_l107_only_script_publishes(self):
        source = (ROOT / '.github/workflows/care.yml').read_text()
        self.assertIn('loop/care.py --repo "$REPOSITORY" publish', source)
        self.assertIn('--allowedTools Read,Glob,Grep', action_inputs('care'))
        self.assertIn('--tools Read,Glob,Grep', action_inputs('care'))
        self.assertIn('--strict-mcp-config', action_inputs('care'))
        self.assertIn('--mcp-config', action_inputs('care'))
        self.assertIn('{"mcpServers":{}}', action_inputs('care'))


class Permissions(unittest.TestCase):
    def test_l23_build_and_fix_runs_run_on_codex_signed_in_with_the_users_chatgpt_login(self):
        # builder.test.py proves `builder.py codex` asks the App for workflow changes and read-only CI evidence.
        for workflow, loop in (('build-issue', '$RUNNER_TEMP/loop'), ('fix-branch', '$RUNNER_TEMP/main/loop')):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            self.assertNotIn('claude-code-action', source, workflow)
            self.assertIn("builder: 'true'", source, workflow)
            step = source.split('      - id: codex\n', 1)[1].split('\n      - ', 1)[0]
            self.assertIn('CODEX_AUTH: ${{ secrets.CODEX_AUTH_JSON }}', step, workflow)
            self.assertIn(f'python3 "{loop}/builder.py" codex gpt-6.1-sol', step, workflow)
            self.assertNotIn('github.token', step, workflow)

    def test_l24_the_review_run_keeps_the_read_only_workflow_token(self):
        inputs = action_inputs('review')
        self.assertIn('github_token: ${{ github.token }}', inputs)
        self.assertNotIn('additional_permissions:', inputs)
        source = (ROOT / '.github/workflows/review.yml').read_text()
        job = source.split('  review-run:', 1)[1].split('    steps:', 1)[0]
        self.assertNotIn(': write', job)

    def test_l24_the_review_run_runs_on_sonnet(self):
        self.assertIn('--model claude-sonnet-5-5\n', action_inputs('review'))


class Build(unittest.TestCase):
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
    def test_l89_required_gate_rejects_failed_cancelled_and_skipped_lanes(self):
        import itertools
        text = (ROOT / '.github/workflows/check.yml').read_text()
        command = text.split('        run: test ')[1].splitlines()[0].strip()
        lanes = ('LINT', 'RUST', 'MAC', 'WEB')
        for results in itertools.product(('success', 'failure', 'cancelled', 'skipped'), repeat=len(lanes)):
            result = subprocess.run(['bash', '-c', 'test ' + command], env={**os.environ, **dict(zip(lanes, results))})
            self.assertEqual(result.returncode == 0, set(results) == {'success'}, results)

    def test_l89_l82_every_lane_the_gate_needs_is_a_check_lane_a_fix_run_blames(self):
        import sys
        sys.path.insert(0, str(ROOT / 'loop'))
        import builder
        self.assertEqual(['lint', 'rust 1', 'rust 2', 'mac', 'web'], check_lanes())
        self.assertEqual(('check.yml', tuple(check_lanes())), builder.LANES['check'])

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
                               (['scenarios/loop-rules.md'], ['apps/desktop/src/testing/u453_viewports.test.ts']),
                               (['apps/desktop/observers/U1/run.py'], []), (['loop/builder.py'], []),
                               ([test, 'apps/desktop/src/rail/Rail.tsx'], 'all'), (['scenarios/app.md'], 'all'),
                               (['pnpm-lock.yaml'], 'all')):
            self.assertEqual(tests, affected.web(changed), changed)

    def test_l89_the_mac_lane_names_every_file_with_a_macos_path(self):
        # A new `target_os = "macos"` path needs its tests in `.config/nextest.toml`'s `mac` profile, then a line here.
        files = subprocess.check_output(['git', 'grep', '-l', 'target_os = "macos"', '--', 'crates'], cwd=ROOT, text=True)
        self.assertEqual(['crates/agents/tests/working_files.rs', 'crates/checkpoints/src/marks_tests.rs',
                          'crates/desktop/src/open.rs', 'crates/pads/tests/pads.rs', 'crates/rup/tests/project_data.rs',
                          'crates/rupd/src/data.rs'], files.split())

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
        source = (ROOT / '.github/workflows/check.yml').read_text()
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

    def test_l82_duplicate_ends_before_the_branch_queue_with_a_summary(self):
        source = (ROOT / '.github/workflows/fix.yml').read_text()
        self.assertNotIn('\nconcurrency:', source)
        self.assertIn('ref: main', source)
        self.assertIn('actions: read', source)
        step = source.split('      - id: branch\n', 1)[1].split('      - uses:', 1)[0]
        script = step.split('        run: |\n', 1)[1]
        script = '\n'.join(line.removeprefix('          ') for line in script.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            python = path / 'python3'
            python.write_text('#!/bin/sh\necho "Skip fix: same PR, cause and head already held by run 10."\nexit 3\n')
            python.chmod(0o755)
            summary = path / 'summary'
            output = path / 'output'
            result = subprocess.run(['bash', '-eo', 'pipefail', '-c', script], text=True, capture_output=True,
                                    env={**os.environ, 'PATH': f'{path}:{os.environ["PATH"]}',
                                         'PR': '9', 'HEAD': 'a' * 40, 'CAUSE': 'review', 'RUNNER_TEMP': directory,
                                         'GITHUB_OUTPUT': str(output), 'GITHUB_STEP_SUMMARY': str(summary)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Skip fix:', summary.read_text())
            self.assertEqual((path / 'summary.md').read_text(), summary.read_text())
            self.assertFalse(output.exists())

    def test_l82_a_waiting_fix_reads_the_latest_head_and_reports_a_stale_cause(self):
        source = (ROOT / '.github/workflows/fix-branch.yml').read_text()
        step = source.split('      - id: task\n', 1)[1].split('\n  fix-run:', 1)[0]
        script = step.split('        run: |\n', 1)[1]
        script = '\n'.join(line.removeprefix('          ') for line in script.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            gh = path / 'python3'
            gh.write_text('#!/bin/sh\necho "Skip fix: full head moved. Recheck after checks on the new head. No fix model started." >&2\nexit 3\n')
            gh.chmod(0o755)
            summary = path / 'summary'
            result = subprocess.run(['bash', '-eo', 'pipefail', '-c', script], text=True, capture_output=True,
                                    env={**os.environ, 'PATH': f'{path}:{os.environ["PATH"]}',
                                         'PR': '9', 'HEAD': 'a' * 40, 'BRANCH': 'build/U1', 'CAUSE': 'review',
                                         'RUNNER_TEMP': directory, 'GITHUB_STEP_SUMMARY': str(summary)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Skip fix: full head moved', summary.read_text())
            self.assertEqual((path / 'task.md').read_text(), '')

    def test_l82_retry_workflows_do_not_bypass_required_gates(self):
        for workflow, job in (('build', 'pick'), ('build-issue', 'after'), ('fix', 'branch'),
                              ('fix-branch', 'task'), ('fix-branch', 'after'), ('review', 'post'), ('critic', 'post')):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            import re
            block = re.split(r'\n  [a-z][a-z-]*:\n', source.split(f'\n  {job}:\n', 1)[1], maxsplit=1)[0]
            self.assertIn('contents: write', block)
            self.assertIn('GH_TOKEN: ${{ github.token }}', block)
            self.assertNotIn('pr merge', block)
        for workflow in ('review', 'critic'):
            model = (ROOT / f'.github/workflows/{workflow}.yml').read_text().split(f'\n  {workflow}-run:', 1)[1].split('\n  post:', 1)[0]
            self.assertNotIn('contents: write', model)
            self.assertNotIn('actions: write', model)

    def test_l82_a_cancelled_check_run_ends_its_gate_cancelled_not_failed(self):
        gate = (ROOT / '.github/workflows/check.yml').read_text().split('\n  check:\n', 1)[1].split('\n  summary:\n', 1)[0]
        self.assertIn('${{ !cancelled() && ', gate)
        self.assertNotIn('always()', gate)


class L103(unittest.TestCase):
    def test_l103_the_critic_reads_main_rules_not_the_heads(self):
        source = (ROOT / '.github/workflows/critic.yml').read_text()
        self.assertIn('workflow_run:\n    workflows: [check]', source)
        self.assertIn('git show origin/main:loop/review-checkout.sh | bash', source)
        self.assertIn('git restore --source=origin/main --worktree -- docs/design-system.md', source)
        self.assertIn('--model claude-opus-5-5', action_inputs('critic'))
        job = source.split('  critic-run:', 1)[1].split('    steps:', 1)[0]
        self.assertNotIn(': write', job)
        self.assertIn('github_token: ${{ github.token }}', action_inputs('critic'))


class L46(unittest.TestCase):
    def test_l46_a_workflow_job_posts_each_required_check(self):
        for workflow, job in (('check', 'check'), ('loop', 'rules'), ('critic', 'post')):
            self.assertIn(f'\n  {job}:\n', (ROOT / f'.github/workflows/{workflow}.yml').read_text(), workflow)
        self.assertIn("f'context={context}'", (ROOT / 'loop/builder.py').read_text())


class Retro(unittest.TestCase):
    def test_l106_daily_dispatch_uses_one_sonnet_run(self):
        source = (ROOT / '.github/workflows/retro.yml').read_text()
        self.assertEqual(source.count('uses: anthropics/claude-code-action@v1'), 1)
        self.assertEqual(source.count('cron:'), 1)
        self.assertIn('workflow_dispatch:', source)
        self.assertIn('--model claude-sonnet-5-5', source)
        self.assertIn('claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}', source)
        self.assertNotIn('fable', source.lower())
        self.assertLess(source.index('loop/retro.py --repo "$REPOSITORY" input'), source.index('id: claude'))

    def test_l106_retro_has_only_read_and_issue_write_authority(self):
        source = (ROOT / '.github/workflows/retro.yml').read_text()
        permissions = source.split('permissions:\n', 1)[1].split('\ndefaults:', 1)[0]
        self.assertEqual(permissions.strip(), 'contents: read\n  actions: read\n  pull-requests: read\n  issues: write')
        self.assertIn('persist-credentials: false', source)
        self.assertNotIn('APP_PRIVATE_KEY', source)


def load_tests(loader, tests, pattern):
    """L106: the existing loop CI entry also runs Retro's paginated GitHub fixture suite."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('retro_tests', ROOT / 'loop/retro.test.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec = importlib.util.spec_from_file_location('care_tests', ROOT / 'loop/care.test.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Library/tool fixtures run in care.yml after pinned installation. The read/publish
    # fixtures run here too, so the existing required rules gate covers publication.
    library_fixtures = {
        'test_l107_inventory_distinguishes_missing_retired_and_active_ids',
        'test_l107_assertion_inventory_follows_helpers_and_expected_errors',
        'test_l107_collects_largest_files_and_functions',
        'test_l107_comments_and_strings_never_count_as_assertions',
        'test_l107_collects_typescript_and_rust_clones_below_ci_limits',
    }
    for name in loader.getTestCaseNames(module.Care):
        if name not in library_fixtures:
            tests.addTest(module.Care(name))
    return tests


class RenewedFixObserver(unittest.TestCase):
    def test_l82_renewed_observer_criterion_fixtures(self):
        result = subprocess.run(['python3', str(ROOT / 'loop/fix-observer.test.py')],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class ApiMeasurement(unittest.TestCase):
    def test_l114_missing_samples_are_not_zero(self):
        import json
        import textwrap
        source = (ROOT / '.github/workflows/stall.yml').read_text()
        finish = source.split('- name: Finish API measurement', 1)[1].split('- name: Retain API measurement', 1)[0]
        command = textwrap.dedent(finish.split('run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, RUNNER_TEMP=directory, GITHUB_WORKFLOW='stall', GITHUB_RUN_ID='123',
                       GITHUB_JOB='stall', GITHUB_REPOSITORY='saadshahd/roundup')
            result = subprocess.run(['bash', '-eo', 'pipefail', '-c', command], env=env,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(Path(directory, 'loop-api-measurement/summary.json').read_text())
            self.assertEqual(summary['missing'][0]['boundary'], 'both')
            self.assertEqual(summary['intervals'], [])
            self.assertIsNone(summary['missing'][0]['used'])
            self.assertIn('/actions/runs/123', summary['missing'][0]['run_url'])

    def test_l114_token_routing_preserves_role_permissions(self):
        for name, job in [('review', 'review-run'), ('critic', 'critic-run'), ('fix-branch', 'fix-run')]:
            text = (ROOT / f'.github/workflows/{name}.yml').read_text()
            body = re.split(r'\n  [a-z][a-z-]*:\n', text.split(f'\n  {job}:\n', 1)[1])[0]
            permissions = body.split('permissions:', 1)[1].split('outputs:', 1)[0]
            for forbidden in ('statuses:', 'checks: write', 'administration:', 'actions: write'):
                self.assertNotIn(forbidden, permissions)
            self.assertIn('MEASUREMENT_REF: main', body)
            self.assertIn('ref: ${{ needs.task.outputs.', body)
        for name in ('fix', 'fix-branch', 'review', 'critic', 'retro', 'care', 'fix-observer'):
            self.assertIn('read-token', (ROOT / f'.github/workflows/{name}.yml').read_text())


if __name__ == '__main__':
    unittest.main()
