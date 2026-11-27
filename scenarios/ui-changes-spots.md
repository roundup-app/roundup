# UI: the Changes view marks the spots tools post at their lines, each tagged with its source (U7704a–U7704h)

Module: `apps/desktop/src/changes/` (the read, the mark, the row counts, the end group, the states), the fake App's `agent.spots` fixture. Ids: U7704a, U7704b, U7704c, U7704d, U7704e, U7704f, U7704g, U7704h. Work order: [#7704](https://github.com/roundup-app/roundup/issues/7704); the Daemon's half is `scenarios/spots.md` (C7704). Owner, 2026-11-18: other tools, such as a linter or a test run, place marks on lines, and the view shows each mark with the tool it came from. The marks of #7685 are the same thing with the repeat scan as their source (`scenarios/ui-changes-repeats.md`).

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** The quoted words below are asserted through `copy.ts`, never layout or looks (rule 10). A **spot** is one `Spot` of `agent.spots` or of `agent.repeatScan`: lines `path` `start`-`end` of the working copy, a `source`, and a `message` (a tool's) or an `other` place (a repeat's). Its source names the repeat scan or a tool by name, such as oxlint.

**Decided here.** My reading, kept: the view reads `agent.spots` on the targets the repeat scan reads, since a spot's lines are working-copy lines: the Tree target, and the Changes target with the open `group` (U7853a, U7955a); the Branch target asks nothing. A spot is read-only information: it never gates Landing, and it is in no note and no Message. A repeat whose lines a move holds gives way to the move (U7696e); a tool's spot never does. "A line the diff does not show" is a line of a file that draws no lines, or past the last line of the new side; a fold hides every other line and the diff opens it (U7692b).

**Fixture.** The fake App's `agent.spots` (`apps/desktop/src/testing/fakeApp.ts`, `spotsFixture`) answers by Agent id: `spots-tool` holds oxlint's "unused variable" on `new.ts` 3-5 and an outdated "fails here" of `tests` on 7-8, `spots-failure` fails, any other id holds none; a test's handler answers the rest.

**U7704a a tool's spot is marked at its lines and names its source.** Given a Tree-target file read of `pkg/src/new.ts` and the spots of the fixture, then:
- **Gutter.** Each new-side line 3 to 5 and 7 to 8 carries the spot stamp, the reader's own line attribute (U7677a), and no other line does.
- **Mark.** Under line 5 a note reads the source "oxlint" and "unused variable"; under line 8 it reads "tests", "fails here" and "Outdated"; the first says no "Outdated".
- **Read-only.** The marks hold no button (U7704g).
Asserted in `u7704a_a_tools_spot_is_marked_at_its_lines_and_names_its_source`.

**U7704b the row counts each source.** Given the repeat of U7685 and the spots of U7704a on one module, then its row says "1 repeat" and "1 from oxlint" and "1 from tests", and its accessible name holds the words; a module with no spot says none of them, never "0 from oxlint". Asserted in `u7704b_the_row_counts_each_source_and_none_says_nothing`.

**U7704c the read takes the open group.** Given an Agent with no Worktree on the Changes target, then `agent.spots` is asked with that Agent's `id` and the open `group`, and again with the other group once the user picks it; the Branch target asks none. Asserted in `u7704c_changes_reads_send_the_open_group_and_branch_asks_none`.

**U7704d every turn end reads again.** Given the spots of U7704a, when an Agent's turn ends, with a file written or not, then `agent.spots` is asked once more; the marks of the last answer stay until the new one lands, and a tool's post that landed meanwhile shows. Asserted in `u7704d_a_turn_end_reads_again_and_keeps_the_marks_meanwhile`.

**U7704e a spot no line shows is listed.** Given a spot on `pkg/src/new.ts` that ends past its last line and one on a file the listing lacks, then the file's diff ends with a group "Other spots" that holds the first (its source, lines and message), and the Overview holds the second in the same group, after the modules. Asserted in `u7704e_a_spot_no_line_shows_is_listed_under_other_spots`.

**U7704f the read's states are drawn on purpose.** Given a read that fails, then the view says "Couldn't read spots" with its cause and Retry, which asks again; a read pending or finding none says nothing. Asserted in `u7704f_a_failed_read_says_its_cause_and_retry_asks_again`.

**U7704g a spot is read-only.** The marks of U7704a hold no control that edits, sends or removes; a note saved on a spotted line keeps its file, side and line, as U7685g says of a repeat's. Asserted in `u7704a_a_tools_spot_is_marked_at_its_lines_and_names_its_source`, and for the note by `u7685g_a_mark_is_read_only_and_its_line_takes_a_note_as_any_line_does`, whose marks are Spots.

**U7704h the rendered marks at 1512 by 950.** Given the U26 harness, dark App, on the 14-module fixture of U7679f with spots from two tools and a repeat, then these draw: the marks at rest on the open module, an Outdated spot, the group of unshown lines and the failed read. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7704h`; evidence under `artifacts/ux/U7704h/`, uncommitted, one browser session for each state (#7924). Policy; the design critic judges layout and looks, never a Vitest test (rule 10).

**Amended.** `scenarios/ui-changes-repeats.md`: a repeat is a Spot, and its gutter stamp is the spot stamp. Kept: notes, Viewed, the lenses and their keys as built.

Reuse (rule 9): no new machinery. The mark is a line annotation and the stamp the reader's own, both of `@pierre/diffs` as the repeats use them; the read follows `createRepeatScan` and `createCallPaths` (`watchTurns`, `failureOf`); the group is the open `group` of U7853a. The PR's `Reuse:` section says so.

Not wanted: a model, tokens or cost (P14); a Landing gate; a new border; a new Daemon method beyond C7704's two; the tool's own report format in the view.
