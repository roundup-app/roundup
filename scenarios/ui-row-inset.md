# UI: one 32px row inset

Module: `apps/desktop` (webview). Acceptance for Issue #4707, Decision 1 of the Pad "Todo list design". It narrows U131's row inset (`scenarios/ui-visual.md`, **U131 type and space**) and U4335a's indent (`scenarios/ui-rows-state.md`). It serves the first journey's Review stage: a Todo or Pad title sits one step from the panel edge, in the column the Rail and Terminal tabs already use.

**U4707 rows share a 32px text inset.** Policy (rendered acceptance, design-critic observer): given the Rail, the Terminal tab bar and the Shelf's `Todos` and `Pads` lists on `tree-40` and `agents-10`, with root, child, grandchild and great-grandchild rows (depths 0–3), a 300-character Todo title, a 120-character Pad name, ten blockers and a 60-character group name, when reading them dark at 1280×820 and 1512×950, then:

- **Token.** `--row-text-inset` in `apps/desktop/src/tokens.css` is 32px in both schemes. No stylesheet or component keeps a copy of the old 56px value or a literal derived from it; each consumer (`rail/`, `shelf/`, `todos/`, `pads/`, the Terminal tab bar) reads the Token. Add no literal.
- **Elbows.** `--tree-origin` still derives from the Token. At every depth, each child's dashed elbow connects to its actual parent's glyph centre, as U4335a requires.
- **Shared x.** At each depth, in the Rail, Terminal tabs and both Drawer lists, glyphs and group chevrons share one x, and titles and group names share one x, each within 1 CSS px. Sibling rows share these columns; hover, focus and selection move none of them.
- **Depth-0 title.** A depth-0 Todo or Pad title starts 48 CSS px from the panel edge within 1 px (16 panel padding + 8 row padding + 16 glyph column + 8 gap). Pad rows draw the Pad icon in the glyph slot (U4708).
- **Rows.** Row border-box heights differ by at most 1 CSS px. Each row is one line; a long title or name is cut with `…`. The tick stays after the title in `.row-controls`; the persistent grip, open arrow, dependency elbows, live updates and 32px rows on a 24px line are unchanged.

Policy: priority and other meta chips stay in the opened Todo's meta row, not the list row; Solo's header, body excerpts and tags are out of scope. No contract, App command or Daemon change.

Observer (policy): U26's harness in an isolated headless `agent-browser` session with a fresh profile, dark, at both viewports above. Run `just capture U4707` and leave the Rail, Terminal tab bar, Todos and Pads at depths 0–3 under `artifacts/ux/U4707/`, following `.agents/data/harness.md`, **Captures**; commit no image or video. Read `window.__checks()` on the densest seed and measure the depth-0 title x there. The Linux/Chromium observer makes no native Mac claim; the user reports what they meet on the Mac.

The implementing change moves these Checks, held by `docs/design-system.md`, **The checks**, and breaks none passing on main:

1. D2: spacing uses existing Tokens only.
2. D5: title and glyph contrast pass.
3. D6: tick, title and open actions keep their hit areas.
4. D12: glyph and title x align within 1 px after tree indent.

Regression (policy): keep and adjust to 32px these observers, naming U4707: the row-inset reading in `apps/desktop/src/testing/designChecks.ts` (it reads the Token, so it follows), the design critic's dense-row observer (U4335a's elbow and glyph-column readings; policy), and U4313's `u4313a_bar_plus_opens_once_and_focuses` and `u4313a_empty_terminal_bar_keeps_new_terminal_available` in `apps/desktop/src/bubbles/u4274_navigation.test.tsx`. Update the `--row-text-inset` row of `docs/design-system.md` and `apps/desktop/observers/U131/row-inset.md`'s stated value. The critic judges geometry; add no layout, colour or exact-copy test (AGENTS.md rule 10).

Specification validation: `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. Issue #4707 stays open for implementation.
