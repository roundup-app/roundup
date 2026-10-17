# UI: The centre fills its width

Acceptance for #2340, from the user's report at the one supported size (1512×950). Module: `apps/desktop/src/` (`styles.css`, `terminal/`, `resources/`, `shelf/`). Ids: U2340a, U2340b, U2340c, U2340d. Webview only: no App command, no Daemon method, nothing under `contracts/` and no Token changes. Narrows U371 (the overlay Shelf's centre), U408, U444 and U469 (the bar's height, width and wrapping), U449's `Show work items` place, U13 and U349 (the failure notice's height); every other clause of those stays.

The journey stage is Understand (`.agents/data/journey.md`): the Terminal, the bar under it and the Shelf's button line up, with no empty band.

**U2340a the centre spans its width and the Terminal, bar and corner button line up.** Given an open Project with an Agent selected, at 1512×950 in the U26 harness on the `resources` seed, with the Shelf closed and again with it in overlay mode, then:

- **Width.** The centre has no padding and no inner lane: the Terminal pane (`.pane`) and the bottom bar (`.resource-strip`) each span the centre edge to edge, so each box's left edge and width equal the centre's. Only the Terminal's own text area (`.pane-screen .xterm`) keeps an inset: its left edge is `--space-2` from the centre's, and its right edge is no further than `--space-2` from the centre's right edge. The lane that kept `Show work items` clear of the centre (`calc(100% - var(--space-5) - var(--space-4))`) is gone, in every Shelf state, with a Drawer open or not.
- **Corner button.** `Show work items` floats at the Terminal's top-right corner, over the Terminal: its box lies inside the pane's box, its right edge `--space-2` from the pane's right edge, and its top at the pane's top (the pane now spans the centre). It is the same button, with U370's action and name.
- **Line-up.** The pane's, the bar's and the button's right edges are within 1 px of each other; the pane's and the bar's left edges are within 1 px.

Asserted in `u2340a_the_bar_spans_the_centre_and_the_terminal_text_is_inset_one_space` and `u2340a_the_show_button_floats_at_the_terminals_corner`.

**U2340d the tab row is the Rail footer's row.** Narrows U2340c's height and U2232's rule. Given the bottom bar's tab row (`.terminal-tabs-host`, below the hint line) and the Rail's footer row (`.rail-actions`, which holds `+ Workstream`) at 1512×950 in the same state as U2340a, then the two boxes have the same height (`--rail-actions-height`) and the same top and bottom y, and the bar's rule (`--hairline`, `--rule` high, on the tab row's top edge) has the same colour and thickness as the footer's top border. Asserted in `u2340d_the_tab_row_matches_the_rail_row_in_height_and_border`.

**U2340b a failure takes space only when there is one.** Narrows U13's and U349's notice. Given the pane (`.pane-failure`), then with no failure its box is 0 high, not the `1.5em` band it reserves today; when a failure arrives it shows under the Terminal, the Terminal's box loses exactly those lines, and it covers no part of the Terminal or the bar. Its text still wraps whole, never ellipsised (U349), and it keeps its `max-height` and scroll for a long failure. Clearing the failure returns the Terminal's box. Asserted in `u2340b_no_failure_takes_no_height` and `u2340b_a_failure_shortens_the_terminal_and_covers_nothing`.

**U2340c the bottom bar is one line spanning the Terminal.** Narrows U408's and U444's place and U469's bar. Given the bar at 1512×950 with sixteen tabs, a 60-character name and the densest values (memory `999.9 GB`, CPU `1600%`, disk `12.3 TB`) plus `Not updating`, then the bar's width equals the Terminal's, starting at the centre's leading edge with no leading padding, and its tab row is one line the height of the Rail's footer row (`--rail-actions-height`, U2340d), not two rows. All parts fit on that one line (the tab region scrolls as U469 says) with no wrap, clip or overlap. No `--measure` cap, narrow-width container rule or overlay-Shelf offset remains on the bar. The pane's box is equal with zero tabs, one tab, empty and filled values (U469). Asserted in `u2340c_the_bar_is_one_line_the_terminals_width` and the kept `u469_empty_and_filled_tabs_and_resources_keep_the_pane_rectangle`.

Observer: the U26 harness, isolated headless agent-browser in real WebKit at 1512×950, Shelf closed, in light and dark, reporting each box above; `just capture U2340a U2340b U2340c` captures the design critic's 1512×950 view with the Shelf closed, showing no empty band. Checks moved: D2 (the bar's and the Terminal's spacing steps, the centre's padding now `0`), D5 and D6 (the tab row grows from `--space-5` to the footer's 40 px, so click targets only enlarge) hold on the densest seed with failure text visible, and no Check passing on `main` regresses (`u2340a_checks_hold`, `window.__checks()`).

## Retired

U2340's implementation deletes these clauses and tests under rule 10, migrating none:

- The trailing lane: U449's rule that `Show work items` sits at the trailing edge of the content below the bar, outside the centre, and the test `u449_show_shelf_never_covers_a_centre_card_or_pinned_bar` in `apps/desktop/src/header/u449_rendered.test.ts`; U371's CSS-comment promise that an overlay Shelf keeps the lane while open. The U371 overlay fallback itself (scrim, Escape, unchanged centre box) stays.
- The two-row bar: U444's and U469's reservation of two rows (`2 × --space-5`), the `--measure` cap, the narrow-width wrap rules (`@container resources (width < 38rem)`), and the overlay-Shelf `--measure` offset on `.resource-strip`; the narrow-centre acceptance in `u408_strip.test.tsx` and `u469_open_shelf_leaves_every_resource_value_visible` in `apps/desktop/src/bubbles/u469_bar.test.ts`, whose then-clause the one-line bar of U2340c holds at every supported width.
- The reserved failure height: U13's and U349's `min-height: 1.5em` band and any test asserting it, replaced by U2340b.

Policy: this PR adds acceptance only; the implementation is the dependent Issue, blocked by #2340. Run all existing tests of the changed files, preserving every unaffected assertion.
