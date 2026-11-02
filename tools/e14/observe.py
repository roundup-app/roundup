#!/usr/bin/env python3
"""Full CI lane measurements and a fail-closed E14 before/after report."""
import argparse
import hashlib
import json
import math
import os
import platform
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

RUST_SUITES = json.loads(Path(__file__).with_name("rust-suites.json").read_text())

# The collector starts before CI setup, which can run 28 minutes on a cold cache, so it must outlive the longest job
# (`timeout-minutes` in check.yml) or it dies before the lane ends and the lane fails with its tests green.
MEMORY_LIMIT_SECONDS = 40 * 60

LANES = [f"rust{i}" for i in range(1, 6)] + [f"web{i}" for i in range(1, 8)]


def overlap(rows):
    events = []
    for row in rows:
        start, end = row["start"], row["end"]
        if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (start, end)) or end < start:
            raise ValueError(f"invalid lifecycle: {row['id']}")
        if row["real"] and end > start:
            events.extend([(start, 1), (end, -1)])
    active = peak = 0
    for _, delta in sorted(events):  # Half-open intervals: an end precedes a simultaneous start.
        active += delta
        peak = max(peak, active)
    if peak > 4:
        raise ValueError(f"{peak} overlapping real-Claude tests (maximum 4)")
    return peak


def rust_rows(path):
    report = ET.parse(path).getroot()
    rows = []
    for case in report.iter("testcase"):
        if case.find("skipped") is not None:
            continue
        if any(case.find(tag) is not None for tag in ("failure", "error", "rerunFailure", "rerunError")):
            raise ValueError(f"failed Rust test: {case.attrib}")
        suite, name = case.attrib["classname"], case.attrib["name"]
        start = datetime.fromisoformat(case.attrib["timestamp"]).timestamp() * 1000
        # Conservatively include every test in the real-Claude binaries, including B21.
        real = suite in RUST_SUITES["real_suites"]
        rows.append(dict(id=f"{suite}::{name}", start=start, end=start + float(case.attrib["time"]) * 1000, real=real))
    if len(rows) != int(report.attrib["tests"]):
        raise ValueError("incomplete Rust lifecycle report")
    executions = [json.loads(p.read_text()) for p in (path.parent / "rust-events").glob("*.json")]
    # L122: a retried test has one interval per attempt; the last attempt is the one that passed.
    by_id = {r["id"]: r for r in sorted(executions, key=lambda r: r["start"])}
    if set(by_id) != {r["id"] for r in rows} or len(executions) - len(by_id) != len(flaky_rust(path)):
        raise ValueError("missing or duplicate Rust execution intervals")
    for row in rows:
        execution = by_id[row["id"]]
        if execution["exit_code"] != 0:
            raise ValueError(f"failed Rust execution: {row['id']}")
        row.update(start=execution["start"], end=execution["end"])
    return rows


def flaky_rust(path):
    """L122: the Rust tests that failed, then passed on a retry, from nextest's JUnit report."""
    return [f'{case.attrib["classname"]}::{case.attrib["name"]}' for case in ET.parse(path).getroot().iter("testcase")
            if case.find("flakyFailure") is not None or case.find("flakyError") is not None]


def flaky_web(path):
    """L122: the web tests that passed only on a retry, from the lifecycle reporter's file."""
    return [row["id"] for module in json.loads(path.read_text())["modules"] for row in module["tests"]
            if row["status"] == "passed" and row["retries"]]


def nextest_config(root, output, profile):
    config = output / "nextest.toml"
    events = output / "rust-events"
    events.mkdir()
    wrapper = str(Path(__file__).with_name("rust-wrapper.py").resolve())
    config.write_text('experimental = ["wrapper-scripts"]\n' +
        (root / ".config/nextest.toml").read_text() +
        f'\n[profile.{profile}.junit]\npath = {json.dumps(str(output / "junit.xml"))}\n' +
        '[scripts.wrapper.e14]\ncommand = ' + json.dumps([sys.executable, wrapper]) +
        '\ntarget-runner = "within-wrapper"\n' +
        f'[[profile.{profile}.scripts]]\nfilter = "all()"\nrun-wrapper = "e14"\n')
    return config


