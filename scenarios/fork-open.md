# Opening a Fork (FO5978)

Module: `crates/agents` (startup, resume, Worktrees), `crates/rupd` (the Fork marker read at open), `crates/todos` (unassign) and `crates/messages` (drop), the last two through the copy that `data.fork` already makes (`scenarios/data-fork.md`). Terms: Fork, Agent, Auto, Terminal owner, Worktree (`GLOSSARY.md`). Principles served: P5. Work order: #5978. Tests use an in-process Daemon on a Fork made by `data.fork` (FK5977a), a fake `claude` that records its argv and a temporary git Project; no network, no model, no display. Adds no RPC and no public type. Ids: FO5978a–FO5978e.

## Checks on main

1. `scenarios/data-fork.md`, FK5977d: `<path>/fork.json` marks a data folder as a Fork.
2. `crates/agents/src/owners.rs`, `Agents::reattach_owners`: reattaches saved Terminal owners (A12a).
3. `crates/agents/src/resume.rs`, `Agents::resume_saved`: starts a saved conversation in place.
4. `crates/agents/src/auto.rs`, `Agents::set_auto`: the one writer of an Agent's Auto.
5. `crates/agents/src/worktree.rs`, `Worktrees::provision` and `Worktrees::discard`: make and remove a Worktree under a Project folder.

**FO5978a every Agent starts stopped.** Given a data folder holding `fork.json` and Agents the live folder had running, working or needing-you, when the Daemon opens it, then every Agent reports `stopped` with its conversation id kept, no launch is made, no Terminal is created and no program starts. A data folder with no `fork.json` opens as before. Tests: `fo5978a_fork_opens_every_agent_stopped` and `fo5978a_live_folder_opens_unchanged` (`crates/agents/tests/scenarios/`).

**FO5978b no Terminal owner is re-attached and every Auto is off.** Given the Fork of FO5978a whose Agents saved owner records and `auto` on, when it opens, then `reattach_owners` attaches none and drops the records, so no Terminal of the live App is joined (A12a), and every Agent's Auto reads off; `workstream.setAuto` on a forked Agent works as before once the owner turns it on. Tests: `fo5978b_fork_attaches_no_owner_and_turns_auto_off`.

**FO5978c resuming starts as a new branch.** Given a forked Agent with a saved conversation, when the owner resumes it (`agent.resume`), then the fake `claude` is launched with `--resume <conversation id> --fork-session` and the Agent takes the new conversation id from its first `SessionStart`, so the live conversation file is not appended to and the live Agent's id still names it. An Agent of a live folder resumes with `--resume` and no `--fork-session`. Tests: `fo5978c_resume_in_a_fork_passes_fork_session` and `fo5978c_resume_in_a_live_folder_does_not`; the unchanged-conversation clause is read from the fake's recorded argv and a byte comparison of the source conversation file.

**FO5978d no Worktree is made or removed in a live Project folder.** Given the Fork's Projects keyed as the live folder's (FK5977a) and a Project folder the live App owns, when a forked Agent that held a Worktree resumes, a new Agent is created or an Agent is removed, then `provision` makes no Worktree and `discard` and `remove_landed` remove none under that Project folder; `git worktree list` and the `refs/roundup/` refs of that folder are equal before and after; a forked Agent that needs a Worktree to continue fails with `INVALID_PARAMS` naming the Fork and starts nothing. Tests: `fo5978d_fork_never_provisions_in_the_live_project` and `fo5978d_fork_never_removes_a_live_worktree`.

**FO5978e left-out Agents leave no owner or Message behind.** Given a Fork picked without an Agent (FK5977b) that owned a Todo and sent and received Messages, when the Fork opens, then the Todo is unassigned and otherwise unchanged (title, status, order), no Message to or from that Agent exists, and no Todo or Message of a kept Agent changes. Tests: `fo5978e_left_out_agent_todo_is_unassigned` and `fo5978e_left_out_agent_messages_are_dropped`.

**Regression: opening a Fork spends nothing.** Given FO5978a's Fork and a fake `claude` that records every launch, when the Daemon opens and idles for the length of a session-start timeout, then the fake was launched zero times, so no model token is spent, until `agent.resume` runs (policy; proven by FO5978a's zero-launch clause).
