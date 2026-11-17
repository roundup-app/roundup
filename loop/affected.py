#!/usr/bin/env python3
"""L89: the tests a diff reaches. Usage: loop/affected.py rust|web|boxd [base] | shards <count|all>
| rust-targets <test id>... | rust-helpers [nextest args]

Prints `all` when no base is given or the diff since <base> can move any test; else one line per selection: for `rust`
the cargo selection of the tests to run (`-p <crate>` runs a crate's whole suite; `-p <crate> --test <binary>` compiles
only that binary, for a diff of test files alone; T7188b), for `web` the files that still exist, as absolute paths, to pass
`vitest related`. The `boxd` selector prints `all` only for runner, integration or package-configuration changes. The diff
runs from where HEAD forked from <base> to the working tree, untracked files included, so a Builder's uncommitted change
counts. No output: no test reaches the diff. Exit 2: bad usage; a failed git or cargo call exits non-zero.

T7188a: `rust-targets` prints the same lines for test ids: `-p <crate> --test <binary>` (`--lib`, `--bin <name>`) for each target
that holds a `fn` whose name starts with an id, else every crate, with a notice on stderr.
T7188c: `rust-helpers` prints `build` when the helper binaries must be built before the `cargo nextest run` arguments run,
else `skip`."""
from functools import cache
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
# The toolchains, lockfiles, runner setup and commands every test runs under.
EVERYTHING = ('Cargo.toml', 'Cargo.lock', 'rust-toolchain', 'rust-toolchain.toml', '.cargo/', '.config/nextest.toml',
              'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json', 'justfile',
              '.github/actions/setup/', '.github/workflows/check.yml', 'loop/affected.py', 'loop/keep-going.sh')
# Crate tests that read a file outside their crate and its dependencies: a change under the path reaches the crate.
CRATE_READS = {'contracts/': 'contracts', 'spikes/': 'agents', 'apps/desktop/src/app/seam.ts': 'rup',
               'apps/desktop/vite.config.ts': 'desktop', 'crates/desktop/src/lib.rs': 'rup',
               'crates/rpc/src/error.rs': 'contracts', 'crates/rup/src/mcp.rs': 'agents',
               'crates/rup/tests/common/': 'desktop', 'crates/rup/tests/e2e/': 'rupd', 'crates/rupd/src/': 'agents'}
# Browser tests serve the whole App through Vite, outside vitest's module graph, so `vitest related` cannot select them:
# on a PR, an App source file goes to `vitest related` anyway, and a browser test it breaks shows on `main`, which runs
# every web test. The App's other files (its config, its HTML), the contracts the App imports and the documents tests
# read from disk reach every test.
APP = 'apps/desktop/'
WEB_EVERYTHING = ('contracts/', 'docs/wireframes.md', 'docs/design-system.md', 'scenarios/app.md')
# Tests that read the App's source files as text (a directory listing plus a file read) are outside vitest's module graph,
# so a change to any App source file reaches each; the same holds for a Rust test naming the App's `src` folder.
WEB_SCAN = re.compile(r'\b(readdirSync|globSync)\(')
# The module every web test that starts a real `rupd` imports.
DAEMON = 'apps/desktop/src/testing/realDaemonPlugin.ts'
# Web tests that read a folder outside the App from disk: a change under the folder reaches each.
WEB_READS = {'artifacts/ux/': ('apps/desktop/src/testing/captures.test.ts',)}
# L121: the prepared runner, its callers and the package/CI configuration its regressions execute under.
BOXD_READS = ('loop/agent-runners/', 'loop/builder.py', 'loop/affected.py',
              '.github/workflows/', '.github/actions/setup/', '.github/actionlint.yaml',
              'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'justfile',
              'AGENTS.md', 'scenarios/loop-boxd.md')


# T7188: what a test target's source reads from a helper binary built beside the test binaries (`rupd`, `rup`, the `terminal`
# test core): one Cargo builds for it (`CARGO_BIN_EXE_`), a sibling of a binary (`with_file_name("rup")`) or a path to one.
HELPERS = re.compile(r'CARGO_BIN_EXE_|with_file_name\("|join\("(?:rupd?|terminal)"\)|herdr-core-test')
# What rustc follows from a Rust file: `mod name;` with the attributes before it, and `include!("file")`.
MODULE = re.compile(r'((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;')
PATH_ATTRIBUTE = re.compile(r'\bpath\s*=\s*"([^"]+)"')
INCLUDE = re.compile(r'\binclude!\(\s*"([^"]+)"')
LIBRARIES = {'lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro'}

# CI7295a: a full web run in this many shards keeps each one's modelled time under 190 s (`shardCount` of
# apps/desktop/src/testing/shardSequencer.ts), a test step near 220 s on the runner (run 43967384873); it caps a PR's
# count, which check's `plan` sizes by measured time.
MAX_SHARDS = 24


def shards(count):
    """The web shard numbers for `count` shards, or 'all': at least one, at most MAX_SHARDS."""
    return list(range(1, (MAX_SHARDS if count == 'all' else min(MAX_SHARDS, max(1, count))) + 1))


