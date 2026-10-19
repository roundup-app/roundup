#!/usr/bin/env python3
"""L121: configure one ephemeral runner and fresh vendor processes, without controller credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import memory

RUNNER = Path('/opt/actions-runner')
STATE = Path('/home/boxd/.roundup-ci')


def register(path):
    """Consume a short-lived registration token; the registered identity accepts exactly one job."""
    path = Path(path)
    given = json.loads(path.read_text())
    try:
        subprocess.run(['./config.sh', '--url', f"https://github.com/{given['repository']}",
                        '--token', given['token'], '--name', given['name'], '--labels',
                        f"self-hosted,boxd,{given['label']}", '--no-default-labels', '--ephemeral',
                        '--disableupdate', '--unattended', '--work', '_work'], cwd=RUNNER,
                       check=True, timeout=90)
        _, kind, _, run, attempt = given['label'].split('-')
        expected = {'GITHUB_REPOSITORY': given['repository'], 'GITHUB_RUN_ID': run,
                    'GITHUB_RUN_ATTEMPT': attempt,
                    'GITHUB_JOB': {'build': 'build', 'fix': 'fix-run', 'smoke': 'smoke'}[kind]}
        (Path('/opt/roundup-ci') / 'job.json').write_text(json.dumps(expected))
    finally:
        path.unlink(missing_ok=True)


def seed(archive, job):
    """Installing the seed is atomic and repeatable after an unknown remote-command outcome."""
    marker = STATE / '.seed-job'
    if marker.is_file():
        if marker.read_text() != job:
            raise ValueError('the machine already belongs to a different job')
        return
    with tempfile.TemporaryDirectory(dir=STATE.parent) as directory:
        staging = Path(directory) / 'state'
        memory.restore(archive, staging)
        (staging / '.seed-job').write_text(job)
        staging.replace(STATE)


def start():
    """Enable retained auto-memory, then start the runner under a process lock."""
    for name in ('.codex/auth.json', '.claude/.credentials.json', '.config/gh/hosts.yml', '.local/share/opencode/auth.json'):
        Path('/home/boxd', name).unlink(missing_ok=True)
    claude = STATE / 'claude'
    claude.mkdir(parents=True, exist_ok=True, mode=0o700)
    for vendor in ('claude', 'codex'):
        (STATE / 'project-memory' / vendor).mkdir(parents=True, exist_ok=True, mode=0o700)
    (claude / 'settings.json').write_text(json.dumps({
        'autoMemoryEnabled': True, 'autoMemoryDirectory': str(STATE / 'project-memory/claude')}))
    codex = STATE / 'codex'
    codex.mkdir(exist_ok=True, mode=0o700)
    link = codex / 'memories'
    if not link.is_symlink():
        if link.exists():
            raise ValueError('Codex project memory must use its retained directory')
        link.symlink_to(STATE / 'project-memory/codex', target_is_directory=True)
    # The controller and integration credentials are absent from this isolated VM; GitHub injects only the job grants.
    env = {'PATH': '/home/boxd/.cargo/bin:/home/boxd/.local/bin:/usr/local/bin:/usr/bin:/bin',
           'ROUNDUP_AGENT_MEMORY': str(STATE),
           'CLAUDE_CONFIG_DIR': str(claude), 'CLAUDE_CODE_PROJECT_DIR_NAME': 'roundup',
           'CLAUDE_CODE_DISABLE_AUTO_MEMORY': '0', 'CARGO_TARGET_DIR': '/home/boxd/cargo-target',
           'ACTIONS_RUNNER_HOOK_JOB_STARTED': '/opt/roundup-ci/job-start.sh'}
    hook = Path('/opt/roundup-ci/job-start.sh')
    hook.write_text('#!/bin/sh\nexec /usr/bin/python3 /opt/roundup-ci/agent.py verify-job /opt/roundup-ci/job.json\n')
    hook.chmod(0o700)
    (RUNNER / '.env').write_text(''.join(f'{name}={value}\n' for name, value in env.items()))
    (RUNNER / '.path').write_text(env['PATH'])
    inherited = {key: os.environ[key] for key in ('HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR') if key in os.environ}
    with open(RUNNER / 'listener.log', 'ab') as log:
        subprocess.Popen(['flock', '-n', '/tmp/roundup-ci-runner.lock', './run.sh'], cwd=RUNNER,
                         env={**inherited, **env}, stdin=subprocess.DEVNULL, stdout=log,
                         stderr=subprocess.STDOUT, start_new_session=True)


def verify_job(path):
    """Reject an assignment from a different run/role before any workflow step can read retained state."""
    expected = json.loads(Path(path).read_text())
    if any(os.environ.get(name) != value for name, value in expected.items()):
        raise SystemExit('runner refused a job outside its registered repository, run, attempt or role')
    print('L121: registered job identity verified')


if __name__ == '__main__':
    command, *args = sys.argv[1:]
    {'register': register, 'seed': seed, 'start': start, 'verify-job': verify_job}[command](*args)
