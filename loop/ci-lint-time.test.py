#!/usr/bin/env python3
"""CI7324: typecheck runs TypeScript 7 in apps/desktop; keep-going.sh logs each line's seconds."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
KEEP_GOING = ROOT / 'loop' / 'keep-going.sh'
# keep-going.sh counts whole seconds with `date +%s`, so on the wall clock an n-second line logs n or n+1 and an exact assert
# flakes. A test that needs exact seconds puts this stand-in first on PATH: each call prints the next scripted epoch and removes
# it from the file named by FAKE_DATE_EPOCHS. A call past the script, or any argument but +%s, fails loud.
FAKE_DATE = """#!/bin/sh
[ "$*" = '+%s' ] || { echo "fake date: unexpected arguments: $*" >&2; exit 2; }
IFS= read -r epoch < "$FAKE_DATE_EPOCHS" || { echo 'fake date: no scripted epoch left' >&2; exit 1; }
tail -n +2 "$FAKE_DATE_EPOCHS" > "$FAKE_DATE_EPOCHS.next" && mv "$FAKE_DATE_EPOCHS.next" "$FAKE_DATE_EPOCHS"
echo "$epoch"
"""


def keep_going(body, summary=None, epochs=None):
    with tempfile.NamedTemporaryFile('w', suffix='.txt') as f, tempfile.TemporaryDirectory() as clock:
        f.write(body)
        f.flush()
        env = {**os.environ, **({'GITHUB_STEP_SUMMARY': str(summary)} if summary else {})}
        if epochs:
            fake_date, scripted = Path(clock) / 'date', Path(clock) / 'epochs'
            fake_date.write_text(FAKE_DATE)
            fake_date.chmod(0o755)
            scripted.write_text(''.join(f'{epoch}\n' for epoch in epochs))
            env.update(PATH=f'{clock}:{env["PATH"]}', FAKE_DATE_EPOCHS=str(scripted))
        return subprocess.run(['bash', str(KEEP_GOING), f.name], capture_output=True, text=True, env=env)


class CiLintTime(unittest.TestCase):
    def assert_logged(self, stderr, line, at_least, times=1):
        # On the real clock an n-second line logs n or n+1: only the floor is stable.
        found = [int(n) for n in re.findall(rf'^\[(\d+)s\] {re.escape(line)} \(exit 0\)$', stderr, re.M)]
        self.assertEqual(len(found), times, stderr)
        self.assertGreaterEqual(min(found), at_least, stderr)

    def test_ci7324a_desktop_typecheck_runs_typescript_7(self):
        script = (ROOT / 'apps/desktop/package.json').read_text()
        self.assertIn('../../node_modules/.bin/tsc -v', script)
        out = subprocess.run([str(ROOT / 'node_modules/.bin/tsc'), '-v'], capture_output=True, text=True, check=True).stdout
        self.assertRegex(out, r'Version 7\.')

    def test_ci7324a_a_planted_type_error_fails_typecheck_with_the_typescript_message(self):
        planted = ROOT / 'apps/desktop/src/zz_ci7324a_planted.ts'
        planted.write_text("export const planted: number = 'x';\n")
        self.addCleanup(planted.unlink, missing_ok=True)
        r = subprocess.run(['pnpm', 'run', 'typecheck'], cwd=ROOT / 'apps/desktop', capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("error TS2322: Type 'string' is not assignable to type 'number'.", r.stdout + r.stderr)

    def test_ci7324b_every_line_logs_seconds_and_a_failure_keeps_going(self):
        with tempfile.TemporaryDirectory() as d:
            summary = Path(d) / 'summary.md'
            # Each line reads the clock at its start and at its end: three (start, end) pairs of 3 s, 1 s and 7 s, with a gap between.
            r = keep_going('echo first\nexit 3\necho last\n', summary, epochs=[100, 103, 105, 106, 108, 115])
            self.assertEqual(r.returncode, 1, r.stderr)
            logged = re.findall(r'^\[\d+s\] .*$', r.stderr, re.M)
            self.assertEqual(logged, ['[3s] echo first (exit 0)', '[1s] exit 3 (exit 3)', '[7s] echo last (exit 0)'], r.stderr)
            slowest = '7 echo last\n3 echo first\n1 exit 3\n'
            self.assertIn(f'slowest lines, seconds first:\n{slowest}', r.stderr)
            self.assertEqual(summary.read_text(), f'### Slowest lines\n\n```\n{slowest}```\n', r.stderr)
            self.assertIn('failed lines:\n  exit 3 (exit 3)', r.stderr)

    def test_ci7324b_background_lines_overlap_and_still_fail_the_run(self):
        began = time.monotonic()
        r = keep_going('& sleep 2\n& exit 4\nsleep 2\necho after\n')
        elapsed = time.monotonic() - began
        self.assertEqual(r.returncode, 1)
        self.assert_logged(r.stderr, 'sleep 2', 2, times=2)
        self.assertIn('failed lines:\n  exit 4 (exit 4)', r.stderr)
        self.assertEqual(r.stderr.count('(exit 0)'), 3)
        # The two 2 s sleeps need 4 s one after the other; 3.5 s leaves a slow runner 1.5 s.
        self.assertLess(elapsed, 3.5, r.stderr)


if __name__ == '__main__':
    unittest.main()
