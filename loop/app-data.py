#!/usr/bin/env python3
"""N8: run commands in an owned temporary home and report App data writes."""
import json
import os
from pathlib import Path
import shutil
import secrets
import subprocess
import sys
import tempfile


def prepare_home(root):
    """Keep installed dependencies explicit while redirecting fallback App data."""
    previous = Path(os.environ['HOME'])
    env = dict(os.environ)
    for key, path in {
        'CARGO_HOME': previous / '.cargo',
        'RUSTUP_HOME': previous / '.rustup',
        'PLAYWRIGHT_BROWSERS_PATH': previous / '.cache/ms-playwright',
        'GIT_CONFIG_GLOBAL': previous / '.gitconfig',
        'NPM_CONFIG_USERCONFIG': previous / '.npmrc',
        'CODEX_HOME': previous / '.codex',
        'CLAUDE_CONFIG_DIR': previous / '.claude',
    }.items():
        env.setdefault(key, str(path))
    # agent-browser 0.27 installs Chrome for Testing in Puppeteer's cache.
    # Only preserve the executable; browser profiles remain in the guarded home.
    if 'AGENT_BROWSER_EXECUTABLE_PATH' not in env:
        cache = previous / '.cache/puppeteer/chrome'
        browsers = sorted(path for path in cache.rglob('*')
                          if path.name in ('chrome', 'Google Chrome for Testing')
                          and path.is_file() and os.access(path, os.X_OK))
        if browsers:
            env['AGENT_BROWSER_EXECUTABLE_PATH'] = str(browsers[-1].resolve())
    env['HOME'] = str(root / 'home')
    env['XDG_DATA_HOME'] = str(root / 'xdg')
    Path(env['HOME']).mkdir()
    Path(env['XDG_DATA_HOME']).mkdir()
    return env


def inspect(root, code):
    """Report every appearance, even an empty folder, file or dangling symlink."""
    paths = [root / 'home/Library/Application Support/dev.roundup.app',
             root / 'home/.local/share/dev.roundup.app', root / 'xdg/dev.roundup.app']
    written = False
    for path in paths:
        if os.path.lexists(path):
            print(f'App data written: {path}', flush=True)
            written = True
    if code:
        print(f'Test command failed: {code}', flush=True)
    return code or int(written)


def main(args):
    if args[0] == '--job-start':
        state = Path(args[1])
        root = Path(tempfile.mkdtemp(prefix='roundup-n8-')).resolve()
        env = prepare_home(root)
        # The state is outside the redirected HOME; the final step reads the same owned root.
        token = secrets.token_hex(32)
        (root / '.n8-owned').write_text(token)
        state.write_text(json.dumps({'root': str(root), 'token': token}))
        with open(os.environ['GITHUB_ENV'], 'a') as output:
            for key, value in env.items():
                if os.environ.get(key) != value:
                    output.write(f'{key}={value}\n')
        return 0
    if args[0] == '--job-finish':
        state = Path(args[1])
        owned = json.loads(state.read_text())
        root = Path(owned['root'])
        if (root.parent != Path(tempfile.gettempdir()).resolve()
                or not root.name.startswith('roundup-n8-')
                or (root / '.n8-owned').read_text() != owned['token']):
            raise ValueError('Guard state does not name its owned temporary directory')
        try:
            return inspect(root, 0 if args[2] == 'success' else 1)
        finally:
            shutil.rmtree(root)
            state.unlink()
    with tempfile.TemporaryDirectory(prefix='roundup-n8-') as folder:
        root = Path(folder).resolve()
        env = prepare_home(root)
        try:
            code = subprocess.run(args, env=env).returncode
        except OSError as error:
            print(error, file=sys.stderr)
            code = 127
        return inspect(root, code if code >= 0 else 128 - code)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
