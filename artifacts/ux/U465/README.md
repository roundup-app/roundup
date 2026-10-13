# U465 Shelf heads

Baseline: main `111b4b790c21e2be5838bde132143ef43adcc0a5`. `base/` renders main's Shelf; `head/` renders the shared icon heads.

80 base/head pairs cover `agents-10`, `tree-40` and `empty-project`, light/dark, 1280×800/1440×800, and 240/320 px Shelf widths. Both selections, keyboard focus and the rejected Todo add are captured. All D1–D14 and D16 readings pass on both sides; `loop/rules.sh delta` reports no regression.

| Before | After |
| --- | --- |
| [Plain tabs](base/tree-40-1280-light-240-todos.png) | [Shared heads](head/tree-40-1280-light-240-todos.png) |
| [Keyboard focus](base/tree-40-1280-dark-240-focus.png) | [Keyboard focus](head/tree-40-1280-dark-240-focus.png) |
| [Rejected add](base/tree-40-1280-light-240-failure.png) | [Visible failure](head/tree-40-1280-light-240-failure.png) |
