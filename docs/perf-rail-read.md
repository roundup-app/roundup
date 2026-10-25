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


## Reuse of the loaded Rail buffer (#3696)

`Rail::tree_with` retained the loaded nodes and allocated a second vector for
traversal output. The existing no-process allocation observer measures
**132,294 → 99,334 temporary bytes** and **244 → 243 allocations** for forty
Workstreams. Traversal now swaps each next sibling into a visited prefix of the
loaded vector, keeping its finish count beside it. Standard iterator collection
reuses that storage for the returned nodes. Selecting the minimum sibling order
preserves A6 without rotating large node slices or allocating a second tree.
Unreachable nodes are discarded as before, and presentation remains parent-first.

`r3696c_forty_workstreams_avoid_temporary_node_copies` tightens its byte cap from
150,000 to 100,000. It fails on the original path and passes on the repair; the
260-allocation cap still catches the separate finish-map regression. This file
contains only that observer, so no redundant test is removed. Existing A6 tree
ordering and move tests, R16 conversation availability and U3566c finish-count
coverage retain their behavioral proofs. No timing instrumentation is committed.

The [raw paired report](perf-rail-buffer-pairs.json) retains all eighteen
observations, exits, loads, executable hashes, source hashes, host/toolchain facts
and the temporary timing patch. Before is `907c9e005eb40068ff4e012dec3a0b6e63494250`;
after is `a9c47c97115335320185f20d8323de1883ef80df` before merging newer main.
Both use the existing forty-Workstream fixture, instrumented System allocator and
release profile. Reproduction uses the `RAIL_PROBE=1` procedure above; the test's
allocation assertions follow the timed batches.

| Pair | Separate output buffer, µs/reply | Reused buffer, µs/reply |
|---|---:|---:|
| 1 | 46.116 | 46.602 |
| 2 | 46.281 | 47.252 |
| 3 | 45.958 | 46.508 |
| 4 | 47.034 | 46.351 |
| 5 | 46.331 | 46.775 |
| 6 | 45.646 | 47.136 |
| 7 | 46.555 | 46.647 |
| 8 | 46.415 | 47.721 |
| 9 | 47.395 | 46.170 |
| Median of pair medians | 46.331 | 46.647 |

Linux x86_64, AMD EPYC 9V45, four affinity CPUs, rustc 1.99.0; one-minute load
1.023–1.064 (0.256–0.266/CPU). Builds and tests were stopped throughout all pairs;
order alternates, every exit is 0, and none is retried or skipped. These are
median batch means, not request p95s. They show no material latency improvement
(0.7% higher median); the established saving is 32,960 temporary bytes per reply,
not idle RSS. The observation excludes startup and socket transport.

Budgets remain unchanged. The latest M4 Max report at `477a3ce93`
([retained result](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6396742823))
still fails cold start at 9.543 ms against 8.110 and Rail 40 at 0.164 ms against
0.149, with writes and RSS passing. This allocation repair establishes neither a
Mac latency pass nor startup attribution or a baseline rebase. Full same-M4-Max
acceptance, unchanged-code false-fail evidence and the separate later main pass
remain open on #3696.
