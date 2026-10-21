# UI: the Project tab is a box on a ruled header (U440 to U443)

Module: `apps/desktop` (the webview: `apps/desktop/src/header/` and the header rules in `apps/desktop/src/styles.css`). Ids: U440 to U443.

Webview only: no App command, no Daemon method, no `contracts/` file; U441 alone authorizes the scoped Token contract below under U4, after independent Contract review. Every colour is a Token in `apps/desktop/src/tokens.css` and every size a space step. Found by the user's report #1093 (2026-10-12): "The project tabs is too undesigned and hover state and icon alignment is broken - also the thing need a border", and "the tab horizontal notification indicator should match that simple small properly placed blue indicator" (Solo's dot). The user picked boxed tabs and a line under the header together, and kept red and amber over one blue dot. Narrows U179 (its "no box, border, background or underline"), U180 and U182; overturns U398 and the Tab mark clause of U401. Chromium shows the webview against the fake App (as U131 does), so the observer is a rendered page. `GLOSSARY.md`'s **Tab mark** changes with this specification.

Seen on `main`: the hover touches the name because the name is a `quiet` button with no inline pad (`--button-inline: 0`, `apps/desktop/src/buttons.css`); the hover covers the name only and the × gets its own square because the tab is two buttons (`header/ProjectTab.tsx`); the × and the `+` sit off the name's line because `.header`, `.strip`, `.tablist` and `.project-tab` align on `baseline` (`header/strip.styles.css`, `apps/desktop/src/styles.css`) and the × is a 24 px `icon` button.

**U440 a Project tab is one box on one centre line.** Given the strip with one, two and eight open Projects (U26 seeds `first-run`, `agents-10`, `tree-40`), light and dark for non-capture observers (captures and critic Check readings use dark only, U3725), at 1280 by 820 and 1280 by 800, then:

