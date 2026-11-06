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

Calls counted during the scroll, grouped by the bundle chunk of the top stack frame:

| chunk and API | before 551cd247d | after d64d1ee08 |
|---|---|---|
| `scrollHover` chunk: `getComputedStyle` | 168 | 134 |
| `scrollHover` chunk: `getBoundingClientRect` | 108 | 72 |
| `scrollHover` chunk: `scrollWidth`, `scrollHeight` (each) | 20 | 26 |
| `scrollHover` chunk: `clientWidth`, `clientHeight`, `clientLeft`, `clientTop` (each) | 12 | 8 |
| `emulator` (xterm) chunk: `getBoundingClientRect` | 80 | 70 |
| `emulator` chunk: `getComputedStyle` | 60 | 24 |
| `emulator` chunk: `clientHeight` | 20 | 0 |
| `index` chunk (App code): `clientWidth`, `getBoundingClientRect`, `offsetLeft`, `offsetWidth` | 21, 12, 8, 8 | 24, 16, 0, 0 |
| all layout-read calls | 411 | 424 |

Findings:
- The largest caller in both builds is `apps/desktop/src/scrollHover.ts`: it reads a computed style and a rect for every ancestor of a scrollable element (lines 69 and 70), and `scrollWidth` and `scrollHeight` (lines 109, 142, 205). The chunk made 364 of 411 reads before and 290 of 424 after, so it is the first place to look for forced layout. The `scrollHover` chunk also bundles a vendored scrollbar library, so some of these calls come from that library, not from `scrollHover.ts`; the shim's four frames do not separate them.
- xterm's own reads (`emulator` chunk) fall from 160 to 94. They run on mouse events; the scroll tool moves the pointer, so part of this count belongs to the input method.
- Total calls are about equal (411 and 424): #6302 moved reads between callers and did not remove them.

What this cannot show: the shim counts reads. It cannot tell which read hit dirty layout, so it does not prove a forced layout, only a read that could force one. It also cannot attribute the two 33.3 ms display gaps: the gaps come from the earlier xctrace runs and the shim run is a different run with no frame timing. The two 33.3 ms frames stay unattributed.

Per Observer line, the verdict above stands (FAIL on the frame line, NOT PROVEN on forced layout). This section names the largest caller of scripted layout reads in each build: the `scrollHover` chunk.

## Trace 3 (after #6332)

Commit c5ae06451 (origin/main with #6332: `trackScrollbars`' MutationObserver no longer calls `flush()` for Terminal-only mutations). Same method as above, same Terminal content and scroll. Two bundles of this commit: one with the counted layout-read shim (identifier `dev.roundup.app6283c`) for the read counts, one without it (`dev.roundup.app6283d`) for the traces, so the shim does not load the traced run. The trace runs are two, one after the other in the same App; the shim runs are two in one App. In trace 1, 186 of 3121 frame gaps are 16.67 ms and fall across the whole 30 s, including seconds after the scroll ended (a, b and trace 2 have 8, 15 and 17); the cause was not found, so read that trace's gap figures as noisy. Wheel input, a 120 Hz display, no trackpad, one other roundup App (PID 10356) running.

### Scripted layout reads (counted shim, two scrolls)

| measure | before 551cd247d | after #6302 d64d1ee08 | after #6332 run 1 | run 2 |
|---|---|---|---|---|
| total layout-read calls | 411 | 424 | 372 | 400 |
| `scrollHover` chunk | 364 (89%) | 290 (68%) | 217 (58%) | 227 (57%) |
| `scrollHover.ts` ancestor walk (`getComputedStyle` + `getBoundingClientRect` pairs) | 84 | 56 | 28 | 28 |
| vendored scrollbar library reads in that chunk (`scrollWidth`, `scrollHeight`, computed style) | not separated | 26 each (+52 computed style) | 25 each (+50) | 25 each (+50) |
| `emulator` (xterm) chunk | 160 (39%) | 94 (22%) | 90 (24%) | 104 (26%) |
| `index` chunk (App code) | 49 | 40 | 56 | 60 |

The ancestor walk halves again (56 to 28), the largest drop since #6302. The vendored library's reads are unchanged, so they are now the largest part of the chunk. xterm's share is about equal; the App code's own reads are up by 16 to 20 (the `index` chunk: `clientWidth` and `getBoundingClientRect` at two call sites).

### Hitches and gaps (30 s Animation Hitches traces, all processes)

| measure | before 551cd247d | after #6302 d64d1ee08 | after #6332 trace 1 | trace 2 |
|---|---|---|---|---|
| hitches attributed to the roundup process (each 8.33 ms late) | 13 | 3 | 8 (4.5 to 5.4 s) | 11 (4.9 to 5.9 s) |
| gaps over 16.7 / 25 / 33.4 ms between displayed frames | 8 / 2 / 0 | 5 / 2 / 0 | 5 / 1 / 0 | 0 / 0 / 0 |
| longest gap | 33.33 ms | 33.33 ms | 33.33 ms | 16.67 ms |
| p95 of the gap | 8.33 ms | 8.33 ms | 16.67 ms (noisy run) | 8.33 ms |
| WebContent CPU samples (1 ms each) | 6317 | 5056 | 4939 | 3662 |
| of those under a layout call | 896 | 994 | 1016 | 769 |
| samples in `updateLayoutIfDimensionsOutOfDate` (a script reading a size) | 7 | 2 | 9 | 17 |

What this shows:
- The scripted reads fell: total reads, the ancestor walk and the `scrollHover` share all fall against #6302.
- The hitches did not fall in these two traces. Both show 8 to 11 hitches in the first second of the scroll (4.5 to 5.9 s), against 3 after #6302. One trace per build before this run, so the 3 may have been a good run.
- Frames over 16.7 ms: trace 2 has none and the longest gap is 16.67 ms; trace 1 keeps one 33.33 ms gap and four 16.7 to 25 ms gaps. The two traces disagree, so one run cannot decide this line.
- Scripted dimension reads in the profile (`updateLayoutIfDimensionsOutOfDate`) are 9 and 17 samples, above the 2 after #6302. The sample counts are 1 ms each; the profiler does not name the script.

Per Observer line: the frame line is still not proven (trace 1 has a 33.33 ms gap, trace 2 has none, two runs only). Forced layout from roundup scripts is not zero: the ancestor walk still runs 28 times, the vendored library and the App's own `index` reads remain. Two 33.3 ms frames are not attributed in any run: the shim run and the trace runs are separate runs with no frame timing in the shim.
