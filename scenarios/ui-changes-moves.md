# UI: the Changes view marks moved and renamed code in the Logic lens, counts it in the item's row and labels it in the list (U7696a–U7696g)

Module: `apps/desktop/src/changes/` (the reader and its Worker, the mark, the row count, the states, the list label). Ids: U7696a, U7696b, U7696c, U7696d, U7696e, U7696f, U7696g. Work order: [#7696](https://github.com/roundup-app/roundup/issues/7696), blocked by #7685 (merged) and #7695 (merged). Owner, 2026-11-18: "Code that was moved or renamed, rather than written new, is marked, so real edits do not drown among moved blocks." A mirror of the repeat mark (U7685): this is code that was not written new. Terms: Moved code (GLOSSARY; never "Mark", which is a report mark).

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`). Quoted words are asserted through `copy.ts`, never layout or looks (rule 10).

**Decided here.**
- **Library.** `@plannotator/sem-jiff` 0.2.0, read in a Worker over the two bodies `agent.compareFile` returns; no Daemon method, no model, no tokens (P14, so its `secondOpinion` is never given). npm carries 0.2.0 only and its git pin is unusable (private package, no built files), so the App draws what 0.2.2 would: `moved` and `renamed` in TypeScript, TSX, Python, Go, Rust, Java and PHP, and nothing else. A move that was also edited (`movedWithEdit`) is a plain edit; Swift and Ruby are not read; Kotlin and C# are left out for their grammars' size, and a language not read loads no grammar. Its grammars ship gzipped (+1.1 MB of a 20,000,000-byte cap, C9c) and a Worker inflates each when its language is first read.
- **Where.** The Logic lens only. The Flows, Modules and Tests lenses draw no mark and count nothing, and a file draws its marks once its own diff has drawn.
- **Wins over a repeat.** The same lines never carry both: a repeat (#7685) loses the lines a move holds, so a hit all of whose lines moved draws no mark and no count, and one partly moved shows only the rest. #7684's scan finds copies of changed hunks and knows no moves, so the scan stays as built and the App trims its answer.
- **Counts.** A row counts the marks of the files drawn so far; it is not asked of files nobody opened. This narrows the Issue's "the row counts `2 moved`" to the files the lens has read.
- **Cross-file.** `sem-jiff` reads one file's two bodies and reports no entities; the call paths already name each changed function and type with its old and new lines. A function or type that one removed symbol and one added symbol of one name and kind give in two files is a candidate; the App reads the two files and marks the added lines when the bodies match to the line, ignoring indentation and blank lines, over at least 3 lines. A candidate with two removed or two added symbols, and a body that changed, are plain edits. Languages with no language server have no call paths and so no cross-file mark.

**Fixture.** The Logic fixture of U7695 (`flowFixture.ts`) over the Tree target; each test's move Worker is a stand-in that answers `Moved[]` by path, since jsdom has no Worker, and each section is reported as it nears the view so every file of an item draws; `u7696d` and `u7696g` also run the real engine and the pairing with no Worker.

**U7696a moved and renamed code is marked at its lines and names its other place.** Given `apps/a/src/run.ts` moved from lines 2-4 to 19-21 and `apps/a/src/load.ts` renaming `MAX_RETRIES` to `MAX_ATTEMPTS` on lines 1 and 3, then:
- **Gutter.** Lines 19 to 21 of `run.ts` and lines 1 and 3 of `load.ts` carry the move stamp, and no other line does. Asserted in `u7696a_moved_and_renamed_code_is_marked_at_its_lines_and_names_its_other_place`.
- **Label.** Under line 21 a read-only line reads "Moved from apps/a/src/run.ts 2-4"; under line 1 of `load.ts` it reads "MAX_RETRIES was renamed to MAX_ATTEMPTS". Asserted in the same test.
- **Nothing hidden.** Every line the diff drew before the mark is still drawn, and no mark folds a line. Asserted in the same test.

**U7696b the row counts its moves and none says nothing.** Given the same marks, then the `apps/a` row says "2 moved" beside its counts and in its accessible name; a module whose files have none says no words, never "0 moved"; and the Flows lens counts none. Asserted in `u7696b_the_row_counts_its_moves_and_none_says_nothing`.

**U7696c every state is drawn on purpose.** My reading, kept: the states are scanning, done, none and failed. Then:
- **Scanning.** A read pending past 150 ms (`createLate`) says "Checking for moves", none before. Asserted in `u7696c_a_slow_read_says_so_after_a_pause_and_none_before`.
- **Failed.** A read that fails says "Couldn't check moves" with its cause and a Retry icon button (owner, 2026-11-26: icons, not text actions), which asks again and clears the line when it answers. Asserted in `u7696c_a_failed_read_says_its_cause_and_retry_asks_again_and_a_slow_one_says_so`.
- **Done and none.** A finished read with marks draws them; one with none draws no mark and no words. Asserted in `u7696a_…` and `u7696b_…`.

**U7696d the reader loads at the first Logic read and claims only what it holds.** Then:
- **When.** No Worker starts at cold start, on the Overview or in the other lenses; the first Logic file drawn starts one, once. Asserted in `u7696d_no_worker_starts_before_a_logic_file_is_drawn`.
- **What.** On the real engine a moved function and a renamed identifier are marks; a moved function that was also edited is none; a file in a language not read, and one over 2,000,000 characters, draw none. Asserted in `u7696d_the_reader_claims_moves_and_renames_and_leaves_the_rest_plain`.

**U7696e a repeat loses the lines a move holds.** Given a repeat hit of `run.ts` 19-21 and another of `load.ts` 3-4, then the first has no mark and the `apps/a` row counts "1 repeat". Asserted in `u7696e_a_repeat_whose_lines_moved_is_not_also_a_repeat`.

**U7696f the list labels moved and renamed functions and types.** Given `run` on the moved lines and `load` on the renamed one, then #7695's list reads "run function moved" and "load function renamed"; a function or type is labelled moved when its first line moved, and renamed when any of its lines carries a rename. Asserted in `u7696f_the_list_labels_a_moved_function_and_a_renamed_one`.

**U7696g code moved to another file is marked in the file that gained it.** Given `legacy` removed from `run.ts` (old lines 10-13) and added to `load.ts` (new lines 10-13) with equal bodies, then `load.ts` lines 10-13 carry the stamp and the label "Moved from apps/a/src/run.ts 10-13", and a pair whose bodies differ draws none. A pair of more than one removed or added symbol, one within a file, and a body of fewer than 3 lines are not candidates. Asserted in `u7696g_code_moved_to_another_file_is_marked_in_the_file_that_gained_it` and `u7696g_only_a_clear_pair_with_a_whole_body_is_a_candidate`.
