#!/usr/bin/env python3
"""L112 source/input relocation audit, without requiring generated evidence."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class L112(unittest.TestCase):
    def test_l112_removed_files_have_no_test_readers(self):
        manifest = json.loads((ROOT / 'loop/evidence-paths.json').read_text())
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', manifest['revision'],
                                         'artifacts', 'crates/rpc/r16', 'crates/rupd/evidence'], cwd=ROOT, text=True).splitlines()
        self.assertEqual(len(paths), 4992)
        self.assertEqual(set(paths), set(manifest['files']))
        for old, row in manifest['files'].items():
            self.assertIn(row['kind'], ('observer', 'input', 'generated'))
            if row['kind'] != 'generated':
                target = ROOT / row['destination']
                self.assertTrue(target.is_file(), old)
                self.assertFalse(row['destination'].startswith(('artifacts/', 'crates/rpc/r16/', 'crates/rupd/evidence/')))
        self.assertEqual(sum(row['kind'] != 'generated' for row in manifest['files'].values()), 24)


if __name__ == '__main__':
    unittest.main()
