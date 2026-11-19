# UI: one Changes surface, the Worktree Panel removed (U7671a)

Module: `apps/desktop/src/changes/`, plus the callers and tests of `Panel` outside it. Ids: U7671a. Work order: [#7671](https://github.com/roundup-app/roundup/issues/7671). Owner, 2026-11-18: "this view is awful we need to redesign it". First of the Changes view redesign's Issues; this one only deletes. U7186e ordered the Worktree popover removed, but `WorktreeControl`'s `Panel` still mounts its own tree and `DiffReader` in the bottom bar, so two Changes surfaces exist. No Daemon method, Message or Token changes, and no change to the Changes view's layout.

**U7671a the Worktree Panel is removed and the Changes view is the one surface.** Given a Door with its own Worktree that has changed files, then:
- **No second surface.** `WorktreeControl` mounts no tree, `View diff` action, Back or `DiffReader` of its own; nothing in the bottom bar opens a changed-file list. Asserted in `u7671a_the_worktree_control_mounts_no_second_changes_surface`.
- **Leader opens the view.** `leader.changes` opens the Changes view for the selected Agent, and the Rail icon and the file open in the editor (U2539d) are as they were. Asserted in `u7671a_leader_changes_opens_the_changes_view`.
- **Recovery stays.** `NoteRecovery` still opens and keeps U2540b's recovery rules. Asserted in `u7671a_note_recovery_still_opens`.
- **No dead callers.** The compiler and the lints find no caller of a deleted name. Policy: the tests left in `changes/`, `rail/` and `testing/` pass, and each test of the deleted Panel is cut with the clause it proved named: U2539b's Panel clauses are held by U7186c to U7186e and U7671a, the tree and diff opening by U7186c and U2540a's amended text. Retired clauses: U2539b's popover open/close/focus and one-tab-stop tests, with the popover.

Amendments: U2540a's "the tree is replaced within the transient view", its Back-returns-to-the-tree clause and its `View diff` action describe the Panel, so they are retired and the diff reader opens from the Changes view (U7186c). U7186e's Same view clause stands as written: the Panel is now removed, not only ordered removed.

Not wanted: Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks (rule 10); the design critic judges them. Observer: Vitest against the fake App; a design check that reads a decision here as a defect changes how it is drawn, never the decision.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-agent-changes.md`, U7186e: the Same view clause this completes.
2. `scenarios/ui-diff-notes.md`, U2540a and U2540b: the diff opening this amends and the recovery rules this keeps.
3. `apps/desktop/src/changes/WorktreeControl.tsx`, `Panel`: the code this removes; `NoteRecovery` stays.
