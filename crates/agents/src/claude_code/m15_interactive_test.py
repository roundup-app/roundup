"""Failure observations for the isolated M15 source fixture (no installed vendor)."""

import json
from pathlib import Path
import tempfile
import unittest

from m15_interactive import m15_interactive_source


class M15SourceTest(unittest.TestCase):
    def fixture(self, response):
        with tempfile.TemporaryDirectory(prefix="m15-fake-") as root:
            claude = Path(root) / "claude"
            claude.write_text("#!/usr/bin/env python3\n"
                              "import pathlib, time\n"
                              f"pathlib.Path('probe.json').write_text({json.dumps(response)})\n"
                              "pathlib.Path('probe.done').write_text('done')\n"
                              "time.sleep(10)\n")
            claude.chmod(0o700)
            return m15_interactive_source(str(claude), "2.1.296", "Agent", False, 1)

    def test_m15_malformed_source_fails_visibly(self):
        for source in ({}, [], {"checks": [None]}, {"checks": "allow"}):
            with self.subTest(source=source):
                row = self.fixture(json.dumps(source))
                self.assertTrue(any("malformed source response" in failure
                                    for failure in row["failures"]), row)


if __name__ == "__main__":
    unittest.main()
