"""Failure observations for the isolated M15 source fixture (no installed vendor)."""

import json
from pathlib import Path
import tempfile
import unittest

from m15_interactive import m15_interactive_source


class M15SourceTest(unittest.TestCase):
    def fixture(self, response, timeout=1):
        with tempfile.TemporaryDirectory(prefix="m15-fake-") as root:
            claude = Path(root) / "claude"
            claude.write_text("#!/usr/bin/env python3\n"
                              "import pathlib, time\n"
                              + (f"pathlib.Path('probe.json').write_text({json.dumps(response)})\n"
                               "pathlib.Path('probe.done').write_text('done')\n"
                               if response is not None else "")
                              + "time.sleep(0.5)\n")
            claude.chmod(0o700)
            return m15_interactive_source(str(claude), "2.1.296", "Agent", False, timeout)

    def test_m15_malformed_source_fails_visibly(self):
        malformed_checks = [{"command": command, "reply": None}
                            for command in ("echo hi", "touch x", "touch denied")]
        for source in ({}, [], {"checks": [None]}, {"checks": "allow"},
                       {"checks": malformed_checks}):
            with self.subTest(source=source):
                row = self.fixture(json.dumps(source))
                self.assertTrue(any("malformed source response" in failure
                                    for failure in row["failures"]), row)

    def test_m15_vendor_exit_without_source_fails_visibly(self):
        row = self.fixture(None)
        self.assertTrue(any("before the source replied" in failure
                            for failure in row["failures"]), row)
        self.assertEqual(row["exit"], 0)

    def test_m15_source_timeout_fails_visibly(self):
        row = self.fixture(None, timeout=0.05)
        self.assertIn("interactive source timed out", row["failures"])
        self.assertIsNotNone(row["exit"])


if __name__ == "__main__":
    unittest.main()
