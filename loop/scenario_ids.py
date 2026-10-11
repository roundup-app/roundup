#!/usr/bin/env python3
"""L97: scenario ids. `check` passes when no id heads two lines of `scenarios/*.md`. `mint <remote>`, the Builder's
pre-push hook (`author.sh`), renumbers each id the pushed branch adds that `main` or another branch of <remote> already
heads, in a new commit and in the branch's open PR and its Issue. Exit 1: a repeated id, or ids renumbered (push again);
2: bad usage; 4: git or gh failed."""
import collections
import glob
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).parent))
import orders  # noqa: E402

HEADING = re.compile(r'\*\*(([A-Za-z]+)([0-9]+)([a-z]?)) ')
SCENARIOS = ':(glob)scenarios/*.md'
SCAN = 'refs/scenario-ids/'


def git(*args):
    return subprocess.run(['git', *args], check=True, text=True, stdout=subprocess.PIPE, timeout=120).stdout


def check():
    if not os.path.isdir('scenarios'):
        print('scenario-ids: no scenarios/ here', file=sys.stderr)
        return 2
    seen = collections.defaultdict(list)
    for path in sorted(glob.glob('scenarios/*.md')):
        with open(path, encoding='utf-8') as f:
            for n, line in enumerate(f, 1):
                if m := HEADING.match(line):
                    seen[m.group(1)].append(f'{path}:{n}')
    repeated = {id_: at for id_, at in seen.items() if len(at) > 1}
    for id_, at in repeated.items():
        print(f'{id_} {" ".join(at)}')
    return 1 if repeated else 0


def headings(*revs):
    """Each id that heads a line of `scenarios/*.md` in `revs`, counted once per line."""
    found = subprocess.run(['git', 'grep', '-h', '-E', r'^\*\*[A-Za-z]', *revs, '--', SCENARIOS], text=True,
                           stdout=subprocess.PIPE, timeout=120)
    if found.returncode > 1:
        raise subprocess.CalledProcessError(found.returncode, 'git grep')
    return collections.Counter(m.group(1) for line in found.stdout.splitlines() if (m := HEADING.match(line)))


def next_free(id_, used):
    """The next number of `id_`'s prefix above every used one; a lettered id takes its number's next free letter."""
    _, prefix, number, letter = HEADING.match(f'**{id_} ').groups()
    if letter:
        return next(f'{prefix}{number}{c}' for c in 'bcdefghijklmnopqrstuvwxyz' if f'{prefix}{number}{c}' not in used)
    top = max(int(m.group(3)) for m in (HEADING.match(f'**{u} ') for u in used) if m.group(2) == prefix)
    return f'{prefix}{top + 1}'


def moves(sha, base, taken):
    """{old: new} for each id `sha` adds (heads more often than `base` does) that `taken` holds."""
    now, before = headings(sha), headings(base)
    used = taken | set(now)
    out = {}
    for id_ in sorted(id_ for id_ in now if now[id_] > before[id_] and id_ in taken):
        out[id_] = next_free(id_, used)
        used.add(out[id_])
    return out


def added_lines(base, sha):
    """{path: set of line numbers} that `sha` adds over `base`."""
    out, path, header = collections.defaultdict(set), None, False
    for line in git('-c', 'core.quotePath=false', 'diff', '--unified=0', '--no-color', '--no-ext-diff', base,
                    sha).splitlines():
        if line.startswith('diff --git '):
            header = True
        elif header and line.startswith('+++ '):
            path = line[6:] if line.startswith('+++ b/') else None
        elif line.startswith('@@ '):
            header = False
            if not path:
                continue
            start, _, count = re.match(r'@@ -\S+ \+(\d+)(,(\d+))? @@', line).groups()
            out[path].update(range(int(start), int(start) + int(count or 1)))
    return out


def renumber(text, plan):
    """`text` with each old id of `plan` replaced, and each `<old id>_` test name prefix in lowercase."""
    upper = re.compile(r'\b(%s)\b' % '|'.join(map(re.escape, plan)))
    lower = {old.lower(): new.lower() for old, new in plan.items()}
    tests = re.compile(r'\b(%s)_' % '|'.join(map(re.escape, lower)))
    return tests.sub(lambda m: lower[m.group(1)] + '_', upper.sub(lambda m: plan[m.group(1)], text))


def scenarios_lines(body, plan):
    return re.sub(r'^Scenarios:.*$', lambda m: renumber(m[0], plan), body or '', flags=re.M)


