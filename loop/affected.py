#!/usr/bin/env python3
"""L89: the tests a diff reaches. Usage: loop/affected.py rust|web|boxd|ping [base] | shards <count|all>
| rust-targets <test id>... | rust-helpers [nextest args] | rust-lane <nextest profile> [base]

Prints `all` when no base is given or the diff since <base> can move any test; else one line per selection: for `rust`
the cargo selection of the tests to run (`-p <crate>` runs a crate's whole suite; `-p <crate> --test <binary>` compiles
only that binary, for a diff of test files alone; T7188b), for `web` the files that still exist, as absolute paths, to pass
`vitest related`. The `boxd` selector prints `all` only for runner, integration or package-configuration changes, and
the `ping` selector (CI7295h) only when the diff reaches the `mac` lane's ping round trip or its guard observers. The diff
runs from where HEAD forked from <base> to the working tree, untracked files included, so a Builder's uncommitted change
counts. No output: no test reaches the diff. Exit 2: bad usage; a failed git or cargo call exits non-zero.

T7188a: `rust-targets` prints the same lines for test ids: `-p <crate> --test <binary>` (`--lib`, `--bin <name>`) for each target
that holds a `fn` whose name starts with an id, else every crate, with a notice on stderr.
T7188c: `rust-helpers` prints `build` when the helper binaries must be built before the `cargo nextest run` arguments run,
else `skip`.
L89: `rust-lane` prints the `cargo nextest run` arguments that build only the test binaries a CI lane's profile names and the
diff reaches, with the helper binaries they start; no output: nothing to run."""
from functools import cache
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib

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

# CI7295h: the `mac` lane's `rup ping` round trip and the N7/N8 guard observers after it start the `rupd` and `rup` the lane
# builds, which `desktop` starts and bundles as the App, and read these files.
PING_CRATES = {'rupd', 'rup', 'desktop'}
PING_READS = ('loop/ci-ping.sh', 'loop/app-data.py', 'loop/app-data.test.py', 'loop/launch-sites.test.py',
              'loop/launch-sites.json', '.github/workflows/pre.yml')


# T7188: what a test target's source reads from a helper binary built beside the test binaries (`rupd`, `rup`, the `terminal`
# test core): one Cargo builds for it (`CARGO_BIN_EXE_`), a sibling of a binary (`with_file_name("rup")`) or a path to one.
HELPERS = re.compile(r'CARGO_BIN_EXE_|with_file_name\("|join\("(?:rupd?|terminal)"\)|herdr-core-test')
# What rustc follows from a Rust file: `mod name;` with the attributes before it, and `include!("file")`.
MODULE = re.compile(r'((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;')
PATH_ATTRIBUTE = re.compile(r'\bpath\s*=\s*"([^"]+)"')
INCLUDE = re.compile(r'\binclude!\(\s*"([^"]+)"')
LIBRARIES = {'lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro'}
# L89: a lane's nextest profile names its test binaries: `binary_id(=<crate>)` a crate's library tests,
# `binary_id(=<crate>::bin/<name>)` a binary's and `binary_id(=<crate>::<name>)` an integration test's; `package(<crate>)`
# names every test binary of a crate.
BINARY_ID = re.compile(r'binary_id\(=([\w-]+)(?:::(bin/)?([\w-]+))?\)')
PACKAGE = re.compile(r'package\(([\w-]+)\)')
# The crates whose binaries tests start (`HELPERS`): building one of a crate's integration tests builds its binaries too.
HELPER_CRATES = ('rupd', 'rup', 'terminal')

# CI7295a: a full web run in this many shards keeps each one's modelled time under 190 s (`shardCount` of
# apps/desktop/src/testing/shardSequencer.ts), a test step near 220 s on the runner (run 43967384873); it caps a PR's
# count, which check's `plan` sizes by measured time.
MAX_SHARDS = 28


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


def ping(changed, workspace):
    """Select the ping round trip and its guard observers when a crate they start, or one it depends on, or a file they
    read can change."""
    reached = crates(changed, workspace)
    return 'all' if reached == 'all' or PING_CRATES & set(reached) or any(under(path, PING_READS) for path in changed) else []


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


def alternatives(expression):
    """The top-level `|` alternatives of a nextest filter expression, without the parentheses around the whole of each."""
    def bare(text):
        text = text.strip()
        while text.startswith('(') and closing(text) == len(text) - 1:
            text = text[1:-1].strip()
        return text

    text, parts, depth, start = bare(expression), [], 0, 0
    for index, char in enumerate(text):
        depth += {'(': 1, ')': -1}.get(char, 0)
        if char == '|' and depth == 0:
            parts.append(bare(text[start:index]))
            start = index + 1
    return parts + [bare(text[start:])]


def closing(text):
    """The index of the parenthesis that closes the one `text` starts with; ValueError when none does."""
    depth = 0
    for index, char in enumerate(text):
        depth += {'(': 1, ')': -1}.get(char, 0)
        if depth == 0:
            return index
    raise ValueError(f'unbalanced parentheses: {text}')


def binary_id(crate, flags):
    """nextest's id of the test binary of target `(crate, cargo flags)`."""
    return {'--lib': crate, '--bin': f'{crate}::bin/{flags[-1]}', '--test': f'{crate}::{flags[-1]}'}[flags[0]]


