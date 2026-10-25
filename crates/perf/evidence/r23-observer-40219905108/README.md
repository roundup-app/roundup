# R23 observer assessment (#4031)

This is an offline assessment of the capture and repeated controls merged in
[#4082](https://github.com/roundup-app/roundup/pull/4082), at main
`181121b46fe8266f500a30f4c799fafb645c8cdd`. No new timing campaign or host comparison
is made. Capture, commands, executable archives, patches and original identities
remain in [r23-producer-40214115988](../r23-producer-40214115988/README.md).

```text
retained raw logs → request / task / thread / FD joins → bounded observations
24 alternating controls → instrumentation variation → attribution incomplete
```

## Supported observations

| Boundary | Supported observation | Remaining limit |
|---|---|---|
| Receive → dispatch | Both pins' prologue precedes field extraction; candidate submission and first selected poll are bracketed | JSON parsing precedes prologue; submission is not executor enqueue |
| User call → acceptance | Historical input source probes; candidate `Terminals::enqueue` entry and input source probes | Optimized line addresses are not exact channel linearization; acceptance is not physical completion |
| Physical read → producer → forward receive | Original one-unread write ordinals join 2200 physical reads and writes per pin to producer probes and receiver | Candidate send line shares optimized addresses; next source location is a bound, not exact broadcast timestamp |
| Wake → selected poll | Delegated waker markers, endpoint scheduler partitions and separate full spawned-task poll hooks | Logger, delegation and runtime delay remain mixed; selected poll is not full task poll |

`new-boundaries.json` in the capture names each example and its original PID/TID,
request, task and descriptors. Terminal 11, ordinal 100 is the first measured
write-to-output turn. Historical request 3453 runs in task 7 on PID 45637;
candidate request 3455 runs in task 3578 on PID 46899. The historical physical
reader/writer are TIDs 46732/46733, FDs 53/54; candidate 48001/48002, FDs 68/69.
No pending read's earlier idle interval is attributed to a write.

At the historical pin, input is `Terminals::write` in
`crates/terminal/src/lib.rs` (`try_send` at line 208), and output is `pump`
(starting at line 325). At the candidate pin, input is `Terminals::enqueue`
(`try_send` at line 634), called by `write`, and `pump` starts at line 974 in
that same file. Neither pin has `crates/terminal/src/pty.rs`. Historical
publication precedes title parsing; candidate publication follows screen/parser
and log work. The source ordering is not measured causal attribution.

The historical enqueue-symbol attempt exits 237; source probes subsequently
supply 11000 input hits. Candidate enqueue entry has 2200 hits. Historical
publication supplies 6633 probe hits over all Terminals; candidate's exact
send-line attempt exits 254 for shared optimized addresses, with 2211 hits at
the next supported location. Eleven `pump` entry hits per pin identify reader
lifetimes, never individual publications. Registered probes and source mappings
are in the capture's `*-source-*.command` and corresponding outputs; failed
attempts are retained in its `failures.md`.

Tokio hooks yield 15522 historical and 21386 candidate complete spawned-task
poll intervals. They exclude root `block_on` and blocking tasks, include observer
execution and identify no exact executor enqueue. `runtime-hook-source.stdout.gz`
retains the supported hook contract: `on_task_spawn` is before spawning, not a
queue insertion callback. Thread CPU includes other tasks, logging and kernel
work; runnable/non-runnable intervals cannot identify useful-task CPU.

## Overhead and clean timing

The capture's `control-assessment.json` retains all 24 controls: three alternating
unmodified/instrumented repetitions per pin and common/marked probe. All are
load-qualified, with no skipped metrics; every actual exit is 1 against labelled
scratch ceilings. No failed control becomes a performance pass. Builds,
compression and offline processing finished before controls; original process
snapshots, load and command timing records remain alongside them.

Request paired ratios range 1.844–2.064 historical/common, 1.871–1.980
historical/marked, 2.379–2.728 candidate/common and 2.240–2.948 candidate/marked.
Echo ratios are respectively 0.795–1.498, 1.450–1.496, 1.649–1.696 and
1.604–1.797. The historical/common outlier is retained. Three repetitions show
variation, not a universal overhead bound. Different debug/unstable settings,
marker formatting/logging and hook execution remain confounded. Source-probe
and perf recording overhead is additional: profiles enable it, controls do not.
These ratios cannot correct individual stage durations or clean p95s.

Separately, the six original clean reports in `r23-host-40170055163` establish:

- `terminal_write_p95_ms`: all three candidate invocation medians fit the
  historical-derived 0.0604572 ms ceiling.
- `write_to_output_p95_ms`: all three candidate invocation medians fit the
  historical-derived 0.1230527 ms ceiling.

Those are the earlier lifetime's complete-observer comparisons, not this
capture's timing base or a Daemon-only explanation. Reply/output branches overlap;
their intervals are never summed. Diagnostic intervals are never subtracted from
clean p95s. R8 pins, R13 load/CPU <= 2.0, R15 pacing, R16 ceilings and absolute
limits remain unchanged. No calibration, baseline increase or repair is claimed.

## Remaining work

Attribution is incomplete. Exact executor enqueue is unsupported by the retained
hook contract; optimized producer source probes provide bounded observations.
Incremental source-probe/recorder cost and configuration/logger effects prevent
unperturbed producer/task cost attribution. #4031 and #3760 remain open under
#3720 blocked by [#4109](https://github.com/roundup-app/roundup/issues/4109); no user or Mac decision is
needed.


The prerequisite holds Daemon bytes, hooks, logger and build settings fixed while
alternating recorder-off, scheduler/syscall-only and full producer-probe recording
for both references and probes. This isolates the incremental recorder effect
missing from the current controls; it does not promise to resolve configuration
or logger confounding, or supply an exact executor-enqueue timestamp.

## Offline verification

`replay-audit.py.txt.gz` orchestrates the existing archived Python assessors using
only Python standard-library file, gzip, JSON and subprocess facilities. It adds
no production probe, parser or timing test. Run it in a scratch environment after
replacing its `source`, `out` and `scratch` paths with absolute paths; `out` and
`scratch` must be fresh directories. It copies raw material, verifies every
uncompressed entry in `raw-sha256.json`, decodes logs and joins physical endpoints,
then replays the task/thread, producer and control assessors. Source evidence is
never overwritten. Exact subprocess arguments, output and actual statuses are
retained as `replay-*.command`, `.stdout`, `.stderr` and `.exit`.

All five replay commands exit 0. `raw-verification.json` verifies 366 manifest
entries; all ten archived executables match their recorded hashes.
`replay-comparison.json` confirms equality for all five derived JSON reports and eight CSVs
against the capture (CSV comparison decompresses gzip wrappers). New gzip headers
change compressed input hashes; original raw identities and decompressed contents
must agree. `raw-verification.json` identifies the verified manifest count;
`replay-statuses.json` records actual status and wall duration per assessor.
The retained scripts reproduce observations; they are not new synthetic tests
or an assertion that attribution is complete.

Inspection-only failures in this assessment run: `ls .../*manifest*` exited 2
because the capture uses `*.parts.json` names; `cat .../profiler-version.command`
exited 1 because that filename does not exist. Neither was a profiling attempt
or supplied measurement evidence. Original collection failures and actual
statuses remain in the capture's `failures.md` and individual command records.


The first integrity wrapper (`audit-v1`, actual exit 1) assumed unsplit perf
files. Its source and traceback remain retained; the corrected wrapper validates
split manifests in their recorded order before replay. This failure is distinct
from the earlier capture's coincident-timestamp assessor failure, which is also
retained there. `executable-verification.json` records archive members matched to
the ten hashes in `hashes-before.stdout.gz`; `historical-comparison.json` records
the six earlier reports' per-metric recalculation, explicitly as history.


Decompress `executables-history.py.txt.gz` to `/tmp/r23-verification.py` and run
`executables-history.command` from the repository root to reproduce executable
member hashes and historical ceilings. Use a scratch output directory to preserve
retained results. `executables-history.exit` is the actual status; this is offline
verification, with no Daemon or profiler process started.
