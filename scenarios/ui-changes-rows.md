# UI: a Changes row reads as a name, a length bar and one dot, and a tab says what it lists (U8009a–U8009d)

Module: `apps/desktop/src/changes/` (`ChangedTree.tsx`, `ChangesView.tsx` side and tabs, `copy.ts`, `styles.css`), the fake App and the U26 harness. Ids: U8009a, U8009b, U8009c, U8009d. Work order: [#8009](https://github.com/roundup-app/roundup/issues/8009); the chain after it is #8010 (open on code), #8011 (steps) and #8012 (change map), each its own scenario. Owner, 2026-11-26/27, on the Changes list: "We need to work on this view design and active state etc. I find that view very hard an annoying to navigate and a pure wall of text"; of what hurts most: "Too many steps to reach code", "rows look alike", "the tabs are unclear"; on draft 1 "worried of noise and uncessery information overload"; on draft 2 "fits". Scope: the list and the header above it. No Daemon method, Message or contract change: counts and signals come from what the list already holds.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** Each word is asserted through `copy.ts` (rule 10). Layout and looks (U8009a to U8009c's weight, colour, bar and ground) have no Vitest test: the design critic judges them from U8009d's captures against the approved sketch below.

```
U7703 Diagram Stepper Build                      ⌂  ✕
vs main ▾ · 12 files · +192 −13 · 3 of 7 viewed
─────────────────────────────────────────────────────
 Flows 4 │ Modules 7 │ Logic 5 │ Tests 3
 Every changed folder, code and tests together
─────────────────────────────────────────────────────
  changes                        ▮▮▮            ▕▒
✓ agents                         ▮▮▮▮▯      •   ▕█
  scenarios  crates/agents/tests ▮▮▮▮▮▮▯        ▕▒▒
▌ agent      +8 −0               ▮              ▕▓
  docs                           ▮▯             ▕▒
  scenarios                      ▮▮▮▮▮▮         ▕▒▒
  Top level                      ▮              ▕▒
```

▮ ▯ lines added and removed, drawn to scale (green, red); ▌ the open row on a solid ground; ✓ viewed; • the row holds something worth a look; ⌂ opens the Overview; the strip at the right is the change map (#8012, not this order).

**U8009a a module row holds a mark, a name, a length bar and one dot.** Given the lens fixture (U7679), the flow fixture (U7683) and the fake App, then:
- **Row.** A module row draws only the ✓ when the module is viewed (U7680a), its name, a bar of the lines added and removed drawn to scale, and one dot when the module holds a note (U7676d), a repeat (U7685), a finding (U7700c), moved code (U7696b) or a risk mark (U7704b); no digit and no word beyond the name (for module rows; a call or function row adds its mark and `←N`, U8032b). The file count leaves the row; unfolding shows the files (U7678a), each with its name and its own counts (U7674c). Policy: the bar is drawn from the sums U7678a holds, and the critic judges it.
- **Scale.** The bar's length follows the module's changed lines against the list's largest module, so two modules compare by length; a module whose `counts` are `null` (U7678a) draws no bar. Policy; the critic judges it.
- **Dot.** One dot, and its colour follows the most urgent signal the module holds, in this order from most urgent: finding, risk mark, repeat, moved code, note. Policy; the critic judges the colour.
- **Name.** A row's accessible name still says its name, its file count, its `+added -removed`, Viewed or Changed since you viewed it (U7680a, U7680d), and each signal in words, as `2 repeats · 1 finding` (`copy.repeatsCount` and the finding count of U7700c), so nothing the row stopped drawing is lost to a reader of the name. Asserted in `u8009a_a_rows_accessible_name_says_its_counts_viewed_state_and_each_signal`.
- **Open row.** The open row, and the header (U7674b), show the exact `+added -removed`; no other row does. "Open row only" replaces U7678a's counts on every row. Asserted in `u8009a_only_the_open_row_shows_its_exact_counts`.

**U8009b two rows that share a name show their folder.** Given two modules whose names (U7678b) end in the same segment, such as `scenarios` and `crates/agents/scenarios`, and a unique one, then:
- **Shared.** Both rows show the module's folder path before the name, dimmed; a row whose name no other row shares shows no path. The path is read from the module's own name, so it changes only when a row that shares the name enters or leaves the list. Asserted in `u8009b_two_rows_sharing_a_name_both_show_their_folder_and_a_unique_one_shows_none`.

**U8009c the open row stands out, and the tabs say what they list.** Given the open view, the lens fixture and the flow fixture, then:
- **Open row.** The open row has a left accent bar and a solid ground; a faint wash is not enough. Policy; the critic judges it from U8009d's captures.
- **Tab names.** Each tab carries its item count, as `Modules 7`: its accessible name holds the lens's name and its item count, the Overview and the noise rows (U7678b) not counted. The "Lens" label leaves the list's header. Asserted in `u8009c_each_tabs_accessible_name_holds_its_count`.
- **The line.** One line under the tabs says what the open tab lists in plain words, and it changes with the tab (the owner's draft for Modules: "Every changed folder, code and tests together"); the four lines are fixed in `copy.ts` at build and read, for Flows, one entry point and what it calls; for Logic, code with its tests left out; for Tests, tests only. Asserted in `u8009c_the_line_under_the_tabs_changes_with_the_tab`.
- **Kept.** The switch's order and keys (U7679a), the Overview row, ⌂ and closing the view (U7679c), and marking Viewed opening the next unviewed item (U7680b) are as built; the tab segments stay the `SegmentGroup` of U7679a. Asserted by the tests those ids already name; no test is added.
- **No change to the open item.** Opening Changes landing on the first unviewed item's code and a key or click reaching any item's code are #8010's and #8011's; this order changes no landing.

**U8009d the rendered rows and tabs at 1512 by 950 and at 388 px.** Given the U26 harness on the 14-module fixture of U7679f with the flow fixture's files, dark and light, then these draw: the tabs with their counts and the line under them on each of the four lenses; the module rows with a bar, a ✓, a dot of each colour, a shared name with its folder and the open row; the open row's exact counts; and the header, at the centre's 388 px minimum. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U8009d`; evidence under `artifacts/ux/U8009d/`, uncommitted. The critic compares the captures to the sketch above.

**Amended.** U7678a ("Modules": a module row shows its name and its bar and dot, not its file count and `+added -removed`; its test `u7678a_the_list_groups_files_by_module_with_summed_counts` asserts the counts through the row's accessible name and the open row), U7679a ("Switch": the lens label leaves and each segment carries its count; `u7679a_the_switch_names_the_four_lenses_in_order_and_choosing_one_changes_the_list` reads the name before the count), U7680a (the row's check glyph stays, and still shows in the accessible name), U7854a (rows read whole: a row's text is a name, a bar and a dot). Kept: U7679b to U7679f, U7680b to U7680f, U7683a to U7683h, notes. The dot reads the signals main holds; a mark a later Issue adds joins it.

Not wanted: a number or a word on a row beyond the open row's counts, a new Daemon method or contract change, a Vitest test of looks (rule 10), the change map (#8012), a landing on code (#8010), the steps to code (#8011) and the file bar above each diff (its own Issue).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-modules.md`, U7678a and U7678b: the rows and a module's name.
2. `scenarios/ui-changes-lenses.md`, U7679a and U7679c: the switch and the Overview.
3. `scenarios/ui-changes-viewed.md`, U7680a, U7680b and U7680d: the mark, the next item and the changed state.
4. `scenarios/ui-changes-layout.md`, U7854a: the rows read whole.
5. `scenarios/ui-changes-repeats.md`, `scenarios/ui-changes-moves.md` and `scenarios/ui-changes-notes.md`: the signals the dot stands for.
6. `apps/desktop/src/changes/ChangedTree.tsx`, `label`: the row's accessible name.
7. `apps/desktop/src/changes/copy.ts`, `lenses` and `repeatsCount`: the words.
