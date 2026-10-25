# R23 diagnostic configuration, hooks and marker output (#4128)

Hosted [job 40232491081](https://github.com/roundup-app/roundup/actions/runs/40232491081)
records Ubuntu 24.04, AMD EPYC 7763, four available CPUs and affinity 0–3.
Raw evidence is retained outside git in this job's `answer-4128` artifact,
`r23-configuration/`. Commands, actual statuses, timing records, source archives,
patches, executable bytes/hashes, profiles and assessment travel together.

Historical: `2029ed2c4ee606d26e73c858c4d7c93130df36e0`.
Candidate: `50e546c1a3ce74689738b08a3dfe273895f9ae31`.
Both use Rust 1.99.0 (`b940084d7`), Cargo 1.99.0 and their locked dependencies.
The producer archive supplies the original release and complete diagnostic
executables, both CLIs, and common/marked observers. All ten restored files match
its recorded SHA-256 values; existing states are never rebuilt.

| State | Source | Effective release additions | Diagnostic execution |
|---|---|---|---|
| release | Unmodified pin | None | Default runtime |
| configuration | Unmodified pin | `--cfg tokio_unstable`, debug=1, strip=none | Default runtime |
| hooks | Committed diagnostic patch | Same additions | Registered spawn/before/after-poll callbacks and delegated wakers; marker body disabled |
| markers | Archived complete patch | Same additions | Complete original diagnostic hooks and synchronous marker output |

The hook-only patch replaces only `r23_mark`'s body with argument consumption.
The selected futures, delegated wakers, runtime registration and measured
request/echo workload remain. This state emits no complete task-poll profile;
absence of markers is never absence of polls. Caller-side `format!`, labels,
clones, allocations and optimizer effects remain coupled to this transition.
The hooks transition also includes replacing the macro entry point with an explicit
runtime builder/block_on wrapper and all original diagnostic dispatch markers.
The marker transition includes formatting, TLS identity, clock/task lookup,
stderr locking/writes and resulting scheduling; it isolates no individual part.

This host has no measured five-metric R16 baseline. `configure-scratch.py` adds
labelled zero sentinels for those metrics to allow the unchanged observer to
write reports. They are not measured or copied baselines; all resulting scratch
verdicts remain diagnostic misses. Archived scratch inputs are retained separately.
Absolute limits, noise and R13 thresholds are unchanged; no 9V45 timings are
substituted for this 7763 host.

## Source and executable boundaries

`nm -S -C` and address-range `objdump -Cd` locate the actual archived routines:
historical `r23_mark` at `0x1301a0`, its TLS closure at `0x13df30`, delegated
`wake_by_ref` at `0x131490`; candidate equivalents are `0xa01ee0`, `0xb57ec0`
and `0xa0f2f0`. The delegation disassembly calls the marker/TLS path before
calling the original waker indirectly. The marker source formats a line, locks
stderr and calls `Write::write_all`; TLS closure disassembly contains the
`StderrLock` drop path. ELF `readelf -rW` resolves its three indirect calls:

| Operation | Historical target / GOT slot | Candidate target / GOT slot |
|---|---|---|
| `alloc::fmt::format::format_inner` | `0x42ef20` / `0x4500b8` | `0x17872b0` / `0x183e478` |
| `Stderr::lock` | `0x40bc80` / `0x450880` | `0x175f4b0` / `0x18412f0` |
| `StderrLock::write_all` | `0x420c90` / `0x450888` | `0x1778f40` / `0x18412f8` |

This locates formatting, locking, writing and wake delegation in the measured
executables; it establishes neither durations nor CPU attribution.

The initial demangled `objdump --disassemble=rupd::r23_mark` exits 0 but emits
only section headings: unsupported symbol selection, not an empty routine.
Address-range inspection supplies instructions. Local Rust std source lookup
exits 1 because rust-src is absent; retained pinned patch, ELF symbols and
instructions supply the supported observation. No new probe set is installed.

The existing scheduler/syscall recorder from #4110 is held fixed across states:
`perf record -a --clockid mono -m 32M`, original scheduler/syscall events and
syscall `--exclude-perf`. Existing recorder controls remain conditional evidence,
not a universal overhead bound for these additional configurations.

## Interpretation

Each transition is assessed per metric and repetition. Invocation p95 deltas
and ratios describe observed variation only; negative values remain observations.
They are neither universal nor per-stage bounds and cannot correct clean p95s.
Thread on-CPU/runnable/non-runnable intervals include observer/kernel/other-task
execution. Task poll intervals differ from thread state and include diagnostics.
Formatting, locking, writes, delegation and recorder execution are not separately
attributed. The earlier 2200-window fd2 intersection table alone does not complete
this experiment or establish full logger cost.

Exact queue insertion and byte-publication linearization remain unsupported.
Native task/write identities from #4122 do not make function entries exact
linearization points. Acceptance is input acknowledgment, not physical completion;
pre-write pending-read idle time is not write cost, and overlapping reply/output
branches are never added. Useful-task CPU remains unknown under
[#4031](https://github.com/roundup-app/roundup/issues/4031),
[#3760](https://github.com/roundup-app/roundup/issues/3760) and
[#3720](https://github.com/roundup-app/roundup/issues/3720).

The original six clean observations remain labelled history only. This job adds
no replacement clean campaign, R16 verdict/calibration, baseline increase,
cross-class substitution or production repair. R8 pins, R13 ≤2.0 per available
CPU, R15 one-unread pacing, R16 historical ceilings and absolute limits remain.

## Reproduction

Extract the artifact into a fresh directory. `r23-configuration/` retains the
setup/build/capture/decoding/assessment scripts and each command/status, including
unsupported attempts. Verify `restored-hashes.json` against the producer archive
and `all-state-hashes.json` against the retained executables before replay.
Restore executable files under `/tmp/r23-queue-bins` for symbolization. Restore
source archives to their recorded `/tmp/r23-historical` and `/tmp/r23-candidate`
paths only in a dedicated scratch environment.

For a fresh collection, adapt only output/job paths in retained setup scripts,
restore existing executable bytes, build both new states at both pins with the
recorded command, run `configure-scratch.py RAW` for the labelled zero sentinels,
finish all builds/lints/compression/offline setup, then run the
capture script. For each pin/common-or-marked observer it alternates release →
configuration → hooks → markers for three cycles. Every invocation uses one
fresh Daemon, ten login shells, `--runs 1 --calls 1000`, unchanged warmups and R15
pacing. Keep every failure, miss, skipped attempt and repeat; a busy cycle does
not count. Decode only after collection. Replay `assess-r23-config.py RAW NEW_OUT`
for per-metric values, ranges, paired differences/ratios and failure rows.
