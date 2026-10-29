#!/usr/bin/env python3
"""N15: capture once, run both real Checkpoints stores, validate and print medians."""
import argparse
import json
import os
from pathlib import Path
import platform
import stat
import statistics
import subprocess
import sys


def run(command, cwd=None, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, timeout=3600, capture_output=True, text=True)
    if result.returncode:
        print(result.stdout, result.stderr, file=sys.stderr)
        raise RuntimeError(f"command={command!r}; condition=command failed; exit={result.returncode}")
    return result.stdout.strip()


def capture(source):
    paths = subprocess.check_output(["git", "-C", str(source), "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split(b"\0")
    files = []
    for relative in sorted(set(paths) - {b""}):
        path = os.fsencode(source) + b"/" + relative
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode):
            content = {"Symlink": {"target": list(os.readlink(path))}}
        elif stat.S_ISREG(info.st_mode):
            content = {"Regular": {"bytes": list(Path(os.fsdecode(path)).read_bytes()), "executable": bool(info.st_mode & 0o111)}}
        elif stat.S_ISDIR(info.st_mode):
            continue
        else:
            raise ValueError(f"unsupported selected file {relative!r}")
        files.append({"path": list(relative), "content": content})
    return {"agents": [{"agent": "door", "cwd": "/project", "worktree": "/project", "conversation": [0, 255, 10], "files": files}]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--new", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    baseline, new, source, output = (path.resolve() for path in (args.baseline, args.new, args.source, args.output))
    expected = "ae11e413f61fb23a68564ac3d68227b0da65f38e"
    if run(["git", "rev-parse", "HEAD"], baseline) != expected:
        raise ValueError("baseline checkout must match the scenario SHA")
    if run(["git", "status", "--porcelain"], source):
        raise ValueError("captured source checkout must be clean")
    if run(["git", "status", "--porcelain"], new):
        raise ValueError("implementation checkout must be committed and clean")
    output.mkdir(parents=True, exist_ok=False)
    marks = capture(source)
    input_path = output / "selection.json"
    input_path.write_text(json.dumps(marks))
    files = marks["agents"][0]["files"]
    count = len(files)
    content_bytes = sum(len(next(iter(file["content"].values())).get("bytes", next(iter(file["content"].values())).get("target", []))) for file in files)
    observer = new / "crates/checkpoints/src/observer.rs"
    baseline_observer = baseline / "crates/checkpoints/src/observer.rs"
    baseline_observer.write_bytes(observer.read_bytes())
    marks_module = baseline / "crates/checkpoints/src/marks.rs"
    text = marks_module.read_text()
    if 'mod observer;' not in text:
        marks_module.write_text(text + '\n#[cfg(test)]\n#[path = "observer.rs"]\nmod observer;\n')
    env = dict(os.environ, CHECKPOINT_OBSERVER_INPUT=str(input_path))
    summary = {"implementation_sha": run(["git", "rev-parse", "HEAD"], new), "baseline_sha": expected, "source_sha": run(["git", "rev-parse", "HEAD"], source), "os": platform.platform(), "git": run(["git", "--version"]), "profile": "release (optimized)", "file_count": count, "selected_content_bytes": content_bytes, "medians": {}}
    for label, checkout in [("baseline", baseline), ("new", new)]:
        env["CHECKPOINT_OBSERVER_OUTPUT"] = str(output / f"{label}.json")
        command = ["cargo", "test", "--release", "-p", "checkpoints", "n15_repository_storage_and_timing", "--", "--ignored", "--nocapture"]
        print(f"RUN {label}: {' '.join(command)}", flush=True)
        print(run(command, checkout, env), flush=True)
        rows = json.loads(Path(env["CHECKPOINT_OBSERVER_OUTPUT"]).read_text())
        if len(rows) != 15 or {(row["repetition"], row["checkpoint"]) for row in rows} != {(rep, checkpoint) for rep in range(1, 6) for checkpoint in range(1, 4)}:
            raise ValueError(f"{label}: missing measurement rows")
        summary["medians"][label] = {}
        for checkpoint in range(1, 4):
            selected = [row for row in rows if row["checkpoint"] == checkpoint]
            medians = {field: statistics.median(row[field] for row in selected) for field in ["physical_bytes", "save_ms", "read_ms"]}
            summary["medians"][label][checkpoint] = medians
    summary["ratios"] = {checkpoint: {field: summary["medians"]["new"][checkpoint][field] / summary["medians"]["baseline"][checkpoint][field] for field in ["physical_bytes", "save_ms", "read_ms"]} for checkpoint in range(1, 4)}
    (output / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print("PASS\tcommand=observe.py\tcondition=all measurements and equality checks complete\texit=0")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"FAIL\tcommand=observe.py\tcondition={error}\texit=1", file=sys.stderr)
        sys.exit(1)
