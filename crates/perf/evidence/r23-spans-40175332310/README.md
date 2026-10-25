# R23 correlated write diagnostics (#3976)

Pinned historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0` and candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31`; Builder 40175332310.
`qualification.command` exits 0 on this exact R16 9V45 host. `machine.stdout.gz`
and `lifetime.json` retain the OS, CPU, online/available CPUs, affinity, boot
identity, runner, toolchain, shell and observer versions. No host was allocated.

The six original clean observations in `../r23-host-40170055163/` remain the
comparison evidence. `input-hashes.json` pins them. The offline extraction in
[PR #3975](https://github.com/roundup-app/roundup/pull/3975),
`r23-attribution-40174335770`, establishes the earlier recordings' limits;
this collection adds per-loop/per-write and scheduler records without repeating
its whole-invocation CPU-table analysis.

`common-probe.patch` reproduces the prior compatibility changes on a scratch
candidate checkout. `marked-probe.patch.gz` additionally brackets the existing
probe operations. Both run against each identical, unmodified Daemon executable.
`final-hashes.stdout` retains executable SHA-256 hashes and GNU build IDs;
`build-settings.json` pins the shared toolchain and unchanged release settings.
The production checkout contains evidence only. No synthetic timing test,
production repair, budget, baseline, contract or App change is made.

## Supported attribution

Each marked observation contains exactly 2200 requests and echo bytes: two
loops, each with 100 warmups and 1000 measured calls. Loop begin/end markers and
turn/warmup fields keep them separate. `*-writes.csv.gz` joins request IDs,
request start/completion and receiver wake by loop/turn. Echo identity is Terminal
11 plus its ordinal on the single selected connection: the payload stays `a`
(`YQ==`), with at most one unread write. The candidate's output offset is retained;
historical output has no offset. Setup's `ready` frame is excluded by payload.
`loop_echo_completed_ns` includes the echo helper's logging; `echo_ns` is the
receiver's earlier recorded wake. Neither is RPC completion.

```text
request start → socket request → Daemon [dispatch, accept input, enqueue reply]
                                ├→ reply socket → decode/reply waiter → request complete
                                └→ input thread → PTY write → cat read/write → PTY read
                                   → [publish, forward, enqueue output] → output socket
                                   → JSON decode → adapt/deserialize/broadcast → receiver wake
```

The bracketed Daemon intervals remain unresolved. `*-marked.strace.gz` retains
nanosecond entry timestamps, actual results, resumed calls, FD/socket/PTY paths
and TIDs. `*.sched.data.gz` and `*-scheduler.stdout.gz` retain same-invocation
scheduler records. `*-sched-only.data.gz` and its extracted text observe the
workload separately without ptrace. No recording reports lost events.

The `adapter-cpu-summary.json` and `*-sched-only-adapter.csv.gz` intersect each
synchronous adapter interval with that exact OS TID's scheduler switch intervals.
All 2200 echo spans per reference are fully on CPU; observed off-CPU time is zero
in those spans, rather than an inference from gaps between CPU samples. These
are bounded on-thread execution measurements including kernel/waker work and
clock reads, not an assertion that every instruction is useful translation work.

| Stage, scheduler-only marked probe | Historical median / p95 ns | Native median / p95 ns |
|---|---:|---:|
| JSON frame decoding | 1031 / 1543 | 631 / 1012 |
| Value extraction | 80 / 120 | 40 / 60 |
| Insert historical offset | 110 / 180 | absent |
| Deserialize output | 100 / 141 | 130 / 210 |
| Lock, broadcast, receiver notification | 2724 / 3826 | 2654 / 3726 |
| Extraction through broadcast, measured jointly | 3024 / 4257 | 2824 / 3986 |

The joint adapter span, excluding warmups, remains separated by write loop:

| Loop (1000 calls each) | Historical median / p95 ns | Native median / p95 ns |
|---|---:|---:|
| Write to output | 3064.5 / 4296 | 2865 / 4036 |
| Request, then paced echo | 3005 / 3805 | 2804 / 3015 |

Each loop's 100 warmups has separate retained summary entries and CSV flags.

The historical branch's Value operations are directly bracketed in `read_loop`;
this is an end-to-end recording, not an adapter replay. Decode includes the
larger historical Event envelope. Stage percentiles must not be added. The
joint span includes five clock reads for historical and four for native; no
clock correction is estimated. TID initialization and log formatting/write occur
after the recorded adapter endpoint. Broadcast can wake the receiver before
`send` returns; its endpoint is allowed to follow receiver wake. The logger can
also run after the next request starts. Correlation uses captured timestamps and
one-unread-write ordering, never the order of interleaved stderr lines alone.

`controls.md` retains every probe/Daemon combination, all unprofiled controls,
scheduler-only captures and separate combined syscall/scheduler captures. A
single invocation of each is an overhead control, not a repeatability claim.
Whole-invocation wall time includes profiler startup/drain. Strace makes request
and echo p95 much larger; its durations cannot establish the clean path's tail
cost. Native-versus-historical adapter medians above describe these observations;
they cannot be subtracted from clean p95s or assigned to the Daemon. No dominant
cause or repair is inferred.

## Concrete FD and scheduler correlation

For the first measured echo-loop write (turn 100), `*-marked-example.txt.gz`
retains syscall context. The full recording supplies preceding blocked-read
entries and process/thread creation; the excerpt alone does not replace them.

| Identity | Historical trace | Candidate trace |
|---|---|---|
| Probe / Daemon PID | 21395 / 21400 | 28258 / 28263 |
| Request ID / Terminal | 3453 / 11 | 3459 / 11 |
| Daemon socket TID | 21403 | 28270 |
| Input / PTY reader / cat TID | 22496 / 22495 / 22497 | 29368 / 29367 / 29369 |
| Client request / output FD | 9 / 12 | 9 / 12 |
| Daemon request / output socket FD | 22 / 51 | 34 / 63 |
| Physical PTY write / read FD | 57 / 56 | 69 / 68 |
| Slave PTY | /dev/pts/10 | /dev/pts/10 |

Both examples retain request receive, one-byte PTY write, cat read/write, PTY
read, reply/output socket sends, client reads and receiver wake. Reply and echo
branches overlap. The source's user-write acknowledgment is input enqueue, even
when a physical write happens to precede reply delivery in a particular trace.

`scheduling-example.json` and `*-example-scheduler.txt.gz` independently retain
thread execution/wait intervals for those same request IDs:

| Traced request (one example, not a clean timing result) | Historical ns | Candidate ns |
|---|---:|---:|
| Client request wall interval | 592855 | 694085 |
| Main thread on CPU within that interval | 24356 | 24044 |
| Main thread off CPU within that interval | 568499 | 670041 |
| Input thread first waking to switch-in | 8859 | 12080 |

Off-CPU includes ptrace stops and cannot be called normal application waiting.
These values come from scheduler interval intersections, not summed futex/read
wall totals. They demonstrate the retained correlation, not a cause of the
clean write p95. Scheduler-only data lacks the physical syscall endpoints needed
to remove that tracer ambiguity from Daemon stage attribution.

`*-before.clock.json.gz` and `*-after.clock.json.gz` bracket realtime reads with
CLOCK_MONOTONIC reads. Across the historical trace the retained realtime-minus-
monotonic envelope is 1582 ns wide; candidate is 1743 ns. Use that envelope when
joining strace realtime to scheduler/probe monotonic timestamps; it is not an
exact offset or a correction for tracer overhead. Perf uses `--clockid mono`;
Linux Rust Instant's retained seconds/nanoseconds share that clock. Each
scheduler recording is independent; never join a PID or FD across invocations.

## Bounded unresolved stage

| Stage | Observed endpoints | Missing observation |
|---|---|---|
| Dispatch, task scheduling, input acceptance, reply enqueue | Daemon request read and reply socket send; input-thread wake and PTY write separately | Per-request dispatch/task poll and input/reply queue send/dequeue markers |
| Output publication, forwarding and enqueue | Physical PTY read and output socket send | Producer/forwarder/queue markers with Terminal and echo ordinal |
| Runnable versus parked application task | Kernel thread waking/switching | Tokio task wake/poll identity while that thread executes other tasks |

[Scoped investigation #3983](https://github.com/roundup-app/roundup/issues/3983)
owns those exact internal observations and natively blocks #3760. It reuses
this capture instead of redoing whole-invocation flat tables. #3760 stays open
until its full acceptance is demonstrated; #3720 retains regression work.
This is #3976's permitted bounded diagnostic result, not completion of #3760.

## Retention and reproduction

`executables.tar.gz` preserves all eight binaries named in `final-hashes.stdout`,
including both unmodified Daemons and both actual probe variants. Their build
IDs and byte hashes are retained before and after observation. Extract at `/tmp`
on a separate analysis host to restore `r23-span-bins/`; match hashes/build IDs
before symbolizing. These newly built identities are not substituted for the
original host-40170055163 DSOs, which PR #3975 could not resolve offline.
The original CPU profiles and the offline extraction remain unchanged.

`checksums.json` covers retained compressed raw data, logs, reports and binaries.
`controls.md` lists workload and tool statuses, including the initial marked
build's exit 101 and the corrected builds' exit 0. Every workload exits 1 on
unchanged diagnostic scratch ceilings; stdout names the misses, and reports
retain all metrics/loads with no skipped write comparison. All observed load/CPU
values are below 2.0. These one-Daemon profiles are never counted as clean pairs.
`lifetime-end.stdout.gz` confirms the same boot identity, qualification fields
and final hashes after every capture and executable archive completed.

`reproduce.txt` describes a fresh lifetime. The retained `.py.txt` sources are
run scripts and diagnostic extraction, not installed production modules or
synthetic timing tests. Generated large text and recordings are gzip-compressed
without changing their contents. No Mac observation is required.
