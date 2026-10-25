"""C9b/C9c: check uncompressed release artifacts, failing closed on invalid inputs."""
import argparse
import json
import os
import re
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


def module_name(identifier):
    # pnpm retains different Mermaid major versions, each with its own registrations.
    match = re.search(r"/mermaid@([^/]+)/node_modules/mermaid/(.*)", identifier)
    if match:
        return f"mermaid@{match[1]}/{match[2]}"
    return identifier.rsplit("/node_modules/", 1)[-1]


def check_modules(report, inventory, dist):
    data = json.loads(report.read_text())
    registered = json.loads(inventory.read_text())
    languages, diagrams = registered["languages"], registered["diagrams"]
    if not isinstance(languages, dict) or not languages or not isinstance(diagrams, dict) or not diagrams:
        raise ValueError("missing/incomplete language or diagram registrations")
    if any(not isinstance(value, int) or value < 0 for value in languages.values()) or any(
            not isinstance(kinds, list) or not kinds or any(not isinstance(kind, str) for kind in kinds)
            for kinds in diagrams.values()):
        raise ValueError("invalid language or diagram registrations")
    allowed = registered["modules"]
    if not isinstance(allowed, list) or not allowed or any(not isinstance(x, str) for x in allowed):
        raise ValueError("missing/incomplete module inventory")
    metas, parts = data["nodeMetas"], data["nodeParts"]
    if data["version"] != 2 or not metas or not parts:
        raise ValueError("missing/incomplete visualizer metadata")
    chunks, linked = set(), set()
    css_only = {}
    failures = []
    for uid, meta in metas.items():
        name = module_name(meta["id"])
        for chunk, part in meta["moduleParts"].items():
            if parts[part]["metaUid"] != uid or parts[part]["renderedLength"] < 0:
                raise ValueError(f"inconsistent module metadata: {name}")
            chunks.add(chunk)
            css_only[chunk] = css_only.get(chunk, True) and name.endswith(".css") and parts[part]["renderedLength"] == 0
            linked.add(part)
            implementation = (name.startswith(("mermaid@", "@shikijs/langs/", "@shikijs/engine-", "@pierre/highlights/"))
                              or "/highlighter/backends/shiki.js" in name)
            if implementation and name not in allowed:
                failures.append({"module": name, "chunk": chunk, "passed": False})
    actual = {p.relative_to(dist).as_posix() for p in dist.rglob("*.js")}
    # Vite removes empty JS facades for CSS imports after visualizer runs.
    retained = {chunk for chunk in chunks if not css_only[chunk]}
    if linked != set(parts) or not retained <= actual <= chunks or not actual:
        raise ValueError("incomplete module metadata: emitted JS and module chunks differ")
    for failure in failures:
        print(json.dumps(failure))
    if not failures:
        print(json.dumps({"modules": len(metas), "chunks": len(chunks), "passed": True}))
    return int(bool(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["binary", "dist", "modules"])
    parser.add_argument("path", type=Path)
    parser.add_argument("--inventory", type=Path)
    parser.add_argument("--dist", type=Path)
    args = parser.parse_args()
    try:
        if args.kind == "modules":
            if args.inventory is None or args.dist is None:
                raise ValueError("modules requires --inventory and --dist")
            dist_size(args.dist)
            return check_modules(args.path, args.inventory, args.dist)
        if args.kind == "binary":
            size = regular_file(args.path)
            files = 1
            if size == 0:
                raise ValueError(f"{args.path}: empty executable")
            cap = 15_000_000
        else:
            size, files = dist_size(args.path)
            if files == 0 or size == 0:
                raise ValueError(f"{args.path}: empty output")
            cap = 10_000_000
        print(json.dumps({"artifact": str(args.path), "bytes": size, "files": files,
                          "cap_exclusive": cap, "passed": size < cap}))
        return int(size >= cap)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"release observer: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
