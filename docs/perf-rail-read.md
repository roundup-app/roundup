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

`Rail::tree_with` scanned for descendants once per node and allocated a second
vector for traversal output even when every node was a root. The forty-Workstream
fixture has no children. A flat tree now presents the sorted nodes directly with
standard iterator collection, reusing the loaded buffer. Nested trees keep the
existing traversal; no query, cache, graph representation or library is added.

The existing no-process allocation observer measures **132,294 → 99,334 temporary
bytes** and **244 → 243 allocations** per reply. Its 100,000-byte cap is committed
before implementation and fails on the original path. The 260-allocation cap
remains because it catches the separate finish-map regression. This file holds
only that observer, so no redundant test is removed. Existing A6 ordering/move,
R16 conversation-availability and U3566c finish-count tests retain their
behavioral proofs. No timing instrumentation is committed.

The [raw paired report](perf-rail-buffer-pairs.json) retains all eighteen
observations, exits, loads, executable/source hashes, host/toolchain facts and the
temporary timing patch. Before is `8b164b2c30c056bb10e351b3866e46c7d3ca4849`;
after is `35b6697c2ae3ca549f76b0413a127432b3ac8e0a`. Both have the same
Rust source apart from the flat-tree branch and the stricter allocation cap;
allocation assertions run after the timed batches. Reproduction uses the
`RAIL_PROBE=1` procedure above and each reference's existing test fixture.

| Pair | Descendant traversal, µs/reply | Direct flat presentation, µs/reply |
|---|---:|---:|
| 1 | 45.851 | 43.463 |
| 2 | 46.374 | 43.800 |
| 3 | 45.302 | 43.458 |
| 4 | 46.038 | 43.965 |
| 5 | 46.471 | 43.491 |
| 6 | 45.060 | 43.870 |
| 7 | 45.988 | 44.012 |
| 8 | 45.132 | 43.776 |
| 9 | 45.196 | 44.462 |
| Median of pair medians | 45.851 | 43.800 |

All nine pairs improve. The median saving is
2.051 µs
(4.5%). Linux x86_64,
AMD EPYC 9V45, four affinity CPUs, rustc 1.99.0; one-minute load
1.191–1.445
(0.298–0.361/CPU). Builds and tests were stopped
throughout all pairs; order alternates, every exit is 0, and none is retried or
skipped. These are median batch means, not request p95s; they include presentation,
JSON serialization and the instrumented System allocator, and exclude startup
and socket transport. The 32,960-byte saving is temporary allocation, not idle RSS.

Budgets remain unchanged. The latest M4 Max report at `477a3ce93`
([retained result](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6396742823))
still fails cold start at 9.543 ms against 8.110 and Rail 40 at 0.164 ms against
0.149, with writes and RSS passing. This repair establishes neither a Mac pass
nor startup attribution or a baseline rebase. Remaining startup/Rail attribution,
full same-M4-Max acceptance, unchanged-code false-fail evidence and the separate
later main pass remain open on #3696.


### Rejected count reservation

A concurrent candidate reserved the loaded vector with a cached
`SELECT count(*) FROM nodes`, then used the same flat-tree presentation. This
reduced allocation to 79,366 bytes, but added a query to every read. The
[separate raw comparison](perf-rail-reservation-pairs.json) retains nine alternating
pairs against the same `8b164b2c3` reference, using the same observer and host.
Before/after medians are **45.408 → 47.048 µs**:
all nine pairs regress, with a 3.6%
higher median. Builds and tests were stopped, every exit is 0, and no pair is
retried or skipped. The candidate source is `324e2892441019549dec136431f66a20ea566594`;
its executable/source hashes and invocation loads are in the report.

The final change keeps the faster flat-tree path and removes the count query.
Its allocation bound is 100,000 bytes, down from main's 150,000; the unmerged
90,000-byte bound required the slower reservation. Removing flat presentation
still fails the retained bound at 132,294 bytes. Neither comparison is the Mac
gate, a startup/RSS attribution or grounds for changing a budget.
