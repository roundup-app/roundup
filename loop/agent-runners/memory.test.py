#!/usr/bin/env python3
"""L121: retained state crosses jobs without credentials, unsafe paths or lost revisions."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import re
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('memory', Path(__file__).with_name('memory.py'))
memory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(memory)
sys.path.insert(0, str(Path(__file__).parent))
AGENT = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('agent.py'))
agent = importlib.util.module_from_spec(AGENT)
AGENT.loader.exec_module(agent)


class WebShards(unittest.TestCase):
    def test_l121_web_shards_do_not_run_boxd_controller_tests(self):
        result = subprocess.run(['pnpm', '-r', '--filter', '@roundup/agent-runners', '--if-present', 'test',
                                 '--shard=4/9', '--config', '/nonexistent/vitest-ci-config.mjs'],
                                cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('TAP version', result.stdout + result.stderr)
        self.assertNotIn('No projects matched', result.stdout + result.stderr)


class Identity(unittest.TestCase):
    def test_l121_each_admitted_label_kind_registers_the_job_that_carries_it(self):
        workflows = Path(__file__).resolve().parents[2] / '.github/workflows'
        runner = Path(__file__).with_name('runner.mjs').read_text()
        kinds = re.search(r'const LABEL = /\^roundup-\(([a-z|]+)\)-', runner)[1].split('|')
        light = re.findall(r'(\w+): \[', re.search(r'const LIGHT = \{(.*?)\};', runner, re.S)[1])
        check = re.findall(r"'([a-z]+)'", re.search(r'const CHECK = new Set\(\[(.*?)\]\)', runner)[1])
        jobs = [(agent.JOBS[kind], kind) for kind in kinds if kind not in ('light', 'check')]
        jobs += [(job, f'{kind}-{job}') for kind, scopes in [('light', light), ('check', check)] for job in scopes]
        for job, label in jobs:
            carrier = re.compile(rf'^  {job}:\n(?:    .*\n)*?    runs-on: .*roundup-{label}-', re.M)
            self.assertTrue(any(carrier.search(path.read_text()) for path in workflows.glob('*.yml')), label)
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                registration = root / 'registration.json'
                scope = label if '-' in label else f'{label}-11'
                registration.write_text(json.dumps({'repository': 'owner/repo', 'name': 'runner', 'token': 'token',
                                                     'label': f'roundup-{scope}-7-1-2'}))
                with patch.object(agent, 'Path', side_effect=lambda value: root if value == '/opt/roundup-ci' else Path(value)), \
                     patch.object(agent.subprocess, 'run'):
                    agent.register(registration)
                expected = root / 'job.json'
                identity = {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_RUN_ID': '7',
                            'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_JOB': job}
                self.assertEqual(json.loads(expected.read_text()), identity)
                with patch.dict(os.environ, identity):
                    agent.verify_job(expected)
                    for key in identity:
                        with patch.dict(os.environ, {key: 'foreign'}), self.assertRaises(SystemExit):
                            agent.verify_job(expected)

    def test_l121_each_job_a_run_holds_once_per_issue_labels_its_runner_with_that_issue(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/build-issue.yml').read_text()
        labels = [line for line in workflow.splitlines() if 'runs-on:' in line and '"boxd"' in line]
        self.assertGreater(len(labels), 1)
        for line in labels:
            self.assertIn('inputs.issue', line)


class Memory(unittest.TestCase):
    def test_l121_retained_codex_history_and_execution_evidence_use_the_same_home(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            program = root / 'codex'
            program.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
home = Path(os.environ['CODEX_HOME'])
assert (home / 'sessions/earlier.jsonl').read_text() == 'retained conversation'
assert 'memories = true' in (home / 'config.toml').read_text()
Path(sys.argv[sys.argv.index('--output-last-message') + 1]).write_text('{"verdict":"approve","findings":""}')
print(json.dumps({'type':'item.completed','item':{'type':'command_execution'}}))
''')
            program.chmod(0o700)
            sessions = root / 'memory/codex/sessions'
            sessions.mkdir(parents=True)
            (sessions / 'earlier.jsonl').write_text('retained conversation')
            env = {**os.environ, 'PATH': f'{root}:{os.environ["PATH"]}', 'CODEX_ONLY': '1', 'CLAUDE_API': '',
                   'CODEX_AUTH': json.dumps({'auth_mode': 'chatgpt', 'tokens': {'access_token': 'test-login'}}),
                   'ROUNDUP_AGENT_MEMORY': str(root / 'memory'), 'RUNNER_TEMP': str(root),
                   'GITHUB_OUTPUT': str(root / 'output')}
            result = subprocess.run([sys.executable, str(Path(__file__).parents[1] / 'builder.py'),
                                     'engine-read-only', '{"type":"object","properties":{}}'],
                                    input='test', text=True, capture_output=True, env=env, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_l121_history_and_project_memory_survive_without_logins(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            for name, content in {'claude/projects/repo/session.jsonl': 'conversation',
                                  'codex/sessions/session.jsonl': 'codex conversation',
                                  'project-memory/claude/MEMORY.md': 'use pnpm',
                                  'project-memory/codex/memory_summary.md': 'use just',
                                  'codex/auth.json': 'secret', 'claude/.credentials.json': 'secret',
                                  'codex/config.toml': 'configuration'}.items():
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            archive = root / 'state.tar.gz'
            memory.pack(source, archive)
            restored = root / 'restored'
            memory.restore(archive, restored)
            actual = {str(path.relative_to(restored)): path.read_text()
                      for path in restored.rglob('*') if path.is_file()}
            self.assertEqual(actual, {'claude/projects/repo/session.jsonl': 'conversation',
                                      'codex/sessions/session.jsonl': 'codex conversation',
                                      'project-memory/claude/MEMORY.md': 'use pnpm',
                                      'project-memory/codex/memory_summary.md': 'use just'})

    def test_l121_unsafe_archives_write_nothing(self):
        for name, kind, target in (('../escape', tarfile.REGTYPE, ''),
                                   ('codex/auth.json', tarfile.REGTYPE, ''),
                                   ('project-memory/link', tarfile.SYMTYPE, '/etc/passwd'),
                                   ('project-memory/hard', tarfile.LNKTYPE, '../escape')):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / 'state.tar.gz'
                with tarfile.open(archive, 'w:gz') as out:
                    item = tarfile.TarInfo(name)
                    item.type, item.linkname, item.size = kind, target, 1 if kind == tarfile.REGTYPE else 0
                    out.addfile(item, io.BytesIO(b'x') if item.size else None)
                with self.assertRaises(ValueError):
                    memory.restore(archive, root / 'restored')
                self.assertFalse((root / 'escape').exists())

    def test_l121_concurrent_project_memory_retains_both_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder, content in (('baseline', 'original'), ('current', 'first completion'),
                                    ('incoming', 'second completion')):
                path = root / folder / 'claude/MEMORY.md'
                path.parent.mkdir(parents=True)
                path.write_text(content)
            conflicts = memory.merge(root / 'incoming', root / 'baseline', root / 'current', '123')
            self.assertEqual(conflicts, ['claude/MEMORY.md'])
            self.assertEqual((root / 'current/claude/MEMORY.md').read_text(), 'first completion')
            self.assertEqual((root / 'current/claude/conflicts/123/MEMORY.md').read_text(), 'second completion')

    def test_l121_a_deleted_memory_is_removed_when_no_other_job_changed_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder in ('baseline', 'current'):
                path = root / folder / 'claude/retired.md'
                path.parent.mkdir(parents=True)
                path.write_text('retired note')
            memory.merge(root / 'incoming', root / 'baseline', root / 'current', '123')
            self.assertFalse((root / 'current/claude/retired.md').exists())


if __name__ == '__main__':
    unittest.main()
