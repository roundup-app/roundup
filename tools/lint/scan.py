"""Real-tool lint inventory and merge-base ratchet (T3797a)."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
DEBT = 'tools/lint/debt.json'
SECTIONS = {'web': ['size', 'ast', 'typos', 'ruff'], 'rust': ['dependencies']}


def run(args, root, statuses=(0,)):
    result = subprocess.run([str(a) for a in args], cwd=root, capture_output=True, text=True)
    if result.returncode not in statuses:
        raise RuntimeError(f'{args[0]} (exit {result.returncode}): {result.stderr or result.stdout}')
    return result


def binary(name):
    matches = list((HERE / '.tools').glob(f'*/{name}'))
    if len(matches) != 1:
        raise RuntimeError(f'{name}: run python3 tools/lint/setup.py {"rust" if name == "cargo-deny" else "web"}')
    return matches[0]


def tracked(root):
    return run(['git', 'ls-files', '-z'], root).stdout.rstrip('\0').split('\0')


def generated(root, path, data, attributes):
    # Same predicate as Check 3's generated(), using the checked tree, not staged changes.
    name = Path(path).name
    lock = re.search(r'\.lock($|b$|\.)|-lock\.', name) or name in ('npm-shrinkwrap.json', 'Package.resolved', 'go.sum')
    return ('/vendor/' in f'/{path}' or '/node_modules/' in f'/{path}' or lock
            or attributes.get(path, False) or b'\0' in data[:8000]
            or re.search(rb'@generated|Code generated .*DO NOT EDIT', b'\n'.join(data.split(b'\n')[:5])))


def attributes(root, paths):
    result = subprocess.run(['git', 'check-attr', '-z', '--stdin', 'linguist-generated', 'linguist-vendored'],
                            input='\0'.join(paths) + '\0', cwd=root, capture_output=True, text=True, check=True)
    fields = result.stdout.rstrip('\0').split('\0')
    result = {fields[i]: True for i in range(0, len(fields), 3) if fields[i + 2] in ('set', 'true')}
    empty = run(['git', 'hash-object', '-w', '-t', 'tree', '/dev/null'], root).stdout.strip()
    stats = run(['git', 'diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', empty, '--'], root).stdout
    for stat in stats.rstrip('\0').split('\0'):
        if stat.startswith('-\t-\t'):
            result[stat.split('\t', 2)[2]] = True
    return result


def occurrences(rows):
    seen = Counter()
    result = []
    for rule, path, source, detail, location in rows:
        key = (rule, path, source, detail)
        seen[key] += 1
        result.append({'rule': rule, 'path': path, 'source': source, 'detail': detail, 'occurrence': seen[key], 'location': location})
    return sorted(result, key=lambda row: json.dumps(row, sort_keys=True))


def inventory(section, root):
    print(f'lint: {section} ({dict(size="Git newline cap", ast="ast-grep 0.51.0", typos="typos 1.51.1", ruff="Ruff 0.17.2", dependencies="cargo-deny 0.20.2")[section]})', file=sys.stderr)
    paths = tracked(root)
    if section == 'size':
        attrs = attributes(root, paths)
        result = []
        for path in paths:
            file = root / path
            if not file.is_symlink() and not file.is_file():
                continue
            data = os.fsencode(os.readlink(file)) if file.is_symlink() else file.read_bytes()
            count = data.count(b'\n')
            if count > 1000 and not generated(root, path, data, attrs):
                result.append({'path': path, 'ceiling': count})
        return result
    if section == 'ast':
        properties = json.loads((HERE.parent.parent / 'node_modules/mdn-data/css/properties.json').read_text())
        names = list(properties)
        names += [re.sub(r'-([a-z])', lambda match: match[1].upper(), name) for name in properties]
        css = '(--[a-zA-Z_][a-zA-Z0-9_-]*|' + '|'.join(re.escape(name) for name in sorted(set(names))) + ')'
        rules = json.loads((HERE / 'rules.json').read_text())
        attrs = attributes(root, paths)
        rows = []
        for ext, language, ids in [('.rs', 'Rust', ['sleep-poll']), ('.ts', 'TypeScript', ['dom-clone', 'style-override']), ('.tsx', 'Tsx', ['dom-clone', 'style-override'])]:
            files = [p for p in paths if p.endswith(ext) and (root / p).is_file() and not generated(root, p, (root / p).read_bytes(), attrs)]
            if not files:
                continue
            config = '\n---\n'.join(json.dumps({'id': key, 'language': language, 'message': key, 'severity': 'error', 'rule': rules[key]}) for key in ids).replace('$CSS_PROPERTY', json.dumps(css)[1:-1])
            # Bound argv size without changing which tracked files are scanned.
            for start in range(0, len(files), 150):
                output = run([HERE.parent.parent / 'node_modules/.bin/ast-grep', 'scan', '--inline-rules', config, '--json=compact', '--no-ignore=hidden', '--no-ignore=vcs', '--', *files[start:start+150]], root, (0, 1))
                for match in json.loads(output.stdout):
                    rows.append((match['ruleId'], match['file'], match['text'], '', str(match['range']['start']['line'] + 1) + ':' + str(match['range']['start']['column'] + 1)))
        return occurrences(rows)
    if section == 'typos':
        output = run([binary('typos'), '--isolated', '--config', HERE / 'typos.toml', '--format', 'json', '.'], root, (0, 2))
        if output.stderr.strip():
            raise RuntimeError(f'typos: {output.stderr}')
        rows = []
        for line in output.stdout.splitlines():
            match = json.loads(line)
            if match['type'] == 'binary_file':
                continue
            if match['type'] != 'typo':
                raise RuntimeError(f'typos: {line}')
            path = match['path'].removeprefix('./')
            source = (root / path).read_text().splitlines()[match['line_num'] - 1] if 'line_num' in match else path
            rows.append(('typos', path, source, f'{match["byte_offset"]}:{match["typo"]}', str(match.get('line_num', 'filename')) + ':' + str(match['byte_offset'])))
        if output.returncode == 2 and not rows:
            raise RuntimeError(f'typos: {output.stderr or output.stdout}')
        return occurrences(rows)
    if section == 'ruff':
        output = run([binary('ruff'), 'check', 'loop', '--isolated', '--select', 'E4,E7,E9,F', '--output-format', 'json'], root, (0, 1))
        rows = []
        for match in json.loads(output.stdout):
            path = str(Path(match['filename']).relative_to(root))
            source = '\n'.join((root / path).read_text().splitlines()[match['location']['row'] - 1:match['end_location']['row']])
            rows.append((match['code'], path, source, f'{match["location"]["column"]}:{match["end_location"]["column"]}', str(match['location']['row']) + ':' + str(match['location']['column'])))
        return occurrences(rows)
    if section == 'dependencies':
        from dependencies import inventory as dependencies
        return dependencies(root, run, binary('cargo-deny'))
    raise ValueError(section)


def identity(row):
    return json.dumps({k: v for k, v in row.items() if k not in ('reason', 'ceiling', 'location')}, sort_keys=True)


def compare(actual, allowed, label, subset=False):
    errors = []
    permitted = {identity(row): row for row in allowed}
    observed = {identity(row): row for row in actual}
    if len(permitted) != len(allowed) or len(observed) != len(actual):
        raise ValueError(f'{label}: duplicate exception identity')
    for key, row in observed.items():
        if key not in permitted:
            errors.append(f'{label}: new exception/match {key}' + (f' measured {row["ceiling"]} newlines, ceiling 1000' if 'ceiling' in row else f' at {row.get("location", "graph")}'))
        elif row.get('ceiling', 0) > permitted[key].get('ceiling', 0):
            errors.append(f'{label}: raised size ceiling {row["path"]}: {row["ceiling"]} > {permitted[key]["ceiling"]}')
        elif not subset and row.get('ceiling') != permitted[key].get('ceiling'):
            errors.append(f'{label}: shrink ceiling to actual {row["path"]}: {row["ceiling"]}')
    if not subset:
        errors.extend(f'{label}: stale exception {key}' for key in permitted.keys() - observed.keys())
    return errors


def load(text):
    debt = json.loads(text)
    if set(debt) != {'size', 'ast', 'typos', 'ruff', 'dependencies'}:
        raise ValueError('baseline: expected all five inventories')
    for section, rows in debt.items():
        if not isinstance(rows, list) or any(not row.get('reason', '').strip() for row in rows):
            raise ValueError(f'baseline {section}: every exception needs a reason')
    return debt


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('section', choices=[*SECTIONS, 'size', 'ast', 'typos', 'ruff', 'dependencies'])
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--record', action='store_true', help='print current inventory; never authorizes an exception')
    args = parser.parse_args()
    root = args.root.resolve()
    sections = SECTIONS.get(args.section, [args.section])
    actual = {section: inventory(section, root) for section in sections}
    if args.record:
        print(json.dumps(actual, indent=2))
        return 0
    debt = load((root / DEBT).read_text())
    base = run(['git', 'merge-base', 'HEAD', args.base], root).stdout.strip()
    names = run(['git', 'ls-tree', '--name-only', base, DEBT], root).stdout.strip()
    errors = []
    if names:
        old = load(run(['git', 'show', f'{base}:{DEBT}'], root).stdout)
    else:
        # Bootstrap is proved by scanning the actual unchanged merge base, never by trusting a snapshot.
        with tempfile.TemporaryDirectory(prefix='lint-base-') as directory:
            checkout = Path(directory) / 'base'
            run(['git', 'worktree', 'add', '--detach', checkout, base], root)
            try:
                old = {section: inventory(section, checkout) for section in sections}
            finally:
                run(['git', 'worktree', 'remove', '--force', checkout], root)
    for section in sections:
        errors.extend(compare(debt[section], old[section], f'{section} merge-base', subset=True))
        errors.extend(compare(actual[section], debt[section], section))
        for row in debt[section]:
            print(f'baseline debt: {section} {json.dumps(row, ensure_ascii=False)}')
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'lint input/tool failure: {error}', file=sys.stderr)
        sys.exit(2)
