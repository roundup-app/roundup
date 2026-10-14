#!/usr/bin/env python3
"""N7: require a disposition for every launch reference and exercise CI's real launch."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = json.loads((ROOT / 'loop/launch-sites.json').read_text())


class LaunchSites(unittest.TestCase):
    def test_n7_launch_sites_use_owned_data(self):
        files = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
        candidates = set()
        for name in files:
            path = ROOT / name
            if name.startswith(('loop/', '.github/')) or path.suffix not in ('.rs', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.sh', '.bash'):
                continue
            if path.is_file() and re.search(r'rupd|Daemon::open|startRealDaemon', path.read_text()):
                candidates.add(name)
        self.assertLessEqual(candidates, INVENTORY.keys(), 'Unclassified launch reference; audit it before merging')
        for name, entry in INVENTORY.items():
            with self.subTest(site=name):
                self.assertTrue((ROOT / name).is_file())
                self.assertTrue(entry['data'])
                if 'sha256' in entry:
                    self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
                                     entry['sha256'], f'{name}: launch owner changed; audit it again')
                self.assertIn(entry['kind'], ('real', 'indirect', 'in-process', 'fake', 'serves',
                                              'fallback-unit', 'reference', 'workflow', 'guard-observer'))
                if entry['kind'] in ('real', 'indirect') and name != 'loop/ci-ping.sh':
                    self.assertIsInstance(entry['issue'], int, 'Unmet launch clause needs a scoped owner')
        self.assertEqual(INVENTORY['justfile']['kind'], 'serves')
        self.assertEqual(INVENTORY['crates/agents/tests/launch.rs']['kind'], 'fake')
        self.assertEqual(INVENTORY['crates/rup/tests/common/served.rs']['kind'], 'in-process')

    def test_n7_launch_sites_clean_on_success_and_failure(self):
        for name, entry in INVENTORY.items():
            self.assertTrue(entry['cleanup'], name)
        # The loop owns this launch. Other owners' unresolved clauses stay explicitly linked above.
        for fails in (False, True):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as folder:
                tmp = Path(folder)
                seed = tmp / 'seed/dev.roundup.app/keep'
                seed.parent.mkdir(parents=True)
                seed.write_bytes(b'keep')
                log = tmp / 'launch.json'
                wrapper = tmp / 'rupd'
                wrapper.write_text('#!/usr/bin/env python3\n'
                    'import json,os,sys\n'
                    f'open({str(log)!r},"w").write(json.dumps(dict(pid=os.getpid(),data=os.environ["ROUNDUP_DATA_DIR"],socket=os.environ["RUPD_SOCKET"])))\n'
                    f'os.execv({str(ROOT / "target/debug/rupd")!r},sys.argv)\n')
                wrapper.chmod(0o755)
                rup = ROOT / 'target/debug/rup'
                if fails:
                    rup = tmp / 'rup-failure'
                    rup.write_text('#!/bin/sh\nexit 17\n')
                    rup.chmod(0o755)
                result = subprocess.run(['python3', str(ROOT / 'loop/app-data.py'), 'bash',
                                         str(ROOT / 'loop/ci-ping.sh'), str(wrapper), str(rup)],
                                        cwd=ROOT, capture_output=True, text=True,
                                        env={**os.environ, 'ROUNDUP_DATA_DIR': str(seed.parent)})
                self.assertEqual(result.returncode == 0, not fails, result.stderr)
                launched = json.loads(log.read_text())
                data = Path(launched['data'])
                self.assertTrue(data.is_absolute())
                self.assertNotEqual(data, seed.parent)
                self.assertFalse(data.parent.exists(), 'Owned directory survived cleanup')
                with self.assertRaises(ProcessLookupError):
                    os.kill(launched['pid'], 0)
                self.assertEqual(seed.read_bytes(), b'keep')
                self.assertEqual(list(seed.parent.iterdir()), [seed])
                self.assertNotIn('App data written:', result.stdout)


if __name__ == '__main__':
    unittest.main()
