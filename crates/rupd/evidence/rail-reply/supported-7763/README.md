# R16 supported 7763 comparison

Refs #1369. The Daemon repair merged in #1373. This evidence does not complete #1369: all nine repaired Rail-40 observations miss the unchanged historical ceiling.

```text
complete result → moved success envelope → JSON bytes + newline → socket
same frozen compatible probe → historical/current Daemons → retained failures
```

The host matches R16's Ubuntu 24.04 AMD EPYC 7763 class: four online/available CPUs, affinity 0–3. Historical reference is `1d1618d2d9bb5c0f25ecb6b32de1cde20bfad6d0`; measured repaired source is `75314ff011e0c1479aae530eebc6d837eb6e45f3`, merging main `5d53884b`. Only evidence changes follow that source. Both releases use the same toolchain, each committed lockfile and the default release profile. Metadata, hashes, all build exits and exact commands are retained here.

The one frozen uninstrumented compatible probe hashes to `c0acc38bb80beaed786978cd021889aeb476835c1fe37558dc4622480434f835`, identical to #1374's retained original-Client probe. This is a rebuild, not the earlier `a35e5a…` binary. Its only source change is the already retained `crates/rpc/r16/probe-compatible.patch`, adapting the Group/Workstream method and R15 echo pacing; no new compatibility or workload repair is introduced. The embedded historical Client is unchanged: this comparison cannot measure #1375's Client-only ownership repair. Both references use identical probe bytes. No baseline, threshold, noise allowance, metric, field, call count or public contract changes.

Three supported-host isolation invocations use the existing same-binary fixture, with 100 warmups and 3,300 samples per operation, input preparation and output destruction outside clocks. All builds and checks exit before timing. Median ranges in µs:

| Operation | Median |
|---|---:|
| RPC typed-result conversion | 49.082–53.069 |
| Old Daemon envelope | 52.999–53.170 |
| Moved Daemon envelope | 0.270–0.280 |
| Old Daemon frame Display | 40.827–41.087 |
| Direct frame bytes | 11.201–11.361 |
| Historical Client parsing current complete frame | 99.852–101.034 |
| Historical Client result cloning | 36.188–36.579 |

These isolate allocation/conversion costs; they exclude database/presentation, socket I/O and scheduling and supply no full-call acceptance themselves. RPC conversion/Client work remains owned by #1374. Its reverse dependency on #1369 is removed because the Daemon implementation merged; #1369 is blocked on #1374 for remaining acceptance work. This removes the cycle and leaves independent RPC engineering queued. #1361 retains broader Daemon/combined diagnosis, #1366 owns Message input tracking, and #1251 owns class calibration/completion.

Nine alternating pairs each run eleven fresh Daemons, ten login-shell Terminals and 1,000 latency calls. `observations/pairs.jsonl` keeps each entire report, per-run metric/load, command, timestamps, exit, binary hashes and log. All 18 load-qualify (maximum invocation-median load/CPU 0.8125); all exit 1 against unchanged boxd budgets. There are no busy or observer-error invocations to repeat. Ceiling misses are retained, never retried into passes. RSS is compared at every load and all absolute limits apply. The collector exits 0 after retaining all observations; that exit is not a performance pass.

`comparison.json` computes the historical median of invocation medians, existing noise and limits for all seven metrics in the unchanged historical probe:

| Metric | Historical median | Repaired median | Ceiling | Repaired misses |
|---|---:|---:|---:|---:|
| Rail-40 ms | 0.360865 | 0.862566 | 0.3979515 | 9 |
| Ping ms | 0.062557 | 0.127669 | 0.0698127 | 9 |
| Terminal write ms | 0.103671 | 0.605383 | 0.1150381 | 9 |
| Write-to-output ms | 0.209803 | 0.720089 | 0.2317833 | 9 |
| Extra RSS MB | 2.511719 | 2.605469 | 2.812890625 | 0 |
| Cold start ms | 14.404372 | 33.705727 | 300 absolute | 0 |
| Rail-10 ms | 0.178725 | 0.308037 | 2 absolute | 0 |

The historical probe predates `hook_loop_ms`; no metric is removed from that probe. No new class baseline or native Mac completion is claimed.

Validation before timing: initial `VITEST_MAX_WORKERS=2 just check` exits 0 (1,548 Rust / 2,653 web tests, two configured web skips); after merging main, the same full check exits 0 (1,564 Rust / 2,653 web, same skips). Both include `ALL PROOFS CHECK`. R16 socket scenarios preserve every Rail field and row order, complete success/error envelopes, escaping, notification suppression and pipelined replies. Owning-module and workspace scenarios cover events, concurrent Clients, caller hang-up, A38, resume/reopen/Iteration, bounded Terminal I/O and Message input/submit/Takeover. Check summaries and full-log hashes are retained separately. No assertions or timeouts changed.
