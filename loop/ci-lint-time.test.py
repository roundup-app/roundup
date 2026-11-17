#!/usr/bin/env python3
"""CI7324: typecheck runs TypeScript 7 in apps/desktop; keep-going.sh logs each line's seconds."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
KEEP_GOING = ROOT / 'loop' / 'keep-going.sh'


def keep_going(body, summary=None):
    with tempfile.NamedTemporaryFile('w', suffix='.txt') as f:
        f.write(body)
        f.flush()
        env = {**os.environ, **({'GITHUB_STEP_SUMMARY': str(summary)} if summary else {})}
        return subprocess.run(['bash', str(KEEP_GOING), f.name], capture_output=True, text=True, env=env)


class CiLintTime(unittest.TestCase):
    def test_ci7324a_desktop_typecheck_runs_typescript_7(self):
        script = (ROOT / 'apps/desktop/package.json').read_text()
        self.assertIn('../../node_modules/.bin/tsc -v', script)
        out = subprocess.run([str(ROOT / 'node_modules/.bin/tsc'), '-v'], capture_output=True, text=True, check=True).stdout
        self.assertRegex(out, r'Version 7\.')

    def test_ci7324b_every_line_logs_seconds_and_a_failure_keeps_going(self):
        with tempfile.TemporaryDirectory() as d:
            summary = Path(d) / 'summary.md'
            r = keep_going('sleep 1\nexit 3\necho after\n', summary)
            self.assertEqual(r.returncode, 1)
            self.assertIn('[1s] sleep 1 (exit 0)', r.stderr)
            self.assertIn('exit 3 (exit 3)', r.stderr)
            self.assertIn('failed lines:\n  exit 3 (exit 3)', r.stderr)
            self.assertIn('[0s] echo after (exit 0)', r.stderr)
            text = summary.read_text()
            self.assertLess(text.index('1 sleep 1'), text.index('0 echo after'))

    def test_ci7324b_background_lines_overlap_and_still_fail_the_run(self):
        r = keep_going('& sleep 2\n& exit 4\nsleep 2\necho after\n')
        self.assertEqual(r.returncode, 1)
        self.assertIn('[2s] sleep 2 (exit 0)', r.stderr)
        self.assertIn('failed lines:\n  exit 4 (exit 4)', r.stderr)
        self.assertEqual(r.stderr.count('(exit 0)'), 3)
        started = subprocess.run(['bash', '-c', 'time (bash "$0" "$1")', str(KEEP_GOING), self._body('& sleep 2\nsleep 2\n')], capture_output=True, text=True)
        self.assertRegex(started.stderr, r'real\s+0m2\.\d')

    def _body(self, text):
        f = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False)
        self.addCleanup(os.unlink, f.name)
        f.write(text)
        f.close()
        return f.name


if __name__ == '__main__':
    unittest.main()
