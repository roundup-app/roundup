"""R4132b: compare local commit blob lengths without reading measurement dumps."""
import os
import subprocess
import sys

LIMIT = 1_000_000
ICONS = {
    b"crates/desktop/icons/artwork.png",
    b"crates/desktop/icons/icon.png",
    b"crates/desktop/icons/social-preview.png",
}


def git(*args):
    # Partial clones must fail on missing objects rather than fetching evidence.
    return subprocess.check_output(
        ["git", *args], stderr=subprocess.PIPE,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_OPTIONAL_LOCKS": "0"},
    )


def sizes(commit):
    result = {}
    for entry in git("ls-tree", "--full-tree", "-rlz", commit).split(b"\0"):
        if not entry:
            continue
        header, path = entry.split(b"\t", 1)
        _, kind, _, size = header.split()
        if kind == b"blob":
            result[path] = int(size)
    return result


def main():
    if len(sys.argv) > 2:
        print("file-size: expected at most one local base commit", file=sys.stderr)
        return 2
    base = (sys.argv[1] if len(sys.argv) == 2 else "") or os.environ.get("BASE", "")
    try:
        if base:
            base = git("rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}").decode().strip()
        else:
            base = git("merge-base", "HEAD", "origin/main").decode().strip()
        before = sizes(base)
        after = sizes("HEAD")
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        detail = error.stderr.decode(errors="replace") if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"file-size: cannot read local Git input ({base or 'HEAD / origin/main'}): {detail}", file=sys.stderr)
        return 2

    failed = False
    for path, size in after.items():
        if path not in ICONS and size > LIMIT and size > before.get(path, 0):
            print(f"file-size: {os.fsdecode(path)}: {size} bytes (base {before.get(path, 0)}; limit {LIMIT})")
            failed = True
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
