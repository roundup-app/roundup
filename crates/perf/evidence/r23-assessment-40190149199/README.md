# R23 Daemon interval assessment (#3983)

The [qualified capture](../r23-queues-40186616032/README.md) resolves dispatch,
acceptance, reply queue and output forward/queue boundaries for both pinned
references. It does **not** establish a dominant cause or a Daemon-only regression.
This offline assessment completes #3983's bounded diagnostic outcome; #3760's
full attribution remains incomplete under #3720.

```text
request receive → [preprocessing / initial dispatch scheduling] → dispatch
  → [user call / input producer enqueue] → acceptance → reply send → dequeue → socket
PTY read exit → [producer publication / receiver scheduling] → forward receive
  → output send → dequeue → socket
```

## Inputs and method

No new workload or timing pair ran. The capture's exact 9V45 qualification,
boot identity, toolchain/settings, source diffs, twelve matching executables,
CLOCK_MONOTONIC records, FD associations, all attempts and controls remain
[retained](../r23-queues-40186616032/controls.md). This assessment consumes both
filtered marked observations: 2200 correlated writes each, including 100 warmups
and 1000 measured turns in each loop. `input-sha256.json` pins the six consumed
files and agrees with the capture's original checksum manifest.

`historical-intervals.csv.gz` and `candidate-intervals.csv.gz` retain every
request/connection/Terminal/echo identity, original endpoint and derived interval.
`assessment.json` retains the first measured echo's full selected-future polls,
delegated wakes and scheduler intersections. This deterministic example selection
matches the capture's existing examples; it selects no percentile or worst case.

Sorted scheduler switch records define thread execution. A switch out in R/R+
starts runnable delay; a sleeping switch starts non-runnable time until
`sched_wakeup` makes the thread runnable, then switch-in starts execution.
`sched_waking` is retained in the original recording but is not treated as the
completed runnable transition. Unobserved initial state remains unknown.
Thread-state partitions sum only within the same thread and interval. Endpoint
thread residency during a multi-task queue interval describes context, not the
queued task's execution. On-CPU includes observer work and kernel time.

## Supported distinctions

Both filtered observations have exactly 2200 dispatch polls, all returning ready
on their first selected-future poll. Thus no recorded dispatch future parks on
an async Pending return. This does not exclude thread preemption, blocking
inside a synchronous call, logger contention, or initial spawned-task scheduling.
Historical dispatch runs in the connection task; candidate dispatch has its own
task. The candidate's receive-to-entry interval includes spawning/initial polling;
there is no initial task enqueue marker to isolate that cost from preprocessing.

The following are **single observer-perturbed examples in ns**, historical
request 3453 / PID 45709 and candidate request 3455 / PID 50207, Terminal 11,
echo ordinal 100, payload `a`. They are not clean metrics or additive budgets.
Dispatch includes acceptance; queue branches overlap physical I/O and each other.

| Interval | Historical | Candidate | What it establishes |
|---|---:|---:|---|
| Receive → dispatch entry | 6890 | 17447 | Preprocessing/initial scheduling bound; entry is after field extraction. |
| Dispatch entry → exit | 11568 | 16645 | Selected routing/acceptance interval, entirely on its thread's CPU in these examples. |
| User call → acceptance return | 5729 | 7912 | Producer input enqueue lies inside; entirely on CPU here. |
| Reply send entry → dequeue | 20912 | 19830 | Includes send instrumentation, receiver scheduling and dequeue marker work. |
| Physical PTY read exit → forward receive | 19079 | 44648 | Producer publication plus receiver scheduling; not isolated producer CPU. |
| Forward receive → output send entry | 3575 | 3876 | Forwarding/frame construction plus marker work. |
| Output send entry → dequeue | 20181 | 31147 | Includes send and receiver/task scheduling; candidate also polls the reply branch. |

For these examples the reply and output queue endpoint threads remain on CPU
throughout their respective intervals. A queue wait therefore need not be
kernel runnable delay: another task and the marker logger can run on that same
thread. The retained task IDs and poll boundaries distinguish this from a
thread being scheduled out. No useful-task CPU budget follows from it.

