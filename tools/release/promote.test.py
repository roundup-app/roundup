"""DF7078b, d-f: feed.py and promote.py run against a fake `gh` on PATH; no network, no real gh."""
import base64
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).parent
FAKE_GH = '''#!/usr/bin/env python3
import base64, json, os, pathlib, sys
state = pathlib.Path(os.environ["FAKE_STATE"])
args = sys.argv[1:]
with (state / "calls.log").open("a") as log:
    log.write(" ".join(args) + "\\n")
db = state / "db.json"
data = json.loads(db.read_text())
def save(): db.write_text(json.dumps(data))
def flag(name):
    return args[args.index(name) + 1]
if args[:2] == ["repo", "view"]:
    print("o/r")
elif args[0] == "api":
    path = args[[a.startswith("repos/") for a in args].index(True)]
    if "/actions/artifacts" in path:
        names = [a[5:] for a in args if a.startswith("name=")]
        found = [a for a in data["artifacts"] if not names or a["name"] == names[0]]
        print(json.dumps({"artifacts": found}))
    else:
        tag = path.rsplit("/", 1)[1]
        sys.exit(0 if tag in data["releases"] else 1)
elif args[:2] == ["run", "download"]:
    out = pathlib.Path(flag("-D")); out.mkdir(parents=True, exist_ok=True)
    for n, b in data["files"][flag("-n")].items():
        (out / n).write_bytes(base64.b64decode(b))
elif args[:2] == ["release", "create"]:
    tag = args[2]
    if tag in data["releases"]: sys.exit(1)
    data["releases"][tag] = {}
    for f in args[3:]:
        if not f.startswith("-") and os.path.exists(f):
            data["releases"][tag][os.path.basename(f)] = base64.b64encode(open(f, "rb").read()).decode()
    save()
elif args[:2] == ["release", "upload"]:
    for f in args[3:]:
        if os.path.exists(f):
            data["releases"][args[2]][os.path.basename(f)] = base64.b64encode(open(f, "rb").read()).decode()
    save()
elif args[:2] == ["release", "view"]:
    print(json.dumps({"assets": [{"name": n} for n in data["releases"][args[2]]]}))
elif args[:2] == ["release", "download"]:
    out = pathlib.Path(flag("-D")); out.mkdir(parents=True, exist_ok=True)
    for n, b in data["releases"][args[2]].items():
        raw = base64.b64decode(b)
        if os.environ.get("FAKE_CORRUPT") and n.endswith(".tar.gz"): raw += b"x"
        (out / n).write_bytes(raw)
elif args[:2] == ["release", "delete"]:
    del data["releases"][args[2]]; save()
elif args[:2] == ["release", "delete-asset"]:
    del data["releases"][args[2]][args[3]]; save()
else:
    sys.exit("fake gh: unhandled " + " ".join(args))
'''


def b64(raw):
    return base64.b64encode(raw).decode()


