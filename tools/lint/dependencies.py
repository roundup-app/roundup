"""Keep cargo-deny's complete graph diagnostics, with exact crate/version identities."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def chain(graph):
    crate = graph['Krate']
    parents = graph.get('parents', [])
    prefix = chain(parents[0]) + ' -> ' if parents else ''
    return prefix + f'{crate["name"]}@{crate["version"]}'


def inventory(root, run, executable):
    # No target filter: cargo-deny resolves all platforms and all optional features.
    # Do not use native skip/ignore: keeping raw diagnostics lets us detect stale debt too.
    output = run([executable, '--locked', '--format', 'json', '--config', HERE / 'deny.toml', 'check'], root, tuple(range(0, 16)))
    rows = []
    summary = False
    for line in (output.stdout + output.stderr).splitlines():
        message = json.loads(line)
        if message['type'] == 'summary':
            summary = True
            continue
        if message['type'] != 'diagnostic':
            if message.get('level') == 'ERROR':
                raise RuntimeError(f'cargo-deny: {line}')
            continue
        fields = message['fields']
        code = fields['code']
        if code == 'duplicate' or 'advisory' in fields:
            for graph in fields['graphs']:
                crate = graph['Krate']
                rows.append({'rule': 'duplicate' if code == 'duplicate' else fields['advisory']['id'],
                             'crate': crate['name'], 'version': crate['version'],
                             'reason': chain(graph)})
        elif fields['severity'] == 'error':
            if code in ('rejected', 'unlicensed'):
                for graph in fields['graphs']:
                    crate = graph['Krate']
                    rows.append({'rule': 'license', 'crate': crate['name'], 'version': crate['version'],
                                 'expression': ' '.join(label['span'] for label in fields['labels'])})
            else:
                raise RuntimeError(f'cargo-deny: {line}')
    if not summary:
        raise RuntimeError(f'cargo-deny: no complete check summary: {output.stderr}')
    return sorted(rows, key=lambda row: json.dumps(row, sort_keys=True))
