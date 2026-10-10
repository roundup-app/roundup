# U193 rendered observer

Headless agent-browser on `just harness` (`tree-40`): select `backend`, type `one⏎two⏎three` into the Thread's input (a `textarea`, 45 px tall at three lines), at 1280×800 and 700×800. `three-lines-*.png` are the captures; `*.checks.json` are the `window.__checks()` readings.

The raw reading fails D6 on the `input` selector: the todos shelf's 13 px radio inputs, which `main` has too (see `artifacts/ux/U187/README.md`). `three-lines-scoped-*` repeat it with those inputs removed from the DOM: D1 to D10 pass at both viewports.

`growth-*x800.json` read `getComputedStyle` on the same `textarea` at 1, 3 and 20 lines (1280×800 and 700×800): 24 px, 45 px, then 160 px (the `max-height` cap) with `scrollHeight` 300 px, so the field stops at the cap and scrolls. The jsdom test `u193_the_field_grows_to_a_cap_then_scrolls` only proves `fit()` copies `scrollHeight` and the stylesheet holds the cap.
