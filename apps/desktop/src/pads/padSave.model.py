#!/usr/bin/env python3
"""P7547c: runs TLC (tlaplus v1.8.0, Java) on padSave.tla, fails on a rule violation, and writes padSave.dump or, with --check, fails when it differs from the committed one.

The dump holds the model's reachable `save` records and its steps (save, event, next save), one JSON line each, sorted; padSave.test.ts walks `step` against it.
"""
import hashlib, json, re, subprocess, sys, tempfile, urllib.request
from pathlib import Path

here = Path(__file__).resolve().parent
version, sha256 = "1.8.0", "7e53aa636dac8a3cb0533f343115c0548e03fc0ce5edc7739becf58d3d0fb84f"
jar = here / ".tools" / f"tla2tools-{version}.jar"


def fetch():
    if jar.exists() and hashlib.sha256(jar.read_bytes()).hexdigest() == sha256:
        return
    jar.parent.mkdir(exist_ok=True)
    data = urllib.request.urlopen(f"https://github.com/tlaplus/tlaplus/releases/download/v{version}/tla2tools.jar", timeout=120).read()
    if hashlib.sha256(data).hexdigest() != sha256:
        sys.exit("pad-save-model: tla2tools.jar does not match its pinned sha256")
    jar.write_bytes(data)


def record(text):
    """A TLA+ record `[ a |-> "x", b |-> 1 ]` as a dict."""
    return {k: json.loads(v.lower() if v in ("TRUE", "FALSE") else v) for k, v in re.findall(r"(\w+) \|-> (\"[^\"]*\"|\d+|TRUE|FALSE)", text)}


def main():
    fetch()
    with tempfile.TemporaryDirectory() as tmp:
        dot = Path(tmp) / "g.dot"
        run = subprocess.run(["java", "-cp", str(jar), "tlc2.TLC", "-workers", "1", "-metadir", tmp, "-config", "padSave.cfg", "-dump", "dot", str(dot), "padSave.tla"], cwd=here, capture_output=True, text=True)
        if run.returncode != 0:
            sys.exit(f"pad-save-model: TLC failed\n{run.stdout}{run.stderr}")
        graph = dot.read_text()
    nodes = {}
    for ident, label in re.findall(r'^(-?\d+) \[label="((?:[^"\\]|\\.)*)"', graph, re.M):
        label = label.replace("\\n", " ").replace('\\"', '"')
        nodes[ident] = (record(re.search(r"save = (\[.*?\])\s*/\\", label).group(1)), record(re.search(r"ev = (\[.*?\])\s*/\\", label).group(1)))
    key = lambda value: json.dumps(value, sort_keys=True)
    saves = {key(save) for save, _ in nodes.values()}
    steps = {key([nodes[a][0], nodes[b][1], nodes[b][0]]) for a, b in re.findall(r"^(-?\d+) -> (-?\d+) ", graph, re.M) if nodes[b][1]["kind"] != "init"}
    dump = "".join(f"save {line}\n" for line in sorted(saves)) + "".join(f"step {line}\n" for line in sorted(steps))
    target = here / "padSave.dump"

    if "--check" in sys.argv:
        if not target.exists() or target.read_text() != dump:
            sys.exit("pad-save-model: padSave.dump is stale; run `python3 apps/desktop/src/pads/padSave.model.py` and commit it")
    else:
        target.write_text(dump)

    print(f"pad-save-model: no rule violation; {len(saves)} saves, {len(steps)} steps")


main()
