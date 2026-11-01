# Desktop: remove unused code and styles

Module: `apps/desktop`, plus its dependency lockfile and the two inventory documents below. Acceptance for Issue #5463. This is removal of unused implementation, not a change to the Understand, Intervene or Review journey. No new UI pattern, parser, protocol, contract, App command or domain term is required.

**U5463a only used desktop code remains.** Given the desktop source, fixtures, tests and observers on main, when removing the unused code below, then the following holds (policy: inspect the implementation diff and repo-wide references; do not add source-text tests):

| Item, relative to `apps/desktop/src/` | Required result |
|---|---|
| `ui/Form.tsx` | Removed, together with its otherwise unused `reaction-field`, `reaction-label`, `reaction-group`, `reaction-legend` and `reaction-agents` styles in `reactions/styles.css`. |
| `ui/Listbox.css` | Removed; the unused `.app-listbox-item` selector in `ui/Row.css` is also removed. |
| `ui/Toggle.tsx` | Removed, with its fixture-only import and case in `ui/u133Fixture.tsx` and only its Toggle rows in `ui/u133_press.test.ts`. The Button, Checkbox, Switch and Tab cases remain. |
| `keys/places.ts` | Removed with its own-only tests of `placeOf` and `FocusPlace`; these clauses are retired because no production caller uses this classification. |
| `bubbles/focus.ts`, `ask/AskRows.tsx` | One pane-focus helper implementation serves the existing Bubble close and Ask row activation paths. Keep the Bubble helper's pane target and New Terminal fallback; do not delete its internal `closeFocused` caller. |
| `pads/nameLine.ts` | Unused `cutName` removed; used `wholeWord` remains. |
| `state/rail.ts`, `terminal/emulator.ts`, `header/u449Observation.ts` | `failureKey`, `SCROLLBACK_LINES` and `Observation` cease being public exports when only their holder needs them. Keep the computations, scrollback limit and observation behavior; migrate own-only test imports without creating another public export for them. |
| `rail/pads/u58_agent_pads.test.tsx` | Retired U58 test removed. The surviving no-control and Shelf-access proof is `u4457_pads_open_from_shelf_without_agent_control` in `rail/pads/u4457_pads_control.test.tsx`. |
| `perf/nativeDragProbe.tsx`, `perf/nativeDragProbe.css`, `perf/frame_run.ts` | One-off native probe files, `drag-compatibility` workload, probe-only types and imports removed. Keep the current shared `drag` workload and its native qualification. |
| `apps/desktop/package.json`, `pnpm-lock.yaml` (repo-relative) | Remove `@atlaskit/pragmatic-drag-and-drop` and `@atlaskit/pragmatic-drag-and-drop-hitbox` and their otherwise unneeded lockfile entries if repo-wide callers are probe-only. Regenerate the lockfile with pnpm; a surviving non-probe caller requires retaining its dependency and recording the evidence on the Issue. |

Policy: retain `plain/Markdown.tsx` and `renderMarkdown`; Q10 still requires them. Do not replace removed code with relocated copies, new suppressions or fallow configuration exclusions. Audit each edited test file under AGENTS.md rule 10; name the surviving proof or retired clause for every cut. Reuse existing helpers and library capabilities; adding machinery instead follows rule 9.

**U5463b styles name a source, test or observer.** Given styles under `apps/desktop/src/`, when removing unused selectors, then these names have no remaining CSS rule (policy: repo-wide reference search plus diff review):

```text
ask-unknown-state made-actions made-context made-panel made-target made-trigger
requested-empty switcher-recovery switcher-recovery-actions diff-selection
worktree-none import-failure progress-failure pad-editor-failure
pad-retained-status pad-retention pad-retention-shelf pad-saved door-action
door-action-label rail-name-error rail-retention rail-task-target row-name-state
reaction-preview reaction-time-fields reaction-when shelf-group-add draft-detail
draft-object draft-status project-attention pane-shortcuts capture-native-failure
todo-history-head todo-blockers todo-now todo-tooltip item-description
```

Policy: remove only the dead name from a shared selector list, retaining each live selector and its declarations. Keep `folded-agents` and `todo-move`: observers still name them: `apps/desktop/observers/journey/J14/observer.ts.txt` queries `folded-agents`, and `apps/desktop/observers/U157/observe-real.sh` focuses `todo-move`. Keep selectors added by Milkdown, Crepe and OverlayScrollbars, including `ProseMirror-*`, `crepe-*`, `os-scrollbar-*` and `theme--dark`; absence from TSX is not evidence that a library selector is unused. Add no new look values.

