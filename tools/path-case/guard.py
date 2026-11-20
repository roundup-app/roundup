#!/usr/bin/env python3
"""T7745a: no two tracked paths differ only by letter case, once an implicit module extension is dropped."""
from collections import defaultdict
import os
import subprocess
import sys

# Vite's default `resolve.extensions`, which apps/desktop/vite.config.ts leaves unset: `import "./X"` tries each on disk.
IMPLICIT_EXTENSIONS = {".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"}


def name(path):
    stem, extension = os.path.splitext(path)

    return stem if extension in IMPLICIT_EXTENSIONS else path


def clashes(paths):
    """The groups a case-insensitive file system or an extensionless import cannot tell apart."""
    groups = defaultdict(list)

    for path in paths:
        groups[name(path).lower()].append(path)

    return [
        sorted(group)
        for group in groups.values()
        if len({name(path) for path in group}) > 1
    ]


def main():
    listing = subprocess.check_output(["git", "ls-files", "-z"]).split(b"\0")
    found = clashes(os.fsdecode(path) for path in listing if path)

    for group in found:
        print(
            f"T7745a: {' and '.join(group)} differ only by letter case; macOS resolves one for the other",
            file=sys.stderr,
        )

    return int(bool(found))


if __name__ == "__main__":
    sys.exit(main())
