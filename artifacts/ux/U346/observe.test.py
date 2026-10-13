#!/usr/bin/env python3
"""Run with python3 artifacts/ux/U346/observe.test.py."""
import os
from pathlib import Path
import signal
import shutil
import subprocess
import tempfile
import unittest

OBSERVER = Path(__file__).with_name('observe.sh').resolve()


class N7(unittest.TestCase):
    def observe(self, failure=False):
        with tempfile.TemporaryDirectory(prefix='n7-u346-') as folder:
            root = Path(folder)
            app = root / 'home/.local/share/dev.roundup.app'
            app.mkdir(parents=True)
            (app / 'seed').write_bytes(b'unchanged\x00App data')
            before = [(str(p.relative_to(app)), p.read_bytes() if p.is_file() else None)
                      for p in sorted(app.rglob('*'))]
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            (root / 'target/debug').mkdir(parents=True)
            (root / 'artifacts/ux/U346').mkdir(parents=True)
            shutil.copy(OBSERVER, root / 'observe.sh')
            programs = {
                'target/debug/rupd': '''#!/usr/bin/env python3
import json, os, pathlib, signal, time
folder = pathlib.Path(os.environ.get('ROUNDUP_DATA_DIR', os.environ['APP']))
folder.mkdir(parents=True, exist_ok=True)
(folder / 'written').write_text('Daemon data')
pathlib.Path(os.environ['RECORD']).write_text(json.dumps({'data': str(folder), 'project': __import__('sys').argv[1], 'pid': os.getpid()}))
def stop(*_):
    time.sleep(.15)
    pathlib.Path(os.environ['STOPPED']).write_text(str(folder.exists()))
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
while True: time.sleep(.05)
''',
                'bin/pnpm': '#!/bin/bash\nexec /bin/sleep 3600\n',
                'bin/sleep': '#!/bin/bash\n/bin/sleep .02\n',
                'bin/curl': '''#!/bin/bash
case "$*" in
 *agent.spawn*) echo '{"id":"agent"}' ;;
 *pad.read*) case "$*" in *notes*) echo '{"owner":{"kind":"agent"}}';; *) echo '{"owner":{"kind":"user"}}';; esac ;;
esac
''',
                'bin/agent-browser': '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['BROWSER'], 'a') as out: out.write(json.dumps(args) + '\n')
if os.environ.get('FAIL') == '1' and 'open' in args: raise SystemExit(7)
if 'eval' in args:
    if 'getBoundingClientRect' in args[-1]: print(json.dumps('{"hit":true,"x":10,"y":10}'))
    else: print('true')
'''
            }
            for name, text in programs.items():
                path = root / name
                path.write_text(text)
                path.chmod(0o755)
            env = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}',
                       HOME=str(root / 'home'), XDG_DATA_HOME=str(root / 'home/.local/share'),
                       ROUNDUP_DATA_DIR=str(app), APP=str(app), TMPDIR=str(root),
                       RECORD=str(root / 'record'), STOPPED=str(root / 'stopped'),
                       BROWSER=str(root / 'browser'), FAIL=str(int(failure)))
            process = subprocess.Popen(['bash', 'observe.sh'], cwd=root, env=env,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=8)
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            run = subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
            import json
            record = json.loads((root / 'record').read_text())
            data = Path(record['data'])
            after = [(str(p.relative_to(app)), p.read_bytes() if p.is_file() else None)
                     for p in sorted(app.rglob('*'))]
            calls = [json.loads(line) for line in (root / 'browser').read_text().splitlines()]
            return run, record, before, after, (root / 'stopped').read_text() if (root / 'stopped').exists() else None, data.exists(), calls

    def test_n7_launch_sites_use_owned_data(self):
        run, record, before, after, stopped, exists, calls = self.observe()
        self.assertEqual(run.returncode, 0, run.stderr)
        data = Path(record['data'])
        self.assertTrue(data.is_absolute())
        self.assertTrue(data.is_relative_to(Path(record['project'])))
        self.assertNotEqual(data, Path(record['project']))
        self.assertEqual(before, after)
        opens = [call for call in calls if 'open' in call]
        self.assertEqual(len(opens), 6)
        for call in opens:
            self.assertIn('--profile', call)
            self.assertTrue(Path(call[call.index('--profile') + 1]).is_relative_to(Path(record['project'])))
            self.assertFalse({'--headed', '--auto-connect', '--cdp'} & set(call))
        sessions = {call[call.index('--session') + 1] for call in opens}
        closed = {call[call.index('--session') + 1] for call in calls if 'close' in call}
        self.assertEqual(sessions, closed)

    def test_n7_launch_sites_clean_on_success_and_failure(self):
        for failure in (False, True):
            with self.subTest(failure=failure):
                run, record, before, after, stopped, exists, calls = self.observe(failure)
                self.assertEqual(run.returncode, 7 if failure else 0, run.stderr)
                self.assertEqual(stopped, 'True', 'Daemon must exit while its data still exists')
                self.assertFalse(exists)
                self.assertEqual(before, after)
                with self.assertRaises(ProcessLookupError):
                    os.kill(record['pid'], 0)
                sessions = {call[call.index('--session') + 1] for call in calls if 'open' in call}
                closed = {call[call.index('--session') + 1] for call in calls if 'close' in call}
                self.assertEqual(sessions, closed)


if __name__ == '__main__':
    unittest.main()
