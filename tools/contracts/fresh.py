"""Regenerate first, but retain evidence of drift that generation repairs."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def drift():
    tracked = subprocess.check_output(
        ["git", "diff", "HEAD", "--name-only", "--", "contracts/generated"], cwd=ROOT, text=True
    )
    extra = subprocess.check_output(
        ["git", "ls-files", "--others", "contracts/generated"], cwd=ROOT, text=True
    )
    return set((tracked + extra).splitlines())


def main():
    before = drift()
    generated = subprocess.run(["just", "contracts"], cwd=ROOT)
    if generated.returncode:
        print("contracts-fresh: failed generation step: just contracts", file=sys.stderr)
        return 1
    changed = before | drift()
    if changed:
        print("contracts-fresh: generated output drift:\n" + "\n".join(sorted(changed)), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
