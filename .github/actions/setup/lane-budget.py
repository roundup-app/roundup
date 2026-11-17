#!/usr/bin/env python3
"""CI7295b: on `main`, a lane whose test step took over 300 s fails, and one whose setup took over 90 s or whose test
step took over 240 s warns, naming itself: setup is cache restore and runner network, which no PR controls, and file times
swing up to half again between runs, so noise must not fail `main` (run 44046436794 failed `rust 1` at 91 s of setup).
Usage: lane-budget.py <job name> <test step name>, with `GH_TOKEN` and the run's `GITHUB_*` variables set.
"""
import json
import os
import subprocess
import sys
from datetime import datetime


def main(lane, test_step):
    budgets = {
        "Run ./.github/actions/setup": ("setup", 90, None),
        test_step: ("test step", 240, 300),
    }
    jobs = (
        f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
        f"/attempts/{os.environ['GITHUB_RUN_ATTEMPT']}/jobs?per_page=100"
    )
    steps = subprocess.run(
        [
            "gh",
            "api",
            "--paginate",
            jobs,
            "--jq",
            f".jobs[] | select(.name == {json.dumps(lane)}) | .steps[] | tojson",
        ],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.splitlines()
    over = []
    for step in map(json.loads, steps):
        if step["name"] in budgets and step["completed_at"]:
            seconds = (
                datetime.fromisoformat(step["completed_at"])
                - datetime.fromisoformat(step["started_at"])
            ).total_seconds()
            what, aim, limit = budgets[step["name"]]
            print(f"{lane}: {what} {seconds:.0f} s, aim {aim} s" + (f", limit {limit} s" if limit else ""))
            if limit and seconds > limit:
                over.append(f"{what} took {seconds:.0f} s, over {limit} s")
            elif seconds > aim:
                print(f"::warning::{lane}: {what} took {seconds:.0f} s, over {aim} s")
    if over:
        print(f"::error::{lane}: " + "; ".join(over))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
