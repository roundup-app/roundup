#!/usr/bin/env python3
"""CI7295b: on `main`, a lane whose setup took over 90 s or whose test step took over 240 s warns, naming itself in
`check`'s summary; no time budget fails `main`. Setup is cache restore and runner network, which no PR controls, and the
same macOS build takes 33 s on one runner and 198 s on another (run 44046436794 failed `rust 1` at 91 s of setup).
Usage: lane-budget.py <job name> <test step name>, with `GH_TOKEN` and the run's `GITHUB_*` variables set.
CI7297e: `lane-budget.py --job <job name> <seconds> <step name>...` warns when the job's seconds from its start to
the step named `CI7297e <job name> job time` exceed <seconds>, and prints each named step's seconds; it fails nothing.
A null or missing `started_at` of that step reads as now, and a named step without both times is skipped.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone


def seconds_between(start, end):
    return (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()


def lane_steps(lane):
    jobs = (
        f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
        f"/attempts/{os.environ['GITHUB_RUN_ATTEMPT']}/jobs?per_page=100"
    )
    lines = subprocess.run(
        [
            "gh",
            "api",
            "--paginate",
            jobs,
            "--jq",
            f".jobs[] | select(.name == {json.dumps(lane)}) | {{started_at, steps}} | tojson",
        ],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.splitlines()
    return [json.loads(line) for line in lines]


def job_time(lane, bound, step_names):
    for job in lane_steps(lane)[:1]:
        steps = {s["name"]: s for s in job["steps"]}
        now = datetime.now(timezone.utc).isoformat()
        # The jobs API sometimes returns a running step's `started_at` as null: the step is this one, so it starts now.
        start = job.get("started_at") or now
        end = steps.get(f"CI7297e {lane} job time", {}).get("started_at") or now
        seconds = seconds_between(start, end)
        parts = ", ".join(
            f"{name} {seconds_between(steps[name]['started_at'], steps[name]['completed_at']):.0f} s"
            for name in step_names
            if name in steps and steps[name].get("started_at") and steps[name].get("completed_at")
        )
        print(f"{lane}: job {seconds:.0f} s, bound {bound} s ({parts})")
        if seconds > bound:
            print(f"::warning::{lane}: job took {seconds:.0f} s, over {bound} s ({parts})")


def main(lane, test_step):
    budgets = {
        "Run ./.github/actions/setup": ("setup", 90),
        test_step: ("test step", 240),
    }
    steps = [s for job in lane_steps(lane) for s in job["steps"]]
    for step in steps:
        if step["name"] in budgets and step["completed_at"]:
            seconds = seconds_between(step["started_at"], step["completed_at"])
            what, budget = budgets[step["name"]]
            print(f"{lane}: {what} {seconds:.0f} s, budget {budget} s")
            if seconds > budget:
                print(f"::warning::{lane}: {what} took {seconds:.0f} s, over {budget} s")


if __name__ == "__main__":
    if sys.argv[1] == "--job":
        job_time(sys.argv[2], float(sys.argv[3]), sys.argv[4:])
    else:
        main(*sys.argv[1:])
