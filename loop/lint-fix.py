#!/usr/bin/env python3
"""L82: commit and push the safe lint fixes `just fix` made to the checkout of a failed `pre`, with no model run: onto
the Builder PR's branch, or for `main` onto `lint-fix/main-<sha>`, with a PR that merges once its checks pass.
`lint-fix.py <branch> <sha>` exits 0 when it pushed, 3 when it had nothing to push, 1 naming any failure."""
import os
import sys

import builder
import orders
import push

SUBJECT = 'Apply the safe lint fixes pre failed on'
MAIN_BRANCHES = 'lint-fix/main-'


def commit(branch):
    """Commit the tracked files `just fix` changed onto `branch`, created at HEAD, as the Claude App. False when it
    changed none, or when HEAD already is such a commit: fixes that did not hold go to a model, not round again."""
    if not builder.git('diff', '--quiet').returncode:
        return False
    if builder.git('log', '-1', '--format=%s').stdout.strip() == SUBJECT:
        print('HEAD already holds lint fixes pre still failed on; a model answers this failure', file=sys.stderr)
        return False
    for step in (('switch', '-q', '-C', branch),
                 ('commit', '-qam', SUBJECT, '-m', f"Author-Agent: lint-fix-{os.environ.get('GITHUB_RUN_ID', '0')}")):
        done = builder.git(*step)
        if done.returncode:
            sys.exit(f'git {step[0]} of the lint fixes failed: {done.stderr.strip()}')
    return True


def main(branch, sha):
    """`branch` is the failed PR's head branch, or `main` with the failed run's `sha`."""
    fixes_main = branch == 'main'
    if fixes_main and any(pr['headRefName'].startswith(MAIN_BRANCHES)
                          for pr in orders.gh('pr', 'list', '--state', 'open', '--json', 'headRefName')):
        print('an open lint-fix PR already repairs main', file=sys.stderr)
        return 3
    # `watch.yml` files this Issue once a lint-fix PR is stuck (L123); its Builder's commits run the same fixes.
    if fixes_main and any(issue['title'].startswith('Red main: pre ') for issue in orders.gh(
            'issue', 'list', '--state', 'open', '--search', '"Red main: pre" in:title', '--json', 'title')):
        print('an open Red main Issue already repairs main', file=sys.stderr)
        return 3
    # A push to a merged or closed PR's branch would bring the deleted branch back.
    if not fixes_main and not orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'):
        print(f'no open PR holds {branch}', file=sys.stderr)
        return 3
    target = f'{MAIN_BRANCHES}{sha[:7]}' if fixes_main else branch
    if not commit(target):
        return 3
    token = os.environ['GH_TOKEN'] = builder.app_token()
    try:
        push.land(f"https://x-access-token:{token}@github.com/{os.environ['GITHUB_REPOSITORY']}.git", target,
                  builder.CLAUDE_ACCOUNT)
        if fixes_main:
            run = (f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}"
                   f"/actions/runs/{os.environ['GITHUB_RUN_ID']}")
            print(builder.call('pr', 'create', '--base', 'main', '--head', target, '--title',
                               f'L82: the safe lint fixes main lacked at {sha[:7]}', '--body',
                               f'Refs #6011\nScenarios: L82\n\n`pre` failed on `main` at {sha}; the fix run {run} '
                               'committed what `just fix` changed, with no model run.'), end='')
            builder.call('pr', 'merge', target, '--auto', '--merge')
    finally:
        builder.call('api', '-X', 'DELETE', '/installation/token')
    return 0


if __name__ == '__main__':
    match sys.argv[1:]:
        case [branch, sha]:
            sys.exit(main(branch, sha))
        case _:
            sys.exit('usage: lint-fix.py <branch> <sha>')