def web_rows(path):
    report = json.loads(path.read_text())
    if report["errors"]:
        raise ValueError("unhandled web runner errors")
    rows = []
    for module in report["modules"]:
        if module["state"] not in ("passed", "skipped"):
            raise ValueError(f"web module failed: {module['id']}")
        for row in module["tests"]:
            if row["status"] == "skipped":
                continue
            if row["status"] != "passed" or row["repeats"]:
                raise ValueError(f"failed web test: {row['id']}")
            rows.append(row)
    return rows


def evidence(directory):
    metadata = json.loads((directory / "lane.json").read_text())
    if metadata["exit_code"] != 0:
        raise ValueError(f"{directory}: lane failed with exit {metadata['exit_code']}")
    if "build_observation" in metadata:
        if metadata["build_observation"]["status"] != "valid":
            raise ValueError(f"{directory}: invalid build observation")
        import build
        build.report(directory / "build")
    rows = json.loads((directory / "lifecycle.json").read_text())
    if not rows:
        raise ValueError(f"{directory}: missing lifecycle evidence")
    peak = overlap(rows)
    samples = [json.loads(line) for line in (directory / "memory.jsonl").read_text().splitlines()]
    if len(samples) < 2 or any(not (0 < s["used"] <= s["total"]) for s in samples):
        raise ValueError(f"{directory}: missing memory evidence")
    if samples[0]["at"] > metadata["started"] or samples[-1]["at"] < metadata["ended"]:
        raise ValueError(f"{directory}: memory observation does not cover lane")
    if any(not math.isfinite(s["at"]) for s in samples) or any(not 0 <= b["at"] - a["at"] <= 5000 for a, b in zip(samples, samples[1:])):
        raise ValueError(f"{directory}: memory observation gap exceeds 5 seconds")
    if any(r["start"] < metadata["started"] - 1 or r["end"] > metadata["ended"] + 1 for r in rows):
        raise ValueError(f"{directory}: lifecycle outside measured lane")
    return metadata | {"peak_runner_bytes": max(s["used"] for s in samples), "overlap": peak, "tests": len(rows)}


def memory(args):
    import psutil

    stop = args.output.with_suffix(".stop")
    done = args.output.with_suffix(".done")
    if args.output.exists() or stop.exists() or done.exists():
        raise ValueError("memory observer requires fresh files")
    deadline = time.monotonic() + MEMORY_LIMIT_SECONDS
    with args.output.open("x") as stream:
        while time.monotonic() < deadline:
            vm = psutil.virtual_memory()
            stream.write(json.dumps(dict(at=time.time() * 1000, used=vm.total - vm.available, total=vm.total)) + "\n")
            stream.flush()
            if stop.exists():
                done.touch()
                return 0
            time.sleep(0.05)
    raise ValueError(f"memory observer exceeded {MEMORY_LIMIT_SECONDS // 60} minutes without lane completion")


def report_flaky(lane, output):
    """L122: lists the lane's tests that passed only on a retry under "Flaky" in the job summary and as a warning."""
    report = output / ("junit.xml" if lane.startswith("rust") else "web.json")
    flaky = (flaky_rust if lane.startswith("rust") else flaky_web)(report) if report.exists() else []
    if not flaky:
        return
    for test in flaky:
        print(f"::warning title=Flaky ({lane})::{test} passed only on retry")
    if "GITHUB_STEP_SUMMARY" in os.environ:
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(f"### Flaky ({lane})\n\n" + "".join(f"- `{test}`\n" for test in flaky) + "\n")


def run(args):
    # This is the first operation in test-web: include dependency setup and all reporting,
    # rather than only the child command's E14 interval.
    started = time.monotonic()
    if args.install_dependencies:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "tools/e14/requirements.txt"], check=True)
    result = observe_lane(args)
    if not args.lane.startswith("web"):
        return result
    report = json.loads((args.output / "web.json").read_text())
    modules = report["modules"]
    if not isinstance(modules, list) or not modules:
        raise ValueError(f"{args.lane}: missing web file timing evidence")
    executed = []
    for module in modules:
        if module["state"] == "skipped":
            continue
        duration = module.get("duration_ms")
        if type(duration) not in (int, float) or not math.isfinite(duration) or duration < 0:
            raise ValueError(f"{args.lane}: invalid file duration for {module['id']}: {duration!r}")
        executed.append((module["id"], duration))
    if not executed:
        raise ValueError(f"{args.lane}: no executed web file timing evidence")
    elapsed = time.monotonic() - started
    if elapsed > 720:
        print(f"{args.lane}: {elapsed:.3f} seconds exceeds 720-second budget; slowest files:")
        for path, duration in sorted(executed, key=lambda row: (-row[1], row[0]))[:5]:
            print(f"  {path}: {duration:g} ms")
        result = result or 1
    metadata_path = args.output / "lane.json"
    metadata = json.loads(metadata_path.read_text())
    metadata.update(web_step_elapsed_seconds=elapsed, exit_code=result)
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
    return result


