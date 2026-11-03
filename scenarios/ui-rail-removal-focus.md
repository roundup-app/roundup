# UI: keep Rail focus after dismissing a row menu

Acceptance for [#5951](https://github.com/roundup-app/roundup/issues/5951). Journey: Intervene and Review. This specification adds an observer for the single-row continuation of U5690a/U5690e and U358; it changes no runtime behavior. Tests marked planned belong to implementation.

Policy: U5690a (`scenarios/ui-rail-selection-actions.md`) already replaces U2694g's selection preservation for a context click outside the selection. That click selects its target without activating it. This scenario keeps that rule and U358's next-row focus rule together through menu dismissal. It does not extend multi-selection removal, confirmation, removal scope or Undo/Redo semantics.

**U5951a dismissing a row menu leaves removal ready to advance.** Given three visible sibling reversible Agent rows A, B and C in that Rail order, with A the sole selected row and no Bubble shown, when the user right-clicks B without dragging, dismisses its native menu without choosing an action, then presses and releases ⌘⌫ on B, then:

- Before the chord, B is the sole selected row and has keyboard focus; opening and dismissing the menu requested exactly one menu and made no removal or Agent/Terminal activation call. Planned test: `u5951a_dismissed_menu_keeps_its_row_selected_and_focused` in `apps/desktop/src/rail/u358_cmd_backspace_removes.test.tsx`.
- Once the reversible removal is acknowledged, only B is removed, exactly once through the existing single-row removal path, without a confirmation. A and C retain their identities and relative order; C is the sole selection and its row owns keyboard focus, rather than the page body. Planned test: `u5951a_removal_after_menu_dismissal_selects_and_focuses_next_row` in the same file, repeating the complete gesture sequence rather than setting selection/focus directly after dismissal.

Observer: extend the existing `mountRail` seam and fake App with reversible rows (no running program, Worktree or other irreversible loss). Dispatch the complete right-button pointer/mouse/contextmenu/release sequence as U2694g's existing observer does; dismiss through `menuProbe.answer(null)` and send the chord to the row that actually owns focus. Never call `focus()`, `rail.select()` or replace the selection to repair state between dismissal and the chord. Assert actual selected identities, `rail.selected()`, `document.activeElement`, surviving rows, removal identities/counts and zero native questions. The two planned tests prove the dismissal outcome and the subsequent removal outcome separately; do not duplicate U358's other cases.

Policy — scope and regressions: implementation stays in `apps/desktop/src/rail/`, including existing selection/menu integration and the named test file. Reuse installed Ark UI TreeView, the existing selection owner, row-menu removal completion and native-menu seam; add no focus/selection state machine, parser, protocol or contract. Keep U5690a/U5690e's single-target selection, U5690b/U5690d's whole-set behavior, U358's last-row fallback/repeat/key ownership/failure behavior, and U3787a's focused Undo/Redo. Apply rule 10 to the edited test file; record any cut and its remaining proof on the Issue. No new RPC, App seam command, public name, Token, copy or motion is required.

## Gates and observers

| Check | Holder on main | Failure observer |
| --- | --- | --- |
| 1 | `scenarios/ui-rail-selection-actions.md`, **U5690a** and **U5690e** | A context click outside the selection targets B alone without activation; the dismissal test observes identities and zero activation/removal calls. |
| 2 | `apps/desktop/src/rail/Rail.tsx`, `removeSelected`; `scenarios/ui-keyboard.md`, **U358** | The removal test observes exactly B removed and selection/focus advancing to C. |
| 3 | `apps/desktop/src/testing/menuProbe.ts`, `probeMenu`; `apps/desktop/src/rail/railFixture.tsx`, `mountRail` | Drive the menu answer and ordinary acknowledged removal through existing seams, without manually repairing focus or selection. |
| 4 | `docs/design-system.md`, **The checks**, D2/D5/D6 | Rendered policy: preserve Token spacing and contrast; the surviving row remains keyboard reachable with actual Rail region focus. No passing Check on main regresses. |

Policy: P6's gate asks whether removal changes unchosen work; compare A/C identities and order. P9's gate asks whether opening/dismissing the menu starts an Agent or types input; observe zero lifecycle/input calls. The scenario introduces no editable surface or published deliverable.

Implementation verification: `pnpm --filter desktop exec vitest run src/rail/u358_cmd_backspace_removes.test.tsx`, plus `just ready`. Rendered policy: run `just capture U5951a` at 1512×950, dark, using the U26 `tree-40` harness; record the complete context-click/dismiss/remove sequence with three reversible sibling rows and show the surviving selection and Rail focus. Include visible failure feedback on the dense seed when checking D2/D5/D6. Leave paired main/head PNGs and recordings under `artifacts/ux/U5951a/`, never committed. Linux interaction/state observers establish this repair; native appearance and OS routing remain the user's Mac report, with no new Mac-only gate. This specification-only PR needs no runtime capture.
