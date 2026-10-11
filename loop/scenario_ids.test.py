#!/usr/bin/env python3
"""L97: each Builder push renumbers the scenario ids it adds that `main` or another branch already heads. Each test
pushes for real, through the hooks `author.sh` installs, to a throwaway bare origin whose `main` heads X1, with a fake
`gh` that answers from `self.github` (None fails every call) and records each call."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
FAKE_GH = """#!/usr/bin/env python3
import json, os, sys
with open(os.environ['GH_LOG'], 'a') as f:
    f.write(json.dumps(sys.argv[1:]) + '\\n')
github = json.loads(os.environ['GH_DATA'])
if github is None:
    sys.exit(1)
print(json.dumps(github['prs'] if sys.argv[1:3] == ['pr', 'list'] else {} if '-X' in sys.argv else github['issue']))
"""


def git(path, *args):
    return subprocess.run(['git', '-C', str(path), *args], text=True, capture_output=True, check=True).stdout.strip()


class L97(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ['rm', '-rf', str(self.tmp)])
        (self.tmp / 'bin').mkdir()
        (self.tmp / 'bin/gh').write_text(FAKE_GH)
        (self.tmp / 'bin/gh').chmod(0o755)
        self.github = dict(prs=[], issue={})
        git(self.tmp, 'init', '--quiet', '--bare', '--initial-branch=main', 'origin.git')
        seed = self.clone('seed')
        (seed / 'scenarios').mkdir()
        (seed / 'scenarios/a.md').write_text('**X1 one.** Tests: `x1_one`.\n')
        git(seed, 'add', '.')
        git(seed, 'commit', '--quiet', '-m', 'X1')
        # An origin with no main has no ids to read, so the hook stops this first push.
        git(seed, 'push', '--quiet', '--no-verify', 'origin', 'HEAD:main')

    def clone(self, name):
        path = self.tmp / name
        git(self.tmp, 'clone', '--quiet', str(self.tmp / 'origin.git'), name)
        git(path, 'config', 'user.name', 'test')
        git(path, 'config', 'user.email', 'test@test')
        subprocess.run(['bash', str(ROOT / 'loop/author.sh'), 'builder-test'], cwd=path,
                       env={**os.environ, 'RUNNER_TEMP': str(self.tmp)}, check=True)
        return path

    def branch(self, name, *scenarios):
        """A clone on `build/<name>` from main, adding `scenarios` to scenarios/a.md in one commit."""
        path = self.clone(name)
        git(path, 'checkout', '--quiet', '-b', f'build/{name}', 'origin/main')
        with open(path / 'scenarios/a.md', 'a') as f:
            f.writelines(f'\n{text}\n' for text in scenarios)
        git(path, 'commit', '--quiet', '-am', 'spec')
        return path

    def env(self):
        return {**os.environ, 'PATH': f"{self.tmp / 'bin'}:{os.environ['PATH']}", 'GH_LOG': str(self.tmp / 'gh.log'),
                'GH_DATA': json.dumps(self.github)}

    def gh_calls(self):
        log = self.tmp / 'gh.log'
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def push(self, path, ref=None):
        ref = ref or git(path, 'branch', '--show-current')
        return subprocess.run(['git', '-C', str(path), 'push', '--quiet', 'origin', ref], text=True, capture_output=True,
                              env=self.env())

    def scenarios(self, ref):
        return git(self.tmp / 'origin.git', 'show', f'{ref}:scenarios/a.md')

    def test_l97_a_second_branch_adding_the_same_new_id_is_renumbered(self):
        first = self.branch('first', '**X2 first.** Tests: `x2_first`.')
        self.assertEqual(self.push(first).returncode, 0)
        second = self.branch('second', '**X2 second.** Tests: `x2_second`; X2 holds after X1.')
        pushed = self.push(second)
        self.assertEqual(pushed.returncode, 1)
        self.assertIn('renumbered X2 to X3', pushed.stderr)
        self.assertEqual(git(second, 'log', '-1', '--format=%s%n%(trailers:key=Author-Agent,valueonly)'),
                         'Renumber X2 to X3: main or another branch already heads them (L97)\nbuilder-test')
        self.assertEqual(self.push(second).returncode, 0)
        self.assertEqual(self.scenarios('build/second'),
                         '**X1 one.** Tests: `x1_one`.\n\n**X3 second.** Tests: `x3_second`; X3 holds after X1.')
        self.assertIn('**X2 first.**', self.scenarios('build/first'))
        self.assertEqual([call[:2] for call in self.gh_calls()], [['pr', 'list']])

    def test_l97_a_renumber_edits_the_open_pr_and_its_issue(self):
        self.assertEqual(self.push(self.branch('first', '**X2 first.**')).returncode, 0)
        second = self.branch('second', '**X2 second.**')
        self.github = dict(prs=[dict(number=5, title='X2: second', body='Refs #3\n\nScenarios: X2, X1\n\nAdds X2.')],
                           issue=dict(body='Key: second\nScenarios: X2\n'))
        self.assertIn('renumbered X2 to X3 in a new commit', self.push(second).stderr)
        edits = [call for call in self.gh_calls() if '-X' in call]
        self.assertEqual(edits, [
            ['api', '-X', 'PATCH', 'repos/{owner}/{repo}/pulls/5', '-f', 'title=X3: second', '-f',
             'body=Refs #3\n\nScenarios: X3, X1\n\nAdds X2.'],
            ['api', '-X', 'PATCH', 'repos/{owner}/{repo}/issues/3', '-f', 'body=Key: second\nScenarios: X3\n']])

    def test_l97_a_gh_failure_after_the_renumber_exits_4(self):
        self.assertEqual(self.push(self.branch('first', '**X2 first.**')).returncode, 0)
        second = self.branch('second', '**X2 second.**')
        self.github = None
        line = f'refs/heads/build/second {git(second, "rev-parse", "HEAD")} refs/heads/build/second {"0" * 40}\n'
        minted = subprocess.run(['python3', str(ROOT / 'loop/scenario_ids.py'), 'mint', 'origin'], cwd=second,
                                input=line, text=True, capture_output=True, env=self.env())
        self.assertEqual(minted.returncode, 4, minted.stderr)
        self.assertIn('could not edit the PR or its Issue', minted.stderr)
        self.assertIn('**X3 second.**', (second / 'scenarios/a.md').read_text())

    def test_l97_a_new_id_no_branch_holds_stays(self):
        self.assertEqual(self.push(self.branch('first', '**X2 first.**')).returncode, 0)
        second = self.branch('second', '**X3 second.**')
        head = git(second, 'rev-parse', 'HEAD')
        self.assertEqual(self.push(second).returncode, 0)
        self.assertEqual(git(second, 'rev-parse', 'HEAD'), head)
        self.assertEqual(git(self.tmp / 'origin.git', 'rev-parse', 'build/second'), head)

    def test_l97_an_id_main_took_after_the_branch_started_is_renumbered(self):
        late = self.branch('late', '**X2 late.**')
        merged = self.branch('merged', '**X2 merged.**')
        self.assertEqual(self.push(merged, 'HEAD:main').returncode, 0)
        self.assertEqual(self.push(late).returncode, 1)
        self.assertIn('**X3 late.**', (late / 'scenarios/a.md').read_text())

    def test_l97_an_amended_heading_keeps_its_id(self):
        amend = self.clone('amend')
        git(amend, 'checkout', '--quiet', '-b', 'build/amend')
        (amend / 'scenarios/a.md').write_text('**X1 one, amended.** Tests: `x1_one`.\n')
        git(amend, 'commit', '--quiet', '-am', 'amend X1')
        head = git(amend, 'rev-parse', 'HEAD')
        self.assertEqual(self.push(amend).returncode, 0)
        self.assertEqual(git(amend, 'rev-parse', 'HEAD'), head)

    def test_l97_the_branch_s_own_earlier_push_is_no_collision(self):
        own = self.branch('own', '**X2 own.**')
        self.assertEqual(self.push(own).returncode, 0)
        (own / 'notes.md').write_text('X2 notes\n')
        git(own, 'add', '.')
        git(own, 'commit', '--quiet', '-m', 'notes')
        self.assertEqual(self.push(own).returncode, 0)
        self.assertIn('**X2 own.**', self.scenarios('build/own'))

    def test_l97_two_taken_ids_take_two_free_ids(self):
        self.assertEqual(self.push(self.branch('first', '**X2 a.**', '**X3 b.**')).returncode, 0)
        second = self.branch('second', '**X2 c.**', '**X3 d.**')
        self.assertIn('renumbered X2 to X4, X3 to X5', self.push(second).stderr)
        self.assertIn('**X4 c.**\n\n**X5 d.**', (second / 'scenarios/a.md').read_text())

    def test_l97_a_remote_it_cannot_read_stops_the_push(self):
        path = self.branch('lost', '**X2 lost.**')
        line = f'refs/heads/build/lost {git(path, "rev-parse", "HEAD")} refs/heads/build/lost {"0" * 40}\n'
        minted = subprocess.run(['python3', str(ROOT / 'loop/scenario_ids.py'), 'mint', str(self.tmp / 'missing.git')],
                                cwd=path, input=line, text=True, capture_output=True)
        self.assertEqual(minted.returncode, 4, minted.stderr)


if __name__ == '__main__':
    unittest.main()
