"""Statically inventory every Python browser assertion; never import the tests."""
import ast
import hashlib
import json
import os
from collections import Counter
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
files = []
for directory, children, names in os.walk(root):
    children[:] = [name for name in children if name not in {'node_modules', '.git', 'target', '.venv'}]
    files.extend(Path(directory) / name for name in names if name.endswith('.test.py'))
files.sort()


def inventory(content, filename, matching=False):
    tree = ast.parse(content, filename=filename)
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
                dependencies.add(ast.get_source_segment(content, assignment))
                if assignment.value is not None:
                    pending.extend(child.id for child in ast.walk(assignment.value) if isinstance(child, ast.Name))
        dependencies = sorted(dependencies)
        assertion = ast.get_source_segment(content, node)
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
        owner_source = content if isinstance(owner, ast.Module) else ast.get_source_segment(content, owner)
        identity = hashlib.sha256(json.dumps([assertion, dependencies, owner_source, path], ensure_ascii=False).encode()).hexdigest()
        context, extra_dependencies, anchors = [], [], {}
        if matching:
            # Matching metadata never replaces the permission hash. It proves which
            # exact historical assertion an unchanged current occurrence belongs to.
            context = []
            child = node
            while child is not tree:
                parent = parents[child]
                header = {field: ast.dump(value, include_attributes=False) if isinstance(value, ast.AST) else value
                          for field, value in ast.iter_fields(parent)
                          if field not in {'body', 'orelse', 'finalbody', 'handlers'} and not isinstance(value, list)}
                branch = next((field for field, value in ast.iter_fields(parent)
                               if isinstance(value, list) and child in value), None)
                context.insert(0, [type(parent).__name__, header, branch])
                child = parent
            # Include callable definitions and writes that the assignment-only legacy
            # inventory did not hash. An edited helper cannot reuse its caller's grant.
            extra_dependencies = set()
            pending = list(visited)
            seen = set()
            while pending:
                name = pending.pop()
                if name in seen:
                    continue
                seen.add(name)
                for part in ast.walk(tree):
                    relevant = isinstance(part, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and part.name == name
                    relevant = relevant or isinstance(part, (ast.Import, ast.ImportFrom)) and any(
                        (alias.asname or alias.name.split('.')[0]) == name for alias in part.names)
                    if isinstance(part, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
                        targets = part.targets if isinstance(part, ast.Assign) else [part.target]
                        relevant = relevant or any(isinstance(item, ast.Name) and item.id == name
                                                   for target in targets for item in ast.walk(target))
                    if isinstance(part, ast.Expr) and isinstance(part.value, ast.Call):
                        call = part.value
                        inputs = [*call.args, *[keyword.value for keyword in call.keywords]]
                        if isinstance(call.func, ast.Attribute):
                            inputs.append(call.func.value)
                        relevant = relevant or any(isinstance(item, ast.Name) and item.id == name
                                                   for value in inputs for item in ast.walk(value))
                    if relevant:
                        extra_dependencies.add(ast.get_source_segment(content, part))
                        pending.extend(item.id for item in ast.walk(part) if isinstance(item, ast.Name))
                        ancestor = parents.get(part)
                        while ancestor is not None:
                            # Branch/loop inputs select the observed assignment;
                            # hashing only its value would authorize a different observation.
                            for field in ('test', 'iter', 'target', 'items', 'type', 'subject', 'pattern', 'guard'):
                                value = getattr(ancestor, field, None)
                                for header in value if isinstance(value, list) else [value]:
                                    if isinstance(header, ast.AST):
                                        extra_dependencies.add(ast.dump(header, include_attributes=False))
                                        pending.extend(item.id for item in ast.walk(header) if isinstance(item, ast.Name))
                            ancestor = parents.get(ancestor)
            extra_dependencies = sorted(extra_dependencies)
            # Unchanged statements anchor the assertion on both sides. Insertions or
            # replacements elsewhere may shift lines; crossing an existing anchor is a move.
            anchors = {}
            for part in ast.walk(owner):
                if isinstance(part, ast.stmt) and not any(isinstance(item, ast.stmt) for item in ast.iter_child_nodes(part)):
                    text = ast.get_source_segment(content, part)
                    anchors.setdefault(text, []).append(-1 if part.lineno < node.lineno else 1 if part.lineno > node.lineno else 0)
        scripts = []
        for dependency in [node, *[assignment for values in assignments.values() for assignment in values if ast.get_source_segment(content, assignment) in dependencies]]:
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
        yield dict(file=filename, line=node.lineno,
                   test=' > '.join(names) or '<module>', identity=identity,
                   kinds=['python-review'], assertion=assertion, dependencies=dependencies,
                   scripts=sorted(set(scripts)), literalComparison=literal_comparison,
                   match=[assertion, dependencies, context, extra_dependencies], anchors=anchors)


def git(*args):
    return subprocess.run(['git', *args], cwd=root, text=True, capture_output=True)


baseline_file = 'tools/oxlint/anti-slop/web-assertions/baseline.jsonl'
baseline = [json.loads(line) for line in (root / baseline_file).read_text().splitlines() if line] if (root / baseline_file).exists() else []
base = git('merge-base', 'HEAD', 'origin/main') if baseline else None
history = None
for file in files:
    filename = str(file.relative_to(root))
    rows = list(inventory(file.read_text(), filename))
    entries = [entry for entry in baseline if entry['file'] == filename]
    unmatched = {entry['identity'] for entry in entries} - {row['identity'] for row in rows}
    if unmatched and base is not None and base.returncode == 0:
        rows = list(inventory(file.read_text(), filename, matching=True))
        if history is None:
            history = git('log', '--format=%H', base.stdout.strip(), '--', baseline_file).stdout.splitlines()
        counts = Counter(json.dumps([row['test'], row['match']], sort_keys=True) for row in rows)
        for revision in history:
            source = git('show', revision + ':' + filename)
            if source.returncode != 0:
                continue
            original = list(inventory(source.stdout, filename, matching=True))
            original_counts = Counter(json.dumps([row['test'], row['match']], sort_keys=True) for row in original)
            for old in original:
                if old['identity'] not in unmatched:
                    continue
                key = json.dumps([old['test'], old['match']], sort_keys=True)
                if counts[key] != 1 or original_counts[key] != 1:
                    continue
                current = next(row for row in rows if json.dumps([row['test'], row['match']], sort_keys=True) == key)
                shared = current['anchors'].keys() & old['anchors'].keys()
                if any(current['anchors'][text] != old['anchors'][text] for text in shared):
                    continue
                current['identity'] = old['identity']
                unmatched.remove(old['identity'])
            if not unmatched:
                break
    for row in rows:
        del row['match'], row['anchors']
        print(json.dumps(row, ensure_ascii=False))
