#!/usr/bin/env python3
"""L121: allowlisted conversation/auto-memory archives; credentials never enter retention."""
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import sys
import tarfile
import tempfile

TREES = ('claude/projects', 'codex/sessions', 'codex/archived_sessions', 'project-memory')
MAX_BYTES = 2 * 1024**3


def allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        return False
    return any(name == tree or name.startswith(tree + '/') for tree in TREES) or bool(
        re.fullmatch(r'codex/(?:history\.jsonl|state_[0-9]+\.sqlite)', name))


def pack(root, archive):
    """Pack only vendor conversation state and project memory, with consistent SQLite backups."""
    root, archive = Path(root), Path(archive)
    with tempfile.TemporaryDirectory() as directory, tarfile.open(archive, 'w:gz') as out:
        for path in sorted(root.rglob('*')):
            name = path.relative_to(root).as_posix()
            if not allowed(name) or path.is_symlink() or not path.is_file():
                continue
            if any((root / parent).is_symlink() for parent in path.relative_to(root).parents):
                raise ValueError(f'memory source traverses a link: {name}')
            source = path
            if re.fullmatch(r'codex/state_[0-9]+\.sqlite', name):
                source = Path(directory) / path.name
                with sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10) as db, \
                        sqlite3.connect(source, timeout=10) as backup:
                    db.backup(backup)
            out.add(source, arcname=name, recursive=False)


def restore(archive, root):
    """Validate every member before extracting into a new, private directory."""
    root = Path(root)
    if root.exists() and any(root.iterdir()):
        raise ValueError(f'memory destination is not empty: {root}')
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        if sum(item.size for item in members) > MAX_BYTES:
            raise ValueError('memory archive exceeds 2 GiB')
        for item in members:
            if not allowed(item.name) or not (item.isfile() or item.isdir()):
                raise ValueError(f'unsafe memory archive member: {item.name}')
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        source.extractall(root, members=members, filter='data')


def merge(incoming, baseline, current, job):
    """Apply changed memory files; retain concurrent edits under conflicts/<job>/ instead of overwriting."""
    incoming, baseline, current = Path(incoming), Path(baseline), Path(current)
    conflicts = []
    names = {path.relative_to(root) for root in (incoming, baseline) for path in root.rglob('*') if path.is_file()}
    for name in sorted(names):
        source = incoming / name
        before, target = baseline / name, current / name
        original = before.read_bytes() if before.is_file() else None
        content = source.read_bytes() if source.is_file() else None
        if content == original:
            continue
        present = target.read_bytes() if target.is_file() else None
        if present not in (original, content):
            conflicts.append(name.as_posix())
            target = current / name.parts[0] / 'conflicts' / job / Path(*name.parts[1:])
            if content is None:
                target = target.with_name(target.name + '.deleted')
                content = b'deleted in the concurrent job\n'
        if content is None:
            target.unlink(missing_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        target.write_bytes(content)
    return conflicts


def seed(history, project, directory):
    """Combine this scope's conversation with the role's current project memory and retain a merge baseline."""
    directory = Path(directory)
    state = directory / 'seed'
    for path in (state, directory / 'baseline'):
        shutil.rmtree(path, ignore_errors=True)
    if history != '-':
        restore(history, state)
    state.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(state / 'project-memory', ignore_errors=True)
    project = Path(project)
    for target in (state / 'project-memory', directory / 'baseline'):
        shutil.copytree(project, target) if project.exists() else target.mkdir(parents=True)
    pack(state, directory / 'seed.tar.gz')


def publish(archive, baseline, project, directory, job):
    """Retain the complete job revision before publishing changed project memories."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(dir=directory) as staging:
        state = Path(staging) / 'state'
        restore(archive, state)
        conflicts = merge(state / 'project-memory', baseline, project, job)
    shutil.copyfile(archive, directory / f'{job}.tar.gz')
    # A failed publish must leave the previous pointer usable; the completed archive precedes the rename.
    pointer = directory / f'.latest-{job}'
    pointer.write_text(f'{job}.tar.gz')
    pointer.replace(directory / 'latest')
    print(json.dumps({'conflicts': conflicts}))


if __name__ == '__main__':
    command, *args = sys.argv[1:]
    {'pack': pack, 'restore': restore, 'seed': seed, 'publish': publish}[command](*args)
