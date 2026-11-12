#!/usr/bin/env python3
"""L82, L120: merge `main` into a Builder branch, or restore what a merge lost, with no model run."""
import os
import subprocess
import sys
from pathlib import Path

from builder import git

ROOT = Path(__file__).resolve().parent.parent
# L82: the paths a fix run's script regenerates instead of a model resolving them, and the command that regenerates them
# (`crates/contracts` writes `contracts/generated/`).
GENERATED = ('contracts/generated/',)
REGENERATE = ('cargo', 'test', '--quiet', '-p', 'contracts')


def merge_main(regenerate=REGENERATE):
    """L82: merge `origin/main` into the checked-out branch and commit it when git merged it cleanly or every conflicted
    path is GENERATED: take main's side, run `regenerate`, and require no conflict marker and no change from a second run.
    The merge then passes `rules.sh merge-loss`, restoring the files it lists (`restore_merge_loss`) when it does not.
    Returns whether it committed; any other conflict, a failed `regenerate`, a merge that keeps losing work or a changed second
    run leaves the branch as it was."""
    start = git('rev-parse', 'HEAD').stdout.strip()

    def undo(why):
        print(f'merge-main: {why}; the branch is left as it was', file=sys.stderr)
        # `merge --abort` refuses a file the index and the worktree hold differently, so the reset comes first.
        git('reset', '-q', '--hard', start)
        git('merge', '--abort')
        git('clean', '-fdq', '--', *GENERATED)
        return False

    merge = git('merge', '--no-commit', '--no-ff', 'origin/main')
    conflicted = git('diff', '--name-only', '--diff-filter=U').stdout.split()
    if merge.returncode and not conflicted:
        return undo(f'the merge failed: {merge.stderr.strip()}')
    if other := [path for path in conflicted if not path.startswith(GENERATED)]:
        return undo(f'{", ".join(other)} conflict and are not generated')
    for path in conflicted:
        if git('cat-file', '-e', f'origin/main:{path}').returncode:
            git('rm', '-q', '-f', '--', path)
        else:
            git('checkout', 'origin/main', '--', path)
    if conflicted:
        if subprocess.run(regenerate, timeout=3600).returncode:
            return undo('the regenerate command failed')
        git('add', '-A', '--', *GENERATED)
        # The second run must leave the worktree as the index holds it: no change, and no file the first run left unstaged.
        if subprocess.run(regenerate, timeout=3600).returncode:
            return undo('the second regenerate failed')
        if changed := git('status', '--porcelain', '--untracked-files=all').stdout:
            unstaged = [line for line in changed.splitlines() if line[1] != ' ']
            if unstaged:
                return undo(f'the regenerate left changes: {unstaged}')
        if git('grep', '--cached', '-lE', r'^(<{7}|>{7})( |$)', '--', *GENERATED).stdout:
            return undo('a conflict marker remains')
    if git('rev-parse', '-q', '--verify', 'MERGE_HEAD').returncode:
        return True  # the branch already holds main
    commit = git('commit', '--no-edit')
    if commit.returncode:
        return undo(f'the commit failed: {commit.stderr.strip()} {commit.stdout.strip()}')
    loss = subprocess.run(['bash', str(ROOT / 'loop/rules.sh'), 'merge-loss', 'origin/main'], text=True, capture_output=True, timeout=600)
    return not loss.returncode or restore_merge_loss() or undo(f'merge-loss fails: {loss.stderr.strip()}')


def restore_merge_loss(main_ref='origin/main', rules=None):
    """L120: when `rules.sh merge-loss` fails on the checked-out branch, restore the merge base's version of each file it
    lists (removing one the base lacks), commit that, and rerun it. Returns whether it then passes; a rerun that still fails
    resets the branch to where it began, so the engine runs as for any fix."""
    rules = rules or ROOT / 'loop/rules.sh'

    def check():
        return subprocess.run(['bash', str(rules), 'merge-loss', main_ref], text=True, capture_output=True, timeout=600)

    start = git('rev-parse', 'HEAD').stdout.strip()
    first = check()
    lost = [line.strip() for line in first.stderr.splitlines() if line.startswith('  ')]
    if not first.returncode or not lost:
        print(f'restore-merge-loss: no file to restore: {first.stderr.strip()}', file=sys.stderr)
        return False
    base = git('merge-base', main_ref, 'HEAD').stdout.strip()
    for path in lost:
        if git('cat-file', '-e', f'{base}:{path}').returncode:
            git('rm', '-q', '-f', '--', path)
        else:
            git('checkout', base, '--', path)
    author = os.environ.get('GITHUB_RUN_ID', '0')
    commit = git('commit', '-q', '-m', f"Restore main's version of {len(lost)} file(s) a merge lost",
                 '-m', f'Author-Agent: builder-{author}')
    after = commit if commit.returncode else check()
    if after.returncode:
        print(f'restore-merge-loss: {after.stderr.strip()}; the branch is left as it was', file=sys.stderr)
        git('reset', '-q', '--hard', start)
    return not after.returncode


def main(args):
    match args:
        case ['merge']:
            return 0 if merge_main() else 1
        case ['restore']:
            return 0 if restore_merge_loss() else 1
    print('usage: merge_main.py merge | restore', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
