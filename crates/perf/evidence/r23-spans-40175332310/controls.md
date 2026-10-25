# Diagnostic controls and status index

One fresh Daemon per diagnostic invocation; 100 warmups and 1000 calls per write loop, ten login shells, raw cat and unchanged one-unread-write pacing. These are not timing pairs. All twelve workload invocations exit 1 against retained diagnostic scratch ceilings; all have empty skipped lists. Full output identifies every miss.

| Daemon | Probe | Observer | Wall s | Request p95 ms | Echo p95 ms | Load/CPU | Exit |
|---|---|---|---:|---:|---:|---:|---:|
| historical | common | control | 1.6838 | 0.048072 | 0.114783 | 1.0850 | 1 |
| historical | common | sched-only | 2.3065 | 0.058568 | 0.140001 | 1.0175 | 1 |
| historical | common | trace | 8.3071 | 0.617001 | 0.951942 | 1.0175 | 1 |
| historical | marked | control | 1.6367 | 0.056566 | 0.111498 | 0.8800 | 1 |
| historical | marked | sched-only | 2.2986 | 0.059840 | 0.132920 | 0.8800 | 1 |
| historical | marked | trace | 9.3017 | 0.841901 | 0.996044 | 0.8300 | 1 |
| candidate | common | control | 2.3818 | 0.049464 | 0.111369 | 0.6850 | 1 |
| candidate | common | sched-only | 3.3232 | 0.066280 | 0.135675 | 0.6850 | 1 |
| candidate | common | trace | 9.3001 | 0.614137 | 0.933459 | 0.6300 | 1 |
| candidate | marked | control | 1.8033 | 0.049825 | 0.110705 | 0.5575 | 1 |
| candidate | marked | sched-only | 3.3098 | 0.059540 | 0.132621 | 0.5575 | 1 |
| candidate | marked | trace | 10.3091 | 0.847236 | 1.032828 | 0.5325 | 1 |

`control` has no kernel profiler. `sched-only` records system-wide switch/waking/wakeup events on CLOCK_MONOTONIC. `trace` additionally uses strace with FD decoding, nanosecond realtime timestamps and syscall durations. Wall seconds include recorder startup/drain and probe startup/cleanup; they are not write-stage overhead corrections. Marked and common probes run against the same retained Daemon bytes in each reference. Single-run differences establish no regression or repair.

Strace increases request p95 roughly 12–17 times versus common controls and echo p95 roughly 8–9 times. Scheduler-only p95 also changes. No traced duration is substituted into a clean pair; no overhead is subtracted from a result.

| Non-workload command | Exit | Result |
|---|---:|---|
| `apply-markers.command` | 0 | Retained command/output |
| `candidate-build.command` | 0 | Release build completed |
| `candidate-checkout.command` | 0 | Retained command/output |
| `candidate-common-sched-only-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `candidate-common-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `candidate-marked-sched-only-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `candidate-marked-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `compatible-probe-build.command` | 0 | Release build completed |
| `final-hashes.command` | 0 | Retained command/output |
| `hashes.command` | 0 | Retained command/output |
| `historical-build.command` | 0 | Release build completed |
| `historical-checkout.command` | 0 | Retained command/output |
| `historical-common-sched-only-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `historical-common-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `historical-marked-sched-only-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `historical-marked-scheduler.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `lifetime-end.command` | 0 | Retained command/output |
| `machine.command` | 0 | Retained command/output |
| `marked-probe-build-retry.command` | 0 | Release build completed |
| `marked-probe-build-with-tid.command` | 0 | Release build completed |
| `marked-probe-build.command` | 101 | Compiler failure: timestamp placement and OwnedWriteHalf FD accessor; corrected before any marked observation |
| `offline-cpu-replay.command` | 0 | Retained command/output |
| `offline-marker-replay.command` | 0 | Retained command/output |
| `offline-source-attempt.command` | 128 | Worktree FETCH_HEAD absent (128); corrected original-checkout query retained separately; no timing affected |
| `offline-source.command` | 0 | Retained command/output |
| `qualification.command` | 0 | Retained command/output |
| `retain-executables.command` | 0 | Retained command/output |
| `scheduler-preflight.command` | 0 | Complete event extraction; generic perf field warnings retained, no lost-event warning |
| `source-identities.command` | 0 | Retained command/output |