def under(path, prefixes):
    """Whether `path` is one of `prefixes` or lies in one ending in `/`."""
    return any(path == prefix or prefix.endswith('/') and path.startswith(prefix) for prefix in prefixes)


def crates(changed, workspace):
    """The crates whose tests the changed paths reach, given each crate's folder and the workspace crates it depends on
    (`workspace`, name -> (folder, names)): each crate holding or reading one, and each crate depending on those,
    dev-dependencies included; 'all' when one can move any test or lies in a folder of `crates/` no crate holds."""
    if any(under(path, EVERYTHING) for path in changed):
        return 'all'
    reached = set()
    for path in changed:
        holders = {name for name, (folder, _) in workspace.items() if path.startswith(folder + '/')}
        if not holders and path.startswith('crates/') and path.count('/') > 1:
            return 'all'
        reached |= holders | {name for prefix, name in CRATE_READS.items() if under(path, [prefix])}
    while dependants := {name for name, (_, deps) in workspace.items() if deps & reached} - reached:
        reached |= dependants
    return sorted(reached)


def web(changed):
    """The paths to pass `vitest related` for the web tests the changed paths reach: each changed App source file, each
    test reading a changed folder, and the real-`rupd` fixture when a crate changed; 'all' when one can move any test:
    an App file outside `src/`, a toolchain file, a contract or a document tests read."""
    app = [path for path in changed if path.startswith(APP) and not path.startswith(APP + 'observers/')]
    if any(under(path, EVERYTHING + WEB_EVERYTHING) for path in changed) or not all(path.startswith(APP + 'src/') for path in app):
        return 'all'
    return sorted(set(app) |
                  {test for prefix, tests in WEB_READS.items() if any(under(path, [prefix]) for path in changed)
                   for test in tests} |
                  ({DAEMON} if any(path.startswith('crates/') for path in changed) else set()))


def app_scans(changed):
    """The tests that scan the App's source files as text, when a changed path lies in them: each test file in
    `apps/desktop/src/` that lists a directory and reads a file, as repository paths."""
    if not any(path.startswith(APP + 'src/') for path in changed):
        return []
    return sorted(path.relative_to(ROOT).as_posix() for path in (ROOT / APP / 'src').rglob('*.test.ts*')
                  if WEB_SCAN.search(text := path.read_text()) and 'readFileSync' in text)


def boxd(changed):
    """Select the runner regressions only when their code, callers or execution configuration can change."""
    return 'all' if any(under(path, BOXD_READS) for path in changed) else []


def metadata():
    """`cargo metadata` of the workspace: its crates, their targets and their dependencies."""
    return json.loads(subprocess.run(['cargo', 'metadata', '--format-version', '1', '--no-deps'], cwd=ROOT,
                                     check=True, stdout=subprocess.PIPE, text=True).stdout)


def workspace(meta):
    """Each workspace crate's folder, relative to the repository root, and the workspace crates it depends on,
    dev-dependencies included."""
    names = {package['name'] for package in meta['packages']}
    return {package['name']: (Path(package['manifest_path']).parent.relative_to(meta['workspace_root']).as_posix(),
                              {dep['name'] for dep in package['dependencies']} & names)
            for package in meta['packages']}


@cache
def source(path):
    """The text of a Rust file."""
    return path.read_text()


def modules(root, entry):
    """The repository paths of the Rust files rustc reads for the crate root `entry`: the file, each `mod name;` as rustc
    resolves it (a `#[path]` is relative to the declaring file's folder; a file that is no crate root or `mod.rs` keeps its
    modules in the folder named for it) and each `include!("file")`. A file that does not exist is left out."""
    seen, pending = set(), [(Path(entry), True)]
    while pending:
        path, owns_folder = pending.pop()
        if path in seen or not (root / path).is_file():
            continue
        seen.add(path)
        text = source(root / path)
        folder = path.parent if owns_folder else path.parent / path.stem
        for attributes, name in MODULE.findall(text):
            if declared := PATH_ATTRIBUTE.search(attributes):
                pending.append((Path(os.path.normpath(path.parent / declared[1])), True))
            else:
                pending += [(folder / f'{name}.rs', False), (folder / name / 'mod.rs', True)]
        pending += [(Path(os.path.normpath(path.parent / name)), True) for name in INCLUDE.findall(text)]
    return {path.as_posix() for path in seen}


def test_targets(meta, root):
    """Each target of the workspace `cargo nextest` can run, as `(crate, cargo flags, Rust files it reads)`: the flags
    are `--lib`, `--bin <name>` or `--test <name>`."""
    found = []
    for package in meta['packages']:
        for target in package['targets']:
            kinds = set(target['kind'])
            if kinds & LIBRARIES:
                flags = ('--lib',)
            elif kinds & {'bin', 'test'}:
                flags = ('--bin' if 'bin' in kinds else '--test', target['name'])
            else:
                continue
            entry = Path(target['src_path']).resolve().relative_to(root)
            found.append((package['name'], flags, modules(root, entry)))
    return found


