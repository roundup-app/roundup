"""Statically inventory every Python browser assertion; never import the tests."""
import ast
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
from collections import Counter
from functools import cache

root = Path(sys.argv[1]).resolve()
files = []
for directory, children, names in os.walk(root):
    children[:] = [name for name in children if name not in {'node_modules', '.git', 'target', '.venv'}]
    files.extend(Path(directory) / name for name in names if name.endswith('.test.py'))
files.sort()
@cache
def segment(content, node):
    return ast.get_source_segment(content, node)


def audit(content, file):
    tree = ast.parse(content, filename=str(file))
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    # Follow assignments conservatively across scopes; ambiguous names need review.
    assignments = {}
    for assignment in ast.walk(tree):
        if not isinstance(assignment, (ast.Assign, ast.AnnAssign)):
            continue
        targets = assignment.targets if isinstance(assignment, ast.Assign) else [assignment.target]
        for target in targets:
            for name in ast.walk(target):
                if isinstance(name, ast.Name):
                    assignments.setdefault(name.id, []).append(assignment)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assert):
            continue
        names = []
        parent = parents.get(node)
        while parent is not None:
            if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                names.insert(0, parent.name)
            parent = parents.get(parent)
        pending = [name.id for name in ast.walk(node.test) if isinstance(name, ast.Name)]
        visited = set()
        dependencies = set()
        while pending:
            name = pending.pop()
            if name in visited:
                continue
            visited.add(name)
            for assignment in assignments.get(name, []):
                dependencies.add(segment(content, assignment))
                if assignment.value is not None:
                    pending.extend(child.id for child in ast.walk(assignment.value) if isinstance(child, ast.Name))
        dependencies = sorted(dependencies)
        assertion = segment(content, node)
        owner = parents.get(node)
        while owner is not None and not isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Module)):
            owner = parents.get(owner)
        # The enclosing function and AST path distinguish identical assertions without line allowances.
        path = []
        child = node
        while child is not owner:
            parent = parents[child]
            for field, value in ast.iter_fields(parent):
                if value is child:
                    path.insert(0, field)
                elif isinstance(value, list) and child in value:
                    path.insert(0, [field, value.index(child)])
            child = parent
        owner_source = content if isinstance(owner, ast.Module) else segment(content, owner)
        identity = hashlib.sha256(json.dumps([assertion, dependencies, owner_source, path], ensure_ascii=False).encode()).hexdigest()
        scripts = []
        for dependency in [node, *[assignment for values in assignments.values() for assignment in values if segment(content, assignment) in dependencies]]:
            for call in ast.walk(dependency):
                if not isinstance(call, ast.Call):
                    continue
                name = call.func.id if isinstance(call.func, ast.Name) else call.func.attr if isinstance(call.func, ast.Attribute) else None
                if name not in {'evaluate', 'read', 'browser', 'eval'}:
                    continue
                for argument in call.args:
                    if isinstance(argument, ast.Constant) and isinstance(argument.value, str) and argument.value not in {'eval', '--json'}:
                        scripts.append(argument.value)
                    if isinstance(argument, ast.Name):
                        for assignment in assignments.get(argument.id, []):
                            if isinstance(assignment.value, ast.Constant) and isinstance(assignment.value.value, str):
                                scripts.append(assignment.value.value)
        def wording(value, seen=frozenset()):
            if isinstance(value, ast.Constant):
                return isinstance(value.value, str) and bool(value.value)
            if isinstance(value, (ast.List, ast.Tuple, ast.Set)):
                return any(wording(item, seen) for item in value.elts)
            if isinstance(value, ast.Dict):
                return any(wording(item, seen) for item in value.values)
            if isinstance(value, ast.Name) and value.id not in seen:
                for call in ast.walk(tree):
                    if not isinstance(call, ast.Call):
                        continue
                    method = call.func.attr if isinstance(call.func, ast.Attribute) else call.func.id if isinstance(call.func, ast.Name) else None
                    if method in {'input', 'change', 'type', 'fill', 'write', 'setValue', 'paste', 'rpc'} and any(isinstance(part, ast.Name) and part.id == value.id for argument in call.args for part in ast.walk(argument)):
                        return False
                return any(wording(assignment.value, seen | {value.id}) for assignment in assignments.get(value.id, []))
            return False

        literal_comparison = any(isinstance(part, ast.Compare) and any(wording(value) for value in [part.left, *part.comparators]) for part in ast.walk(node.test))
        for part in ast.walk(node.test):
            if not isinstance(part, ast.Call) or not part.args:
                continue
            method = part.func.attr if isinstance(part.func, ast.Attribute) else part.func.id if isinstance(part.func, ast.Name) else None
            pattern = part.args[0].value if isinstance(part.args[0], ast.Constant) else None
            if isinstance(pattern, str) and (method == 'fullmatch' or method in {'match', 'search'} and pattern.startswith('^') and pattern.endswith('$')):
                literal_comparison = True
        yield dict(file=str(file.relative_to(root)), line=node.lineno,
                              test=' > '.join(names) or '<module>', identity=identity,
                              kinds=['python-review'], assertion=assertion, dependencies=dependencies, scripts=sorted(set(scripts)), literalComparison=literal_comparison,
                   match=(assertion, dependencies, names), node=node, tree=tree)


