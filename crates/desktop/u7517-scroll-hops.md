# U7517 Mac scroll record: which hop owns the frames over 16.7 ms

U7517a, U7517b: in both cases the recording shows few frames over 16.7 ms, and no hop of the chain owns one except a single frame of the Claude Code case (claude redraw). Over three recordings, 10 frames over 16.7 ms fall inside the wheel input; 1 is attributed (claude redraw) and 9 are not attributable. None sits in xterm parse or xterm WebGL draw. Each of the 10 is 25 ms (two refreshes) and the case has 848 to 976 presented frames, so 2 to 5 frames in 850 to 980.
Date: 2026-11-19, one Mac (Mac16,6, Apple M4 Max, macOS 26.0.1, 3024 x 1964 display at 120 Hz, a present every 8.33 ms), screen unlocked. Before each case the Mac's input had been idle for at least 120 s (140, 133 and 126 s), not counting this record's own wheel events.
Commit: origin/main 511be199c (the #7566 merge). Build: debug `.app` from `tauri build --debug --bundles app` after `pnpm install --frozen-lockfile` and `pnpm -r build`, identifier `dev.roundup.app7517`, product name `roundup7517`, its own `ROUNDUP_DATA_DIR` and herdr-core session, launched under `env -i` with HOME, PATH, USER, LOGNAME, SHELL, LANG and TMPDIR only. The Rust sidecars (rupd, rup, terminal-owner) are debug builds. Renderer: `@xterm/xterm` 6.1.0-beta.338 with `@xterm/addon-webgl` 0.20.0-beta.331, both from `pnpm-lock.yaml`. Nothing was changed, swapped or tuned for the recording.
Input: wheel input, not a trackpad. The cua-driver `scroll` tool posts wheel events (15 notches per call, 0.65 to 1.0 s per call, at one point in the Terminal) to the debug App's window in the background. Trackpad pixel scrolling and momentum were not driven.
Recorder: `xcrun xctrace record --template 'Animation Hitches' --all-processes --time-limit 12s`, one trace per case run, with Time Profiler samples in the same trace. The first wheel call starts 3.5 to 3.7 s after the recorder, so the 2.6 to 2.9 s before it is a baseline with no input. Each scroll is 6 calls up then calls down (10 calls in case one, 9 in each case-two run), 8.3 to 8.6 s. The limit is 12 s, not the 10 s Loop control's later note asked for: case one was recorded before that note and case two repeated it.
Case one: a zsh Terminal in the debug App after `seq 1 10000`: 10,000 lines in xterm's own scrollback. One run.
Case two: a real Claude Code 2.1.323 session in the Terminal, fullscreen (the machine's `tui: fullscreen` setting), started as `claude --resume <an earlier session of this repo, 51 MB transcript, 269k tokens of context> --fork-session --model haiku --strict-mcp-config` and sent no prompt, so no model ran. `--strict-mcp-config` stops claude starting MCP servers; hooks and the status line ran as for any Agent. Two runs. claude was ended with `/exit` after each run.

## Numbers

| measure (scroll window) | case one: shell | case two run 1: claude | case two run 2: claude |
|---|---|---|---|
| presented frames | 945 | 976 | 848 |
| p50, p95, p99 gap between presents | 8.33, 8.33, 16.67 ms | 8.33, 8.33, 16.67 ms | 8.33, 8.33, 16.67 ms |
| gaps over 16.7 ms, all | 6 | 6 | 6 |
| of those inside the wheel input (attributed below) | 3 | 5 | 2 |
| of those outside it (the idle present pattern) | 3, longest 41.67 ms | 1 | 4, longest 41.67 ms |
| longest gap inside the wheel input | 25.0 ms | 25.0 ms | 25.0 ms |
| gaps over 100 ms in the window | 0 | 1, not located (see Cannot show) | 0 |
| wheel input span (first to last on-CPU wheel sample) | 0.73 to 8.25 s | 0.76 to 8.23 s | 0.80 to 6.96 s |
| baseline: presents, median gap, gaps over 100 ms | 59, 33.3 ms, 8 | 32, 41.7 ms, 5 | 62, 41.7 ms, 3 |
| 1-minute load average at the start, after the scroll | 2.66, 43.01 | 49.18, 40.21 | 4.30, 6.44 |
| `rustc` or `cargo` process at the start | none | none | none |

The baseline's present pattern is slow: with no input the display is updated every 33 to 42 ms by other windows and processes, with 3 to 8 gaps of 100 to 500 ms. A gap over 16.7 ms outside the wheel input span has no wheel input in flight, matches that pattern and is not attributed. Run 1 of case two was recorded while other sessions' work kept the Mac busy (a Python process at 65% CPU, a Daemon at 46%, WindowServer at 46%, Finder at 27%); run 2 was recorded on a quieter Mac.

## Case one: wheel scroll of a shell Terminal with 10,000 lines

Gaps over 16.7 ms inside the wheel input: 3, each 25 ms.

| hop | frames over 16.7 ms owned | CPU in the scroll window |
|---|---|---|
| wheel | 0 of 3 | 57 ms |
| mouse report | not on this path | |
| Daemon | not on this path | 214 ms, rupd with no input to serve |
| herdr-core | not on this path | 7 ms |
| PTY | not on this path | |
| claude redraw | not on this path | |
| relay | 0 of 3 | 256 ms |
| xterm parse | 0 of 3 | 21 ms |
| xterm WebGL draw | 0 of 3 | 117 ms |
| frame | 0 of 3 | 244 ms |
| not attributable | 3 of 3 | |

## Case two: wheel scroll of a fullscreen Claude Code session

Gaps over 16.7 ms inside the wheel input: 2 in run 2 and 5 in run 1, each 25 ms.

| hop | owned, run 2 (of 2) | owned, run 1 (of 5) | CPU run 2 | CPU run 1 |
|---|---|---|---|---|
| wheel | 0 | 0 | 19 ms | 37 ms |
| mouse report | 0 | 0 | 66 ms | 57 ms |
| Daemon | 0 | 0 | 294 ms | 302 ms |
| herdr-core | 0 | 0 | 62 ms | 62 ms |
| PTY | not attributable | not attributable | no sample names it | no sample names it |
| claude redraw | 0 | 1 | 1727 ms | 1748 ms |
| relay | 0 | 0 | 474 ms | 470 ms |
| xterm parse | 0 | 0 | 42 ms | 39 ms |
| xterm WebGL draw | 0 | 0 | 563 ms | 652 ms |
| frame | 0 | 0 | 394 ms | 314 ms |
| not attributable | 2 | 4 | | |

On-path CPU in the window is 3.9 s (run 2) and 3.8 s (run 1) over 8.6 s. claude redraw is 45% of it in both runs, about 20% of one core.

## The ten frames over 16.7 ms inside the wheel input

`at` is the end of the gap, in ms from the first wheel call. The hop column is the hop with the most CPU inside the gap; the last column is the processes outside the chain with the most CPU there (a 25 ms gap can hold more than 25 ms of CPU across cores).

| run, at | gap | owner | top hop CPU in the gap | other processes with CPU in the gap |
|---|---|---|---|---|
| one, 1078 ms | 25 ms | not attributable | xterm WebGL draw 2 ms | three Daemons of the installed App, 14 ms each |
| one, 1178 ms | 25 ms | not attributable | relay 3 ms | WindowServer 6, xctrace 5, DTServiceHub 4 ms |
| one, 1412 ms | 25 ms | not attributable | relay 3 ms | Instruments agent 24, WindowServer 8, cua-driver 7 ms |
| two run 1, 1127 ms | 25 ms | claude redraw | claude redraw 13 ms (claude was runnable and waiting 11 ms) | headless Chrome 100, 77 and 69 ms |
| two run 1, 1377 ms | 25 ms | not attributable | claude redraw 1 ms | headless Chrome 43, another App's WebContent 25, Instruments agent 19 ms |
| two run 1, 4993 ms | 25 ms | not attributable | claude redraw 1 ms | Instruments agent 25 and 14, another claude 16 ms |
| two run 1, 5035 ms | 25 ms | not attributable | none | Instruments agent 25, Finder 24, cua-driver 16 ms |
| two run 1, 7702 ms | 25 ms | not attributable | none | tsc 102, node 38 and 32 ms |
| two run 2, 1435 ms | 25 ms | not attributable | WebContent GC 1 ms | node 58, 38 and 30 ms |
| two run 2, 1527 ms | 25 ms | not attributable | relay 1 ms | Instruments agent 25, node 25, Finder 24 ms |

In all ten gaps a process outside the chain has more CPU than any hop (6 to 102 ms against 0 to 13 ms). The recording cannot say whether that CPU delayed the frame; it shows only that no hop of the chain was busy for 8.33 ms in nine of the gaps.

## What the tables decide (U7517c)

- No frame over 16.7 ms sits in xterm parse or xterm WebGL draw (0 of 10). No renderer A/B Issue follows from this record.
- The one attributed frame sits in claude redraw (1 of 10). claude redraw is also the largest CPU hop of case two, 2.7 to 3.1 times the next (1727 to 1748 ms against 563 to 652 ms for xterm WebGL draw). By U7517c the next Issue is the fix in that layer. One frame is thin evidence; the CPU share is the stronger one.
- The Daemon owns no frame. In case one it still used 214 ms of CPU in 8.3 s, 2.6% of a core, with no input for it to serve (U6368's bound is 2% at rest).
- The measured loss is 2 to 5 frames of 25 ms per scroll, 0.2 to 0.6% of frames. It does not show the stagger the owner reports. Trackpad input, a streaming Agent and a longer scrollback are not covered.

## Cannot show

- Wheel input at 15 notches per call is not a trackpad. Pixel-wise scrolling and momentum are not measured, so the whole-row scrolling of xtermjs/xterm.js#6040 is not tested.
- One run of case one and two of case two, 8.3 to 8.6 s each. A 25 ms frame cannot be told from noise at the 1% level.
- Time Profiler samples are 1 ms and on-CPU only. A gap in which no hop is busy for 8.33 ms may be GPU time, WindowServer, a wait or another process; the record lists the other processes and stops there.
- PTY is never attributable: no sample names the PTY copy, a kernel path.
- Run 1 of case two counted 1 gap over 100 ms in its window. The export was deleted before gaps over 100 ms were listed, so its position is unknown. Run 2 lists them and has none.
- The Instruments agent, the input driver and other sessions' work run in the same traces. The load figures are 1-minute averages at two instants, not per frame.
- Case two scrolled a resumed session at rest. A working Agent that streams output while the user scrolls is not recorded.
- The debug build's Rust sidecars are slower than release builds.

## Method notes

- A frame is the gap between presents of Display 1. Its swap chain rotates three surfaces (ids 8, 99 and 102 in every trace); one surface alone shows every third present, 25 ms apart at 120 Hz. The gaps are taken over the three surfaces together. `u6283-scroll-trace.md` used one surface, so its gap counts do not compare with these.
- A frame over 16.7 ms inside the wheel input span is attributed to a hop when that hop's Time Profiler samples add up to at least 8.33 ms inside the gap and it has the most; otherwise it is "not attributable". A sample maps to a hop by its process role and, in the App and WebContent, by a stack-symbol match: rupd is Daemon, herdr-core is herdr-core, claude is claude redraw, the GPU process is xterm WebGL draw when its stack names WebGL and frame otherwise; in the App, wheel symbols are wheel, rendering symbols are frame and the rest is relay; in WebContent, wheel symbols are wheel (mouse report in case two when the stack is JavaScript), WebGL and animation-frame callbacks are xterm WebGL draw, rendering symbols are frame, timers are xterm parse, IPC is relay. This is a name match: xterm parse is every WebContent timer, xterm WebGL draw is all JavaScript run from animation-frame callbacks, and neither is proven to be xterm's own work.
- xctrace printed "ending recording" at the limit and saved only after SIGINT in every run. The watchdog sent SIGINT at 44 s (case one) and 193 s and 194 s (case two); the save of a 6 to 11 GB raw trace into a 1.1 to 1.7 GB bundle took 1 to 1.4 minutes more. An earlier 28 s trace of 14 GB did not finish saving and was lost.
- The scripts that produced the numbers are not in the repository; the rules above are the method.