def renumber_pr_and_issue(branch, plan):
    """Renumbers `plan`'s ids in the title and `Scenarios:` line of `branch`'s open same-repository PR, and in the
    `Scenarios:` line of each open work Issue whose Key is `branch` after `build/`, writing only a body `orders.py
    check` accepts; yields each one after it is edited."""
    prs = orders.gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,title,body,isCrossRepository')
    for pr in prs:
        if not pr['isCrossRepository']:
            orders.gh('api', '-X', 'PATCH', f"repos/{{owner}}/{{repo}}/pulls/{pr['number']}",
                      '-f', f"title={renumber(pr['title'], plan)}", '-f', f"body={scenarios_lines(pr['body'], plan)}")
            yield f"PR #{pr['number']}"
    key = re.compile(r'^Key: %s\s*$' % re.escape(branch.removeprefix('build/')), re.M)
    pages = orders.gh('api', 'repos/{owner}/{repo}/issues?state=open&per_page=100', '--paginate', '--slurp')
    for issue in (issue for page in pages for issue in page if 'pull_request' not in issue):
        body = issue['body'] or ''
        if key.search(body) and scenarios_lines(body, plan) != body:
            orders.check(scenarios_lines(body, plan))
            orders.gh('api', '-X', 'PATCH', f"repos/{{owner}}/{{repo}}/issues/{issue['number']}",
                      '-f', f'body={scenarios_lines(body, plan)}')
            yield f"Issue #{issue['number']}"


def rewrite(base, plan, message):
    """Renumbers `plan`'s ids on the lines HEAD adds over `base` and commits; False when no line changed."""
    changed = False
    for path, numbers in added_lines(base, 'HEAD').items():
        with open(path, encoding='utf-8', newline='') as f:
            lines = f.read().split('\n')
        for n in numbers:
            new = renumber(lines[n - 1], plan)
            changed |= new != lines[n - 1]
            lines[n - 1] = new
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write('\n'.join(lines))
    if changed:
        git('commit', '--quiet', '--all', '--message', message)
    return changed


def mint(remote, pushes):
    """Pre-push: `pushes` holds git's `<local ref> <local sha> <remote ref> <remote sha>` lines."""
    git('fetch', '--quiet', '--prune', '--no-tags', remote, f'+refs/heads/*:{SCAN}*')
    main = git('rev-parse', '--verify', f'{SCAN}main').strip()
    heads = dict(line.split(' ', 1) for line in git('for-each-ref', '--format=%(refname) %(objectname)',
                                                    SCAN).splitlines())
    head = git('rev-parse', 'HEAD').strip()
    for push in pushes:
        _, sha, ref, _ = push.split()
        if set(sha) == {'0'} or not ref.startswith('refs/heads/'):
            continue
        branch = SCAN + ref.removeprefix('refs/heads/')
        others = {other for name, other in heads.items() if name not in (f'{SCAN}main', branch)}
        base = git('merge-base', sha, main).strip()
        plan = moves(sha, base, set(headings(main, *sorted(others))))
        if not plan:
            continue
        ids = ', '.join(plan)
        pairs = ', '.join(f'{old} to {new}' for old, new in plan.items())
        if sha != head:
            print(f'scenario ids (L97): {ref} adds {ids}, which main or another branch already heads; '
                  'check that branch out, then push it.', file=sys.stderr)
            return 1
        if git('status', '--porcelain', '--untracked-files=no'):
            print(f'scenario ids (L97): {ids} must be renumbered; commit your changes, then push again.',
                  file=sys.stderr)
            return 1
        if not rewrite(base, plan, f'Renumber {pairs}: main or another branch already heads them (L97)'):
            print(f'scenario ids (L97): {ids} must be renumbered, but no line the branch adds holds them.',
                  file=sys.stderr)
            return 1
        edited, failed = [], None
        try:
            for name in renumber_pr_and_issue(ref.removeprefix('refs/heads/'), plan):
                edited.append(name)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
            failed = error
        print(f'scenario ids (L97): renumbered {pairs} in a new commit'
              + (f' and in {", ".join(edited)}' if edited else '')
              + f', since main or another branch already heads {ids}. '
              + (f'Editing the PR and work Issue then failed ({failed}). ' if failed else '')
              + 'Push again, never with --no-verify, and use the new ids in any PR title, Scenarios: line or work '
              'Issue not named here.', file=sys.stderr)
        return 4 if failed else 1
    return 0


def main(args):
    if args == ['check']:
        return check()
    if len(args) == 2 and args[0] == 'mint':
        return mint(args[1], sys.stdin.read().splitlines())
    print('usage: scenario_ids.py check | mint <remote>', file=sys.stderr)
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, subprocess.SubprocessError) as error:
        print(f'scenario ids: {error}', file=sys.stderr)
        sys.exit(4)
