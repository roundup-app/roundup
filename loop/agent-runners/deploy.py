#!/usr/bin/env python3
"""L121: install the controller and its signed GitHub webhook using the owner's existing CLI logins."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def run(*args, data=None, timeout=120):
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout, cwd=ROOT)
    if result.returncode:
        # Arguments, stdout and provider responses may contain the webhook secret. Keep failures out of public logs.
        raise SystemExit(f'{args[0]} failed with exit {result.returncode}; inspect the controller privately')
    return result.stdout


def deploy(controller, snapshot, ref):
    repository = json.loads(run('gh', 'repo', 'view', '--json', 'nameWithOwner'))['nameWithOwner']
    machines = json.loads(run('boxd', 'machine', 'list', '--json'))
    if not any(machine['name'] == controller for machine in machines):
        run('boxd', 'machine', 'new', controller, '--vcpu', '1', '--memory', '4G',
            '--auto-suspend-timeout', '0', '--auto-hibernate-timeout', '600', '--json')
    config_path = '/home/boxd/roundup-ci-config.json'
    previous = json.loads(run('boxd', 'machine', 'exec', controller, '--json', '--timeout', '30', '--',
        f"python3 -c 'from pathlib import Path; p=Path(\"{config_path}\"); print(p.read_text() if p.exists() else \"{{}}\")'"))
    config = {**json.loads(previous['output']), 'repository': repository, 'snapshot': snapshot, 'ref': ref,
              'directory': '/home/boxd/roundup-ci-state', 'maxRunners': 3, 'network': 'roundup-ci',
              'gh': '/usr/local/bin/gh', 'boxd': '/usr/local/bin/boxd'}
    config.setdefault('secret', secrets.token_hex(32))
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        bundle = directory / 'controller'
        run('pnpm', '--filter', '@roundup/agent-runners', 'deploy', '--prod', '--legacy', str(bundle), timeout=300)
        archive = directory / 'controller.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            out.add(bundle, arcname='.')
        run('boxd', 'machine', 'cp', str(archive), f'{controller}:/tmp/controller.tar.gz')
        run('boxd', 'machine', 'exec', controller, '--timeout', '60', '--',
            'mkdir -p /home/boxd/roundup-ci-controller /home/boxd/roundup-ci-state && '
            'chmod 700 /home/boxd/roundup-ci-state && '
            'touch /home/boxd/roundup-ci-state/controller.log && chmod 600 /home/boxd/roundup-ci-state/controller.log && '
            'tar -xzf /tmp/controller.tar.gz -C /home/boxd/roundup-ci-controller')
        config_file = directory / 'config.json'
        config_file.write_text(json.dumps(config))
        config_file.chmod(0o600)
        run('boxd', 'machine', 'cp', '--mode', '600', str(config_file), f'{controller}:{config_path}')
        unit = directory / 'roundup-ci.service'
        unit.write_text('''[Unit]
Description=roundup one-job boxd runners
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=boxd
WorkingDirectory=/home/boxd/roundup-ci-controller
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/node /home/boxd/roundup-ci-controller/runner.mjs /home/boxd/roundup-ci-config.json
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
StandardOutput=append:/home/boxd/roundup-ci-state/controller.log
StandardError=append:/home/boxd/roundup-ci-state/controller.log

[Install]
WantedBy=multi-user.target
''')
        run('boxd', 'machine', 'cp', str(unit), f'{controller}:/tmp/roundup-ci.service')
        run('boxd', 'machine', 'exec', controller, '--timeout', '60', '--',
            'sudo mv /tmp/roundup-ci.service /etc/systemd/system/roundup-ci.service && '
            'sudo systemctl daemon-reload && sudo systemctl enable roundup-ci.service && '
            'sudo systemctl restart roundup-ci.service')
    run('boxd', 'machine', 'config', 'set', controller, 'bot-protection', 'off')
    run('boxd', 'machine', 'networks', controller, config['network'], '--json')
    run('boxd', 'machine', 'proxy', 'set-port', '--vm', controller, '--port', '8000')
    hook_url = f'https://{controller}.boxd.sh/api/github/webhooks'
    hooks = json.loads(run('gh', 'api', f'repos/{repository}/hooks'))
    existing = next((hook for hook in hooks if hook['config']['url'] == hook_url), None)
    path = f'repos/{repository}/hooks' + (f'/{existing["id"]}' if existing else '')
    body = {'name': 'web', 'active': True, 'events': ['workflow_job'],
            'config': {'url': hook_url, 'content_type': 'json', 'secret': config['secret'], 'insecure_ssl': '0'}}
    result = json.loads(run('gh', 'api', path, '--method', 'PATCH' if existing else 'POST', '--input', '-',
                            data=json.dumps(body)))
    print(json.dumps({'controller': controller, 'webhook': result['id'], 'ref': ref, 'snapshot': snapshot}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controller', default='roundup-ci-control')
    parser.add_argument('--snapshot', default='roundup-ci')
    parser.add_argument('--ref', default='main')
    args = parser.parse_args()
    deploy(args.controller, args.snapshot, args.ref)
