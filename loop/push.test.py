#!/usr/bin/env python3
import importlib.util
import subprocess
import tempfile
import unittest
from contextlib import chdir
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('push', ROOT / 'loop/push.py')
push = importlib.util.module_from_spec(spec)
spec.loader.exec_module(push)

ACCOUNT = ('claude[bot]', 'claude@test')


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Land(unittest.TestCase):
    def moved_head(self, path, file):
        """A bare `github.git` whose `fix` branch another clone advanced by committing `file` after this run's checkout
        started; the run's own clone `work` holds one commit of `run.txt` on top of the old head."""
        bare = f'{path}/github.git'
        git(path, 'init', '--quiet', '--bare', bare)
        for name in ('work', 'other'):
            git(path, 'clone', '--quiet', bare, f'{path}/{name}')
            for key, value in (('user.name', 't'), ('user.email', 't@t'), ('commit.gpgsign', 'false')):
                git(f'{path}/{name}', 'config', key, value)
        work, other = f'{path}/work', f'{path}/other'
        git(work, 'switch', '-q', '-c', 'fix')
        (Path(work) / 'shared.txt').write_text('base\n')
        git(work, 'add', '.')
        git(work, 'commit', '-qm', 'base')
        git(work, 'push', '-q', 'origin', 'fix')
        git(other, 'fetch', '-q', 'origin')
        git(other, 'switch', '-q', '-c', 'fix', 'origin/fix')
        (Path(other) / file).write_text('theirs\n')
        git(other, 'add', '.')
        git(other, 'commit', '-qm', 'moved head')
        git(other, 'push', '-q', 'origin', 'fix')
        (Path(work) / 'run.txt').write_text('mine\n')
        (Path(work) / 'shared.txt').write_text('mine\n')
        git(work, 'add', '.')
        git(work, 'commit', '-qm', 'the run')
        return bare, work

    def test_l23_a_push_rejected_because_the_head_moved_is_merged_and_pushed_again(self):
        with tempfile.TemporaryDirectory() as path:
            bare, work = self.moved_head(path, 'theirs.txt')
            with chdir(work):
                push.land(bare, 'fix', ACCOUNT)
            self.assertEqual(git(bare, 'ls-tree', '--name-only', 'fix').split(), ['run.txt', 'shared.txt', 'theirs.txt'])
            self.assertEqual(git(bare, 'log', '-1', '--format=%an %P', 'fix').count(' '), 2)

    def test_l23_a_moved_head_that_conflicts_fails_loudly_and_pushes_nothing(self):
        with tempfile.TemporaryDirectory() as path:
            bare, work = self.moved_head(path, 'shared.txt')
            before = git(bare, 'rev-parse', 'fix')
            with chdir(work), self.assertRaises(SystemExit) as stopped:
                push.land(bare, 'fix', ACCOUNT)
            self.assertIn('conflict', str(stopped.exception))
            self.assertEqual(git(bare, 'rev-parse', 'fix'), before)


if __name__ == '__main__':
    unittest.main()
