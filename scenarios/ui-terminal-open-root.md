# UI: opening a Terminal with nothing selected but the Project root

Module: `apps/desktop/src/bubbles`. Ids: U524. Terms: Terminal, Bubble, Workstream, Project root (`GLOSSARY.md`). Work Issue: #2226. Journey stage: Intervene (`.agents/data/journey.md`, “What must work”): the user opens a Terminal in one step.

**U524 a Terminal opens, or the dead end shows its next step.** Narrows U469's “Open and missing selection”; changes no RPC method, contract, App seam command or Token. Given an open Project whose selection is the Project root and resolves to no Workstream, then:

- **One step when a Workstream exists.** Activating `+` (`New Terminal`) or `⌘T` makes one `terminal.open` for the Project's first Workstream in Rail order, shows and focuses the returned Bubble as U469 requires, and leaves the selection on the Project root. Asserted by `u524_plus_and_cmd_t_from_the_project_root_open_in_the_first_workstream`.
- **Empty Project.** With no Workstream, either activation makes no `terminal.open` call and shows `Select a Workstream first` as an accessible status (`role="status"`) inside the bottom bar, beside `+`, never at the centre pane's top edge, and moves focus to the Rail's add-Workstream control. Asserted by `u524_an_empty_project_shows_the_message_in_the_bar_and_focuses_the_rail`.
- **Message lifetime.** The message clears on a successful open, a selection change or a Workstream's creation, and keeps U469's failure text for a rejected call. Asserted by `u524_the_message_clears_on_open_selection_or_creation`.
- **Moves.** D2, D5 and D6 hold for the message in the bar at 1512×950 in light and dark. The design critic judges these Checks (AGENTS.md rule 10).

Tests: the named `u524_` tests in `apps/desktop/src/bubbles`, Vitest with the fake App for calls, focus and status, isolated headless Chromium on the U26 harness for geometry and computed styles. Rewrite U469's `u469_plus_and_cmd_t_without_a_workstream_show_the_selection_message` and the two same-text tests in `u165_keys` and `u469_bar` to this scenario's wording, retaining every unaffected assertion. Policy: progress goes on #2226, not here.

Moves: D2, D5, D6 (`docs/design-system.md`); existing Tokens only.
