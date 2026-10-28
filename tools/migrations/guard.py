"""B4522: audit migration names in local Git trees; never read SQL contents."""
import argparse
from collections import defaultdict
import os
import re
import subprocess
import sys

# Exact applied collisions only. A base tree cannot grant additional exceptions.
RECORDED = {
    (b"crates/rupd/migrations/project", 15): {b"0015-message-results.sql", b"0015-todo-change-actor.sql"},
    (b"crates/rupd/migrations/project", 20): {b"0020-continuations.sql", b"0020-todo-refs.sql"},
    (b"crates/rupd/migrations/project", 23): {b"0023-agent-finished.sql", b"0023-measurement-no-tokens-or-money.sql", b"0023-remove-decisions.sql"},
    (b"crates/rupd/migrations/project", 26): {b"0026-pad-deletions.sql", b"0026-todo-deletions.sql"},
    (b"crates/messages/migrations", 1): {b"001/up.sql", b"001-digest/up.sql"},
}


def git(*args):
    return subprocess.check_output(
        ["git", *args], stderr=subprocess.PIPE,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_OPTIONAL_LOCKS": "0"},
    )


def entries(revision):
    tree = git("rev-parse", "--verify", "--end-of-options", f"{revision}^{{tree}}").decode().strip()
    groups = defaultdict(set)
    for record in git("ls-tree", "-rz", "--full-tree", tree).split(b"\0"):
        if not record:
            continue
        header, path = record.split(b"\t", 1)
        if header.split()[1] != b"blob":
            continue
        parts = path.split(b"/")
        # Discover sets beneath every literal migrations component, including nested sets.
        if b"migrations" not in parts[:-1]:
            continue
        directory, name = path.rsplit(b"/", 1)
        if name == b"up.sql" and re.match(rb"^[0-9]+", parts[-2]):
            directory = b"/".join(parts[:-2])
            name = parts[-2] + b"/up.sql"
        elif not (name.endswith(b".sql") and re.match(rb"^[0-9]+", name)):
            continue
        groups[directory].add(name)
    return groups


def audit(before, after):
    errors = []
    for directory, names in sorted(after.items()):
        old = before.get(directory, set())
        maximum = max(old) if old else None
        for name in sorted(names - old):
            if maximum is not None and name <= maximum:
                errors.append(f"{os.fsdecode(directory)}: {os.fsdecode(name)} inserts at/before base maximum {os.fsdecode(maximum)}")
        prefixes = defaultdict(set)
        for name in names:
            prefixes[int(re.match(rb"^[0-9]+", name)[0])].add(name)
        for prefix, members in sorted(prefixes.items()):
            if len(members) > 1 and members != RECORDED.get((directory, prefix)):
                paths = ", ".join(os.fsdecode(directory + b"/" + n) for n in sorted(members))
                errors.append(f"prefix {prefix} conflicts: {paths}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="checked target-base tree, or empty for a full duplicate audit")
    parser.add_argument("head", nargs="?", default="HEAD")
    args = parser.parse_args()
    try:
        before = entries(args.base) if args.base else {}
        after = entries(args.head)
    except (OSError, subprocess.CalledProcessError) as error:
        detail = error.stderr.decode(errors="replace") if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"migration guard: unavailable base {args.base!r} or proposed tree {args.head!r}: {detail}", file=sys.stderr)
        return 2
    errors = audit(before, after)
    for error in errors:
        print(f"migration guard: {error}", file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    sys.exit(main())