- **One box.** Each tab is one element with a 1 px `--hairline` border, whose name, Tab mark and × are all inside it, with an inset of a space step on each side, so the name never touches the border. The tab's name and × are not separate hover surfaces. Test: `u440_a_tab_is_one_bordered_box`.
- **No icon.** A tab holds no folder or editor icon (those are the Rail rows', #1098). Test: `u440_a_tab_has_no_project_icon`.

**U441 hover and selection colour the whole box.** Given the strip with three Projects, then:

- **Hover.** Hovering anywhere in a tab, × included, sets `--hover` on the whole unselected box or `--selected-hover` on the whole selected box and keeps the inset; the × keeps its own hover colour inside the box. Test: `u441_hover_colours_the_whole_box`.
- **Selected.** The open Project's tab has a lighter ground than the others (`--selected`, `--selected-hover` under hover) and stays in full ink; the others stay `--grey` (U179). Every tab border keeps at least 3:1 against the painted header ground (WCAG 1.4.11 component boundary); selected grounds have no 3:1 requirement against the header. Unselected `--grey` text and selected `--text`, including ×, keep at least 4.5:1 against their own painted grounds in light and dark (U4). The border threshold is additional to D5; selection is conveyed by the lighter ground and full ink, not surface contrast against the header. Test: `u441_selected_ground_is_lighter_and_keeps_contrast`.
- **Light header.** The light header uses root `--sunken` (`#f5f5f7`) or root `--ground` (`#ffffff`), never a darker backdrop. Tab borders carry the component boundary. Test: `u441_light_header_keeps_root_ground`.
- **Quiet dark selection.** Dark selected rest, hover and pressed grounds are lighter than the header but their composed luminance does not exceed the Rail's selected row in the corresponding rest, hover or pressed state, excluding its accent bar. Selected text keeps ≥4.5:1 in each state. Test: `u441_dark_selection_is_no_brighter_than_the_rail`.
- **Inset ships with paint.** Any PR that paints a tab ground also implements U440's name inset: the name button (or its replacement rename field) has exactly `--space-1` inline padding on both sides, at rest, hover, selection, press and rename, with the name never touching the box edge. It cannot defer that inset to another PR. Test: `u441_painted_names_keep_both_insets`.

U441 Token and surface contract (policy, under U4). All colour literals remain in `apps/desktop/src/tokens.css`; header rules and button hooks read Tokens. Root values outside the header remain unchanged. The following scoped values replace the no-Token-change restriction only for this contract; selecting `--ground` instead of `--selected` is not an implementation alternative. The table chooses root `--sunken` for the light header; root `--ground` is also permitted by the Light header clause with all contrast readings recomputed. The name inset above is the only U440 geometry required in the Token implementation PR.

| Token / scope | Light | Dark |
|---|---|---|
| `--ground`, header backdrop and bare header controls | root `--sunken`: `#f5f5f7` | root `--ground`: `#1c1c1e` |
| `--sunken`, unselected tab base | root `#f5f5f7` | root `#141416` |
| `--selected`, tab selected base | `#ffffff` | `#2b2b2d` |
| `--selected-hover`, tab selected under pointer | `#fafafa` | `#323234` |
| `--hairline`, header rule and tab borders | opaque `#68686d` | opaque `#8e8e93` |
| `--text`, header and tabs | root `#1d1d1f` | root `#f5f5f7` |
| `--grey` / `--disabled`, bare header controls | root `#68686d` / `#6f6f74` | root `#a1a1a6` / `#8e8e93` |
| `--grey`, unselected tabs | root `#68686d` | root `#a1a1a6` |
| `--disabled`, tab controls | `--text` | `--text` |
| `--accent`, header and tab focus rings | root `#0a60d8` | root `#4d9bff` |
| `--red` / `--amber`, header Ink and Tab marks, including overflow | root `#c4262e` / `#975900` | root `#ff6b6b` / `#f0a030` |
| `--hover` / `--pressed`, bare header controls | root values | root values |
| `--hover` / `--pressed`, unselected tab and its × | root values | root values |
| `--hover`, × inside selected hovered box | `rgba(0,0,0,.04)` | root `rgba(255,255,255,.06)` |
| `--pressed`, selected tab controls | opaque `#f8f8f8` | opaque `#38383a` |

The scope is by painted surface, not unrestricted inheritance (policy). Selected name and × both read `--text`; unselected names and × read `--grey` at rest and `--text` on hover or press. Disabled bare-header controls retain their rest ground (no hover or pressed wash). The `+`, header words, failure/reopen words and their controls use the bare-header column. Overflow caps use the unselected tab base, text and dot values, not the header backdrop. Rename fields use their tab's painted ground and `--text`. Tooltips and close dialogs retain root `--sunken`, text, Ink, hover, pressed, disabled and focus Tokens; header overrides must not leak into these or into the Rail, Shelf, panes or Drawer. The implementation enumerates every affected caller, including shared button hooks and Token observers, in its Contract review. D3 (`docs/design-system.md:127`) keeps root `--red`, `--amber` and `--accent`; D8 (`docs/design-system.md:132`) resolves scoped `--hairline` at the measured element; their hue/Kind and border restrictions remain unchanged. D1 accepts scoped Token definitions only from the Token file and still rejects colour literals in every caller, including custom-property overrides; it must not exempt all rules matching a header selector. `u441_token_observers_resolve_the_surface` asserts the legitimate scoped colours pass and an off-Token saturated colour, a non-hairline border and a colour literal in a caller each fail their Check.

Paint from bottom to top (policy): opaque header `--ground`; opaque tab `--sunken` or opaque `--selected`; on an unselected hovered tab one `--hover` wash, or on a selected hovered tab replacement by opaque `--selected-hover`; the ×'s own hover wash above that base; text/dot and the opaque `--hairline` border last. A name button contributes no second alpha wash; its selected hover can repeat the opaque `--selected-hover` surface. Pressed controls replace their local hover with `--pressed` over the current box. A transparent descendant exposes the composed parent, never an assumed root ground. The header rule is opaque `--hairline` against the header above and the unchanged pane/Rail ground below. Keyboard focus rings (U2770, `ui-pointer-focus.md`) are measured against every surface they touch. Pointer-pressed fixtures do not require a ring; focus-ring contrast is judged in keyboard mode. Hover and pressed paints differ, and pressed paint is immediate (D7, `docs/design-system.md:131`); `u441_token_surfaces_keep_contrast` asserts the distinct resolved paints and zero duration as well as contrast.

Feasibility readings, using the sRGB luminance calculation in `apps/desktop/src/testing/contrast.ts` on these resolved colours (rounded here, never in threshold assertions):

| Comparison | Light | Dark |
|---|---:|---:|
| hairline / header | 5.089 | 5.218 |
| hairline / selected-hover | 5.309 | 3.924 |
| selected text / selected-hover | 16.124 | 11.750 |
| unselected grey / sunken | 5.089 | 7.153 |
| bare-header disabled / header | 4.590 | 5.218 |
| red dot / selected-hover | 5.491 | 4.610 |
| amber dot / selected-hover | 5.373 | 5.956 |

Selected/header contrast is deliberately not a threshold. For the dark Rail's root washes over `#141416`, composed channels are `(43.5,43.5,45.3)` at rest, `(50.55,50.55,52.29)` under hover and `(57.6,57.6,59.28)` pressed. The corresponding tab grounds `(43,43,45)`, `(50,50,52)` and `(56,56,58)` are each lighter than the header and no brighter than that Rail state (policy).

Selected pressed feasibility uses the opaque Token channels directly: light `(248,248,248)`, dark `(56,56,58)`. For each channel `c`, normalize `v=c/255`, then linearize with `v/12.92` when `v≤0.03928`, otherwise `((v+0.055)/1.055)^2.4`; luminance is `0.2126R+0.7152G+0.0722B`, and contrast is `(max(L1,L2)+0.05)/(min(L1,L2)+0.05)`. No channel or intermediate value is rounded. The following displayed ratios alone are rounded.

| Selected pressed comparison | Light | Dark |
|---|---:|---:|
| hairline / pressed | 5.218 | 3.588 |
| text / pressed | 15.847 | 10.745 |
| red dot / pressed | 5.397 | 4.216 |
| amber dot / pressed | 5.280 | 5.447 |
| focus / pressed | 5.377 | 4.150 |

HSL saturation is `(max−min)/(1−abs(2L−1))`, with channels normalized by 255 and `L=(max+min)/2`; equal channels give zero. The selected pressed Tokens have saturation 0% light and 1.754386% dark, both ≤15%. They differ from selected rest (`#ffffff` / `#2b2b2d`) and selected hover (`#fafafa` / `#323234`). D3's saturation/Kind rule (`docs/design-system.md:127`) remains unchanged; no selected-control exemption is permitted (policy).

Acceptance for the Token implementation:

- **Compositing.** `u441_token_surfaces_keep_contrast` reads the actual Token file and computed header/tab styles in Chromium, in light/dark with normal/more contrast, for unselected, hovered, selected, selected-hovered, ×-hovered, pressed, disabled and renamed tabs. It resolves variables and composites each alpha layer channel-by-channel in paint order before luminance, with no channel rounding before assertions. It asserts each border versus header and adjacent tab ≥3, every text/disabled label versus its own ground ≥4.5, both dots and every focus ring versus their touching grounds ≥3. It asserts selected and selected-hovered luminance exceeds both unselected rest and hovered luminance. The fixture includes +, overflow caps, rename, reopen/failure text, tooltip and close dialog, so inherited Token leakage fails. Comparing Token strings alone does not pass.
- **Scope.** `u441_token_scope_keeps_other_surfaces` measures the Rail, Shelf, pane, Drawer, tooltip and close dialog before/after the scoped contract, in both schemes and contrast preferences, and asserts their resolved Tokens and painted colours are unchanged. `prefers-contrast: more` does not replace the scoped opaque hairline with the root alpha hairline; every scoped `--grey` becomes its local `--text` as U135 prescribes; the same test asserts both media overrides.
- **Selected press regression.** `u441_selected_press_keeps_baseline_checks` uses the rendered regression fixtures, viewports and contrast preferences above, in dark only for Check readings and captures (U3725), with the same Kind contents before/after the scoped contract. Token computations and behavioral press assertions retain light/dark coverage. It presses the selected name and selected × separately by pointer (`pointerdown`, held before release) and keyboard (Space held before keyup, and Enter activation), taking `window.__checks()` readings while the control is pressed, before selection or close removes the observed state. D3 (`docs/design-system.md:127`), D10 (`docs/design-system.md:134`) and every other Check passing in the matching baseline remain passing in each case. It measures each resolved pressed paint's HSL saturation ≤15%, distinction from selected rest and its local hover paint, and immediate application with zero duration under D7 (`docs/design-system.md:131`); `u441_token_surfaces_keep_contrast` also asserts every pressed text, dot, focus and border threshold above. Root red/amber/accent and their Kind restriction remain unchanged. Readings and resolved paints are published with the implementation captures for the PR head (L112).
- **Behaviour.** `u441_token_change_keeps_header_behaviour` runs the existing `u179_` through `u186_` tests unchanged by this Token prerequisite and measures unchanged interactions and rectangles except the required name inset. `u441_painted_names_keep_both_insets` measures the two computed inline paddings and the text's clearance from each box edge in the same fixtures. Remaining U440 geometry, U442's header rule geometry and U443's dot shape, precedence and accessible name remain the dependent implementation's acceptance; the Token implementation changes only the required name inset among these geometry clauses.

Dependency policy: this specification closes only #1485 after its specification acceptance passes; #1241 retains runtime Tokens, callers, observers, captures and the required U440 name inset. #1093 retains complete U440–U443 acceptance and remains open until it passes. Independent Contract approval remains required. This specification merges before #1241 rebuilds from #1283's head; the Token implementation merges before #1093 resumes. A Token fixture does not complete boxed tabs. Every affected caller changes in the implementation PR; this specification delivers no runtime change (policy).

Specification observer (policy): `rules` and `check` pass on the specification PR's head. Recompute the table's ratios with the unrounded sRGB formula above; every border/header ratio is ≥3 and every text/own-ground ratio is ≥4.5, including composed hover, × hover and pressed states. The light header is `#f5f5f7` or lighter. The three critic findings on #1283 map respectively to **Light header**, **Inset ships with paint**, and **Quiet dark selection** plus **Root Ink**; each forbids the reported outcome. Named Chromium tests are implementation acceptance owned by #1241, not evidence delivered by this specification.

**U442 a hairline runs under the whole header.** Given the App with a Rail and panes, then a 1 px `--hairline` rule runs along the header's bottom edge across its full width, with the tabs' bottoms on it, and it separates the header from the Rail and the panes; with no Project open (U2) it still runs under the `+`. Tests: `u442_a_hairline_runs_under_the_header`, `u442_the_rule_shows_with_no_project`.

**U443 the Tab mark is a small dot after the name.** Replaces U180's characters and U398. Given Projects whose Agents are in Kind `error`, `needs-you`, both, `working` and none, then:

- **Kept.** `error` over `needs-you`, an exited Daemon as `error` (U185), the count never shown (U180), the accessible names `error` and `needs you`, and the click (U184) all hold. Test: `u443_the_mark_keeps_its_rule_name_and_click`.
- **Contrast.** The dot keeps 3:1 against the tab's ground, selected or not, in light and dark. Test: `u443_the_dot_keeps_contrast`.

Tests (`u440_` to `u443_`) live in `apps/desktop/src/header/`; the U179, U180, U182 and U398 tests that read `◉`, `⊗`, `KindGlyph` or "no border or background" change in the implementing PR, which names each.
