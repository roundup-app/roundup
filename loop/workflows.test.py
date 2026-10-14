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
                self.assertIn('group: codex-login-completion', observer)
                self.assertIn('cancel-in-progress: false', observer)
                self.assertIn('queue: max', observer)
                self.assertIn('always()', observer)
                self.assertIn('ref: main', observer)
                self.assertIn('persist-credentials: false', observer)
                observe = observer.split('- name: Observe masked Codex completion', 1)[1]
                self.assertIn('if: always()', observe)
                self.assertIn('python3 loop/builder.py codex-login', observe)
                for forbidden in ("ran == 'true'", 'CODEX_AUTH', 'execution_file',
                                  'actions: write', 'contents: write', 'pull-requests: write', 'statuses: write'):
                    self.assertNotIn(forbidden, observer)
                after = source.split('\n  after:\n', 1)[1].split('\n  codex-completion:', 1)[0]
                self.assertNotIn('codex-completion', after)
                if name == 'build-issue':
                    self.assertIn("if: always() && env.RAN == 'true'", after)
                    self.assertIn('python3 loop/builder.py built', after)
                else:
                    self.assertIn('python3 loop/builder.py fixed', after)


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
    def test_l107_care_completion_does_not_trigger_build(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        triggers = source.split('  workflow_run:', 1)[1].split('  schedule:', 1)[0]
        self.assertIn('workflows: [check]', triggers)

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
        self.assertIn('only the script publishes', (ROOT / '.agents/care.md').read_text())
        self.assertIn('loop/care.test.py', source)
        self.assertIn('loop/retro.test.py', source)

    def test_l107_loop_table_names_care(self):
        source = (ROOT / 'AGENTS.md').read_text()
        self.assertIn('care.yml', source)
        self.assertIn('L107', source)
        self.assertIn('Work Issues', next(line for line in source.splitlines() if 'care.yml' in line))


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
    def test_l23_new_work_issues_start_a_pick_without_an_intake_label(self):
        source = (ROOT / '.github/workflows/build.yml').read_text()
        self.assertIn('types: [opened, reopened, unlabeled]', source)
        pick = source.split('  pick:', 1)[1].split('    runs-on:', 1)[0]
        for text in ('\'["flag:needs-user", "flag:needs-mac"]\'), github.event.label.name', '["saadshahd", "claude[bot]", "github-actions[bot]"]'):
            self.assertIn(text, pick)
        for text in ('loop:work', 'COLLABORATOR', 'author_association'):
            self.assertNotIn(text, pick)
        self.assertNotIn('ready-for-agent', source)

    def test_l23_one_variable_sets_the_codex_slots_of_builds_and_fixes(self):
        build = (ROOT / '.github/workflows/build.yml').read_text()
        self.assertIn('CODEX_RUNS: ${{ vars.CODEX_RUNS }}', build)
        self.assertIn('builder.py pick "$CODEX_RUNS"', build)
        self.assertNotIn('inputs.max', build)
        branch = (ROOT / '.github/workflows/fix.yml').read_text().split('  branch:', 1)[1].split('\n  fix:', 1)[0]
        self.assertIn('CODEX_RUNS: ${{ vars.CODEX_RUNS }}', branch)
        self.assertIn('builder.py fix-admit', branch)

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

    def test_l89_the_mac_lane_raises_the_pty_ceiling_before_rust_tests(self):
        rust = (ROOT / '.github/workflows/check.yml').read_text().split('\n  rust:\n', 1)[1].split('\n  web:\n', 1)[0]
        ceiling = rust.index('sudo sysctl -w kern.tty.ptmx_max=999')
        self.assertIn('test "$(sysctl -n kern.tty.ptmx_max)" -ge 999', rust[ceiling:])
        self.assertLess(ceiling, rust.index('run: just check-rust'))


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
        self.assertNotEqual(evaluate(False, 2, 'refs/heads/main', 'old'),
                            evaluate(False, 3, 'refs/heads/main', 'new'))
        self.assertIn('cancel-in-progress: true', source.split('jobs:', 1)[0])

    def test_l24_draft_check_identifies_the_event_before_readiness(self):
        source = (ROOT / '.github/workflows/check.yml').read_text()
        self.assertIn("run-name: ${{ github.event_name == 'pull_request' && github.event.pull_request.draft && 'Draft check'", source)

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
        self.assertIn('cat "$RUNNER_TEMP/refusal.md" >>"$GITHUB_STEP_SUMMARY"', fix)
        self.assertLess(fix.index('concurrency:'), fix.index('python3 loop/builder.py fix-task'))
        self.assertNotIn('gh pr view', fix.split('\n  fix-run:', 1)[0])
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

    def test_l82_workflow_retry_reenters_task_on_the_same_run(self):
        source = (ROOT / '.github/workflows/fix.yml').read_text()
        branch = (ROOT / '.github/workflows/fix-branch.yml').read_text()
        self.assertIn('# L82 retry-contract: 1', source)
        self.assertIn('builder.py fix-admit', source)
        self.assertIn('needs: branch', source)
        self.assertIn('builder.py fix-task', branch)
        self.assertIn('cat "$RUNNER_TEMP/refusal.md" >>"$GITHUB_STEP_SUMMARY"', branch)
        self.assertIn('needs: task', branch)
        self.assertIn("if: needs.task.outputs.pr != ''", branch)
        self.assertIn('run: python3 loop/builder.py fixed', branch)

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
        loop = (ROOT / '.github/workflows/loop.yml').read_text()
        self.assertIn('loop/rules.sh', loop)
        self.assertIn('review', (ROOT / '.agents/data/gates.md').read_text())
        self.assertIn('critic', (ROOT / '.agents/data/gates.md').read_text())

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
        self.assertIn("group: check-${{ github.ref == 'refs/heads/main' && github.sha ||", check)
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
        step = ("      - if: github.event_name == 'pull_request'\n        run: |\n"
                '          capture_gate=$(mktemp loop/.capture-rules.XXXXXX)\n'
                '          trap \'rm -f "$capture_gate"\' EXIT\n'
                '          git show origin/main:loop/rules.sh >"$capture_gate"\n'
                '          bash "$capture_gate" captures "$PR"\n'
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
    def test_l106_no_build_event_dispatches_a_collector(self):
        # Every Retro or Care collection spends the read budget pick, review, critic and fix share (#1644); only their
        # own daily schedule and the user's dispatch start one.
        for path in [*(ROOT / '.github/workflows').glob('*.yml'), *(ROOT / 'loop').glob('*.py')]:
            if path.name.endswith('.test.py'):
                continue
            source = path.read_text()
            for collector in ('retro.yml', 'care.yml'):
                self.assertNotRegex(source, rf'{collector}/dispatches|workflow run {collector}', path.name)
        self.assertNotIn('retro', (ROOT / '.github/workflows/build.yml').read_text())

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


class L112(unittest.TestCase):
    def test_l112_publication_has_no_gate_authority(self):
        for name in ('build-issue', 'fix-branch'):
            source = (ROOT / f'.github/workflows/{name}.yml').read_text()
            publication = source.split('      # L112:', 1)[1].split('      - id: worked' if name == 'build-issue' else '      - id: ran', 1)[0]
            self.assertIn('uses: actions/upload-artifact@v4', publication)
            self.assertIn('retention-days: 14', publication)
            self.assertIn('if-no-files-found: error', publication)
            self.assertIn("steps.capture-upload.outputs.artifact-url", publication)
            self.assertIn("capture-run publish", publication)

            for forbidden in ('review-post', 'critic-post', '/statuses/', 'checks: write', 'actions: write', '--admin'):
                self.assertNotIn(forbidden, publication)
        boundary = (ROOT / 'loop/rules.sh').read_text().split('capture_run() {', 1)[1].split('\ncase ', 1)[0]
        self.assertIn('builder.owner_closed(*builder.related(current))', boundary)
        self.assertIn('builder.ready(pr)', boundary)
        self.assertIn('builder.RUN_RIGHTS', boundary)
        for forbidden in ('review-post', 'critic-post', '/statuses/', '--admin'):
            self.assertNotIn(forbidden, boundary)
        source = (ROOT / '.github/workflows/loop.yml').read_text()
        self.assertIn('git show origin/main:loop/rules.sh', source)
        gates = (ROOT / '.agents/data/gates.md').read_text()
        for gate in ('`check`', '`rules`', '`review`', '`critic`'):
            self.assertIn(gate, gates)

    def test_l112_publication_and_reference_fixtures(self):
        result = subprocess.run(['bash', str(ROOT / 'loop/captures.test.sh')],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
