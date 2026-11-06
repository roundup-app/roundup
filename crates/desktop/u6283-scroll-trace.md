# U6283d Mac scroll trace

U6283d: FAIL on the Observer's two lines as worded; the data below is what was measured.
Date: 2026-11-06, one Mac (Apple silicon, 120 Hz display), screen unlocked under caffeinate.
Commits: before = 551cd247d (first parent of the #6302 merge 7313fd1e9); after = d64d1ee08 (origin/main at the run, which holds #6302 and later merges).
Builds: debug `.app` bundles from `tauri build --debug --bundles app`, identifiers `dev.roundup.app6283b` and `dev.roundup.app6283a`, product names `roundup6283b` and `roundup6283a`, each with its own `ROUNDUP_DATA_DIR` under /tmp/loop-own/obs-data. The Rust sidecars (rupd, rup, terminal-owner) are debug builds.
Terminal content: one Agent's Terminal holding 10,000 lines. The lines are text from a real Claude Code session transcript (assistant and tool-result text, folded to 140 columns), written to the Terminal by a stand-in `ROUNDUP_CLAUDE_BIN` script that forwards `plugin`, `-p` and `--version` calls to the real `claude` and prints the file for the Agent's own launch. No model ran for the content. It is real Claude output, not a live Claude session.
Scroll: computer-use scroll tool, 20 batches of 15 ticks at one point, from the top to the bottom (scrollbar at the end). This is wheel input, not a trackpad.
Recorder: `xcrun xctrace record --template 'Animation Hitches' --all-processes --time-limit 30s`, one trace per build. A first attach-to-PID trace of the before build (2 hitches) held no WebContent samples, so the all-processes traces are the ones below. Each trace holds one scroll from the top, started 5 s after the recorder.

## Numbers (30 s traces, one run per build)

| measure | before 551cd247d | after d64d1ee08 |
|---|---|---|
| Instruments hitches attributed to the roundup process | 13 (each 8.33 ms late; 10 of them within 3.5-5.0 s, the scroll's first seconds) | 3 (each 8.33 ms late; at 3.9, 4.1 and 8.2 s) |
| p50, p95 and p99 of the gap between displayed frames of the App's WebKit GPU surface | 8.33, 8.33, 8.33 ms | 8.33, 8.33, 8.33 ms |
| Gaps over 16.7 ms / over 25 ms / over 33.4 ms | 8 / 2 / 0 | 5 / 2 / 0 |
| Longest gap | 33.33 ms | 33.33 ms |
| WebContent process CPU samples (1 ms each) | 6317 | 5056 |
| of those, samples under a WebCore layout call | 896 | 994 |

The p95 cannot separate the builds: at 120 Hz it sits at one refresh in both, because the surface is presented every refresh, scrolling or not. The hitch count and the number of long gaps are the separating figures, and both fall after the fix.

## Forced layout

What was measured: the Time Profiler samples in the same traces. Samples whose stack passes `WebCore::Document::updateLayout`, grouped by the frame that called it.
- Before (WebContent): `LocalFrameView::updateLayoutAndStyleIfNeededRecursive` 842 (the browser's own rendering update, not forced), `updateLayoutIfDimensionsOutOfDate` 7 (a script reading a size such as `clientHeight`), `Style::Extractor::computeStyle` 2 (a script reading computed style), `VisiblePosition::canonicalPosition` 44 (selection or caret code).
- After (WebContent): rendering update 926, `updateLayoutIfDimensionsOutOfDate` 2, `computeStyle` 0, `canonicalPosition` 49.

So the scripted reads that force layout fall from about 9 samples to 2 and the computed-style read goes away. A scripted forced layout still shows in the after trace (2 samples, about 2 ms over 30 s).

What could not be measured: which script started those 2 samples. The profiler shows WebKit frames and JavaScriptCore, not source files, so a roundup handler cannot be told apart from xterm's own reads. No Safari Web Inspector Layout & Rendering timeline was taken: attaching the inspector to a debug bundle through computer-use was not attempted. The `canonicalPosition` samples (selection code) are unexplained and equal in both builds.

## Per Observer line

| line | result |
|---|---|
| The PR head shows no frame over 16.7 ms | FAIL: 5 gaps over 16.7 ms, 2 of them 33.3 ms, in the 30 s trace (before: 8, 2). The display-level gap includes the other processes' load: a second roundup App (PID 10356, not this run's) was running and drew hitches in the same trace. One run per build, so the 2 long gaps may be noise. |
| No forced layout started by roundup's scripts | NOT PROVEN: 2 scripted dimension reads in the after trace (before 9); the source script is not identified. |
| p95 frame time of both traces recorded | DONE with the caveat above: 8.33 ms both, at the display's refresh interval. |

## Not done

No repeat run (the first failing line stopped the window run). No trace with every roundup handler removed (U6283c); the after build still shows long gaps, so U6283c is open: if a repeat run reproduces them, that trace is the next step.

## Layout reads by call site (counted shim, no Web Inspector)

Web Inspector was not used. Safari is read-only to computer-use and its Develop menu is the owner's setting, so no Layout & Rendering timeline was taken. A small script stood in. It was injected into each bundle's `dist/index.html` (build output only, no source edit). It wrapped `getBoundingClientRect`, `getClientRects`, `window.getComputedStyle` and the layout getters of `Element` (`clientWidth`, `scrollHeight`, `offsetWidth` and the like), counted each call with its top four stack frames, and posted the counts to a local collector.

Run: each bundle's 10,000-line Terminal scrolled from the top by 20 batches of 15 wheel ticks. The scroll took about 6 s of wall clock in both bundles, not 30 s. One run per build.

| measure | before 551cd247d | after d64d1ee08 |
|---|---|---|
| layout-read calls counted during the scroll | 411 | 424 |
| `scrollHover.ts` ancestor walk (line 69 `getComputedStyle` + line 70 `getBoundingClientRect`, one pair per ancestor) | 84 + 84 | 56 + 56 |
| `scrollHover.ts` scan of scrollable elements (`getComputedStyle`, line 124) | 24 | 0 (the library below) |
| `scrollWidth`, `scrollHeight` and `getComputedStyle` in the vendored scrollbar library (`wt`, `yt`, same chunk) | 0 | 26 each, plus 52 more `getComputedStyle` |
| xterm mouse-position reads (`_positionFromMouseEvent`, `fire`) | 14 + 8 | 24 + 24 + 24 + 22 |

Findings:
- The recurring caller in both builds is the `scrollHover.ts` ancestor walk. It reads a computed style and a rect for every ancestor of each scrollable element. After the fix it runs 56 times instead of 84.
- After the fix a vendored scrollbar library adds reads of its own (`scrollWidth`, `scrollHeight`, computed style, 26 each). Before the fix this chunk had none. These reads are new in the after build.
- xterm's mouse-position code reads a rect and a computed style on each mouse event. The scroll tool moves the pointer, so this count belongs to the input method, not to scrolling.
- Total calls are about equal (411 and 424).

What this cannot show: the shim counts reads. It cannot tell which read hit dirty layout, so it does not prove a forced layout, only a read that could force one. It also cannot attribute the two 33.3 ms display gaps: the gaps come from the earlier xctrace runs and the shim run is a different run with no frame timing. The two 33.3 ms frames stay unattributed.

Per Observer line, the verdict above stands (FAIL on the frame line, NOT PROVEN on forced layout). This section adds one named caller for scripted layout reads in each build (`scrollHover.ts` lines 69 and 70) and a second source in the after build (the vendored scrollbar library).
