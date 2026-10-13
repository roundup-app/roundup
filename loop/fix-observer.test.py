#!/usr/bin/env python3
"""L82 renewed observation: retained evidence, never a fixture-based live closure."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fix_observer', Path(__file__).with_name('fix-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class L82(unittest.TestCase):
    def test_l82_fixed_window_refuses_early_or_short_collection(self):
        for now in ('2026-10-13T21:58:42Z', observer.END):
            with self.assertRaises(ValueError):
                observer.window(now)
        self.assertEqual(observer.window('2026-10-13T21:58:44Z'),
                         {'start': '2026-10-13T15:58:43Z', 'end': '2026-10-13T21:58:43Z'})


if __name__ == '__main__':
    unittest.main()
