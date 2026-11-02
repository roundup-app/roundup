#!/usr/bin/env python3
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('builder', ROOT / 'loop/builder.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
import codex_login  # noqa: E402

LOGIN = json.dumps(dict(auth_mode='chatgpt', tokens=dict(access_token='access', refresh_token='refresh')))


class ApiKeyFallback(unittest.TestCase):
    def engine(self, worked, key='sk-test', only=''):
        """`builder.engine` with `codex` and `claude` replaced: the `codex` calls as (login, key), the `claude` call count,
        the environment the engines left and the exit code. `worked` answers each check of Codex's events in turn."""
        calls, claude = [], []
        env = dict(CODEX_AUTH=LOGIN, CODEX_API_KEY=key, CODEX_ONLY=only, RUNNER_TEMP='/tmp/none')
        with patch.dict(os.environ, env), patch.object(builder, 'switched', return_value=False), \
                patch.object(builder.image_tools, 'sync_index'), patch.object(builder, 'worked', side_effect=worked), \
                patch.object(builder, 'codex', side_effect=lambda login, *_, key='': calls.append((login, key)) or 0), \
                patch.object(builder, 'claude', side_effect=lambda *_: claude.append(1) or 0), \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = builder.engine('Build U1.', None, '/dev/null')
            left = {name: os.environ.get(name) for name in ('CODEX_AUTH', 'CODEX_API_KEY')}
        return calls, len(claude), left, code

    def test_l23_a_codex_run_that_did_no_work_runs_again_on_the_api_key_before_claude_code(self):
        calls, claude, left, code = self.engine([False, True])
        self.assertEqual(calls, [(LOGIN, ''), ('', 'sk-test')])
        self.assertEqual((claude, left, code), (0, dict(CODEX_AUTH=None, CODEX_API_KEY=None), 0))

    def test_l23_an_api_key_run_that_did_no_work_falls_back_to_claude_code_unless_codex_only(self):
        self.assertEqual(self.engine([False, False])[:2], ([(LOGIN, ''), ('', 'sk-test')], 1))
        calls, claude, _, code = self.engine([False, False], only='1')
        self.assertEqual((len(calls), claude, code), (2, 0, 1))

    def test_l23_without_the_api_key_codex_runs_once_as_before(self):
        self.assertEqual(self.engine([False], key='')[:2], ([(LOGIN, '')], 1))
        self.assertEqual(self.engine([True], key='')[:2], ([(LOGIN, '')], 0))
        self.assertEqual(self.engine([True])[:2], ([(LOGIN, '')], 0))

    def test_l23_the_api_key_signs_codex_in_through_its_environment_with_no_login_file(self):
        with tempfile.TemporaryDirectory() as path, redirect_stdout(io.StringIO()) as log:
            home = codex_login.home('', 'sk-test', Path(path, 'home'))
            self.assertFalse((home / 'auth.json').exists())
        self.assertEqual(log.getvalue(), '::add-mask::sk-test\n')
        self.assertEqual(codex_login.env('sk-test'), dict(CODEX_API_KEY='sk-test'))
        self.assertEqual(codex_login.env(''), {})


if __name__ == '__main__':
    unittest.main()
