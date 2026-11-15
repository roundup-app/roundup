# Idle power

Module: `crates/messages`, `crates/perf`. Ids: IP7168a–IP7168c. Work order: [#7168](https://github.com/roundup-app/roundup/issues/7168). Terms: Daemon, Message, Project (`GLOSSARY.md`). Principles: P10.

A Daemon with nothing to do writes nothing and wakes rarely. Before this work each Daemon's push clock committed an unchanged ledger twice a second and scanned every pending Message on each tick, so an idle laptop spent its battery on empty work. No RPC or contract changes.

## Checks on main

1. `crates/messages/src/delivery.rs`, `spawn_push_clock`: the 500 ms push clock that pushes pending Messages into free slots.
2. `crates/messages/src/failure.rs`: the sweep that counts delivery misses of pending Messages.
3. `scenarios/messages.md` (B-ids) and the existing `crates/messages/src/tests/` push, failure and redelivery tests: what a pending Message does once it is sent.
4. `docs/perf.md`, R-ids: `just perf` runs a fresh Daemon 11 times and judges each metric's median against `crates/perf/budgets.json`.

**IP7168a An idle Daemon commits nothing.** Given a Messages runtime with no pending Message and no occupied slot, when the push clock has had time for at least ten ticks, then the Project database's `data_version` has not moved and the clock is parked (it holds no timer). Test: `ip7168a_an_idle_messages_runtime_commits_nothing` in `crates/messages/src/tests/`, with the tokio clock paused; it asserts the database commit counter and that the clock task is waiting for work.

**IP7168b A Message sent to a parked clock is still pushed at once.** Given the parked clock of IP7168a, when a Message is sent to a free receiver, then it is pushed as before and a Message that must wait for a slot or a channel event is retried on the clock's tick; once nothing is pending, the clock parks again and a later send wakes it. Test: `ip7168b_a_send_wakes_the_parked_clock_and_the_clock_parks_again` in `crates/messages/src/tests/`.

**IP7168c `just perf` measures idle.** Given a fresh Daemon on an empty Project holding ten idle Terminals, when `just perf` waits a fixed window, then it reports `idle_commits` (database commits in that window; limit 0) and `idle_cpu_percent` (the Daemon's CPU time over the window as a share of one core; limit from the measurement in the PR). A run over either limit fails. Tests: `ip7168c_the_idle_window_counts_commits_and_cpu` in `crates/perf/tests/`, over a synthetic database and process; the limits themselves are held by `just perf`.

## Verification

Policy: IP7168a and IP7168b use an in-process runtime with a paused clock, no child process. IP7168c's metric runs the real Daemon only in `just perf`. The PR carries a before and after table of `idle_commits` and `idle_cpu_percent` on one host in one session, taken on a scratch Daemon over a read-only copy of a real Project. The owner's Mac before and after reading follows the merge and is the owner's observation. The Daemon's memory guard (AMG4) still reads the process list once a second; it stays as specified and is the largest idle cost left.
