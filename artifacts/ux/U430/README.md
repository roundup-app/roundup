# U430 — centre beside the Drawer

1280×820, headless Chromium, fake Daemon (U26). Base: `origin/main` at `10c00de1`. Head: PR #1225 with the owner’s 2026-10-12 viewport decision and this fix. This observes the webview; it makes no native macOS timing claim.

| Observer | Result |
|---|---|
| Work order + Door composer (`thread-report`) | Centre right and Drawer left are 720 px. Every composer/header control is inside the centre. 300 characters wrap without horizontal scrolling. |
| Todo + Terminal in Takeover (`tree-40`) | Centre right and Drawer left are 720 px. The Terminal stays outside the Drawer. Injected Todo failure remains visible. |
| Opening and closing, both seeds | At least four rAF samples per slide; edge difference rounds to 0 CSS pixels in every sample. Raw difference is at most 1/64 CSS pixel (Chromium layout quantization); raw boxes are preserved. Settled boxes touch exactly. |
| `window.__checks()` against base | No passing Check regresses (`delta.txt`). `thread-report`: D4/D6/D7/D10 already fail; `tree-40`: D14 already fails. Failure injection adds no regression. |
| Pane with fake App | `u430_terminal_gets_one_resize_per_slide` sends no resize during sampled frames and exactly one fitted resize on each slide end. Removing its slide guard fails the test (4 calls instead of 1). |
| Y2 | `y2_frame_sampler.test.tsx` explicitly watches `.rail, .shelf` and excludes `.pane`. |

```text
Rail (288) | centre (432) | Drawer (560)
```

[Composer](head/thread-report.png) · [Terminal](head/tree-40.png) · [Failure](head/tree-40-failure.png)

Reproduce with two isolated harness servers (`just harness thread-report 5199` on head; port 5200 on base):

```sh
python3 apps/desktop/src/drawer/u430_browser.test.py 5199 artifacts/ux/U430/head
python3 apps/desktop/src/drawer/u430_browser.test.py 5200 artifacts/ux/U430/base --baseline
loop/rules.sh delta artifacts/ux/U430/base artifacts/ux/U430/head
pnpm --filter desktop exec vitest run src/drawer/u430_narrows.test.tsx src/testing/y2_frame_sampler.test.tsx src/drawer/u5_drawer.test.tsx
```

`just perf-keystroke` is the native observer, run only when the user requests it (`docs/perf.md`). It was not run on this Linux runner. Minimum window width and other narrow layouts remain #1236.
