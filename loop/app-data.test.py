#!/usr/bin/env python3
"""N8: observe the guard through command exit and its failure rows."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / 'loop/app-data.py'


class Guard(unittest.TestCase):
    def run_guard(self, command, **env):
        return subprocess.run([sys.executable, str(GUARD), *command],
                              env={**os.environ, **env}, text=True, capture_output=True)

    def test_n8_guard_reports_writes_and_command_failure(self):
        for code in (0, 17):
            with self.subTest(code=code):
                result = self.run_guard(['python3', '-c',
                    'import os,pathlib,sys; '
                    'home=pathlib.Path(os.environ["HOME"]); '
                    'paths=[home/"Library/Application Support/dev.roundup.app", '
                    'home/".local/share/dev.roundup.app", '
                    'pathlib.Path(os.environ["XDG_DATA_HOME"])/"dev.roundup.app"]; '
                    '[p.mkdir(parents=True) for p in paths]; '
                    f'sys.exit({code})'])
                self.assertNotEqual(result.returncode, 0)
                rows = result.stdout.splitlines()
                self.assertEqual(sum(row.startswith('App data written: /') for row in rows), 3)
                self.assertEqual(f'Test command failed: {code}' in rows, code != 0)
                for row in rows:
                    if row.startswith('App data written: '):
                        self.assertFalse(Path(row.split(': ', 1)[1]).exists())

    def test_n8_guard_keeps_command_failure(self):
        result = self.run_guard(['bash', '-c', 'exit 23'])
        self.assertEqual(result.returncode, 23)
        self.assertEqual(result.stdout.strip(), 'Test command failed: 23')

    def test_n8_guard_owns_home_and_preserves_toolchains(self):
        with tempfile.TemporaryDirectory() as seeded:
            seed = Path(seeded) / '.local/share/dev.roundup.app/keep'
            seed.parent.mkdir(parents=True)
            seed.write_bytes(b'keep')
            env = {key: value for key, value in os.environ.items() if key != 'PYTHONUSERBASE'}
            user_site = Path(subprocess.run([sys.executable, '-c', 'import site; print(site.getusersitepackages())'],
                                            env={**env, 'HOME': seeded}, capture_output=True, text=True,
                                            check=True).stdout.strip())
            user_site.mkdir(parents=True)
            (user_site / 'n8_user_package.py').write_text('')
            result = subprocess.run([sys.executable, str(GUARD), sys.executable, '-c',
                'import os,pathlib; h=pathlib.Path(os.environ["HOME"]); '
                'assert h.is_absolute(); '
                'assert pathlib.Path(os.environ["XDG_DATA_HOME"]).is_relative_to(h.parent); '
                'assert os.environ["CARGO_HOME"]=="/explicit/cargo"; import n8_user_package; print(h)'],
                env={**env, 'HOME': seeded, 'CARGO_HOME': '/explicit/cargo'}, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(Path(result.stdout.strip()).exists())
            self.assertEqual(seed.read_bytes(), b'keep')

    def test_n8_guard_preserves_installed_browser_without_its_profile(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / '.cache/puppeteer/chrome/linux-123/chrome-linux64/chrome'
            executable.parent.mkdir(parents=True)
            executable.write_text('#!/bin/sh\nexit 0\n')
            executable.chmod(0o755)
            env = dict(os.environ)
            env.pop('AGENT_BROWSER_EXECUTABLE_PATH', None)
            result = subprocess.run([sys.executable, str(GUARD), 'python3', '-c',
                'import os,sys; assert os.environ["AGENT_BROWSER_EXECUTABLE_PATH"] == sys.argv[1]; '
                'assert os.environ["HOME"] != sys.argv[2]', str(executable.resolve()), folder],
                env={**env, 'HOME': folder}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(executable.is_file())

    def test_n8_guard_wraps_all_test_jobs(self):
        import re
        check = (ROOT / '.github/workflows/check.yml').read_text()
        for line in check.splitlines():
            if re.search(r'(?:just (?:check|capture|perf|test-)|cargo (?:test|nextest run)|pnpm (?:test|.*exec vitest)|loop/[^ ]*\.test\.(?:py|sh)|loop/qa-sweep\.sh)', line) and not line.lstrip().startswith('#'):
                self.assertIn('python3 loop/app-data.py ', line, line)
        self.assertIn('python3 loop/app-data.py bash loop/ci-ping.sh', check)
        self.assertNotIn('./target/debug/rupd &', check)
        # No blanket exemption for N1: path selection is currently a pure unit observer.
        self.assertNotIn('N1', check)

    def test_n8_guard_reports_real_daemon_writes(self):
        daemon = ROOT / 'target/debug/rupd'
        rup = ROOT / 'target/debug/rup'
        self.assertTrue(daemon.is_file(), 'Build rupd and rup before the real observer')
        with tempfile.TemporaryDirectory() as seed:
            keep = Path(seed) / 'dev.roundup.app/keep'
            keep.parent.mkdir()
            keep.write_bytes(b'keep')
            for isolated in (False, True, "nested", "nested-leak"):
                with self.subTest(isolated=isolated):
                    command = r"""
