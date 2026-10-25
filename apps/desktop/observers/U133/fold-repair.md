# U131 done-fold repair

Before repair: `e04e9fcd3`, PR #4091 with main merged.
Isolated headless Chromium, dark, 1512×950, device scale 1.

The two tree-40 done folds start their title at local offset 40.14 CSS px
(after subtracting depth), against the shared 56 px Token. Their visible
Glyph boxes start at x=78 and x=22. D8 omits these fold rows and passes.
The baseline image is `artifacts/ux/U131/fold-repair/base/tree-40.png`.

Repair: include the done folds in D8 and share the Rail leading Glyph
column and gap, preserving the existing tick, disclosure and row insets.

After repair: `9866d0c55`. Both local title insets measure 56 CSS px.
Glyph boxes move to x=90 and x=34, matching sibling rows. Fold visible-mark
baseline difference is 0.5625 CSS px; ordinary Rail rows measure 0.359375 px.
D8 now includes both folds. Restoring their missing leading margin in the
isolated browser makes D8 fail at `.rail-fold` with inset 44 instead of 56;
removing that probe restores the pass. Readings: `artifacts/ux/U131/fold-repair/readings.json`.

Integration repair: main retained a drag-radius declaration referring to the
removed `--tree-row-radius`. It has no rendered value, but extended D7 rejects
it. `67098a9b9` removes the stale declaration; D7 and D10 pass again.

## Fresh validation

The 54 Check tests, 30 control tests and three copy tests pass without retries.
The initial Terminal observer fails D7/D10 on the stale radius declaration;
after removing it, all 11 Terminal and Rail folding/keyboard tests pass without
retries. That is 98 passing focused tests across the two final observations.

Twenty paired dark 1512×950 states introduce no Check regression; the summary
is `fold-completion.json`. The five required seeds, dense rows with
`Complete failed: Offline. Retry.`, Todo menu, Rail/Todo/Pad focus, selection
and drag, Terminal tabs and an open Bubble are included. D2/D5/D6 pass
throughout. Todo/Pad drag retains the baseline's D14 failure. The stale
radius rule accounts for the baseline's D7/D10 failures, repaired on the head.

Artifacts remain uncommitted under `artifacts/ux/U131/fold-repair/` and
`artifacts/ux/U133/fold-completion/`. Both Rail drag videos decode (0.8/0.9 s).
The first recording attempt lacked ffmpeg; the installed recorder dependency
and isolated rerun produce valid videos. No native observation is claimed.

The prescribed broad capture command failed before the desktop suite:
`reporting/results.test.mjs` exceeded its subprocess bound (`pnpm ETIMEDOUT`).
This is not a full-suite pass. The focused behavioral and paired rendered
observations above are independent of that command.
