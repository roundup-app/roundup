# R23 qualified task/queue capture (#3991)

[Builder 40186616032 / job 121148876933](https://github.com/roundup-app/roundup/actions/runs/40186616032/job/121148876933)
retains a new qualified 9V45 lifetime for #3983's assessment under #3760 and
#3720. This delivers raw capture and executable material, not their causal
assessment or a performance pass. Those parent Issues remain open.

## Identity and inputs

Ubuntu 24.04, x86_64, exact `AMD EPYC 9V45 96-Core Processor`, online and
allowed CPUs `0-3`, nproc 4. Qualification before/after/final exits 0. Runner
`GitHub Actions 1000013020` (id 1000013020), boot
`d06f743f-9a7c-4ee5-9280-6560cbf7f75a` before and after. The jobs responses,
qualification commands, machine facts and boot records retain these observations.

Historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0` and candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31` were built here with rustc/cargo
1.99.0, the same unset build overrides and each reference's default release
settings. `build-settings.json`, build commands/logs/statuses and source records
retain settings. The first candidate build overlapped diagnostic edits and
failed; only the subsequent restored-source build supplies its unmodified binary.

`reused-input-hashes.json.gz` pins #3982's entire
`../r23-spans-40175332310/`, the six original clean observations in
`../r23-host-40170055163/` and #3975's offline extraction in
`../r23-attribution-40174335770/`. Both prior probe executables were restored
from #3982's archive unchanged. Its four controls, 2200-write captures, syscall
and scheduler records remain inputs, not replacements for a new clean pair.
No clean timing pair or aggregate CPU table was repeated.

## Retained capture

```text
request receive → dispatch enter → user-write call → acceptance return
                → dispatch exit → reply queue send → writer dequeue → socket
PTY read exit → output forward receive → output queue send → writer dequeue → socket
                         ↕ task poll / delegated wake markers
```

`*-instrumentation-v3.patch.gz` contains temporary changes only within each
reference's `crates/rupd/src/`. The production tree is unchanged. Markers retain
Linux CLOCK_MONOTONIC Instant seconds/nanoseconds, PID/TID, Tokio task identity,
connection FD, request id and Terminal/payload. Std `poll_fn` brackets the
selected futures; std `Wake` delegates to their original wakers. Wake markers
name the target task separately from the calling task. V3 formats a line before
one stderr write; the earlier V1/V2 source diffs, failures and executables remain.
Marker allocation, formatting, stderr locking/writes and delegated waker costs
perturb the task. None is subtracted or assigned to useful application work.

Each marked V3 control, scheduler-only, unfiltered kernel and filtered `low`
recording correlates all 2200 writes with dispatch entry/exit, user acceptance,
reply send/dequeue and output receive/send/dequeue. `capture-integrity.json`
records counts and one first-measured echo example per capture;
`*-writes.csv.gz` holds every joined write. Both loops retain 100 warmups and
1000 measured turns each. Echo identity is Terminal 11 and ordinal on the
selected connection; its payload remains `a` (`YQ==`), with at most one unread
write. Candidate output offsets are retained; historical output has no offset.

`*-markers.jsonl.gz` retains all task markers, not only the example. Raw Daemon
logs, marked probe stderr, original JSON reports, /proc snapshots and kernel
recordings remain alongside them. PID/TID/FD associations are local to one
recording; never transfer them across invocations. /proc snapshots bracket their
reads with monotonic timestamps and retain thread names, descriptor targets,
command/executable identity and process status. Thread names are kernel-truncated.

`*-low.data.gz` records scheduler switch/waking/wakeup and physical syscall
entry/exit on `--clockid mono`. Every selected syscall event uses installed
perf's `--exclude-perf`; this excludes its own syscall feedback, not all observer
cost. These endpoints use tracepoints, without ptrace stops. Earlier unfiltered
kernel captures and their overhead remain. `*-sched.data.gz` and their extracted
text are scheduler-only observations, lacking syscall endpoints. #3982's
separate strace records remain ptrace-perturbed; none is conflated with these.
Recorder stderr preserves out-of-order warnings; consumers must use timestamps,
not text order. The capture logs report no lost-event warning.

`physical-endpoints.json` identifies the two filtered marked captures, thread
names, descriptor targets and same-write socket/PTY endpoints. Each contains
2200 successful one-byte input writes and 2200 one-byte PTY reads, joined by
R15 ordering in `*-physical-writes.csv.gz`. `*-syscalls.jsonl.gz` retains the
Daemon's selected thread endpoints, arguments and actual return values. The raw
recording also retains the probe, shell/cat and scheduler context.

| First measured echo | Historical | Candidate |
|---|---:|---:|
| Daemon PID / request id | 45709 / 3453 | 50207 / 3455 |
| Request / output socket FD | 19 / 48 | 34 / 63 |
| Input TID / physical write FD | 46805 / 54 | 51311 / 69 |
| PTY reader TID / physical read FD | 46804 / 53 | 51310 / 68 |

These are identity examples, not clean timings or an attribution result.
All workload/control/status rows, including failures, are in [controls.md](controls.md).
Every workload exits 1 against diagnostic scratch ceilings; skipped lists are
empty. Common/marked controls exist against each identical unmodified and V3
Daemon. A single control comparison establishes no repeatable overhead bound.

## Remaining observations and bounds

| Missing boundary | Precisely retained interval / limitation |
|---|---|
| Actual producer input enqueue inside `terminal` | `user_call_ns` through `accept_return_ns` in each joined row. Historical module call includes decode/validation; candidate call includes user routing. No source outside `rupd` was changed. |
| Output producer publish/enqueue inside `terminal` | Successful physical PTY `read` exit through the corresponding `output_forward_receive_ns`, matched by Terminal and one-unread echo ordinal. It includes producer processing and receiver/task scheduling. |
| Exact runtime scheduler enqueue / full task poll | Wake marker precedes logging and the original waker delegation; the next selected-future poll entry is observable. The underlying task may also poll other branches. These are neither exact executor enqueue endpoints nor whole-runtime task polls. |
| Unmodified Daemon's internal task stages | Internal markers exist only on the instrumented executable; unmodified controls retain syscall/scheduler endpoints. No instrumented stage gap is transferred to a clean p95. |

For example, historical request 3453 bounds input enqueue within monotonic
924203286684–924203292413 ns, and output producer/receiver work within PTY read
exit 924203359514 through forward receive 924203378593 ns. Candidate request
3455 bounds them within 959247165918–959247173830 ns and
959247215352–959247260000 ns respectively. These include observer effects.
Acceptance means enqueue acknowledgment, never physical PTY completion.

Kernel on-CPU intervals include instrumentation and kernel execution. Thread
wake-to-switch runnable delay is distinct from task wake/poll gaps. Physical
blocking, runtime task parking, logger contention and unresolved runtime-task
delay cannot be inferred from one another. Reply/output branches overlap;
no elapsed syscall totals or stage percentiles are added. #3983 must assess
supported attribution and leave unsupported attribution incomplete.

## Executable retention and reproduction

`executables.tar.gz.part-*` retains both pristine references, their rup/perf
builds, both unchanged prior probes, V2 diagnostic Daemons and final V3
Daemons. `hashes-v3-before.stdout.gz`, `hashes-after.stdout.gz` and
`hashes-final.stdout.gz` retain SHA-256 and GNU build IDs. Before/final hashes
are identical, and every executable is in the archive. See [reproduce.txt](reproduce.txt).

The first V2/common kernel attempt generated a large observer-feedback recording.
Its raw data and extracted output are preserved as zstd streams split into
32 MiB parts. Their manifests pin concatenation order, whole compressed SHA-256
and size; `.uncompressed-sha256` records verify recompression retained every byte.
The executable archive uses the same splitting convention. No chunk is a
standalone compressed stream. All other large raw text is losslessly gzip
compressed. `checksums.json.gz` covers every retained file except itself.

R8 pins, R13 load qualification, R15 pacing, R16 ceilings, rule 7 absolute
limits and macOS behavior are unchanged. No calibration, baseline, contract,
App, workflow, runner provisioning or production repair changed. No synthetic
timing acceptance test or Mac observation is introduced.
