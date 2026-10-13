#!/usr/bin/env python3
"""L107: complete pinned Care evidence, ranked summary and bounded Work publication.

input fixes HEAD and a seven-day UTC window; publish rereads all exclusion/dedup
sources before any mutation. Exit 2: bad arguments/plan; 4: read/tool/write failure.
"""
import argparse
import ast
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

import orders
import retro

CATEGORIES = ('duplication', 'dead_code', 'clippy', 'reliability', 'main_failures',
              'timings', 'inventory', 'size_files', 'size_functions', 'fix_churn')
PARSERS = {'tree-sitter': '0.25.2', 'tree-sitter-typescript': '0.23.2', 'tree-sitter-rust': '0.24.2', 'tree-sitter-bash': '0.25.1'}
CLIPPY = ('clippy::pedantic', 'clippy::nursery', 'clippy::restriction')
MARKER = '<!-- care-repair '


class InvalidPlan(ValueError):
    pass


def reliability(records):
    failures = [r for r in records if r['status'] == 'failed']
    recoveries = []
    for failed in failures:
        passed = [r for r in records if r['status'] == 'passed' and
                  (r['file'], r['name'], r['sha']) == (failed['file'], failed['name'], failed['sha']) and
                  (r['run'] != failed['run'] or r['attempt'] > failed['attempt']) and r['at'] > failed['at']]
        if passed:
            recoveries.append({'failed': failed, 'passed': min(passed, key=lambda r: r['at'])})
    slowest = {}
    for row in records:
        if row['status'] not in ('passed', 'failed'):
            continue
        key = (row['file'], row['name'])
        if key not in slowest or row['seconds'] > slowest[key]['seconds']:
            slowest[key] = row
    return {'recoveries': recoveries, 'main_failures': [r for r in failures if r['branch'] == 'main'],
            'slowest': sorted(slowest.values(), key=lambda r: (-r['seconds'], r['name'], r['file']))[:20]}


def command(args, root, allowed=(0,)):
    result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=1800)
    if result.returncode not in allowed:
        raise RuntimeError(f'{shlex.join(args)} exited {result.returncode}: {result.stderr[-2000:]}')
    return result.stdout


def git(root, *args):
    return command(['git', *args], root).strip()


def walk(node):
    yield node
    for child in node.named_children:
        yield from walk(child)


def executable_text(node):
    if node.type in ('comment', 'line_comment', 'block_comment', 'string', 'string_literal',
                     'raw_string_literal', 'template_string', 'char_literal'):
        return ''
    if not node.children:
        return node.text.decode()
    return ''.join(executable_text(child) for child in node.children)


def python_assertion(node):
    calls = []
    for child in ast.walk(node):
        if isinstance(child, ast.Assert):
            return 'asserted'
        if isinstance(child, ast.Call):
            calls.append(child)
            if isinstance(child.func, ast.Attribute) and (
                    child.func.attr.startswith('assert') or child.func.attr in ('raises', 'fail')):
                return 'asserted'
    return 'inspection' if calls else 'none'


def scenario_id(value):
    match = re.fullmatch(r'([A-Za-z]+)([0-9]+)([a-z]?)', value, re.I)
    return match[1].upper() + match[2] + match[3].lower()


