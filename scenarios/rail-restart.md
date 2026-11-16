# Restart an Agent on its saved conversation (U7191a, U7191b, U7191c)

Module: `apps/desktop/src/rail/` (the menu) and `crates/agents/` (the resume path). Ids: U7191a, U7191b, U7191c. Acceptance for #7191. Owner's 2026-11-15 pick: Restart resumes the same conversation, not a fresh one; a fresh-conversation restart is out of scope. A Mode's `agent.restartMode` (A35, A4665) is unchanged and stays the saved-prompt restart.

## Checks on main

1. `apps/desktop/src/rail/menu/model.ts`, `lifecycleEntries` and `restart`: the `restart` entry shows only on a running YOLO Agent and calls `agent.resume {id, mode: "normal"}`, which switches the mode; `startYolo` is its mirror.
2. `crates/contracts/src/declarations.rs`, `"agent.resume"`: an explicit `mode` stops a running Agent or Door first and resumes its conversation; an omitted `mode` requires an exited Agent.
3. `crates/agents/src/resume.rs`, `Agents::resume`: the one launch path with A22's acknowledgement and rollback; `agent.extras_add` (`crates/agents/src/dispatch.rs`) already relaunches with the conversation.
4. `apps/desktop/src/rail/menu/model.ts`, `needsConfirmation` and `requestStop`: a `working`, `needs-you` or `blocked` Door asks once before stopping; any other running Agent stops at once.

**U7191a Restart resumes the same conversation.** Narrows U2694d and U4322a (its run group keeps Restart first). Given an Agent row of any kind (Door, Workstream, Mode, child) in any status whose conversation the Daemon holds, when the user chooses Restart from its right-click menu, then:

- The Agent's program stops and starts again resuming that conversation in the permission mode it ran in, through the one `agent.resume` path with an explicit `mode`; no third relaunch path is added, and `agent.extras_add` shares that launch code. Rust test: `u7191a_restart_resumes_the_same_conversation` (stops the old run, starts one resuming the same conversation id with the same mode, same Rail row id, a fresh Terminal id; the fresh run reads current settings and tools).
- A Mode's Restart with a saved conversation is this one, not `agent.restartMode`: it types no saved prompt. Test: `u7191a_a_mode_restart_types_no_saved_prompt`.
- The Rail menu calls `agent.resume {id, mode}` once with the Agent's current mode. Vitest: `u7191a_restart_calls_resume_with_the_current_mode`.
- The former YOLO-only `Restart` entry, which switched a YOLO Agent to normal, is relabelled `Start normal` (the mirror of `Start YOLO`) so the menu holds one Restart. Vitest: `u7191a_yolo_to_normal_is_start_normal`.

**U7191b Restart is offered only with a conversation to resume, and asks only when interrupting work.** Given the menu of a row, then:

- Restart is present only when the Daemon reports a saved conversation for that Agent (a running Agent that has started one, or an exited one with `can_resume`); otherwise it is absent, never greyed out, except that a Mode with no saved conversation keeps Restart, its only way to start (`agent.restartMode`, A4452c; `u4547d_restart_controls_share_the_focused_mode_action`). The row carries that fact on `RailNode` (Contract recipe: `GLOSSARY.md`, `contracts/generated/` and every caller in the same PR). Vitest: `u7191b_restart_is_absent_without_a_conversation`; Rust test for the fact: `u7191b_the_row_reports_a_conversation`.
- An idle, done or stopped Agent restarts at once. A `working`, `needs-you` or `blocked` Agent asks once first, by the same rule and function as Stop (`needsConfirmation`); declining calls nothing. Vitest: `u7191b_restart_asks_only_when_it_interrupts_work`.

**U7191c a failed Restart says why.** Given the Daemon cannot find the conversation or the program does not start, when the user chooses Restart, then the row shows U80's `✕ <cause>` and the Agent never shows a silent idle; A22's rollback leaves the Terminal and row as before and the same Restart can be chosen again. Rust test: `u7191c_a_failed_restart_names_the_cause`; Vitest: `u7191c_the_row_shows_the_restart_failure`.

Policy — rendered observer: `just capture U7191a U7191b U7191c` in dark mode, the menu open on a working Door (the question) and an idle one, and the failure line on the densest seed (`tree-40`); the design critic judges them. Native look-and-feel is the user's to report on the Mac.
