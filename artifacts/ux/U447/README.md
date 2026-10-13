# U446–U448: working ring and Rail

The Rail gains an icon head, 13 px names and 32 px rows. The shared working quarter turns in 960 ms, linear, with a fixed ring; reduced motion leaves it still. Rail Todos keep their ID, title, blockers and actions on one line; their Drawer holds the body and Home.

| Before (`ed410aee`) | After |
|---|---|
| [1440 px, dark](base/tree-40-dark-1440.png) | [1440 px, dark](head/tree-40-dark-1440.png) |
| [1280 px, light](base/tree-40-light-1280.png) | [1280 px, light](head/tree-40-light-1280.png) |

`u446_u448_rendered.test.ts` uses headless agent-browser, a fresh profile and the real webview harness. It checks motion properties, reduced motion, ten working Agents' fixed boxes and Glyph columns, three-angle greyscale distinction, section-head geometry, 252 px fit, row heights and selection. `u446_working.test.tsx` and `u447_head.test.tsx` assert the shared Glyph and the Rail's head through their rendered interfaces. Existing U46/U131/U403/U404 tests now read U448's height and U447's returning head.

Base/head captures cover `tree-40`, light/dark, 1280×800 and 1440×800. `loop/rules.sh delta artifacts/ux/U447/base artifacts/ux/U447/head` exits 0: no passing Check regresses. D1–D14 pass on both revisions in both schemes at both viewports. U448's failure captures show `name already taken` above the footer on the dense seed at both viewports.

U446's PNG pairs compare working and needs-you at 0°, 120° and 240° in both schemes; each differing greyscale share exceeds 4%. Its frame JSON records ten working Agents without any row or Glyph-box displacement.

These are Linux/Chromium observations. The user reports what they meet in `just app` on the Mac.

`just perf` exits 1 against the recorded Linux baselines on this runner; the same Daemon on main reproduces the misses. [Main report](../U446/perf-main.json): four CPUs, cold start 45.919 ms, extra RSS 3.328 MB and write-to-output p95 1.152 ms. [Head report with two-core affinity](../U446/perf-head.json): 46.551 ms, 3.023 MB and 1.177 ms. Both satisfy all absolute limits, and neither proves the committed regression baseline. The user authorized merging the Rail change without waiting for #1251 on 2026-10-13; #1361 owns the Daemon latency comparisons.
