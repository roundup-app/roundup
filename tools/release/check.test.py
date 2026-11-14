"""C9 artifact gates exercise the command CI calls, using sparse exact-byte fixtures."""
import pathlib
import re
import contextlib
import importlib.util
import io
from types import SimpleNamespace
from unittest.mock import patch
import sys
import tempfile
import unittest

CHECK = pathlib.Path(__file__).with_name("check.py")
spec = importlib.util.spec_from_file_location("release_check", CHECK)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class Release(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)

    def run_check(self, kind, path, *options):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", [str(CHECK), kind, str(path), *map(str, options)]), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = checker.main()
        return SimpleNamespace(returncode=code, stdout=stdout.getvalue(), stderr=stderr.getvalue())

    def file(self, name, size):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as output:
            output.truncate(size)
        return path

    def test_c9b_binary_size_boundary(self):
        for size, code in [(14_999_999, 0), (15_000_000, 1), (15_000_001, 1)]:
            with self.subTest(size=size):
                result = self.run_check("binary", self.file("daemon-bin", size))
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(str(size), result.stdout)
                self.assertIn("15000000", result.stdout)

    def test_c9b_missing_binary_is_an_observer_error(self):
        path = self.root / "absent"
        result = self.run_check("binary", path)
        self.assertEqual(result.returncode, 2)
        self.assertIn(str(path), result.stderr)

    def test_c9b_invalid_binary_is_an_observer_error(self):
        directory = self.root / "directory"
        directory.mkdir()
        linked = self.root / "linked"
        linked.symlink_to(self.file("real", 1))
        for path in [directory, linked, self.file("empty", 0)]:
            with self.subTest(path=path):
                result = self.run_check("binary", path)
                self.assertEqual(result.returncode, 2)
                self.assertIn(str(path), result.stderr)

    def test_c9c_dist_size_boundary(self):
        for size, code in [(17_999_999, 0), (18_000_000, 1), (18_000_001, 1)]:
            with self.subTest(size=size):
                dist = self.root / str(size)
                self.file(f"{size}/assets/lazy.js", size - 11)
                self.file(f"{size}/index.html", 5)
                self.file(f"{size}/assets/fonts/font.woff2", 6)
                result = self.run_check("dist", dist)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(str(size), result.stdout)
                self.assertIn("18000000", result.stdout)

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
        self.file("zero/empty.js", 0)
        for path in [self.root / "missing", empty, self.root / "zero", linked, root_link, fifo, self.file("file", 1)]:
            with self.subTest(path=path):
                result = self.run_check("dist", path)
                self.assertEqual(result.returncode, 2, result.stdout)
                self.assertIn(str(path), result.stderr)

    def modules(self, name, chunk="assets/shared.js"):
        import json
        metadata = {"version": 2, "nodeMetas": {"m": {"id": name, "moduleParts": {chunk: "p"}}},
                    "nodeParts": {"p": {"metaUid": "m", "renderedLength": 42}}}
        report = self.root / "modules.json"
        report.write_text(json.dumps(metadata))
        inventory = self.root / "inventory.json"
        inventory.write_text(json.dumps({"modules": ["mermaid@12.1.0/dist/chunks/mermaid.core/flowDiagram-ABC.mjs"],
                                         "languages": {"plain": 0}, "diagrams": {"12.1.0": ["flowchart-v2"]}}))
        self.file(f"dist/{chunk}", 42)
        return report, inventory

    def test_c9d_unusable_modules_fail(self):
        for module, chunk, code in [
            ("mermaid@12.1.0/dist/chunks/mermaid.core/flowDiagram-ABC.mjs", "assets/flow.js", 0),
            ("mermaid@12.1.0/dist/chunks/mermaid.core/unknownDiagram-ABC.mjs", "assets/alone.js", 1),
            ("mermaid@12.1.0/dist/chunks/mermaid.core/unknownDiagram-ABC.mjs", "assets/shared.js", 1),
            ("@shikijs/langs/dist/typescript.mjs", "assets/shared.js", 1),
            ("@mermaid-js/parser/dist/unregistered.js", "assets/shared.js", 1),
        ]:
            with self.subTest(module=module, chunk=chunk):
                import shutil
                shutil.rmtree(self.root / "dist", ignore_errors=True)
                report, inventory = self.modules(module, chunk)
                result = self.run_check("modules", report, "--inventory", inventory, "--dist", self.root / "dist")
                self.assertEqual(result.returncode, code, result.stderr)
                if code:
                    self.assertIn(module, result.stdout)
                    self.assertIn(chunk, result.stdout)

    def test_c9d_missing_metadata_is_an_observer_error(self):
        import json
        report, inventory = self.modules("mermaid@12.1.0/dist/chunks/mermaid.core/flowDiagram-ABC.mjs")
        for invalid in [None, {}, {"version": 2, "nodeParts": {}, "nodeMetas": {}},
                        {"version": 2, "nodeParts": {"p": {"metaUid": "absent"}}, "nodeMetas": {}}]:
            with self.subTest(invalid=invalid):
                if invalid is None:
                    report.unlink(missing_ok=True)
                else:
                    report.write_text(json.dumps(invalid))
                result = self.run_check("modules", report, "--inventory", inventory, "--dist", self.root / "dist")
                self.assertEqual(result.returncode, 2, result.stdout)

    def test_c9d_incomplete_metadata_is_an_observer_error(self):
        import json
        for missing in ["inventory", "part", "module", "chunk"]:
            with self.subTest(missing=missing):
                report, inventory = self.modules("mermaid@12.1.0/dist/chunks/mermaid.core/flowDiagram-ABC.mjs")
                data = json.loads(report.read_text())
                if missing == "inventory":
                    inventory.unlink()
                elif missing == "part":
                    data["nodeParts"].clear()
                elif missing == "module":
                    data["nodeMetas"].clear()
                else:
                    self.file("dist/assets/omitted.js", 1)
                report.write_text(json.dumps(data))
                result = self.run_check("modules", report, "--inventory", inventory, "--dist", self.root / "dist")
                self.assertEqual(result.returncode, 2, result.stdout)

    def test_c9d_incomplete_inventory_is_an_observer_error(self):
        import json
        for missing in ["modules", "languages", "diagrams"]:
            with self.subTest(missing=missing):
                report, inventory = self.modules("mermaid@12.1.0/dist/chunks/mermaid.core/flowDiagram-ABC.mjs")
                data = json.loads(inventory.read_text())
                del data[missing]
                inventory.write_text(json.dumps(data))
                result = self.run_check("modules", report, "--inventory", inventory, "--dist", self.root / "dist")
                self.assertEqual(result.returncode, 2, result.stdout)

    @unittest.skipIf(__import__("os").geteuid() == 0, "root bypasses file permissions")
    def test_c9c_unreadable_dist_entry_is_an_observer_error(self):
        path = self.file("dist/unreadable.js", 1)
        path.chmod(0)
        self.addCleanup(path.chmod, 0o600)
        result = self.run_check("dist", path.parent)
        self.assertEqual(result.returncode, 2)
        self.assertIn(str(path), result.stderr)


