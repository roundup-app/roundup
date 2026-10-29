#!/usr/bin/env python3
"""Z4505: exercise the real Clippy recipe without starting a compiler."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class Selection(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        shutil.copy2(ROOT / "justfile", self.root / "justfile")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for command, script in {
            "python3": '''#!/bin/bash
printf '%s\\n' "$@" >> "$SELECTOR_LOG"
printf '%s' "$SELECTOR_STDOUT"
printf '%s' "$SELECTOR_STDERR" >&2
exit "$SELECTOR_STATUS"
''',
            "cargo": '''#!/bin/bash
printf '%s\\n' "$@" >> "$CARGO_LOG"
exit "$CARGO_STATUS"
''',
        }.items():
            path = self.bin / command
            path.write_text(script)
            path.chmod(0o755)

    def run_recipe(self, *, base="origin/main", output="", selector_status=0,
                   diagnostic="", cargo_status=0):
        selector_log = self.root / "selector.log"
        cargo_log = self.root / "cargo.log"
        selector_log.write_text("")
        cargo_log.write_text("")
        result = subprocess.run(
            [shutil.which("just"), "--justfile", str(self.root / "justfile"),
             "clippy", *([] if base is None else [base])],
            cwd=self.root,
            env={
                **os.environ,
                "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                "SELECTOR_LOG": str(selector_log),
                "SELECTOR_STDOUT": output,
                "SELECTOR_STDERR": diagnostic,
                "SELECTOR_STATUS": str(selector_status),
                "CARGO_LOG": str(cargo_log),
                "CARGO_STATUS": str(cargo_status),
            },
            capture_output=True, text=True, timeout=3,
        )
        return result, selector_log.read_text().splitlines(), cargo_log.read_text().splitlines()

    def z4505_selection_failure_fails_the_recipe(self):
        for output in ("", "rupd\n"):
            with self.subTest(output=output):
                result, selector, cargo = self.run_recipe(
                    output=output, selector_status=23, diagnostic="selector-fixture-failed\n",
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("selector-fixture-failed", result.stderr)
                self.assertEqual(selector, ["loop/affected.py", "rust", "origin/main"])
                self.assertEqual(cargo, [])
                self.assertNotIn("clippy skipped", result.stdout + result.stderr)


if __name__ == "__main__":
    loader = unittest.TestLoader()
    loader.testMethodPrefix = "z4505_"
    unittest.main(testLoader=loader, verbosity=2)
