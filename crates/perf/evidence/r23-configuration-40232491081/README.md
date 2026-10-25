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

## Observed transitions

[Write metrics](table.md) and [all eight metrics](all-metrics.md) retain ranges
and each adjacent-state paired difference. The artifact's `assessment.json`
also retains every per-repeat value and ratio. All 48 invocations are qualified,
loads 1.46–4.00 on four CPUs, with no skipped metrics or busy repeats. All return
1 against the labelled diagnostic sentinels. Cold start is 12.418899–51.433453 ms,
output p95 0.255790–0.507042 ms and extra RSS 2.398438–3.386719 MB, below their
unchanged absolute limits. No latency comparison is a clean R16 verdict.

Configuration-only effects have mixed signs across groups. Hooks and markers
each increase both write p95s in all three paired repetitions of all four
groups here. Caller allocations/runtime construction and formatting/lock/write
remain the separate coupled transitions described above. These observations
cannot assign useful-task CPU. [Every nonzero command](failures.md) includes the
scratch misses and unsupported attempts; `setup-attempts.md` in the artifact
retains the preliminary setup/syntax failures and their actual statuses.

The final verifier confirms fixed hashes and event lists, one fresh Daemon in
each invocation, no diagnostic markers in the three non-marker states, and both
1100-turn external marked loops in every marked invocation. All 144 corrected
decoder commands return 0; no decoded LOST record appears. This is absence of
reported loss, not a universal loss-free guarantee. `integrity-summary.json`
records the boot and recorder events; detailed per-invocation identities and
counts remain with profiles in the artifact.

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

The recorded decoder uses sudo perf and expects root-owned `.data` files.
After extraction, restore that ownership before decoding (or use the reader's
force option); return ownership to the run user before packing. The first decoder
set rejected runner-owned files with exit 255; its commands/statuses are retained
as `decode-v1-*`. The first verifier omitted the optional Terminal field in the
external marker syntax, failed with exit 1, and is retained as `verify-v1.*`; the
repair preserves both 1100-turn loops rather than dropping records. Setup failures
and the inherited-main lint failure are also retained, separately from controls.

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
