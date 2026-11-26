# UI: the Changes view shows its files beside the diff (U7674a–U7674f)

Module: `apps/desktop/src/changes/`. Ids: U7674a, U7674b, U7674c, U7674d, U7674e, U7674f. Work order: [#7674](https://github.com/roundup-app/roundup/issues/7674), blocked by #7673. Owner, 2026-11-18: "this view is awful we need to redesign it", "we need quick easy navigation and clean ui", "prime our moat - simplicity, focus, clean, fast". The owner chose this layout over "All files in one scroll" and "Today's flow, fixed": the tree stays on the left and the chosen file's diff fills the rest. No Daemon method, Message or contract change; it redesigns the centre view U7186c to U7186e built and U7672c switched. The implementation PR's `Reuse:` section names `@pierre/diffs` 1.6.1 (`overflow: 'wrap'`, the `github-light` theme), `@pierre/trees` through `ChangedTree`, and `ui/Select` only if the group switcher needs it; no `!important`, synthetic events or DOM clones. Size: about 700 changed lines. Observer: Vitest against the fake App for U7674a to U7674e; the isolated Chromium harness (U26) for U7674f. Never a native Mac capture.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`). For U7674d a light block in a dark App may read as a defect: its edge, margin or seat changes, never its colour.

**U7674a the tree stays beside the diff and its first file opens.** Given the open Changes view of an Agent with changed files, then:
- **First file.** The first file in tree order opens with the view, with no further click, and keyboard focus lands in the tree. Asserted in `u7674a_the_first_file_opens_and_focus_lands_in_the_tree`.
- **Up and Down.** Up and Down move the tree's focus; a file row that takes focus opens, a folder row opens nothing and the open diff stays. Asserted in `u7674a_up_and_down_open_the_next_and_previous_file`.
- **Tree stays.** The tree stays while a file is open: no Back, and opening a file never replaces the tree (amends U2540a's "the tree is replaced within the transient view" and Back clause). Asserted in `u7674a_the_tree_stays_while_a_file_is_open`.
- **Groups.** With several repository groups a group switcher sits above the tree and shows one group's tree; with one group no switcher shows. Asserted in `u7674a_a_group_switcher_shows_only_with_several_groups`.
- **Kept.** Enter or a double click on a file opens the editor (U2539d). Asserted in the U2539d tests of `u2539d_choose.test.tsx`.

**U7674b the header is one line.** Given the open view, then:
- **Content.** The header holds the Agent's name, From, the switch (U7672c), the shown group's file count with `+added -removed` totals summed from each entry's `counts` (U7610a), U7680a's "N of M viewed" when the lens lists a module, and one close button; no title apart from the Agent's name, no `Changes: <Agent> vs <base>` text (amends U7186c's title), no Back, no status line. Asserted in `u7674b_the_header_holds_name_from_switch_totals_and_one_close`.
- **From.** From is a quiet fixed label, not a control (kept from U7672c). Asserted in `u7672c_from_is_a_label_not_a_control`.
- **Totals.** Choosing another group or switch value changes the count and totals to that listing's; an entry whose `counts` is `null` adds nothing to the totals. Asserted in `u7674b_totals_follow_the_shown_group`.
- **Escape.** Escape closes the view, unless a note field (#7676) holds it, which keeps the view open. Asserted in `u7674b_escape_closes_the_view_unless_a_note_field_holds_it`.
- **Notes bar.** Replaced by U7676a and U7676d (`scenarios/ui-changes-notes.md`): a note starts from the line, and the bar shows only for unsent notes or a send. Asserted in `u7676d_the_bar_shows_only_for_unsent_notes_or_a_send`.

**U7674c every file row shows its counts.** Given the tree, then each file row shows its `+added -removed` through `renderRowDecoration`, a `null` `counts` shows none, and a folder row shows none. Long lines wrap: the reader passes `overflow: 'wrap'` and the view never scrolls sideways. Asserted in `u7674c_file_rows_show_counts` and `u7674c_the_reader_wraps_long_lines`; the sideways scroll itself is U7674f's capture.

**U7674d the diff is GitHub light, always.** Given the App in dark or light mode, then:
- **Theme.** The reader loads Shiki's `github-light` through `@pierre/diffs`'s `theme` option with the current highlighter, in both modes, and the diff surface is light in a dark App. Asserted in `u7674d_the_reader_uses_github_light_in_both_modes`, extending `z3_highlights.test.tsx`, which proves the theme loads and highlights.
- **Dead code.** `registerCustomCSSVariableTheme("roundup")` in `DiffReader.tsx` and the token-driven syntax colours in `diff.styles.css` are deleted after their callers are checked (policy: the compiler and the lints find no caller). Lost: github-dark and roundup's CSS-variable diff theme.
- **Checks moved.** The PR names the Checks this moves (rule 8: a named theme is not a Token, so outside the diff surface Tokens only) and measures rule 7 against `docs/perf.md`. Policy.

**U7674e opening is fast and never blanks the pane.** Given the fake App, then:
- **One comparison.** Opening the view requests only the first file's `agent.compareFile`. Asserted in `u7678c_opening_a_module_reads_only_the_files_its_first_screen_shows`, which replaces the first-file test.
- **No blank.** Up and Down keep the open diff on screen until the next file's diff paints. Asserted in `u7674e_up_and_down_never_blank_the_pane`.
- **Switch.** Choosing a switch value or group opens its first file. Asserted in `u7674e_choosing_a_value_opens_its_first_file`.
- **Lazy.** The reader chunk loads when the view opens, never at startup, and the 10,000-line fallback stands (amends U2540d's and U7186c's Reader clause: it loaded on choosing a file). Asserted in `u7186c_the_reader_stays_lazy` and `u2540d_lazy`, edited to the open.

**U7674f the rendered view at 1512 by 950 and at 388 px.** Given the U26 harness, dark App, dense fixture (500 changed files, a 120-character path, 100 notes, a 10,000-line diff; `u2540.html?dense` extended), then at 1512 by 950 and at the centre's 388 px minimum: no sideways scroll, the diff reaches the view's bottom edge, one header line, the tree told from the diff by space or ground and no new border (D8), chrome in ghost buttons in `--grey` (U510). D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7674f`; evidence under `artifacts/ux/U7674f/`, uncommitted. Policy; the design critic judges layout and looks, never a Vitest test (rule 10).

**Amended.** U2540a ("the tree is replaced within the transient view", Back, closing returns to the branch control): the tree stays beside the diff; U7186c (`Changes: <Agent> vs <base>`, "Opens the compare"): the first file opens; U2540d and U7186c's Reader clause: the reader loads when the view opens. Kept: #7672's picks, the 10,000-line fallback (U2540d, U5646c), notes and recovery (U2540b, U2540c, P11).

Not wanted: side-by-side diff, all-files scroll, commit list, a new Daemon method; Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-agent-changes.md`, U7186c: the Opens the compare and Reader clauses amended.
2. `scenarios/ui-changes-remote-main.md`, U7672c: the switch and From label kept.
3. `scenarios/ui-diff-notes.md`, U2540a, U2540b and U2540d: the tree-replacing view, notes and lazy reader.
4. `scenarios/ui-changes-counts.md`, U7610a: the `counts` the totals sum.
5. `apps/desktop/src/changes/DiffReader.tsx` and `apps/desktop/src/changes/diff.styles.css`: the theme and colours deleted.
