#!/usr/bin/env python3
"""L89: the tests a diff reaches. Usage: loop/affected.py rust|web|boxd [base]

Prints `all` when no base is given or the diff since <base> can move any test; else one line per selection: for `rust`
the workspace crates to test, for `web` the files that still exist, as absolute paths, to pass `vitest related`.
The `boxd` selector prints `all` only for runner, integration or package-configuration changes. The diff
runs from where HEAD forked from <base> to the working tree, untracked files included, so a Builder's uncommitted change
counts. No output: no test reaches the diff. Exit 2: bad usage; a failed git or cargo call exits non-zero."""
import json
from pathlib import Path
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
# Browser tests serve the whole App through Vite, outside vitest's module graph, so any App file but a test or an
# observer script reaches them; so do the contracts the App imports and the documents tests read from disk.
APP = 'apps/desktop/'
WEB_EVERYTHING = ('contracts/', 'docs/wireframes.md', 'docs/design-system.md', 'scenarios/app.md')
# The module every web test that starts a real `rupd` imports.
DAEMON = 'apps/desktop/src/testing/realDaemonPlugin.ts'
# Web tests that read a folder outside the App from disk: a change under the folder reaches each.
WEB_READS = {'artifacts/ux/': ('apps/desktop/src/testing/captures.test.ts',)}
# L121: the prepared runner, its callers and the package/CI configuration its regressions execute under.
BOXD_READS = ('loop/agent-runners/', 'loop/builder.py', 'loop/affected.py', 'loop/workflows.test.py',
              '.github/workflows/', '.github/actions/setup/', '.github/actionlint.yaml',
              'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'justfile',
              'AGENTS.md', 'scenarios/loop-boxd.md')


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
    """The paths to pass `vitest related` for the web tests the changed paths reach: each changed test, each test reading
    a changed folder, and the real-`rupd` fixture when a crate changed; 'all' when one can move any test or reaches the
    App the browser serves."""
    app = (path for path in changed if path.startswith(APP) and not path.startswith(APP + 'observers/'))
    if any(under(path, EVERYTHING + WEB_EVERYTHING) for path in changed) or not all(map(is_web_test, app)):
        return 'all'
    return sorted({path for path in changed if is_web_test(path)} |
                  {test for prefix, tests in WEB_READS.items() if any(under(path, [prefix]) for path in changed)
                   for test in tests} |
                  ({DAEMON} if any(path.startswith('crates/') for path in changed) else set()))


def is_web_test(path):
    return path.startswith(APP + 'src/') and path.endswith(('.test.ts', '.test.tsx'))


def boxd(changed):
    """Select the runner regressions only when their code, callers or execution configuration can change."""
    return 'all' if any(under(path, BOXD_READS) for path in changed) else []


def workspace():
    """Each workspace crate's folder, relative to the repository root, and the workspace crates it depends on,
    dev-dependencies included."""
    metadata = json.loads(subprocess.run(['cargo', 'metadata', '--format-version', '1', '--no-deps'], cwd=ROOT,
                                         check=True, stdout=subprocess.PIPE, text=True).stdout)
    names = {package['name'] for package in metadata['packages']}
    return {package['name']: (Path(package['manifest_path']).parent.relative_to(metadata['workspace_root']).as_posix(),
                              {dep['name'] for dep in package['dependencies']} & names)
            for package in metadata['packages']}


def main(argv):
    if len(argv) not in (2, 3) or argv[1] not in ('rust', 'web', 'boxd'):
        print(__doc__, file=sys.stderr)
        return 2
    lane, base = argv[1], argv[2] if len(argv) == 3 else ''
    if not base:
        print('all')
        return 0
    git = lambda *args: subprocess.run(['git', *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True).stdout
    fork = git('merge-base', base, 'HEAD').strip()
    changed = (git('diff', '--name-only', '--no-renames', fork) + git('ls-files', '--others', '--exclude-standard')).split()
    selected = crates(changed, workspace()) if lane == 'rust' else (web(changed) if lane == 'web' else boxd(changed))
    if selected != 'all' and lane == 'web':
        selected = [str(ROOT / path) for path in selected if (ROOT / path).exists()]
    print(selected if selected == 'all' else '\n'.join(selected))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
