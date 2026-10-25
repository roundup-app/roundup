# R23 write measurements and attribution

See [performance budgets and enforcement](perf.md) and [R23 execution lifetime](perf-r23-execution.md).

### R23 paired write conclusions (#3760)

The [retained 9V45 lifetime](../crates/perf/evidence/r23-host-40170055163/README.md)
compares historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0` with candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31` using one compatible probe.
Three ordered pairs each contain eleven fresh Daemons, with median load/CPU
0.6325–1.3150 and neither write metric skipped. Values below are invocation
medians in milliseconds; ratios use the unrounded reports.

| Pair | Historical write | Candidate write | Ratio | Historical output | Candidate output | Ratio |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 0.054052 | 0.055794 | 1.032228 | 0.112005 | 0.110897 | 0.990108 |
| 2 | 0.053530 | 0.056035 | 1.046796 | 0.110526 | 0.111509 | 1.008894 |
| 3 | 0.054162 | 0.053080 | 0.980023 | 0.110957 | 0.111127 | 1.001532 |

`terminal_write_p95_ms`: historical median 0.054052; ceiling
0.054052 × 1.10 + 0.001 = **0.0604572 ms**. All three candidates fit.
`write_to_output_p95_ms`: historical median 0.110957; ceiling
0.110957 × 1.10 + 0.001 = **0.1230527 ms**. All three candidates fit,
and all six invocation medians are below the unchanged 16 ms absolute limit.
Cold start and extra RSS invocation medians also stay below 300 ms and 150 MB.
These are complete-observer comparisons; they establish no Daemon-only repair.
The [older diagnosis](perf.md#builder-9v45-diagnosis-3700-r16-steps-1-to-3) measures a different candidate and incompatible probes.

All six exits remain 1: each misses the explicitly diagnostic copied-boxd
ceilings for ping, RSS and write-to-output. Their raw values, ceilings, statuses,
startup logs and all failed attempts remain retained. No copied value becomes
a 9V45 baseline. H15 is excluded after the writes for both references, so this
supplies no full perf pass, calibration or relaxation of R16 step 3.

[Compatibility assessment, calculation command and profile analysis](../crates/perf/evidence/r23-host-40170055163/assessment.md)
explain the unresolved attribution. Historical Events require probe-side output
adaptation; its cost was not isolated. Separate perf/strace recordings include
RPC, PTY and delivery work, but combine setup, Rail, ping and write phases.
Their CPU samples show JSON decoding, allocation and scheduling work; overlapping
syscall wall times cannot assign per-write waiting. Whole-invocation profiling
overhead is +8.4% historical / +9.5% candidate; profiles never count as timing pairs.

[Reproduction commands](../crates/perf/evidence/r23-host-40170055163/reproduce.txt)
require a newly qualified 9V45 lifetime; this assessment collected no substitute
measurements on its 9V74 host. **Attribution remains incomplete**:
[#3971](https://github.com/roundup-app/roundup/issues/3971) blocks #3760 to isolate
adapter cost and request/reply, PTY and output-delivery stages, linked under
[#3720](https://github.com/roundup-app/roundup/issues/3720). #3760 stays open;
R8 pins, R13 qualification, R15 pacing, R16 ceilings and macOS behavior are unchanged.

### R23 retained thread attribution (#3971)

[Timestamped extraction and bounded conclusion](../crates/perf/evidence/r23-attribution-40174335770/README.md) separate retained CPU recordings by original PID/TID. Echo-terminal creation to Daemon teardown bounds both write loops, including setup/warmups/cleanup: historical/candidate 10.479362/10.566470 s; probe CPU samples 740/749, Daemon 1045/1102, `cat` 109/158. Of the candidate's net 1164 additional whole-recording samples, 1049 fall outside that window. Whole-recording decoding/allocation totals cannot assign write p95.

The probe's user `terminal.write` acknowledges input enqueue; physical PTY write/read and output delivery run separately, and reply/echo completion can overlap. CPU samples identify executing threads, not sleep or queue delay. Recordings lack loop boundaries, per-write markers and scheduler wake/switch events. The common probe's exact patch identifies historical Event adaptation but does not isolate its cost. Extraction retains original identities, commands, versions, statuses and the unsupported-option failure; it runs no new workload/profile.

[Scoped capture #3976](https://github.com/roundup-app/roundup/issues/3976) requires correlated stage spans, same-binary probe isolation and matching executables or resolved phase stacks retained before the qualified 9V45 lifetime ends. [#3760](https://github.com/roundup-app/roundup/issues/3760) stays open; [#3720](https://github.com/roundup-app/roundup/issues/3720) owns remaining regression work. Both write metrics fit historical-derived ceilings in all three clean candidate invocations, measuring the complete compatible observer without establishing a Daemon-only cause, repair, baseline, calibration or full R16 pass. R8, R13, R15, R16 and all absolute limits remain unchanged.

### R23 correlated write capture (#3976)

[Builder 40175332310](../crates/perf/evidence/r23-spans-40175332310/README.md) retains per-write/loop/warmup identities, monotonic timestamps, FD-resolved PTY/socket timelines, scheduler records and matching executables on one qualified 9V45 lifetime for R23's pinned references. Both common/marked probes run against each identical Daemon, with separate unprofiled, scheduler-only and syscall controls; commands, hashes, versions, failures and raw recordings survive.

Historical extraction/offset insertion/deserialization/broadcast jointly take 3.024 µs median / 4.257 µs p95; native takes 2.824 / 3.986 µs. All 2200 spans per reference are on CPU. Separate decoding and per-loop/warmup results are retained. These bounds include clocks/wakers, establish no Daemon cause, and are never subtracted from clean p95s. Syscall tracing substantially changes latency and establishes correlation only.

Dispatch/task scheduling, input/reply queue acceptance and output publication/queueing remain bounded by request-read/reply-send and PTY-read/output-send. [Investigation #3983](https://github.com/roundup-app/roundup/issues/3983) natively blocks #3760 on the missing in-process/task markers. User-write completion acknowledges enqueue, not physical PTY completion; reply and echo overlap.

The six original clean observations and PR #3975's extraction are reused: all three candidate invocations fit the historical-derived 0.0604572 ms request and 0.1230527 ms echo ceilings. #3760 stays open until its full acceptance holds; #3720 retains regression work. No baseline, calibration, production repair, limit, load/pacing policy or macOS behavior changes. No Mac observation is required.
