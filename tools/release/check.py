"""C9b/C9c: check uncompressed release artifacts, failing closed on invalid inputs."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys


def regular_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"{path}: expected a regular file, not a symlink or special file")
    # stat alone succeeds for unreadable files. Opening verifies the artifact is usable.
    with path.open("rb"):
        pass
    return info.st_size


def dist_size(path):
    if not stat.S_ISDIR(path.lstat().st_mode):
        raise ValueError(f"{path}: expected a directory, not a symlink or file")
    total = 0
    files = 0
    with os.scandir(path) as entries:
        for entry in entries:
            child = Path(entry.path)
            if entry.is_dir(follow_symlinks=False):
                size, count = dist_size(child)
                total += size
                files += count
            else:
                total += regular_file(child)
                files += 1
    return total, files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["binary", "dist"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        if args.kind == "binary":
            size = regular_file(args.path)
            files = 1
            if size == 0:
                raise ValueError(f"{args.path}: empty executable")
            cap = 15_000_000
        else:
            size, files = dist_size(args.path)
            if files == 0:
                raise ValueError(f"{args.path}: empty output")
            cap = 10_000_000
        print(json.dumps({"artifact": str(args.path), "bytes": size, "files": files,
                          "cap_exclusive": cap, "passed": size < cap}))
        return int(size >= cap)
    except (OSError, ValueError) as error:
        print(f"release observer: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
