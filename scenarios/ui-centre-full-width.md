# UI: The centre fills its width

Acceptance for #2340, from the user's report at the one supported size (1512×950). Module: `apps/desktop/src/` (`styles.css`, `terminal/`, `resources/`, `shelf/`). Webview only: no App command, no Daemon method, nothing under `contracts/` and no Token changes. Narrows U371 (the overlay Shelf's centre), U408, U444 and U469 (the bar's height, width and wrapping), U449's `Show work items` place, U13 and U349 (the failure notice's height); every other clause of those stays.

Observer: `u2340a_checks_hold_on_the_densest_seed` reads `window.__checks()` in the U26 harness at 1512×950. Checks moved: D2, D5 and D6 hold on the densest seed with failure text visible, and no Check passing on `main` regresses.

## Retired

U2340's implementation deletes these clauses and tests under rule 10, migrating none:

- The trailing lane: U449's rule that `Show work items` sits at the trailing edge of the content below the bar, outside the centre, and the test `u449_show_shelf_never_covers_a_centre_card_or_pinned_bar` in `apps/desktop/src/header/u449_rendered.test.ts`; U371's CSS-comment promise that an overlay Shelf keeps the lane while open. The U371 overlay fallback itself (scrim, Escape, unchanged centre box) stays.
- The two-row bar: U444's and U469's reservation of two rows (`2 × --space-5`), the `--measure` cap, the narrow-width wrap rules (`@container resources (width < 38rem)`), and the overlay-Shelf `--measure` offset on `.resource-strip`; the narrow-centre acceptance in `u408_strip.test.tsx` and `u469_open_shelf_leaves_every_resource_value_visible` in `apps/desktop/src/bubbles/u469_bar.test.ts`.
- The reserved failure height: U13's and U349's `min-height: 1.5em` band and any test asserting it.

Policy: this PR adds acceptance only; the implementation is the dependent Issue, blocked by #2340. Run all existing tests of the changed files, preserving every unaffected assertion.
