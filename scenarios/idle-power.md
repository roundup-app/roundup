# Idle power

Module: `crates/messages`, `crates/perf`, `apps/desktop` (`settings/styles.css`, `terminal/`). Ids: IP7168a–IP7168d. Work order: [#7168](https://github.com/roundup-app/roundup/issues/7168). Terms: Daemon, Message, Project (`GLOSSARY.md`). Principles: P10.

A Daemon with nothing to do writes nothing and wakes rarely. Before this work each Daemon's push clock committed an unchanged ledger twice a second and scanned every pending Message on each tick, so an idle laptop spent its battery on empty work. A Project's Pane kept mounted but hidden (U7155a) draws nothing either. No RPC or contract changes.

## Checks on main

1. `crates/messages/src/delivery.rs`, `spawn_push_clock`: the 500 ms push clock that pushes pending Messages into free slots.
2. `crates/messages/src/failure.rs`: the sweep that counts delivery misses of pending Messages.
3. `scenarios/messages.md` (B-ids) and the existing `crates/messages/src/tests/` push, failure and redelivery tests: what a pending Message does once it is sent.
4. `docs/perf.md`, R-ids: `just perf` runs a fresh Daemon 11 times and judges each metric's median against `crates/perf/budgets.json`.

**IP7168a An idle Daemon commits nothing.** Given a Messages runtime with no pending Message and no occupied slot, when the push clock has had time for at least ten ticks, then the Project database's `data_version` has not moved and the clock is parked (it holds no timer). Test: `ip7168a_an_idle_messages_runtime_commits_nothing` in `crates/messages/src/tests/`, with the tokio clock paused; it asserts that another connection sees no commit and that the clock ran no pass.

**IP7168b A pending Message wakes the parked clock.** Given the parked clock of IP7168a, when a Message becomes `pending`, then the clock runs a pass within one tick and passes every tick while any Message is pending; once none is, it parks again. Test: `ip7168b_a_pending_message_wakes_the_parked_clock_and_the_clock_parks_again` in `crates/messages/src/tests/`.

**IP7168c `just perf` measures idle.** Given a fresh Daemon on an empty Project holding ten idle Terminals, when `just perf` waits a fixed window, then it reports `idle_writes` (1 when another connection committed to the Project database in that window, else 0; limit 0.5) and `idle_cpu_percent` (the Daemon's CPU time over the window as a share of one core; limit from the measurement in the PR). A run over either limit fails. Tests: `ip7168c_the_idle_window_sees_a_write_and_the_cpu` in `crates/perf/tests/`, over a synthetic database and process; the limits themselves are held by `just perf`.

**IP7168d a hidden Project's Terminal draws nothing.** Given a Project's Pane kept mounted and hidden (`data-inactive`, U7155a) with a Terminal in it, when output reaches that Terminal, then its buffer holds the output and the renderer draws none of it; when the Pane is shown again, the Terminal draws the output it missed in the task that shows the Pane, so the first frame of the switch holds it (U7155a's last-screen promise). The `.pane-host` rule keeps the Pane's size, so the hide moves, fits and unmounts no Terminal. Tests: `ip7168d_a_hidden_panes_terminal_parses_output_and_draws_nothing_until_shown` in `apps/desktop/src/terminal/ip7168d_browser.test.ts`, on the real App page, the real stylesheet and the DOM renderer (xterm's pause, an `IntersectionObserver` on the screen element, stops it the same way as WebGL); it first shows a visible Terminal's draw, so a green run cannot mean the page cannot draw. And `ip7168d_a_project_switch_redraws_the_terminal_it_shows_once` in `apps/desktop/src/u7155_switch_paint.test.tsx`: each Project switch draws the Terminal it shows, once.

## Verification

Policy: IP7168a and IP7168b use an in-process runtime with a paused clock, no child process. IP7168c's metric runs the real Daemon only in `just perf`. IP7168d needs a browser, since only one decides whether a hidden element still intersects the viewport. The PR carries a before and after table of `idle_writes` and `idle_cpu_percent` on one host in one session, taken on a scratch Daemon over a read-only copy of a real Project. The owner's Mac before and after reading follows the merge and is the owner's observation. The Daemon's memory guard (AMG4) still reads the process list once a second; it stays as specified and is the largest idle cost left.
