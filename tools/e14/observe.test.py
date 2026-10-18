"""E14 exercises the observer's evidence boundary, never a product test double."""
import importlib.util
import unittest
import json
import tempfile
import subprocess
import os
import time
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("observe", Path(__file__).with_name("observe.py"))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class E14(unittest.TestCase):
    def test_e14_real_claude_test_concurrency_is_at_most_four(self):
        rows = [dict(id=str(i), start=1000, end=2000, real=True) for i in range(4)]
        self.assertEqual(observer.overlap(rows), 4)
        with self.assertRaisesRegex(ValueError, "5 overlapping"):
            observer.overlap(rows + [dict(id="b21", start=1100, end=1900, real=True)])

    def test_e14_overlap_within_junit_resolution_is_touching_but_two_ms_is_not(self):
        rows = [dict(id=str(i), start=1000, end=2000, real=True) for i in range(4)]
        self.assertEqual(observer.overlap(rows + [dict(id="b21", start=1999, end=3000, real=True)]), 4)
        with self.assertRaisesRegex(ValueError, "5 overlapping"):
            observer.overlap(rows + [dict(id="b21", start=1998, end=3000, real=True)])

    def test_e14_missing_lifecycle_or_memory_fails_visibly(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "lane.json").write_text(json.dumps(dict(exit_code=0, started=1000, ended=2000)))
            rows = [dict(id="b21", start=1100, end=1900, real=True)]
            for missing in ("lifecycle.json", "memory.jsonl"):
                with self.subTest(missing=missing):
                    (directory / "lifecycle.json").write_text(json.dumps(rows))
                    (directory / "memory.jsonl").write_text('"not used"')
                    (directory / missing).unlink()
                    with self.assertRaises(FileNotFoundError):
                        observer.evidence(directory)

    def test_e14_memory_must_cover_the_whole_lane(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "lane.json").write_text(json.dumps(dict(exit_code=0, started=1000, ended=2000)))
            (directory / "lifecycle.json").write_text(json.dumps([dict(id="b21", start=1200, end=1800, real=True)]))
            (directory / "memory.jsonl").write_text("".join(json.dumps(dict(at=at, used=used, total=100)) + "\n" for at, used in ((999, 20), (1500, 70), (2001, 40))))
            self.assertEqual(observer.evidence(directory)["peak_runner_bytes"], 70)
            (directory / "memory.jsonl").write_text("".join(json.dumps(dict(at=at, used=70, total=100)) + "\n" for at in (1200, 1800)))
            with self.assertRaisesRegex(ValueError, "does not cover lane"):
                observer.evidence(directory)

    def test_e14_failed_lane_cannot_be_reported_as_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "lane.json").write_text('{"exit_code": 42}')
            with self.assertRaisesRegex(ValueError, "lane failed with exit 42"):
                observer.evidence(directory)

    def test_e14_web_reporter_keeps_worker_timestamps_on_failure(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(dir=root / "apps/desktop/reporting") as temporary:
            directory = Path(temporary)
            fixture = directory / "e14.test.ts"
            fixture.write_text('test("e14_pass", () => expect(1).toBe(1)); test("e14_failure", () => expect(1).toBe(2));')
            config = directory / "vitest.config.mjs"
            report = directory / "web.json"
            reporter = directory / "reporter.mjs"
            reporter.write_text((root / "tools/e14/reporter.mjs.in").read_text())
            config.write_text("export default " + json.dumps(dict(test=dict(globals=True, include=[str(fixture)], reporters=[str(reporter)]))) + ";")
            result = subprocess.run(["pnpm", "--filter", "desktop", "exec", "vitest", "run", "--config", str(config)], cwd=root, env=dict(os.environ, E14_LIFECYCLE=str(report)), capture_output=True, text=True, timeout=60)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            rows = json.loads(report.read_text())["modules"][0]["tests"]
            self.assertEqual([r["status"] for r in rows], ["passed", "failed"])
            self.assertTrue(all(r["end"] >= r["start"] > 0 for r in rows))
            with self.assertRaisesRegex(ValueError, "web module failed"):
                observer.web_rows(report)

    def test_e14_rust_overlap_uses_precise_execution_intervals(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            report = directory / "junit.xml"
            report.write_text('<testsuites tests="5">' + ''.join(
                f'<testcase classname="rup::real_claude" name="case{i}" timestamp="2026-10-18T00:00:00.000+00:00" time="0.001"/>'
                for i in range(5)) + '</testsuites>')
            traces = directory / "rust-events"
            traces.mkdir()
            start = 1792281600000
            for i in range(5):
                (traces / f"{i}.json").write_text(json.dumps(dict(
                    id=f"rup::real_claude::case{i}", start=start + i * 0.1,
                    end=start + (i + 1) * 0.1, exit_code=0)))
            self.assertEqual(observer.overlap(observer.rust_rows(report)), 1)
            (traces / "4.json").unlink()
            with self.assertRaisesRegex(ValueError, "execution intervals"):
                observer.rust_rows(report)

    def test_e14_nextest_report_keeps_b21_lifecycle(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "src").mkdir()
            (directory / "tests").mkdir()
            package, binary, prefix = observer.RUST_SUITES["required_test_prefix"].split("::")
            (directory / "Cargo.toml").write_text(f'[package]\nname="{package}"\nversion="0.0.0"\nedition="2021"\n')
            (directory / "src/lib.rs").write_text("")
            (directory / "tests" / f"{binary}.rs").write_text(f'#[test] fn {prefix}observer_fixture() {{ std::thread::sleep(std::time::Duration::from_millis(10)); }}')
            report = directory / "junit.xml"
            (directory / ".config").mkdir()
            (directory / ".config/nextest.toml").write_text("")
            config = observer.nextest_config(directory, directory, "ci1")
            result = subprocess.run(["cargo", "nextest", "run", "--manifest-path", str(directory / "Cargo.toml"), "--config-file", str(config), "--profile", "ci1"], env=dict(os.environ, E14_RUST_EVENTS=str(directory / "rust-events")), capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            rows = observer.rust_rows(report)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["id"], observer.RUST_SUITES["required_test_prefix"] + "observer_fixture")
            self.assertTrue(rows[0]["real"])
            self.assertGreater(rows[0]["end"], rows[0]["start"])
            # The same wrapper must execute the real command when it fails too.
            (directory / "tests" / f"{binary}.rs").write_text(f'#[test] fn {prefix}observer_fixture() {{ panic!("expected failure"); }}')
            for trace in (directory / "rust-events").iterdir():
                trace.unlink()
            failed = subprocess.run(["cargo", "nextest", "run", "--manifest-path", str(directory / "Cargo.toml"), "--config-file", str(config), "--profile", "ci1"], env=dict(os.environ, E14_RUST_EVENTS=str(directory / "rust-events")), capture_output=True, text=True, timeout=60)
            self.assertEqual(failed.returncode, 100, failed.stdout + failed.stderr)
            execution = json.loads(next((directory / "rust-events").iterdir()).read_text())
            self.assertNotEqual(execution["exit_code"], 0)
            with self.assertRaisesRegex(ValueError, "failed or retried Rust test"):
                observer.rust_rows(report)

    def test_e14_memory_collector_finishes_only_after_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "memory.jsonl"
            child = subprocess.Popen([sys.executable, str(Path(__file__).with_name("observe.py")), "memory", "--output", str(report)])
            try:
                deadline = time.monotonic() + 5
                while not (report.exists() and len(report.read_text().splitlines()) >= 2):
                    if time.monotonic() > deadline or child.poll() is not None:
                        self.fail("memory collector did not emit samples")
                    time.sleep(.01)
                self.assertFalse(report.with_suffix(".done").exists())
                report.with_suffix(".stop").touch()
                self.assertEqual(child.wait(timeout=5), 0)
                self.assertTrue(report.with_suffix(".done").exists())
                samples = [json.loads(line) for line in report.read_text().splitlines()]
                self.assertTrue(all(0 < s["used"] <= s["total"] for s in samples))
            finally:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=5)

    def test_e14_before_after_report_requires_every_full_lane(self):
        # Synthetic evidence exercises report assembly, not the benchmark itself.
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for side in ("baseline", "head"):
                for lane in observer.LANES:
                    output = directory / side / lane
                    output.mkdir(parents=True)
                    metadata = dict(exit_code=0, started=1000, ended=2000, elapsed_seconds=1, lane=lane, full=True,
                                    observer={"fixture": "same"}, commit=("a" if side == "baseline" else "b") * 40, cache=dict(description="cold"),
                                    runner=dict(run=None, os="Linux", cpu_count=4, total_memory=100, image="ubuntu24", image_version="same"))
                    (output / "lane.json").write_text(json.dumps(metadata))
                    name = observer.RUST_SUITES["required_test_prefix"] + "fixture" if lane == "rust1" else lane
                    (output / "lifecycle.json").write_text(json.dumps([dict(id=name, start=1100, end=1900, real=lane in ("rust1", "web1"))]))
                    (output / "memory.jsonl").write_text("".join(json.dumps(dict(at=at, used=20, total=100)) + "\n" for at in (999, 1500, 2001)))
            command = [sys.executable, str(Path(__file__).with_name("observe.py")), "compare", str(directory / "baseline"), str(directory / "head")]
            passed = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(passed.returncode, 0, passed.stderr)
            self.assertIn("| head | " + "b" * 40 + " | web7 |", passed.stdout)
            (directory / "head/web7/lane.json").unlink()
            failed = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(failed.returncode, 1)
            self.assertIn("E14 observation FAILED", failed.stderr)
            self.assertNotIn("| head |", failed.stdout)


if __name__ == "__main__":
    unittest.main()