def observe_lane(args):
    import psutil  # Installed only for observation, not for report validation.

    root = Path.cwd()
    if args.build_observation and (args.base or not args.lane.startswith("rust") or platform.system() != "Linux" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"):
        raise ValueError("build observation requires an unchanged full Rust lane on hosted Linux (empty BASE)")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)  # Never reuse stale passing evidence.
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if subprocess.check_output(["git", "status", "--porcelain"], text=True).strip():
        raise ValueError("measurement requires a clean checkout and output outside the repository")
    observer = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ("observe.py", "reporter.mjs.in", "requirements.txt", "rust-suites.json", "rust-wrapper.py")}
    cache = {"description": args.cache_state, "paths": {}}
    for name in ("target/debug", "node_modules/.pnpm", "node_modules/@anthropic-ai/claude-code"):
        path = root / name
        cache["paths"][name] = {"exists": path.exists(), "mtime_ns": path.stat().st_mtime_ns if path.exists() else None}
    locks = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ("Cargo.lock", "pnpm-lock.yaml")}
    env = os.environ.copy()
    if args.build_observation:
        import build
        env = build.prepare(root, output / "build", env)
        observer["build.py"] = hashlib.sha256(Path(__file__).with_name("build.py").read_bytes()).hexdigest()
    env["E14_RUST_EVENTS"] = str(output / "rust-events")
    env["E14_LIFECYCLE"] = str(output / "web.json")
    if args.lane.startswith("rust"):
        profile = "ci" + args.lane[4:]
        config = nextest_config(root, output, profile)
        command = ["python3", "loop/app-data.py", "just", "test-rust-since", args.base, "--profile", profile, "--test-threads", "4", "--config-file", str(config)]
    else:
        reporter = output / "reporter.mjs"
        reporter.write_text(Path(__file__).with_name("reporter.mjs.in").read_text())
        config = output / "vitest.config.mjs"
        config.write_text("import desktop from " + json.dumps(str(root / "apps/desktop/vite.config.ts")) + ";\nexport default { ...desktop, test: { ...desktop.test, reporters: [...desktop.test.reporters, " + json.dumps(str(reporter)) + ", [\"junit\", { outputFile: " + json.dumps(str(output / "junit.xml")) + " }]] } };\n")
        command = ["python3", "loop/app-data.py", "python3", "tools/chromium-faults/observe.py", "--log", str(Path(os.environ["RUNNER_TEMP"]) / f"chromium-faults-{args.lane[3:]}.jsonl") if "RUNNER_TEMP" in os.environ else str(output / "chromium-faults.jsonl"), "--", "just", "test-web-since", args.base, f"--shard={args.lane[3:]}/{args.shards}", "--config", str(config)]
    metadata = dict(lane=args.lane, commit=commit, full=not args.base, observer=observer, cache=cache, locks=locks, command=command,
                    runner={"name": os.environ.get("RUNNER_NAME", platform.node()), "hostname": platform.node(), "os": platform.platform(), "cpu_count": os.cpu_count(), "cpu": platform.processor(), "total_memory": psutil.virtual_memory().total,
                            "image": os.environ.get("ImageOS"), "image_version": os.environ.get("ImageVersion"), "type": os.environ.get("RUNNER_ENVIRONMENT", "local"),
                            "run": os.environ.get("GITHUB_RUN_ID"), "attempt": os.environ.get("GITHUB_RUN_ATTEMPT")},
                    memory={"source": "psutil.virtual_memory: total - available (whole runner, all processes)", "psutil": psutil.__version__, "sample_interval_ms": 50})
    if args.build_observation:
        metadata["build_observation"] = {"status": "incomplete", "path": "build"}
        metadata["runner"].update(architecture=platform.machine(), cpu_model=json.loads((output / "build/facts.json").read_text())["cpu_model"],
                                  repository=os.environ.get("GITHUB_REPOSITORY"), job=os.environ.get("GITHUB_JOB"), workflow_sha=os.environ.get("GITHUB_SHA"),
                                  run_url=f"{os.environ.get('GITHUB_SERVER_URL')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ.get('GITHUB_RUN_ID')}")
    # Sampling in the supervising process means an observer error cannot be lost in a thread. Samples stay in
    # memory until the lane ends: a write() during the build's debug-info flood blocks in the kernel's dirty-page
    # throttle for over a second, and the gap check would then fail the lane for the disk, not the sampler.
    samples = []

    def sample():
        vm = psutil.virtual_memory()
        samples.append(dict(at=time.time() * 1000, used=vm.total - vm.available, total=vm.total))
    sample()
    metadata["started"] = time.time() * 1000
    clock = time.monotonic()
    child = subprocess.Popen(command, env=env)
    try:
        while child.poll() is None:
            sample()
            time.sleep(0.05)
        metadata["exit_code"] = child.returncode
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait()
        metadata["elapsed_seconds"] = time.monotonic() - clock
        metadata["ended"] = time.time() * 1000
        sample()
        (output / "memory.jsonl").write_text("".join(json.dumps(row) + "\n" for row in samples))
        (output / "lane.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if args.memory_log:
        args.memory_log.with_suffix(".stop").touch()
        for _ in range(200):
            if args.memory_log.with_suffix(".done").exists():
                break
            time.sleep(0.05)
        else:
            log = args.memory_log.with_suffix(".log")
            cause = log.read_text().strip() if log.exists() else ""
            raise ValueError(f"whole-lane memory observer did not finish: {cause or 'no collector message'}")
        (output / "memory.jsonl").write_bytes(args.memory_log.read_bytes())
        metadata["memory"]["coverage"] = "from before CI setup through test command completion"
        (output / "lane.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if args.build_observation:
        try:
            compiled = build.report(output / "build")
            (output / "build/summary.json").write_text(json.dumps(compiled, indent=2) + "\n")
            metadata["build_observation"]["status"] = "valid"
        except (OSError, ValueError, KeyError) as error:
            metadata["build_observation"].update(status="invalid", error=str(error))
            raise
        finally:
            (output / "lane.json").write_text(json.dumps(metadata, indent=2) + "\n")
    report_flaky(args.lane, output)
    if metadata["exit_code"]:
        return metadata["exit_code"] if metadata["exit_code"] > 0 else 1
    if args.lane.startswith("rust") and (output / "junit.xml").exists():
        (output / "lifecycle.json").write_text(json.dumps(rust_rows(output / "junit.xml"), indent=2) + "\n")
    if args.lane.startswith("web") and (output / "web.json").exists():
        (output / "lifecycle.json").write_text(json.dumps(web_rows(output / "web.json"), indent=2) + "\n")
    if args.base:
        print("Selected PR run recorded; not full-run E14 evidence.")
        return 0
    print(json.dumps(evidence(output), indent=2))
    return 0


def job_name(lane):
    return lane.replace("rust", "rust ").replace("web", "web ")


def compare(args):
    results = []
    cache_logs = {}
    jobs = {}
    for label, directory in (("baseline", args.baseline), ("head", args.head)):
        log_path = args.baseline_log if label == "baseline" else args.head_log
        if log_path:
            cache_logs[label] = log_path.read_text()
        jobs_path = args.baseline_jobs if label == "baseline" else args.head_jobs
        if jobs_path:
            jobs[label] = json.loads(jobs_path.read_text())["jobs"]
        for lane in LANES:
            row = evidence(directory / lane)
            if not row["full"] or row["lane"] != lane or not row["cache"]["description"].strip():
                raise ValueError(f"{directory / lane}: missing full-run provenance")
            if row["runner"]["run"]:
                if label not in cache_logs:
                    raise ValueError(f"{label}: CI setup log required for cache restore provenance")
                job = job_name(lane)
                lines = [line for line in cache_logs[label].splitlines() if line.startswith(job + "\t") and "Run ./.github/actions/setup\t" in line and re.search(r"Cache hit for:|Cache not found|Restored from cache key|Cache restored from key:", line)]
                if not lines:
                    raise ValueError(f"{label} {lane}: missing cache restore outcomes")
                row["cache"]["restore_log"] = lines
                row["cache"]["outcomes"] = ["hit" if "Cache hit for:" in line else "miss" for line in lines if "Cache hit for:" in line or "Cache not found" in line]
                if label not in jobs:
                    raise ValueError(f"{label}: Actions jobs JSON required for full lane elapsed time")
                matches = [job for job in jobs[label] if job["name"] == job_name(lane)]
                if len(matches) != 1 or matches[0]["conclusion"] != "success":
                    raise ValueError(f"{label} {lane}: missing successful job timing")
                job = matches[0]
                if job["head_sha"] != row["commit"] or str(job["run_id"]) != row["runner"]["run"]:
                    raise ValueError(f"{label} {lane}: job provenance does not match measurement")
                row["job"] = {field: job[field] for field in ("html_url", "runner_name", "labels", "started_at", "completed_at")}
                row["job_elapsed_seconds"] = (datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00")) - datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))).total_seconds()
            results.append((label, row))
        commits = {r["commit"] for side, r in results if side == label}
        if len(commits) != 1:
            raise ValueError(f"{label}: mixed commits")
        rust = [json.loads((directory / lane / "lifecycle.json").read_text()) for lane in LANES[:5]]
        if not any(r["id"].startswith(RUST_SUITES["required_test_prefix"]) for rows in rust for r in rows):
            raise ValueError(f"{label}: missing B21 lifecycle evidence")
        if not any(r["real"] for lane in LANES[5:] for r in json.loads((directory / lane / "lifecycle.json").read_text())):
            raise ValueError(f"{label}: missing real-Claude web lifecycle evidence")
    for lane in LANES:
        before, after = [r for _, r in results if r["lane"] == lane]
        if before["observer"] != after["observer"]:
            raise ValueError(f"{lane}: observer revisions differ")
        for field in ("os", "cpu_count", "total_memory", "image", "image_version"):
            if before["runner"][field] != after["runner"][field]:
                raise ValueError(f"{lane}: non-equivalent runner {field}")
        if before["cache"].get("outcomes") != after["cache"].get("outcomes"):
            raise ValueError(f"{lane}: non-equivalent cache restore outcomes")
        if before["cache"]["description"] != after["cache"]["description"]:
            raise ValueError(f"{lane}: non-equivalent cache states")
    print("| Run | Commit | Lane | Command seconds | Full CI job seconds | Peak runner bytes (50 ms samples) | Max real-Claude tests |")
    print("| --- | --- | --- | ---: | ---: | ---: | ---: |")
    for label, row in results:
        print(f"| {label} | {row['commit']} | {row['lane']} | {row['elapsed_seconds']:.3f} | {row.get('job_elapsed_seconds', 'local command only')} | {row['peak_runner_bytes']} | {row['overlap']} |")
    print("\nProvenance (runner identity, cache state, exact commands, lock hashes):\n")
    print("```json\n" + json.dumps([dict(run=label, **row) for label, row in results], indent=2) + "\n```")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    lane = sub.add_parser("run")
    lane.add_argument("--install-dependencies", action="store_true", help="Include observer dependency installation in the web step budget")
    lane.add_argument("--lane", choices=LANES, required=True)
    lane.add_argument("--output", type=Path, required=True)
    lane.add_argument("--shards", type=int, default=sum(name.startswith("web") for name in LANES), help="The web shard count the lane's number is one of")
    lane.add_argument("--cache-state", required=True, help="Actual restore hits/misses and keys, or explicit cold-cache preparation")
    lane.add_argument("--build-observation", action="store_true", help="CI3781: opt-in hosted Linux Cargo timings and passive linker exec/exit evidence; full Rust lanes only")
    lane.add_argument("--memory-log", type=Path, help="Whole-job collector started before CI setup")
    collector = sub.add_parser("memory")
    collector.add_argument("--output", type=Path, required=True)
    lane.add_argument("--base", default="", help="PR selection only; nonempty runs cannot enter an E14 comparison")
    report = sub.add_parser("compare")
    report.add_argument("baseline", type=Path)
    report.add_argument("head", type=Path)
    report.add_argument("--baseline-log", type=Path, help="gh run view BASELINE_RUN --log output")
    report.add_argument("--head-log", type=Path, help="gh run view HEAD_RUN --log output")
    report.add_argument("--baseline-jobs", type=Path, help="Actions baseline run jobs API response")
    report.add_argument("--head-jobs", type=Path, help="Actions head run jobs API response")
    args = parser.parse_args()
    try:
        if args.mode == "memory":
            return memory(args)
        return run(args) if args.mode == "run" else compare(args)
    except (OSError, ValueError, KeyError, ET.ParseError) as error:
        print(f"E14 observation FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