def lane_targets(expression, targets):
    """The `(crate, cargo flags)` of `targets` whose tests the lane filter `expression` can select: for each alternative, the
    binaries it names; every binary of the crates it names by `package`; for `not (...)`, every binary but those its own
    alternatives name alone; for any other alternative, every binary."""
    ids = {binary_id(crate, flags): (crate, flags) for crate, flags in targets}
    chosen = set()
    for alternative in alternatives(expression):
        if alternative.startswith('not'):
            alone = {name for inner in alternatives(alternative[3:]) if (whole := BINARY_ID.fullmatch(inner))
                     for name in [whole[0][len('binary_id(='):-1]]}
            chosen |= {target for name, target in ids.items() if name not in alone}
        elif named := [found[0][len('binary_id(='):-1] for found in BINARY_ID.finditer(alternative)]:
            chosen |= {ids[name] for name in named if name in ids}
        elif crates := set(PACKAGE.findall(alternative)):
            chosen |= {(crate, flags) for crate, flags in targets if crate in crates}
        else:
            chosen |= set(targets)
    return chosen


def resolved_features():
    """Each workspace crate's features a `cargo nextest run --workspace` enables, from `cargo metadata`'s resolve."""
    meta = json.loads(subprocess.run(['cargo', 'metadata', '--format-version', '1'], cwd=ROOT, check=True,
                                     stdout=subprocess.PIPE, text=True).stdout)
    names = {package['id']: package['name'] for package in meta['packages'] if package['id'] in meta['workspace_members']}
    return {names[node['id']]: set(node['features']) for node in meta['resolve']['nodes'] if node['id'] in names}


def lane_args(profile, changed, meta, root, features):
    """L89: the `cargo nextest run` arguments for a CI lane: `--workspace` and the `--lib`, `--bin` and `--test` targets
    of the profile's binaries that the changed paths reach (`rust()`; every one when `changed` is None), plus one integration
    test of each helper crate whose binaries a target starts (`helpers()`); None when no binary is reached. `--workspace`
    keeps every lane on one feature set, so each restores the dependencies the cache job built. A target whose
    `required-features` `features` (each crate's enabled features) lacks builds in no lane, as in `cargo nextest run --workspace`."""
    config = tomllib.loads((root / '.config/nextest.toml').read_text())
    tested = {(package['name'], 'bin' in target['kind'], target['name']) for package in meta['packages']
              for target in package['targets']
              if target.get('test', True) and set(target.get('required-features', [])) <= features.get(package['name'], set())}
    targets = [(crate, flags, files) for crate, flags, files in test_targets(meta, root)
               if flags == ('--lib',) or (crate, flags[0] == '--bin', flags[-1]) in tested]
    chosen = lane_targets(config['profile'][profile]['default-filter'], [(crate, flags) for crate, flags, _ in targets])
    reached = 'all' if changed is None else rust(changed, meta, root)
    if reached != 'all':
        lines = [line.split() for line in reached]
        chosen &= {(crate, flags) for crate, flags, _ in targets
                   for line in lines if line[1] == crate and (len(line) == 2 or tuple(line[2:]) == flags)}
    if not chosen:
        return None
    if helpers([word for line in selection(sorted(chosen)) for word in line.split()], meta, root) == 'build':
        size = {(crate, flags): sum((root / file).stat().st_size for file in files) for crate, flags, files in targets}
        for helper in HELPER_CRATES:
            # `--test <name>` builds every crate's test of that name: an anchor's name is the workspace's only one.
            names = [flags[-1] for _, flags in size if flags[0] == '--test']
            tests = [target for target in size if target[0] == helper and target[1][0] == '--test' and names.count(target[1][1]) == 1]
            if tests and not chosen & set(tests):
                chosen.add(min(tests, key=lambda target: (size[target], target)))
    return ' '.join(['--workspace', *sorted({' '.join(flags) for _, flags in chosen})])


def changed_since(base):
    """The paths changed from where HEAD forked from `base` to the working tree, untracked files included."""
    git = lambda *args: subprocess.run(['git', *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True).stdout
    fork = git('merge-base', base, 'HEAD').strip()
    return git('diff', '--name-only', '--no-renames', fork).split() + git('ls-files', '--others', '--exclude-standard').split()


def main(argv):
    if len(argv) == 3 and argv[1] == 'shards':
        print(json.dumps(shards(argv[2] if argv[2] == 'all' else int(argv[2]))))
        return 0
    if argv[1:2] == ['rust-helpers']:
        print(helpers(argv[2:], metadata(), ROOT))
        return 0
    if argv[1:2] == ['rust-targets'] and len(argv) > 2:
        return rust_targets(argv[2:])
    if argv[1:2] == ['rust-lane'] and len(argv) in (3, 4):
        base = argv[3] if len(argv) == 4 else ''
        if args := lane_args(argv[2], changed_since(base) if base else None, metadata(), ROOT, resolved_features()):
            print(args)
        return 0
    if len(argv) not in (2, 3) or argv[1] not in ('rust', 'web', 'boxd', 'ping'):
        print(__doc__, file=sys.stderr)
        return 2
    lane, base = argv[1], argv[2] if len(argv) == 3 else ''
    if not base:
        print('all')
        return 0
    changed = changed_since(base)
    selected = {'rust': lambda: rust(changed, metadata(), ROOT), 'web': lambda: web(changed),
                'boxd': lambda: boxd(changed), 'ping': lambda: ping(changed, workspace(metadata()))}[lane]()
    if selected != 'all' and lane == 'web':
        selected = sorted(set(selected) | set(app_scans(changed)))
        selected = [str(ROOT / path) for path in selected if (ROOT / path).exists()]
    print(selected if selected == 'all' else '\n'.join(selected))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
