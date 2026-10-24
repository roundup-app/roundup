# macOS write-path perf

Module: `crates/agents` (`peer.rs`), `crates/rupd` (`connection.rs`, `route.rs`, `guards.rs`) and `crates/perf`. Source: #3696, the macOS `just perf` failure recorded on #3681. Ids: R3696a–R3696c.

Policy: on macOS `peer::parent_of` has no `/proc/<pid>/stat`, so it runs `ps -o ppid= -p <pid>` once per ancestor, and `terminal_writer` walks that chain for every `terminal.write` (in the wire reader and again in `route_inner`). That blocking spawn per call is the measured ~16 ms in `terminal_write_p95_ms` and `write_to_output_p95_ms`. No `crates/perf/budgets.json` entry changes.

**R3696a a write spawns no process.** Given a Daemon on any OS and a connection whose peer is a pid that descends from no running Agent's program, when it sends `terminal.write`, then the Daemon starts no child process to classify the caller and `terminal_writer` answers the user's (or the Ext's) actor as before; a peer below a running Agent's program still resolves to that Agent (H21). Proved by `r3696a_parent_walk_spawns_no_process` in `crates/agents/src/peer.rs` (the native parent lookup returns this test process's real parent, and a spawn-counting `PATH` shim named `ps` is never run) and by H21's existing `h21_a_caller_is_the_agent_whose_claude_it_descends_from`.

**R3696b one classification per write.** Given a `terminal.write`, when the wire reader has resolved its actor, then `route_inner` reuses that actor and does not walk the peer's ancestry a second time. Proved by `r3696b_write_classifies_its_caller_once`, which counts the parent lookups for one `terminal.write` through the Daemon and expects at most one chain.

**R3696c the macOS gate passes.** Given the Apple M4 Max of #3681 on a quiet machine (1-minute load per CPU at or below 0.45), when `just perf` runs with `crates/perf/budgets.json` unchanged, then it exits 0: `terminal_write_p95_ms` at or below its ceiling (baseline 0.0365 ms plus 10% and noise, 0.041 ms), `write_to_output_p95_ms` under 16 ms, and `cold_start_ms` and `rail_tree_40_p95_ms` at or below their ceilings. R3696a and R3696b are expected to move the first two; the cause of the `cold_start_ms` (16.4 ms against 7.1 ms) and `rail_tree_40_p95_ms` (0.329 ms against 0.1345 ms) overshoots is not established, and the implementation names it from a measurement on that Mac (a spawned `ps` in `crates/rupd/src/resources.rs` or `crates/agents/src/scan.rs`, the sidecar start, or a baseline recorded before the sidecar shipped) and repairs it or, if the baseline predates shipped behavior, records that in `docs/perf.md` rather than loosening a budget. Observer: the user's Mac, one run of `just perf` whose `target/perf.json` is retained on #3696 (policy: only that Mac produces it; Linux tests prove R3696a and R3696b).

| Failure | Exit | Required result |
|---|---|---|
| Any metric above its limit or ceiling | 1 | Name the metric, value and bound (R13) |
| `budgets.json` or `rupd` missing | 2 | R10 |