def source_inventory(root, paths):
    """Library ASTs retain assertion bodies; unresolved helper calls are inspection evidence."""
    from importlib.metadata import version
    from tree_sitter import Language, Parser
    import tree_sitter_typescript
    import tree_sitter_rust
    import tree_sitter_bash
    for name, expected in PARSERS.items():
        if version(name) != expected:
            raise RuntimeError(f'{name} must be {expected}')
    parsers = {'.ts': Parser(Language(tree_sitter_typescript.language_typescript())),
               '.tsx': Parser(Language(tree_sitter_typescript.language_tsx())),
               '.rs': Parser(Language(tree_sitter_rust.language())),
               '.sh': Parser(Language(tree_sitter_bash.language()))}
    scenarios, retired = {}, {}
    for path in paths:
        if path.startswith('scenarios/') and path.endswith('.md'):
            for number, line in enumerate((root / path).read_text().splitlines(), 1):
                heading = re.match(r'\*\*([A-Z]+\d+[a-z]?) ', line)
                if heading:
                    scenarios[heading[1]] = {'path': path, 'start': number, 'end': number}
                retirement = re.search(r'(?i)\bretired\s+(?:scenario\s+)?([A-Z]+\d+[a-z]?)\b', line)
                if retirement:
                    retired[scenario_id(retirement[1])] = {'path': path, 'start': number, 'end': number, 'text': line}
    files, functions, tests, helpers = [], [], [], {}
    for path in paths:
        extension = Path(path).suffix
        if extension not in (*parsers, '.py', '.sh'):
            continue
        text = (root / path).read_text()
        files.append({'path': path, 'start': 1, 'end': max(1, len(text.splitlines())), 'lines': len(text.splitlines())})
        if extension not in parsers:
            # Python AST is native; shell is conservatively listed for inspection, never labelled assertion-free.
            if extension == '.py':
                tree = ast.parse(text, filename=path)
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith('test_'):
                        body = ast.get_source_segment(text, node)
                        tests.append({'name': node.name, 'path': path, 'start': node.lineno,
                                      'end': node.end_lineno, 'body': body, 'assertion': python_assertion(node)})
            continue
        tree = parsers[extension].parse(text.encode())
        if tree.root_node.has_error:
            raise RuntimeError(f'library parser cannot inventory {path}')
        if extension == '.sh':
            if '.test.' in path:
                assertions = any(n.type == 'test_command' or (n.type == 'command' and
                    n.child_by_field_name('name') and n.child_by_field_name('name').text.decode() in ('test', 'assert', 'assert_eq'))
                    for n in walk(tree.root_node))
                tests.append({'name': path, 'path': path, 'start': 1, 'end': max(1, len(text.splitlines())),
                              'body': text, 'assertion': 'asserted' if assertions else 'inspection'})
            continue
        for node in walk(tree.root_node):
            if node.type in ('function_declaration', 'function_item', 'method_definition', 'arrow_function', 'function_expression'):
                name_node = node.child_by_field_name('name')
                name = name_node.text.decode() if name_node else '<anonymous>'
                if node.type == 'arrow_function' and node.parent.type == 'variable_declarator':
                    name = node.parent.child_by_field_name('name').text.decode()
                entry = {'path': path, 'start': node.start_point.row + 1, 'end': node.end_point.row + 1,
                         'name': name, 'body': node.text.decode(), 'code': executable_text(node.child_by_field_name('body') or node)}
                functions.append(entry)
                if name != '<anonymous>':
                    helpers.setdefault(name, []).append(entry)
                if extension == '.rs':
                    # Rust attributes are sibling AST nodes of the function item.
                    sibling = node.prev_named_sibling
                    attrs = []
                    while sibling and sibling.type == 'attribute_item':
                        attrs.append(sibling.text.decode())
                        sibling = sibling.prev_named_sibling
                    if any(re.search(r'#\[(?:tokio::)?test(?:\]|\()', a) for a in attrs):
                        tests.append({**entry, 'expected_error': any('should_panic' in a for a in attrs)})
            if extension in ('.ts', '.tsx') and node.type == 'call_expression':
                callee = node.child_by_field_name('function')
                if callee and re.match(r'^(?:it|test)(?:\.|$)', callee.text.decode()):
                    args = node.child_by_field_name('arguments')
                    callbacks = [n for n in args.named_children if n.type in ('arrow_function', 'function_expression')]
                    if callbacks:
                        name = args.named_children[0].text.decode().strip('"\'`')
                        tests.append({'name': name, 'path': path, 'start': node.start_point.row + 1,
                                      'end': node.end_point.row + 1, 'body': callbacks[-1].text.decode(),
                                      'code': executable_text(callbacks[-1]), 'expected_error': False})
    def asserts(body, seen):
        if re.search(r'\b(?:(?:debug_)?assert(?:_\w+)?!|assert(?:Strict)?(?:Equal|DeepEqual)?\s*\(|expect(?:TypeOf)?\s*\(|panic!|\.unwrap_err\s*\()', body):
            return 'asserted'
        calls = re.findall(r'\b([A-Za-z_]\w*)\s*\(', body)
        unknown = False
        for name in calls:
            if name in ('fn', 'if', 'while', 'for', 'match') or name in seen:
                continue
            definitions = helpers.get(name, [])
            if len(definitions) != 1:
                unknown = True
                continue
            result = asserts(definitions[0]['code'], seen | {name})
            if result == 'asserted':
                return result
            unknown |= result == 'inspection'
        return 'inspection' if unknown else 'none'
    inventory = []
    for test in tests:
        test.pop('node', None)
        ids = sorted(set(scenario_id(i) for i in re.findall(r'(?i)\b([a-z]+\d+[a-z]?)(?=\b|_)', test['name'] + '\n' + test['body'])))
        test['scenario_ids'] = ids
        test['assertion'] = test.get('assertion') or ('asserted' if test['expected_error'] else asserts(test['code'], {test['name']}))
        test['categories'] = ([] if ids else ['no_scenario']) + (['no_assertion'] if test['assertion'] == 'none' else [])
        test['retirement'] = {i: retired[i] for i in ids if i in retired}
        test['unresolved'] = [i for i in ids if i not in scenarios and i not in retired]
        if test['retirement']:
            test['categories'].append('retired_scenario')
        if test['unresolved']:
            test['categories'].append('unresolved_scenario')
        if test['assertion'] == 'inspection':
            test['categories'].append('helper_inspection')
        inventory.append(test)
    return {'scenarios': scenarios, 'retired': retired, 'tests': inventory,
            'largest_files': sorted(files, key=lambda r: (-r['lines'], r['path'], r['start']))[:20],
            'largest_functions': sorted(functions, key=lambda r: (-(r['end'] - r['start'] + 1), r['path'], r['start']))[:20],
            'parser_versions': PARSERS}


