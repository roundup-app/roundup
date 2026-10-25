"""C9 artifact gates exercise the command CI calls, using sparse exact-byte fixtures."""
import pathlib
import subprocess
import sys
import tempfile
import unittest

CHECK = pathlib.Path(__file__).with_name("check.py")


class Release(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)

    def run_check(self, kind, path):
        return subprocess.run([sys.executable, str(CHECK), kind, str(path)], capture_output=True, text=True)

    def file(self, name, size):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as output:
            output.truncate(size)
        return path

    def test_c9b_binary_size_boundary(self):
        for size, code in [(14_999_999, 0), (15_000_000, 1), (15_000_001, 1)]:
            with self.subTest(size=size):
                result = self.run_check("binary", self.file("rupd", size))
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(str(size), result.stdout)
                self.assertIn("15000000", result.stdout)

    def test_c9b_missing_binary_is_an_observer_error(self):
        path = self.root / "absent"
        result = self.run_check("binary", path)
        self.assertEqual(result.returncode, 2)
        self.assertIn(str(path), result.stderr)

    def test_c9c_dist_size_boundary(self):
        for size, code in [(9_999_999, 0), (10_000_000, 1), (10_000_001, 1)]:
            with self.subTest(size=size):
                dist = self.root / str(size)
                self.file(f"{size}/assets/lazy.js", size - 11)
                self.file(f"{size}/index.html", 5)
                self.file(f"{size}/assets/fonts/font.woff2", 6)
                result = self.run_check("dist", dist)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(str(size), result.stdout)
                self.assertIn("10000000", result.stdout)

    def test_c9c_invalid_dist_is_an_observer_error(self):
        empty = self.root / "empty"
        empty.mkdir()
        linked = self.root / "linked"
        linked.mkdir()
        (linked / "outside").symlink_to(self.file("external.js", 1))
        root_link = self.root / "root-link"
        root_link.symlink_to(linked, target_is_directory=True)
        fifo = self.root / "fifo"
        fifo.mkdir()
        import os
        os.mkfifo(fifo / "stream")
        for path in [self.root / "missing", empty, linked, root_link, fifo, self.file("file", 1)]:
            with self.subTest(path=path):
                result = self.run_check("dist", path)
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn(str(path), result.stderr)

    @unittest.skipIf(__import__("os").geteuid() == 0, "root bypasses file permissions")
    def test_c9c_unreadable_dist_entry_is_an_observer_error(self):
        path = self.file("dist/unreadable.js", 1)
        path.chmod(0)
        self.addCleanup(path.chmod, 0o600)
        result = self.run_check("dist", path.parent)
        self.assertEqual(result.returncode, 2)
        self.assertIn(str(path), result.stderr)


if __name__ == "__main__":
    unittest.main()
