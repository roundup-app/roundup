import io
import subprocess
import sys
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import deadline  # noqa: E402

HANG = 'import time; print("tool", flush=True); time.sleep(30)'


class Deadline(unittest.TestCase):
    def run_hanging(self, **limits):
        out, began = io.StringIO(), time.monotonic()
        with redirect_stdout(out), subprocess.Popen([sys.executable, '-c', HANG], stdout=subprocess.PIPE, text=True,
                                                    start_new_session=True) as run:
            seen = list(deadline.lines(run, **limits))
        return seen, run.returncode, time.monotonic() - began, out.getvalue()

    def test_l23_a_run_past_its_deadline_or_silent_too_long_is_killed_after_a_warning(self):
        for limits, why in (({'stop': time.monotonic() + 0.5}, 'deadline'), ({'idle': 0.5}, 'no output')):
            with self.subTest(why=why):
                seen, code, took, out = self.run_hanging(**limits)
                self.assertEqual(seen, ['tool\n'])
                self.assertLess(took, 10)
                self.assertNotEqual(code, 0)
                self.assertIn(f'::warning::engine killed: {why}', out)


if __name__ == '__main__':
    unittest.main()
