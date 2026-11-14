#!/usr/bin/env python3
"""DF7078d-f: `just promote <dev version>` ships the Stable bundle of that Dev build to the alpha feed, unchanged."""
import json
import pathlib
import re
import subprocess
import sys
import tempfile

import feed as feeds


def artifacts(name=None):
    args = ["api", "-X", "GET", "repos/{owner}/{repo}/actions/artifacts", "-f", "per_page=100"]
    if name:
        args += ["-f", f"name={name}"]
    return [a for a in json.loads(feeds.gh(*args))["artifacts"] if not a.get("expired")]


def release_exists(tag):
    return subprocess.run(["gh", "api", f"repos/{{owner}}/{{repo}}/releases/tags/{tag}"], capture_output=True).returncode == 0


def fetch(run_id, name, folder):
    feeds.gh("run", "download", str(run_id), "-n", name, "-D", str(folder))
    return feeds.bundle_files(folder)


def read_back(tag, folder):
    feeds.gh("release", "download", tag, "-D", str(folder), "--clobber")
    return feeds.bundle_files(folder)


def write_alpha(version, repo, tag, bundle, sig):
    if not release_exists("alpha"):
        feeds.gh("release", "create", "alpha", "--title", "alpha", "--notes", "The alpha feed: latest.json names the promoted build.", "--prerelease")
    with tempfile.TemporaryDirectory() as work:
        latest = pathlib.Path(work) / "latest.json"
        feeds.write_feed(latest, version, repo, tag, bundle, sig)
        feeds.gh("release", "upload", "alpha", str(latest), "--clobber")


def main(argv):
    match = len(argv) == 2 and re.fullmatch(r"0\.1\.0-dev\.([1-9][0-9]*)", argv[1])
    if not match:
        print("usage: promote.py 0.1.0-dev.<n>", file=sys.stderr)
        return 2
    dev, n = argv[1], match.group(1)
    version, tag = f"0.1.0-alpha.{n}", f"v0.1.0-alpha.{n}"
    found = artifacts(f"stable-{dev}")
    if not found and not release_exists(tag):
        newest = artifacts()
        newest = max((a["name"] for a in newest if a["name"].startswith("stable-")), key=lambda s: int(s.rsplit(".", 1)[1]), default="none")
        print(f"no artifact stable-{dev}: it was never pushed, was red, failed before its Dev upload or expired; the newest is {newest}", file=sys.stderr)
        return 3
    repo = feeds.gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").strip()
    with tempfile.TemporaryDirectory() as work:
        work = pathlib.Path(work)
        source = fetch(found[0]["workflow_run"]["id"], f"stable-{dev}", work / "artifact") if found else None
        if release_exists(tag):
            bundle, sig = read_back(tag, work / "release")
            if source and feeds.sha256(bundle) != feeds.sha256(source[0]):
                print(f"{tag} exists with a different bundle than the artifact; nothing changed", file=sys.stderr)
                return 5
            write_alpha(version, repo, tag, bundle, sig)
            return 0
        feeds.gh("release", "create", tag, str(source[0]), str(source[1]), "--title", tag, "--notes", f"Promoted from {dev}.", "--prerelease")
        bundle, sig = read_back(tag, work / "release")
        if feeds.sha256(bundle) != feeds.sha256(source[0]):
            feeds.gh("release", "delete", tag, "--yes", "--cleanup-tag")
            print(f"{tag}'s bundle differs from the artifact; the release is deleted and the alpha feed untouched", file=sys.stderr)
            return 4
        write_alpha(version, repo, tag, source[0], source[1])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
