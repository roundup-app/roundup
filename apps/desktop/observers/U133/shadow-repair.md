# U133 shadow-root press repair

Observed source: `6681a222cfee574e1bc17120b681c6189f542d96` (includes the repair and current main).
Isolated headless Chromium, fresh profile, dark, 1512×950.

| Control | Pointer / Enter first frame | Release |
| --- | --- | --- |
| Tree row in `file-tree-container` | Pressed Token ink, alpha 0.75 | Cleared |
| Diff button in `diffs-container` | Pressed Token ink, alpha 0.75 | Cleared |

The probe uses open shadow roots, the production tree/diff styles and document feedback listener. A capture listener samples the first animation frame queued by the real pointerdown/keydown event. All four probes retain their resting background. Measurements: `shadow-repair.json`; PNGs: `artifacts/ux/U133/shadow-repair/` (uncommitted).

The regression test fails in all four shadow cases before the event-path fix and passes afterward. It covers pointer release, pointer leave, key release and blur through nested shadow content. Existing cancellation and editor/disabled-control tests still cover distinct paths; none was removed.

Rendered investigation also found that `diffs-container` lacked the inherited pressed-ink Token. Adding that host to the existing Token selector makes the diff probe change ink rather than only setting its attribute. No Token value changes.

Checks moved: D4/D6. No layout or activation change. The journey stage is Review: feedback while choosing a changed file or diff action. These probes establish control feedback, not the complete real-Daemon journey or native Mac rendering.

`just capture U133` failed before the UI suite: reporting test `L107 completed failures retain per-test evidence for exact recovery` hit its 60-second subprocess bound (`spawnSync pnpm ETIMEDOUT`). The focused captures above remain available.

The warmed App capture at `artifacts/ux/U133/shadow-repair/dense/head/dense-failure.png` shows `Offline. Retry.` on `tree-40`. All Checks pass, including D2, D5 and D6 (136 targets). The first navigation attempt timed out while the isolated server was cold; warming `/__roundup_ready` completed successfully, and the subsequent capture passed.

The six-minute related-file run ended while the real-Daemon build was waiting on the cold Rust lint build lock; it is not a suite pass.

Focused validation passed: 83 tests in `u133_feedback.test.ts`, `u133_press.test.ts`, `u130_tokens.test.ts` and `u137_checks.test.tsx`, including real headless native/Ark activation and cancellation.
