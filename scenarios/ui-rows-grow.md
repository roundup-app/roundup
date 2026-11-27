# UI: a file row shows its file name, and no list row's text draws over another row (U8027a–U8027d)

Module: `apps/desktop/src/changes/` (`ChangedTree.tsx`, `copy.ts`, `styles.css`), `apps/desktop/src/ui/Tree.css`, the rows of the Rail, Todos, Pads and the Switcher, `tools/lint/`, the fake App and the U26 harness. Ids: U8027a, U8027b, U8027c, U8027d. Work order: [#8027](https://github.com/roundup-app/roundup/issues/8027). Owner, 2026-11-27, on the Changes list in Stable alpha.25640: "the text here is too buggy and unreadbable", "buggy tree on expand". In the Modules and Flows tabs a file row shows its whole repo path, which wraps over four lines and draws over the rows below; the open row's name breaks inside a word. No Daemon method, Message or contract change.

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** Layout and looks (U8027c, U8027d) have no Vitest test (rule 10): the design critic judges them from U8027d's captures. U8027a and U8027b assert a row's accessible name; U8027c is a lint, not a test of looks.

**U8027a a file row shows the file's name, then its counts.** Given a Modules or Flows tab with a file at `src/gaps/composition-commutes-like-arithmetic/worlds/compose-or-refuse/bake.ts`, then:
- **Name.** The row's text is `bake.ts`, then its counts (U7854a, U7674c); the folders leave the row. Asserted in `u8027a_a_file_row_names_its_file_and_counts_never_its_path`.
- **Open.** The file's whole path stays one step away: it is the file's diff header (U7854c), unchanged.

**U8027b a file row names its folder only when another shown row shares its name.** Given two shown file rows named `index.ts` in different folders and a unique `bake.ts`, then:
- **Shared.** Both `index.ts` rows name their folder, dimmed and in their accessible name; `bake.ts` names none (U8009b's rule, for a file). Asserted in `u8027b_two_file_rows_sharing_a_name_both_name_their_folder_and_a_unique_one_names_none`.
- **Moves.** The folder shows or leaves as a row sharing the name enters or leaves the list; no other row changes.

**U8027c a row can grow with its text, and a lint fails when it cannot.** Given every list or tree row the App draws (Changes tabs, Rail, Todos, Pads, Switcher), then:
- **Rule.** No row's height is a fixed length: it is `auto`, or a `min-height`/`min-block-size` Token. A row whose text wraps grows, and its neighbours move down; no row's text draws over another row.
- **Cause.** The suspect is `@ui-sdk/core`'s `[data-slot="tree-label"]` `height: calc(var(--ui-spacing) * 7.5)` (and its 2.75rem and 1.5rem steps in `web.css`) beating an App rule on specificity or on the row's own element, with `.changes-row-name`'s `overflow-wrap: anywhere` wrapping into it. Unproven: the build run reproduces it at 388 px first, and records the real cause in its PR.
- **Guard.** `tools/lint/` gains a script run by `just lint-web`: for each row element the App renders (`[data-slot="tree-item"]`, `[data-slot="tree-label"]` and the App's row classes), it resolves the winning `height` or `block-size` from the App's sheets and the library's `web.css` by specificity and source order, and fails with the selector when the winner is a definite length rather than `auto`. It starts no browser. It fails on `main` as it stands (the library's fixed height wins for the rows it finds) and passes on the fix; if it passes on `main`, the cause is elsewhere and the guard instead measures each row in the U26 harness, failing when a row's `scrollHeight` exceeds its `clientHeight`. Asserted in `u8027c_the_lint_fails_a_row_with_a_fixed_height_and_passes_auto_and_min_height` (a fixture sheet of each) and by `just lint-web` on the PR.
- **Audit.** The build run fixes each row the guard names, in the Changes tabs, the Rail, Todos, Pads and the Switcher, and records in its PR body each list it checked.

**U8027d the rendered tabs at 1512 by 950 and at 388 px.** Given the U26 harness (`u2540.html?shared`) with the Modules and Flows tabs, a module opened and a function opened, dark and light, then no row's text overlaps another row's, and no name breaks inside a word while its row has room. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U8027d`; evidence under `artifacts/ux/U8027d/`, uncommitted. Policy; the design critic judges it, never a Vitest test (rule 10).

**Amended.** U7854a's "File row" (the whole name, then counts) now reads as the file's name, not its path; its "no name breaks inside a word while the row has room" holds as written. U8009b's rule now covers file rows (U8027b). Kept: U7678a to U7678c, U8009a to U8009d, U7680a, notes.

Not wanted: a Vitest test of looks (rule 10), cutting short a name the row has room to show, a new Daemon method or contract change.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-layout.md`, U7854a: the rows read whole.
2. `scenarios/ui-changes-rows.md`, U8009b: a shared name shows its folder.
3. `apps/desktop/src/changes/ChangedTree.tsx`, `File`: the file row.
4. `apps/desktop/src/ui/Tree.css`: the App's row rules over the library's.
5. `tools/lint/scan.py`: where a lint joins `just lint-web`.
