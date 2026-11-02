# Snapshot topology

Module: `crates/agents`; `src/scan.rs`, `src/door.rs`, `src/rail/view.rs`, existing scan/Rail tests and `tests/perf.rs`. Source: #5636. Terms: Door, Rail, Agent, Terminal, Adapter (`GLOSSARY.md`). Ids: R5636a–R5636e. This specifies implementation; it changes no RPC, storage schema, App appearance or ownership rule.

Keep F5's detection and A6's Rail output while reducing per-scan CPU and recurring allocations under AGENTS rule 7. One process snapshot already serves all Doors (Check 1); subprocess savings per Door are not an outcome of this work.

## Acceptance

Tests below are planned implementation observers, not evidence this specification delivers the optimization. Use the production scan and Rail traversal, with private test observation where needed; do not add a public RPC or retain a second production algorithm for measurement.

**R5636a the scan preserves detection.** Given a synthetic process snapshot and Adapter-supplied program names, when the production scan finds strays for a Door, then it returns the same PID-ascending `{pid, command}` list as F5: descendants of marker-matching programs and Door-owned Terminal program PIDs qualify; those roots themselves, unrelated processes and Daemon-registered Terminals outside those trees do not. Match the executable basename, `argv[0]` basename and, for the existing interpreter set, the first non-option argument's basename. Preserve malformed-row skipping and command text. Tests: retain the three `f5_` cases in `src/scan.rs` (Check 2); add `r5636a_owned_terminal_roots_are_excluded` and `r5636a_matching_keeps_pid_order` there, using disordered rows, all supported interpreters, executable/argv matches and nonmatching names. Existing F5 event/Kind/Status/attention acceptance is unchanged (policy; Check 3).

Given missing ancestors, overlapping roots, a self-parent or a parent cycle in that snapshot, when the scan traverses it, then it terminates, emits each qualifying PID once, and reaches descendants of a supplied Terminal PID even when that root has no row; a missing parent creates no ownership by itself. Test: `r5636a_sparse_and_cyclic_processes_terminate` in `src/scan.rs`, with sparse PIDs including one near `u32::MAX`.

**R5636b one process topology serves every Door.** Given one prepared snapshot containing ten independent Door branches, descendants and unrelated rows, when the production scan runs for one Door and for all ten, then each invocation builds exactly one child adjacency table, and each Door traversal examines each reachable child edge at most once, including under overlapping roots and cycles. Tests: `r5636b_one_snapshot_indexes_once_for_one_or_ten_doors` and `r5636b_each_reachable_edge_is_visited_once` in `src/scan.rs`; count production topology builds and edge examinations, and assert R5636a's returned PIDs. Keep snapshot preparation outside traversal counts; report its cost separately in R5636e. These observers start no process, PTY, Daemon or clock.

Representation (policy, inspect the diff): borrow parsed command text from the current snapshot; build compact numeric rows, a sorted lookup for sparse PIDs and contiguous child ranges once; reuse traversal scratch across Doors. Use standard vectors and sorting, sized by row/edge counts, never the largest PID. Delete per-Door adjacency maps, owned parsed command strings and temporary candidate-name vectors. Returned/published `Stray.command` remains owned. Retain the single snapshot read in `Shared::scan_once` and Adapter ownership of vendor names (Checks 1–3).

**R5636c Rail moves payloads through one indexed walk.** Given loaded Rail nodes with roots, siblings whose input order differs from their `order`, and nested descendants, when the production tree traversal runs, then it emits each reachable node once in depth-first, parent-before-child order, with siblings by `order`; the full payload and its finish count reach presentation unchanged. Nodes with a missing parent, and their descendants, remain omitted rather than becoming roots. Tests: `r5636c_nested_order_keeps_payloads_and_finish_counts` and `r5636c_missing_parents_stay_unreachable` in `src/rail/view.rs`, using sparse durable ids near `i64::MAX` as well as small ids. Existing conversation availability and unpublished-resource visibility remain unchanged; retain the observers in Checks 4 and 5.

Given process-free prepared fixtures of 40 and 400 nodes, both a deep chain and a branching tree with more than one nesting level, when that production traversal runs, then after sorting it walks each emitted node once through the child index, without scanning the full payload vector at every parent or using recursive descent. Test: `r5636c_nested_walk_visits_each_emitted_node_once` in `src/rail/view.rs`; count node/edge examinations at the production walk, assert the complete emitted order, and distinguish index construction from walking. This observer starts no process, PTY, Daemon or clock. Fixtures exercise topology directly; they do not authorize new nesting through Rail mutation calls.

Representation (policy, inspect the diff): sort compact numeric topology records, keep payloads out of topology sorting, and move each payload into output through an iterative child-index walk. Use standard vectors and sorting sized by node/edge counts, never the largest durable id. Delete repeated whole-vector descendant searches. Preserve the existing root-only fast path, which may sort its loaded buffer directly (Check 6).

**R5636d topology ends with its snapshot.** Given two successive synthetic scans where a PID is reused under another parent with different command text, when the second scan runs, then ownership, matching and output use only its rows, with no old child edge, visited mark or borrowed command retained. Test: `r5636d_pid_reuse_uses_only_the_new_snapshot` in `src/scan.rs`.

