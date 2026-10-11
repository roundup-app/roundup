# U173 readings (author's capture, light and dark schemes, headless Chromium on `just harness`)

Captures: `before-` (`origin/main`) and `after-<seed>-1280-<scheme>.png` for `tree-40` and `agents-10` in light and dark, plus `after-tree-40-700-light.png`; boxes: `measure.json` (rail width, each Workstream row's height, overflow, overlap and clipped children).

1. Surfaces and borders: `--sunken` Rail and Shelf, one `--hairline` between Workstream blocks and as each group head's rule. Dark captures use the same tokens: the Rail and Shelf sit on `--sunken`, the head rule is `--hairline`.
2. Workstream row: badge, bold name, chevron, quiet value; every row 28 px, no overflow, no overlap (`measure.json`, `tree-40` at 1280 and 700).
3. Group head: the `todos` label reads in full at the Shelf's width (`.group-toggle` no longer shrinks; the rule gives way; `scrollWidth <= clientWidth` on both Shelf labels); 16 px mark, uppercase spaced label, rule, count, on the Rail (`workstreams`) and the Shelf (`todos`, `pads`).
4. Item: dot, bold title, grey two-line description (Todo rows); no key hint.
5. Spacing: `--space-3` between blocks; rows stay 28 px (U131), so the vertical padding of U172's Density clause is carried by that space, not by row padding.
6. One mark: `--selected` band with a 2 px `--accent` bar as a background.
7. Buttons: every one carries `data-button` (U170, U171 tests green).
8. NOTE: a selected Workstream row with its Door exited shows the Door action cut to its mark and a short Live line; it fits, but it is the densest row of the Rail.
