# U131 critic repair

Paired observer: main `590f89e46`, isolated headless Chromium, dark,
1512×950, device scale 1. Readings are in `critic-fix.json`; screenshots
and the pointer recording remain under `artifacts/ux/U131/critic-fix/`.

| Before | After |
| --- | --- |
| Parent Todo disclosure shares the tick target | Disclosure occupies 0–16 px; tick starts at 16 px |
| Terminal's empty leading slot cannot rename | Double-clicking the tab centre opens and focuses rename |
| Pad glyph sits at the start of the reserved column | Glyph ends 8 px before the name |
| Rail branch and leaf names use different local offsets | Both use 56 px after subtracting existing tree indentation |

All 16 integer x positions across the disclosure hit its button. Clicking
folds its own group, with zero `todo.complete` calls. The native tick retains
its 24 px target. Plain, nested and done Todos retain one glyph column.

Ten paired states cover the five required seeds, dense Todos, visible
“Offline. Reconnect.” feedback, Pads, Terminal tabs and rename. Every Check
passing on main still passes; D2/D5/D6 pass throughout. Dense Todos also pass
D12. The existing Pad D12 failure remains on both revisions. The recording
shows disclosure folding/unfolding and rename from the Terminal tab centre.

The existing rename test helper now double-clicks the tab button, exercising
the leading slot too. The first test fails against the old handler; all 44
rename/recovery tests pass against the repaired handler with
retries disabled. No test was added or removed. Layout stays in the rendered
observer, with no appearance assertions added to unit tests.

This repair changes no design-system acceptance. Optical baseline, extended
press/state observers, strict lint, native material and remaining U130–U137
work stay on #3824.

## Validation

Runtime source: `e66f1e52b6510c8be607fd52915805b7a189bf70`.
Both required lints, Token ownership and merge-loss pass. The prescribed
`just capture U130,U131,U132,U133,U134,U135,U136,U137` run reports 4,011 passed,
57 skipped and two failed tests: N5's first fixture startup timed out at
120 seconds; U463's first-run journey timed out at 180 seconds. These fixture
files pass separately with retries disabled (3 and 6 tests). All 44 rename
checks also pass in the full run. The broad run is not recorded as green.
