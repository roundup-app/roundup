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


## Reservation without a count query (#3696)

The read iterator gives `Vec` no row-count hint. Growing its large node buffer
allocates 99,334 bytes per forty-Workstream reply. The existing allocation
observer fails with the stricter 80,000-byte cap before implementation, and
passes at 79,366 bytes after it; the allocation count remains 243. This file
holds only that unique allocation observer, so no redundant test is removed.

`Rail` remembers only the last loaded length, capped at 256, and uses standard
`Vec::with_capacity` on the next read. It retains no nodes or SQLite facts and
adds no SQL query. Reads still load all current rows, grow normally when needed
and replace the hint after a successful load. Only one integer persists; a
large tree cannot reserve more than 256 nodes on its next read after removal.
The earlier rejected count-query candidate remains recorded above.

Before adding this field, the file-size rule required a separate structural
commit: imported-conversation reservation/publication moves to `rail/closed.rs`,
Project settings to `rail/settings.rs`, and Terminal ownership reads to the
existing `rail/view.rs`. Inherent methods keep their callers and visibility.
No migration, RPC or acceptance condition changes.

The [raw alternating report](perf-rail-capacity-pairs.json) retains both source
references, executable and source hashes, the temporary observer patch, exact
commands, all batch values/stdout/stderr/exits, loads and physical host identity.
The same seven-batch observer runs on both binaries, with nine pairs reversing
order. Builds and checks are stopped during measurement. These are median batch
means including SQLite, presentation, JSON serialization and the instrumented
System allocator; they exclude Daemon startup and socket transport and are not
request p95s or idle RSS.

Reproduce with the report's `observer_patch` temporarily applied to each
reference's `crates/agents/tests/perf.rs`, using the release build and
`RAIL_PROBE=1` commands above. No timing code is committed.

Budgets remain unchanged. This repair establishes no Mac gate pass, startup
saving or baseline rebase. The latest M4 Max failure at `477a3ce93` remains:
cold start 9.543 / 8.110 ms, Rail 40 0.164 / 0.149 ms, with writes and RSS passing.
Full same-M4-Max acceptance, remaining startup attribution, unchanged-code
false-fail evidence and the separate later main pass remain on #3696.

| Pair | Unreserved, µs/reply | Previous-length reservation, µs/reply |
|---|---:|---:|
| 1 | 82.505 | 75.863 |
| 2 | 83.995 | 76.094 |
| 3 | 82.045 | 77.109 |
| 4 | 82.437 | 75.649 |
| 5 | 83.107 | 77.875 |
| 6 | 83.616 | 76.304 |
| 7 | 82.247 | 76.784 |
| 8 | 82.865 | 75.831 |
| 9 | 82.904 | 75.879 |
| Median of pair medians | 82.865 | 76.094 |

All nine pairs improve, a 8.2% median reduction. Host: AMD EPYC 7763 64-Core Processor, Linux x86_64, 4 affinity CPUs, rustc 1.99.0 (b940084d7 2026-09-28); one-minute load 1.179–1.885 (0.295–0.471/CPU). Session `builder-40190498547-2026-10-25`. Before `60ab27fec6f1666c202d288ee79948aec4894f44`; after isolated repair `01cc5b281cab14df5b5a142d7acd509095753807`.


## Visibility gates and implicit Orders (#3696)

A warmed forty-Workstream read still executes the visibility predicate inside
SQLite's node loop. The existing no-clock instruction observer measures
**1,292 → 1,115 VM instructions** after selecting the all-visible or filtered
branch before scanning nodes. Its cap tightens from 1,350 to 1,150 and fails
before implementation. The two branches are mutually exclusive within one
statement and snapshot; neither node visibility nor prepared-statement reuse
changes. Existing unpublished-import tests retain their visibility proof.

New Workstreams also persisted a JSON copy of their implicit default Order.
Every subsequent read parsed that copy. `insert_ordered` now stores an omitted
Order as NULL, the representation the loader already materializes as the same
Workstream default (or no Order for an Agent). Explicit Orders and previously
stored JSON remain unchanged; there is no migration or retained node cache.
The existing allocation observer measures **243 → 203 allocations** and
**79,366 → 69,126 bytes**. Its allocation cap tightens from 260 to 210; the
80,000-byte cap still catches loss of buffer reservation. The edited files
contain only these distinct observers, so no redundant test is removed.
`o1_a_workstream_has_an_order` retains the exact default-Order proof;
`o3_a_workstream_gives_its_door_the_order_and_stopping_the_door_keeps_it`
retains explicit-Order delivery and retention.

The [raw alternating report](perf-rail-visibility-pairs.json) retains source
references/hashes, executable hashes, host/toolchain/load, exact commands,
the temporary timing patch and every observation, output and exit. Baseline
is `c23fbf63f`; isolated repair is `94b41390f`, before merging newer main.
Both binaries use the same seven batches of 10,000 awaited
`Module::call_reply("rail.tree", null)` calls. Allocation assertions run after
the batches (baseline cap 260, repaired cap 210). No timing code is committed.

| Pair | Before, µs/reply | Repaired, µs/reply |
|---|---:|---:|
| 1 | 76.871 | 64.254 |
| 2 | 77.122 | 64.925 |
| 3 | 76.756 | 65.304 |
| 4 | 76.860 | 64.102 |
| 5 | 77.413 | 64.721 |
| 6 | 76.490 | 64.252 |
| 7 | 76.854 | 64.838 |
| 8 | 76.203 | 64.736 |
| 9 | 78.167 | 64.293 |
| Median of pair medians | 76.860 | 64.721 |

Median saving: **12.139 µs (15.8%)**. These are batch means,
not request p95s: they include SQLite, live presentation, JSON serialization
and the instrumented System allocator, and exclude startup/socket transport.
All eighteen invocations exit 0; none is retried or skipped. Builds and checks
are stopped during the pairs. Host: AMD EPYC 7763 64-Core Processor, Linux x86_64,
4 affinity CPUs, rustc 1.99.0 (b940084d7 2026-09-28).

Reproduce using the report's temporary `observer_patch` on both references:
build with `cargo test --release -p agents --test perf --no-run`, copy each
emitted binary, then alternate `RAIL_PROBE=1 <binary> --nocapture` nine times,
reversing the first reference each pair. Build both binaries before timing.

The latest M4 Max result at `36ae06d` passes cold start at 7.982 ms but misses
Rail 40 at 0.162 ms against 0.149
([Mac evidence](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6402850816)).
This Linux comparison establishes no M4 Max pass, baseline rebase, startup or
idle-RSS saving. Budgets are unchanged. Full R3696c acceptance, the owner's
unchanged-code false-fail evidence and separate later main pass remain on #3696.
