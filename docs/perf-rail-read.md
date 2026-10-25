# Rail read performance (#3696)

### Rail reply allocation (#3696)

The latest M4 Max A/B on #3696 (`59cff55cae` against `02fd86775`, nine
alternating invocations each) reproduces the baseline and still fails current
cold start (10.64 ms), Rail 40 (0.186 ms) and RSS growth (3.922 MB). The startup
logs give median open/bound times of 5.32/5.38 ms; neither these logs nor the
following Linux measurement attributes the entire remaining startup or RSS gap.

`e03234712` removes temporary allocations from Rail reads: rusqlite's borrowed
`ValueRef` supplies kind and Order text, traversal moves loaded nodes instead of
cloning them, and presentation formats a finish count only in the Status that
uses it. No result is cached. Through `Module::call_reply`, the ordinary
forty-Workstream reply allocates 290 times / 176,266 bytes, against 530 times /
181,047 bytes before the repair. `r3696c_forty_workstreams_avoid_temporary_node_copies`
uses the existing `stats_alloc` observer, with no Daemon, process or clock; its
400-allocation ceiling fails on the original path. Existing Rail ordering,
Order and Status tests cover the returned contents.

A separate release probe on Linux (four available CPUs, AMD EPYC 9V45) constructs
40 Workstreams, warms 100 reads, then times seven batches of 10,000 `Rail::tree`
reads. Two alternating before/after invocations, with builds and tests stopped,
gave median batch means of 38.35 us before (37.22–41.07) and 32.44 us after
(31.85–33.10), about 15% less construction time. This probe excludes live
presentation, JSON and transport; it is not the end-to-end Mac metric. The final
presentation change is included in the allocation observer, not this timing.
The saved allocations are temporary request work, not an explanation of idle
RSS. Budgets remain unchanged. R3696c's same-M4-Max full gate, remaining
attribution, false-fail evidence and separate later main pass remain open.

### Finish counts in the Rail read (#3696)

The ordinary forty-Workstream reply still read `nodes` twice: once for the
nodes and once for their finish counts, constructing an id-keyed map for the
second read. PR #3864 selects `finished` with the node and carries it through
the existing traversal. Presentation visits only reachable nodes, in the same
order as before; no result is cached. The public Rail and RPC replies stay the
same. The callback is internal to the existing Rail module.

The existing no-process allocation observer,
`r3696c_forty_workstreams_avoid_temporary_node_copies`, measures 290 allocations /
176,266 bytes on `a1d2169e3` and 245 allocations / 172,230 bytes after this
repair. Its cap is tightened from 400 to 260: it fails on the original path
and passes on the repair. This file holds only that observer, so no redundant
test is removed. Existing Rail ordering and
`u3566c_finish_count_survives_attempts_and_reopen` cover the returned facts.

Release probe: Linux x86_64, AMD EPYC 9V74, four available CPUs, rustc 1.99.0.
Use the allocation observer's fixture and instrumented system allocator, then
replace its measured call/assertion with seven batches of 10,000 awaited
`Module::call_reply("rail.tree", null)` calls, black-boxing every reply and
reporting elapsed time per call. Build both revisions before measuring. With
builds and tests stopped, three alternating before/after invocations gave
these median batch means (microseconds per reply):

| Pair | Separate finish map | Combined read |
|---|---:|---:|
| 1 | 77.023 | 67.238 |
| 2 | 78.204 | 67.546 |
| 3 | 76.847 | 67.110 |

One-minute load at invocation start ranged from 3.77 to 5.57 (0.94–1.39 per CPU).
This is about 13% less local reply work, including live presentation and JSON
serialization under the allocation observer. It excludes the Daemon's socket
transport and is not the end-to-end Mac metric or evidence of idle RSS savings.
Budgets are unchanged. The latest nine-pair M4 Max A/B at `59cff55cae` remains
the failing acceptance evidence; remaining startup/RSS attribution, full
same-M4-Max gate, unchanged-code false-fail evidence and the separate later
main pass remain open. This repair justifies no baseline rebase.

### Rail sort scratch space (#3696)

The stable sort in `Rail::tree_with` allocates scratch space for the loaded
`RailNode` values. A6 requires sibling orders to be unique; ties between
nodes with different parents do not affect parent-first traversal. Rust's
standard `sort_unstable_by_key` therefore preserves the reply order without
that scratch allocation. No traversal, cache or sorting implementation is
added.

On Linux x86_64 (AMD EPYC 9V45, four available CPUs, rustc 1.99.0), the existing
`r3696c_forty_workstreams_avoid_temporary_node_copies` observer measures 245
allocations / 172,230 allocated bytes on `f32419986`, and 244 / 132,294 after
this repair: 39,936 fewer temporary bytes per reply. Its new 150,000-byte cap
fails on the original path and passes on the repair. The existing
260-allocation cap remains because it catches the separate finish-map
regression. No test in this file repeats either proof or is removed. Existing
A6 Rail tests cover ordering and moves.

Release probe: replace the allocation observer's measured call/assertions with
seven batches of 10,000 awaited `Module::call_reply("rail.tree", null)` calls,
black-boxing each reply and retaining the instrumented allocator. Build both
revisions before measuring. Three alternating before/after invocations with
builds and tests stopped produced median batch means (microseconds per reply):

| Pair | Stable sort | In-place sort |
|---|---:|---:|
| 1 | 51.856 | 51.729 |
| 2 | 51.524 | 51.555 |
| 3 | 51.700 | 51.744 |

One-minute load at invocation start ranged from 3.80 to 4.81 on four CPUs.
These timings show no material speed change; the measured saving is allocation.
They include presentation/JSON and exclude socket transport.

This is temporary request allocation, not idle RSS attribution or a Mac timing
pass. Budgets remain unchanged. Full same-M4-Max acceptance, remaining
startup/RSS attribution, unchanged-code false-fail evidence and the separate
later main pass remain open; this repair justifies no baseline rebase.

