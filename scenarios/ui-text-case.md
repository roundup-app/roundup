# UI: sentence case (U416)

Module: `apps/desktop` (the webview). Ids: U416, D15.

Webview only: no App command, no Daemon method, no `contracts/` file and no Token changes. Asked by the user's report #1115 ("we should do proper text casing upper/lower/capitalise", and on the Rail's add "no need for the word new"); asked which style, the user chose sentence case over Title Case. Replaces `docs/wireframes.md`'s old rule "right-aligned lower-case words = click targets" and narrows U391's label.

**U416 every word the App writes is in sentence case.** Given the App on the seeds `first-run`, `agents-10`, `tree-40`, `door-stopped`, `decisions` and `conflict` (U26) in both schemes at 1280 by 800, when a test reads every button, menu item, label, hint, tooltip, `aria-label`, `title` and status word, then:

- **Sentence case.** Each starts with a capital and no later word is capitalised, so `Take control`, `Send`, `Answer`, `No checkpoint yet`, `Full log`, `Clarifying: What is this Workstream for?`. A word after a colon follows the same rule as a first word.
- **User labels.** A `GLOSSARY.md` term without an explicit user-label mapping keeps its capital inside a phrase: `Workstream`, `Agent`, `Pad`. U471 maps Door, Shelf and Handoff to supervisor, work items and summary.
- **Exempt.** Section heads stay in spaced capitals (#1097). A name, id, path, code and any text the user or an Agent wrote stays as written: a Workstream named `workstream` shows lower case on its Rail row, and an Agent's Status label (`asks: keep v1 routes?`) is shown as the Agent wrote it. Terminal text and Agents' output are outside this scenario.
- **The add.** The Rail's add reads `+ Workstream` (U391) and the word `new` is gone from it; its `aria-label` is `Add Workstream`. The empty centre's button (U143) reads `New Workstream`, sentence case, since the add's `+` is what drops `new`. Slicing: quotes of `+ Workstream` in other scenarios change in this PR, while `scenarios/workstream.md` keeps `new Workstream` and `no Workstream yet` until the PR that changes that label in code; the difference is planned, not a mismatch.
- **Docs.** `docs/design-system.md` states the rule under "Text case" with Check D15, and `docs/wireframes.md` no longer says lower-case words are click targets. Every scenario that quotes a label is changed to the label's new case in the PR that changes the label in code, and a scenario text still quoting an old label fails `u471_previous_copy_assertions_are_preserved_no_scenario_quotes_a_lower_case_label`.
- **Checks.** D15 (new) passes on each seed, and no Check passing on `main` regresses (D1 to D14 are untouched; D6's hit areas hold). Moves: D6, D15.

Built in slices: the first PR is the rule, D15 in `docs/design-system.md`, `docs/wireframes.md` and the scenarios, with `Moves: none`; then one PR per module directory under `apps/desktop/src`, each changing its labels, its tests (found by their new names, none skipped or deleted) and the scenario quotes it owns, and saying which seeds D15 passes on after it. Before U471, D15 gated only the directories already converted until the last PR makes it gate all.

Tests against the fake App seam: the Rail's authored Workstream name and add retain their assertions in `apps/desktop/src/app/u471_copy_preservation.test.tsx`; the other migrated observers below retain their rendered, authored-text and interaction assertions. Their names begin `u471_previous_copy_assertions_are_preserved_`. Policy, asserted by no test: the WKWebView look stays the user's `just app` observation.

Header observer: `apps/desktop/src/header/u471_copy_preservation.test.tsx` renders the strip, tab menu, rename field and close dialog. `u471_previous_copy_assertions_are_preserved_header_labels_use_sentence_case_and_preserve_project_names`, `u471_previous_copy_assertions_are_preserved_header_menu_uses_sentence_case`, `u471_previous_copy_assertions_are_preserved_header_rename_label_keeps_the_glossary_capital` and `u471_previous_copy_assertions_are_preserved_header_close_dialog_uses_sentence_case_and_preserves_agent_names` assert their labels and the unchanged names and paths. Daemon exit text supplied by the App is converted with the App directory.

Orders observer: `apps/desktop/src/orders/u471_copy_preservation.test.tsx`; `u471_previous_copy_assertions_are_preserved_order_labels_use_sentence_case_and_preserve_agent_text` asserts the order line, Drawer, done mark, editor and prompt labels while preserving the Agent name, ask, Done condition and Spawn prompt. Before U471, D15 gated the orders directory in this slice.

Bubbles observer: `apps/desktop/src/bubbles/u471_copy_preservation.test.tsx`; `u471_previous_copy_assertions_are_preserved_bubble_controls_use_sentence_case`, `u471_previous_copy_assertions_are_preserved_bubble_status_uses_sentence_case_*` and `u471_previous_copy_assertions_are_preserved_bubble_signal_exit_uses_sentence_case` assert the controls and running, code and signal exit labels. `u471_previous_copy_assertions_are_preserved_bubble_program_titles_stay_as_written` asserts the exempt program title. Before U471, D15 gated the bubbles directory in this slice.

Todos observer: `apps/desktop/src/todos/u471_copy_preservation.test.tsx`; `u471_previous_copy_assertions_are_preserved_todo_` tests assert sentence case for creation, empty hints, Drawer controls, editor labels and row status, preserving authored titles and bodies. `u471_previous_copy_assertions_are_preserved_todo_drawer_omits_move_and_home` preserves U461’s absence of those Drawer actions. Before U471, D15 gated Todos-owned labels in this slice; shared Glyph and Drawer frame labels belong to their own directories.

Ink observer: `apps/desktop/src/ink/u471_copy_preservation.test.tsx`; `u471_previous_copy_assertions_are_preserved_glyph_names_use_sentence_case_for_*` and `u471_previous_copy_assertions_are_preserved_owner_marks_use_sentence_case_for_*` assert the shared marks’ spoken labels. `u471_previous_copy_assertions_are_preserved_decorative_marks_have_no_spoken_label` keeps decorative marks silent. Before U471, D15 gated Ink-owned mark labels in this slice; exit prose is composed by the Rail and App and belongs to their slices.

Decisions observer: `apps/desktop/src/decisions/u471_copy_preservation.test.tsx`; `u471_previous_copy_assertions_are_preserved_permission_controls_use_sentence_case`, `u471_previous_copy_assertions_are_preserved_question_controls_use_sentence_case` and `u471_previous_copy_assertions_are_preserved_terminal_fallback_uses_sentence_case_*` assert permission buttons, question controls, note hints and Terminal fallback labels. `u471_previous_copy_assertions_are_preserved_agent_question_text_stays_as_written` preserves Agent names, questions, answer labels, descriptions and previews. Permission answer values remain `allow` and `deny` on the wire. Before U471, D15 gated Decisions-owned labels in this slice; the Thread's own composer labels belong to its later slice.

Rail menu observer: `apps/desktop/src/rail/menu/u471_copy_preservation.test.tsx`; `u471_previous_copy_assertions_are_preserved_rail_model_actions_use_sentence_case` and `u471_previous_copy_assertions_are_preserved_rail_removal_summary_keeps_glossary_capitals` assert Model actions and removal summaries, preserving Agent and Workstream names. Before U471, D15 gated Rail-menu-owned labels; shared Model selectors belong to their own slice.

Digest observer: retired by U467 with the digest card; the catalogue test covers the labels of the surfaces left.

Models observer, retired by U377 (it deletes `apps/desktop/src/models/` and this test): `u471_previous_copy_assertions_are_preserved_model_controls_use_sentence_case` asserts `Model for door`, `Effort for door` and `Default`. `u471_previous_copy_assertions_are_preserved_model_choices_and_role_ids_stay_as_written` preserves role ids and Adapter-provided Model and Effort labels. Shared selectors prefix their subject with `Model for` or `Effort for`, preserving authored Agent names and role ids. Before U471, D15 gated Models-owned labels in this slice; the Rail-supplied add subject belongs to its remaining slice.

`u471_previous_copy_assertions_are_preserved_default_model_in_a_confirmation_stays_sentence_case` in the Rail menu observer asserts `Change lowercase to default?`: the option starts with `Default`, while its word inside a confirmation stays prose.

Thread observer: retired by U467 with the Thread; the clear prompt (U350) is now the Rail row's, and the catalogue test covers its copy.


**U471 one catalogue separates code terms from user labels.** Given every App-authored string under `apps/desktop/src`, when the catalogue migration is complete, then:

- **Language policy (policy).** `GLOSSARY.md` distinguishes code terms, used by identifiers and RPC methods, from user labels, used by the App. A user label describes the action or content and may differ from its code term. AGENTS.md's first paragraph states that distinction. Existing code names and wire values remain unchanged. The glossary records the mappings below; other domain terms keep their current user spelling until an explicit user-label mapping replaces it. The distinction does not relax rule 6 for public code names.
- **Catalogue.** `u471_every_app_authored_string_comes_from_the_catalogue` asserts that all App-authored visible text and accessible names, including errors, statuses, hints, tooltips, placeholders, section heads and generated prose, come from `apps/desktop/src/copy.ts`. Components and helpers consume entries or parameterised formatters; authored names, ids, paths, code, Adapter labels, Agent output and Terminal content pass through unchanged. Wire enums, CSS classes and test expectations are not UI copy. The test scans production sources, reports each uncatalogued literal with file and line, and covers JSX text, UI attributes and strings passed through helpers, not only imports.
- **Labels.** `u471_action_labels_describe_the_existing_action` renders and activates every old/new pair below, asserting the new visible and accessible names and the same command, arguments and state transitions. All production occurrences, accessible-name queries and affected scenario quotes change together. No control, status, failure text or accessible name disappears during extraction.

| Existing label | User label | Existing action retained |
|---|---|---|
| Start Door | Start supervisor | Start the selected Workstream's Door |
| Retry Door | Retry supervisor | Retry its failed start |
| Clear without Handoff | Clear without a summary | Existing failure fallback, without writing a Handoff |
| Clear (clear prompt submit only) | Clear and keep a summary | Normal Clear, writing the Handoff first |

Centre exception (U143, policy): the Workstream Door centre uses `Start` / `Retry`; the table's `Start supervisor` / `Retry supervisor` remain the Rail labels. This is a surface-specific action-label exception, not a change to code terms or the glossary mapping. The centre's state copy follows U143's four meanings and one-supervisor limit. Once this amendment is on main, #2679 updates only the centre queries in `u471_action_labels_describe_the_existing_action_retry_supervisor` (`apps/desktop/src/copy.test.ts`) to role and catalogue name, preserving its two `rail.startDoor {id: "w"}` calls, original failure message, selection and no-create assertions. Exact centre-label assertions are retired as word proofs; Rail-label and catalogue provenance coverage remain.

The glossary maps Door to supervisor, Shelf to work items and Handoff to summary in App-authored prose as well as these controls. Clear elsewhere remains Clear; the summary label must never describe the fallback. User-authored occurrences of these words remain untouched.

**U472 catalogue copy preserves the first journey.** Given U471's labels on `first-run`, `agents-10`, `tree-40`, `door-stopped`, `decisions` and `conflict`, in light at 1280×800 and `tree-40` also in dark, when the isolated headless observer drives Enter, Understand, Intervene and Review in light from `.agents/data/journey.md`, then `u472_copy_preserves_journey_actions_and_failure_text` asserts start/retry, take/give control, show/hide work items, normal clear and injected failed clear. Failure text remains visible on the densest seed; the reason survives a rejected clear; stopping and clearing preserve the existing Workstream/file guarantees. The design critic judges those Checks in dark only (AGENTS.md rule 10, U3725): D2 (`docs/design-system.md:126`), D5 (`:129`), D6 (`:130`) and D15 (`:139`) hold, and no previously passing Check regresses; the behaviour test above is the kept proof. Moves: D6, D15. Tokens and layout behavior stay governed by the existing Checks. This observer proves webview copy and its existing seam actions, not a new native or real-Claude claim.

## Catalogue migration ownership (policy)

U471 replaces U416's per-directory slicing and code-term capitalisation requirement once implemented; U416's sentence case, authored-text exemptions, Rail add and interaction coverage remain. The implementation changes `docs/design-system.md`'s D15 and Text case rule, AGENTS.md, GLOSSARY.md and every catalogue caller together. Its PR includes the old/new label table and an inventory showing every former case assertion's replacement test. Cross-directory extraction is required by #1611's single-catalogue acceptance; behavioral or wire-contract expansion is outside this work.

The dependent implementation Issue is blocked on this specification Issue through native GitHub dependencies. Implementation records library research under #1598's direction before choosing a catalogue representation: a typed static catalogue is the default; if a maintained i18n library is selected, `copy.ts` remains the sole App-copy entry point. This specification does not add translation, locale selection or a custom translation engine. Progress and engineering decisions belong on that Issue.

Implementation observer commands (one row per failure):

| Command | Failure | Exit |
|---|---|---|
| `pnpm --filter desktop exec vitest run src/copy.test.ts` | Any U471 catalogue, coverage, case or label assertion fails | 1 |
| `pnpm --filter desktop exec vitest run src/app/u472_copy_journey.test.ts` | Any journey action, or preservation assertion fails | 1 |
| `python3 -c "from pathlib import Path; raise SystemExit(int(len(list(Path('apps/desktop/src').rglob('u416_sentence_case*'))) > 1))"` | More than one former case observer remains | 1 |
| `! rg -n -e '"Start Door"' -e '"Clear without Handoff"' apps/desktop/src` | A replaced label remains | 1 |
| `loop/rules.sh vocab` | A public code name violates rule 6 | 1 |

These are future implementation observers, not claims that tests exist on main. Specification acceptance (policy): these headings define catalogue ownership, exact mappings, exemptions, regression observers and Checks; a checked dependent implementation Issue owns their delivery. The specification PR closes #1611 and leaves that implementation Issue open.
