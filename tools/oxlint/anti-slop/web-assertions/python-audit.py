"""Statically inventory every Python browser assertion; never import the tests."""
import ast
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
files = sorted(root.rglob('*.test.py'))
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
        identity = hashlib.sha256(json.dumps([assertion, dependencies], ensure_ascii=False).encode()).hexdigest()
        print(json.dumps(dict(file=str(file.relative_to(root)), line=node.lineno,
                              test=' > '.join(names) or '<module>', identity=identity,
                              kinds=['python-review'], assertion=assertion, dependencies=dependencies), ensure_ascii=False))