class Harness(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = pathlib.Path(temp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        (self.root / "bin").mkdir()
        gh = self.root / "bin" / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.db = {"artifacts": [], "files": {}, "releases": {}}
        self.save()

    def save(self):
        (self.state / "db.json").write_text(json.dumps(self.db))

    def load(self):
        return json.loads((self.state / "db.json").read_text())

    def calls(self):
        log = self.state / "calls.log"
        return log.read_text().splitlines() if log.exists() else []

    def artifact(self, n, body=b"stable-bytes"):
        name = f"stable-0.1.0-dev.{n}"
        self.db["artifacts"].append({"name": name, "workflow_run": {"id": 100 + n}})
        archive = f"roundup_0.1.0-alpha.{n}_aarch64.app.tar.gz"
        self.db["files"][name] = {archive: b64(body), archive + ".sig": b64(b"SIG" + str(n).encode() + b"\n")}
        self.save()

    def run_script(self, script, *args, **env):
        environ = {**os.environ, "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}", "FAKE_STATE": str(self.state), **env}
        return subprocess.run([sys.executable, str(HERE / script), *args], env=environ, capture_output=True, text=True)

    def promote(self, version, **env):
        return self.run_script("promote.py", version, **env)

    def alpha_feed(self):
        return json.loads(base64.b64decode(self.load()["releases"]["alpha"]["latest.json"]))


class DevFeed(Harness):
    def test_df7078b_feed_holds_version_url_signature_and_uploads_in_order(self):
        bundle = self.root / "bundle"
        bundle.mkdir()
        name = "roundup-dev_0.1.0-dev.9_aarch64.app.tar.gz"
        (bundle / name).write_bytes(b"new")
        (bundle / (name + ".sig")).write_text("SIGTEXT\n")
        self.db["releases"]["dev"] = {"roundup-dev_0.1.0-dev.8_aarch64.app.tar.gz": "", "latest.json": ""}
        self.save()
        result = self.run_script("feed.py", "publish-dev", "0.1.0-dev.9", "o/r", str(bundle))
        self.assertEqual(result.returncode, 0, result.stderr)
        feed = json.loads(base64.b64decode(self.load()["releases"]["dev"]["latest.json"]))
        self.assertEqual(feed["version"], "0.1.0-dev.9")
        entry = feed["platforms"]["darwin-aarch64"]
        self.assertEqual(entry["url"], f"https://github.com/o/r/releases/download/dev/{name}")
        self.assertEqual(entry["signature"], "SIGTEXT")
        self.assertEqual(sorted(self.load()["releases"]["dev"]), sorted([name, "latest.json"]))
        verbs = [" ".join(c.split()[:2]) for c in self.calls()]
        order = [verbs.index(v) for v in ("release upload", "release view", "release delete-asset")]
        uploads = [i for i, v in enumerate(verbs) if v == "release upload"]
        self.assertEqual(len(uploads), 2)
        self.assertIn(name, self.calls()[uploads[0]])
        self.assertIn("latest.json", self.calls()[uploads[1]])
        self.assertLess(uploads[1], order[2])


class Promote(Harness):
    def test_df7078d_malformed_version_exits_2_with_no_gh_call(self):
        for bad in ["0.1.0-dev.0", "0.1.0-dev.x", "0.1.0-alpha.3", "1.0.0", "0.1.0-dev.01"]:
            with self.subTest(bad=bad):
                self.assertEqual(self.promote(bad).returncode, 2)
        self.assertEqual(self.run_script("promote.py").returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_df7078d_version_with_no_artifact_exits_3_and_touches_no_release(self):
        self.artifact(4)
        result = self.promote("0.1.0-dev.5")
        self.assertEqual(result.returncode, 3)
        self.assertIn("0.1.0-dev.5", result.stderr)
        self.assertIn("stable-0.1.0-dev.4", result.stderr)
        self.assertEqual([c for c in self.calls() if c.startswith("release")], [])
        self.assertEqual(self.load()["releases"], {})

    def test_df7078e_release_holds_artifact_bytes_and_feed_follows_it(self):
        self.artifact(7, b"\x00bundle\xff")
        result = self.promote("0.1.0-dev.7")
        self.assertEqual(result.returncode, 0, result.stderr)
        releases = self.load()["releases"]
        name = "roundup_0.1.0-alpha.7_aarch64.app.tar.gz"
        self.assertEqual(base64.b64decode(releases["v0.1.0-alpha.7"][name]), b"\x00bundle\xff")
        self.assertEqual(base64.b64decode(releases["v0.1.0-alpha.7"][name + ".sig"]), b"SIG7\n")
        feed = self.alpha_feed()
        self.assertEqual(feed["version"], "0.1.0-alpha.7")
        entry = feed["platforms"]["darwin-aarch64"]
        self.assertEqual(entry["url"], f"https://github.com/o/r/releases/download/v0.1.0-alpha.7/{name}")
        self.assertEqual(entry["signature"], "SIG7")
        calls = self.calls()
        created = next(i for i, c in enumerate(calls) if c.startswith("release create v0.1.0-alpha.7"))
        uploaded = next(i for i, c in enumerate(calls) if c.startswith("release upload alpha"))
        self.assertLess(created, uploaded)

    def test_df7078e_hash_mismatch_exits_4_deletes_release_and_leaves_feed(self):
        self.artifact(7)
        result = self.promote("0.1.0-dev.7", FAKE_CORRUPT="1")
        self.assertEqual(result.returncode, 4)
        releases = self.load()["releases"]
        self.assertNotIn("v0.1.0-alpha.7", releases)
        self.assertNotIn("alpha", releases)

    def test_df7078f_repeat_creates_and_deletes_nothing_and_rewrites_feed(self):
        self.artifact(7)
        self.assertEqual(self.promote("0.1.0-dev.7").returncode, 0)
        before = len(self.calls())
        result = self.promote("0.1.0-dev.7")
        self.assertEqual(result.returncode, 0, result.stderr)
        second = self.calls()[before:]
        self.assertEqual([c for c in second if c.startswith(("release create v", "release delete"))], [])
        self.assertTrue(any(c.startswith("release upload alpha") for c in second))
        self.assertEqual(self.alpha_feed()["version"], "0.1.0-alpha.7")

    def test_df7078f_differing_hash_exits_5_and_changes_nothing(self):
        self.artifact(7)
        self.assertEqual(self.promote("0.1.0-dev.7").returncode, 0)
        self.db = self.load()
        self.db["files"]["stable-0.1.0-dev.7"]["roundup_0.1.0-alpha.7_aarch64.app.tar.gz"] = b64(b"other")
        self.save()
        before = self.load()
        self.assertEqual(self.promote("0.1.0-dev.7").returncode, 5)
        self.assertEqual(self.load(), before)

    def test_df7078f_older_version_after_newer_points_feed_at_older_release(self):
        self.artifact(7)
        self.artifact(8)
        self.promote("0.1.0-dev.7")
        self.promote("0.1.0-dev.8")
        self.assertEqual(self.alpha_feed()["version"], "0.1.0-alpha.8")
        self.assertEqual(self.promote("0.1.0-dev.7").returncode, 0)
        self.assertEqual(self.alpha_feed()["version"], "0.1.0-alpha.7")
        self.assertEqual(sorted(k for k in self.load()["releases"] if k.startswith("v")), ["v0.1.0-alpha.7", "v0.1.0-alpha.8"])

    def test_df7078f_expired_artifact_rolls_back_from_the_release(self):
        self.artifact(7)
        self.promote("0.1.0-dev.7")
        self.db = self.load()
        self.db["artifacts"][0]["expired"] = True
        self.save()
        self.assertEqual(self.promote("0.1.0-dev.7").returncode, 0)


if __name__ == "__main__":
    unittest.main()
