#!/usr/bin/env python3
"""N8: observe the guard through command exit and its failure rows."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / 'loop/app-data.py'


class Guard(unittest.TestCase):
    def run_guard(self, command, **env):
        return subprocess.run([sys.executable, str(GUARD), *command],
                              env={**os.environ, **env}, text=True, capture_output=True)

    def test_n8_guard_reports_writes_and_command_failure(self):
        for code in (0, 17):
            with self.subTest(code=code):
                result = self.run_guard(['python3', '-c',
                    'import os,pathlib,sys; '
                    'home=pathlib.Path(os.environ["HOME"]); '
                    'paths=[home/"Library/Application Support/dev.roundup.app", '
                    'home/".local/share/dev.roundup.app", '
                    'pathlib.Path(os.environ["XDG_DATA_HOME"])/"dev.roundup.app"]; '
                    '[p.mkdir(parents=True) for p in paths]; '
                    f'sys.exit({code})'])
                self.assertNotEqual(result.returncode, 0)
                rows = result.stdout.splitlines()
                self.assertEqual(sum(row.startswith('App data written: /') for row in rows), 3)
                self.assertEqual(f'Test command failed: {code}' in rows, code != 0)
                for row in rows:
                    if row.startswith('App data written: '):
                        self.assertFalse(Path(row.split(': ', 1)[1]).exists())

    def test_n8_guard_keeps_command_failure(self):
        result = self.run_guard(['bash', '-c', 'exit 23'])
        self.assertEqual(result.returncode, 23)
        self.assertEqual(result.stdout.strip(), 'Test command failed: 23')

    def test_n8_guard_owns_home_and_preserves_toolchains(self):
        with tempfile.TemporaryDirectory() as seeded:
            seed = Path(seeded) / '.local/share/dev.roundup.app/keep'
            seed.parent.mkdir(parents=True)
            seed.write_bytes(b'keep')
            result = self.run_guard(['python3', '-c',
                'import os,pathlib; h=pathlib.Path(os.environ["HOME"]); '
                'assert h.is_absolute(); '
                'assert pathlib.Path(os.environ["XDG_DATA_HOME"]).is_relative_to(h.parent); '
                'assert os.environ["CARGO_HOME"]=="/explicit/cargo"; print(h)'],
                HOME=seeded, CARGO_HOME='/explicit/cargo')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(Path(result.stdout.strip()).exists())
            self.assertEqual(seed.read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
