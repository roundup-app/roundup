#!/usr/bin/env python3
"""L121: prepare and verify the snapshot against CI's existing tool-version source."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

import yaml

INSTALL = Path('/opt/roundup-ci')
RUNNER = Path('/opt/actions-runner')
# Not in the setup action: CI does not use it. Its release publishes a SHA-256 digest per archive.
CODEGRAPH = '1.6.2'
# boxd's egress proxy re-signs this host with its own CA, whose key boxd rotates; a stale copy fails TLS verification.
EGRESS_PROBE = 'https://api.anthropic.com'
EGRESS_CA = Path('/usr/local/share/ca-certificates/boxd-egress.crt')


def run(*args, timeout=600, cwd=None):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, cwd=cwd)
    if result.returncode:
        print(result.stdout, file=sys.stderr, flush=True)
        result.check_returncode()
    return result.stdout


def pins(action):
    """Read versions from the setup action rather than introducing a second set of CI pins."""
    source = Path(action).read_text()
    steps = yaml.safe_load(source)['runs']['steps']
    inputs = {step.get('uses', '').split('@')[0]: step.get('with', {}) for step in steps if 'uses' in step}
    return {'rust': inputs['dtolnay/rust-toolchain']['toolchain'],
            'node': str(inputs['actions/setup-node']['node-version']),
            'python': str(inputs['actions/setup-python']['python-version']),
            'codex': re.search(r'@openai/codex@([0-9.]+)', source)[1],
            'agent-browser': re.search(r'agent-browser@([0-9.]+)', source)[1],
            'gh': re.search(r'want=([0-9.]+)', source)[1],
            'claude': re.search(r'install\.sh \| bash -s -- ([0-9.]+)', source)[1]}


def github_archive(repository, release, pattern):
    """Fetch an official release asset only when its published SHA-256 digest matches."""
    with urllib.request.urlopen(f'https://api.github.com/repos/{repository}/releases/{release}', timeout=30) as response:
        release = json.load(response)
    asset = next(item for item in release['assets'] if re.fullmatch(pattern, item['name']))
    with urllib.request.urlopen(asset['browser_download_url'], timeout=120) as response:
        archive = response.read()
    if 'sha256:' + hashlib.sha256(archive).hexdigest() != asset['digest']:
        raise SystemExit(f'{repository} archive checksum mismatch')
    return archive, release['tag_name']


def verify_egress_tls():
    """Fail on a TLS error reaching the proxied host; an HTTP status error means the chain verified."""
    try:
        urllib.request.urlopen(EGRESS_PROBE, timeout=20)
    except urllib.error.HTTPError:
        pass
    except urllib.error.URLError as error:
        if isinstance(error.reason, ssl.SSLError):
            raise SystemExit(f'boxd egress CA is stale for {EGRESS_PROBE}: {error.reason}; rebuild the image')
        raise


def refresh_egress_ca():
    """Install the CA the live egress proxy signs with: the self-signed certificate in the chain it presents."""
    host = EGRESS_PROBE.removeprefix('https://')
    chain = run('bash', '-c', f'openssl s_client -connect {host}:443 -servername {host} -showcerts </dev/null 2>/dev/null',
                timeout=60)
    for block in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', chain, re.S):
        names = subprocess.run(('openssl', 'x509', '-noout', '-subject', '-issuer'), input=block, text=True,
                               capture_output=True, check=True).stdout.splitlines()
        subject, issuer = (line.split('=', 1)[1].strip() for line in names)
        if subject == issuer and 'boxd egress CA' in subject:
            temporary = Path(tempfile.mkstemp(suffix='.crt')[1])
            temporary.write_text(block + '\n')
            run('sudo', 'install', '-m', '0644', '-o', 'root', '-g', 'root', str(temporary), str(EGRESS_CA))
            temporary.unlink()
            run('sudo', 'update-ca-certificates')
            return
    raise SystemExit(f'{host} presented no boxd egress CA; is the build machine behind the egress proxy?')


def verify(action):
    """Fail visibly when a prepared snapshot no longer matches the setup action or installed programs."""
    verify_egress_tls()
    manifest = json.loads((INSTALL / 'image.json').read_text())
    if manifest['setup'] != hashlib.sha256(Path(action).read_bytes()).hexdigest():
        raise SystemExit('boxd snapshot does not match CI setup; refresh it before starting an agent')
    expected = {**pins(action), 'codegraph': CODEGRAPH}
    for name, executable in (('rust', 'rustc'), ('node', 'node'), ('python', 'python3'),
                              ('codex', 'codex'), ('agent-browser', 'agent-browser'), ('claude', 'claude'), ('gh', 'gh'),
                              ('codegraph', 'codegraph')):
        actual = run(executable, '--version', timeout=15).strip()
        if not re.search(rf'(?<![0-9.])v?{re.escape(expected[name])}(?:\.|[^0-9.]|$)', actual):
            raise SystemExit(f'boxd {name}: expected {expected[name]}, got {actual}')
    print(json.dumps({'prepared': manifest['created_from'], 'runner': manifest['runner'], 'tools': expected}))


def install_codegraph():
    """Install the pinned codegraph release the way its install.sh does (a versioned directory, `current` and a link on
    PATH), but only from an archive whose published SHA-256 digest matches."""
    archive, _ = github_archive('colbymchenry/codegraph', f'tags/v{CODEGRAPH}', r'codegraph-linux-x64\.tar\.gz')
    home = Path('/home/boxd/.codegraph')
    target = home / 'versions' / f'v{CODEGRAPH}'
    shutil.rmtree(target, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory, tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as source:
        source.extractall(directory, filter='data')
        shutil.move(next(Path(directory).glob('codegraph-*')), target)
    run('ln', '-sfn', str(target), str(home / 'current'))
    run('ln', '-sf', str(target / 'bin/codegraph'), '/home/boxd/.local/bin/codegraph')


def build(repository, instructions=None):
    """Build once on an isolated image machine; save only after cold reboot, before runner registration. With
    `instructions`, a file, the Claude Code and Codex user instructions of every job are that file."""
    repository = Path(repository).resolve()
    action = repository / '.github/actions/setup/action.yml'
    versions = pins(action)
    os.environ['PATH'] = f"/home/boxd/.cargo/bin:/home/boxd/.local/bin:{os.environ['PATH']}"
    print('Installing native build/browser prerequisites', flush=True)
    run('sudo', 'apt-get', 'update', timeout=300)
    run('sudo', 'apt-get', 'install', '-y', 'python3-yaml', 'libwebkit2gtk-4.1-dev', 'build-essential',
        'libxdo-dev', 'libssl-dev', 'libayatana-appindicator3-dev', 'librsvg2-dev', 'jq', 'unzip',
        'clang', 'libclang-dev')
    print('Preparing pinned Node and agent programs', flush=True)
    run('bash', '-lc', f'. "$HOME/.nvm/nvm.sh"; nvm install {versions["node"]}; '
        f'sudo ln -sf "$(nvm which {versions["node"]})" /usr/local/bin/node')
    package = json.loads((repository / 'package.json').read_text())
    run('sudo', '/usr/local/bin/npm', 'install', '-g', '--force', '--prefix', '/usr/local', package['packageManager'],
        f'@openai/codex@{versions["codex"]}', f'agent-browser@{versions["agent-browser"]}',
        f'@anthropic-ai/claude-code@{versions["claude"]}', 'bun@1.3.14')
    run('ln', '-sf', '/usr/local/bin/claude', '/home/boxd/.local/bin/claude')
    archive, _ = github_archive('cli/cli', f'tags/v{versions["gh"]}', r'gh_[0-9.]+_linux_amd64\.tar\.gz')
    with tempfile.TemporaryDirectory() as directory, tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as source:
        source.extractall(directory, filter='data')
        binary = next(Path(directory).glob('*/bin/gh'))
        # boxd recreates /usr/local/bin/gh on boot; its wrapper delegates to this system binary.
        run('sudo', 'install', str(binary), '/usr/bin/gh')
    run('rustup', 'toolchain', 'install', versions['rust'], '--component', 'clippy,rustfmt', '--profile', 'minimal')
    run('rustup', 'default', versions['rust'])
    for tool, crate in (('just', 'just'), ('cargo-nextest', 'cargo-nextest'), ('cargo-machete', 'cargo-machete')):
        if not shutil.which(tool):
            run('cargo', 'install', '--locked', crate, timeout=1200)
    run('agent-browser', 'install', '--with-deps')
    print('Installing pinned codegraph and indexing the checkout', flush=True)
    install_codegraph()
    run('codegraph', 'init', '-y', str(repository), timeout=900)
    # These agent jobs use native/JavaScript actions. A foreign container job must not execute before identity checks.
    refresh_egress_ca()
    run('sudo', 'systemctl', 'disable', '--now', 'docker.service', 'docker.socket', 'containerd.service')
    print('Warming the workspace package store and Rust build cache', flush=True)
    run('pnpm', 'install', '--frozen-lockfile', cwd=repository)
    os.environ['CARGO_TARGET_DIR'] = '/home/boxd/cargo-target'
    run('cargo', 'build', '-p', 'rupd', '-p', 'rup', cwd=repository, timeout=1200)
    print('Installing checksum-verified GitHub runner', flush=True)
    archive, runner_version = github_archive('actions/runner', 'latest', r'actions-runner-linux-x64-[0-9.]+\.tar\.gz')
    run('sudo', 'install', '-d', '-o', 'boxd', '-g', 'boxd', str(RUNNER), str(INSTALL),
        str(RUNNER / '_work'), str(RUNNER / '_work/_tool'), str(RUNNER / '_work/_temp'))
    path = INSTALL / 'runner.tar.gz'
    path.write_bytes(archive)
    with tarfile.open(path, 'r:gz') as source:
        source.extractall(RUNNER, filter='data')
    path.unlink()
    for script in ('agent.py', 'memory.py', 'image.py'):
        shutil.copyfile(repository / 'loop/agent-runners' / script, INSTALL / script)
    for name in ('.claude', '.codex', '.opencode', '.roundup-ci', '.config/gh', '.config/boxd',
                 '.local/share/opencode', '.local/share/claude', '.aws', '.ssh'):
        shutil.rmtree(Path('/home/boxd') / name, ignore_errors=True)
    for target in ('/home/boxd/.claude/CLAUDE.md', '/home/boxd/.codex/AGENTS.md') if instructions else ():
        run('sudo', 'install', '-D', '-o', 'boxd', '-g', 'boxd', '-m', '0644', str(Path(instructions).resolve()), target)
    gitconfig = Path('/home/boxd/.gitconfig')
    gitconfig.unlink(missing_ok=True)
    manifest = {'setup': hashlib.sha256(action.read_bytes()).hexdigest(), 'tools': versions,
                'runner': runner_version, 'created_from': run('git', '-C', str(repository), 'rev-parse', 'HEAD').strip()}
    (INSTALL / 'image.json').write_text(json.dumps(manifest, indent=2))
    verify(action)
    print('Prepared. Cold-reboot this machine, then save the roundup-ci snapshot.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('build', 'verify'))
    parser.add_argument('path')
    parser.add_argument('--instructions', help='file installed as the user instructions of Claude Code and Codex (build only)')
    arguments = parser.parse_args()
    if arguments.command == 'verify':
        if arguments.instructions:
            parser.error('--instructions applies to build only')
        verify(arguments.path)
    else:
        build(arguments.path, arguments.instructions)
