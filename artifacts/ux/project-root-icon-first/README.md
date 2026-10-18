# Project root leading state Glyphs

U2567a, #2750. Isolated headless Chromium, U26 `tree-40`, 1512×950; no native Mac claim.

| Capture | Content | Checks |
| --- | --- | --- |
| before-light / before-dark | Main before the implementation | All pass |
| light / dark | Leading Glyphs, original tree-40 | All pass |
| states-light / states-dark | Every Kind, no Status, attention lines, refresh failure | All pass |

Each PNG has a matching `.checks.json`. D2, D5 and D6 pass in both themes, with no regression from the baseline. The expanded tree retains the dense seed's rows, adds six Workstreams (one per Kind), and adds a no-Status Workstream. Error and needs-you entries produce attention lines. A failed `rail.tree` refresh keeps the list and displays its failure above it.

Reproduce: `just harness tree-40 5199`, open `harness.html?seed=tree-40` in a fresh headless session, set viewport 1512×950 and emulate each colour scheme. For the expanded observation, use the fake App's `rail.createWorkstream` handler; override `rail.tree` with the original tree plus cloned Workstreams for every Kind and a Workstream with `status: null`; emit `rail.changed`. Use `failNext` before a second `rail.changed` to show the refresh failure.

Rendered measurements (`states.measurements.json`): every SVG centre equals its name-line centre (delta 0). The no-Status row has no SVG and keeps the same name start as adjacent Workstreams (x 332). Attention names share x 348 within their nested lists. No pixel offsets or new Tokens are used. These measurements are observation evidence, not UI test assertions.
