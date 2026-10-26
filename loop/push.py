#!/usr/bin/env python3
"""L23: push a run's branch to GitHub without losing the run's work to a head that moved meanwhile."""
import os
import subprocess
import sys


def git(*args, env=None):
    return subprocess.run(['git', *args], text=True, capture_output=True, timeout=300, env=env)


def land(remote, branch, account):
    """Push `branch` to `remote`. When the remote head moved during the run (a non-fast-forward rejection), merge it
    into the run's head without a checkout (`git merge-tree`), as `account`, and push that merge once more: the history
    keeps its merges, so a rebase would rewrite it. The merge carries an `Author-Agent` trailer, which `rules` requires.
    A conflict, or any other failed push, raises SystemExit naming it."""
    ref = f'refs/heads/{branch}'

    def said(done):  # the remote URL carries the App token
        return done.stderr.replace(remote, '<remote>').strip()
    first = git('push', remote, f'{ref}:{ref}')
    if not first.returncode:
        return
    print(f'push: {said(first)}', file=sys.stderr)
    fetched = git('fetch', '--quiet', remote, ref)
    if fetched.returncode:
        sys.exit(f'push of {branch} failed and its head cannot be fetched: {said(fetched)}')
    theirs = git('rev-parse', 'FETCH_HEAD').stdout.strip()
    if git('merge-base', '--is-ancestor', theirs, ref).returncode == 0:
        sys.exit(f'push of {branch} failed although the remote head is behind it: {said(first)}')
    tree = git('merge-tree', '--write-tree', ref, theirs)
    if tree.returncode:
        sys.exit(f'{branch} moved on GitHub during the run and its commits conflict with the new head; '
                 f'the run\'s work stays in this checkout, not pushed:\n{tree.stdout.strip()}')
    name, email = account
    env = {**os.environ, 'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email,
           'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
    merged = git('commit-tree', tree.stdout.split()[0], '-p', ref, '-p', theirs, '-m',
                 f'Merge the head of {branch} that moved during the run', '-m',
                 f"Author-Agent: builder-{os.environ.get('GITHUB_RUN_ID', '0')}", env=env)
    if merged.returncode:
        sys.exit(f'merging {branch} failed: {merged.stderr.strip()}')
    second = git('push', remote, f'{merged.stdout.strip()}:{ref}')
    if second.returncode:
        sys.exit(f'push of {branch} failed after merging its moved head: {said(second)}')
    print(f'{branch} moved during the run; pushed its commits merged onto the new head')
