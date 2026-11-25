# UI: the Changes view reads back these changes (R), the Overview carries the readback with its states, and each gap shows at its line (U7688a–U7688h)

Module: `apps/desktop/src/changes/` (the Overview's readback, its states, the gap lines, the diagram), the fake App and its fixtures. Ids: U7688a, U7688b, U7688c, U7688d, U7688e, U7688f, U7688g, U7688h. Work order: [#7688](https://github.com/roundup-app/roundup/issues/7688), blocked by #7687 (merged, `scenarios/readback.md`, RB1 to RB9) and drawn beside the Flows lens (#7683) and repeats (#7685). Owner, 2026-11-18: "it shouldn't be the same agent it should be a readback"; "I care about flows/paths/modules and mental models, I do sanity check for code repetitions and logic". The owner's five decisions hold as written: the Overview carries the readback and a module's item opens with its own account; only the user starts it (P9); every state is drawn; a gap shows at its line and counts in its item's row; the diagram has a text equivalent and fits the pane. No Daemon method, Message or contract change: the App calls `agent.readbackStart` and reads `agent.readback` (RB2, RB5), both built by #7687. A readback is a personal aid, never a gate; its text is never sent to the Agent, no Message or note carries it, and the App has no control for its Model or Effort (U377) and no token, price or usage figure (P14).

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** The quoted words below are asserted through `copy.ts`, never layout or looks (rule 10). A **readback** is the Daemon's `Readback` of one `(Agent, to)` (GLOSSARY: Readback); a **gap** is its `Gap`: the Agent's words `said`, a `quote` of the diff's line, and that line on the new side of `path` (RB4).

**Decided here, from the Daemon as built.** `agent.readbackStart` and `agent.readback` take the Agent's `id` and `to`, and a shared checkout fails `no_worktree` (RB2), as the Daemon's other Worktree methods do. So the App asks only on the **Tree** and **Branch** targets, and the Changes target says "A readback needs the Tree or Branch comparison" and offers no start. The Daemon emits no event when a run ends or a result goes stale, so the App reads `agent.readback` when the Overview opens (a kept result shows with no start), every second while the state is `reading`, and once more when a turn that wrote ends or a Fetch lists again (U7693c). The App asks `agent.readbackStart` from the user's action only.

**Fixture.** The readback fixture is the fake App's `agent.readback` and `agent.readbackStart` (`apps/desktop/src/testing/fakeApp.ts`) with each test's handler over them: a Tree-target Agent over the 14-module listing whose account holds an overview of two sentences, a diagram `Overview -> Store` under "Before" and "After", one module account, and a gap `{path: "pkg/src/new.ts", said: "added a retry", quote: "const once = call()", line: 6}`.

**U7688a only the user's action starts a readback.** Given the fixture on the Tree target, then:
- **Not read.** The Overview shows the quiet line "A model that never saw the conversation reads only the diff and says what it changes." and the button "Read back these changes". Opening the view, a turn that wrote, a Fetch and a second of waiting call `agent.readbackStart` zero times. Asserted in `u7688a_only_r_and_the_button_start_a_readback_and_nothing_else_does`.
- **Start.** The button and R (with no field or editor holding the key) each call `agent.readbackStart` once with the Agent's `id` and `to`; R while it reads does nothing, so the Daemon is asked once. The ? list names R. Asserted in the same test.
- **Not asked.** On the Changes target the quiet line is replaced by "A readback needs the Tree or Branch comparison", no button shows and R calls nothing. Asserted in `u7688a_the_changes_target_has_no_readback`.

**U7688b every state is drawn on purpose.** Given the fixture, then:
- **Reading.** From the start the Overview says "Reading back…", and J, K and the diff's keys act as without it: the view stays usable. A kept result (`read`) shows at once on open with no start. Asserted in `u7688b_reading_keeps_the_view_usable_and_a_kept_result_shows_on_open`.
- **Read.** When the Daemon answers `read`, the Overview shows the account (U7688c). Asserted in the same test.
- **Stale.** My reading, kept: when a turn that wrote ends and the Daemon answers `stale`, the old text stays, dimmed, with "Changed since the readback" and the button "Read back again", which starts a new run. Asserted in `u7688b_a_write_makes_the_read_stale_and_read_back_again_runs_again`.
- **Failed.** The cause is in words with Retry, which starts a new run; a start the Daemon refuses fails the same way with its cause. Asserted in `u7688b_a_failed_readback_says_its_cause_and_retry_runs_again`.

**U7688c a read draws the account.** Given a `read` result, then:
- **Sentences.** The two or three sentences show under "Read back from the diff", above the lens's list of modules, which stays (U7679c). Asserted in `u7688c_a_read_shows_the_sentences_credited_and_the_diagram_in_words`.
- **Diagram.** The parts and calls draw as a figure, before and after where the shape changed, and its text equivalent names them in words ("Overview calls Store"), under "Before" and "After" when the text has them. A diagram text with no call in it shows as the text it is. My reading, kept: the figure is drawn only from lines of the form `A -> B` (`->`, `=>` or `→`, chained or not), since `Account.diagram` is free text (RB3); every other line stays in the words. Asserted in the same test and `u7688c_a_diagram_with_no_call_shows_its_text`.
- **Narrow.** My reading, kept: below 480 px of pane the figure gives way to its words, a row for each call, so the pane never scrolls sideways. Policy; the design critic judges it at 388 px (U7688h).
- **Gaps failed.** A comparison that failed (`gaps: {failed}`) leaves the account read and adds "Couldn't compare with what <Agent> said" with the cause. Asserted in `u7688c_a_failed_comparison_keeps_the_account_and_says_so`.

**U7688d a module opens with its own account.** Given a `read` result in the Modules lens, then a module the readback has an account of opens with its sentences above its diff, and one it has none of says "The readback has no separate account of this module; see Overview." A flow, a noise file and a stale or unread state show neither (a flow's account is #7689). Asserted in `u7688d_a_module_opens_with_its_account_else_points_to_the_overview`.

**U7688e a gap shows at its line.** Given the fixture's gap and the Tree target, then:
- **Line.** Under line 6 of `pkg/src/new.ts` the diff shows "<Agent> said: added a retry The diff: const once = call()"; a section of a flow shows only the gaps whose line it holds (U7683d). Asserted in `u7688e_a_gap_shows_under_its_line_counts_in_its_row_and_lists_in_the_overview`.
- **Row.** The item's row says "1 gap" ("2 gaps"), and its accessible name holds the words; a flow's row counts the gaps of its sections by the repeat rule of U7685c, once for each flow that holds the line; an item with none says nothing. Asserted in the same test and, for the flow, `u7688e_a_flow_row_counts_its_gaps`.
- **List.** The Overview lists each gap with a link that opens its file at its line. A gap whose file the listing no longer holds stays in the list without a link; it is never dropped. Asserted in the same test and `u7688e_a_gap_whose_file_is_gone_stays_listed_without_a_link`.
- **Stale.** My reading, kept: a stale readback keeps its gaps in the dimmed list and draws none under a line or in a row, since its line numbers describe a diff that changed. Asserted in `u7688b_a_write_makes_the_read_stale_and_read_back_again_runs_again`.

**U7688f a readback is a personal aid.** The view sends no Message and saves no note or Pad from a readback, edits none of its text, and gates no Landing or Viewed mark on it. Policy: nothing here carries the readback's words anywhere but the screen.

**U7688g reuse.** The diagram's layout is `elkjs`, which Pads already load for a statechart (#7578): one layout library for both, loaded only when a diagram draws (rule 7). The PR's `Reuse:` section weighs it against `dagre` and the prototype's own layout. Policy.

**U7688h the rendered readback at 1512 by 950 and at 388 px.** Given the U26 harness, dark App, on the 14-module fixture with the fake `agent.readback`, then these draw: not read, reading, read (with the diagram and a gap), stale and failed, each in its own browser session (#7924). D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7688h`; evidence under `artifacts/ux/U7688h/`, uncommitted. Policy; the design critic judges layout and looks, never a Vitest test (rule 10). Rule 7 stands: the diagram's layout loads lazily; this specification makes no measured performance claim.

**Amended.** U7679c ("Pane": the Overview pane holds the readback block above the lens's list, the quiet line and button before one, the account after) and U7679e ("The ? list": gains R). U7683c's "a flow's row counts its gaps (#7688)" is what U7688e builds for gaps. Kept: notes, Viewed, the repeats and the lenses as built.

Not wanted: an automatic start; a Model or Effort control (U377); a token, price or usage figure, even in a failure cause (P14); editing the readback's text; Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/readback.md`, RB2 to RB5: the methods, the result's shape and its states this draws.
2. `scenarios/ui-changes-lenses.md`, U7679c: the Overview pane this adds to.
3. `scenarios/ui-changes-repeats.md`, U7685c: the row count and the section rule a gap count follows.
4. `apps/desktop/src/changes/diffDraw.ts`: `lineAnnotations`.
5. `apps/desktop/src/changes/owned.ts`: `watchTurns`.
6. `apps/desktop/src/pads/visualKinds.ts`: the `elkjs` layout of #7578.
7. `apps/desktop/src/testing/fakeApp.ts`: the default `agent.readback` answers.
