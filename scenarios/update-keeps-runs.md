# An update keeps every running Door, Mode and resumed Agent (UKR)

Module: `crates/agents` (owner records, reattach, start, resume). Ids: UKR1–UKR4. Work order: #7722. Narrows A12a and S5981a; amends #7717's outside-process case for roundup's own surviving program. Adds no RPC method and no public type.

## Checks on main

1. `crates/agents/src/owners.rs`, `Agents::reattach`: reattaches only an Agent node whose record holds the node's current Attempt, then drops the record.
2. `crates/agents/src/spawn.rs`, `save_owner` call: only a launch writes an owner record; the resume attach in `crates/agents/src/registration.rs` writes none.
3. `crates/agents/src/resume.rs`: a start that adopts a live program waits for an acknowledgement and stops the program when none comes.
4. `crates/agents/tests/scenarios/fork_open.rs`: calls `reattach_owners()` in-process.

**UKR1 every Terminal attach saves the owner record.** Given an Agent, Door or Mode that starts, or resumes an earlier conversation, when its Terminal attaches, then the owner record holds that node's id, Run, Attempt and conversation, so a node resumed any number of times has one record naming its current Attempt. Test: `ukr1_a_resumed_door_and_a_resumed_agent_save_their_owner_record` (`crates/agents/tests/scenarios/fork_open.rs`).

**UKR2 a reopen reattaches Doors, Modes and resumed Agents.** Given a Door, a Mode resumed once and an Agent resumed once, each running under an owner (A12a), when `reattach_owners` runs on a reopened Project, then each keeps its Terminal, Attempt and conversation, reports running, and nothing new launches: launch count unchanged, no input typed, no Model turn spent (P9). A record whose owner is gone, exited or replaced is dropped as A12a says. Test: `ukr2_reopen_reattaches_a_door_and_a_resumed_agent_on_the_same_terminal_and_attempt` (`fork_open.rs`).

**UKR3 a start never stops a live program of its node.** Given the reopen of UKR2, when `agent.resume` or a Door start runs for a node whose program is live, then it attaches that program as the node's current run with no acknowledgement wait, or is refused; it never stops the program, and the pid is the same afterwards. This holds for roundup's own surviving program and wins over #7717 for it; a Claude Code background-service conversation outside roundup keeps #7717's case. Test: `ukr3_a_start_after_reopen_leaves_the_live_program_alive` (`fork_open.rs`, one case each for a Door and a resumed Agent).

**UKR4 a reattach keeps the Channel state.** Given a reattached Agent whose Channel read connected before the exit, when the reopen completes and the Channel deadline passes with no new event, then the Channel still reads connected and no deadline was re-armed by the reattach; a Channel that read missing stays missing. Test: `ukr4_reattach_keeps_the_channel_state_and_arms_no_deadline` (`fork_open.rs`).

## Observer

Mac, only the user's Mac makes it: Restart to update with a working Door of an Auto Workstream and a Mode resumed once. Both keep their pids, the Door's turn continues, the Rail shows both running, and a new unassigned Todo reaches the Door after the update (S5981a).

## Gates

Applies P9: no reopen spends a Model turn or types input. No App surface changes, so no visual Check applies.
