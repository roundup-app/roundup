# Prepared-directory warm-launch observer (G2542e)

The observer is the test `g2542e_warm_launch_observer` in `crates/agents/tests/scenarios/prepared_observer.rs`. It needs `node`, `python3`, `cargo` and `git` on `PATH`.

## What it does

1. Starts a Project repository and two Worktrees (`a`, `b`), then prepares each (outside any timing) with real dependency roots for the three ecosystems: a Node module under `node_modules/`, a release binary built by `cargo` under `target/`, and a `python3 -m venv` whose console script names its interpreter by absolute path under `.venv/`, plus a local `.env`. Each root is padded with ignored files until a directory holds at least 10,000.
2. Enrolls both with `project.setPrepared`. The readiness command and the launched process both run the three smoke commands (`prepared_support.rs`: `smoke_all`).
3. Makes twenty sequential assignments to the same target commit (`agent.spawn`, then `rail.remove`), alternating which directory is first in line. Each is timed from the request to the launched process's first successful smoke result (a marker file, polled every 2 ms).
4. Observes, per assignment: every installer (`npm`, `pnpm`, `yarn`, `pip`, `pip3`, `uv`, `poetry`, `cargo fetch|build|install|add|update|run`) is a shim that logs and fails (the log must not exist); on Linux, inotify watches every directory and file under the dependency roots and reports any create, write, rename, unlink or attribute change (it must report none). At the end every dependency file's device, inode, size, mtime and ctime equals its value before the first assignment.
5. Passes when the nearest-rank p95 (the 19th of the 20 sorted times) is at most 5,000 ms.

## Report

`report.json` and `identities-0.txt`, `identities-1.txt` go to `$G2542E_REPORT_DIR` (default: a temporary directory), and the report prints on stderr after `G2542E`. It holds the OS, filesystem, tool versions, the fixture counts per root, all twenty times, p95, and each dependency file's identity.

```sh
G2542E_REPORT_DIR=$PWD/g2542e-report cargo nextest run -p agents g2542e_warm_launch_observer --no-capture
```

## Managed Mac with Defender enabled

Run the same command on the managed Mac with the protection left as the organisation configures it. Do not request exclusions and do not disable protection. On macOS the filesystem observer is the snapshot comparison only (no kernel event stream); record `fs_usage -w -f filesystem` output for the `node`, `python3` and `target/release/smoke` processes during one assignment if the machine permits it. Save the Mac `report.json` separately from the Linux one. A Linux pass proves reuse of dependency roots, not Defender latency; without the Mac report the Defender claim stays unverified, and that does not block the Linux delivery.
