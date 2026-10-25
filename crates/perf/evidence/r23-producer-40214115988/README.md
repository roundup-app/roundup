# R23 producer and initial-dispatch capture (#4032)

Builder [40214115988](https://github.com/roundup-app/roundup/actions/runs/40214115988)
records the hosted CPU without a model eligibility gate. `qualification.command`
checks nonempty model, Ubuntu 24.04, x86_64, four available/online CPUs and
unrestricted affinity. `lifetime.json`, `jobs-before/after`, `machine`,
`build-settings.json`, process/load snapshots and matching boot records identify
this one execution lifetime. Both pinned builds and every control ran here.
Earlier qualification misses remain history, including this PR's first attempt.

Historical pin: `2029ed2c4ee606d26e73c858c4d7c93130df36e0`.
Candidate pin: `50e546c1a3ce74689738b08a3dfe273895f9ae31`.
Pristine builds use the same toolchain, commands and each pin's default release
profile. Diagnostic builds use the same additional settings at both pins:
`RUSTFLAGS=--cfg tokio_unstable`, release debug=1 and strip=none. The additional
settings enable supported source probes and runtime hooks; their effects stay
inseparable from instrumentation in the controls. No production source or
committed budget/provenance value changes.

The unchanged common/marked observers are restored from the earlier retained
archive. SHA-256: common
`48d58743ec3266855b0dfd12a249fe94e70951ad6aaa97918bca66cdab27d692`, marked
`73cf6d7229051bf9610237d25bc11ba4a1ec4c08e68d0c1cde381f1ef2d291bb`.
`hashes-before/after` and the executable archive retain the actual captured bytes.
The diagnostic scratch budgets/provenance are explicitly uncalibrated and remain
separate from committed budgets.

```text
request receive → submission bracket / first selected poll → dispatch prologue
                → field extraction / routing → user call → acceptance
physical PTY read → producer processing / publication → forward receive
spawn / full runtime poll hooks ↔ delegated wake / selected-future polls
```

Diagnostic source patches touch only each pin's `crates/rupd/src/`. Dispatch
prologue precedes id/method/parameter extraction, but follows JSON parsing.
Candidate task submission is bracketed around `JoinSet::spawn`; first selected
poll can precede submission return on another worker, so those intervals are
never subtracted in a presumed serial order. Historical dispatch is in the
connection task and has no equivalent per-request spawn.

Tokio's supported `on_task_spawn`, `on_before_task_poll` and
`on_after_task_poll` hooks identify spawned tasks explicitly through `TaskMeta`.
Full-poll hook intervals include the hook's own logger/delegation work; they are
not useful-task CPU. They exclude the root `block_on` future and blocking tasks.
`on_task_spawn` precedes spawning, not executor enqueue. No supported exact
wake-to-executor-enqueue timestamp is supplied. The original selected-future
poll and delegated-waker markers remain separately identified.

Producer investigation uses the actual pinned `terminal` sources and executable
symbols. Historical input is `Terminals::write`, candidate input is
`Terminals::enqueue`; both output loops are `pump` in `crates/terminal/src/lib.rs`.
Neither pin has `crates/terminal/src/pty.rs`. Historical publication precedes title
parsing; candidate publication follows screen/parser/log work. Accepted source
probes, their resolved addresses, rejected optimized lines and symbol fallbacks
are retained with actual statuses. Optimized line-address mappings are not exact
queue linearization points. A function entry or source inspection alone never
supplies an enqueue timestamp.

`capture-integrity.json`, `physical-endpoints.json` and the CSV/marker files join
both 2200-write captures by request, Terminal 11, one-unread echo ordinal, task,
PID/TID and original socket/PTY descriptors. Pending reads can begin before a
write; their earlier idle time is never charged to it. `assessment.json` retains
thread on-CPU/runnable/non-runnable intersections separately from task wake/poll
intervals, with an example per reference. Scheduler transitions are sorted by
timestamp. Thread CPU includes observer/kernel work and other tasks.
`new-boundaries.json` adds producer-probe hits, pre-extraction dispatch entry,
submission/first-poll bounds and complete runtime-poll hook intervals.

## Controls and remaining attribution

Three alternating unmodified/instrumented pairs for each pin and each probe use
one fresh Daemon, ten login shells, unchanged warmups/calls and R15 pacing.
Builds, tests, compression and offline analysis do not overlap the controls.
Each invocation retains JSON, per-run samples, load, command, wall duration,
startup/observer logs, process snapshots and actual status. These diagnostics are
not eleven-Daemon clean timing observations. `control-assessment.json` reports
ranges and each paired instrumentation ratio separately for both write metrics.
A range from three repetitions is observed variation, not a universal overhead
bound or a per-marker correction. Source-probe/perf recorder costs occur only in
the profiles and remain inseparable; no diagnostic interval is subtracted from a
clean p95 or added across overlapping reply/output branches. Acceptance is input
queue acknowledgment, never physical PTY completion.

The six earlier clean observations are history only. In that older lifetime,
`terminal_write_p95_ms` fit its historical-derived ceiling in all three candidate
invocations; separately, `write_to_output_p95_ms` also fit in all three. Neither
result is the comparison base for this job. This execution-only investigation
collects no replacement clean campaign and supplies no fresh clean timing verdict,
R16 calibration or baseline. R8 pins, R13's 2.0 load per CPU, R15 pacing, R16
historical ceilings and absolute limits remain unchanged.

Exact executor enqueue and unperturbed producer/task stage costs remain
unresolved. [#4031](https://github.com/roundup-app/roundup/issues/4031) owns that
remaining supported-hook/overhead investigation under
[#3760](https://github.com/roundup-app/roundup/issues/3760) and
[#3720](https://github.com/roundup-app/roundup/issues/3720); those Issues stay open.
New captures, repeated controls and their assessment complete this execution
prerequisite without claiming Daemon-only attribution.

## Offline reproduction

[reproduce.txt](reproduce.txt) lists fresh collection and offline replay separately.
Every command/status remains alongside its raw outputs; `failures.md` has one row
per nonzero attempt. `raw-sha256.json` identifies uncompressed evidence bytes, including the gzip-retained scripts.
Split archive manifests identify part order, original length and SHA-256.
Reassemble/decompress into a new scratch directory, never over retained files;
restore the archived executables at their recorded paths for perf symbolization.
Python's installed JSON/CSV/gzip/regex facilities and the retained observer scripts
perform joins and assessment. No synthetic timing acceptance test was added.

## Observed controls and samples

All 24 controls are load-qualified with empty skipped lists; all exit 1 against
the labelled diagnostic scratch ceilings. These are observations, not successful
R16 checks. Ranges below are the three invocation p95s in ms; ratios pair each
instrumented invocation with its immediately preceding pristine invocation.

| Pin / probe | Metric | Pristine range (ms) | Instrumented range (ms) | Paired ratio range |
|---|---|---:|---:|---:|
| historical-common | `terminal_write_p95_ms` | 0.052294–0.055474 | 0.101283–0.114513 | 1.844–2.064 |
| historical-common | `write_to_output_p95_ms` | 0.112239–0.213340 | 0.165134–0.169616 | 0.795–1.498 |
| historical-marked | `terminal_write_p95_ms` | 0.055394–0.057096 | 0.106801–0.109685 | 1.871–1.980 |
| historical-marked | `write_to_output_p95_ms` | 0.113070–0.115844 | 0.166060–0.169155 | 1.450–1.496 |
| candidate-common | `terminal_write_p95_ms` | 0.059760–0.061383 | 0.142154–0.167232 | 2.379–2.728 |
| candidate-common | `write_to_output_p95_ms` | 0.114343–0.116546 | 0.190267–0.197658 | 1.649–1.696 |
| candidate-marked | `terminal_write_p95_ms` | 0.065920–0.068644 | 0.147642–0.202195 | 2.240–2.948 |
| candidate-marked | `write_to_output_p95_ms` | 0.117317–0.122976 | 0.197268–0.210828 | 1.604–1.797 |

Control load ranges from 0.66 to 0.94 on four CPUs, below 8.0.
The historical/common echo outlier makes one instrumentation ratio less than
one; it is retained, not removed or used as a negative overhead correction.
The marked probe also increases candidate pristine request/reply p95s relative
to the common probe; probe and Daemon instrumentation remain separate factors.
These repetitions establish measured variation, not a stable stage correction.

Both profiles join exactly 2200 physical one-byte writes and reads, with no
truncated marker lines. The reference examples below are Terminal 11, echo
ordinal 100, first measured write-to-output turn. Values are observer-perturbed
monotonic ns, never clean p95 components or additive budgets.

| Sample / boundary | Historical | Candidate |
|---|---:|---:|
| PID / request / dispatch task | 45637 / 3453 / Some(Id(7)) | 46899 / 3455 / Some(Id(3578)) |
| Complete spawned-task poll hook pairs | 15522 | 21386 |
| Receive → dispatch prologue | 8914 | 38027 |
| Prologue → dispatch entry | 5288 | 3856 |
| User call → acceptance return | 17647 | 24737 |
| Physical read exit → forward receive | 52459 | 32800 |
| Input probe hits inside acceptance bound | 5 | 7 |
| Output probe hits inside producer/receiver bound | 3 | 1 |

Candidate request 3455 submission begins at 1091764835150,
returns at 1091764845996, and reaches the first selected poll at
1091764856302; its pre-extraction prologue is
1091764864063. Submission, runtime hooks and logging lie inside
these bounds; exact executor enqueue does not follow from them.

Every recorded dispatch selected future returns Ready on its first poll at both
pins (2200 each). This excludes a Pending return in that selected future only.
The full runtime hooks now separately show spawned-task polling; they include
observer execution and do not identify useful-task CPU or precise enqueue.
Historical `Terminals::write` has no emitted enqueue symbol (exit 237); supported
source probes supply 11000 input-line hits. Candidate `Terminals::enqueue` has
2200 entry hits. Historical `Shared::publish` source probes supply 6633 hits
across all Terminal output. Candidate's exact send line is optimized onto a
shared address (exit 254); the following source location supplies 2211 hits.
Pump entry occurs 11 times per pin, proving reader lifetime only, never a
per-output publication timestamp. All original event addresses/identities remain.

The matched pending physical read includes earlier idle time: thread-state
intersections below describe that syscall, not this write's blocking cost.

| Read-thread state (ns) | Historical | Candidate |
|---|---:|---:|
| on_cpu | 4657 | 4617 |
| runnable | 4306 | 1973 |
| sleeping | 231429 | 255375 |
| unknown | 0 | 0 |

Task wake/selected-poll gaps and each endpoint thread's scheduler partition stay
separate in `assessment.json`. Logger/waker delegation, other task execution and
runtime delay cannot be assigned to one another. Reply and output branches
overlap. No CPU or syscall elapsed total is added to an elapsed write metric.

The first offline assessor rejected coincident timestamps on different threads.
`assess-v1.py.txt.gz` retains that failed parser; the repaired assessor buckets every
marker by timestamp and matches endpoint stage identity without deleting any
record. The successful replay verifies counts, order and scheduler partitions.
