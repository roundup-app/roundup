# Merge-conflict spots

Module: `crates/rupd` (N21), `apps/desktop/src/ui` (U3701, U3702). Ids: N21, U3701, U3702. Reported in #2425: over the last 600 merges to `main`, 79 conflicted, and three shared files held most of the hand resolutions the Issue counts: `crates/rupd/src/storage.rs` (7), `apps/desktop/src/ui/styles.css` (2), `apps/desktop/src/ui/index.tsx` (1). `contracts/generated/contract.ts` is out of scope (#2298, #2305). Each spot lands as its own PR (rule 3), each with `Refs #2425`: N21 in `crates/rupd`, then U3701, then U3702 in `apps/desktop/src/ui` (U3702 is blocked by U3701, which moves the stylesheet import the barrel holds today).

Method, shared: a new entry is a new file whose name no other entry shares, and no shared file lists it. Each id's merge test builds a throwaway git repository from the spot's files at `HEAD`, branches twice, adds one entry on each branch by the spot's own recipe and runs `git merge`; it expects exit 0 with no conflicted path, and expects both entries present afterwards.

**N21 one file per migration.** Given the Project's migration sequence (N16), when a migration is added, then its `.sql` file is the whole change:
- *Frozen head.* The ten migrations on `main` keep their order and numbers 1 to 10, listed once in `crates/rupd/src/storage.rs` and never edited again (policy).
- *Added by file.* A later migration is `crates/rupd/migrations/project/<NNNN>-<name>.sql` (`NNNN` four digits); `crates/rupd/build.rs` finds every such file, sorts by file name bytewise and appends them after the head as `M::up` entries. No Rust file names it. A file whose name breaks the pattern fails the build with its path.
- *One list.* `open` and the schema test read the same list, so the `M::up` rows exist once.
- *Same behaviour.* A fresh `project.db` has the same schema and `current_version` 10 as before this change (the existing assertion in `storage.rs` tests, kept).
- *No conflict.* Test `n21_two_migrations_added_on_two_branches_merge_cleanly`: a throwaway repository holding `crates/rupd`, one branch adds `0011-a.sql`, the other `0011-b.sql`; the merge is clean, and a build over the result runs both, `0011-a` first.
- A second test, `n21_a_migration_file_runs_after_the_head_in_name_order`, adds two files out of order and reads the applied versions.

**U3701 one stylesheet per component.** Given `apps/desktop/src/ui/styles.css` (476 lines of `.app-*` rules for tooltip, tabs, tree, splitter, toast, select, listbox and combobox), when a component's style changes or one is added, then only that component's own stylesheet changes:
- Each component's rules move, in their present order, to `apps/desktop/src/ui/<Component>.css`, and the component file imports it. `styles.css` is deleted and `index.tsx` no longer imports it.
- A rule that overrides another component's rule says so in a comment and sits in a file imported after it (the two `.app-tooltip` blocks stay together in `Tooltip.css`).
- *Styles render the same.* The existing browser tests of `ui/` (`u474`, `u483`, `u484`, `u491`, `u498`, `u499`, `u500`, `u501`, `u535`) pass unchanged, and the PR records one computed-style comparison of each `app-*` element on the densest seed, before and after (policy).
- *No conflict.* Test `u3701_two_components_styled_on_two_branches_merge_cleanly`: a throwaway repository holding `apps/desktop/src/ui`, one branch adds `Alpha.css` and `Alpha.tsx`, the other `Beta.css` and `Beta.tsx`, each importing its own sheet; the merge is clean.
- *Tokens only.* `loop/rules.sh tokens` still passes (rule 8).

**U3702 direct imports, no barrel.** Given `apps/desktop/src/ui/index.tsx`, which defines `Dialog`, `AlertDialog`, `Menu`, `Editable`, `Tooltip`, `Tabs`, `IconButton` and `TreeView` and re-exports the rest, when a primitive is added, then no shared file lists it:
- Each inline definition moves to `apps/desktop/src/ui/<Name>.tsx` (`AlertDialog` beside `Dialog`); each existing file (`Select`, `Listbox`, `Combobox`, `Mentions`, `Splitter`, `Toast`, `sortable`) stays.
- Every importer of `../ui` or `./ui` imports from `../ui/<Name>`; `index.tsx` is deleted; `just lint-web` resolves every import.
- *Behaviour unchanged.* The exports keep their names, props and markup; the `u474_foundation`, `u491_*`, `u492_*`, `u499_composition` and `u501_listbox` tests pass unchanged.
- *No conflict.* Test `u3702_two_primitives_added_on_two_branches_merge_cleanly`: a throwaway repository holding `apps/desktop/src/ui`, one branch adds `Alpha.tsx`, the other `Beta.tsx`, each used by a new importer; the merge is clean. `u3702_no_ui_file_re_exports_the_primitives` asserts `ui/index.tsx` is absent and no file under `ui/` holds an `export … from` of a sibling primitive.
