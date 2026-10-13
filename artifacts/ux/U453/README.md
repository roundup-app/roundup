# U453 supported App windows

Baseline: main `ad2f80e84230c41e5150c7fecc9ca6378971e7ac`. Head: the U453 changes in PR #1267, after merging that main revision. Both use isolated headless Chromium, a fresh profile and the real U26 harness.

| Before | After |
| --- | --- |
| Observers at unsupported widths; window-dependent Rail/Shelf clamps | Observers start at 1280; Rail 252–480 and Shelf 240–560 retain resize bounds and Project restoration |
| Long Decision answer errors ellipsised or covered by the Shelf | Full error wraps before the Shelf's leading edge; answer buttons stay reachable |

`base/` and `head/` each hold 36 PNGs with Checks and control rectangles: 1280×800 and 1440×800, light and dark, on `first-run`, `agents-10`, `tree-40`, `decisions` and `conflict`. Tree states include Todo and Pad Drawers open and closed. Decision states inject a long answer failure. Pad observations wait for the Editor's `Pad body` textbox before measuring or closing it.

The tests assert document scroll extent, exposed error bounds, full error text and control hit targets, and preserve each Check that passed on the same baseline state. The rendered resize observer also keeps the older 400 px height at 1280 px width.

Pre-existing failures remain in the raw readings: D1, D2, D6 and D7 from the Pad Editor and its imported theme, with D10 reflecting them; D14 on the Todo list's done-fold gap is owned by #1269. A retained imported stylesheet can continue to fail D1 after the Pad closes. D5 passes. No passing baseline Check is intentionally waived.

The retired narrow PNGs and associated readings are deleted in this PR. U430's source, scenario and captures are unchanged. Shared observer definitions are owned by #1271–#1273; the gate needed for narrow capture deletions is #1279, and the remaining Drawer cap is owned by #1284.

Regenerate the head with `just capture U453`. To refresh the baseline, create a detached checkout of the pinned main revision, install its dependencies, then run `U453_BASE_ROOT=<checkout> just capture U453`. Only U453 writes captures in either run; other tests still run.
