# UI: opening a Terminal with nothing selected but the Project root

Module: `apps/desktop/src/bubbles`. Ids: U524. Terms: Terminal, Bubble, Workstream, Project root (`GLOSSARY.md`). Work Issue: #2633 (extends #2226). Journey stage: Intervene (`.agents/data/journey.md`, “What must work”): the user opens a Terminal in one step.

**U524 a Terminal opens from the Project root.** Narrows U469's “Open and missing selection”; #2633 reconciles the empty case with U2571b and extends X12; changes no App seam command or Token. Given an open Project whose selection is the Project root and resolves to no Workstream, then:

- **One step when a Workstream exists.** Activating `+` (`New Terminal`) or `⌘T` makes one `terminal.open` for the Project's first Workstream in Rail order, shows and focuses the returned Bubble as U469 requires, and leaves the selection on the Project root. Asserted by `u524_plus_and_cmd_t_from_the_project_root_open_in_the_first_workstream`.
- **Every root-opened Terminal.** Every Terminal opened from the root remains in the Terminal bar in open order alongside every Project-owned Terminal. Opening another drops none; selecting a Workstream and returning to the root keeps them available. Root visibility and its existing reset on a non-root open follow `quick-terminal.md`, “Root visibility (U524)”. Asserted by `u524_every_root_opened_terminal_stays_in_the_bar_after_returning`.
- **Empty Project.** With no Workstream, either activation calls `terminal.open {workstream: null}` once, shows and focuses its Project-owned Bubble, and leaves the selection at the Project root. It calls neither `rail.createWorkstream` nor `rail.startDoor`. Asserted by `u524_an_empty_project_opens_and_focuses_a_project_terminal`.
- **Failure recovery.** A rejected open shows U469's failure text; retry succeeds, focuses its Bubble and clears the failure. Asserted by `u524_a_failed_empty_project_open_can_be_retried`.
- **Moves.** D2, D5 and D6 hold for the Bubble and failure at 1512×950 in dark. The design critic judges these Checks (AGENTS.md rule 10).

Tests: the named `u524_` tests in `apps/desktop/src/bubbles`, Vitest with the fake App for calls, focus and status, isolated headless Chromium on the U26 harness for geometry and computed styles. The obsolete no-call empty-Project and selection-message-lifetime clauses are retired by #2633; the named open and retry observers replace them. Retain unaffected U165 and U469 assertions. Policy: progress goes on #2633, not here.

Moves: D2, D5, D6 (`docs/design-system.md`); existing Tokens only.

## Root opening before its first listing

Work order: #4390. Scope (policy): `apps/desktop/src/bubbles/`; use the existing connected Project, fake App RPC and emulator seams. No contract, App seam command, Token, ownership or root-visibility reset change. Journey: Intervene; direct Agent access remains available (check 1). This specification adds acceptance only; the named `u4390_` tests are planned implementation obligations.

P6 gate (policy): does retaining root visibility move the Terminal from its chosen Home? No; the observer checks the first-Workstream `terminal.open` parameters and the returned Terminal's unchanged owner (checks 1 and 3).

**U4390 a stale Terminal list cannot forget a root opening before its first listing.** Given the Project root selected, a Workstream present, and an existing Project-owned Terminal, when the user activates New Terminal or `⌘T`, `terminal.open` acknowledges a new Workstream-owned id, and an unrelated `terminal.changed` refresh applies a successful `terminal.list` reply lacking that id before any list has included it, then:

- **First listing completes the opening.** When the opening's refresh subsequently lists the new id alongside the existing Terminal, each has exactly one tab, in list order; the new Bubble is shown and its emulator focused, and selection remains at the Project root. There is exactly one `terminal.open`, for the first Workstream in Rail order, and no `terminal.close`. Selecting that Workstream and returning to the root keeps both tabs available. Asserted by planned `u4390_root_open_survives_a_stale_list_before_first_listing`, parameterized over New Terminal and `⌘T`, in `apps/desktop/src/bubbles/` (checks 1–3).
- **Later removal still forgets it.** After that first listing, a confirmed successful Close of the new Terminal followed by a list without its id removes its tab and Bubble; the Project-owned Terminal remains, and selecting the Workstream and returning does not restore the closed tab. Asserted by planned `u4390_close_after_first_listing_removes_only_the_chosen_terminal` in `apps/desktop/src/bubbles/`, through the existing native-question fake and RPC seams (checks 2 and 3). This clause preserves cleanup; it grants no permanent exemption from later lists (policy).

Behavioral observer (policy): use `mountBubbles` and controlled fake App replies. Queue the unrelated refresh before the open acknowledgement, apply its stale reply after acknowledgement but before the opening's own refresh reply, then return the list including the new id. Await the Rail refresh completion and acknowledged emulator focus before the next user action; use no sleep or fixed scheduler-step count. Assert rendered controls, focus, selection and RPC calls, not private root-id storage. Run the related Vitest tests and retain the independent U524/U469 proofs (checks 1–3).

Rendered observer (policy): isolated headless U26 harness, dedicated session and fresh profile, dark mode at 1512×950. Observe the same stale-list sequence through first listing and Close on `bubbles`, then the sixteen-Terminal/60-character-name fixture of U469 with complete rejected-open failure text visible. D2, D5 and D6 hold, and no Check passing on the same `origin/main` baseline regresses (checks 4 and 5); the design critic judges looks, not UI assertions. The implementation runs `just capture U4390` and leaves PNGs/videos and Check readings under `artifacts/ux/U4390/` as the harness requires; never commit images or videos. No capture or native Mac observation is required for this specification-only PR.

### Existing checks for U4390

These references exist on `origin/main`; they constrain the implementation rather than claim the new acceptance already passes.

1. `scenarios/ui-terminal-open-root.md`, heading U524; `scenarios/quick-terminal.md`, heading “Root visibility (U524)”: owner resolution, root selection and visibility/reset policy.
2. `apps/desktop/src/bubbles/u469_tabs.test.tsx`, `u524_every_root_opened_terminal_stays_in_the_bar_after_returning` and `u524_a_project_terminal_is_available_after_reload`: retained root tabs and Project-owned Terminal cleanup.
3. `apps/desktop/src/bubbles/bubblesFixture.tsx`, `mountBubbles`; `apps/desktop/src/bubbles/Bubbles.tsx`, `Bubbles`; `apps/desktop/src/state/rail.ts`, `createRailState`: opening, refresh ordering, tab eligibility and the existing test seams.
4. `docs/design-system.md`, heading “The checks”; `apps/desktop/src/testing/checks.ts`, `runChecks`: D2, D5 and D6 definitions and observer.
5. `.agents/data/harness.md`, headings “Harness” and “Captures”; `scenarios/ui-terminal-tabs.md`, heading U469: isolated rendered observer, captures and dense fixture.
