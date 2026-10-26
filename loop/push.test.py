#!/usr/bin/env python3
import importlib.util
import subprocess
import tempfile
import unittest
from contextlib import chdir
from pathlib import Path
from unittest.mock import patch

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
            self.assertIn('Author-Agent: builder-', git(bare, 'log', '-1', '--format=%B', 'fix'))

    def test_l23_a_moved_head_that_conflicts_fails_loudly_and_pushes_nothing(self):
        with tempfile.TemporaryDirectory() as path:
            bare, work = self.moved_head(path, 'shared.txt')
            before = git(bare, 'rev-parse', 'fix')
            with chdir(work), self.assertRaises(SystemExit) as stopped:
                push.land(bare, 'fix', ACCOUNT)
            self.assertIn('conflict', str(stopped.exception))
            self.assertEqual(git(bare, 'rev-parse', 'fix'), before)


class Save(unittest.TestCase):
    def test_l23_work_a_killed_run_left_uncommitted_is_committed_but_not_its_captures_or_ignored_files(self):
        with tempfile.TemporaryDirectory() as path:
            _, work = Land().moved_head(path, 'theirs.txt')
            (Path(work) / '.gitignore').write_text('ignored.log\n')
            (Path(work) / 'ignored.log').write_text('x\n')
            (Path(work) / 'run.txt').write_text('edited\n')
            (Path(work) / 'artifacts/ux/U1').mkdir(parents=True)
            (Path(work) / 'artifacts/ux/U1/a.png').write_text('capture')
            with chdir(work), patch.dict('os.environ', GITHUB_RUN_ID='77'):
                push.save('fix', ACCOUNT)
                push.save('fix', ACCOUNT)  # nothing left to save
            self.assertEqual(git(work, 'log', '--format=%an|%s', '-2').split('\n'),
                             ['claude[bot]|Save the work the run ended with uncommitted', 't|the run'])
            self.assertEqual(git(work, 'show', '--name-only', '--format=', 'HEAD').split(), ['.gitignore', 'run.txt'])
            self.assertTrue(git(work, 'log', '-1', '--format=%B').endswith('\n\nAuthor-Agent: builder-77'))
            self.assertEqual(git(work, 'status', '--porcelain', '--ignored', '--', '.', ':!artifacts/ux').split(), ['!!', 'ignored.log'])


if __name__ == '__main__':
    unittest.main()
