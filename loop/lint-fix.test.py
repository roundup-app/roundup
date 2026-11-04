#!/usr/bin/env python3
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import chdir
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'loop'))
spec = importlib.util.spec_from_file_location('lint_fix', ROOT / 'loop/lint-fix.py')
lint_fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint_fix)


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Commit(unittest.TestCase):
    def checkout(self, path):
        """A checkout of `main` holding one commit of `a.ts`, with no hooks."""
        git(path, 'init', '--quiet', '--initial-branch', 'main')
        for key, value in (('user.name', 't'), ('user.email', 't@t'), ('commit.gpgsign', 'false'),
                           ('core.hooksPath', '/dev/null')):
            git(path, 'config', key, value)
        Path(path, 'a.ts').write_text('unfixed\n')
        git(path, 'add', 'a.ts')
        git(path, 'commit', '--quiet', '-m', 'Seed')

    def test_l82_lint_fix_commits_what_just_fix_changed_onto_the_branch(self):
        with tempfile.TemporaryDirectory() as path, chdir(path), patch.dict(os.environ, {'GITHUB_RUN_ID': '7'}):
            self.checkout(path)
            Path(path, 'a.ts').write_text('fixed\n')
            self.assertTrue(lint_fix.commit('lint-fix/main-abc1234'))
            self.assertEqual(git(path, 'branch', '--show-current'), 'lint-fix/main-abc1234')
            self.assertEqual(git(path, 'show', 'HEAD:a.ts'), 'fixed')
            self.assertEqual(git(path, 'log', '-1', '--format=%s%n%(trailers:key=Author-Agent,valueonly)'),
                             f'{lint_fix.SUBJECT}\nlint-fix-7')
            self.assertEqual(git(path, 'status', '--porcelain'), '')

    def test_l82_lint_fix_leaves_a_checkout_just_fix_kept_to_the_model(self):
        with tempfile.TemporaryDirectory() as path, chdir(path):
            self.checkout(path)
            self.assertFalse(lint_fix.commit('build/issue-1'))
            self.assertEqual(git(path, 'log', '--format=%s'), 'Seed')
            self.assertEqual(git(path, 'branch', '--show-current'), 'main')

    def test_l82_lint_fix_never_commits_onto_its_own_fixes(self):
        with tempfile.TemporaryDirectory() as path, chdir(path):
            self.checkout(path)
            Path(path, 'a.ts').write_text('fixed\n')
            self.assertTrue(lint_fix.commit('build/issue-1'))
            Path(path, 'a.ts').write_text('unfixed\n')  # a fixer that undoes another's fix
            self.assertFalse(lint_fix.commit('build/issue-1'))
            self.assertEqual(git(path, 'rev-list', '--count', 'HEAD'), '2')

    def test_l82_lint_fix_refuses_a_change_no_fixer_rewrites(self):
        with tempfile.TemporaryDirectory() as path, chdir(path):
            self.checkout(path)
            Path(path, 'a.ts').write_text('fixed\n')
            Path(path, 'package.json').write_text('{}\n')
            git(path, 'add', 'package.json')
            git(path, 'commit', '--quiet', '-m', 'Manifest')
            Path(path, 'package.json').write_text('{"scripts": {}}\n')
            with self.assertRaises(SystemExit):
                lint_fix.commit('build/issue-1')
            self.assertEqual(git(path, 'log', '-1', '--format=%s'), 'Manifest')


if __name__ == '__main__':
    unittest.main()