**U5463c removal preserves behavior and inventories.** Given the cleaned desktop, when running its typecheck and dead-code observer on the implementation PR head, then typecheck passes and fallow reports none of U5463a's removed files, unused exports or probe-only dependencies (policy: retain command output and exit codes). Other findings are not permission to broaden this cleanup. A retained item with a verified live caller is not an unused item; record its caller on the Issue.

Given ordinary Ask activation and Bubble closing, when the existing actions run in order, then Ask still selects its Workstream and focuses its pane, and closing a focused Bubble still returns focus without an extra Terminal write. Assert through the existing behavioral tests in checks 1 and 2; extend those only if the shared-helper change exposes a clause they do not assert. Do not add a source-text test for consolidation.

Given the cleaned inventories, then `docs/design-system.md`, **Icon meaning and inventory (U4898)**, and `docs/u3787d-inventory.md`, **U3787d literal editing inventory**, no longer name `Form.tsx` (policy: inspect both documents). Preserve any still-rendered reaction fields' inventory under their actual owner rather than erasing the fields' acceptance.

Given the same dark harness seed and viewport on main and head, when opening the affected live surfaces, then every visual Check passing on main still passes (policy: design critic and paired rendered observations). No Check is intentionally moved; in particular D2 spacing, D5 contrast and D6 hit areas and keyboard focus remain. Use `tree-40`, `agents-10` and `bubbles` at 1512×950, opening the affected Drawer, Shelf, reaction and failure/recovery surfaces as applicable to each edited shared selector. Show failure text on the densest seed. Run `just capture U5463c`, adding capture coverage if needed, and leave paired PNGs and readings under `artifacts/ux/U5463c/base/` and `artifacts/ux/U5463c/head/` per the harness Captures heading; commit no image or video. Use an isolated headless browser and fresh profile. Linux/Chromium is the observer; the user reports what they meet on the Mac.

## Regression checks on main

1. `apps/desktop/src/ask/u505_ask_rows.test.tsx`, `u505_selecting_a_row_selects_its_workstream`: click and Enter each select the routed Workstream, focus the pane and cause no start, Ask or Terminal write.
2. `apps/desktop/src/bubbles/u165_keys.test.tsx`, `u165_leader_w_closes_with_one_call_and_returns_focus`: closing the focused Bubble calls close once and returns pane focus.
3. `apps/desktop/src/rail/pads/u4457_pads_control.test.tsx`, `u4457_pads_open_from_shelf_without_agent_control`, and `scenarios/ui-shelf-agent-owner.md`, **U4457 the Rail has no item leaves or Pad assignment control**: Shelf Pad access and the Todo-only control survive U58's retirement.
4. `docs/design-system.md`, **The checks**: all passing Checks remain passing; inspect shared-selector edits and compare rendered checks, with D2, D5 and D6 explicitly read.
5. `docs/motion-native-runbook.md`, **U3800 shared drag qualification**: the completed probe is not repeated; the current shared drag workload remains available.
6. `scenarios/plain-text.md`, **Q10 the App renders the Markdown an Agent writes**: the Markdown renderer remains outside this cleanup.

## Implementation verification

Policy: no new test that merely rereads removed source, stylesheet or dependency text. Run the existing behavioral tests above, each edited test file and any newly failing test named by the implementation task, plus `just ready`. Do not run a whole test suite or `vitest related`. The implementation observer is in `apps/desktop`:

| Command | Failure and exit code |
|---|---|
| `pnpm typecheck` | TypeScript or copy guard failure: nonzero (TypeScript 1 or 2; guard 1); retain the actual code and diagnostics. |
| `pnpm exec fallow dead-code` | Findings: 1; inspect the report for the named items, retaining unrelated findings separately. Setup/analysis failure: any code other than 0 or 1 is an observer failure, not a clean result. |
| `pnpm exec vitest run <changed test files and checks 1–3>` | Failed test or launch/setup: nonzero; retain the actual code and failing test. |
| `loop/rules.sh delta artifacts/ux/U5463c/base artifacts/ux/U5463c/head` (repo root) | A passing Check regressed: 1. Missing or incomparable readings: 2. |

Specification validation: `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. The specification PR leaves Issue #5463 open for implementation.
