# U465 Shelf heads

Baseline: main `619bfa2bdcc991e27cdd676f9cfd096b477b5962`. `base/` renders main's Shelf; `head/` renders the shared icon heads.

84 base/head pairs cover `agents-10`, `tree-40` and `empty-project`, light/dark, 1280×800/1440×800, and 240/320 px Shelf widths. Both selections, keyboard focus and the rejected Todo add are captured. Four extra pairs stress 12 and 128 count labels at a 240 px Shelf in both schemes; the rendered observer asserts at least 8 px before the toggle, its right edge at or before 1272 px, and unclipped tab contents. All D1–D14 and D16 readings pass on both sides; `loop/rules.sh delta` reports no regression.

| Before | After |
| --- | --- |
| [Plain tabs](base/tree-40-1280-light-240-todos.png) | [Shared heads](head/tree-40-1280-light-240-todos.png) |
| [Keyboard focus](base/tree-40-1280-dark-240-focus.png) | [Keyboard focus](head/tree-40-1280-dark-240-focus.png) |
| [Rejected add](base/tree-40-1280-light-240-failure.png) | [Visible failure](head/tree-40-1280-light-240-failure.png) |
| [12 counts](base/counts-12-1280-light-240.png) | [12 counts with clearance](head/counts-12-1280-light-240.png) |
| [128 counts](base/counts-128-1280-light-240.png) | [128 counts with clearance](head/counts-128-1280-light-240.png) |
