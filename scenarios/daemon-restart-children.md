# A Daemon restart keeps live children and never runs a finished one (A5335)

Module: `crates/agents` (owner reattach, resume), `crates/rupd` (startup). Ids: A5335a–A5335d. Work order: #5335. Narrows A8, A12a and A22; the lifecycle contract is otherwise unchanged and adds no RPC or public type.

## Checks on main

1. `crates/agents/src/owners.rs`, `Agents::reattach_owners`: a saved owner that does not reattach is dropped and its Agent reports `done` (A12a).
2. `crates/agents/src/resume.rs`, `Agents::resume_saved`: starts the saved conversation for any caller; it does not look at whether the Agent finished its job.
3. `crates/messages/src/digest.rs`, `NO_FINDING`: the end note `ended with no finding` (B49c).

**A5335a a restart reattaches every live child.** Given a Door with several children whose Terminals run under surviving owners (A12a) and a Daemon that restarts, once or again before the first restart's children settle (the socket moves each time), when `Agents::open` and `reattach_owners` run, then each child keeps its Terminal, shows its Status from its Run, and is never `terminal gone`; its owner record is dropped only when the owner is gone, exited, replaced or in another Project, and a second restart keeps the records the first kept. The observer restarts a real persisted Rail twice with fake owners and asserts three kept children after each reopen and a launch count of one each. Tests: `a5335a_two_restarts_keep_every_live_child` (`crates/agents/tests/scenarios/`).

**A5335b a restart never starts a child that finished.** Given a child whose job ended (it sent its end note, or its Attempt ended with its Terminal gone), when the Daemon restarts, then no Attempt starts for it, no input reaches any program, it stays `done`, and no Model turn is spent (P9). Only a user's `agent.resume` or `rail.startDoor` (A22, A23) starts it again; no startup, reattach or notice path calls `resume_saved` for it. The observer reopens a Rail holding a finished child beside a live one and asserts the finished child's launch count is unchanged and the live one is reattached. Tests: `a5335b_a_restart_resumes_no_finished_child` (`crates/rupd/tests`).

**A5335c a child with no saved conversation is not resumed.** Given an Agent with no A21 data, when any path other than the user's explicit start asks to resume it, then that is `CONFLICT` and no Terminal starts, so no second `ended with no finding` note (B49c) is made by a resume that had nothing to resume. Tests: `a5335c_resume_without_a_saved_conversation_starts_nothing` (`crates/agents/tests/scenarios/resume.rs`).

**A5335d a reopen launches no child again.** Given the Rail of A5335a with three live children, each launched once, when `Agents::open` and `reattach_owners` run twice in turn, then every child's launch count is still one after each reopen, so a reopen that relaunches a child fails. The observer reads the launch count of each child from the fake owners and the Terminal list. Tests: `a5335d_reopen_keeps_each_launch_count_at_one` (`crates/agents/tests/owner_reopen.rs`).

## Gates

Applies P4, P9 and P13: reopen starts no program, an Attempt that may have spent tokens is never repeated, and an uncertain restart leaves the child as it was. This specification changes no App surface, so no visual Check applies.
