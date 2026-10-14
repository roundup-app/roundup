# U476 font evidence

`just capture U476` observed baseline `63f646198c27229d6117929e2e17e481fe576428` and App source `8b3352be26d2317613bb99ab1d3f37a84c2b4d29` in isolated headless Chromium on Linux. Later observer changes do not change that App source.

The four PNG/check pairs in each of `base/` and `head/` show `tree-40` with Todo #5 open and `conflict` with “name already taken” visible, at 1280×800 in light and dark. The eight matrix JSON files also retain 1440×800 readings. Both sides use pixel ratio 1 and clock `1791936000000`. Every Check passes, including D2, D5 and D6.

| Renderer, both schemes | Baseline and head cell size | Fitted size | Type |
| --- | --- | --- | --- |
| DOM fallback | 7.825 × 15 CSS px | 80 × 26 | 13 px, mono Token |
| WebGL | 7 × 15 CSS px | 89 × 26 | 13 px, mono Token |

`terminal.json` records configured font, the rendered ASCII fallback row and both renderers' cell readings. Each before/head dimension differs by 0 CSS px. These are webview observations; they measure no native keystroke latency.

`just perf` exits 1: all absolute limits pass, while five existing Linux regression ceilings fail. `perf.json` and `perf-host.json` retain the eleven-run report, AMD EPYC 7763 host identity, source and binary hashes. #1251 owns diagnosis, repair and measured runner-class baselines; #1630 is blocked on it. The draft leaves that engineering prerequisite to its owner and changes no budget.

After #1251 is complete, the Issue still requires K1–K3 on the Mac. After this PR merges, check out its merge commit on the Mac, install dependencies, then run `ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --runs 3` on an idle laptop. The requested run opens its own window and types 1000 keys per run. Record the commit, exit code and `target/perf-keystroke.json` on #1630. A valid report with p95 below 16 ms completes the requested timing acceptance; exit 2 needs a valid rerun, and a valid miss needs repair. Keep #1630 open until that evidence exists.