def test_results(log, job, run):
    """Parse complete Vitest JSON or reconciled nextest rows; never infer passes from totals."""
    clean = re.sub(r'(?m)^\d{4}-\d\d-\d\dT\S+\s+', '', log)
    decoder = json.JSONDecoder()
    vitest = []
    for match in re.finditer(r'\{\s*"(?:numTotalTestSuites|numFailedTestSuites)"', clean):
        value, _ = decoder.raw_decode(clean[match.start():])
        vitest.append(value)
    base = {'sha': run['head_sha'], 'branch': run['head_branch'], 'run': run['id'],
            'attempt': job['run_attempt'], 'at': job['completed_at'], 'url': job['html_url'], 'job': job['id']}
    records = []
    for report in vitest:
        rows = [a for suite in report['testResults'] for a in suite['assertionResults']]
        if len(rows) != report['numTotalTests']:
            raise RuntimeError('incomplete Vitest records')
        for status, field in (('passed', 'numPassedTests'), ('failed', 'numFailedTests')):
            if sum(r['status'] == status for r in rows) != report[field]:
                raise RuntimeError('Vitest status counts do not reconcile')
        for suite in report['testResults']:
            path = suite['name']
            if '/apps/desktop/' in path:
                path = 'apps/desktop/' + path.split('/apps/desktop/', 1)[1]
            for row in suite['assertionResults']:
                status = row['status']
                seconds = row.get('duration')
                if status in ('passed', 'failed'):
                    if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0:
                        raise RuntimeError('test lacks observed duration')
                    seconds /= 1000
                records.append({**base, 'name': row['fullName'], 'file': path, 'status': status, 'seconds': seconds})
    rust = re.findall(r'(?m)^\s*(PASS|FAIL|TIMEOUT|LEAK|SKIP)\s+\[\s*([\d.]+)s\]\s+(?:\(\s*\d+/\d+\)\s+)?(\S+)\s+(.+?)\s*$', clean)
    summary = re.findall(r'Summary \[.*?\] (\d+) tests run: (\d+) passed[^\n]*', clean)
    if rust:
        executed = [r for r in rust if r[0] != 'SKIP']
        interrupted = job.get('conclusion') == 'cancelled'
        if not summary and not interrupted:
            raise RuntimeError('incomplete nextest records')
        if summary and (int(summary[-1][0]) != len(executed) or int(summary[-1][1]) != sum(r[0] == 'PASS' for r in executed)):
            raise RuntimeError('incomplete nextest records')
        for status, seconds, binary, name in rust:
            records.append({**base, 'name': name, 'file': binary, 'status': 'passed' if status == 'PASS' else
                            'pending' if status == 'SKIP' else 'failed', 'seconds': float(seconds)})
    if job['name'].split('/')[-1].strip() in ('web', 'linux', 'rust'):
        # Successful lanes must have all their expected runners; failures before tests have no test failure/timing.
        completed_test_steps = [s for s in job['steps'] if s.get('conclusion') == 'success' and
                                re.search(r'check(?:-web|-rust)?$', s['name'])]
        expected = job['name'].split('/')[-1].strip()
        if completed_test_steps and ((expected in ('web', 'linux') and not vitest) or
                                     (expected in ('rust', 'linux') and not summary)):
            raise RuntimeError(f'complete results missing for {job["html_url"]}')
        if re.search(r'Test Files\s+.*?\bpassed|FAIL\s+.*?test|Starting \d+ tests', clean) and not records:
            raise RuntimeError(f'test execution has no complete records: {job["html_url"]}')
    keys = [(r['file'], r['name']) for r in records]
    if len(keys) != len(set(keys)):
        raise RuntimeError('duplicate test identities in job')
    return records


