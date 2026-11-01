#!/usr/bin/env python3
"""L5398: the repo-wide scans run in the lane every PR runs."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


def dry_run(recipe):
    return subprocess.run(['just', '--dry-run', recipe], cwd=ROOT, check=True, capture_output=True, text=True).stderr


class LintRepo(unittest.TestCase):
    def test_l5398_repo_wide_scans_run_in_the_lane_every_pr_runs(self):
        self.assertIn('scan.py web', dry_run('lint-rust'))
        self.assertNotIn('scan.py web', dry_run('lint-web'))


if __name__ == '__main__':
    unittest.main()
