# A Mode nests under the root Agent that started it (A7494a, A7494b, A7494c, A7494d, U7494a)

Module: `crates/contracts`, `crates/rup`, `crates/agents`, `crates/rupd`, `crates/messages` and `apps/desktop/src/rail/`. Ids: A7494a, A7494b, A7494c, A7494d, U7494a. Acceptance for #7494. Owner's 2026-11-18 picks: a shaper is a Mode under Planner, keeps its saved first prompt and asks the user directly; its Restart resumes the conversation, as a root Mode's does (U7191a). One definition change: a Mode is an Agent with a saved first prompt, at the Project root or directly under the root Agent that started it.

## Checks on main

1. `crates/agents/src/rail/placement.rs`, `move_node`: refuses a Mode under any parent ("must stay at the Project root"); `rail.move` keeps refusing to put any Agent under an Agent (A6, A26).
2. `crates/agents/src/rail/row.rs`: drops `mode_prompt` from a node with a parent.
3. `crates/rupd/src/restart.rs`, `Daemon::restart_mode`, and `crates/messages/src/restart.rs`: `agent.restartMode` reserves the saved prompt and types it once (A35, A4665).
4. `crates/rupd/src/context.rs`: `agent.context` answers `ask.to` from the parent (E2).
5. `crates/rupd/tests/support/mode_prompt.rs`, `u4547d_restart_uses_the_saved_prompt_and_preserves_contents`: the real-Daemon fake-Claude observer for a root Mode.

**A7494a a root Agent starts a nested Mode.** Contract change (rule 4): `agent.spawn`, its `agent_spawn` tool and `rup agent spawn` take a third role beside `job` and `consult` (DCL9), `mode`, that takes the Mode's name and first prompt instead of an order (O8), skips the lean child start (LC1) and launches as a root Mode does: the ordinary Agent role, Brief and the user's whole setup, so the first prompt may be a plugin slash command such as `/compose /intent …`. The call returns the new row id; `GLOSSARY.md` names the role in its Mode row and the Contract change rule's callers change in the same PR. Given a root Agent outside any Workstream (Planner is a root Mode), when it calls `agent.spawn` with role `mode`, a name and a first prompt, then:

- The new row's parent is the caller, its `mode_prompt` is the exact prompt, and both survive Daemon reopen. The Mode starts running, and its first prompt is typed once as its first user message, through the saved-prompt reservation `agent.restartMode` uses; a retry after a failed start types it no second time (A35, A4665). Tests: `a7494a_a_nested_mode_keeps_parent_and_prompt_across_reopen`, `a7494a_its_first_prompt_is_typed_once` (real Daemon, fake Claude, extending `crates/rupd/tests/support/mode_prompt.rs`).
- Refused, with a cause and no program started: a caller inside a Workstream, a caller that is itself nested (an Agent under an Agent, a nested Mode included), a missing or blank name or prompt, and a prompt together with an order. Test: `a7494a_a_nested_mode_is_refused_where_a_mode_may_not_nest`.
- `rail.move` still refuses to put a Mode, or any Agent, under an Agent (A6, A26: only a start nests), and Save as Mode (`agent.saveAsMode`) is unchanged. Test: `a7494a_move_still_refuses_to_nest_a_mode`.
- Only the user edits a first prompt (A4452c): no Message, Agent or Ask sets `mode_prompt` after the start; the starter keeps Reach over its nested Mode, so it can stop or remove it. Test: `a7494a_only_the_user_edits_a_nested_modes_prompt`.

**A7494b a nested Mode asks the user, not its parent.** Given the nested Mode of A7494a, then:

- Its `agent.context` names its starter as `parent` and `ask: {to: "you"}` (the user's Actor id, E2); it may still send its starter Messages (B1). Its Context says "Ask: the user", and it asks with `AskUserQuestion` in its own Terminal (A3564a). Test: `a7494b_a_nested_modes_context_asks_the_user`.
- Its parent's inbox receives none of its questions and no Digest push from it (B4699c, A5482a). Test: `a7494b_its_parent_gets_no_question_or_digest_push_from_it`.
- A Subagent started beneath the nested Mode still asks its parent, the Mode (`ask.to` is the Mode's id). Test: `a7494b_a_subagent_under_a_nested_mode_asks_its_parent`.

**A7494c Restart and clearing the first prompt.** Given the nested Mode of A7494a, then:

- Restart works as a root Mode's does: with a saved conversation it resumes that conversation and types nothing (U7191a); without one, `agent.restartMode` types the saved prompt once. A fresh-conversation Restart is not offered. Tests: `a7494c_restart_without_a_conversation_types_the_saved_prompt_once`, `a7494c_restart_with_a_conversation_resumes_it` (real Daemon, fake Claude).
- When the user clears its first prompt (`agent.setModePrompt`), it is an ordinary Subagent of its starter: its Context says `ask: {to: <starter's id>}` from then on, it asks its parent, and it keeps its row, parent and conversation. Test: `a7494c_clearing_the_prompt_makes_it_a_subagent_asking_its_parent`.

**A7494d the launch sets are unchanged.** Given a nested Mode, then its launch argv and files equal a root Mode's apart from the parent and the Context's `ask` (LC1: the ordinary Agent role, not the child profile), and a Job or Consult spawn still launches as before. Test: `a7494d_a_nested_mode_launches_as_a_root_mode_does`.

**U7494a the Rail shows a nested Mode beneath its starter.** Amends U4547a, U4547d and U4547e. Given a root Mode `Planner` with a nested Mode `Shape pad naming` and a Subagent `Explore` beneath the nested Mode, then:

- The nested Mode appears beneath Planner in Planner's section (MODES), in Rail order, with its Restart action, Restart menu item and R key (U4547d) and a First prompt setting (U4547c); Explore appears beneath it as an ordinary Agent. Clearing its first prompt leaves it beneath Planner and keeps it in MODES with its root. Test: `u7494a_a_nested_mode_shows_beneath_its_starter_with_restart`.
- The user cannot move it: no drag, no Move to… item, and it is no move destination (U4547e). Test: `u7494a_a_nested_mode_cannot_be_moved`.

```text
MODES
  Planner                       root Mode
    Shape pad naming            nested Mode: asks the user, Restart
    Shape mode subagents        nested Mode: asks the user, Restart
      Explore Mode placement    Subagent: asks its parent
```

Policy: not wanted: a Mode inside a Workstream, under a nested Agent or under another nested Mode; a nested Mode's questions relayed through its parent; a fresh-conversation Restart. Principles: P1 (a nested Mode is reachable directly in its own Terminal and hides no Agent), P6 (the user's placement wins), P9 (start and Restart type the saved prompt once). The Message laws M1 to M10 are untouched.

Policy — rendered observer: `just capture U7494a` in dark mode on the densest seed with the section above, Restart visible on the nested Mode; the design critic judges it.

## Amendments in the same PR

The implementing PR edits these to match, and no other scenario text: P1 (`PRINCIPLES.md`: a Mode may also sit directly under the root Agent that started it); the U4547 Direction, U4547a and U4547e (`scenarios/ui-rail.md`); A4452c (`scenarios/agent-lifecycle.md`); "root Mode" in A4665 (`scenarios/mode-restart.md`) and U4547d; E2 (`scenarios/awareness.md`: a nested Mode's `ask.to` is `"you"`); A5482a and A3564a (`scenarios/native-questions.md`); B4699c (`scenarios/messages.md`); DCL9's roles (`scenarios/door-closed-loop.md`); the Mode row of `GLOSSARY.md`.
