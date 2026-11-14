#!/usr/bin/env python3
"""DF7078: the updater feed JSON and the Dev feed upload (`feed.py publish-dev`). promote.py imports the same builder."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile

PLATFORM = "darwin-aarch64"


def gh(*args, check=True):
    return subprocess.run(["gh", *args], check=check, text=True, capture_output=True).stdout


def feed(version, url, signature, platform=PLATFORM, pub_date=None):
    pub_date = pub_date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"version": version, "pub_date": pub_date, "platforms": {platform: {"url": url, "signature": signature}}}


def asset_url(repo, tag, name):
    return f"https://github.com/{repo}/releases/download/{tag}/{name}"


def bundle_files(folder):
    """The one update archive in folder and its .sig."""
    archives = sorted(pathlib.Path(folder).glob("*.app.tar.gz"))
    if len(archives) != 1 or not archives[0].with_name(archives[0].name + ".sig").is_file():
        raise SystemExit(f"{folder} must hold one *.app.tar.gz and its .sig, found {[a.name for a in archives]}")
    return archives[0], archives[0].with_name(archives[0].name + ".sig")


def sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def write_feed(path, version, repo, tag, bundle, sig):
    text = json.dumps(feed(version, asset_url(repo, tag, bundle.name), sig.read_text().strip()), indent=2)
    pathlib.Path(path).write_text(text + "\n")


def publish_dev(version, repo, folder):
    """Bundle first, then latest.json, then older assets: the feed never names a missing bundle."""
    bundle, sig = bundle_files(folder)
    if subprocess.run(["gh", "api", f"repos/{repo}/releases/tags/dev"], capture_output=True).returncode != 0:
        gh("release", "create", "dev", "--title", "dev", "--notes", "Rolling Dev build.", "--prerelease")
    gh("release", "upload", "dev", str(bundle), "--clobber")
    with tempfile.TemporaryDirectory() as work:
        latest = pathlib.Path(work) / "latest.json"
        write_feed(latest, version, repo, "dev", bundle, sig)
        gh("release", "upload", "dev", str(latest), "--clobber")
    assets = json.loads(gh("release", "view", "dev", "--json", "assets"))["assets"]
    for asset in assets:
        if asset["name"] not in (bundle.name, "latest.json"):
            gh("release", "delete-asset", "dev", asset["name"], "--yes")


def main(argv):
    if len(argv) == 5 and argv[1] == "publish-dev":
        publish_dev(argv[2], argv[3], argv[4])
        return 0
    print("usage: feed.py publish-dev <dev version> <owner/repo> <bundle dir>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
