# R23 native probe capability and cumulative assessment (#4031)

Attribution remains incomplete. [#4120](https://github.com/roundup-app/roundup/issues/4120)
is the concrete native-probe identity prerequisite, installed as a blocked-by
dependency of #4031 under #3760/#3720. No user or Mac decision is needed.
This report verifies the already-delivered captures and controls and attempts
additional profiler capability discovery; it supplies no new workload recording,
probe hits, clean timing observations or host comparison.

```text
#4082: producer/dispatch capture + 24 instrumented/unmodified controls
#4110: 36 fixed-binary recorder controls
  → verified offline replay → native probe definitions / argument discovery
  → #4120: recover identities and validate actual scheduling/publication samples
```

## Retained capture and overhead

The [producer capture](../r23-producer-40214115988/README.md) contains separate
profiles of historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0` and candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31`, matching executable bytes, patches,
profiler/version, all commands/statuses and original request/task/thread/FD
identities on its single hosted job/boot. The [recorder controls](../r23-overhead-40221022276/README.md)
retain a separate single lifetime, fixed archived binaries and all 36 attempts.
These lifetimes are not pooled into a clean timing comparison. No new recording
from this capability inspection is substituted for either lifetime.

`producer-replay.*` runs the existing five assessors with scratch paths;
`replay.py.txt` retains that orchestration. `raw-verification.json` verifies all
366 original raw manifest entries, including split archives. All five commands
exit 0. `replay-comparison.json` confirms equality of five JSON reports and eight
decompressed CSVs. `verified-executables.json` verifies all ten archive members
against #4110's recorded hashes; `archive-verification.json` identifies the split
archive. The overhead assessor also exits 0; `overhead-replay-comparison.json`
confirms JSON and table equality. Original samples, profiles and failures remain
at their linked immutable evidence paths; no failed attempt is replaced.

| Boundary | Supported samples and functions | Precise unresolved observation |
|---|---|---|
| Request receive → preprocessing/scheduling → dispatch | Both prologues precede field extraction; candidate submission/first selected poll in capture `new-boundaries.json` | JSON parsing precedes prologue; submission/spawn is not executor queue insertion |
| User call → input producer → acceptance | Historical `Terminals::write` source probes (11000 hits); candidate `Terminals::enqueue` entry (2200) and source probes | Optimized source addresses do not identify exact `try_send` linearization; acceptance is not physical completion |
| Physical PTY read → processing/publication → receive | 2200 one-unread physical joins per pin; historical publication probes (6633 total hits), candidate next-source probes (2211) | Candidate optimized send-line failure (254); next location is only a bound; processing includes screen/parser/log work |
| Delegated wake → logger/delegation/runtime → selected poll | Original wake markers, selected polls, scheduler partitions and 15522/21386 historical/candidate full spawned-task poll intervals | Exact task enqueue and useful-task CPU remain unknown; hooks include observer work and exclude root/blocking tasks |

For a concrete replayed join, Terminal 11/ordinal 100 is the first measured echo:
historical request 3453/task 7/PID 45637, reader/writer TIDs 46732/46733 and FDs
53/54; candidate request 3455/task 3578/PID 46899, TIDs 48001/48002 and FDs 68/69.
`new-boundaries.json` and the original per-reference CSVs retain other samples.
Pending reads may start before a write; earlier idle time is excluded. Scheduler
CPU/runnable/non-runnable partitions describe threads, including observer/kernel
and other-task execution, not useful-task CPU. Selected-future polls and full
spawned-task hooks remain distinct. Overlapping reply/output branches are not summed.

The 24 alternating controls isolate the *combined* diagnostic instrumentation
and build-setting change for each pin/common-or-marked probe. Request ratios span
1.844–2.948; echo ratios 0.795–1.797, retaining the historical/common outlier.
The later 36 controls keep those instrumented bytes fixed and alternate off,
scheduler/syscall recording and full recording. All are R13-qualified with no
skipped metric; all actual diagnostic ceiling misses remain. Historical/marked
cycle 2 off also misses the absolute cold-start limit at 610.779718 ms. All full
recordings have producer hits; none reports LOST events. Each collection finishes
builds, compression and offline processing before its controls and retains
process/load snapshots. See the original `control-assessment.json` and later
`assessment.json.gz`/`table.md` for each pin/probe/metric and paired difference.

These repetitions measure variation, not universal overhead bounds. In particular,
full-minus-scheduler request p95 for historical/common ranges −0.052418 to
+0.000380 ms; candidate/marked echo ranges −0.010285 to +0.033860 ms. Aggregate
p95 deltas cannot correct individual stage intervals. Diagnostic build settings,
hooks and logger execution remain confounded. No diagnostic interval or recorder
delta is subtracted from clean p95s.

## Additional native profiler attempts

This run restores the same archive without rebuilding or executing its Daemons.
`host.*` records this inspection host; `profiler.*` reports perf 6.17.13. Each
`*-definition`, `*-return`, `*-variables`, `*-symbols`, `*-notes`, `*-sdt` and
`*-disassembly` record holds the exact command, compressed output and actual exit.
All these capability commands exit 0; an empty variable list is unsupported
argument recovery, not zero execution cost. No uprobe is registered or enabled.

| Executable | Capability result | What it does not establish |
|---|---|---|
| Historical instrumented | `schedule_local` definition at file offset `0x3c1750`; disassembly symbol VMA `0x3c2750` | No matched named variables; no TaskMeta identity or enqueue timestamp |
| Candidate instrumented | `schedule_local` at file offset `0x170e000`; VMA `0x170f000` | Same identity/queue-insertion gap; local entry alone excludes remote scheduling |
| Candidate instrumented | Byte `broadcast::Sender<terminal::Chunk>::send` pattern yields offsets `0x1432c90` and `0x1432d69`; return definition uses `0x1432c90` | Second address is send+217; a broad match is not a unique function entry, publication point or measured hit |

File offsets and VMAs are different coordinate systems, not different builds.
The new byte-broadcast symbol is a concrete alternative to the previously rejected
source line and unrelated `Shared::publish`. Definition success alone supplies no
sample. Perf exposes no matched named variables for candidate send either.
A validated machine-code argument mapping, pointer lifetime and TaskMeta-ID join
are needed before profiling scheduler-task identities. #4120 requires actual
recorded hits, separate local/remote paths, exact-symbol selection, publication
entry/return bounds, and repeated controls for the new probe set. It does not
permit treating function entry as exact queue insertion or forking the runtime.

Both pinned locks select Tokio 1.53.1. `tokio-source-manifest.json` verifies the
retained dependency files against the cached crate archive with the checksum in
both locks. In this version `TaskMeta` exposes `id` and `spawned_at`, not per-task
schedule latency. The `schedule-latency` feature offers histograms: worker
`schedule_task` stamps before choosing local/remote scheduling, and `start_poll`
can group LIFO tasks. It supplies neither a task-identity enqueue callback nor
an exact queue-insertion timestamp. Latest online API descriptions must not be
substituted for this pinned contract. Sources: [pinned TaskMeta](https://docs.rs/tokio/1.53.1/src/tokio/runtime/task_hooks.rs.html),
[pinned scheduler](https://docs.rs/tokio/1.53.1/src/tokio/runtime/scheduler/multi_thread/worker.rs.html),
and [perf probe syntax](https://man7.org/linux/man-pages/man1/perf-probe.1.html).
No new source instrumentation is proposed outside the authorized scope.

## Historical timing, separately

The six clean reports in `r23-host-40170055163/` remain labelled history:
`terminal_write_p95_ms` fits its historical-derived 0.0604572 ms ceiling in all
three retained candidate invocations; independently `write_to_output_p95_ms`
fits 0.1230527 ms in all three. Each establishes a complete-observer comparison,
not a Daemon-only attribution or this inspection host's timing base.
R8 pins, R13 load ≤2.0 per available CPU, R15 pacing, R16 ceilings and rule 7
absolute limits remain unchanged. No calibration, baseline increase, runtime fork,
production repair or clean R16 verdict is supplied. #4031 and #3760 stay open.

## Reproduction and failures

Restore the archive using its manifest's ordered gzip parts; verify total size
and SHA-256 before extracting. Verify every member against
`verified-executables.json`. Replay the capability `.command` files with only
the executable path changed to that verified restoration. They use installed
`perf`, `nm`, `readelf` and `objdump`; no new parser or profiler is implemented.
For producer replay, copy `replay.py.txt` to scratch, replace its three absolute
`source`, `out`, `scratch` paths, create an empty out and leave scratch nonexistent,
then run `python3` on it. For overhead replay, run `overhead-replay.command` with
a new nonexistent output directory and compare JSON/decompressed content.
The original reports' reproduction instructions retain fresh collection commands.

Inspection-only lookup failures before this report (never workload measurements):

| Lookup | Actual status | Result |
|---|---:|---|
| `gzip -dc .../r23-overhead-40221022276/assess.py.txt.gz` | 1 | Actual name is `assess-overhead.py.txt` |
| `cat .../r23-producer-40214115988/executables.parts.json` | 1 | Actual name is `executables.tar.gz.parts.json` |
| `gzip -dc .../r23-overhead-40221022276/assess-overhead.py.txt.gz` | 1 | Script is uncompressed |
| `rg ... /home/runner/.cargo/registry/src/*/tokio-1.53.1/src/runtime/builder.rs` before dependency fetch | 2 | Dependency source initially absent |
| `gzip -dc .../candidate-source-output.stdout.gz` | 1 | Output is uncompressed; later symbol commands above are independent |
| `gzip -dc .../historical-output_publish-source-add.stdout.gz` | 1 | Output is uncompressed |
| `cat .../diagnostic-budgets.provenance.json` | 1 | Guessed companion filename absent; no budget loaded or changed |
| `rg .../runtime/*meta*` | 2 | Actual metadata file is `task_hooks.rs` |
| First dependency-source retention Python command | 1 | Assumed `.cargo-checksum.json` absent; corrected verification uses the actual cached crate and both lock checksums |

All original capture/control failures and actual statuses remain in their
respective `failures.md` and command records. Successful later inspection never
turns a failed attempt into timing evidence.
