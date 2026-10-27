# U4275b rendered observation

Baseline: `6ae07b24fec8de4a3ec710e51e7fe7c967338e24` (`origin/main`). Implementation: `b747e5dca`. Dedicated headless Chromium sessions, fresh temporary profiles, 1512×950, dark.

Ten paired readings cover `tree-40` and `agents-10` at rest, hover, focus and selection, plus nested Todos and the dense action failure. No Check passing on the baseline regresses; D2, D5 and D6 pass. PNGs remain untracked in `base/` and `head/`. The four final `agents-10` head captures were completed directly after recording aborted the capture test.

Long Workstream probe: all four quick actions fit at x=131–239; Open occupies x=247–271, within the 287 px Rail. Hover/selected name and trailing-group rectangles are in `head/workstream-*.geometry.json`. Actions remain at the trailing edge; names truncate and reserve the same action space before reveal.

| Validation | Exit | Result |
|---|---:|---|
| `just ready` | 0 | Web/Rust lints, type checks, proofs, trailers, frozen checks, workflow tests and N7 pass. |
| Connected row, quick-action, Rail ordering and Todo ordering files | 0 | 103 tests pass. |
| `src/ui/u474_browser.test.ts` | 0 | 13 tests pass, including App icon focus and cleanup. |
| `src/bubbles/u511a_browser.test.ts --retry=0` | 0 | Both click-away and real-Daemon recovery tests pass after prerequisites are built. |
| Main/head retained-rename observer, `--retry=0` | 0 | Current selection-only behavior and exact retained input pass. |
| Paired capture file, `--retry=0` | 1 | All emitted Check comparisons pass after the spacing repair. The old baseline selection wait was corrected and passes separately; `record stop` fails before agents-10 head capture. No finalized video is claimed. |
| `timeout --signal=INT --kill-after=20s 180s just capture U4275b` | 124 | Full-suite capture exceeds the local budget; focused paired readings and PNGs are retained. |

The initial cold Daemon build exceeded its test budget; the final two-test run above passes without retries. A redundant run waiting behind Clippy was cancelled. CI judges the complete push. The previous head already passed the fresh macOS build and shortcut lanes; no new native behavior is introduced here.