# Reuse only an exact, unambiguous base assertion. Legacy identity bytes and
# baseline permissions stay intact; unrelated statements are not permissions.
base = subprocess.run(['git', 'merge-base', 'HEAD', 'origin/main'], cwd=root,
                      text=True, capture_output=True, timeout=30)
revision = base.stdout.strip()
if base.returncode == 0:
    source_record = subprocess.run(
        ['git', 'show', revision + ':tools/oxlint/anti-slop/web-assertions/baseline-source.json'],
        cwd=root, text=True, capture_output=True, timeout=30)
    if source_record.returncode == 0:
        revision = json.loads(source_record.stdout)['sourceRevision']
        available = subprocess.run(['git', 'cat-file', '-e', revision + '^{commit}'],
                                   cwd=root, text=True, capture_output=True, timeout=30)
        if available.returncode != 0:
            raise RuntimeError('Cannot read the recorded Python assertion source: ' + available.stderr)
for file in files:
    content = file.read_text()
    rows = list(audit(content, file))
    original = None
    if base.returncode == 0:
        result = subprocess.run(['git', 'show', revision + ':' + str(file.relative_to(root))],
                                cwd=root, text=True, capture_output=True, timeout=30)
        if result.returncode == 0:
            original = result.stdout
    previous = list(audit(original, file)) if original is not None else []
    current_counts = Counter(json.dumps(row['match']) for row in rows)
    previous_counts = Counter(json.dumps(row['match']) for row in previous)
    for row in rows:
        key = json.dumps(row['match'])
        candidates = [old for old in previous if old['match'] == row['match']]
        if current_counts[key] == previous_counts[key] == 1 and content != original:
            old = candidates[0]
            # Keep control flow and called helper definitions pinned too.
            contexts = []
            sides = []
            statement_counts = []
            for source, item in [(original, old), (content, row)]:
                node, tree = item['node'], item['tree']
                parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
                ancestors = []
                child = node
                parent = parents.get(node)
                branches = []
                while parent is not None:
                    branches.append(next(field for field, value in ast.iter_fields(parent)
                                         if value is child or isinstance(value, list) and child in value))
                    ancestors.append(parent)
                    child = parent
                    parent = parents.get(parent)
                headers = []
                for ancestor in ancestors:
                    headers.append([(field, ast.dump(value) if isinstance(value, ast.AST) else value)
                                    for field, value in ast.iter_fields(ancestor)
                                    if field not in {'body', 'orelse', 'finalbody', 'handlers'}])
                definitions = {part.name: part for part in ast.walk(tree)
                               if isinstance(part, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
                pending = [part.id for part in ast.walk(node) if isinstance(part, ast.Name)]
                for dependency in item['dependencies']:
                    pending.extend(part.id for part in ast.walk(ast.parse(dependency.strip())) if isinstance(part, ast.Name))
                helpers = {}
                while pending:
                    name = pending.pop()
                    if name in helpers or name not in definitions:
                        continue
                    definition = definitions[name]
                    helpers[name] = segment(source, definition)
                    pending.extend(part.id for part in ast.walk(definition) if isinstance(part, ast.Name))
                contexts.append((branches, headers, helpers))
                # A retained statement cannot cross the assertion. This catches
                # moves even when navigation insertions shift its AST index.
                before, after = set(), set()
                counts = Counter()
                for statement in ast.walk(tree):
                    if not isinstance(statement, ast.stmt) or statement is node or statement in ancestors:
                        continue
                    text = segment(source, statement)
                    counts[text] += 1
                    if statement.end_lineno < node.lineno:
                        before.add(text)
                    elif statement.lineno > node.end_lineno:
                        after.add(text)
                sides.append((before, after))
                statement_counts.append(counts)
            unique = {text for text, count in statement_counts[0].items()
                      if count == statement_counts[1][text] == 1}
            crossed = (sides[0][0] & sides[1][1] | sides[0][1] & sides[1][0]) & unique
            if contexts[0] == contexts[1] and not crossed:
                row['identity'] = old['identity']
            else:
                row['identity'] = hashlib.sha256((row['identity'] + content).encode()).hexdigest()
        elif candidates and content != original and current_counts[key] != previous_counts[key]:
            row['identity'] = hashlib.sha256((row['identity'] + content).encode()).hexdigest()
        for field in ['match', 'node', 'tree']:
            row.pop(field)
        print(json.dumps(row, ensure_ascii=False))
