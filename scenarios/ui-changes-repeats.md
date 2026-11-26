# UI: the Changes view marks repeats at their lines, counts them in the item's row and shows the other place under the mark (U7685a–U7685h)

Module: `apps/desktop/src/changes/` (the scan, the mark, the excerpt, the row count, the states), the fake App's `agent.repeatScan` fixture. Ids: U7685a, U7685b, U7685c, U7685d, U7685e, U7685f, U7685g, U7685h. Work order: [#7685](https://github.com/roundup-app/roundup/issues/7685), blocked by #7684 (merged) and drawn beside the Flows lens (#7683, PR #7858). Owner, 2026-11-18: "I do sanity check for code repetitions and logic". The owner's three decisions hold as written: a repeat is marked in the gutter at the repeating lines ("Repeats owned.ts 12-30"), the item's row counts them ("2 repeats") and clicking the mark shows the other place under the marked line, read-only, with Enter opening it in the editor; the scan starts when the view opens, after the first paint, and never blocks a key (rule 7); every state is drawn on purpose. No Daemon method, Message or contract change: the App reads `agent.repeatScan` (C7684, `scenarios/repeat-scan.md`) and `agent.compareFile`, a mark is a personal aid, never a gate and never sent to the Agent. Reuse (rule 9): no new machinery. The mark is a line annotation and the gutter tint is the reader's own line stamp (U7677a), both of `@pierre/diffs` as the notes use them; the states are `createLate` and `failureOf`; the editor open is `createOpenAt` (U2539d). The PR's `Reuse:` section says so. Size: about 400 changed lines (App 200, tests 200).

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** The quoted words below are asserted through `copy.ts`, never layout or looks (rule 10). A **repeat** is one `ScanHit` of `agent.repeatScan`: the changed lines `path` `start`-`end` of the working copy and the `other` place that holds them again (GLOSSARY: Scan hit). The App names no `Repeat` type for the result, so #7704 can generalise it into the mark with a source.

**Decided here, from the Daemon as built.** `agent.repeatScan` takes the Agent's `id` and always compares the working tree with its merge base (`crates/agents/src/worktree_wiring.rs`, `repeat_scan`; it reads no `to`), and its lines are working-copy lines. So the App asks only on the **Tree** target, whose diff ends on the working copy: the Branch target ends on HEAD's commit. Amended by U7955a: the Changes target also asks, sending the open group as `group`, and the Daemon scans the group's checkout, so an Agent with no Worktree is scanned (C7684e still refuses an Agent actor). The other place may sit in a file the diff does not list; `agent.compareFile` reads any regular file of the Worktree and answers `status: null` for one that did not change (`crates/agents/src/worktree/comparison.rs`, `compare_file`), so the excerpt needs no new read.

**Fixture.** The repeat fixture is the fake App's `agent.repeatScan` (`apps/desktop/src/testing/fakeApp.ts`, `repeatScanFixture`) with each test's handler over it: a Tree-target Agent whose `agent.repeatScan` answers a hit `pkg/src/new.ts` 6-22 repeating `pkg/src/owned.ts` 12-30, a file the listing does not name. The flow tests answer three hits over the Flows fixture of U7683 (`apps/a/src/run.ts`, `apps/a/src/load.ts`, `crates/b/src/lib.rs`).

**U7685a a repeat is marked at its lines and names the other place.** Given the fixture on the Tree target and a read of `pkg/src/new.ts`, then:
- **Gutter.** Each line 6 to 22 of the new side carries the repeat stamp, the reader's own line attribute that the style keys on (U7677a), and no other line does. Asserted in `u7685a_a_repeat_is_marked_at_its_lines_and_names_the_other_place`.
- **Label.** Under line 22 (the last repeating line), a button reads "Repeats pkg/src/owned.ts 12-30": the other path and its lines, as the owner wrote it. A section of a flow (U7683d) marks and labels only the hits whose lines its function holds. Asserted in `u7685a_a_repeat_is_marked_at_its_lines_and_names_the_other_place` and, for the section, `u7685c_a_flow_counts_the_repeats_of_its_sections_and_a_hunk_counts_under_each_flow_that_holds_it`.

**U7685b clicking the mark shows the other place, and Enter opens it.** Given the marked file, then:
- **Excerpt.** Clicking the label shows under it, read-only, the other place: its path and lines and the text of lines 12 to 30 of `pkg/src/owned.ts`, read with `agent.compareFile` of that path on the Tree target when the mark opens; clicking again hides it. Asserted in `u7685b_clicking_the_mark_shows_the_other_place_and_enter_opens_it_in_the_editor`.
- **Failed.** A failed read says so under the label with its cause, and the next opening reads again. Asserted in `u7685b_a_failed_read_of_the_other_place_says_its_cause_and_the_next_click_reads_again`.
- **Not text.** A place that is not text says "No text". Asserted in `u7685b_a_place_that_is_not_text_says_there_is_no_text_to_show`.
- **Editor.** Enter on the shown place's path (a button, so the view's own Enter on a line of the diff does not fire) opens `pkg/src/owned.ts` at line 12 in the editor, though the listing does not hold the file: the editor's open (U2539d) takes a path the listing lacks, and still opens none for a deleted file the listing holds. Asserted in the same test and, for the deleted file, `u2539d_a_deleted_file_opens_nothing`.

