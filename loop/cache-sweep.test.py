#!/usr/bin/env python3
"""CI7335: the cache sweep and its 9 GB guard, over a list rebuilt from the 09:46Z table of the work order."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("cache_sweep", Path(__file__).with_name("cache-sweep.py"))
sweep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sweep)

MB = 1_000_000
OPEN = {7311, 7313, 7319, 7322, 7332, 7334}
_ids = iter(range(1, 1000))


def entry(key, ref, mb, minute=0):
    return {"id": next(_ids), "key": key, "ref": ref, "sizeInBytes": mb * MB, "createdAt": f"2026-11-17T09:{minute:02d}:00Z"}


def main_entries(key, sizes):
    # the last size is the newest entry
    return [entry(f"{key}-{i:08x}", sweep.MAIN, mb, i) for i, mb in enumerate(sizes)]


def listing(open_pr_entries=False):
    rows = []
    rows += main_entries("v0-rust-check-macOS-Darwin-arm64", [1430, 1712, 1712, 1712])
    rows += main_entries("v0-rust-check-Linux-Linux-x64", [813])
    rows += main_entries("node-cache-Linux-x64-pnpm", [834])
    rows += main_entries("node-cache-macOS-arm64-pnpm", [525])
    rows += main_entries("apt-tauri-Linux-X64", [67, 67, 68, 68, 70])
    rows += main_entries("daemon-Linux", [49, 49, 48])
    rows += main_entries("closed-issues", [2] * 12 + [1, 1])
    rows.append(entry("daemon-Linux-0000beef", "refs/heads/local/issue-7295-rust", 68))
    pulls = [("node-cache-Linux-x64-pnpm", [835, 834]), ("apt-tauri-Linux-X64", [68] * 6 + [71]),
             ("daemon-Linux", [47] * 10 + [46])]
    for key, sizes in pulls:
        for i, mb in enumerate(sizes):
            rows.append(entry(f"{key}-{i:08x}", f"refs/pull/{7275 + i}/merge", mb))
    if open_pr_entries:
        rows.append(entry("daemon-Linux-cafe0000", "refs/pull/7311/merge", 47))
    return rows


class Sweep(unittest.TestCase):
    def test_ci7335a_the_sweep_keeps_the_newest_main_entry_of_each_family_and_open_prs(self):
        rows = listing(open_pr_entries=True)
        doomed = sweep.plan(rows, OPEN)
        self.assertEqual(len(doomed), 42)
        kept = [row for row in rows if row not in doomed]
        self.assertEqual(sum(row["sizeInBytes"] for row in kept) - 47 * MB, 4071 * MB)
        self.assertIn("refs/heads/local/issue-7295-rust", {row["ref"] for row in kept})
        self.assertIn("refs/pull/7311/merge", {row["ref"] for row in kept})
        mains = [row["key"] for row in kept if row["ref"] == sweep.MAIN]
        self.assertEqual(len({sweep.family(key) for key in mains}), len(mains))
        macos = [row for row in kept if sweep.family(row["key"]) == "v0-rust-check-macOS-Darwin-arm64"]
        self.assertEqual([row["createdAt"] for row in macos], ["2026-11-17T09:03:00Z"])

    def test_ci7335b_the_guard_passes_the_swept_list_and_names_the_largest_family_of_the_unswept_one(self):
        rows = listing()
        doomed = {row["id"] for row in sweep.plan(rows, OPEN)}
        self.assertIsNone(sweep.guard([row for row in rows if row["id"] not in doomed]))
        message = sweep.guard(rows)
        self.assertIn("v0-rust-check-macOS-Darwin-arm64", message.splitlines()[3])
        self.assertIn("6,566", message.splitlines()[3])


class Workflow(unittest.TestCase):
    def test_ci7335c_only_the_sweep_job_writes_caches_and_a_pr_skips_it(self):
        check = Path(__file__).with_name("..").joinpath(".github/workflows/check.yml").resolve().read_text()
        self.assertEqual(check.count("actions: write"), 1)
        self.assertEqual(check.count("pull-requests: read"), 1)
        job = check.split("\n  cache-sweep:\n")[1].split("\n\n")[0]
        self.assertIn("actions: write", job)
        self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/main'", job)
        self.assertIn("cache-sweep, mac-clippy", check)


if __name__ == "__main__":
    unittest.main()
