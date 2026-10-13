# U430 — centre beside the Drawer

Issue #1295. Headless Chromium on the real U26 App harness, with a fake Daemon and a fresh isolated agent-browser session. Base App: main `2ae44989`; head App: the PR checkout after merging that main, with the resource wrapping fix `982cffcb`.

| Viewport | Stored Rail / Shelf | Main overlap | Head centre | Head Drawer |
|---|---|---|---|---|
| 1280×800 | 288 / 320 | 0 px | [288, 720] | [720, 1280] |
| 1280×800 | 480 / 560 | 172 px | [480, 696] | [696, 1280] |
| 1440×800 | 288 / 320 | 0 px | [288, 880] | [880, 1440] |
| 1440×800 | 480 / 560 | 12 px | [480, 856] | [856, 1440] |

Each row is observed with both Todo and Pad Drawers and both the Door composer and a Terminal in Takeover on `tree-40`: 16 cases. The composer’s 300-character line wraps, every input/header control stays within the centre and passes a pointer hit test, and the Terminal’s right edge stays outside the Drawer. Opening and closing frames agree within Chromium’s 1/64 CSS-pixel layout precision; settled edges agree exactly. Full rectangles and opening/closing frames are in [main](base/supported-width-boxes.json) and [head](head/supported-width-boxes.json).

The existing `thread-report` Work order and dense `tree-40` Todo failure are captured too. The injected `Todo update failed` text remains visible. [Check comparison](delta.txt) exits 0: no passing main Check regresses. Main’s recorded failures include D1, D2, D6, D7, D10 and D14; their selectors and values are retained in the base checks JSON.

```text
480 px Rail | 216 px centre | 584 px Drawer = 1280 px
```

[Composer at maximum widths](head/1280-480-560-Todo-thread-report.png) · [Terminal and Pad](head/1280-480-560-Pad-tree-40.png) · [Visible Todo failure](head/tree-40-failure.png)

`u430_terminal_gets_one_resize_per_slide` asserts exactly one fitted `terminal.resize` at each slide end and none during the slide. `u430_closing_keeps_the_centre_shrinkable_until_the_slide_ends` asserts the closed grid floor returns only after the retained Drawer content unmounts. Existing motion, reduced-motion, focus, selection and centre-input tests remain in the check suite.

Reproduce with `just capture U430`. Its `agent-browser` observer runs only when U430 captures are selected (L105); `just check` runs the layout, lifecycle, motion, focus and refit tests. Each observer owns a separate Vite cache.

The resource meter's groups wrap within the narrowed centre, preserving the words `memory` and `project` and every value. `u430_resource_text_stays_inside_the_narrowed_centre` measures each rendered text fragment in all 16 cases and asserts both edges stay inside the strip. Its red run placed `memory` at x=377 outside the centre; the fixed observer passes. Base and head captures were refreshed against main `2ae44989`.

Final sequential `just check` with `ROUNDUP_CAPTURES=U430` passed: 1,478 Rust tests, 294 Web test files (2,427 passed, one skipped), including the rendered observer. Earlier concurrent runs hit U166 and U112 timeouts; both isolated retries and this final full run passed. The final Check comparison exits 0.
