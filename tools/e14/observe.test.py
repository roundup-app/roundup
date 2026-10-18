"""E14 exercises the observer's evidence boundary, never a product test double."""
import importlib.util
import unittest
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


if __name__ == "__main__":
    unittest.main()