def tool_evidence(root, raw_dir):
    """Tools are pinned or come from the pinned lockfile/toolchain; raw output is retained."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    clone_args = ['npm', 'exec', '--yes', '--package=jscpd@4.0.5', '--', 'jscpd',
                  '--format', 'typescript,rust', '--min-lines', '3', '--min-tokens', '25',
                  '--max-lines', '1000000', '--max-size', '100mb', '--reporters', 'json',
                  '--output', str(raw_dir), '--silent', '--pattern', '**/*.{ts,tsx,rs}',
                  '--ignore', '**/node_modules/**,**/target/**', '.']
    command(clone_args, root)
    clones = json.loads((raw_dir / 'jscpd-report.json').read_text())
    if not isinstance(clones.get('duplicates'), list) or not isinstance(clones.get('statistics'), dict):
        raise RuntimeError('malformed jscpd output')
    result['duplication'] = {'raw': clones, 'version': 'jscpd 4.0.5', 'invocation': clone_args,
                             'threshold': {'min_lines': 3, 'min_tokens': 25},
                             'ci_threshold': {'typescript': {'min_lines': 5, 'min_tokens': 50}, 'rust': 'none'}}
    args = ['pnpm', 'exec', 'fallow', 'dead-code', '--format', 'sarif', '--fail-on-issues', '--no-cache']
    # fallow documents exit 1 for --fail-on-issues; malformed output still fails closed.
    raw = command(args, root, (0, 1))
    (raw_dir / 'dead-code.sarif').write_text(raw)
    sarif = json.loads(raw)
    runs = sarif['runs']
    if len(runs) != 1 or not isinstance(runs[0]['results'], list):
        raise RuntimeError('malformed fallow SARIF')
    result['dead_code'] = {'raw': sarif, 'version': runs[0]['tool']['driver']['version'], 'invocation': args}
    # A successful baseline establishes the enforced set. Errors/crashes fail either invocation.
    baseline_args = ['cargo', 'clippy', '--all-targets', '--message-format=json', '--', '-D', 'warnings']
    baseline = command(baseline_args, root)
    args = ['cargo', 'clippy', '--all-targets', '--message-format=json', '--', '--cap-lints', 'warn']
    for group in CLIPPY:
        args += ['-W', group]
    args += ['-A', 'clippy::blanket_clippy_restriction_lints']
    raw = command(args, root)
    (raw_dir / 'clippy.jsonl').write_text(raw)
    messages = [json.loads(line) for line in raw.splitlines() if line.strip()]
    baseline_messages = [json.loads(line) for line in baseline.splitlines() if line.strip()]
    enforced = {r['message']['code']['code'] for r in baseline_messages
                if r.get('reason') == 'compiler-message' and r['message'].get('code')}
    if not any(r.get('reason') == 'build-finished' and r.get('success') is True for r in messages):
        raise RuntimeError('clippy lacks successful build-finished record')
    diagnostics = [r['message'] for r in messages if r.get('reason') == 'compiler-message' and
                   r['message'].get('code') and r['message']['code']['code'].startswith('clippy::') and
                   r['message']['code']['code'] not in enforced]
    result['clippy'] = {'raw': diagnostics, 'version': command(['cargo', 'clippy', '--version'], root).strip(),
                        'invocation': args, 'enforced_invocation': baseline_args, 'groups': CLIPPY}
    return result


def historical(github, end):
    start = end - timedelta(days=7)
    runs = retro.workflow_runs(github, start, end)
    # Include reruns of old checks that completed in-window. No created filter hides them.
    checks = github.read('actions/workflows/check.yml/runs?per_page=100', 'workflow_runs')
    checks = list({r['id']: r for r in checks + runs if Path(r['path']).stem == 'check' and
                   retro.timestamp(r['updated_at']) >= start and retro.timestamp(r['created_at']) < end}.values())
    records = []
    for run in checks:
        jobs = github.read(f'actions/runs/{run["id"]}/jobs?filter=all&per_page=100', 'jobs')
        for job in jobs:
            if (job['name'].split('/')[-1].strip() not in ('web', 'rust', 'linux') or
                    job['status'] != 'completed' or job['conclusion'] == 'skipped' or
                    not job['completed_at'] or not start <= retro.timestamp(job['completed_at']) < end):
                continue
            if type(job.get('run_attempt')) is not int or not re.fullmatch(r'[0-9a-f]{40}', run.get('head_sha', '')):
                raise RuntimeError('check results lack attempt/head')
            log = github.logs(job)
            if not log.strip():
                raise RuntimeError('inaccessible check log')
            records += test_results(log, job, run)
    churn = defaultdict(list)
    for run in runs:
        if Path(run['path']).stem not in ('fix', 'fix-branch'):
            continue
        jobs = github.read(f'actions/runs/{run["id"]}/jobs?filter=all&per_page=100', 'jobs')
        fixes = [j for j in jobs if re.search(r'fix #\d+ [a-f0-9]{40}', j['name']) and
                 j['status'] == 'completed' and j.get('conclusion') != 'skipped']
        for job in fixes:
            match = re.search(r'fix #(\d+) ([a-f0-9]{40})', job['name'])
            pr, before = int(match[1]), match[2]
            commits = github.read(f'pulls/{pr}/commits?per_page=100')
            authored = [c for c in commits if re.search(rf'(?m)^Author-Agent: builder-{run["id"]}$', c['commit']['message'])]
            if not authored:
                notes = github.read(f'issues/{pr}/comments?per_page=100')
                if any(f'Fix run {run["html_url"]}' in (n['body'] or '') and
                       ('pushed nothing' in n['body'] or 'counts as no attempt' in n['body']) for n in notes):
                    continue
                # A model skipped/failed before work is not a fix that changed files.
                model_steps = [s for s in job['steps'] if s['name'] == 'Run Codex' or 'claude-code-action' in s['name']]
                if model_steps and all(s.get('conclusion') in ('skipped', 'failure', 'cancelled') for s in model_steps):
                    continue
                raise RuntimeError(f'unknown fix change evidence: {run["html_url"]} PR #{pr}')
            after = authored[-1]['sha']
            # Paginated commit file reads avoid the compare endpoint's 300-file truncation.
            paths = set()
            for commit in authored:
                files = github.read(f'commits/{commit["sha"]}?per_page=100', 'files')
                if len(files) >= 3000:
                    raise RuntimeError('commit file listing may be truncated at GitHub limit')
                paths.update(f['filename'] for f in files)
            for path in paths:
                churn[path].append({'run': run['id'], 'url': run['html_url'], 'pr': pr,
                                    'before': before, 'after': after})
    return {'records': records, **reliability(records),
            'fix_churn': sorted([{'path': p, 'runs': list({r['run']: r for r in rows}.values()),
                                 'count': len({r['run'] for r in rows})} for p, rows in churn.items()],
                                key=lambda r: (-r['count'], r['path']))[:20]}


def open_paths(github):
    prs = github.read('pulls?state=open&per_page=100')
    paths = {}
    for pr in prs:
        files = github.read(f'pulls/{pr["number"]}/files?per_page=100')
        detail = github.object(f'pulls/{pr["number"]}') if 'changed_files' not in pr else pr
        if len(files) != detail['changed_files']:
            raise RuntimeError('truncated PR changed-file list')
        paths[pr['number']] = [f['filename'] for f in files]
    return paths


def evidence_rows(repo, sha, inventory, tools, history, end):
    rows = []
    checkout = f'git checkout --detach {sha}'
    def add(category, locations, observation, invocation, version, sources):
        paths = sorted(set(l['path'] for l in locations))
        identity = json.dumps([category, locations, observation], sort_keys=True)
        evidence_id = category + '-' + hashlib.sha256(identity.encode()).hexdigest()[:16]
        rows.append({'id': evidence_id, 'category': category, 'sha': sha, 'files': paths, 'locations': locations,
                     'observation': observation, 'tool_version': version, 'invocation': invocation,
                     'reproduce': checkout + ' && ' + invocation, 'sources': sources})
    def link(location):
        return f'https://github.com/{repo}/blob/{sha}/{location["path"]}#L{location["start"]}-L{location["end"]}'
    clone_command = list(tools['duplication']['invocation'])
    clone_command[clone_command.index('--output') + 1] = '/tmp/care-clones'
    for clone in tools['duplication']['raw']['duplicates']:
        locations = []
        for key in ('firstFile', 'secondFile'):
            source = clone[key]
            path = source['name'].removeprefix('./')
            locations.append({'path': path, 'start': source['start'], 'end': source['end']})
        add('duplication', locations, {'lines': clone['lines'], 'tokens': clone['tokens'],
            'language': clone['format'], 'threshold': tools['duplication']['threshold'],
            'ci_threshold': tools['duplication']['ci_threshold']},
            shlex.join(clone_command), tools['duplication']['version'], [link(l) for l in locations])
    for row in tools['dead_code']['raw']['runs'][0]['results']:
        locations = []
        for loc in row['locations']:
            item = loc['physicalLocation']
            region = item.get('region', {})
            locations.append({'path': item['artifactLocation']['uri'].removeprefix('./'),
                              'start': region.get('startLine', 1), 'end': region.get('endLine', region.get('startLine', 1))})
        add('dead_code', locations, {'rule': row['ruleId'], 'message': row['message']['text']},
            shlex.join(tools['dead_code']['invocation']), tools['dead_code']['version'], [link(l) for l in locations])
    for row in tools['clippy']['raw']:
        locations = []
        expanded = False
        for span in row['spans']:
            if not span['is_primary']:
                continue
            while Path(span['file_name']).is_absolute() and span.get('expansion'):
                span = span['expansion']['span']
                expanded = True
            path = Path(span['file_name'])
            if path.is_absolute():
                if not path.is_relative_to(Path.cwd()):
                    raise RuntimeError('clippy location cannot be traced to pinned source')
                path = path.relative_to(Path.cwd())
            locations.append({'path': str(path), 'start': span['line_start'], 'end': span['line_end']})
        if not locations:
            raise RuntimeError('clippy diagnostic lacks primary location')
        add('clippy', locations, {'lint': row['code']['code'], 'message': row['message'], 'enforced': False, 'macro_expansion': expanded},
            shlex.join(tools['clippy']['invocation']), tools['clippy']['version'], [link(l) for l in locations])
    scan = f'python3 loop/care.py --repo {shlex.quote(repo)} inspect --sha {sha}'
    for test in inventory['tests']:
        if test['categories']:
            loc = {k: test[k] for k in ('path', 'start', 'end')}
            add('inventory', [loc], test, scan, inventory['parser_versions'], [link(loc)])
    for key, category in (('largest_files', 'size_files'), ('largest_functions', 'size_functions')):
        for row in inventory[key]:
            loc = {k: row[k] for k in ('path', 'start', 'end')}
            add(category, [loc], row, scan, inventory['parser_versions'], [link(loc)])
    # Historical runner identities are located on the pinned tree, or explicitly unresolved.
    for key, category in (('recoveries', 'reliability'), ('main_failures', 'main_failures'), ('slowest', 'timings')):
        for row in history[key]:
            result = row['failed'] if key == 'recoveries' else row
            matching = [t for t in inventory['tests'] if t['name'] == result['name'].split('::')[-1] or
                        (t['path'] == result['file'] and t['name'] in result['name'])]
            locations = [{k: t[k] for k in ('path', 'start', 'end')} for t in matching]
            if not locations:
                raise RuntimeError(f'test identity cannot be located at pinned main: {result["name"]}')
            args = f'python3 loop/care.py --repo {repo} results {result["run"]} {result["attempt"]} {result["job"]}'
            sources = [result['url']]
            if key == 'recoveries':
                sources.append(row['passed']['url'])
                args += f' && python3 loop/care.py --repo {repo} results {row["passed"]["run"]} {row["passed"]["attempt"]} {row["passed"]["job"]}'
            add(category, locations, row, args, 'runner logs at immutable job id', sources)
    for row in history['fix_churn']:
        path = row['path']
        loc = {'path': path, 'start': 1, 'end': next((f['end'] for f in inventory['largest_files'] if f['path'] == path), 1)}
        args = f'python3 loop/care.py --repo {repo} history --end {retro.utc(end)}'
        add('fix_churn', [loc], row, args, 'GitHub Actions L82 commit trailers', [r['url'] for r in row['runs']])
    grouped = {}
    unique = {row['id']: row for row in rows}
    for row in sorted(unique.values(), key=lambda r: (r['category'], r['files'], json.dumps(r['locations'], sort_keys=True), r['id'])):
        if row['category'] not in ('duplication', 'clippy', 'dead_code', 'inventory'):
            grouped[row['id']] = row
            continue
        key = (row['category'], row['locations'][0]['path'])
        if key not in grouped:
            grouped[key] = {**row, 'observation': [], 'locations': [], 'sources': [], 'files': []}
        group = grouped[key]
        group['observation'].append(row['observation'])
        for field in ('locations', 'sources', 'files'):
            for value in row[field]:
                if value not in group[field]:
                    group[field].append(value)
    for row in grouped.values():
        identity = json.dumps([row['category'], row['locations'], row['observation']], sort_keys=True)
        row['id'] = row['category'] + '-' + hashlib.sha256(identity.encode()).hexdigest()[:16]
    return list(grouped.values())


def collect(github, end, root, raw_dir):
    branch = github.document('branches/main', ('commit',))
    sha = git(root, 'rev-parse', 'HEAD')
    if sha != branch['commit']['sha']:
        comparison = github.document(f'compare/{sha}...{branch["commit"]["sha"]}', ('status', 'base_commit'))
        if comparison['status'] != 'ahead' or comparison['base_commit']['sha'] != sha:
            raise RuntimeError('checkout is not a main ancestor')
    if git(root, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('Care must read an unmodified checkout of current main')
    paths = git(root, 'ls-files').splitlines()
    inventory = source_inventory(root, paths)
    tools = tool_evidence(root, raw_dir)
    history = historical(github, end)
    issues = github.read('issues?state=all&per_page=100')
    matches = retro.candidates(issues, end, loop_only=False)
    for issue in matches:
        issue['comments'] = github.read(f'issues/{issue["number"]}/comments?per_page=100')
    exclusions = open_paths(github)
    marker = f'{MARKER}{end.date()} -->'
    created = [i['html_url'] for i in issues if orders.work_issue(i) and (i.get('body') or '').startswith(marker)]
    findings = evidence_rows(github.repo, sha, inventory, tools, history, end)
    (raw_dir / 'history-results.json').write_text(json.dumps(history))
    tool_manifest = {category: {key: value for key, value in tool.items() if key != 'raw'}
                     for category, tool in tools.items()}
    history_manifest = {key: value for key, value in history.items() if key != 'records'}
    history_manifest['completed_record_count'] = len(history['records'])
    categories = {c: [r['id'] for r in findings if r['category'] == c] for c in CATEGORIES}
    return {'schema': 1, 'sha': sha, 'window': {'start': retro.utc(end - timedelta(days=7)), 'end': retro.utc(end),
            'interval': '[start, end)'}, 'findings': findings, 'categories': categories,
            'inventory': inventory, 'tools': tool_manifest, 'history': history_manifest, 'repair_candidates': matches,
            'open_pr_paths': exclusions, 'daily_created': created, 'daily_remaining': max(0, 3 - len(created)),
            'sources': github.reads}


def validate_input(data):
    if data.get('schema') != 1 or not re.fullmatch(r'[a-f0-9]{40}', data.get('sha', '')):
        raise RuntimeError('malformed Care input SHA/schema')
    end = retro.timestamp(data['window']['end'])
    if retro.timestamp(data['window']['start']) != end - timedelta(days=7) or data['window']['interval'] != '[start, end)':
        raise RuntimeError('malformed Care window')
    findings = data['findings']
    ids = [r['id'] for r in findings]
    if len(ids) != len(set(ids)) or set(data['categories']) != set(CATEGORIES):
        raise RuntimeError('malformed evidence inventory')
    for category in CATEGORIES:
        if data['categories'][category] != [r['id'] for r in findings if r['category'] == category]:
            raise RuntimeError('category inventory disagrees with evidence')
    for row in findings:
        if row['sha'] != data['sha'] or row['category'] not in CATEGORIES:
            raise RuntimeError('evidence is not pinned')
        for field in ('id', 'reproduce', 'invocation'):
            if not isinstance(row[field], str) or not row[field].strip():
                raise RuntimeError(f'evidence lacks {field}')
        if not row['tool_version'] or not row['sources'] or not row['locations']:
            raise RuntimeError('evidence lacks source/version/location')
        for loc in row['locations']:
            path = Path(loc['path'])
            if path.is_absolute() or '..' in path.parts or type(loc['start']) is not int or type(loc['end']) is not int or not 1 <= loc['start'] <= loc['end']:
                raise RuntimeError('invalid evidence location')
        if set(row['files']) != {l['path'] for l in row['locations']}:
            raise RuntimeError('evidence file set disagrees with locations')
    return end


def validate_plan(data, plan, issues, exclusions):
    """Validate the complete ranking and all orders before shared publication can mutate."""
    end = validate_input(data)
    findings = {r['id']: r for r in data['findings']}
    entries = plan.get('entries')
    if not isinstance(entries, list) or len(entries) != len(findings) or {r.get('id') for r in entries} != set(findings):
        raise InvalidPlan('rank every evidence id exactly once, without invention')
    allowed = {i['number']: i for i in retro.candidates(issues, end, loop_only=False)}
    blocked = {p for paths in exclusions.values() for p in paths}
    proposals = []
    tests = {(t['path'], t['name']): t for t in data['inventory']['tests']}
    for entry in entries:
        for field in ('cost', 'explanation', 'module'):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise InvalidPlan(f'ranked entry needs {field}')
        disposition = entry.get('disposition')
        if disposition not in ('new', 'match', 'excluded', 'deferred'):
            raise InvalidPlan('unknown disposition')
        row = findings[entry['id']]
        if disposition in ('deferred', 'excluded'):
            if disposition == 'excluded' and not blocked.intersection(row['files']):
                raise InvalidPlan('open-PR exclusion has no changed-file evidence')
            continue
        proposal = entry.get('proposal')
        if not isinstance(proposal, dict):
            raise InvalidPlan('new/match entry needs proposal')
        if disposition == 'match':
            if type(proposal.get('match')) is not int or proposal['match'] not in allowed or not proposal.get('evidence'):
                raise InvalidPlan('match is not an open/recent closed Work Issue')
            proposals.append(proposal)
            continue
        files = proposal.get('files')
        module = entry['module'].rstrip('/')
        if (not isinstance(files, list) or not files or len(files) != len(set(files)) or
                module in ('.', 'apps', 'crates', 'contracts', 'ext') or
                Path(module).is_absolute() or '..' in Path(module).parts or
                any(not p.startswith(module + '/') for p in files) or not set(files).issubset(row['files'])):
            raise InvalidPlan('order must name evidenced files inside one module directory')
        if blocked.intersection(files):
            # Publication sees PRs opened after collection too. Keep its rank, but never queue a conflicting repair.
            entry['disposition'] = 'excluded'
            entry['explanation'] += '; publication reread found open PR paths: ' + ', '.join(sorted(blocked.intersection(files)))
            continue
        body = proposal.get('body', '')
        observation = row['observation']
        main_failed = row['category'] == 'main_failures' or (row['category'] == 'reliability' and observation['failed']['branch'] == 'main')
        expected_priority = '2' if main_failed else '60'
        if orders.field(body, 'Priority') != expected_priority:
            raise InvalidPlan('Care priority must be 60, or 2 for an evidenced main failure')
        if (entry['id'] not in body or row['reproduce'] not in body or
                any(source not in body for source in row['sources']) or
                any(not re.search(rf'{re.escape(p)}(?::|#L)\d+', body) for p in files) or
                not re.search(rf'(?m)^Scope: {re.escape(module)}/\s*$', body) or
                not re.search(r'(?m)^Preserve: .+\S', body)):
            raise InvalidPlan('order needs exact evidence, links, lines, reproduction, invariant and module Scope')
        if not isinstance(proposal.get('removes_tests'), list):
            raise InvalidPlan('new orders must explicitly inventory test removals')
        for removal in proposal['removes_tests']:
            original = tests.get((removal['file'], removal['name']))
            if original is None:
                raise InvalidPlan('removed test is absent from pinned inventory')
            retired = original['retirement']
            if retired and set(original['scenario_ids']).issubset(retired):
                if any(evidence['text'] not in body for evidence in retired.values()):
                    raise InvalidPlan('test removal lacks explicit retirement evidence')
                continue
            replacement = tests.get((removal.get('replacement_file'), removal.get('replacement_name')))
            if (not replacement or replacement is original or replacement['assertion'] != 'asserted' or
                    not removal.get('clauses') or not removal.get('proof') or
                    replacement['name'] not in body or replacement['path'] not in body or
                    removal['proof'] not in body):
                raise InvalidPlan('test removal needs another assertion body and each same then-clause proof')
        proposals.append(proposal)
    if sum(not p.get('match') for p in proposals) > 3:
        raise InvalidPlan('at most three new Work Issues per plan')
    # Multiple findings may match one existing owner; comments preserve all their evidence.
    return proposals, allowed


def model_input(data, complete_path):
    """Lossless ids and script-counted costs, with full observations retained in the fixed artifact."""
    validate_input(data)
    rows = []
    for row in data['findings']:
        observations = row['observation']
        if isinstance(observations, list):
            cost = {'observations': len(observations)}
            if row['category'] == 'duplication':
                cost['duplicated_lines'] = sum(o['lines'] for o in observations)
            elif row['category'] == 'clippy':
                cost['lints'] = dict(Counter(o['lint'] for o in observations))
            elif row['category'] == 'inventory':
                cost['categories'] = dict(Counter(c for o in observations for c in o['categories']))
            observations = cost
        rows.append({k: row[k] for k in ('id', 'category', 'files', 'reproduce', 'tool_version')} |
                    {'observed': observations, 'complete_evidence_id': row['id']})
    return {k: data[k] for k in ('sha', 'window', 'categories', 'repair_candidates', 'open_pr_paths',
                               'daily_created', 'daily_remaining')} | {'findings': rows, 'complete_input': complete_path}


def summary(data, plan, repo):
    run_url = f'https://github.com/{repo}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "unknown")}'
    rows = [f'Care `{data["sha"]}` — {data["window"]["start"]} to {data["window"]["end"]} (end excluded).',
            f'[Input, raw evidence and plan artifacts]({run_url}#artifacts)', '',
            '| Rank | Evidence | Observed cost / estimate | Module | Disposition | Explanation |',
            '|---:|---|---|---|---|---|']
    for rank, entry in enumerate(plan['entries'], 1):
        values = [str(rank), entry['id'], entry['cost'], entry['module'], entry['disposition'], entry['explanation']]
        rows.append('| ' + ' | '.join(v.replace('|', '\\|').replace('\n', ' ') for v in values) + ' |')
    rows += ['', 'Categories: ' + ', '.join(f'{c}: {len(ids)}' for c, ids in data['categories'].items())]
    if plan.get('ask'):
        rows += ['', 'Product or spending choice (L79): ' + plan['ask']]
    return '\n'.join(rows) + '\n'


def publish(github, data, plan, completed):
    end = validate_input(data)
    # Fresh client is required; never serve collection's cached candidate/exclusion search.
    issues = github.read('issues?state=all&per_page=100')
    exclusions = open_paths(github)
    try:
        proposals, allowed = validate_plan(data, plan, issues, exclusions)
    except (ValueError, KeyError, TypeError) as error:
        raise InvalidPlan(str(error)) from error
    if plan.get('ask') and not proposals:
        raise InvalidPlan('an L79 ask needs a matched/new Work Issue owner')
    marker = f'{MARKER}{end.date()} -->'
    existing = [i for i in issues if orders.work_issue(i) and (i.get('body') or '').startswith(marker)]
    # A write may have completed just before a previous run lost its response. Reconcile by immutable Key.
    for proposal in proposals:
        if proposal.get('match'):
            continue
        prior = next((i for i in existing if orders.field(i['body'], 'Key') == orders.field(proposal['body'], 'Key')), None)
        if prior:
            proposal['match'] = prior['number']
            proposal['evidence'] = proposal['body']
            for entry in plan['entries']:
                if entry.get('proposal') is proposal:
                    entry['disposition'] = 'match'
    if len(existing) + sum(not p.get('match') for p in proposals) > 3:
        raise InvalidPlan('cumulative three-Issue UTC date cap')
    try:
        retro.validate_repairs(issues, proposals, set(allowed), marker, product=True)
    except (ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        raise InvalidPlan(str(error)) from error
    rendered = summary(data, plan, github.repo)
    # Actions limits summaries to 1 MiB per step; fail before any mutation rather than truncate findings.
    if len(rendered.encode()) > 1000000:
        raise InvalidPlan('complete ranked summary exceeds Actions limit; shorten explanations')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as handle:
            handle.write(rendered)
    print(rendered, file=sys.stderr)
    try:
        urls = retro.publish_repairs(github, proposals, marker, ['loop:work'], completed)
    finally:
        # A partial or unknown publication still has a durable local write journal, uploaded by the workflow.
        if os.environ.get('CARE_WRITES'):
            Path(os.environ['CARE_WRITES']).write_text(json.dumps({'completed': completed}, indent=2))
    if plan.get('ask'):
        # L79 needs a Work Issue owner. Only product/spending choices may populate this field.
        if not proposals:
            raise InvalidPlan('an L79 ask needs a matched/new Work Issue owner')
        owner = proposals[0].get('match') or int(urls[0].rsplit('/', 1)[1])
        github.write(f'issues/{owner}/comments', 'POST', body='<!-- needs-user -->\n' + plan['ask'])
        github.write(f'issues/{owner}/labels', 'POST', labels=[orders.NEEDS_USER])
    return {'completed': completed, 'new': urls}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    read = sub.add_parser('input')
    read.add_argument('--end')
    read.add_argument('--raw-dir', required=True)
    view = sub.add_parser('model-input')
    view.add_argument('input')
    post = sub.add_parser('publish')
    post.add_argument('input')
    post.add_argument('plan')
    inspect = sub.add_parser('inspect')
    inspect.add_argument('--sha', required=True)
    history = sub.add_parser('history')
    history.add_argument('--end', required=True)
    results = sub.add_parser('results')
    results.add_argument('run', type=int)
    results.add_argument('attempt', type=int)
    results.add_argument('job', type=int)
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
        parser.error('--repo must be owner/repository')
    try:
        end = retro.timestamp(args.end) if getattr(args, 'end', None) else datetime.now(timezone.utc).replace(microsecond=0)
    except ValueError as error:
        parser.error(str(error))
    try:
        github = retro.GitHub(args.repo)
        root = Path.cwd()
        if args.command == 'input':
            result = collect(github, end, root, Path(args.raw_dir))
            validate_input(result)
        elif args.command == 'model-input':
            result = model_input(json.loads(Path(args.input).read_text()), args.input)
        elif args.command == 'publish':
            data = json.loads(Path(args.input).read_text())
            try:
                plan = json.loads(Path(args.plan).read_text())
            except json.JSONDecodeError as error:
                raise InvalidPlan('malformed plan JSON') from error
            result = publish(github, data, plan, [])
        elif args.command == 'inspect':
            if git(root, 'rev-parse', 'HEAD') != args.sha:
                raise InvalidPlan('inspect requires checkout of --sha')
            result = source_inventory(root, git(root, 'ls-files').splitlines())
        elif args.command == 'history':
            result = historical(github, end)
        else:
            run = github.object(f'actions/runs/{args.run}/attempts/{args.attempt}')
            jobs = github.read(f'actions/runs/{args.run}/attempts/{args.attempt}/jobs?per_page=100', 'jobs')
            job = next((j for j in jobs if j['id'] == args.job), None)
            if not job:
                raise InvalidPlan('job is not in run attempt')
            result = test_results(github.logs(job), job, run)
        print(json.dumps(result, indent=2))
        return 0
    except InvalidPlan as error:
        print(f'Care invalid plan: {error}', file=sys.stderr)
        return 2
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError, ImportError) as error:
        print(f'Care failed: {error}', file=sys.stderr)
        return 4


if __name__ == '__main__':
    sys.exit(main())
