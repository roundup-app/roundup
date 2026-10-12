import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('branch_observer', Path(__file__).with_name('branch-observer.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class Observer(unittest.TestCase):
    def evidence(self):
        return {'requested_at': '2026-10-12T20:00:00Z',
                'build_started_at': '2026-10-12T19:00:00Z',
                'build_completed_at': '2026-10-12T20:01:00Z',
                'fix_started_at': '2026-10-12T20:01:01Z',
                'final_head': 'a' * 40, 'observed_head': 'a' * 40,
                'summary': 'Fix queued for branch `build/test`; it waits for any build or fix holding the branch.\n'
                           'Fix acquired branch `build/test`; task preparation waits for any build or fix holding it to end.\n'
                           'Skip fix: the build or another writer moved the head',
                'model_started': False, 'attempts_before': [], 'attempts_after': []}

    def test_l23_l82_live_exclusion_requires_order_head_and_no_attempt(self):
        observer.assert_evidence(self.evidence())
        for field, value in [('fix_started_at', '2026-10-12T20:00:30Z'),
                             ('requested_at', '2026-10-12T20:02:00Z'),
                             ('observed_head', 'b' * 40), ('model_started', True),
                             ('attempts_after', [1]), ('summary', '')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                observer.assert_evidence({**self.evidence(), field: value})


if __name__ == '__main__':
    unittest.main()
