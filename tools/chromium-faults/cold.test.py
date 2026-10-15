"""U26: real Chromium startup held until the command has failed, never a timer release."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


class ColdTest(unittest.TestCase):
    def test_u26_concurrent_cold_deadline_captures_held_startup_before_release(self):
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
            wrapper.write_text('#!/bin/sh\nexport CHROME_CONFIG_HOME="$U26_HELD_CONFIG"\nexec "$U26_REAL_CHROME" "$@"\n')
            wrapper.chmod(0o755)
            selected = subprocess.check_output(["node", "--experimental-strip-types", "--input-type=module", "-e", 'import {chromePath} from "./apps/desktop/src/testing/chromePage.ts"; console.log(chromePath())'], cwd=ROOT, text=True).strip()
            self.assertTrue(Path(selected).is_file(), selected)
            env = dict(os.environ, CHROME_PATH=str(wrapper), U26_HELD_CONFIG=str(root), U26_REAL_CHROME=selected)
            artifact = root / "cold.jsonl"
            started = time.monotonic()
            try:
                result = subprocess.run(["python3", str(HERE / "observe.py"), "--log", str(root / "faults.jsonl"), "--", "node", "--experimental-strip-types", str(HERE / "cold.mts"), str(artifact)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertLess(time.monotonic() - started, 45)
                events = [json.loads(row) for row in artifact.read_text().splitlines()]
                starts = [event for event in events if event["status"] == "starting"]
                failed = [event for event in events if event["status"] == "failed"]
                self.assertEqual(len(starts), 2)
                self.assertEqual(len(failed), 2)
                self.assertLess(max(event["elapsed_ms"] for event in starts), min(event["elapsed_ms"] for event in failed))
                for event in failed:
                    self.assertIn("Target.createTarget timed out after 20000 ms", event["error"])
                    self.assertIn("received=0 bytes", event["error"])
                    self.assertIn("threads:\nprocess", event["error"])
                    self.assertIn("wchan=", event["error"])
                    pid = event["error"].split("Chrome pid=", 1)[1].split(",", 1)[0]
                    self.assertFalse(Path(f"/proc/{pid}").exists(), "owned browser survived failure")
                faults = [json.loads(row) for row in (root / "faults.jsonl").read_text().splitlines()]
                self.assertEqual(faults[-1]["command_status"], result.returncode)
                # Locks are still owned here: capture and command failure precede release.
                self.assertTrue(all(not file.closed for file in locks))
            finally:
                for file in locks:
                    file.close()


if __name__ == "__main__":
    unittest.main()
