# Z4280a / U4275b continuation

Base: `41b114d27790cba19db8c44cc4cc2810e264ae1c`.
UI source: `2d62a832e`.
Dedicated headless Chromium, fresh profiles, 1512×950, dark.

The paired `tree-40` screenshots cover rest, hover, focus, selection, nested Todos and a refused folder action with visible failure text. Matching Check readings and row bounds are alongside them. Names retain their natural width before trailing actions scroll: `auth-refactor` has 105.34375 CSS px rather than the rejected head's 31 px. Hidden actions have no pointer activation; Tab reaches and scrolls the rightmost button without changing name width.

The capture-producing observer reached all `tree-40` states, then failed while finalizing video (`agent-browser record stop`, exit 1). No finalized interaction video was produced. The separate rendered comparison passed both U4275b tests without recording, including every Check passing on the paired main baseline; this is a Chromium observation, with no native Mac appearance claim.

A fresh `CARGO_TARGET_DIR=/tmp/roundup-4280-fresh cargo build --locked -p desktop` exited 0 in 9m00s; its captured stdout/stderr contains zero `Modifiers::SUPER` occurrences. `cargo tree --locked -p desktop -i global-hotkey` resolves registry 0.9.0. Native macOS build and OS shortcut registration remain required CI observers.

The unchanged capture/preferences files pass all 27 tests. All nine Rail ordering tests and all 71 connected row tests pass. The first Rust test run lacked the daemon executable (120/126 passed); the daemon prerequisite was built and the final rerun passed all 126 tests. The earlier Todo pointer failures exposed a Rail title assigned to the zero-width indentation column; the row now occupies the content column. All 16 ordering probes pass without retries, retaining every assertion at the supported viewport.

The unchanged native dependency implementation also passed #4311’s [fresh macOS build](https://github.com/roundup-app/roundup/actions/runs/40431115650/job/121949027587) (the Z4280a build and diagnostics steps both report success) and [native shortcut lane](https://github.com/roundup-app/roundup/actions/runs/40431115650/job/121949027638). The new head must pass its own required CI before merge.

`just ready` exited 0 on the final source. The two available tests in `terminal/u59_real_daemon.test.ts` pass with daemon binaries built; its native-zsh observer is skipped on this host. Broader browser repairs remain subject to this head’s CI; the run recorded cold-build contention and repeated the affected probes without raising timeouts or adding retries.