| Delegated wake → matching selected poll | Historical | Candidate |
|---|---:|---:|
| Reply receiver | 9414 | 8082 |
| Output forward receiver | 12128 | 34092 |
| Output socket writer | 11297 | 19329 |

During the forward receiver gap its eventual polling thread has respectively
4146 / 5668 ns on CPU, 2003 / 1703 ns runnable, and 5979 / 26721 ns
non-runnable. This thread context includes logger/original-waker delegation
before the task can be scheduled; it cannot all be assigned to runtime delay.
The other two wake gaps are entirely on their polling thread's CPU in these
examples, while task IDs change. Exact executor enqueue, other tasks' complete
polls and observer overhead remain unobserved. Selected polls are not complete
Tokio task polls.

The matched physical PTY read spans respectively 198140 / 225381 ns:
4036 / 3976 ns on CPU, 2238 / 1382 ns runnable and 191866 / 220023 ns
non-runnable. A read was already pending before this request; its elapsed time
includes earlier idle waiting and is not this write's blocking cost. The sleeping
portion is physical-reader thread blocking context, distinct from a Tokio future
parking. Syscall elapsed is never added to these intersections or queue stages.

## Precisely remaining observations

| Missing observation | Bound and consequence |
|---|---|
| Dispatch prologue and initial executor enqueue | `request_received_ns` → `dispatch_enter_ns`; parsing, extraction, logging and candidate initial scheduling remain combined. |
| Producer input enqueue inside `terminal` | `user_call_ns` → `accept_return_ns`, e.g. 924203286684–924203292413 historical and 959247165918–959247173830 candidate. The historical call also includes module decode/validation. |
| Output producer publication/enqueue inside `terminal` | Physical read exit → `output_forward_receive_ns`, e.g. 924203359514–924203378593 historical and 959247215352–959247260000 candidate. Includes producer processing and receiver/task scheduling. |
| Executor enqueue and complete runtime polls | Delegated wake → next selected-future poll bounds logger/delegation and scheduling together; no exact executor enqueue or all-task CPU attribution. |
| Internal stages on unmodified binaries and isolated overhead | Only temporary patched binaries expose internal markers. Both probes run against each identical patched and unmodified binary, but one comparison and overlapping retention compression establish no isolated overhead bound. |

No producer boundary outside `rupd` is inferred or instrumented. User-write
completion remains enqueue acknowledgment, never physical PTY completion.

The original six clean reports and #3975 extraction remain unchanged. #3982's
four probe/identical-Daemon combinations, scheduler-only adapter execution,
FD-resolved ptrace timelines and executable archive remain independent inputs.
The new non-ptrace syscall endpoints narrow the physical observation without
making it unperturbed. Common/marked controls against each identical unmodified
and instrumented executable are retained; differences are not assigned to the
Daemon. Scheduler-only observations lack physical endpoints; ptrace observations
include tracer stops. Neither supplies missing task markers on clean binaries.

#3760 retains the existing paired per-metric conclusion and these unresolved
attribution bounds; #3720 owns further investigation/repair. No new p95, sum of
reply/output p95s, aggregate CPU table, clean timing pair, calibration, baseline,
production repair, App/contract change, Mac observation or synthetic timing
acceptance test is supplied. R8, R13, R15, R16 and rule 7 limits are unchanged.

## Reproduce offline

From the repository root, choose an empty output directory:

```sh
output=$(mktemp -d /tmp/r23-assessment-replay.XXXXXX)
gzip -dc crates/perf/evidence/r23-assessment-40190149199/assess.py.txt.gz > "$output/assess.py"
python3 "$output/assess.py" crates/perf/evidence/r23-queues-40186616032 "$output"
```

Compare `assessment.json`, `input-sha256.json`, and decompressed CSV contents
with this directory. Gzip container times may differ. Exit 0 asserts counts,
endpoint order, dispatch poll count and scheduler partition arithmetic, not
performance acceptance. Original capture reproduction and all failed attempts
remain in its [reproduction record](../r23-queues-40186616032/reproduce.txt).