def targets_of(ids, targets, root):
    """T7188a: for each test id, the `(crate, cargo flags)` targets that read a file holding a `fn` whose name starts with
    the id; no target for an id no `fn` of the workspace starts with."""
    return {test_id: {(crate, flags) for crate, flags, files in targets
                      if any(re.search(rf'\bfn\s+{re.escape(test_id)}', source(root / file)) for file in files)}
            for test_id in ids}


def selection(chosen):
    """The selection lines for `(crate, cargo flags)` pairs: `-p <crate>`, then the flags."""
    return [' '.join(('-p', crate, *flags)) for crate, flags in chosen]


def test_files(changed, meta, root):
    """T7188b: the `(crate, cargo flags)` targets that read the changed paths, when every one is a Rust file in a crate's
    `tests/` folder that some target reads and no crate's tests read at run time (`CRATE_READS`); None for any other
    diff, which reaches whole crates (`crates()`)."""
    folders = tuple(f'{folder}/tests/' for folder, _ in workspace(meta).values())
    if not changed or not all(path.endswith('.rs') and path.startswith(folders) and not under(path, CRATE_READS)
                              for path in changed):
        return None
    targets = test_targets(meta, root)
    reached = [{(crate, flags) for crate, flags, files in targets if path in files} for path in changed]
    return sorted(set.union(*reached)) if all(reached) else None


def rust(changed, meta, root):
    """`all`, or the selection lines of the Rust tests the changed paths reach: the whole crates `crates()` finds, unless
    the paths are test files alone (`test_files()`)."""
    reached = crates(changed, workspace(meta))
    if reached == 'all':
        return reached
    return selection(test_files(changed, meta, root) or [(crate, ()) for crate in reached])


def rust_targets(ids):
    """T7188a: prints the selection lines of the test ids, or every crate with a notice when an id names no `fn`; exit 2
    for an id that is no Rust name."""
    if not all(re.fullmatch(r'\w+', test_id) for test_id in ids):
        print('rust-targets: a test id is letters, digits and underscores', file=sys.stderr)
        return 2
    meta = metadata()
    held = targets_of(ids, test_targets(meta, ROOT), ROOT)
    if missing := [test_id for test_id, group in held.items() if not group]:
        print(f'rust-targets: no test fn starts with {", ".join(missing)}: every crate compiles', file=sys.stderr)
        chosen = [(crate, ()) for crate in workspace(meta)]
    else:
        chosen = sorted(set().union(*held.values()))
    print('\n'.join(selection(chosen)))
    return 0


def helpers(args, meta, root):
    """T7188c: `build` when the helper binaries must be built before the tests that the `cargo nextest run` arguments `args`
    select run, else `skip`: when they select every test, or the source of a selected target, or of a library of a workspace
    crate it depends on, reads a helper (`HELPERS`). `-p`, `--lib`, `--bin` and `--test` select; other arguments do not."""
    packages, wanted = set(), set()
    words = iter(args)
    for word in words:
        option, _, value = word.partition('=')
        if option in ('--workspace', '--all', '--exclude'):
            return 'build'
        if option in ('-p', '--package'):
            packages.add(value or next(words, ''))
        elif option in ('--test', '--bin'):
            wanted.add((option, value or next(words, '')))
        elif option == '--lib':
            wanted.add(('--lib',))
    if not packages and not wanted:
        return 'build'
    members = workspace(meta)
    selected = (packages or set(members)) & set(members)
    targets = test_targets(meta, root)
    files = {file for crate, flags, held in targets if crate in selected and (not wanted or flags in wanted)
             for file in held}
    libraries = set(selected)
    while more := {dep for crate in libraries for dep in members[crate][1]} - libraries:
        libraries |= more
    files |= {file for crate, flags, held in targets if crate in libraries and flags == ('--lib',) for file in held}
    return 'build' if any(HELPERS.search(source(root / file)) for file in files) else 'skip'


def main(argv):
    if len(argv) == 3 and argv[1] == 'shards':
        print(json.dumps(shards(argv[2] if argv[2] == 'all' else int(argv[2]))))
        return 0
    if argv[1:2] == ['rust-helpers']:
        print(helpers(argv[2:], metadata(), ROOT))
        return 0
    if argv[1:2] == ['rust-targets'] and len(argv) > 2:
        return rust_targets(argv[2:])
    if len(argv) not in (2, 3) or argv[1] not in ('rust', 'web', 'boxd'):
        print(__doc__, file=sys.stderr)
        return 2
    lane, base = argv[1], argv[2] if len(argv) == 3 else ''
    if not base:
        print('all')
        return 0
    git = lambda *args: subprocess.run(['git', *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True).stdout
    fork = git('merge-base', base, 'HEAD').strip()
    tracked = git('diff', '--name-only', '--no-renames', fork).split()
    untracked = git('ls-files', '--others', '--exclude-standard').split()
    changed = tracked + untracked
    selected = rust(changed, metadata(), ROOT) if lane == 'rust' else (web(changed) if lane == 'web' else boxd(changed))
    if selected != 'all' and lane == 'web':
        selected = sorted(set(selected) | set(app_scans(changed)))
        selected = [str(ROOT / path) for path in selected if (ROOT / path).exists()]
    print(selected if selected == 'all' else '\n'.join(selected))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
