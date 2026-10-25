# Rail empty-history read (#3696)

The forty-Workstream reply checked `closed_sources` separately for every node.
The retained Linux CPU profile puts 13.48% of samples in `sqlite3VdbeExec`.
SQLite now evaluates an uncorrelated `NOT EXISTS (SELECT 1 FROM closed_sources)`
once per statement. An empty history skips the per-node check; a nonempty history
keeps the existing indexed unpublished-source lookup. No import history is copied
or cached between reads, and no schema or dependency changes.

`r3696c_forty_workstreams_avoid_per_node_preparation_queries`, through `Rail::tree`,
uses installed rusqlite's `StatementStatus::VmStep`: **1728 → 1292 instructions**.
The 1350 cap fails before the repair and passes after it, without a clock or child
program. The query is prepared and warmed before resetting the counter. Existing
`u2875c_final_commit_failure_keeps_both_nodes_unpublished` and
`u2875b_closed_publication_retains_continuation_without_a_launch` retain the
visibility proof. No existing test is removed or repeats the instruction bound.
The existing allocation observer remains at 244 allocations / 132,294 bytes.

The [raw paired report](perf-rail-read-pairs.json) retains all observations,
exit codes, executable hashes, physical host identity, toolchain, load, the exact
temporary observer patch and a link/hash for the separate compressed diagnostic
profile text (`gzip -dc docs/perf-rail-read-profile.txt.gz`). Its clean
pairs use no profiler. Before is `616ed71887477036c1c36022f29edc23f6e4d2bf`;
after is isolated repair `428db273f7d8a8ca956e31907030a91179e53e36`, before merging
newer main. Both use the same observer patch and release profile.

| Pair | Before, µs/reply | After, µs/reply |
|---|---:|---:|
| 1 | 88.931 | 76.654 |
| 2 | 90.202 | 76.726 |
| 3 | 88.657 | 76.278 |
| 4 | 88.891 | 77.823 |
| 5 | 88.552 | 76.350 |
| 6 | 88.972 | 76.253 |
| 7 | 89.245 | 76.912 |
| 8 | 88.784 | 76.460 |
| 9 | 88.525 | 76.221 |
| Median of pair medians | 88.891 | 76.460 |

Every pair improves; the median saving is 12.430 µs (14.0%). These are median
batch means, **not** request p95s. The observer includes live presentation,
serialization and the existing instrumented System allocator, and excludes
Daemon startup and socket transport.

Host: Linux x86_64, AMD EPYC 7763, four affinity CPUs, class `linux-7763`,
physical VM SHA256 `d9bec2327c309790105a2cf0d091a0a42f02bec990c4498d1fddb684abb54fd0`.
Session `builder-40179088559-2026-10-25`; one-minute load 1.216–2.159
(0.304–0.540/CPU). Builds and tests were stopped during all eighteen observations.
Each invocation's exit code is 0; none was skipped or retried.

Reproduce with the report's `observer_patch` applied temporarily to the existing
`crates/agents/tests/perf.rs` on each reference. Build both before measuring:

```sh
cargo test --release -p agents --test perf --no-run
# Copy the emitted executable for each reference, then alternate these nine times:
RAIL_PROBE=1 /tmp/3696-rail-before --nocapture
RAIL_PROBE=1 /tmp/3696-rail-after --nocapture
```

Each invocation runs seven batches of 10,000 awaited
`Module::call_reply("rail.tree", null)` calls over the same fixture, black-boxing
every reply. Each pair reverses which reference runs first; the report retains
the exact order. Production and committed tests contain none of this timing
instrumentation.

This attributes and removes part of Rail reply work on Linux. It establishes no
M4 Max pass, startup/RSS saving, complete startup attribution or baseline rebase.
The latest Mac failure predates #3981's startup connection-handoff repair.
Budgets remain unchanged. Full same-M4-Max acceptance, the owner's unchanged-code
false-fail evidence and the separate later main pass remain open on #3696.
Earlier attribution stays in [the main record](perf-macos-startup.md).
