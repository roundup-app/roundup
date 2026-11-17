#!/usr/bin/env python3
"""CI7295b: on `main`, a lane whose setup took over 90 s or whose test step took over 240 s warns, naming itself in
`check`'s summary; no time budget fails `main`. Setup is cache restore and runner network, which no PR controls, and the
same macOS build takes 33 s on one runner and 198 s on another (run 44046436794 failed `rust 1` at 91 s of setup).
Usage: lane-budget.py <job name> <test step name>, with `GH_TOKEN` and the run's `GITHUB_*` variables set.
"""
import json
import os
import subprocess
import sys
from datetime import datetime


def main(lane, test_step):
    budgets = {
        "Run ./.github/actions/setup": ("setup", 90),
        test_step: ("test step", 240),
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
    for step in map(json.loads, steps):
        if step["name"] in budgets and step["completed_at"]:
            seconds = (
                datetime.fromisoformat(step["completed_at"])
                - datetime.fromisoformat(step["started_at"])
            ).total_seconds()
            what, budget = budgets[step["name"]]
            print(f"{lane}: {what} {seconds:.0f} s, budget {budget} s")
            if seconds > budget:
                print(f"::warning::{lane}: {what} took {seconds:.0f} s, over {budget} s")


if __name__ == "__main__":
    main(*sys.argv[1:])
