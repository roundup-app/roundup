#!/usr/bin/env python3
"""CI7335: after a `main` push saves its caches, delete the superseded ones and fail the run past the 9 GB guard.

`gh cache list` and `gh cache delete` do the work; `plan` and `guard` are pure over the list so a recorded list tests them."""
import json
import os
import re
import subprocess
import sys

LIMIT = 9_000_000_000
MAIN = "refs/heads/main"
# A cache key is its family, then one or more hashes (hex of 8+ characters, or a date-hour of digits).
HASH_TAIL = re.compile(r"(-[0-9a-f]{8,}|-\d{8,})+$")


def family(key):
    return HASH_TAIL.sub("", key)


def pull_number(ref):
    match = re.fullmatch(r"refs/pull/(\d+)/.+", ref)
    return int(match.group(1)) if match else None


def plan(entries, open_prs):
    """The entries to delete: `main`'s superseded ones, and every entry of a PR not in `open_prs`."""
    newest = {}
    for entry in entries:
        if entry["ref"] == MAIN:
            best = newest.get(family(entry["key"]))
            if best is None or entry["createdAt"] > best["createdAt"]:
                newest[family(entry["key"])] = entry
    doomed = []
    for entry in entries:
        number = pull_number(entry["ref"])
        if entry["ref"] == MAIN:
            if newest[family(entry["key"])] is not entry:
                doomed.append(entry)
        elif number is not None and number not in open_prs:
            doomed.append(entry)
    return doomed


def families(entries):
    """Per family: entry count, bytes on `main` and bytes on other refs, largest first."""
    table = {}
    for entry in entries:
        row = table.setdefault(family(entry["key"]), {"family": family(entry["key"]), "entries": 0, "main": 0, "other": 0})
        row["entries"] += 1
        row["main" if entry["ref"] == MAIN else "other"] += entry["sizeInBytes"]
    return sorted(table.values(), key=lambda row: -(row["main"] + row["other"]))


def table(entries):
    lines = ["| family | entries | main MB | other refs MB |", "|---|---|---|---|"]
    for row in families(entries):
        lines.append(f"| `{row['family']}` | {row['entries']} | {row['main'] / 1e6:,.0f} | {row['other'] / 1e6:,.0f} |")
    return "\n".join(lines)


def guard(entries):
    """None when the total is within the limit, else the message naming each family."""
    total = sum(entry["sizeInBytes"] for entry in entries)
    if total <= LIMIT:
        return None
    return f"The cache holds {total:,} bytes, over the {LIMIT:,} limit.\n" + table(entries)


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def listing():
    return json.loads(gh("cache", "list", "--limit", "1000", "--json", "id,key,ref,sizeInBytes,createdAt"))


def main():
    # Read the open PRs first: a failed read raises here and deletes nothing.
    open_prs = {pr["number"] for pr in json.loads(gh("pr", "list", "--state", "open", "--limit", "1000", "--json", "number"))}
    before = listing()
    doomed = plan(before, open_prs)
    for entry in doomed:
        gh("cache", "delete", str(entry["id"]))
    after = listing()
    total = sum(entry["sizeInBytes"] for entry in after)
    summary = (f"### Cache sweep\n\nDeleted {len(doomed)} entries, {sum(e['sizeInBytes'] for e in doomed) / 1e6:,.0f} MB.\n\n"
               f"Before: {sum(e['sizeInBytes'] for e in before):,} bytes\n\n{table(before)}\n\n"
               f"After: {total:,} bytes\n\n{table(after)}\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as out:
            out.write(summary)
    failure = guard(after)
    if failure:
        print(failure, file=sys.stderr)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as out:
                out.write(f"### Cache guard failed\n\n{failure}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
