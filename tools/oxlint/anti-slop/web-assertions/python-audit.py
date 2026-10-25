"""Statically inventory every Python browser assertion; never import the tests."""
import ast
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
files = []
for directory, children, names in os.walk(root):
    children[:] = [name for name in children if name not in {'node_modules', '.git', 'target', '.venv'}]
    files.extend(Path(directory) / name for name in names if name.endswith('.test.py'))
files.sort()
for file in files:
    content = file.read_text()
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
        print(json.dumps(dict(file=str(file.relative_to(root)), line=node.lineno,
                              test=' > '.join(names) or '<module>', identity=identity,
                              kinds=['python-review'], assertion=assertion, dependencies=dependencies, scripts=sorted(set(scripts)), literalComparison=literal_comparison), ensure_ascii=False))
