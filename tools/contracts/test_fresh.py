"""C4 exercises the real freshness command in an isolated, clean checkout."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Freshness(unittest.TestCase):
    def test_c4_contracts_fresh_detects_drift(self):
        with tempfile.TemporaryDirectory(prefix="c4-fresh-") as directory:
            checkout = Path(directory) / "checkout"
            subprocess.run(["git", "worktree", "add", "--detach", str(checkout), "HEAD"], cwd=ROOT, check=True, capture_output=True)
            try:
                path = checkout / "contracts/generated/Actor.ts"
                path.unlink()
                result = subprocess.run(["just", "contracts-fresh"], cwd=checkout, env={**os.environ, "CARGO_TARGET_DIR": str(ROOT / "target")}, text=True, capture_output=True)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("Actor.ts", result.stdout + result.stderr)
                self.assertTrue(path.exists(), "freshness must regenerate the missing file before reporting drift")
            finally:
                subprocess.run(["git", "worktree", "remove", "--force", str(checkout)], cwd=ROOT, check=True)


if __name__ == "__main__":
    unittest.main()
