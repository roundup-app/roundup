#!/usr/bin/env python3
"""U453: the journey observer uses supported App window viewports."""
from pathlib import Path
import re
import unittest


class U453(unittest.TestCase):
    def test_u453_journey_observer_uses_supported_widths(self):
        journey = Path(__file__).with_name('journey.md').read_text()
        observer = next(line for line in journey.splitlines()
                        if 'Inspect the rendered App with `agent-browser`' in line)
        self.assertEqual(re.findall(r'(\d+)×(\d+)', observer),
                         [('1280', '800'), ('1440', '800')])


if __name__ == '__main__':
    unittest.main()