Lifetime (policy, inspect the diff): discard each process/Rail topology with the source snapshot it indexes; persist no topology, row index or borrowed command between scans/tree reads. Preserve published stray facts used for change-only events in `Shared::scan_once`, and preserve Rail's bounded `tree_capacity` reservation, which retains a length capped at 256, not nodes (Checks 1 and 6). No persistent cache is deleted or added.

**R5636e measure the recurring work.** Given the same prepared synthetic fixtures on the old implementation and candidate, when allocation observers run, then they report allocation counts and total allocated bytes for a complete F5 snapshot parse/index plus traversal for 1 and 10 Doors, and for nested Rail traversal at 40 and 400 nodes for both R5636c shapes. Exclude fixture-string/payload construction and test-report formatting; include the snapshot's parsing/index/scratch/output allocations and Rail's topology/scratch/output allocations. Also report traversal-only cost separately from preparation. Planned observers: `r5636e_scan_allocated_bytes` in `src/scan.rs` and `r5636e_nested_rail_allocated_bytes` in `src/rail/view.rs`, using allocator instrumentation scoped to the measured work without adding a public interface. Set allocation regression bounds from the recorded old measurements so the tests fail if the intended byte reduction disappears; those bounds cite the measured base and fixture, never a value copied from the new implementation. Reuse R5636b/R5636c assertions rather than duplicating their proof in separate tests; allocation reporting may share those observers. Keep new topology observers process-free.

Evidence (policy): retain in the implementation PR the exact base/head SHAs, commands, fixture sizes/shapes, measurement boundaries, allocation counts, allocated bytes and old-to-new deltas for each case. Run equivalent observers on both checkouts; retain any observer-only patch needed on the base separately from the optimization. Record preparation and traversal work separately; do not claim a nested gain from `rail_tree_40_p95_ms` or a subprocess-per-Door reduction. Investigate any allocation increase against the requested reduction; never raise an existing budget to hide it. Preserve the root-only `r3696c_forty_workstreams_avoid_temporary_node_copies` limits of 210 allocations and 80,000 bytes (Check 7). `rail_tree_40_p95_ms` remains a regression guard, not proof of the nested gain (Check 8).

## Checks on main

These are the existing anchors, not claims that the new acceptance already passes.

1. `crates/agents/src/door.rs`, `Shared::scan_once`: one process snapshot, each Door's owned Terminal roots, published stray comparison and change-only events.
2. `crates/agents/src/scan.rs`, `f5_a_vendor_name_below_the_door_is_a_stray_by_executable_or_by_interpreter_argument`, `f5_the_door_itself_and_a_row_outside_its_tree_are_not_strays`, `f5_a_row_that_is_not_a_row_is_skipped`: pure detection/parser observers; `names` and `INTERPRETERS` hold the current matching set.
3. `scenarios/spawn-boundary.md`, F5; `scenarios/mcp.md`, M14: unchanged ownership, registration, event and user-attention contract. `crates/agents/src/scan.rs`, `read_table`, reads no vendor name; `crates/agents/src/door.rs`, `Shared::scan_once`, obtains names from the Adapter.
4. `crates/agents/src/rail/tests.rs`, `r16_loaded_rail_keeps_complete_conversation_availability_in_tree_order`: payload availability and parent-first output.
5. `crates/agents/src/rail/tests.rs`, `u2875c_each_reservation_write_rolls_back_without_a_partial_rail_entry` and `u2875c_final_commit_failure_keeps_both_nodes_unpublished`; `crates/agents/src/rail/view.rs`, `NODES`: unpublished-resource visibility.
6. `crates/agents/src/rail/view.rs`, `Rail::tree_with` and `descend`: root-only fast path, bounded length reservation, sibling ordering, payload moves and current omission of unreachable nodes.
7. `crates/agents/tests/perf.rs`, `r3696c_forty_workstreams_avoid_temporary_node_copies`: root-only allocation guard. `crates/agents/src/rail/view.rs`, `r3696c_forty_workstreams_avoid_per_node_preparation_queries`: existing SQLite work guard.
8. `scenarios/perf.md`, R6 and R8; `docs/perf.md`, What is enforced, and what is not: runtime budgets and the unchanged regression gate.

## Verification

Implementation command (policy):

```sh
cargo nextest run -p agents -E 'test(scan::) | test(rail::) | binary(perf)'
```

On a prepared checkout, this command completes below five minutes; record duration and exit status in the implementation PR. Preparation/build time is reported separately. Do not replace this command with a whole-crate/suite run. The new fixtures require no live vendor login or Mac observation. Existing F5 native/process observations and rule 7 budgets remain owned by their scenarios.

| Failure | Exit | Required result |
|---|---|---|
| Any selected test fails | 100 (nextest test failure) | Name the failing test and its assertion; acceptance fails. |
| Build, filter or runner cannot execute the observers | Nonzero (record exact code) | Name the observer error; no performance claim. |
| Prepared run takes 300 seconds or more | Record runner status | Acceptance fails even if the tests pass. |

Implementation scope (policy): the module/files named above, target 550–750 changed lines; no loop machinery, new cache, vendor-name source, contract or mutation behavior. The specification PR leaves #5636 open with `Mode: implement`; progress and engineering questions stay on that Issue, never in scenario Work tables.
