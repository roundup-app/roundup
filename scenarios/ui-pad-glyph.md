# UI: Pad icon and group-head columns

Module: `apps/desktop` (webview). Acceptance for Issue #4708, Decisions 2 and 3 of the Pad "Todo list design". It builds on U4707's 32px inset (`scenarios/ui-row-inset.md`) and replaces its clause that Pad rows leave no glyph column. It serves the first journey's Review stage: Pad and Todo titles share one x, and a group head reads as part of the same column grid.

**U4708 Pad rows carry the Pad icon and group heads align to the row columns.** Policy (rendered acceptance, design-critic observer): given the Shelf's `Todos` and `Pads` lists on `tree-40` and `agents-10`, with root, child, grandchild and great-grandchild rows (depths 0–3), a 300-character Todo title, a 120-character Pad name, ten blockers and a 60-character group name, when reading them dark at 1280×820 and 1512×950, then:

- **Pad icon.** Each Pad row draws, in the glyph slot, the Pad icon the `PADS` tab uses (`sticky-note`, as amended by U4908) (one shared icon component, not a copy), in the muted text colour. The icon is not a state: a Pad row gains no state glyph, badge or colour (U4275a), and its open, rename and drag paths are unchanged.
- **Group head.** A group head puts its chevron in the glyph column, its name on the title edge, and its count after the name in the grey secondary colour. A 60-character group name is cut with `…` and its count stays visible. The head's expand, collapse and focus behaviour is unchanged.
- **Shared x.** At every depth, in both lists, glyphs (Todo state glyphs and Pad icons) and group chevrons share one x, and titles and group names share one x, each within 1 CSS px. Pad and Todo titles at the same depth share one x. Hover, focus and selection move none of them.
- **Tokens.** Colours, sizes and spacing read existing Tokens; add no literal. The Pad rows' `glyph={null}` is replaced, not worked around with padding.

Policy: this amends U4707's clause "Pad rows pass `glyph={null}` and leave no empty column before the name"; the depth-0 title still starts 48 CSS px from the panel edge. No contract, App command or Daemon change; the Todo tick, grip, open arrow, dependency elbows, live updates and 32px rows are unchanged.

Observer (policy): U26's harness in an isolated headless `agent-browser` session with a fresh profile, dark, at both viewports above. Run `just capture U4708` and leave the Todos and Pads lists with their group heads, at depths 0–3, under `artifacts/ux/U4708/`, following `.agents/data/harness.md`, **Captures**; commit no image or video. Read `window.__checks()` on the densest seed. The Linux/Chromium observer makes no native Mac claim; the user reports what they meet on the Mac.

The implementing change moves these Checks, held by `docs/design-system.md`, **The checks**, and breaks none passing on main:

1. D2: spacing and colour use existing Tokens only.
2. D5: title, icon and count contrast pass.
3. D6: row, chevron and open actions keep their hit areas.
4. D12: glyph and title x align within 1 px after tree indent.

Regression (policy): keep the Pad and Todo row observers, naming U4708 where they read the glyph column (`apps/desktop/src/pads/u18_pad_list.test.tsx`, `apps/desktop/src/pads/u3789a_pad_rename.test.tsx`, `apps/desktop/src/pads/u3732_drag_browser.test.ts`). Behavioural tests check what a click, key or drag does, plus roles; the critic judges geometry and colour; add no layout, colour or exact-copy test (AGENTS.md rule 10).

