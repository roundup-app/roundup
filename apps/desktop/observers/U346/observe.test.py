#!/usr/bin/env python3
"""After cargo build -p rupd, run python3 apps/desktop/observers/U346/observe.test.py.

CLI doubles isolate browser/RPC/time; lifecycle cases also launch the real Daemon.
"""
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import tempfile
import unittest

OBSERVER = Path(__file__).with_name('observe.sh').resolve()
DAEMON = OBSERVER.parents[4] / 'target/debug/rupd'


class N7(unittest.TestCase):
    def observe(self, failure=False, real=False):
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
import json, os, pathlib, signal, subprocess, sys, time
folder = pathlib.Path(os.environ.get('ROUNDUP_DATA_DIR', os.environ['APP']))
folder.mkdir(parents=True, exist_ok=True)
child = subprocess.Popen([os.environ['REAL_RUPD'], *sys.argv[1:]]) if os.environ.get('REAL_RUPD') else None
if child is None: (folder / 'written').write_text('Daemon data')
pathlib.Path(os.environ['RECORD']).write_text(json.dumps({'data': str(folder), 'project': __import__('sys').argv[1], 'pid': os.getpid()}))
def stop(*_):
    if child is not None:
        child.wait(timeout=5)
        pathlib.Path(os.environ['PROJECT_DATA']).write_text(str(any(folder.glob('projects/*/*.db')) and 'rupd: stopping' in (pathlib.Path(sys.argv[1]) / 'rupd.log').read_text()))
    time.sleep(.15)
    pathlib.Path(os.environ['STOPPED']).write_text(str(folder.exists()))
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
if child is None: sys.stdin.buffer.read()
else: child.wait(timeout=12)
stop()
''',
                'target/debug/rup': '#!/bin/sh\nexit 0\n',
                'bin/pnpm': '#!/bin/bash\necho $$ > "$VITE_PID"\n[ "$FAIL" = 2 ] && exit 9\nexec /bin/sleep 3600\n',
                'bin/sleep': '''#!/usr/bin/env python3
import os, pathlib, sys, time
if os.environ.get('REAL_RUPD') and sys.argv[1] == '4':
    deadline = time.monotonic() + 5
    while not pathlib.Path(os.environ['RUPD_SOCKET']).exists():
        if time.monotonic() > deadline: raise SystemExit('Daemon socket did not appear')
        time.sleep(.02)
else: time.sleep(.02)
''',
                'bin/curl': '''#!/bin/bash
case "$*" in
 *agent.spawn*) echo '{"id":"agent"}' ;;
esac
''',
                'bin/agent-browser': '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
assert not any(os.environ.get(key) for key in ('AGENT_BROWSER_HEADED', 'AGENT_BROWSER_AUTO_CONNECT', 'AGENT_BROWSER_PROFILE'))
assert json.loads(pathlib.Path(args[args.index('--config') + 1]).read_text())['headed'] is False
with open(os.environ['BROWSER'], 'a') as out: out.write(json.dumps(args) + '\\n')
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
                       AGENT_BROWSER_HEADED='true', AGENT_BROWSER_AUTO_CONNECT='true',
                       AGENT_BROWSER_PROFILE=str(app),
                       RECORD=str(root / 'record'), STOPPED=str(root / 'stopped'), VITE_PID=str(root / 'vite-pid'),
                       BROWSER=str(root / 'browser'), FAIL=str(int(failure)),
                       REAL_RUPD=str(DAEMON) if real else '', PROJECT_DATA=str(root / 'project-data'))
            process = subprocess.Popen(['bash', 'observe.sh'], cwd=root, env=env,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, start_new_session=True)
            try:
                stdout, stderr = process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                # A broken observer must not leave this test's launches behind.
                for name in ('record', 'vite-pid'):
                    path = root / name
                    if path.exists():
                        pid = json.loads(path.read_text())['pid'] if name == 'record' else int(path.read_text())
                        try:
                            os.killpg(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                raise
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            run = subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
            record = json.loads((root / 'record').read_text())
            data = Path(record['data'])
            after = [(str(p.relative_to(app)), p.read_bytes() if p.is_file() else None)
                     for p in sorted(app.rglob('*'))]
            calls = [json.loads(line) for line in (root / 'browser').read_text().splitlines()] if (root / 'browser').exists() else []
            self.assertFalse(Path(record['project']).exists(), 'Remove the whole run folder')
            with self.assertRaises(ProcessLookupError):
                os.kill(int((root / 'vite-pid').read_text()), 0)
            if real:
                self.assertEqual((root / 'project-data').read_text(), 'True',
                                 'Real Daemon must create Project data and stop through attached stdin: ' + run.stderr)
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
        for real, failure in ((False, False), (False, True), (False, 2), (True, False), (True, True), (True, 2)):
            with self.subTest(real=real, failure=failure):
                run, record, before, after, stopped, exists, calls = self.observe(failure, real)
                self.assertEqual(run.returncode, 1 if failure == 2 else 7 if failure else 0, run.stderr)
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
