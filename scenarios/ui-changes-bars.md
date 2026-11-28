# UI: each file has one pinned bar with a Viewed check at its right edge (U8017a–U8017d)

Module: `apps/desktop/src/changes/` (`ModuleScroll.tsx` `module-head`, `DiffReader.tsx` `diff-header` and `DiffIdentity`, `createViewed.ts`, `viewed.ts`, `copy.ts`, `styles.css`), the fake App and the U26 harness. Ids: U8017a, U8017b, U8017c, U8017d. Work order: [#8017](https://github.com/roundup-app/roundup/issues/8017), after #8011; the chain is #8009 → #8010 → #8011 → #8017, and #8012 follows #8011. Owner, 2026-11-26: "Viewed should be a check on the bar not a word on it's own line and that bar needs proper design"; 2026-11-27: a check for each file at the bar's right edge as on GitHub, a ticked file folds, the file's name with its folder only where it differs, the bar on the code's ground with one hairline. No Daemon method, Message or contract change: a mark stays a file's path and `blob` (U7680c) and is never sent to the Agent (U7680a "Personal"). Size: about 500 changed lines.

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** The check is a control with an accessible name and `aria-pressed`, never the word "Viewed" as a button (owner, 2026-11-26: Changes view actions are icons). "New", "Deleted", the readback's rank word (U7697a) and "Changed since you viewed it" (U7680d) stay words on the file's bar. Each word is asserted through `copy.ts`; layout and looks have no Vitest test (rule 10).

```
one-file item: one bar
readback.rs                              New   +8 −0   ✎+  ☐
─────────────────────────────────────────────────────────────
several files: the item's bar, then a bar for each file
agent  crates/contracts/src                     +20 −3   ✎+  ◪
  readback.rs                            New   +8 −0   ✎+  ☑
  steps.rs                                      +12 −3   ✎+  ☐
  tests/steps.rs                                 +4 −0   ✎+  ☐
```

✎+ adds a note; ☐ ☑ the Viewed check; ◪ some files viewed; ─ a hairline under the bar. The explain icons stay at the left of ✎+ until #8033 moves them beside the selected lines.

**U8017a a file's check marks that file, and a ticked file folds.** Given the lens fixture (U7679), an item of three files and the fake App, then:
- **File.** Each file's bar holds a check at its right edge. Ticking it records that file's path and `blob` only; the other files stay unviewed and the item's check reads mixed (`aria-pressed="mixed"`). Unticking removes that record. Asserted in `u8017a_ticking_a_files_check_marks_that_file_only`.
- **Fold.** A ticked file's diff folds down to its bar and unticking unfolds it; the fold changes no mark and sends no call. Asserted in `u8017a_a_ticked_file_folds_to_its_bar_and_unticking_unfolds_it`.
- **Last.** Ticking the last unviewed file of the item marks the item and opens the next unviewed item exactly as V does (U7680b), the next lens included. Ticking any other file moves nothing. Asserted in `u8017a_ticking_the_last_file_opens_the_next_unviewed_item`.
- **Personal.** A tick makes no Daemon call and sends no Message (U7680a "Personal"). Asserted in `u8017a_a_tick_makes_no_call`.

**U8017b the item's bar holds one check for all its files.** Given the lens fixture, an item of several files and an item of one file, then:
- **Item.** An item of several files has one bar above its file bars: its name, its counts, its note icon and a check. The check reads unpressed with no file viewed, mixed with some, pressed with all. A click on it marks every file of the item, or un-marks every file when all are viewed. V and Space at the item's end (U8011a) mark every file of the item. Asserted in `u8017b_the_items_check_marks_every_file_and_reads_mixed_between`.
- **One file.** An item of one file draws one bar, which holds the item's name, its counts, the note icon and one check; no row holds only a Viewed control and a note icon. Asserted in `u8017b_a_one_file_item_draws_one_bar_with_one_check`.
- **Words.** The Viewed button of the item's header (U7680a "Marking") is gone; the check's accessible name comes from `copy.ts`. Asserted in `u8017b_the_check_is_a_pressed_control_not_the_word_viewed`.

**U8017c a changed file clears its check and says so on its bar.** Given a viewed item and the fake Agent's writes, then a file whose `blob` differs from its mark reads unviewed, its check is unpressed, its bar says "Changed since you viewed it" and its diff is unfolded, until it is ticked again (U7680d). The item's check reads mixed while its other files stay viewed. Asserted in `u8017c_a_file_changed_after_its_mark_clears_its_check_and_says_so`.

**U8017d each bar is one line, pinned, on the code's ground.** Given the U26 harness on the lens fixture with a multi-file item, dark and light, at 1512 by 950 and at the centre's 388 px minimum, then:
- **Name.** A file's bar shows the file's name; its folder shows, dim and short, only where it differs from the open item's folder (`tests/steps.rs`); the whole path is its tooltip. Asserted in `u8017d_a_bar_names_the_file_and_shows_its_folder_only_where_it_differs`, through `copy.ts`'s and `DiffIdentity`'s text, never looks.
- **Pinned.** The item's bar and the file's bar stay at the top while their file scrolls under them; each is one line at any width. The bar sits on the code's ground with one hairline under it, never on a band of its own ground (the owner chose the hairline, so it holds against "no new border line"); the insets are U7854c's Tokens.
- **Captures.** Run `just capture U8017d`; evidence under `artifacts/ux/U8017d/`, uncommitted. The critic judges the bars against the sketch; D2, D5, D6 and every Check passing on `main` still hold. Observed by `u8017d_bars_are_captured_for_the_critic`. Policy.

**Amended.** U7680a ("Marking": the header's Viewed button becomes the per-file check and the item bar's check), U7680b ("Next": the last file's tick), U7680d ("Change": the words sit on the file's bar), U7854c (the bars' insets). Kept: U7680c, U7679, U8009 to U8012.

Not wanted: a separate row above the file bars; a mark that sends anything to the Agent or the Daemon; a band behind the bar; the word "Viewed" as a button; a Vitest test of looks (rule 10).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-viewed.md`, U7680a to U7680d: the marks, the next item, the change that un-marks.
2. `scenarios/ui-changes-steps.md`, U8011a: Space at an item's end.
3. `scenarios/ui-changes-layout.md`, U7854c: the bars' insets.
4. `apps/desktop/src/changes/viewed.ts`, `isViewed`, `mark` and `unmark`: a mark is a path and `blob`.
5. `apps/desktop/src/changes/ModuleScroll.tsx`, the `module-head` header: the bar this replaces.
6. `apps/desktop/src/changes/DiffReader.tsx`, `DiffIdentity`: the file's name and words.
