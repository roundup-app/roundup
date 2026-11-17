"""DF7078h: on a push to `main` whose `lanes` succeeded, fail naming each main-only job that was skipped."""
import json
import sys

MAIN_JOBS = ["cache", "mac-package", "cache-sweep", "bundle", "publish"]
UPSTREAM = {"publish": "bundle"}


def skipped(needs):
    """Names of main-only jobs skipped though everything before them succeeded."""
    result = {name: job["result"] for name, job in needs.items()}
    if result.get("lanes") != "success":
        return []
    return [
        name for name in MAIN_JOBS
        if result.get(name) == "skipped" and result.get(UPSTREAM.get(name, "lanes")) == "success"
    ]


def main():
    names = skipped(json.load(sys.stdin))
    for name in names:
        print(f"::error::{name} was skipped on a green push to main")
    return 1 if names else 0


if __name__ == "__main__":
    sys.exit(main())
