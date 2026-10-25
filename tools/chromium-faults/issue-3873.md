# U26 hosted bpftrace acceptance

Observed on main `e70c57f55f5ddb094fd2bfa2950dde23210a0d12`, after
[#3863](https://github.com/roundup-app/roundup/pull/3863) merged compatibility
commit `61eb23822ac31dc1b6dfc18ebf32189da1fa533b`.

Runner: Ubuntu 24.04.5 LTS (Noble), x86_64, Linux 6.17.0-1022-azure,
`bpftrace v0.20.2`. The workspace and fixture backing files are on ext4.
Installed `libfuse3-dev` and `fuse3`, and ran `pnpm install` in the isolated
worktree. No repository assertions or checks were changed.

The tracer before the repair (`61eb23822^:tools/chromium-faults/faults.bt`),
copied to `/tmp/u26-original.bt`, fails the installed compiler:

```text
$ sudo -n bpftrace -d /tmp/u26-original.bt 999999 4096 64
[DEBUG] libbpf: loading kernel BTF '/sys/kernel/btf/vmlinux': 0
/tmp/u26-original.bt:13:37-45: ERROR: Unknown function: has_key
tracepoint:sched:sched_process_fork /has_key(@tree, args.parent_pid)/ {
                                    ~~~~~~~~
```

Exit: **1**. This reproduces the
[failed hosted job](https://github.com/roundup-app/roundup/actions/runs/40150889474/job/121042093007).
The same compiler invocation against main's `faults.bt` exits **0**, producing
LLVM IR. The merged repair uses 0.20-compatible map reads and statement-form
deletions, bounds basename strings to 64 bytes, and uses `--no-warnings`.
Kernel fault identities, snapshots, lifecycle,
loss reconciliation and command-status preservation remain in place.

| Command after repair | Result | Exit |
| --- | --- | --- |
| `python3 loop/app-data.py python3 tools/chromium-faults/test.py` | 11 tests, OK; 37.407 s | 0 |
| `python3 loop/app-data.py python3 tools/chromium-faults/cold.test.py` | 4 tests, OK; 149.132 s | 0 |

The initial fault-suite setup attempt exited **1** with seven errors because
`pkg-config fuse3` could not find development headers. The passing run above
followed installation; it retains every existing assertion and uses real kernel
probes and the FUSE-held fault, including consumer loss, tracer death and stdout
backpressure cases. No test doubles replace kernel observation.

The cold suite used isolated headless Chromium with fresh profiles. Its held
pair rejected at 60031.510 ms and 60030.835 ms before release, with verified
fault evidence. Independent warmup remained pending at the 20122.591 ms cold
rejection. Both the ordinary concurrent pair and the delayed-release pair
answered twice with `42` and closed both owned browsers. The delayed pair reached
page readiness at 41043.893 ms and 41493.480 ms.

`just lint-web` exits **1** on main's unrelated
`apps/desktop/src/testing/u362_todo_drag.test.ts:76` comparison (TS2367: `"light"`
and `"dark"` have no overlap). This observer-only evidence change does not edit
that file or weaken the check.
`just lint-rust` exits **0**.

No product behavior or App surface changes; no Principle gate or design Check
moves. U26's existing kernel-fault and isolated headless Chromium suites are the
observers.
