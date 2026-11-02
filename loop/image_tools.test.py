#!/usr/bin/env python3
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import chdir, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('builder', ROOT / 'loop/builder.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

LOGIN = json.dumps(dict(auth_mode='chatgpt', tokens=dict(access_token='access', refresh_token='refresh')))
SERVER = '[mcp_servers.codegraph]\ncommand = "codegraph"\nargs = ["serve", "--mcp"]\n'


def fake_codegraph(path, fails=False):
    """A `codegraph` on a PATH of `path`/bin that logs its arguments to `path`/calls; the PATH."""
    Path(path, 'bin').mkdir()
    Path(path, 'bin/codegraph').write_text(f'#!/usr/bin/env bash\necho "$*" >>"{path}/calls"\n' + ('exit 1\n' if fails else ''))
    Path(path, 'bin/codegraph').chmod(0o755)
    return f'{path}/bin:/usr/bin:/bin'


class CodexHome(unittest.TestCase):
    def home(self, path, instructions=None, codegraph=True):
        """`builder.codex_home` with HOME `path`: the new home's AGENTS.md and config.toml."""
        if instructions is not None:
            Path(path, '.codex').mkdir()
            Path(path, '.codex/AGENTS.md').write_text(instructions)
        with patch.dict(os.environ, HOME=path, PATH=fake_codegraph(path) if codegraph else '/usr/bin:/bin'), \
                redirect_stdout(io.StringIO()):
            home = builder.codex_home(LOGIN, Path(path, 'home'))
        agents = home / 'AGENTS.md'
        return (agents.read_text() if agents.exists() else None), (home / 'config.toml').read_text()

    def test_l121_codex_reads_the_images_instructions_from_its_home_when_the_image_has_them(self):
        with tempfile.TemporaryDirectory() as path:
            self.assertEqual(self.home(path, 'Be terse.')[0], 'Be terse.')
        with tempfile.TemporaryDirectory() as path:
            self.assertIsNone(self.home(path)[0])

    def test_l121_codex_gets_the_codegraph_server_only_where_codegraph_is_installed(self):
        with tempfile.TemporaryDirectory() as path:
            self.assertIn(SERVER, self.home(path)[1])
        with tempfile.TemporaryDirectory() as path:
            config = self.home(path, codegraph=False)[1]
        self.assertNotIn('codegraph', config)
        self.assertIn('cli_auth_credentials_store = "file"', config)


class Sync(unittest.TestCase):
    def engine(self, path, indexed=True, installed=True, fails=False):
        """`builder.engine` in a checkout: the `codegraph` calls, the log and the exit code."""
        Path(path, 'checkout/.codegraph' if indexed else 'checkout').mkdir(parents=True)
        Path(path, 'temp').mkdir()
        out = io.StringIO()
        with chdir(Path(path, 'checkout')), \
                patch.dict(os.environ, RUNNER_TEMP=f'{path}/temp', PATH=fake_codegraph(path, fails) if installed else '/usr/bin:/bin'), \
                patch.object(builder, 'switched', return_value=False), patch.object(builder, 'worked', return_value=True), \
                patch.object(builder, 'codex', return_value=0), redirect_stdout(out):
            code = builder.engine('Build U1.', None, Path(path, 'output'))
        calls = Path(path, 'calls')
        return (calls.read_text().splitlines() if calls.exists() else []), out.getvalue(), code

    def test_l121_a_run_syncs_the_checkouts_index_once_before_it_starts_and_only_when_there_is_one(self):
        with tempfile.TemporaryDirectory() as path:
            self.assertEqual(self.engine(path)[0], ['sync .'])
        with tempfile.TemporaryDirectory() as path:
            self.assertEqual(self.engine(path, indexed=False)[0], [])
        with tempfile.TemporaryDirectory() as path:
            self.assertEqual(self.engine(path, installed=False)[0], [])

    def test_l121_a_failed_index_sync_warns_and_the_run_goes_on(self):
        with tempfile.TemporaryDirectory() as path:
            calls, log, code = self.engine(path, fails=True)
        self.assertEqual(calls, ['sync .'])
        self.assertIn('::warning::codegraph sync failed', log)
        self.assertEqual(code, 0)


if __name__ == '__main__':
    unittest.main()
