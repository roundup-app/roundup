"""U26: real Chromium startup held until the command has failed, never a timer release."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test import line

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

# Bound the observer attachment, the explicit 60 s startup cap, and teardown.
# observe.py may wait 45 s for bpftrace to attach, then the command's 60 s deadline
# runs, then tracer teardown takes at most 5 s (reader joins) + 10 s (tracer wait)
# + 5 s (kill-after); the margin covers process start and exit.
OBSERVER_LIMIT_S = 45 + 60 + 20 + 15


@contextmanager
def held_startup():
    with tempfile.TemporaryDirectory(prefix="u26-cold-") as directory:
        root = Path(directory)
        locks = []
        for name in ("google-chrome", "google-chrome-for-testing", "chromium"):
            path = root / name / "Crash Reports" / "settings.dat"
            path.parent.mkdir(parents=True)
            file = path.open("w+b")
            fcntl.flock(file, fcntl.LOCK_EX)
            locks.append(file)
        # The private executable redirects only Crashpad's config location.
        # openPage, its flags, real browser and DevTools pipe are unchanged.
        wrapper = root / "chrome"
        wrapper.write_text('#!/bin/sh\nprintf \"%s\\n\" \"$$\" >> \"$U26_BROWSER_PIDS\"\nexport CHROME_CONFIG_HOME="$U26_HELD_CONFIG"\nexec "$U26_REAL_CHROME" "$@"\n')
        wrapper.chmod(0o755)
        selected = subprocess.check_output(["node", "--experimental-strip-types", "--input-type=module", "-e", 'import {chromePath} from "./apps/desktop/src/testing/chromePage.ts"; console.log(chromePath())'], cwd=ROOT, text=True, timeout=10).strip()
        assert Path(selected).is_file(), selected
        env = dict(os.environ, CHROME_PATH=str(wrapper), U26_HELD_CONFIG=str(root), U26_REAL_CHROME=selected, U26_BROWSER_PIDS=str(root / "pids"))
        try:
            yield root, locks, env
        finally:
            for file in locks:
                file.close()


class ColdTest(unittest.TestCase):
    def test_u26_concurrent_cold_deadline_captures_held_startup_before_release(self):
        with held_startup() as (root, locks, env):
            artifact = root / "cold.jsonl"
            try:
                result = subprocess.run(["python3", str(HERE / "observe.py"), "--log", str(root / "faults.jsonl"), "--", "node", "--experimental-strip-types", str(HERE / "cold.mts"), str(artifact)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=OBSERVER_LIMIT_S)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                events = [json.loads(row) for row in artifact.read_text().splitlines()]
                starts = [event for event in events if event["status"] == "starting"]
                failed = [event for event in events if event["status"] == "failed"]
                self.assertEqual(len(starts), 2)
                self.assertEqual(len(failed), 2)
                self.assertLess(max(event["elapsed_ms"] for event in starts), min(event["elapsed_ms"] for event in failed))
                # elapsed_ms starts when cold.mts does, after the observer attached.
                self.assertLess(max(event["elapsed_ms"] for event in failed), 85_000)
                for event in failed:
                    self.assertIn("Target.createTarget timed out after 60000 ms", event["error"])
                    self.assertIn("last completed stage=launched", event["error"])
                    self.assertIn("received=0 bytes", event["error"])
                    self.assertIn("threads:\nprocess", event["error"])
                    pid = event["error"].split("Chrome pid=", 1)[1].split(",", 1)[0]
                    # /proc samples the browser at the deadline: Chrome may be
                    # runnable even with the lock held. Keep its actual
                    # state visible rather than requiring one kernel wait site.
                    self.assertRegex(event["error"], rf"{pid} Name:\s+chrome; State:\s+\S+ [^\n]+; wchan=[^;]+; syscall=[^;]+; stat=")
                    self.assertFalse(Path(f"/proc/{pid}").exists(), "owned browser survived failure")
                faults = [json.loads(row) for row in (root / "faults.jsonl").read_text().splitlines()]
                self.assertEqual(faults[-1]["command_status"], result.returncode)
                self.assertTrue(any(event["status"] == "attached" for event in faults))
                self.assertTrue(faults[-1]["live_state_verified"], faults[-1])
                self.assertTrue(faults[-1]["history_complete"], faults[-1])
                print(json.dumps({"observation": "held-cold", "errors": [event["error"].split("; stderr:")[0] for event in failed], "fault_artifact_verified": True}), flush=True)
                pids = (root / "pids").read_text().splitlines()
                self.assertEqual(len(pids), 2)
                self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in pids))
                # Locks are still owned here: capture and command failure precede release.
                self.assertTrue(all(not file.closed for file in locks))
            finally:
                for file in locks:
                    file.close()

    def test_u26_main_warmup_misses_the_original_cold_deadline(self):
        with held_startup() as (root, locks, env):
            baseline = root / "baseline.mts"
            # Resolve main's extensionless TS import without editing its source.
            baseline.write_text("""
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.endsWith('/chromePage') ? specifier + '.ts' : specifier, context);
}});
const { default: warmChrome } = await import(WARM);
const { chromePath, openPage } = await import(HELPER);
let warmed = false;
const warm = warmChrome().then(() => { warmed = true; });
const started = performance.now();
try {
  // Pin the superseded budget to preserve the independent warmup counterexample.
  const page = await openPage(chromePath(), { startupMs: 20_000 });
  await page.close();
  throw new Error('held cold startup unexpectedly succeeded');
} catch (error) {
  console.log(JSON.stringify({ status: 'cold-rejected', warmed, elapsed_ms: performance.now() - started, error: String(error).split("; stderr:")[0] }));
}
await warm;
console.log(JSON.stringify({ status: 'warmed-after-release' }));
""".replace("WARM", json.dumps((ROOT / "apps/desktop/src/testing/warmChrome.ts").as_uri())).replace("HELPER", json.dumps((ROOT / "apps/desktop/src/testing/chromePage.ts").as_uri())))
            child = subprocess.Popen(["node", "--experimental-strip-types", str(baseline)], cwd=ROOT / "apps/desktop", env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                failure = json.loads(line(child.stdout))
                self.assertEqual(failure["status"], "cold-rejected")
                self.assertFalse(failure["warmed"])
                self.assertIn("Target.createTarget timed out after 20000 ms", failure["error"])
                self.assertIn("received=0 bytes", failure["error"])
                self.assertIsNone(child.poll(), "warmup must remain held until the cold rejection event")
                for file in locks:
                    file.close()
                output, errors = child.communicate(timeout=30)
                self.assertEqual(child.returncode, 0, errors.decode())
                self.assertIn(b'warmed-after-release', output)
                print(json.dumps({"observation": "unchanged-main-warmup-gap", "elapsed_ms": failure["elapsed_ms"], "warmup_pending_at_cold_rejection": True, "warmup_completed_after_event_release": True}), flush=True)
            finally:
                for file in locks:
                    file.close()
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=10)

    def test_u26_slow_concurrent_cold_waits_for_readiness(self):
        import time
        with held_startup() as (root, locks, env):
            artifact = root / "slow.jsonl"
            child = subprocess.Popen(["node", "--experimental-strip-types", str(HERE / "cold.mts"), str(artifact)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 60  # setup wait on a loaded runner; the scenario window is the 21 s below
                while not (root / "pids").exists() or len((root / "pids").read_text().splitlines()) < 2:
                    self.assertLess(time.monotonic(), deadline, "both browsers must reach the owned startup hold")
                    time.sleep(.05)
                # Negative observation window: neither call may fail at the old deadline.
                time.sleep(21)
                self.assertIsNone(child.poll(), "slow startup failed before the readiness event")
                self.assertFalse(any(json.loads(row)["status"] in ("failed", "answered") for row in artifact.read_text().splitlines()))
                for file in locks:
                    file.close()
                _, errors = child.communicate(timeout=40)
                self.assertEqual(child.returncode, 0, errors.decode())
                events = [json.loads(row) for row in artifact.read_text().splitlines()]
                self.assertEqual([event["value"] for event in events if event["status"] == "answered"], [42, 42])
                self.assertEqual(len([event for event in events if event["status"] == "closed"]), 2)
                for call in (0, 1):
                    stages = [event for event in events if event.get("call") == call and event["status"] == "stage"]
                    self.assertEqual([event["stage"] for event in stages], ["executable-reading", "executable-read", "server-listening", "launched", "target-created", "page-ready"])
                    self.assertGreater(stages[-1]["duration_ms"], 20_000)
                print(json.dumps({"observation": "slow-cold-released", "events": events}), flush=True)
                self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in (root / "pids").read_text().splitlines()))
            finally:
                for file in locks:
                    file.close()
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=10)

    def test_u26_real_concurrent_calls_return_known_values(self):
        with held_startup() as (root, locks, env):
            for file in locks:
                file.close()
            artifact = root / "cold.jsonl"
            result = subprocess.run(["node", "--experimental-strip-types", str(HERE / "cold.mts"), str(artifact)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=45)
            self.assertEqual(result.returncode, 0, result.stderr)
            events = [json.loads(row) for row in artifact.read_text().splitlines()]
            self.assertEqual([event["value"] for event in events if event["status"] == "answered"], [42, 42])
            self.assertEqual(len([event for event in events if event["status"] == "closed"]), 2)
            self.assertEqual(events[-1]["status"], "completed")
            pids = (root / "pids").read_text().splitlines()
            self.assertEqual(len(pids), 2)
            self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in pids))


if __name__ == "__main__":
    unittest.main()
