#!/usr/bin/env python3
"""L107: Care collects complete evidence and publishes bounded Work Issues."""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import retro

spec = importlib.util.spec_from_file_location('retro_tests', Path(__file__).with_name('retro.test.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class Care(unittest.TestCase):
    def test_l107_care_and_retro_share_read_search_and_publication(self):
        product = fixtures.row(1, body='Repair code', labels=[])
        loop = fixtures.row(2, body='Repair loop', labels=[{'name': 'kind:loop'}])
        self.assertEqual([2], [i['number'] for i in retro.candidates([product, loop], fixtures.END)])
        self.assertEqual([1, 2], [i['number'] for i in retro.candidates([product, loop], fixtures.END, loop_only=False)])


if __name__ == '__main__':
    unittest.main()
