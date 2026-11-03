# U5741 Worktree read decisions

Audited main: `842e70e14162ac5311df8869810aa09a42c17e5e`. This continues the inventory with the three Daemon reads of an Agent's Worktree that the Agent start/lifecycle files leave undecided. It is a source, declaration and scenario reconciliation: no fresh rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask, retained Worktree work and older-Project reopening stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`. The offers are the rows of `endpoints.md`: only `agent.worktreeState` has a CLI command and MCP tool; `agent.changedFiles` and `agent.compareFile` are App-only (declared `none(...)`, `scenarios/mcp.md` Reach list). A production App caller is a non-test file under `apps/desktop/src`.

| Row | Independent read and exact public entry points | App callers | Implementation / acceptance |
| --- | --- | --- | --- |
| AW01 | Read how far a Worktree is from its Base: `agent.worktreeState`; `rup agent worktree-state`; `agent_worktreeState` | `changes/WorktreeControl.tsx` (State row), `state/worktrees.ts` (shared refresh), `rail/menu/removal.ts` (Remove consequences) | `scenarios/worktrees.md` G3, G6, G8; `scenarios/ui-worktree-status.md` U2556a; `crates/agents/tests/scenarios/worktree_state.rs` (`g3_*`). |
| AW02 | List what an Agent changed against its Base: `agent.changedFiles`; no CLI or MCP offer | `changes/WorktreeControl.tsx` | `scenarios/ui-worktree-changes.md` U2539a, U2539b, U2539d; `crates/agents/tests/scenarios/u2539a_changed_files.rs`. |
| AW03 | Read one changed file as a Base-versus-disk comparison: `agent.compareFile`; no CLI or MCP offer | `changes/DiffReader.tsx`, `changes/NoteBatch.tsx` | `scenarios/ui-diff-notes.md` U2540a, U5646a; `apps/desktop/src/changes/u2540b_notes.test.tsx`, `u2540d_lazy.test.tsx`. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| AW01 | **Not established.** No vendor probe was run. | **No.** Remove's confirm (U367, `removal.ts`) and landing (G4, which needs `dirty` false) read it to decide. | **No.** Remove and land act on what it shows. | Not a candidate. |
| AW02 | **Not established.** | **Unproven.** Review of an Agent's change opens from this list; no stage trace shows another route to a changed file. | **Partly.** The list is information, and a click opens the file in the editor (U2539d). | Not a candidate on this evidence. |
| AW03 | **Not established.** | **Unproven.** Notes sent to the Agent (U2540b) start from this comparison; no stage trace shows another route. | **No.** Selecting a range and sending a note acts on it. | Not a candidate on this evidence. |

## Dated direction

Owner, 2026-10-18: [#2539](https://github.com/roundup-app/roundup/issues/2539) (Orca changed files and open-at-line), [#2540](https://github.com/roundup-app/roundup/issues/2540) (Orca and Paseo diffs and notes) and [#2556](https://github.com/roundup-app/roundup/issues/2556) (Worktree state read in roundup, not a Terminal running `wt list`). `direction.md` rows 7, 9 and 10 hold the sources. Deleting any row reverses that direction.

## Remaining

Vendor Q1 comparisons, a stage trace for AW02 and AW03, a fresh runtime role census, and the other undecided methods (`terminal.*` reads, `todo.*` references, `rail.*` and `workstream.*` queue methods, `project.*`) stay unfinished. No owner choice or deletion is made.
