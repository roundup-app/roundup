#!/usr/bin/env python3
"""L106: daily Retro observes GitHub through a fixed-window command."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('orders', ROOT / 'orders.py')
orders = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orders)


class Retro(unittest.TestCase):
    def test_l106_report_does_not_enter_work_queue(self):
        self.assertFalse(orders.work_issue({'user': {'login': 'saadshahd'}, 'body': '<!-- retro-report -->\nNumbers'}))

    def test_l106_report_title_alone_does_not_hide_work(self):
        self.assertTrue(orders.work_issue({'user': {'login': 'saadshahd'}, 'title': 'Retro 2026-10-12', 'body': 'Repair this'}))


if __name__ == '__main__':
    unittest.main()
