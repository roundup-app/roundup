# UI: the Changes view reads whole, insets its text, labels a new file New and fails inside its pane (U7854a–U7854f)

Module: `apps/desktop/src/changes/`, the fake App and the U26 harness. Ids: U7854a, U7854b, U7854c, U7854d, U7854e, U7854f. Work order: [#7854](https://github.com/roundup-app/roundup/issues/7854). Owner, 2026-11-20: the approved prototype wins over a design-critic Check it breaks; 2026-11-21: keep new files listed and label them New. The view of #7674, #7675 and #7678 holds; this brings its rows, insets, new-file word and failure to the approved prototype (`changes-redesign`, 11-18/19). No Daemon method, Message or contract change.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** `<file>` is the file's name, `<Agent>` the Agent's name. Layout and looks (U7854a to U7854c) have no Vitest test (rule 10): the design critic judges them from U7854f's captures against the prototype. A test asserts the words and the controls of U7854d and U7854e through `copy.ts`.

**U7854a the tree rows read whole at 1512 by 950 and at 388 px.** Given the owner's case (an Agent in a shared checkout with one untracked, one dotfile and one modified file), then:
- **File row.** A file row shows its whole name, then its counts: `vite.config.ts  +25 −7`. A gap never splits a name from its extension, and no name breaks inside a word while the row has room.
- **Module row.** A module row shows one folder path whole, then its file count and counts: `apps/desktop/src`. A path never splits at a slash into two lines.
- **Narrow.** In a view narrower than 560 px the tree stacks above the diff, as the prototype's narrow centre does, so a row has the view's width. Wide, the tree stays beside the diff (U7674a).
Policy; the critic judges it (U7854f).

**U7854b one label per group, never clipped.** Given two repository groups, then the switcher shows one label per group, `<repo> · <branch>`, each whole: a label too long for its row wraps and never ends in a cut. Policy; the critic judges it (U7854f).

**U7854c the header, the tree rows and each diff's path are inset by the spacing Tokens.** Given the open view, then no text of the header, a tree row or a diff header sits on the edge of its ground: each is inset by `--space-2` or `--space-3`, as the prototype's `.ch-head`, `.row` and `.path-line` are. Tokens only (rule 8). Policy; the critic judges it (U7854f).

**U7854d a file the Agent created is labelled New.** Given an Agent that created a file (status `added` or `untracked`), then:
- **Tree.** The file's row says "New" and never git's letter. Asserted in `u7854d_a_new_file_is_labelled_new`.
- **Diff.** The file's diff header says "New", for a comparison that is `added` or `untracked`; a deleted file says "Deleted", a modified one says no word. Asserted in `u7854d_a_new_file_is_labelled_new`.
- **Listed.** The file stays in the list and its diff opens as any file's does (the owner's pick, 2026-11-21).

**U7854e a failed file read shows inside the file's pane with Retry.** Given a comparison that fails, then:
- **Where.** The failure shows inside the diff pane of that file, under its header, never in the Toast region and never over the header. A diff the file already drew stays drawn beside it (U5646d).
- **Words.** It says "Couldn't read <file>" and carries no raw code; the cause stays in the line's accessible label.
- **Retry.** The line carries Retry and no Dismiss: the file stays unread until Retry (the U7314e block). Retry reads that file alone and a successful read removes the line (U7678c, `u7678c_one_files_notice_leaves_the_other_sections_alone`).
Where, words and controls are asserted in `u7854e_a_failed_file_read_shows_in_the_pane_with_retry`.

