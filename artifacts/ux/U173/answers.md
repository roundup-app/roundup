# U173 answers

Captured on `just harness` in `agent-browser`, `agents-10` and `tree-40`, light and dark, at 1280 by 800 (`before-` from `main`, `after-` from this head) and `tree-40` at 700 by 800. `__checks()` gives D1 to D11 `pass` on both seeds in both schemes at both widths, with no horizontal scroll in the Rail.

1. Yes. Dark: the Rail and the Shelf are `--sunken` dark (`after-tree-40-1280-dark.png`); a 1 px `--hairline` sits over each Workstream row but the first and under each group head's rule.
2. Yes. `tree-40`: `BA backend ⌄ ✓ 3`: badge 24 px square, bold name with ellipsis, chevron, quiet value at the trailing edge. On hover or selection of a Door's Workstream the `start Door` action takes the value's place, whole, and the name gives way (selected `first workstream`: row 223 px, badge 24, name 41 px clipped with `…`, action 90).
3. Yes. `▾ WORKSTREAMS ── 3/3` (rule 66 px), `▾ TODOS ── 7/7` (rule 19 px), `▾ PADS ── 2/4` (rule 26 px) at 1280; the rule is 92 to 114 px at 700. The label is never cut (`scrollWidth` equals `clientWidth`).
4. Yes. Todo rows: dot, bold title, grey `--text-caption` description clamped to two lines; no hint is drawn (U172).
5. Yes. Rows are 28 px at rest, hover and selected; the blocks are `--space-3` apart; D2 passes.
6. Yes. The selected row has the `--selected` band with a 2 px `--accent` bar as a background gradient and no border; the badge is `--space-1` clear of the bar.
7. Yes. D6 and D7 pass; every sidebar button carries `data-button` (U170).

NOTE: the whole reads tasteful: it spends its space on hierarchy. What most spoils it is a selected Door Workstream row at 252 px, which leaves its name about 41 px.
