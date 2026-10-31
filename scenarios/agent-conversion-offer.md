# The Rail offers a conversion only the Daemon accepts (A5287, U5287)

Module: `crates/contracts`, `crates/agents`, `apps/desktop/src/rail/` and `contracts/generated/`. Ids: A5287, U5287. Acceptance for #5287. Refines U5214 of `scenarios/agent-conversion.md`, whose "exactly when the Daemon would accept" the UI cannot meet from today's `RailNode` fields.

## Checks on main

1. `crates/contracts/src/agent.rs`, `RailNode`: carries `can_resume`, which is false while an Agent runs.
2. `crates/agents/src/rail_view.rs`: fills the `RailNode` fields from the Agent's state.
3. `apps/desktop/src/rail/menu/model.ts`, `createRailMenu`: builds the Rail menu entries for a row.
4. `scenarios/agent-conversion.md`, A5214a and A5214b: the guards of `agent.makeWorkstream` and `agent.saveAsMode`.

**A5287 the Rail node says which conversions the Daemon accepts.** Contract change (the Contract recipe). `RailNode` gains the booleans `can_make_workstream` and `can_save_as_mode`, and `GLOSSARY.md` records both in the same PR. The Daemon fills each from the same guard `agent.makeWorkstream` and `agent.saveAsMode` apply, so the flag is true exactly when the call would not be refused with `CONFLICT`: `can_make_workstream` is true for an Agent, running or exited, that has a saved conversation, is no child of a Workstream and is no Door; `can_save_as_mode` is true for an Agent roundup started. Both are false for a Terminal, a Door, a Workstream and a Group. A just-launched Agent with no saved conversation has `can_make_workstream` false and turns true once its conversation is saved, in the next Rail update. An Agent started by hand has `can_save_as_mode` false (`a5287_the_flags_follow_the_method_guards`). A table test over each node kind, running and exited, with and without a conversation, started by roundup and by hand, calls each method and checks it is accepted exactly when its flag is true (`a5287_a_flag_is_true_exactly_when_the_method_is_accepted`).

**U5287 the menu reads the flags.** Given a Rail on `agents-10` and `tree-40` (U26), when the owner opens the menu of a row, then **Make a Workstream** appears exactly when the row's `can_make_workstream` is true and **Save as Mode…** exactly when its `can_save_as_mode` is true; no other field decides either entry. A row of an Agent started by hand shows no Save as Mode…, and a just-launched Agent with no saved conversation shows no Make a Workstream (`u5287_the_entries_follow_the_row_flags`). This replaces the table of U5214 that derives the entries from the row's kind, state and parent; `u5214_offered_entries_match_the_daemon_guard` is rewritten to feed the flags and keeps its rows.

Observer: A5287 by `crates/agents` tests over the Agents fixture with the fake `claude` (`ROUNDUP_CLAUDE_BIN`, A4); U5287 by a Vitest model test in `apps/desktop/src/rail/menu/`.
