import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('linux_observer', Path(__file__).with_name('linux-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class L84(unittest.TestCase):
    def test_l84_dispatch_requires_open_same_repository_exact_head(self):
        pr = {'state': 'open', 'head': {'sha': 'a'*40, 'ref': 'build/example', 'repo': {'full_name': 'owner/repo'}}}
        self.assertEqual('build/example', observer.admit(pr, 'owner/repo', 'a'*40))
        for changed in ({**pr, 'state': 'closed'}, {**pr, 'head': {**pr['head'], 'sha': 'b'*40}},
                        {**pr, 'head': {**pr['head'], 'repo': {'full_name': 'fork/repo'}}}):
            with self.assertRaises(ValueError):
                observer.admit(changed, 'owner/repo', 'a'*40)

    def test_l46_observer_has_no_model_or_gate_authority(self):
        source = Path('.github/workflows/linux-observer.yml').read_text()
        self.assertIn('actions: write', source)
        self.assertIn('ref: main', source)
        self.assertIn('persist-credentials: false', source)
        for forbidden in ('statuses: write', 'checks: write', 'contents: write', 'anthropics/', 'just ready', 'gh pr merge'):
            self.assertNotIn(forbidden, source)