import os, pathlib, subprocess, sys, tempfile, time
with tempfile.TemporaryDirectory(dir=pathlib.Path(os.environ["HOME"]).parent) as project:
    env = dict(os.environ)
    env.pop('ROUNDUP_DATA_DIR', None)
    env['RUPD_SOCKET'] = project + '/rupd.sock'
    if sys.argv[3] == 'True':
        env['ROUNDUP_DATA_DIR'] = str(pathlib.Path(os.environ['HOME']).parent / 'owned-data')
    if sys.argv[3] in ('nested', 'nested-leak'):
        env['HOME'] = project + '/home'
        env['XDG_DATA_HOME'] = project + '/xdg'
        pathlib.Path(env['HOME']).mkdir()
        pathlib.Path(env['XDG_DATA_HOME']).mkdir()
    child = subprocess.Popen([sys.argv[1], project], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if pathlib.Path(env['RUPD_SOCKET']).exists():
                break
            assert child.poll() is None, child.stderr.read().decode()
            time.sleep(.05)
        subprocess.run([sys.argv[2], 'ping'], env=env, check=True, stdout=subprocess.DEVNULL)
    finally:
        child.terminate()
        child.wait(timeout=15)
if sys.argv[3] == 'nested-leak':
    (pathlib.Path(os.environ['HOME']) / '.local/share/dev.roundup.app').mkdir(parents=True)
"""
                    result = self.run_guard(['python3', '-c', command, str(daemon), str(rup), str(isolated)],
                                            ROUNDUP_DATA_DIR=seed)
                    leaks = isolated in (False, "nested-leak")
                    self.assertEqual(result.returncode, 1 if leaks else 0, result.stderr)
                    self.assertEqual('App data written: ' in result.stdout, leaks)
                    self.assertEqual(keep.read_bytes(), b'keep')
                    self.assertEqual(list(Path(seed).rglob('*')), [keep.parent, keep])

    def test_n8_guard_job_cleanup_rejects_unowned_folder(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            seed = Path(folder) / 'keep'
            seed.write_bytes(b'keep')
            state = Path(folder) / 'state'
            state.write_text(json.dumps({'root': folder, 'token': 'unowned'}))
            result = subprocess.run([sys.executable, str(GUARD), '--job-finish', str(state), 'success'],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(seed.read_bytes(), b'keep')

    def test_n8_guard_job_observer_preserves_failure(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / 'state.json'
            exported = Path(folder) / 'env'
            exported.touch()
            start = subprocess.run([sys.executable, str(GUARD), '--job-start', str(state)],
                                   env={**os.environ, 'GITHUB_ENV': str(exported)}, check=True)
            self.assertEqual(start.returncode, 0)
            root = Path(json.loads(state.read_text())['root'])
            (root / 'xdg/dev.roundup.app').mkdir()
            result = subprocess.run([sys.executable, str(GUARD), '--job-finish', str(state), 'failure'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('App data written: ', result.stdout)
            self.assertIn('Test command failed: 1', result.stdout)
            self.assertFalse(root.exists())
            self.assertFalse(state.exists())


class DraftCheckRekick(unittest.TestCase):
    def rekick(self):
        pre = (ROOT / '.github/workflows/pre.yml').read_text()
        return pre, pre.split('\n  rekick:\n', 1)[1].split('\n  # The name `review.yml`', 1)[0]

    def test_l24_a_draft_check_on_a_ready_head_asks_the_app_for_a_real_check(self):
        # #1931, #1933, #1998, #2023: the ready run tested the previous head and the newest head kept a `Draft check`,
        # which review and critic skip. Only an App's ready event starts the real check; `GITHUB_TOKEN` events start none.
        pre, rekick = self.rekick()
        self.assertIn('types: [opened, synchronize, reopened, ready_for_review]', pre)
        self.assertIn("if: github.event_name == 'pull_request' && github.event.pull_request.draft", rekick)
        self.assertEqual(pre.count('id-token: write'), 1)

    def test_l24_the_rekick_step_runs_every_gh_call_with_the_app_token(self):
        _, rekick = self.rekick()
        script = textwrap.dedent(rekick.rsplit('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'loop').mkdir()
            (root / 'loop/builder.py').write_text(
                'def app_token():\n    print("::add-mask::app-token")\n    return "app-token"\n')
            (root / 'bin').mkdir()
            gh = root / 'bin/gh'
            gh.write_text('#!/bin/bash\necho "${GH_TOKEN:-none}|$*" >>"$CALLS"\n'
                          '[ "$1 $2" != "pr view" ] || echo merge\n')
            gh.chmod(0o755)
            calls = root / 'calls'
            result = subprocess.run(['bash', '-eo', 'pipefail', '-c', script], cwd=root, text=True, capture_output=True,
                                    env={**os.environ, 'PATH': f'{root}/bin:{os.environ["PATH"]}', 'CALLS': str(calls),
                                         'PR': '7', 'GH_TOKEN': 'github-token'})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('::add-mask::app-token', result.stdout)
            rows = calls.read_text().splitlines()
            self.assertEqual(rows[0], 'github-token|pr view 7 --json autoMergeRequest --jq .autoMergeRequest.mergeMethod // empty')
            self.assertEqual([row.split('|')[1] for row in rows[1:]],
                             ['pr ready 7 --undo', 'pr ready 7', 'pr merge 7 --auto --merge',
                              'api -X DELETE /installation/token'])
            self.assertEqual({row.split('|')[0] for row in rows[1:]}, {'app-token'})


if __name__ == '__main__':
    unittest.main()
