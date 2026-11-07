# A Door resumes the Jobs an App quit cut off (DCR)

Module: `crates/agents` (resume, open Jobs), `crates/messages` (start note), `crates/desktop` (quit). Ids: DCR1–DCR4. Work order: #6638. Amends A5335b and DCL7–DCL9; adds no RPC method and no public type.

## Checks on main

1. `crates/agents/src/resume.rs`, `Agents::resume_saved`: an Agent's `agent_resume` without `mode` is refused when the child has no run in this Daemon (A5335b).
2. `crates/agents/src/jobs.rs`, `Agents::open_jobs`: lists every open Job in the Project, whoever owns it.
3. `crates/agents/src/reach.rs`, `guard_reach`: the Reach of an Agent.
4. `crates/rup/tests/e2e/door_mcp.rs`, `dcl7_restart_resumes_only_jobs_selected_by_door`: the Door resumes with `mode` set, which skips check 1.
5. `scenarios/daemon.md`, D1: an attached Daemon ends every program with the App.

**DCR1 a quit marks the Jobs it cuts off.** Given a Workstream with one Job mid-turn, one Job that sent its report, and one Job the user stopped, when the App quits (D1, S3), then the Daemon records the first as cut off and the other two as finished, before it ends any program, and the record survives the restart. A Job whose turn ended without a report before the quit is finished, not cut off. No program outlives the App. Tests: `dcr1_a_quit_marks_only_the_job_mid_turn_as_cut_off` (`crates/rupd/tests`), with fake Claude and fake owners; no sleep.

**DCR2 an Agent resumes a cut-off Job in its Reach and no finished one.** Given the Jobs of DCR1 after a restart and a Door calling `agent_resume` without `mode`, then (a) the cut-off Job resumes its saved conversation; (b) the reported Job and the stopped Job are refused with `CONFLICT` as A5335b says, and no Attempt starts; (c) a cut-off Job outside the caller's Reach is refused with the Reach error. With `mode`, an Agent resumes any child in its Reach as before, and `mode` is unchanged. Tests: `dcr2_resume_without_mode_takes_a_cut_off_job_and_refuses_a_finished_one` and `dcr2_resume_outside_reach_is_refused` (`crates/agents/tests/scenarios/resume.rs`); A5335b's test stays green.

**DCR3 the start note lists only the Door's own Jobs.** Given two Workstreams in one Project, each with open Jobs, when one Door starts, then its `[open jobs]` note names only open Jobs in that Door's Reach, a Job of the other Workstream appears nowhere in it, and a Door whose Reach holds no open Job gets no note. Tests: `dcr3_open_jobs_note_leaves_out_another_workstream` (`crates/messages/src/inbox.rs` tests).

**DCR4 a quit and relaunch carries on the cut-off Job with no user input.** Given a Door with one Job mid-turn and one reported Job, when the App quits and relaunches, then with no `agent.resume` from the user the Door calls `agent_resume` without `mode` on the cut-off Job, which carries on; the reported Job stays stopped and its launch count is unchanged; and the Door's start note lists only its own Jobs. DCL7a's `dcl7_restart_resumes_only_jobs_selected_by_door` passes with its fake Door calling `agent_resume` without `mode`. Which Jobs a model chooses to resume is policy; the test proves the Daemon's effects. Tests: `dcl7_restart_resumes_only_jobs_selected_by_door` (`crates/rup/tests/e2e/door_mcp.rs`, edited to drop `mode`) and `dcr4_relaunch_carries_on_the_cut_off_job_only` (same file). Observer: the owner's Mac relaunch of a real Door with one mid-turn and one reported Job (a real `claude` run only the user's Mac makes).

## Gates

Applies P4 and P9: only a Job the quit itself cut off resumes without `mode`, so no finished Job spends a Model turn. This specification changes no App surface, so no visual Check applies. Implementation splits into child Issues, each blocked by the one before: DCR1, then DCR2, then DCR3, then DCR4.