**U7685c the row counts its repeats.** Given the fixture's hits, then:
- **Count.** A module's row says "2 repeats" (a singular "1 repeat") beside its counts, and its accessible name holds the words; a file counts under the module that holds it, from the listing as the lens makes it, never as a find narrows it (U7679d). Asserted in `u7685c_the_row_counts_its_repeats_and_none_says_nothing`.
- **Flows.** A flow's row counts a repeat when one of its sections holds a line of the hit (the section's own rule of U7683d), so a repeat counts under each flow that holds its hunk, once for each; Unplaced and Not traced count by the same rule, and a noise row counts nothing. Asserted in `u7685c_a_flow_counts_the_repeats_of_its_sections_and_a_hunk_counts_under_each_flow_that_holds_it`.
- **None.** An item with no repeat shows no words, never "0 repeats". Asserted in `u7685c_the_row_counts_its_repeats_and_none_says_nothing`.

**U7685d the scan starts after the first paint and never blocks a key.** Given the fixture, then:
- **When.** With the listing held, no `agent.repeatScan` is asked; once the list has drawn and the browser has painted a frame, one is asked, once for the comparison, never at cold start or on the Overview alone. Asserted in `u7685d_the_scan_is_asked_after_the_first_paint_on_tree_only_and_never_delays_a_key`.
- **Which.** The Tree target and the Changes target (with `group`, U7955a) ask; the Branch target asks nothing. An Agent with no Worktree asks on the Changes target and says nothing on the others. Asserted in the same test and in `u7955a_changes_reads_send_the_open_group_and_flows_traces`.
- **Keys.** With a scan that never answers, J, K, L and the diff's keys act as without it. Asserted in the same test.

**U7685e every state is drawn on purpose.** My reading, kept: the states are scanning, done, none and failed. Given the fixture, then:
- **Scanning.** A scan pending past 150 ms (`createLate`) shows "Checking for repeats" in the header, none before. Asserted in `u7685e_scanning_partial_failed_and_not_asked_each_say_so_and_done_with_none_says_nothing`.
- **Done.** The marks and counts of U7685a and U7685c, and no words. Asserted in `u7685a_a_repeat_is_marked_at_its_lines_and_names_the_other_place`.
- **None.** A scan that finds nothing leaves no mark and no words, never "0 repeats". Asserted in `u7685e_scanning_partial_failed_and_not_asked_each_say_so_and_done_with_none_says_nothing`.
- **Failed.** A request that fails shows "Couldn't check repeats", its cause and Retry, which asks again. Asserted in `u7685e_a_failed_scan_shows_its_cause_and_retry_asks_again_and_a_partial_one_keeps_its_marks`.
- **Partial.** Decided here, since C7684d answers `complete: false` at its bound: the marks found show, with the quiet line "Repeats partly checked". Asserted in the same test.
- **Not asked.** The Changes and Branch targets of an Agent with a Worktree say "Repeats need Tree", and no mark shows. Asserted in `u7685e_scanning_partial_failed_and_not_asked_each_say_so_and_done_with_none_says_nothing`.

**U7685f a change to the diff scans again.** My reading, kept: a turn that wrote a file, and a listing that read again, each ask once more. Given the fixture on the Tree target, then:
- **Turn.** When an Agent's turn ends after a file-writing call (U7186a), the scan is asked again once, however many writes the turn made, and a turn with no write asks none. Asserted in `u7685f_a_changed_diff_scans_again_once_and_keeps_the_marks_meanwhile`.
- **Listing.** A Fetch that moves the merge base (U7693c) lists again and scans again. Asserted in the same test.
- **Meanwhile.** The marks of the last answer stay until the new one lands, and a request asked while one runs waits for it, so the Daemon runs one scan for the view at a time. Asserted in the same test.

**U7685g a mark is read-only.** My reading, kept: a repeat is information, and the user turns a marked line into a note as any line becomes one (U7676a). Given the marked file, then a note saved on a marked line keeps its file, side and line, and the marks stay; a repeat is in no Message, no note and no Landing check, and the mark has no control that edits, sends or removes. Asserted in `u7685g_a_mark_is_read_only_and_its_line_takes_a_note_as_any_line_does`.

**U7685h the rendered marks at 1512 by 950.** Given the U26 harness, dark App, on the 14-module fixture of U7679f with repeats in several files and a fake `agent.repeatScan`, then these draw: the marks at rest on the open module, the other place shown under a mark, the scan pending and the scan failed. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7685h`; evidence under `artifacts/ux/U7685h/`, uncommitted, one browser session for each state (#7924). Policy; the design critic judges layout and looks, never a Vitest test (rule 10). Rule 7 stands: the scan is asked after the first paint and never at cold start; this specification makes no measured performance claim.

**Amended.** None. Kept: notes, Viewed, the lenses and their keys as built; U7683c's "a flow's row counts its gaps (#7688) and repeats (#7685) once they build" is what U7685c builds for repeats.

Not wanted: a model, tokens or cost (P14); a refactor suggestion or an auto-fix; a Landing gate; a new border; a new Daemon method; a second diff column (`scenarios/ui-changes-redesign.md`); Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/repeat-scan.md`, C7684a to C7684e: the result, its bounds and its failures this draws.
2. `scenarios/ui-changes-flows.md`, U7683c and U7683d: the items and sections a repeat counts under.
3. `scenarios/ui-changes-note-design.md`, U7677a: the line stamp and the note's line.
4. `scenarios/ui-changes-notes.md`, U7676a: a note from any line.
5. `scenarios/ui-changes-remote-moved.md`, U7693c: the Fetch that lists again.
6. `apps/desktop/src/changes/diffDraw.ts`: `lineAnnotations` and `drawDiff`'s `stamp`.
7. `apps/desktop/src/changes/editor.ts`: `createOpenAt`.
8. `apps/desktop/src/changes/callPaths.ts`: `createCallPaths`, the ask, drop and turn-end pattern the scan follows.
9. `apps/desktop/src/testing/fakeApp.ts`: `repeatScanFixture`.
