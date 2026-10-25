"""R4132b: exercise the guard against real local Git objects, never the worktree."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

GUARD = Path(__file__).with_name("guard.py")


class FileSize(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "BASE": ""}
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.git("config", "core.hooksPath", "/dev/null")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("update-ref", "refs/remotes/origin/main", self.base)

    def git(self, *args):
        return subprocess.check_output(
            ["git", *args], cwd=self.root, env=self.env, text=True, stderr=subprocess.PIPE
        )

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "fixture", "--allow-empty")

    def write(self, name, size, byte=b"x"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(byte * size)

    def guard(self, *args):
        return subprocess.run(
            [sys.executable, str(GUARD), *args], cwd=self.root,
            env=self.env, capture_output=True, text=True, check=False,
        )

    def test_r4132b_new_file_size_boundary(self):
        for size in (999_999, 1_000_000, 1_000_001):
            with self.subTest(size=size):
                self.write("new file", size)
                self.commit()
                result = self.guard(self.base)
                self.assertEqual(result.returncode, int(size > 1_000_000), result.stderr)
                if size > 1_000_000:
                    self.assertIn("new file", result.stdout)

    def test_r4132b_growth_above_limit_fails(self):
        self.write("small", 999_999)
        self.write("large\tname", 1_000_001)
        self.commit()
        base = self.git("rev-parse", "HEAD").strip()
        self.write("small", 1_000_001)
        self.write("large\tname", 1_000_002)
        self.commit()
        result = self.guard(base)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("small", result.stdout)
        self.assertIn("large\tname", result.stdout)

    def test_r4132b_existing_large_files_do_not_fail(self):
        for name in ("unchanged", "same", "shrink", "delete"):
            self.write(name, 1_000_002)
        self.commit()
        base = self.git("rev-parse", "HEAD").strip()
        self.write("same", 1_000_002, b"y")
        self.write("shrink", 1_000_001)
        (self.root / "delete").unlink()
        self.commit()
        result = self.guard(base)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_r4132b_copy_does_not_inherit_exemption(self):
        self.write("existing", 1_000_001)
        self.commit()
        base = self.git("rev-parse", "HEAD").strip()
        self.write("copy", 1_000_001)
        self.commit()
        result = self.guard(base)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("copy", result.stdout)

    def test_r4132b_only_named_icons_are_exempt(self):
        for name in ("artwork.png", "icon.png", "social-preview.png"):
            self.write(f"crates/desktop/icons/{name}", 1_000_001)
        self.commit()
        result = self.guard(self.base)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.write("crates/desktop/icons/other.png", 1_000_001)
        self.commit()
        result = self.guard(self.base)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("crates/desktop/icons/other.png", result.stdout)

    def test_r4132b_missing_git_input_fails(self):
        for ref in ("missing-base", "HEAD:."):
            with self.subTest(ref=ref):
                result = self.guard(ref)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn(ref, result.stderr)
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        result = self.guard()
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("origin/main", result.stderr)
        (self.root / ".git").rename(self.root / "saved-git")
        result = self.guard("HEAD")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("HEAD", result.stderr)

    def test_r4132b_default_uses_merge_base(self):
        self.write("main-only", 1_000_001)
        self.commit()
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("reset", "--hard", self.base)
        self.write("branch-only", 1_000_001)
        self.commit()
        # A file present only in the worktree must not influence a HEAD check.
        self.write("untracked", 1_000_002)
        result = self.guard()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("branch-only", result.stdout)
        self.assertNotIn("main-only", result.stdout)
        self.assertNotIn("untracked", result.stdout)


if __name__ == "__main__":
    unittest.main()
