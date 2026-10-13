# R16 RPC reply ownership

The Client moves result, error and event parameters out of its owned parsed frame. Complete replies, error precedence, missing/null fallbacks, concurrent routing and connection-failure semantics remain covered through existing RPC seams.

```text
parse complete frame
  → take owned payload
  → route complete result/error/event
```

Three alternating real-Client observations each use 100 warmups and 3,300 measured complete 40-row replies. Equality and result destruction are outside the clock. Original/repaired medians in µs: 244.312/163.375, 236.618/162.2785, 230.852/163.185 (29–33% saving). Pre-rendering keeps Daemon envelope/rendering and Rail database/presentation outside these measurements; socket scheduling remains included.

Typed historical/current attribution measures conversion at 21.860/42.419 µs and parsing at 51.687/100.638 µs. Historical/current frames contain 5,285/11,045 bytes and 8/17 fields per row. `rpc::reply` and the Client JSON parse expression are identical across references. Required additional fields stay present; this attribution does not prove parser optimality. Current cloning/moving medians are 30.737/0.310 µs, with destruction outside both clocks.

The historical compatible probe embeds its own Client. Three original/repaired probe pairs on identical frozen current Daemon binaries isolate only `probe-client.patch`, with no perf-source change between those probes. Rail-tree-40 medians in ms: 1.006672/0.895124, 0.993879/0.896036, 0.999249/0.904351. All six qualify under the existing 2.0 load/CPU threshold and exit 1 against retained boxd budgets. The compatibility patch adapts the Group/Workstream method and R15 echo pacing; its workload, calls and limits are retained.

Nine alternating eleven-Daemon invocations per historical/current reference then use identical repaired compatible probe bytes, unchanged ten login shells and 1,000 latency calls. All 18 qualify under R13 (maximum invocation-median load/CPU 1.045), and all exit 1 against unchanged boxd budgets. `comparison.json` compares every metric using existing absolute limits or historical median × 1.10 + existing noise. Rail-tree-40 historical median is 0.319267 ms, ceiling 0.3521937 ms, current median 0.896777 ms: nine misses. RSS stays below its historical ceiling; ping, Terminal write and write-to-output each miss nine times. These are retained regression observations, not calibration or R16 completion.

Full #1374 acceptance remains open. Existing scoped work owns external costs: #1369 Daemon envelope/frame work, #1365 Rail presentation, #1366 Message input tracking and #1361 final combined repair/comparison. No reverse dependency on #1369 is added: it already depends on #1374. #1251 owns class baselines and completion observations. This PR delivers the measured RPC ownership saving and complete comparison evidence, with `Refs #1374`.

Reproduction: `commands.txt`, `metadata.json`, `hashes.json`, the two probe patches, historical schema fixture, and `observe.py`. Each append-only JSONL row retains the entire report/log, exact command, exit, load, attempt and binary hashes, including ceiling misses. Builds and tests ended before timing. The freshly rebuilt probe hashes differ from the earlier run's comment; the actual frozen bytes are recorded, never represented as that earlier hash. Current release source matches production commit `04b78aa4`; binaries were built while that repair was uncommitted, then frozen, with source hashes retained. Earlier `before.txt` keeps its original upper-middle median convention; new even-sample profile medians average both middle samples.

Validation: `build-exits.json` retains all command exits, including the interrupted first check caused by this worktree's missing target path. The repaired environment's full `just check` exits 0: 1,543 Rust tests, Message proofs and 2,554 desktop tests pass, with two configured desktop skips. RPC clippy passes. Native Mac/combined R16 completion is not claimed.

After merging main `b23497ae`, the default-worker full check passed Rust/proofs but U136 tree-40 light exceeded its existing five-second timeout. All ten U136 tests passed in isolation. A full post-merge `just check` with the supported `VITEST_MAX_WORKERS=2` setting then exited 0: 1,543 Rust tests and 2,554 desktop tests passed, two configured desktop skips. U136 tree-40 light completed in 1.786 seconds. No assertion, timeout or source change was needed. Both exits and the worker setting are retained in `build-exits.json`.
