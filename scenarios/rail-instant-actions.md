# Rail actions draw their result at once

Module: apps/desktop/src/rail; U5991a, U5991b, U5991c, U5991d.

Acceptance for [#5991](https://github.com/roundup-app/roundup/issues/5991). The owner: "removing something from the rail is too slow the UI should be fast even if the actual removal still happens in the BG". Tests marked planned belong to implementation; this specification changes no runtime behavior and no contract.

## Boundaries

Policy: every Rail action draws its result in the next frame from state the App holds, sends its call with its existing `operation` id, then reconciles with the Daemon's reply and Events. The actions are remove, remove selection, stop, resume, rename, move and reorder, make Workstream, new Agent, Workstream or Mode, and the undo and redo of each.

Policy: the Daemon's removal steps, bounds and order stay as A16, A34 and G5 say; no contract, method or generated file changes. A loss question (U4461, U5690d, G5) is asked before anything leaves the Rail, judged from data the App already holds where it can; no action skips it. No spinner or "removing" state shows when the call succeeds. Reuse: before writing a call queue, the implementation reads what Solid's `createStore`, `produce` and `reconcile` and maintained libraries offer and carries AGENTS.md rule 9's `Reuse:` section.

**U5991a A Rail action renders before its call answers.** Given a connected Project whose fake seam delays every Rail call by 10 s, when each Rail action is fired by its key or its click, then the Rail shows the result in the next frame: a removed Agent or Workstream row is gone with the siblings after it in their order, a stopped, resumed, renamed, moved, reordered, grouped or created row shows its new state at its place, and an undo or redo shows the restored or removed rows at once. No spinner or "removing" state shows. Planned test: `u5991a_every_rail_action_renders_before_its_call_answers` in `apps/desktop/src/rail/menu/u5991_instant.test.tsx`, table-driven over the actions, asserting the Rail's rows and roles one frame after the action while the fake call is pending, and that the call carries its `operation` id. Timing: `u5991a_key_to_render_stays_under_the_frame_budget` in `apps/desktop/src/perf/` records each action's key or click to render in the frame journal style of `apps/desktop/src/perf/frames.ts` and asserts p95 under rule 7's 16 ms; layout and looks are the design critic's.

**U5991b Actions fired while earlier ones are pending queue in order.** Given a removal whose call is still pending, when the user fires further actions, including a second removal of another row and an undo of the pending removal, then none is refused for coming second, each reaches the Daemon once in the order fired, and the undo waits in the queue for the removal's receipt before it is sent. Given ten removals and one undo fired within a second against the delayed fake seam, then the seam receives eleven calls, each once, in order. Planned test: `u5991b_ten_removals_and_an_undo_reach_the_daemon_once_in_order` in `apps/desktop/src/rail/menu/u5991_instant.test.tsx`. The refusal `removeRailSelection` makes while a removal is pending (`block()` in `apps/desktop/src/todos/deleteTodos.ts`) is retired for the Rail; the test asserts the second removal is accepted.

**U5991c A failed call puts the Rail back as the Daemon holds it.** Given an action drawn at once whose call fails (the fake seam refuses it, times it out, or the Daemon is gone), when the failure arrives, then the Rail again shows the state the Daemon holds: a removed row returns at its place under its parent with its children, and an unreachable Daemon leaves the Rail as the last Daemon state, with the existing failure text naming the cause (`apps/desktop/src/rail/itemFailure.ts`, P3557c). Actions queued behind the failed one run against the restored state, and none shows a row back without that text. Planned test: `u5991c_a_failed_call_returns_the_row_with_the_failure_text` in `apps/desktop/src/rail/menu/u5991_instant.test.tsx`, table-driven over refused, timed out and Daemon gone, with the existing `u4461_a_failed_removal_shows_the_message` kept for the Workstream question.

**U5991d A removal that would lose work still asks first.** Given an Agent or Workstream removal that G5, A34 or U4461 would refuse or ask about (a dirty or ahead Worktree, a running child, an open Todo), when the user removes it, then the question shows before any row leaves, judged from data the App already holds where it can, and Cancel or Escape leaves the Rail and the seam's call log unchanged; a clean removal asks nothing and the row leaves in the next frame. Where the App's data cannot decide, the row stays until the Daemon answers and no row leaves unasked. Planned test: `u5991d_a_loss_question_precedes_the_optimistic_removal` in `apps/desktop/src/rail/menu/u5991_instant.test.tsx`, reusing the seeds of `u4461_remove.test.tsx` and `u5170_remove_blocked.test.tsx`; a Workstream removal no longer awaits `judgeRemoval` before its question shows when the App holds the children's state.

**U5991e A real removal leaves the row at once and the program within its bound.** Given a running real Claude Code Agent and the real Daemon, when the user removes it, then the row leaves in the next frame and the program exits within the existing bound of `CLEAN_EXIT_BOUND` (5 s) plus `KILL_WAIT_BOUND` (2 s), 7 s, that A16 and A17 stop under. Planned test: `u5991e_a_real_removal_hides_the_row_and_the_program_exits` in `crates/rup/tests/door_actions.rs`, a real-Claude test under E2962: it removes through the real Daemon, asserts `rail.tree` and the Terminal's exit within 7 s, and relies on U5991a for the frame. No native Mac observer is requested.

## Gates and observers

Policy: P5 asks whether landing is explicit, so a removal that would lose work asks first (U5991d), and P3557c's failure line names the cause of a returned row (U5991c). P9 asks whether an action starts a program; U5991b counts calls. Existing A16, A34, G5, U4461, U5690d and U3787a proofs stay as `main` holds them.

Checks retained on main:

| Check | Existing holder on main | Required observation |
| --- | --- | --- |
| 1 | `scenarios/agents.md`, **A16**; `scenarios/worktrees.md`, **G5** | The Daemon's stop, check and delete order and bounds are unchanged. |
| 2 | `apps/desktop/src/rail/menu/u4461_remove.test.tsx`, `u4461_cancel_and_escape_call_nothing` | A cancelled question calls nothing. |
| 3 | `apps/desktop/src/rail/menu/u3787a_undo.test.tsx` | Undo and redo restore the retained operation. |
| 4 | `docs/design-system.md`, "The checks" | Visible Checks hold; no new Token or motion. |
