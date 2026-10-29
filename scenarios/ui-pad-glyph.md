# UI: Pad icon and group-head columns

Module: `apps/desktop` (webview). Acceptance for Issue #4708, Decisions 2 and 3 of the Pad "Todo list design". It builds on U4707's 32px inset (`scenarios/ui-row-inset.md`) and replaces its clause that Pad rows leave no glyph column. It serves the first journey's Review stage: Pad and Todo titles share one x, and a group head reads as part of the same column grid.

**U4708 Pad rows carry the Pad icon and group heads align to the row columns.** Policy (rendered acceptance, design-critic observer): given the Shelf's `Todos` and `Pads` lists on `tree-40` and `agents-10`, with root, child, grandchild and great-grandchild rows (depths 0–3), a 300-character Todo title, a 120-character Pad name, ten blockers and a 60-character group name, when reading them dark at 1280×820 and 1512×950, then:

- **Pad icon.** Each Pad row draws, in the glyph slot, the file icon the `PADS` tab uses (one shared icon component, not a copy), in the muted text colour. The icon is not a state: a Pad row gains no state glyph, badge or colour (U4275a), and its open, rename and drag paths are unchanged.
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
