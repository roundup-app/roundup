#!/usr/bin/env python3
"""L2, L23, L24, L46, L82, L89, L99: what the workflows grant each run, the scripts they run before a model starts, and the jobs
that post the required checks."""
import os
from pathlib import Path
import subprocess
import tempfile
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


class Care(unittest.TestCase):
    def test_l107_daily_dispatch_uses_one_sonnet_run(self):
        source = (ROOT / '.github/workflows/care.yml').read_text()
        self.assertIn('workflow_dispatch:', source)
        self.assertEqual(1, source.count('uses: anthropics/claude-code-action'))
        self.assertIn('--model claude-sonnet-5-5', source)
        self.assertIn('CLAUDE_CODE_OAUTH_TOKEN', source)
        self.assertNotIn('FABLE', source.upper())
        self.assertLess(source.index('loop/care.py --repo "$REPOSITORY" input'), source.index('uses: anthropics/'))

    def test_l107_care_runs_are_serial_and_outside_retro_hour(self):
        import re
        source = (ROOT / '.github/workflows/care.yml').read_text()
        self.assertIn('group: care', source)
        self.assertIn('cancel-in-progress: false', source)
        care_hour = re.search(r"cron: '[0-9]+ ([0-9]+) ", source)[1]
        retro_hour = re.search(r"cron: '[0-9]+ ([0-9]+) ", (ROOT / '.github/workflows/retro.yml').read_text())[1]
        self.assertNotEqual(care_hour, retro_hour)

    def test_l107_workflow_cannot_push_or_edit_code(self):
        source = (ROOT / '.github/workflows/care.yml').read_text()
        permissions = source.split('permissions:', 1)[1].split('defaults:', 1)[0]
        self.assertEqual({'contents: read', 'actions: read', 'pull-requests: read', 'issues: write'},
                         {line.strip() for line in permissions.splitlines() if line.strip()})
        self.assertIn('persist-credentials: false', source)
        self.assertIn('ref: main', source)
        self.assertNotIn('git push', source)
        self.assertNotIn('loop/builder.py', source)
        self.assertNotIn('Edit,', source)
        self.assertNotIn('Write,', source)
        self.assertNotIn('Bash', action_inputs('care'))
        self.assertIn('git diff --exit-code', source)

    def test_l107_only_script_publishes(self):
        source = (ROOT / '.github/workflows/care.yml').read_text()
        self.assertIn('loop/care.py --repo "$REPOSITORY" publish', source)
        self.assertIn('--allowedTools Read,Glob,Grep', action_inputs('care'))
        self.assertIn('--tools Read,Glob,Grep', action_inputs('care'))
        self.assertIn('only the script publishes', (ROOT / '.agents/care.md').read_text())
        self.assertIn('loop/care.test.py', source)
        self.assertIn('loop/retro.test.py', source)

    def test_l107_loop_table_names_care(self):
        source = (ROOT / 'AGENTS.md').read_text()
        self.assertIn('care.yml', source)
        self.assertIn('L107', source)
        self.assertIn('Work Issues', next(line for line in source.splitlines() if 'care.yml' in line))


