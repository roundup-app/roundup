# UI: the Project tab is a box on a ruled header (U440 to U443)

Module: `apps/desktop` (the webview: `apps/desktop/src/header/` and the header rules in `apps/desktop/src/styles.css`). Ids: U440 to U443.

Webview only: no App command, no Daemon method, no `contracts/` file; U441 alone authorizes the scoped Token contract below under U4, after independent Contract review. Every colour is a Token in `apps/desktop/src/tokens.css` and every size a space step. Found by the user's report #1093 (2026-10-12): "The project tabs is too undesigned and hover state and icon alignment is broken - also the thing need a border", and "the tab horizontal notification indicator should match that simple small properly placed blue indicator" (Solo's dot). The user picked boxed tabs and a line under the header together, and kept red and amber over one blue dot. Narrows U179 (its "no box, border, background or underline"), U180 and U182; overturns U398 and the Tab mark clause of U401. Chromium shows the webview against the fake App (as U131 does), so the observer is a rendered page. `GLOSSARY.md`'s **Tab mark** changes with this specification.

Seen on `main`: the hover touches the name because the name is a `quiet` button with no inline pad (`--button-inline: 0`, `apps/desktop/src/buttons.css`); the hover covers the name only and the × gets its own square because the tab is two buttons (`header/ProjectTab.tsx`); the × and the `+` sit off the name's line because `.header`, `.strip`, `.tablist` and `.project-tab` align on `baseline` (`header/strip.styles.css`, `apps/desktop/src/styles.css`) and the × is a 24 px `icon` button.

**U440 a Project tab is one box on one centre line.** Given the strip with one, two and eight open Projects (U26 seeds `first-run`, `agents-10`, `tree-40`), light and dark, at 1280 by 820 and 700 by 800, then:

