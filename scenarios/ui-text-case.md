# UI: sentence case (U409)

Module: `apps/desktop` (the webview). Ids: U409, D15.

Webview only: no App command, no Daemon method, no `contracts/` file and no Token changes. Asked by the user's report #1115 ("we should do proper text casing upper/lower/capitalise", and on the Rail's add "no need for the word new"); asked which style, the user chose sentence case over Title Case. Replaces `docs/wireframes.md`'s old rule "right-aligned lower-case words = click targets" and narrows U391's label.

**U409 every word the App writes is in sentence case.** Given the App on the seeds `first-run`, `agents-10`, `tree-40`, `door-stopped`, `decisions` and `conflict` (U26) in both schemes at 1280 by 800 and 700 by 800, when a test reads every button, menu item, label, hint, tooltip, `aria-label`, `title` and status word, then:

- **Sentence case.** Each starts with a capital and no later word is capitalised, so `Take over`, `Send`, `Answer`, `No checkpoint yet`, `Full log`, `Clarifying: What is this Workstream for?`. A word after a colon follows the same rule as a first word.
- **Glossary terms.** A `GLOSSARY.md` term keeps its capital inside a phrase: `Workstream`, `Agent`, `Pad`, `Door`.
- **Exempt.** Section heads stay in spaced capitals (#1097). A name, id, path, code and any text the user or an Agent wrote stays as written: a Workstream named `workstream` shows lower case on its Rail row, and an Agent's Status label (`asks: keep v1 routes?`) is shown as the Agent wrote it. Terminal text and Agents' output are outside this scenario.
- **The add.** The Rail's add reads `+ Workstream` (U391) and the word `new` is gone from it; its `aria-label` is `Add Workstream`. The empty centre's button (U143) reads `New Workstream`, sentence case, since the add's `+` is what drops `new`.
- **Docs.** `docs/design-system.md` states the rule under "Text case" with Check D15, and `docs/wireframes.md` no longer says lower-case words are click targets. Every scenario that quotes a label is changed to the label's new case in the PR that changes the label in code, and a scenario text still quoting an old label fails `u409_no_scenario_quotes_a_lower_case_label`.
- **Checks.** D15 (new) passes on each seed, and no Check passing on `main` regresses (D1 to D14 are untouched; D6's hit areas hold). Moves: D6, D15.

Built in slices: the first PR is the rule, D15 in `docs/design-system.md`, `docs/wireframes.md` and the scenarios, with `Moves: none`; then one PR per module directory under `apps/desktop/src`, each changing its labels, its tests (found by their new names, none skipped or deleted) and the scenario quotes it owns, and saying which seeds D15 passes on after it. D15 gates only the directories already converted until the last PR makes it gate all.

Tests (`u409_` in `apps/desktop/src/app/u409_sentence_case.test.tsx`) against the fake App seam: `u409_every_label_on_the_seeds_is_sentence_case` (the D15 measure over each seed, with the exempt classes listed in the test), `u409_a_glossary_term_keeps_its_capital_in_a_phrase`, `u409_a_workstream_named_workstream_stays_lower_case`, `u409_the_rail_add_reads_plus_workstream`, `u409_section_heads_stay_spaced_capitals`, `u409_no_scenario_quotes_a_lower_case_label`. Policy, asserted by no test: the WKWebView look stays the user's `just app` observation.