class Permissions(unittest.TestCase):
    def test_l23_l82_observer_dispatch_authority_never_reaches_builder_or_gates(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        job = source.split('\n  branch-observer:\n', 1)[1].split('\n  summary:', 1)[0]
        self.assertIn('actions: write', job)
        self.assertIn('contents: read', job)
        self.assertIn('pull-requests: read', job)
        self.assertNotIn('statuses:', job)
        self.assertNotIn('checks:', job)
        self.assertNotIn('codex', job)
        self.assertIn('ref: main', job)
        self.assertIn('if: always()', job)
        self.assertIn('group: l23-l82-observer', job)
        self.assertIn('loop/branch-observer.py', job)
        for path in ('fix.yml', 'fix-branch.yml'):
            self.assertIn('actions/upload-artifact@v4', (ROOT / '.github/workflows' / path).read_text())

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
    def test_l23_new_work_issues_start_a_pick_without_an_intake_label(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        self.assertIn('types: [opened, reopened, unlabeled]', source)
        pick = source.split('  pick:', 1)[1].split('    runs-on:', 1)[0]
        for text in ('\'["flag:needs-user", "flag:needs-mac"]\'), github.event.label.name', '["saadshahd", "claude[bot]", "github-actions[bot]"]'):
            self.assertIn(text, pick)
        for text in ('loop:work', 'COLLABORATOR', 'author_association'):
            self.assertNotIn(text, pick)
        self.assertNotIn('ready-for-agent', source)

    def test_l23_sixteen_build_jobs_at_most(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        self.assertIn("default: '16'", source)
        self.assertIn("MAX: ${{ inputs.max || '16' }}", source)

    def test_l23_each_issue_whose_model_worked_starts_the_next_pick_when_its_own_build_ends(self):
        caller = (ROOT / '.github/workflows/build.yml').read_text()
        self.assertIn('uses: ./.github/workflows/build-issue.yml', caller)
        self.assertNotIn('  after:', caller)
        source = (ROOT / '.github/workflows/build-issue.yml').read_text()
        build = source.split('  build:', 1)[1].split('\n  after:', 1)[0]
        after = source.split('\n  after:', 1)[1]
        # The Builder's job holds no write; only `after`, which runs no model, dispatches.
        self.assertNotIn('actions: write', build)
        for grant in ('issues: write', 'pull-requests: write'):
            self.assertNotIn(grant, build)
        self.assertIn('needs: build', after)
        self.assertIn('actions: write', after)
        step = after.split('gh workflow run build.yml', 1)[0].rsplit('      - ', 1)[1]
        # Only a job whose model did work dispatches, so a usage limit ends the chain instead of spinning it.
        self.assertIn("env.RAN == 'true'", step)

    def test_l79_a_build_runs_ask_reaches_builder_py_built(self):
        source = (ROOT / '.github/workflows/build-issue.yml').read_text()
        build, after = source.split('\n  after:', 1)
        self.assertIn('"required":["ask"]', build)
        self.assertIn('answer: ${{ steps.codex.outputs.structured_output }}', build)
        self.assertIn('ANSWER: ${{ needs.build.outputs.answer }}', after)
        self.assertIn('printf \'%s\' "$ANSWER" | python3 loop/builder.py built "$ISSUE" "$SLUG" "$RAN" "$VERDICT"', after)

    def test_l79_the_build_job_screens_the_ask_with_mains_screen_and_after_reads_the_verdict(self):
        source = (ROOT / '.github/workflows/build-issue.yml').read_text()
        build, after = source.split('\n  after:', 1)
        self.assertIn('cp .agents/screen.md "$RUNNER_TEMP/.agents/"', build)
        screen = build.split('      - id: screen\n', 1)[1]
        self.assertIn("if: always() && steps.codex.outputs.structured_output != ''", screen)
        self.assertIn('python3 "$RUNNER_TEMP/loop/builder.py" screen "build/$SLUG"', screen)
        self.assertIn('GH_TOKEN: ${{ github.token }}', screen.split('\n      - ', 1)[0])
        self.assertIn('verdict: ${{ steps.screen.outputs.verdict }}', build)
        self.assertIn('VERDICT: ${{ needs.build.outputs.verdict }}', after)

    def test_l79_the_fix_run_screens_its_stopped_draft_with_mains_screen_and_after_reads_the_verdict(self):
        source = (ROOT / '.github/workflows/fix-branch.yml').read_text()
        run, after = source.split('\n  fix-run:', 1)[1].split('\n  after:', 1)
        self.assertIn('            .agents\n', run.split('sparse-checkout: |', 1)[1].split('persist-credentials', 1)[0])
        screen = run.split('      - id: screen\n', 1)[1].split('\n      - ', 1)[0]
        self.assertIn("if: always() && steps.ran.outputs.ran == 'true'", screen)
        self.assertIn('python3 "$RUNNER_TEMP/main/loop/builder.py" screen "$BRANCH"', screen)
        self.assertIn('GH_TOKEN: ${{ github.token }}', screen)
        self.assertIn('verdict: ${{ steps.screen.outputs.verdict }}', run)
        self.assertIn('VERDICT: ${{ needs.fix-run.outputs.verdict }}', after)
        self.assertIn('python3 loop/builder.py fixed "$PR" "$CAUSE" "$RAN" "$VERDICT" "$HEAD"', after)


class Keep(unittest.TestCase):
    def test_l23_a_run_keeps_its_commits_with_a_fresh_app_token_before_the_screen_reads_it(self):
        for workflow, job, keep in (('build-issue', 'build', '"$RUNNER_TEMP/loop/builder.py" keep "build/$SLUG" "$ISSUE"'),
                                    ('fix-branch', 'fix-run', '"$RUNNER_TEMP/main/loop/builder.py" keep "$BRANCH"')):
            source = (ROOT / f'.github/workflows/{workflow}.yml').read_text()
            body = source.split(f'\n  {job}:\n', 1)[1].split('\n  after:\n', 1)[0]
            self.assertIn('    timeout-minutes: 120\n', body, workflow)
            self.assertIn('      id-token: write\n', body, workflow)
            steps = body.split('\n      - ')
            ids = [step.split('\n', 1)[0].removeprefix('id: ') for step in steps]
            codex, step = steps[ids.index('codex')], steps[ids.index('keep')]
            self.assertIn('        timeout-minutes: 105\n', codex, workflow)
            self.assertLess(ids.index('codex'), ids.index('keep'))
            self.assertLess(ids.index('keep'), ids.index('screen'))
            self.assertLess(ids.index('keep'), ids.index('worked' if job == 'build' else 'ran'))
            self.assertIn('if: always()', step, workflow)
            self.assertIn(f'run: python3 {keep}', step, workflow)
            self.assertIn('GH_TOKEN: ${{ github.token }}', step, workflow)


class Stall(unittest.TestCase):
    def test_l94_after_dispatches_observation_with_existing_write_authority(self):
        source = (ROOT / '.github/workflows/build-issue.yml').read_text()
        build, after = source.split('\n  after:', 1)
        self.assertNotIn('actions: write', build)
        self.assertIn('actions: write', after)
        step = after.split('python3 loop/stall.py dispatch-observation', 1)[0].rsplit('      - ', 1)[1]
        self.assertIn("if: always() && needs.build.result == 'success' && env.RAN == 'true'", step)
        self.assertIn('GH_TOKEN: ${{ github.token }}', after)
        source = (ROOT / '.github/workflows/stall.yml').read_text()
        self.assertIn('build_run:', source)
        self.assertIn('python3 loop/stall.py observe "$BUILD_RUN"', source)
        self.assertIn('ref: main', source)
        self.assertIn('gh issue comment 1285 --body-file', source)
        self.assertIn("if: github.event_name == 'workflow_dispatch' && inputs.build_run != ''", source)
        self.assertIn('BUILD_RUN: ${{ inputs.build_run }}', source)
        self.assertIn('Stall: https://github.com/%s/actions/runs/%s', source)
        self.assertLess(source.index('python3 loop/stall.py observe'), source.index('gh issue comment 1285'))

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
    def test_l89_required_gate_rejects_failed_cancelled_and_skipped_lanes(self):
        text = (ROOT / '.github/workflows/check.yml').read_text()
        command = text.split('        run: test ')[1].splitlines()[0].strip()
        for rust in ('success', 'failure', 'cancelled', 'skipped'):
            for web in ('success', 'failure', 'cancelled', 'skipped'):
                result = subprocess.run(['bash', '-c', 'test ' + command], env={**os.environ, 'RUST': rust, 'WEB': web})
                self.assertEqual(result.returncode == 0, rust == web == 'success')

    def test_l89_local_and_ci_use_the_same_recipes(self):
        text = (ROOT / 'justfile').read_text()
        self.assertIn('check: check-rust check-web', text)
        workflows = (ROOT / '.github/workflows/check.yml').read_text()
        self.assertIn('run: just check-rust', workflows)
        self.assertIn('run: just check-web', workflows)
        self.assertIn('needs: [rust, web]', workflows)


class L99(unittest.TestCase):
    def test_l99_check_rust_builds_the_binaries_before_nextest(self):
        recipe = (ROOT / 'justfile').read_text().split('check-rust:\n', 1)[1].split('\n\n', 1)[0].splitlines()
        lines = [line.strip() for line in recipe]
        build = next(i for i, line in enumerate(lines) if line.endswith('cargo build --quiet -p rupd -p rup'))
        self.assertLess(build, lines.index('cargo nextest run'))

    def test_l99_no_test_runs_cargo(self):
        for path in (ROOT / 'crates').glob('*/*/**/*.rs'):
            if path.relative_to(ROOT / 'crates').parts[1] in ('tests', 'src'):
                text = path.read_text()
                self.assertNotIn('Command::new("cargo")', text, path)
                self.assertNotIn('env!("CARGO")', text, path)


class L82(unittest.TestCase):
    def test_l82_build_and_fix_hold_one_branch_until_all_writes_end(self):
        build = (ROOT / '.github/workflows/build-issue.yml').read_text()
        caller = (ROOT / '.github/workflows/fix.yml').read_text()
        fix = (ROOT / '.github/workflows/fix-branch.yml').read_text()
        self.assertIn('group: branch-build/${{ inputs.slug }}', build)
        self.assertIn('group: branch-${{ inputs.branch }}', fix)
        self.assertIn('cancel-in-progress: false', fix)
        self.assertIn('queue: max', build)
        self.assertIn('queue: max', fix)
        self.assertLess(fix.index('concurrency:'), fix.index('jobs:'))
        self.assertIn('uses: ./.github/workflows/fix-branch.yml', caller)
        self.assertIn('branch: ${{ needs.branch.outputs.branch }}', caller)
        self.assertIn('secrets: inherit', caller)
        self.assertIn('GITHUB_STEP_SUMMARY', fix)
        self.assertIn('Skip fix:', fix)
        self.assertLess(fix.index('current=$(timeout 60s gh pr view'), fix.index('python3 loop/builder.py fix-task'))
        self.assertLess(fix.index('if [ "$current" != "$HEAD" ]'), fix.index('python3 loop/builder.py fix-task'))
        self.assertIn('python3 "$RUNNER_TEMP/main/loop/builder.py" keep "$BRANCH"', fix)
        self.assertIn('run: python3 loop/builder.py fixed', fix)
        self.assertNotIn('builder.py fix-task', caller)

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
            gh = path / 'gh'
            gh.write_text('#!/bin/sh\nprintf "%s\\n" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n')
            gh.chmod(0o755)
            summary = path / 'summary'
            result = subprocess.run(['bash', '-eo', 'pipefail', '-c', script], text=True, capture_output=True,
                                    env={**os.environ, 'PATH': f'{path}:{os.environ["PATH"]}',
                                         'PR': '9', 'HEAD': 'a' * 40, 'BRANCH': 'build/U1', 'CAUSE': 'review',
                                         'RUNNER_TEMP': directory, 'GITHUB_STEP_SUMMARY': str(summary)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Observed head: `' + 'b' * 40 + '`', summary.read_text())
            self.assertIn('Skip fix: the build or another writer moved the head', summary.read_text())
            self.assertFalse((path / 'task.md').exists())

    def test_l82_main_gets_a_rules_result_a_fix_task_can_read(self):
        loop = (ROOT / '.github/workflows/loop.yml').read_text()
        self.assertIn('  push:\n    branches: [main]\n', loop)
        self.assertIn("      - if: github.event_name == 'pull_request'\n        run: loop/rules.sh ci-trailers", loop)
        task = (ROOT / '.github/workflows/fix-branch.yml').read_text().split('\n  task:\n', 1)[1].split('    outputs:', 1)[0]
        self.assertIn('      checks: read\n', task)

    def test_l82_a_cancelled_check_run_ends_its_gate_cancelled_not_failed(self):
        gate = (ROOT / '.github/workflows/check.yml').read_text().split('\n  check:\n', 1)[1].split('\n  summary:\n', 1)[0]
        self.assertIn('${{ !cancelled() && ', gate)
        self.assertIn("!(github.event_name == 'push' && needs.rust.result == 'cancelled')", gate)
        self.assertNotIn('always()', gate)

    def test_l82_each_main_push_ends_its_web_linux_and_rules_jobs(self):
        check = (ROOT / '.github/workflows/check.yml').read_text()
        self.assertIn("  group: check-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}\n", check)
        rust = check.split('\n  rust:\n', 1)[1].split('\n  web:\n', 1)[0]
        self.assertIn("group: check-rust-${{ github.ref == 'refs/heads/main' && 'main' || github.run_id }}", rust)
        for job in ('web', 'linux'):
            self.assertNotIn('concurrency:', check.split(f'\n  {job}:\n', 1)[1].split('\n\n', 1)[0])
        loop = (ROOT / '.github/workflows/loop.yml').read_text()
        self.assertIn("  group: loop-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}\n", loop)
        task = (ROOT / '.github/workflows/fix-branch.yml').read_text().split('\n  task:\n', 1)[1].split('    outputs:', 1)[0]
        self.assertIn('      actions: read\n', task)


class L101(unittest.TestCase):
    def test_l101_rules_runs_keeps_main_on_each_pr(self):
        loop = (ROOT / '.github/workflows/loop.yml').read_text()
        self.assertIn("      - if: github.event_name == 'pull_request'\n        run: loop/rules.sh keeps-main \"$PR\"\n"
                      '        env:\n          GH_TOKEN: ${{ github.token }}\n          PR: ${{ github.event.pull_request.number }}\n', loop)


class L102(unittest.TestCase):
    def test_l102_rules_runs_overturned_on_each_pr(self):
        loop = (ROOT / '.github/workflows/loop.yml').read_text()
        keeps = "      - if: github.event_name == 'pull_request'\n        run: loop/rules.sh keeps-main \"$PR\"\n"
        step = ("      - if: github.event_name == 'pull_request'\n        run: loop/rules.sh overturned \"$PR\"\n"
                '        env:\n          GH_TOKEN: ${{ github.token }}\n          PR: ${{ github.event.pull_request.number }}\n')
        self.assertIn(step, loop)
        self.assertLess(loop.index(keeps), loop.index(step))


class L105(unittest.TestCase):
    def test_l105_rules_runs_captures_on_each_pr(self):
        loop = (ROOT / '.github/workflows/loop.yml').read_text()
        overturned = "      - if: github.event_name == 'pull_request'\n        run: loop/rules.sh overturned \"$PR\"\n"
        step = ("      - if: github.event_name == 'pull_request'\n        run: loop/rules.sh captures \"$PR\"\n"
                '        env:\n          GH_TOKEN: ${{ github.token }}\n          PR: ${{ github.event.pull_request.number }}\n')
        self.assertIn(step, loop)
        self.assertLess(loop.index(overturned), loop.index(step))


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

    def test_l103_the_ruleset_requires_critic(self):
        gates = (ROOT / '.agents/data/gates.md').read_text()
        self.assertIn('`critic`', gates)
        self.assertIn('`review` and `critic` succeed', (ROOT / 'scenarios/loop-rules.md').read_text())
        self.assertIn('\n  post:\n', (ROOT / '.github/workflows/critic.yml').read_text())
        self.assertIn("f'context={context}'", (ROOT / 'loop/builder.py').read_text())


class L104(unittest.TestCase):
    def test_l104_activity_is_in_no_required_check(self):
        source = (ROOT / '.github/workflows/activity.yml').read_text()
        self.assertNotIn('schedule:', source)
        self.assertIn('types: [in_progress, completed]', source)
        self.assertIn('group: activity\n  cancel-in-progress: false', source)
        self.assertNotIn('pull_request_target:', source)
        self.assertIn('python3 loop/builder.py activity-watch', source)
        self.assertIn('ref: main', source)
        self.assertNotIn('claude-code-action', source)
        self.assertNotIn('activity', (ROOT / '.agents/data/gates.md').read_text())
        for path in ('.agents/builder.md', 'justfile'):
            self.assertNotIn('activity', (ROOT / path).read_text())
        self.assertNotIn("'activity'", ''.join(l for l in (ROOT / 'loop/builder.py').read_text().splitlines(True) if 'def ready' in l))


class L46(unittest.TestCase):
    def test_l46_a_workflow_job_posts_each_required_check(self):
        for workflow, job in (('check', 'check'), ('loop', 'rules'), ('critic', 'post')):
            self.assertIn(f'\n  {job}:\n', (ROOT / f'.github/workflows/{workflow}.yml').read_text(), workflow)
        self.assertIn("f'context={context}'", (ROOT / 'loop/builder.py').read_text())


class Retro(unittest.TestCase):
    def test_l106_live_observer_dispatch_uses_a_separate_write_job(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        job = source.split('\n  retro-observer:\n', 1)[1].split('\n  summary:', 1)[0]
        self.assertIn('actions: write', job)
        self.assertIn('issues: write', job)
        self.assertIn('persist-credentials: false', job)
        self.assertIn('ref: main', job)
        self.assertIn('cancel-in-progress: false', job)
        self.assertIn('loop/retro-observer.py', job)
        self.assertNotIn('APP_PRIVATE_KEY', job)
        self.assertNotIn('codex', job)
        self.assertNotIn('claude-code-action', job)
        self.assertNotIn('checks: write', job)
        builder = (ROOT / 'loop/builder.py').read_text()
        self.assertIn("'actions': 'read'", builder)

    def test_l106_collection_observer_precedes_failed_publication_observer(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        job = source.split('\n  retro-observer:\n', 1)[1].split('\n  summary:', 1)[0]
        self.assertIn("github.event.workflow_run.name == 'retro'", job)
        self.assertIn("github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'", job)
        self.assertLess(job.index('loop/retro-observer.py --collector'),
                        job.index('loop/retro-observer.py --repo'))
        permissions = job.split('permissions:\n', 1)[1].split('    steps:', 1)[0]
        self.assertEqual(permissions.strip(), 'actions: write\n      contents: read\n      issues: write')
        builder = (ROOT / '.github/workflows/build-issue.yml').read_text()
        build = builder.split('\n  build:\n', 1)[1].split('\n  after:', 1)[0]
        permissions = build.split('permissions:\n', 1)[1].split('    outputs:', 1)[0]
        self.assertEqual(permissions.strip(),
                         'contents: read\n      issues: read\n      pull-requests: read\n      id-token: write')

    def test_l106_publication_observer_runs_after_collection_failure(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        job = source.split('\n  retro-observer:\n', 1)[1].split('\n  branch-observer:', 1)[0]
        publication = job.split('loop/retro-observer.py --collector', 1)[1].split('loop/retro-observer.py --repo', 1)[0]
        self.assertIn("- if: ${{ !cancelled() && (github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success') }}", publication)

    def test_l106_daily_dispatch_uses_one_sonnet_run(self):
        source = (ROOT / '.github/workflows/retro.yml').read_text()
        self.assertEqual(source.count('uses: anthropics/claude-code-action@v1'), 1)
        self.assertEqual(source.count('cron:'), 1)
        self.assertIn('workflow_dispatch:', source)
        self.assertIn('--model claude-sonnet-5-5', source)
        self.assertIn('claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}', source)
        self.assertNotIn('fable', source.lower())
        self.assertLess(source.index('loop/retro.py --repo "$REPOSITORY" input'), source.index('id: claude'))

    def test_l106_retro_runs_are_serial(self):
        source = (ROOT / '.github/workflows/retro.yml').read_text()
        self.assertIn('group: retro\n  cancel-in-progress: false', source)

    def test_l106_retro_has_only_read_and_issue_write_authority(self):
        source = (ROOT / '.github/workflows/retro.yml').read_text()
        permissions = source.split('permissions:\n', 1)[1].split('\ndefaults:', 1)[0]
        self.assertEqual(permissions.strip(), 'contents: read\n  actions: read\n  pull-requests: read\n  issues: write')
        self.assertIn('persist-credentials: false', source)
        self.assertNotIn('APP_PRIVATE_KEY', source)

    def test_l106_prompt_loads_retro_and_limits_changes(self):
        source = (ROOT / '.agents/retro.md').read_text()
        self.assertIn('.agents/skills/retro/SKILL.md', source)
        self.assertIn('Never push', source)
        self.assertIn('edit `.agents/`, `loop/`, workflows or scenarios', source)
        self.assertIn('L79', source)
        self.assertIn('spends money or sets product direction', source)

    def test_l106_loop_table_names_retro(self):
        source = (ROOT / 'AGENTS.md').read_text()
        self.assertIn('Retro | `retro.yml` (L106)', source)


def load_tests(loader, tests, pattern):
    """L106: the existing loop CI entry also runs Retro's paginated GitHub fixture suite."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('retro_tests', ROOT / 'loop/retro.test.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec = importlib.util.spec_from_file_location('observer_tests', ROOT / 'loop/retro-observer.test.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec = importlib.util.spec_from_file_location('branch_observer_tests', ROOT / 'loop/branch-observer.test.py')
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


if __name__ == '__main__':
    unittest.main()