WORKFLOW = pathlib.Path(__file__).parents[2] / ".github/workflows/check.yml"
LANES = ["plan", "rust", "mac-clippy", "mac", "mac-package", "web", "chromium"]


def jobs():
    """Job name -> its text, split on the two-space keys under `jobs:` (no YAML parser on the runner)."""
    text = WORKFLOW.read_text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([a-z][a-z0-9-]*):\n", text, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2]))


def needs(body):
    match = re.search(r"^    needs: (.+)$", body, flags=re.M)
    return re.findall(r"[a-z][a-z0-9-]*", match.group(1)) if match else []


def reaches(all_jobs, name):
    seen, todo = set(), needs(all_jobs[name])
    while todo:
        job = todo.pop()
        if job not in seen:
            seen.add(job)
            todo += needs(all_jobs[job])
    return seen


class Publish(unittest.TestCase):
    def test_df7078a_only_publish_writes_and_only_main_pushes_run_it(self):
        all_jobs = jobs()
        text = WORKFLOW.read_text()
        self.assertEqual(re.findall(r"contents: write", text), ["contents: write"])
        self.assertIn("contents: write", all_jobs["publish"])
        self.assertRegex(text.split("\njobs:\n")[0], r"(?m)^permissions:\n  contents: read$")
        gate = "github.event_name == 'push' && github.ref == 'refs/heads/main'"
        for name in ["bundle", "publish"]:
            self.assertIn(f"    if: {gate}", all_jobs[name], name)
            self.assertTrue(set(LANES + ["check"]) <= reaches(all_jobs, name), name)
        self.assertNotIn("publish", reaches(all_jobs, "check"))
        self.assertNotIn("bundle", reaches(all_jobs, "check"))

    def test_df7078a_no_step_outside_publish_names_gh_release(self):
        for name, body in jobs().items():
            if name != "publish":
                self.assertNotIn("gh release", body, name)


if __name__ == "__main__":
    unittest.main()
