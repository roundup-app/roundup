# Z4280a / U4275b continuation

Base: `41b114d27790cba19db8c44cc4cc2810e264ae1c`.
UI source: `2d62a832e`.
Dedicated headless Chromium, fresh profiles, 1512×950, dark.

The paired `tree-40` PNGs cover rest, hover, focus, selection, nested Todos and a refused folder action with visible failure text. Matching Check readings and row bounds are alongside them. Names retain their natural width before trailing actions scroll: `auth-refactor` has 105.34375 CSS px rather than the rejected head's 31 px. Hidden actions have no pointer activation; Tab reaches and scrolls the rightmost button without changing name width.

The capture-producing observer reached all `tree-40` states, then failed while finalizing video (`agent-browser record stop`, exit 1). No finalized interaction video was produced. The separate rendered comparison runs without recording; this is a Chromium observation, with no native Mac appearance claim.

A fresh `CARGO_TARGET_DIR=/tmp/roundup-4280-fresh cargo build --locked -p desktop` exited 0 in 9m00s; its captured stdout/stderr contains zero `Modifiers::SUPER` occurrences. `cargo tree --locked -p desktop -i global-hotkey` resolves registry 0.9.0. Native macOS build and OS shortcut registration remain required CI observers.

The unchanged capture/preferences files pass all 27 tests. All nine Rail ordering tests and all 71 connected row tests pass. The first Rust test run lacked the daemon executable (120/126 passed); the daemon prerequisite was built before the final rerun. The earlier Todo pointer failures exposed a Rail title assigned to the zero-width indentation column; the row now occupies the content column. Ordering probes retain every assertion and use the supported viewport.