Specification validation: `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. Issue #4708 stays open for implementation.


**U4908 Pad marks, shared Open action and no empty leading slot.** Acceptance for Issue #4908; implementation remains in Issue #4708. This serves the first journey's Review stage: find a Pad among the work items and open its contents. Given the Shelf's Pads and Todos tabs, when reading and opening their rows, then:

- **Pad mark (policy).** Each Pad row carries Lucide `sticky-note`, muted and decorative, in the leading slot under its group's chevron. Add that icon to `apps/desktop/src/ink/Icon.tsx`; the shared Pad icon in `apps/desktop/src/shelf/frame.ts` supplies both the tab and its rows. Work orders retain `file-text`; a Pad gains no invented state, badge or state colour. This supersedes U4708's file-icon choice only.
- **Columns (policy).** At matching tree depth, Pad names and group names (the text after the chevron) start within 1 CSS px of each other. Marked rows' leading marks and group chevrons align within 1 CSS px across rows; Pad and Todo titles at matching depth share one x. A Pad adds no inset beyond the shared row rule. Rest, hover, focus and selection move none of these columns. U4707's depth-0 title and U4708's group truncation/count requirements remain.
- **Absent mark (policy).** Audit every `ShelfRow` caller, including `EntryRow` and its callers, Pads, Todos, done summaries and every other Shelf tab, plus rows that pass an absent glyph. When a row has no mark, neither a glyph box nor its column gap reserves space before its content; any separate title/head starts at that row's content edge. Rows with a mark keep the shared mark column. Use one shared spacing rule from existing Tokens, with no per-tab offsets or literal compensation. The implementation PR records the caller inventory and the marked/absent result for each; rendering, not a unit layout assertion, proves this clause.
- **One Open action (policy).** Pad and Todo rows consume one shared component for the existing `arrow-up-right` `IconButton` in `apps/desktop/src/todos/OpenRow.tsx` (`todo-open`), wrapping the existing `apps/desktop/src/ui/IconButton.tsx`; do not copy its markup or invent button behavior. It has the accessible name `copy.openItem(<current item name>)` and the same reveal, focus and hit-area behavior in both lists. It remains separate from selection, rename, completion and drag.
- **Open behavior.** With two differently named Pads, or two differently titled Todos, activate the chosen row's Open button by pointer, then repeat from a fresh state by focusing that button and pressing Enter or Space. Each activation opens only that item's Drawer once through its existing open path; it makes no rename, completion or move call. Assert the button role/name, chosen identity, Drawer and call counts in the planned `u4908_open_button_opens_chosen_item_once` in `apps/desktop/src/shelf/u3789_browser.test.ts`, parameterized by item kind and activation. Use native browser keys for Enter/Space. Keep the existing U3789a selection, Return-to-open, rename and drag observers; a primary row click still selects without opening, and a rename or drag never opens.

Policy — precedence and scope: U4908 adds the Pad Open button and replaces only the conflicting file-icon choice and empty-slot reservation. It preserves U4708's alignment requirements and U4275a's name-only Pad state policy. No contract, RPC, App command, domain term or motion change is required. Pads have no owner; this specification does not restore ownership or promise Workstream-scoped storage.

Policy — rendered observer: compare the same `origin/main` baseline and implementation head in dedicated isolated headless `agent-browser` sessions with fresh profiles, dark, at 1512×950, using U26's harness. Capture both tabs on `tree-40` and `agents-10`, with visible group heads and root/child/grandchild rows where supported, a 120-character Pad name, a 300-character Todo title, a 60-character group name and ten blockers. Include every audited absent-mark path, the add field and done summary where present. Capture rest, hover, keyboard focus, selection and each opened Drawer, plus actionable failure text fully visible on the densest seed. Read `window.__checks()` for matching main/head states. Layout, spacing, icon shape/colour, truncation and reveal are judged by the design critic; add no layout, colour or exact-copy unit/browser test (AGENTS.md rule 10).

Run `just capture U4908` in the implementation run. Leave paired PNGs, interaction video and Check readings under `artifacts/ux/U4908/{base,head}/`, following `.agents/data/harness.md`, **Captures**; record the baseline/head SHAs and seed/state with each pair. Commit no image or video. The spec PR claims no rendered implementation result. Linux/Chromium observes the webview; the user reports what they meet on the Mac.

The implementation moves these Checks, held on main by `docs/design-system.md`, **The checks**, and breaks none passing on its paired main baseline:

1. D2: existing Token type/space steps govern row spacing and the shared action.
2. D5: Pad marks and names meet their glyph/text contrast thresholds.
3. D6: row, chevron and Open controls retain keyboard reachability, feedback and at least 24px hit height.
4. D12: marked columns and title edges align within 1 CSS px after tree indentation.

Specification validation: `loop/rules.sh vocab` and `loop/rules.sh scenario-ids` exit 0. The specification Issue closes only when this acceptance is merged; Issue #4708 remains open, blocked by #4908 until then, for implementation and paired rendered evidence.
