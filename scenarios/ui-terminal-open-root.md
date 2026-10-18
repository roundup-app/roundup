# UI: opening a Terminal with nothing selected but the Project root

Module: `apps/desktop/src/bubbles`. Ids: U524. Terms: Terminal, Bubble, Workstream, Project root (`GLOSSARY.md`). Work Issue: #2226. Journey stage: Intervene (`.agents/data/journey.md`, “What must work”): the user opens a Terminal in one step.

**U524 a Terminal opens from the Project root.** Narrows U469's “Open and missing selection”; #2633 reconciles the empty case with U2571b and extends X12; changes no App seam command or Token. Given an open Project whose selection is the Project root and resolves to no Workstream, then:

- **One step when a Workstream exists.** Activating `+` (`New Terminal`) or `⌘T` makes one `terminal.open` for the Project's first Workstream in Rail order, shows and focuses the returned Bubble as U469 requires, and leaves the selection on the Project root. Asserted by `u524_plus_and_cmd_t_from_the_project_root_open_in_the_first_workstream`.
- **Empty Project.** With no Workstream, either activation calls `terminal.open {workstream: null}` once, shows and focuses its Project-owned Bubble, and leaves the selection at the Project root. It calls neither `rail.createWorkstream` nor `rail.startDoor`. Asserted by `u524_an_empty_project_opens_and_focuses_a_project_terminal`.
- **Failure recovery.** A rejected open shows U469's failure text in the bar; retry succeeds, focuses its Bubble and clears the failure. Asserted by `u524_a_failed_empty_project_open_can_be_retried`.
- **Moves.** D2, D5 and D6 hold for the Bubble and failure in the bar at 1512×950 in light and dark. The design critic judges these Checks (AGENTS.md rule 10).

Tests: the named `u524_` tests in `apps/desktop/src/bubbles`, Vitest with the fake App for calls, focus and status, isolated headless Chromium on the U26 harness for geometry and computed styles. Rewrite U469's `u469_plus_and_cmd_t_without_a_workstream_show_the_selection_message` and the two same-text tests in `u165_keys` and `u469_bar` to this scenario's wording, retaining every unaffected assertion. Policy: progress goes on #2226, not here.

Moves: D2, D5, D6 (`docs/design-system.md`); existing Tokens only.