**U7854f the rendered view for the critic.** Given the U26 harness (`u2540.html?shared`), then at 1512 by 950 and at the centre's 388 px minimum, dark and light, these draw: the owner's case folded and a module unfolded, two groups, and a failed file read. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7854f`; evidence under `artifacts/ux/U7854f/`, uncommitted. Policy; the design critic judges each against the prototype, never a Vitest test (rule 10).

**Amended.** U7674a ("Tree stays": "the tree stays beside the diff") holds at 560 px and wider; narrower, the tree stacks above the diff (U7854a). U7674f and U7678e at 388 px: the stack replaces the side column. U7675b and U7678c's "a failed read with Retry (U80) draws as that file's notice inside its section": it draws there, no longer also as a toast; the Dismiss of a file-read failure is gone, so `u5558e_failed_reload_retains_data` drops its `dismiss` case and keeps `retry` and `signal`. U7314c's "Diff reader" clause: a diff-read failure shows in the file's pane, no longer as a toast (U7854e); its Fork sheet clause and `u7314c_changes_and_fork_failures_show_as_toasts` stand. U5558e's "actual cause in the existing failure surface": for a comparison, that surface is the pane's line, and the cause is its accessible label. U2540a's state clause ("Retry on a failed read stays") stands. U7675b's "Added": the word for a created file is "New" (U7854d). Kept: the listing failure's words and cause (U7675a), the rows' keys and focus (U7678a, U7678b), notes and recovery (U2540b).

Not wanted: a new Daemon method or a contract change, a sound, motion, a Dismiss on a file-read failure, a Vitest test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-redesign.md`, U7674a, U7674b and U7674f: the tree beside the diff and the one-line header.
2. `scenarios/ui-changes-states.md`, U7675a, U7675b and U7675g: the failure, file and rendered states.
3. `scenarios/ui-changes-modules.md`, U7678a, U7678b, U7678c and U7678e: the module rows and the file notices inside a module's scroll.
4. `scenarios/ui-diff-notes.md`, U2540a and U5646d: a failed read keeps the drawn diff; Retry.
5. `scenarios/ui-failure-toasts.md`, U7314c, and `scenarios/automatic-updates.md`, U5558e: where a diff-read failure shows.

---

# UI: the Changes view draws a file before it scrolls in, on one ground, with one bar (U8031a–U8031d)

Module: `apps/desktop/src/changes/`, the fake App and `loop/`. Ids: U8031a, U8031b, U8031c, U8031d. Work order: [#8031](https://github.com/roundup-app/roundup/issues/8031). Owner, 2026-11-27: the Changes view "flashes a lot when I scroll", near the file bar, as new files come in. No Daemon method, Message or contract change. Implementation is a dependent Issue; this PR specifies.

**The class.** A region that starts preparing only when it is visible, with a placeholder whose ground or height differs from what replaces it. Every lazily mounted list or reader under `apps/desktop/src/` is audited for it and each hit is fixed.

**U8031a a file near the fold is read and drawn before it scrolls in.** Given a change of many files and the scroll at its top, then:
- **Ahead.** A file whose top lies within the margin below the scroll's visible edge is read and drawn without scrolling. A file beyond the margin is not read. The margin is Pierre's read-ahead, 4000 px (`Virtualizer.js` of `@pierre/diffs`), named once as a constant.
- **Root.** The observer takes the scroll element as its `root`, so the margin applies to the scroll and not to the window.
- **Open fast.** A long change still reads only the files inside the margin (rule 7).
Asserted in `u8031a_a_file_inside_the_margin_is_drawn_before_it_scrolls_in`.

**U8031b a placeholder paints the ground of what replaces it.** Given a file not yet drawn, then its placeholder has the diff's ground, so the drawn diff replaces it with no change of ground. Policy; the design critic judges it from U8031d's captures (rule 10: no test of looks).

**U8031c a file's bar is drawn once.** Given a file whose diff arrives, then:
- **Same node.** The bar's element before the diff is the bar's element after it.
- **No flicker line.** No status line is added above the code and then removed while the file loads: the loading line of `DiffReader` shows only for a read slower than its existing late delay, and never in the first frame.
Asserted in `u8031c_a_files_bar_stays_the_same_node_when_its_diff_arrives`.

**U8031d the guard and the capture.** Then:
- **Guard.** A source check fails when an `IntersectionObserver` outside a test file is made without a `rootMargin` option. It fails on `main` as of 2026-11-27 (`ModuleScroll.tsx` makes one with none) and passes once each passes a `rootMargin`. It starts no browser. Asserted in `u8031d_every_intersection_observer_passes_a_root_margin`.
- **Capture.** `just capture U8031d` records the Changes view scrolling through a long change at 1512 by 950, dark mode only, uncommitted under `artifacts/ux/U8031d/`; D2, D5 and D6 and every Check passing on `main` still pass. Policy; the design critic judges it.
- **Perf.** `just perf` shows no regression above 10% (rule 7, `docs/perf.md`).

Not wanted: a Vitest test of looks, turning off lazy drawing, a new Daemon method or contract change.

Blocks #8035.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-layout.md`, U7854e: the pane's failure line under the header.
2. `scenarios/ui-changes-modules.md`, U7678c: the file notices inside a module's scroll.
