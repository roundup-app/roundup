"""B4522: audit migration names in local Git trees; never read SQL contents."""
import argparse
import json
from collections import defaultdict
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

# Exact applied collisions only. A base tree cannot grant additional exceptions.
RECORDED = {
    (row["directory"].encode(), row["prefix"]): {name.encode() for name in row["members"]}
    for row in json.loads(Path(__file__).with_name("recorded.json").read_text())
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


def moved(before, prefix, members):
    """A recorded collision set moving whole to another directory is no new exception."""
    return any(
        members == RECORDED.get((directory, prefix)) and members <= names
        for directory, names in before.items()
    )


def audit(before, after):
    errors = []
    for directory, names in sorted(after.items()):
        old = before.get(directory, set())
        maximum = max(old, key=lambda n: n.removesuffix(b"/up.sql")) if old else None
        for name in sorted(names - old):
            if maximum is not None and name.removesuffix(b"/up.sql") <= maximum.removesuffix(b"/up.sql"):
                errors.append(f"{os.fsdecode(directory)}: {os.fsdecode(name)} inserts at/before base maximum {os.fsdecode(maximum)}")
        prefixes = defaultdict(set)
        for name in names:
            prefixes[int(re.match(rb"^[0-9]+", name)[0])].add(name)
        for prefix, members in sorted(prefixes.items()):
            if len(members) > 1 and members != RECORDED.get((directory, prefix)) and not moved(before, prefix, members):
                paths = ", ".join(os.fsdecode(directory + b"/" + n) for n in sorted(members))
                errors.append(f"prefix {prefix} conflicts: {paths}")
    return errors


def renames(before, after):
    """Plan only branch additions, retaining their bytewise order and filename width."""
    if any(not names <= after.get(d, set()) for d, names in before.items()):
        raise ValueError("merge/rebase the selected base first; base migrations are missing")
    moves = {}
    repaired = {d: set(names) for d, names in after.items()}
    for directory, names in sorted(after.items()):
        old = before.get(directory, set())
        if not audit({directory: old}, {directory: names}):
            continue
        prefixes = {n: re.match(rb"^[0-9]+", n)[0] for n in names}
        width = max(len(prefixes[n]) for n in old or names)
        number = max((int(prefixes[n]) for n in old), default=0)
        repaired[directory] = set(old)
        for name in sorted(names - old, key=lambda n: n.removesuffix(b"/up.sql")):
            number = max(number + 1, int(prefixes[name]))
            if number >= 10 ** width:
                raise ValueError(f"{os.fsdecode(directory)}: migration prefix width exhausted")
            target = str(number).zfill(width).encode() + name[len(prefixes[name]):]
            repaired[directory].add(target)
            if target != name:
                # Move the whole numbered directory, including any down.sql.
                moves[directory + b"/" + name.removesuffix(b"/up.sql")] = directory + b"/" + target.removesuffix(b"/up.sql")
    errors = audit(before, repaired)
    if errors:
        raise ValueError("cannot repair by renaming additions: " + "; ".join(errors))
    # Vacate destinations first, e.g. 0043-x -> 0044-x before 0042-x -> 0043-x.
    ordered = []
    while moves:
        ready = sorted(source for source, target in moves.items() if target not in moves)
        if not ready:
            raise ValueError("migration renames form a cycle")
        for source in ready:
            ordered.append((source, moves.pop(source)))
    return ordered


def move_command(source, target):
    return shlex.join(["git", "mv", "--", os.fsdecode(source), os.fsdecode(target)])


def renumber(before, after):
    moves = renames(before, after)
    os.chdir(os.fsdecode(git("rev-parse", "--show-toplevel").rstrip(b"\n")))
    if git("status", "--porcelain", "--untracked-files=all"):
        raise ValueError("renumber requires a clean worktree and index; commit your changes first")
    sources = {source for source, _ in moves}
    for source, target in moves:
        if not os.path.lexists(source) or (target not in sources and os.path.lexists(target)):
            raise ValueError(f"cannot rename {os.fsdecode(source)} to {os.fsdecode(target)}: missing source or occupied destination")
    for source, target in moves:
        git("mv", "--", source, target)
        print(move_command(source, target))
    if moves:
        print("Renames staged. Update explicit filename references, review and commit before checking again.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="checked target-base tree, or empty for a full duplicate audit")
    parser.add_argument("head", nargs="?", default="HEAD")
    parser.add_argument("--renumber", action="store_true", help="stage deterministic renames of HEAD's additions after base; clean worktree required")
    args = parser.parse_args()
    if args.renumber and (not args.base or args.head != "HEAD"):
        parser.error("--renumber requires a nonempty base and the current HEAD")
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
    try:
        if args.renumber:
            renumber(before, after)
            return 0
        if errors and args.base:
            for source, target in renames(before, after):
                print(f"migration guard: rename from repository root: {move_command(source, target)}", file=sys.stderr)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        detail = error.stderr.decode(errors="replace") if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"migration guard: {detail}", file=sys.stderr)
        if args.renumber:
            return 2
    return int(bool(errors))


if __name__ == "__main__":
    sys.exit(main())
