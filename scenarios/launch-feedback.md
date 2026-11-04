# A launching row shows `starting` until the program is up

Module: apps/desktop/src/rail; U6000a, U6000b, U6000c, U6000d, U6000e.

Acceptance for [#6000](https://github.com/roundup-app/roundup/issues/6000). The owner: "start agent or resume for workstream is also slow with no feedback or spinner at all". Tests marked planned belong to implementation; this specification changes no runtime behavior and no contract.

## Boundaries

Policy: every action that starts a program shows its row at its place in the next frame with the existing `starting` Status (the Rail's existing busy indicator and existing Tokens), in the Rail and in the Pane, and the state stays until the Daemon reports a later Status or the call fails. The actions are new Agent, new Workstream with its Door, Start Door, resume, resume with a mode and restart. Import starts no program (U2875b), so its rows never show `starting`; the Start Door that follows an import is the Start Door row of U6000a.

Policy: no new Status kind, contract or RPC method. The Daemon's launch steps, bounds and order stay as A7, A22, A24 and the Door restart scenario say; only the moment it publishes the row changes. Any new motion goes through `docs/design-system.md`. It reuses the call queue and `operation` ids of [`scenarios/rail-instant-actions.md`](rail-instant-actions.md) (U5991a, U5991b); a PR that adds queue or indicator machinery carries AGENTS.md rule 9's `Reuse:` section.

**U6000a A launching row shows `starting` in the next frame.** Given a connected Project whose fake seam delays `agent.spawn`, `agent.resume`, `rail.startDoor`, `rail.createWorkstream` and `workstream.restart` by 10 s, when each launching action is fired by its key or its click, then the next frame shows the row at its place (a new Agent under its parent, a new Workstream with its Door, the resumed, started or restarted row where it was) with Status `starting`, in the Rail and in the Pane for the selected row, and also for a Workstream that is not selected; the existing "+" disabled state is not the only sign. Planned test: `u6000a_every_launch_renders_starting_before_its_call_answers` in `apps/desktop/src/rail/menu/u6000_launch.test.tsx`, table-driven over the actions, asserting the row's role and Status one frame after the action while the fake call is pending. Timing: `u6000a_key_to_starting_stays_under_the_frame_budget` in `apps/desktop/src/perf/` records each action's click or key to a rendered `starting` row in the frame journal style of `apps/desktop/src/perf/frames.ts` and asserts p95 under rule 7's 16 ms; layout and looks are the design critic's.

**U6000b `starting` stays until a later Status or a failure, and never after.** Given a launching row, when the Daemon reports the row's later Status (Claude Code is up) or the call fails, then the row shows the real Status or the failure and no `starting`; the state does not clear on the reply to `agent.spawn` or `rail.refresh` alone while the Daemon still reports `starting`. Planned tests in `apps/desktop/src/rail/menu/u6000_launch.test.tsx`: `u6000b_starting_stays_until_the_daemon_reports_a_later_status` (call answered, Daemon Status still `starting`, row still `starting`; then the Status arrives and the row shows it) and `u6000b_no_row_shows_starting_after_the_program_is_up_or_a_failure`.

**U6000c A failed start keeps the row with its cause and retry.** Given a launching row whose call fails (the fake seam refuses it, times it out, or the Daemon is gone), when the failure arrives, then the row stays at its place with the existing failure text naming the cause (`apps/desktop/src/rail/itemFailure.ts`) and its existing retry, and shows no `starting`; a new Agent whose spawn is refused keeps its row only if the Daemon holds it. Planned test: `u6000c_a_refused_start_shows_the_failure_text_and_retry_without_starting` in `apps/desktop/src/rail/menu/u6000_launch.test.tsx`, table-driven over refused, timed out and Daemon gone.

**U6000d A start fired while another is pending is never refused.** Given a launch whose call is pending, when the user fires another launch, including a second New Agent and a resume of another row, then each shows `starting` at once, none is refused for coming second, and each reaches the Daemon once in the order fired. Planned test: `u6000d_launches_fired_while_one_is_pending_all_reach_the_daemon_in_order` in `apps/desktop/src/rail/menu/u6000_launch.test.tsx`; it retires the repeat-click drop of the `resuming` set and the `pending` guard of `guarded` for launches, and a second click on the same row's resume still sends one call.

**U6000e The Daemon publishes the starting row before it provisions.** Given an `agent.spawn` held at its worktree step, when `rail.tree` is read, then it already lists the new node with Status `starting`, and `rail.changed` was emitted once `mark_starting` ran, before the worktree, config and launch steps; the same holds for `agent.resume` and `rail.startDoor` before their acknowledgement waits. The launch steps, bounds and order are unchanged, and a failed launch leaves no node showing `starting`. Planned tests in `crates/agents/tests/scenarios/spawn.rs`: `u6000e_spawn_held_at_the_worktree_step_already_lists_a_starting_node` and `u6000e_a_failed_spawn_leaves_no_starting_node`, through the real `rupd` with a fake `claude` and a held provisioning step, asserting `rail.tree` and the `rail.changed` count. One real run, `u6000e_a_real_start_and_resume_show_starting_then_move_on` in `crates/rup/tests/door_actions.rs`, a real-Claude test under E2962: it starts and resumes a real Claude Code Agent through the real Daemon, asserts `rail.tree` reports `starting` first and a later Status once Claude Code is up, and relies on U6000a for the frame. No native Mac observer is requested.

## Gates and observers

Policy: P3557c's failure line names the cause of a failed start (U6000c); P9 asks whether an action starts a program, and U6000d counts calls. Existing A7, A22, A24 and U5991 proofs stay as `main` holds them.

Checks retained on main:

| Check | Existing holder on main | Required observation |
| --- | --- | --- |
| 1 | `scenarios/agents.md`, **A22** and **A24** | The Daemon's resume and Start Door acknowledgement bounds are unchanged. |
| 2 | `scenarios/rail-instant-actions.md`, **U5991a** | Other Rail actions still render before their call answers. |
| 3 | `docs/design-system.md`, "The checks" | Visible Checks hold; no new Token or motion. |
