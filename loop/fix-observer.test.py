import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fix_observer', Path(__file__).with_name('fix-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class Observer(unittest.TestCase):
    def test_l82_short_window_never_reads_or_reports_completion(self):
        class NoReads:
            def read(self, *args):
                raise AssertionError('early collection')
        self.assertIsNone(observer.collect(NoReads(), Path('/unused'), observer.START))


if __name__ == '__main__':
    unittest.main()