- **One box.** Each tab is one element with a 1 px `--hairline` border, whose name, Tab mark and × are all inside it, with an inset of a space step on each side, so the name never touches the border. The tab's name and × are not separate hover surfaces. Test: `u440_a_tab_is_one_bordered_box`.
- **One centre line.** The name, the × and the `+` have vertical centres within 1 px of the tab's centre; no strip, header or tab rule aligns on `baseline`. The `+` sits on the same centre line as the tabs. Test: `u440_name_close_and_plus_share_a_centre_line`.
- **No icon.** A tab holds no folder or editor icon (those are the Rail rows', #1098). Test: `u440_a_tab_has_no_project_icon`.
- **Unmoved.** The tab's hit height stays 24 px or more, U382's clip and tail, U184's overflow edges and U183's rename field fit inside the box. Test: `u440_clip_overflow_and_rename_fit_the_box`.

**U441 hover and selection colour the whole box.** Given the strip with three Projects, then:

- **Hover.** Hovering anywhere in a tab, × included, sets `--hover` on the whole unselected box or `--selected-hover` on the whole selected box and keeps the inset; the × keeps its own hover colour inside the box. Test: `u441_hover_colours_the_whole_box`.
- **Selected.** The open Project's tab has a lighter ground than the others (`--selected`, `--selected-hover` under hover) and stays in full ink; the others stay `--grey` (U179). The selected ground (at rest and under hover) and every tab border keep at least 3:1 against the painted header ground. Unselected `--grey` text and selected `--text`, including ×, keep at least 4.5:1 against their own painted grounds in light and dark (U4). These 3:1 surface and border thresholds are U441 requirements in addition to D5; neither is waived. Test: `u441_selected_ground_is_lighter_and_keeps_contrast`.
- **U112.** Hovering or selecting a tab moves no other tab: every tab's `getBoundingClientRect` is unchanged. Test: `u441_hover_and_selection_move_no_other_tab`.

U441 Token and surface contract (policy, under U4). All colour literals remain in `apps/desktop/src/tokens.css`; header rules and button hooks read Tokens. Root values outside the header remain unchanged. The following scoped values replace the no-Token-change restriction only for this contract; selecting `--ground` instead of `--selected` is not an implementation alternative. The light header must change: white cannot have a lighter selected surface at 3:1. No geometry change belongs to this prerequisite.

| Token / scope | Light | Dark |
|---|---|---|
| `--ground`, header backdrop and bare header controls | `#808080` | `#1c1c1e` |
| `--sunken`, unselected tab base | `#f5f5f7` | `#141416` |
| `--selected`, tab selected base | `#ffffff` | `#68686c` |
| `--selected-hover`, tab selected under pointer | `#fafafa` | `#707074` |
| `--hairline`, header rule and tab borders | `#000000` | `#d8d8dc` |
| `--text`, header and tabs | `#000000` | `#f5f5f7` |
| `--grey` / `--disabled`, bare header controls | `#000000` | `#a1a1a6` / `#8e8e93` |
| `--grey`, unselected tabs | `#68686d` | `#a1a1a6` |
| `--disabled`, tab controls | `#000000` | `#f5f5f7` |
| `--accent`, header and tab focus rings | `#000000` | `#ffffff` |
| `--red` / `--amber`, bare header Ink text | `#390000` / `#201000` | root values |
| `--red` / `--amber`, Tab mark only, including overflow marks | `#c4262e` / `#975900` | `#ffc0c0` / `#ffd080` |
| `--hover` / `--pressed`, bare header controls | opaque `#888888` / `#888888` | opaque `#29292b` / `#29292b` |
| `--hover` / `--pressed`, unselected tab and its × | root values | root values |
| `--hover`, × inside selected hovered box | `rgba(0,0,0,.04)` | `rgba(0,0,0,.04)` |
| `--pressed`, selected tab controls | `--selected-hover` | `--selected-hover` |

The scope is by painted surface, not unrestricted inheritance (policy). Selected name and × both read `--text`; unselected names read `--grey` at rest and `--text` on hover. The `+`, header words, failure/reopen words and their controls use the bare-header column. Overflow caps use the unselected tab base, text and dot values, not the header backdrop. Rename fields use their tab's painted ground and `--text`. Tooltips and close dialogs retain root `--sunken`, text, Ink, hover, pressed, disabled and focus Tokens; header overrides must not leak into these or into the Rail, Shelf, panes or Drawer. The implementation enumerates every affected caller, including shared button hooks and Token observers, in its Contract review. D3 (`docs/design-system.md:127`) and D8 resolve `--red`, `--amber`, `--accent` and `--hairline` at the measured element rather than assuming the root values; their hue/Kind and border restrictions remain unchanged. D1 accepts scoped Token definitions only from the Token file and still rejects colour literals in every caller, including custom-property overrides; it must not exempt all rules matching a header selector. `u441_token_observers_resolve_the_surface` asserts the legitimate scoped colours pass and an off-Token saturated colour, a non-hairline border and a colour literal in a caller each fail their Check.

Paint from bottom to top (policy): opaque header `--ground`; opaque tab `--sunken` or opaque `--selected`; on an unselected hovered tab one `--hover` wash, or on a selected hovered tab replacement by opaque `--selected-hover`; the ×'s own hover wash above that base; text/dot and the opaque `--hairline` border last. A name button contributes no second wash. Pressed controls replace their local hover with `--pressed` over the current box. A transparent descendant exposes the composed parent, never an assumed root ground. The header rule is opaque `--hairline` against the header above and the unchanged pane/Rail ground below. Focus rings are measured against every surface they touch.

Feasibility readings, using the sRGB luminance calculation in `apps/desktop/src/testing/contrast.ts` on these resolved colours (rounded here, never in threshold assertions):

| Comparison | Light | Dark |
|---|---:|---:|
| selected / header | 3.949 | 3.067 |
| selected-hover / header | 3.784 | 3.451 |
| hairline / header | 5.317 | 11.972 |
| hairline / selected-hover | 20.119 | 3.469 |
| selected text / selected-hover | 20.119 | 4.529 |
| unselected grey / sunken | 5.089 | 7.153 |
| red dot / selected-hover | 5.491 | 3.182 |
| amber dot / selected-hover | 5.373 | 3.425 |

Acceptance for the Token implementation:

- **Compositing.** `u441_token_surfaces_keep_contrast` reads the actual Token file and computed header/tab styles in Chromium, in light/dark with normal/more contrast, for unselected, hovered, selected, selected-hovered, ×-hovered, pressed, disabled and renamed tabs. It resolves variables and composites each alpha layer channel-by-channel in paint order before luminance, with no channel rounding before assertions. It asserts selected/selected-hovered box versus header ≥3, each border versus header and adjacent tab ≥3, every text/disabled label versus its own ground ≥4.5, both dots and every focus ring versus their touching grounds ≥3. It asserts selected and selected-hovered luminance exceeds both unselected rest and hovered luminance. The fixture includes +, overflow caps, rename, reopen/failure text, tooltip and close dialog, so inherited Token leakage fails. Comparing Token strings alone does not pass.
- **Scope.** `u441_token_scope_keeps_other_surfaces` measures the Rail, Shelf, pane, Drawer, tooltip and close dialog before/after the scoped contract, in both schemes and contrast preferences, and asserts their resolved Tokens and painted colours are unchanged. `prefers-contrast: more` does not replace the scoped opaque hairline with the root alpha hairline; every scoped `--grey` becomes its local `--text` as U135 prescribes; the same test asserts both media overrides.
- **Rendered regression.** `u441_token_checks_do_not_regress` renders U26 seeds `first-run`, `agents-10`, `tree-40` and the three-Project fixture at 1280×820 and 700×800, captures the states above and compares `window.__checks()` against the same seeds on main. D1 (`docs/design-system.md:125`), D5 (`docs/design-system.md:129`), D8 (`docs/design-system.md:132`) and D10 (`docs/design-system.md:134`) retain every passing reading; every other passing Check stays passing. D5 governs text/Glyph/focus, while U441 additionally governs decorative surfaces/borders. Captures and resolved colour/layer/ratio rows live in `artifacts/ux/U441/` in the implementation PR.
- **Behaviour.** `u441_token_change_keeps_header_behaviour` runs the existing `u179_` through `u186_` tests unchanged by this Token prerequisite and measures unchanged header/tab rectangles and interactions before/after its styles. U440's geometry, U442's header rule geometry and U443's dot shape, precedence and accessible name remain the dependent implementation's acceptance; the Token prerequisite changes none of them.

Dependency policy: this specification merges before Token implementation; the Token implementation merges before #1093 resumes. #1093 remains open until its complete U440–U443 rendered acceptance passes. A Token fixture does not complete boxed tabs. The Token implementation follows the Contract recipe and updates all affected callers in the same PR; this specification delivers no runtime Token change.

**U442 a hairline runs under the whole header.** Given the App with a Rail and panes, then a 1 px `--hairline` rule runs along the header's bottom edge across its full width, with the tabs' bottoms on it, and it separates the header from the Rail and the panes; with no Project open (U2) it still runs under the `+`. Tests: `u442_a_hairline_runs_under_the_header`, `u442_the_rule_shows_with_no_project`.

**U443 the Tab mark is a small dot after the name.** Replaces U180's characters and U398. Given Projects whose Agents are in Kind `error`, `needs-you`, both, `working` and none, then:

- **Dot.** The mark is a filled circle of `--space-2` just after the name, raised to the top of the name's letters, not on the centre line; `--red` for `error`, `--amber` for `needs-you`, absent otherwise. It is not a Glyph: no `KindGlyph`, ring or character. Test: `u443_the_mark_is_a_small_dot_by_the_name`.
- **Kept.** `error` over `needs-you`, an exited Daemon as `error` (U185), the count never shown (U180), the accessible names `error` and `needs you`, and the click (U184) all hold; the dot adds no width change to other tabs (U441's U112 clause). Test: `u443_the_mark_keeps_its_rule_name_and_click`.
- **Contrast.** The dot keeps 3:1 against the tab's ground, selected or not, in light and dark. Test: `u443_the_dot_keeps_contrast`.

Tests (`u440_` to `u443_`) live in `apps/desktop/src/header/`; the U179, U180, U182 and U398 tests that read `◉`, `⊗`, `KindGlyph` or "no border or background" change in the implementing PR, which names each.
