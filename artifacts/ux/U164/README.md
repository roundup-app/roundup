# U164 rendered observer

Seed `bubbles` served by `just harness bubbles`, headless agent-browser in a fresh profile. `<case>-<width>-<scheme>-t<transparency>`: case `standard` (the `runner` Agent selected: its running and exited Runs and the Workstream's Terminal, the exited Run folded to its chip) or `densest` (the `dense` Agent: 8 Runs, one named with 60 characters, one with a 200-column line); width 1280 (Shelf open) or 700 (Shelf closed); light or dark; transparency 8 % (default) or 60 %.

- `.png`: the screen. `.checks.json`: the complete `window.__checks()` object. D1, D2, D5, D6 and D8 pass on all 16.
- `.d5.json`: D5's reading of the bubble's text colour against its `--ground` composited at that setting over the two grounds the pane can hold (`over_text`, `over_ground`). At 8 % the reading is 14.38 and 16.83 in light, 12.62 and 15.63 in dark; at 60 % `over_text` is 3.77 (light) and 2.46 (dark), the user's choice below the default (U164).
- Every bubble lies inside the `.bubbles` layer in all 16; at 1280 the layer ends where the open Shelf begins.
