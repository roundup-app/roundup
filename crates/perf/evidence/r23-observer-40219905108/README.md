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
#3720 pending a concrete observer-cost prerequisite; no user or Mac decision is
needed.
