# U131 done-fold repair

Before repair: `e04e9fcd3`, PR #4091 with main merged.
Isolated headless Chromium, dark, 1512×950, device scale 1.

The two tree-40 done folds start their title at local offset 40.14 CSS px
(after subtracting depth), against the shared 56 px Token. Their visible
Glyph boxes start at x=78 and x=22. D8 omits these fold rows and passes.
The baseline image is `artifacts/ux/U131/fold-repair/base/tree-40.png`.

Repair: include the done folds in D8 and share the Rail leading Glyph
column and gap, preserving the existing tick, disclosure and row insets.
