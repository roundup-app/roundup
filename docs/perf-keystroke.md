# Native keystroke performance

## Keystroke-to-render in WKWebView

> **This opens a window over your screen and types into it.** The window is always on top and on every Space for about 40 s per run (three runs by default), and it never takes the keyboard focus on purpose, but it covers whatever you are doing. `just perf-keystroke` and `perf-keystroke` refuse unless `ROUNDUP_ALLOW_WINDOW=1` is set, and it is set only by someone the user asked to run it (R12). No agent, Reviewer, CI job, boxd VM or `just check` runs it.

What the number proves: keydown to the first xterm render that shows the echo, in the real WKWebView on macOS, with the renderer and mean frame time recorded. What it does not: it is not a CI gate and not a Linux number, it excludes the keyboard, OS event path and display scan-out, `performance.now()` is a 1 ms bound, and p95 in whole milliseconds makes a 10% test move in 1 ms steps, so its budget is the 16 ms limit only. The cheap headless bound is the Daemon-side `write_to_output_p95_ms` limit of 16 ms in `just perf` (R8).

`just perf-keystroke` (macOS only) builds the App with the keystroke probe (`VITE_ROUNDUP_PERF`, K1) into `target/perf-app`, opens its window once per run, lets the webview type 1000 keys into a raw `cat` Terminal and reads the result back (K3, R11). The report carries the renderer (`webgl` or `dom`) and the mean frame time.

R21 judges each run separately: p95 must be strictly below 16 ms, with zero
dropped keys, including the 100 warm-up keys. Warm-up latency samples remain
excluded. `target/perf-keystroke.json` retains the complete `reports` array and
per-run `loads`, including failures, and is updated after each run. A latency
or drop miss exits 1; an invalid observation exits 2. The runner uses temporary
App, webview and Daemon data even when the caller has data overrides. Its
Workstream uses the fake vendor executable, never the user's real `claude`.

What can go wrong:
- **A covered or napped window stops drawing.** macOS stops rAF and timers for a window other windows cover and naps an App that is not frontmost: measured here, with the window behind a full-screen Chrome, rendering stopped entirely and every key timed out. The perf build's window is therefore always on top and on every Space (a `TAURI_CONFIG` override in the recipe, so normal builds are unchanged), and the runner passes `-NSAppSleepDisabled YES`. The window stays over whatever you are doing for about 40 s per run, three runs. A mean frame time above 25 ms exits 2; its report is retained. Any dropped key fails under R21.
- **Low Power Mode.** It halves the webview's frame rate, so a run in it measures the power setting, not the App; run on AC power with Low Power Mode off.
- **Load.** Run it with the laptop idle; the load average is printed per run.
- **Windows over a headless Chromium number.** Chromium with the same xterm measured p95 under 5 ms; WKWebView on an M4 Max in the earlier spike measured 11 to 15 ms. The difference is the frame wait, so the budget is only meaningful here.

### R20 observations retained from #3550

These are the work order's observations, before the repair, on AC power on a
16-core Mac. The raw reports, OS/app versions, power-mode confirmation and
per-hop attribution were not supplied. They cannot establish the dominant hop
or replace R20's quiet-machine observations. No after-repair performance is
claimed by the observer-safety changes.

| Method / workload | roundup p50 / p95 (ms) | Solo p50 / p95 (ms) | Samples / load |
| --- | --- | --- | --- |
| WKWebView, raw `cat` | 30 / 35 | — | 1000 keys × 3; 13–25 drops/run; load 6–9 |
| Daemon `write_to_output` | — / 20.8 | — | `just perf`; load 6–9 |
| Outside key-to-pixel, idle zsh | 36 / 45 | — | 60 samples × 2; load 6–9 |
| Outside, idle zsh comparison | 40 / 50 | 39 / 48 | one run set; load ~7 |
| Outside, real `claude`, no Enter | 39–41 / 48 | 39.5 / 49–53 | one run set; load ~7 |
| Outside, typing beside `yes` | 101–106 / 129–136 | 33 / 38.5 | load 5.5–6.8 |
| Outside, switch two Terminals | 70–71 / 80–81 | 75 / 81–82 | load 5.5–6.8 |
| Outside, scroll 10k lines | 20–23 / 26–29 | 26–28 / 37 | load 5.5–6.8 |

The flooding observation had 100–120% CPU each in the webview, Daemon and host
App, versus about 30% for Solo's flooding Terminal. The proposed hidden-screen
explanation remains unproven. The native observations below use
`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --out target/perf-keystroke-before.json`.
The [retained reports](perf-keystroke-mac-observations.json) include the owner's
complete comments, console output, source links and JSON, including the failures.

The recorder repairs in #3694 and #3717 merged before a further native run at
`01dacd91ce7b1e5ffd874202df4ada323e114d5c`. The command above exited 2: all
three reports contained `{"probe":"roundup-keystroke-probe","error":"no key was echoed and rendered after the warm-up"}`.
The machine was an M4 Max MacBook Pro, 16 CPUs, macOS 26.0.1, AC power at
100% charge, Low Power Mode off, unlocked, with the owner not touching the
window. Per-run 1-minute loads were 10.69091796875, 2.76953125 and
2.396484375 (0.67, 0.17 and 0.15 per CPU); the first run was busy after the
release build. There are no latency, renderer, frame-time or timer-resolution
measurements from these failed runs. Full console output and the saved report
remain on [#3550](https://github.com/saadshahd/roundup/issues/3550).

#3748 binds typing to the Terminal that printed `ready`, which already owns
report delivery. The old document-wide lookup could select an Agent's earlier
xterm textarea. A no-window regression test demonstrates that case with two
inputs and asserts that only the ready shell receives the key. The owner's
repeat at `7ce598e5a` still failed all three runs with the same warm-up error
(exit 2; [comment](https://github.com/saadshahd/roundup/issues/3550#issuecomment-6387912547)).

### Successful idle observation on #3755 (2026-10-24)

At `853f9440b8269b943dab07c9fa1dae79d060a204`, based on `59cff55ca`, the
owner ran the command above on an M4 Max MacBook Pro, 16 CPUs, macOS 26.0.1,
AC power, Low Power Mode off. Exit: 0. Each run reports 1000 measured keys,
zero drops, WebGL, 1 ms timer resolution and device pixel ratio 2.

| Run | 1-minute load / per CPU | p50 / p95 / p99 (ms) | Mean frame (ms) |
| --- | --- | --- | --- |
| 1 | 5.7705 / 0.361 | 6 / 10 / 12 | 8.3220 |
| 2 | 4.4482 / 0.278 | 6 / 10 / 11 | 8.3559 |
| 3 | 3.0508 / 0.191 | 6 / 10 / 15 | 8.3390 |

All three are below R20's 0.45 load-per-CPU threshold. The owner identified
an observer failure: the Workstream's Agent Terminal appeared about 200 ms
after `ready`, took focus and folded the shell bubble. xterm's
IntersectionObserver then paused rendering; echoes were parsed but never
rendered. #3755 waits for that Agent Terminal before opening the shell Terminal.
This repairs the recorder's visibility, not a measured production latency hop.
The successful reports came from that open PR; they do not establish results
for an unmodified `main` build.

The largest reported hop is `parsed_to_frame`, p50 4 ms and p95 7 ms in all
three runs. `dispatch_to_echo_event` is next, p50 2 / 1 / 2 ms and p95
3 / 3 / 4 ms. `write_reply` overlaps that chain (p95 4 ms in each run).
The reported uncertainty is 1 ms timer resolution, not cross-clock calibration.
These coarse webview spans cannot identify the largest of all R20's required
hops: base64, Daemon receipt, PTY write and echo read remain unsplit.

#3550 stays open. Missing acceptance includes full R20 attribution and calibrated
uncertainty, reproducible quiet-Mac Solo comparisons, a measured production
repair with before/after distributions, the shared Agent/shell input-path test,
and three passing runs while another Terminal floods output. The three idle
runs above meet the numerical idle budget only. No further Mac timing is
requested by this evidence update.

## X14 retained flood observation

`just perf --flood --out target/perf-flood.json` builds the release probe and runs
only the isolated real-Daemon flood observer. Ordinary `just perf` retains every
idle metric, budget, load/skip rule and qualification requirement above; flood
mode is a separate correctness observation, not latency or R16 qualification.
It opens no native window and supplies no R11/R12 keystroke evidence.

```text
real temporary Daemon → ten gated shells → exec yes
                      → independent RPC output drain → chunks per Terminal > Bus capacity
paused actual Bus receiver → two identified Rail markers → resume after producer shutdown
report → counters + received markers + payloads + structured lag + cleanup + outcome
```

The two Rail markers are emitted while the actual receiver is unread, before
releasing the ten programs; their count is strictly below the Daemon's reported
Bus capacity. Output is drained through the existing RPC client independently
of that receiver. Collection stops only after every Terminal exceeds capacity;
producers then stop before resuming the receiver to obtain a finite observation.
The report retains partial counters on failure, both marker identity lists,
Terminal payload count, lag error and missed-event counts, and verified stopped
Terminal count. Missing or incomplete counters and markers cannot pass.
`--flood-timeout 60` bounds startup/collection; shutdown and shutdown verification
have separate ten-second bounds. Only this temporary Project's processes and
socket/data are touched.

| Executable exit | Meaning |
| --- | --- |
| 0 | Complete counters, all markers in order, no payloads or lag, successful cleanup |
| 1 | Complete observation violates isolation or loses markers (expected on current transport) |
| 2 | Startup, collection timeout/error, cleanup or report-write failure; no valid acceptance |

A failing command through `just` may return the recipe's exit 1; the executable's
exit and JSON `flood.error` distinguish an observation error from detected lag.
Keep the JSON and command/exit with source and probe binary hashes, host,
toolchain, profile and load when recording an observation. Do not replace or
relax `budgets.json`. #1930 must migrate this output drain to selected streams
in its Contract PR, rerun this command and retain zero Rail lag; this observer
does not complete #1930 or X14's Terminal regression/journey acceptance.

### R20 hop attribution

[Recorder attribution](perf-keystroke-attribution.md) describes the correlated
Daemon stamps, echo identity, calibration bounds, retained hops and window-free
proofs. The native observations above are unchanged; #3550 still owns full-chain
native evidence and the production repair.

The [2026-10-25 full-chain attempt](https://github.com/roundup-app/roundup/issues/3550#issuecomment-6396746360)
at `477a3ce93f937cb734b4a69d6a0cb710ebfd3293` exited 2: all three quiet-Mac
runs timed out collecting a complete PERF line. Its complete report and console
output are retained in [the observations](perf-keystroke-mac-observations.json).
No hop timings or latency verdict can be derived from it.

Keystroke runs now retain a separate `perf-keystroke-*` diagnostics directory
beside `--out` for every run, listed in the saved report's `diagnostics` array.
It holds App stdout/stderr, Daemon stderr, collection phase and raw Terminal
output, and lifecycle/cleanup results; a failed launch still keeps its logs.
Temporary App data is still removed. A setup failure before a ready Bubble
opens a Project-owned diagnostic shell, waits for its raw-tty ready line, and
prints the original named setup error through it. This shell starts no Agent.
Failure to open or ready that shell still exits 2 with collector diagnostics.
Successful measurements continue to report through their measured shell.
These are recorder repairs; #3550 remains open for full-chain observations,
the measured production repair, shared Agent/shell input proof and idle/flood acceptance.

The [2026-10-25 unlocked-screen attempt](https://github.com/roundup-app/roundup/issues/3550#issuecomment-6399443183)
at `e4bfc80bc2bd3437d43f284c0b64aed1c08fbd8d` delivered all three reports, but
exited 2: each Daemon hop had zero samples. The full owner report and all three
run diagnostic directories' text are retained in
[the observations](perf-keystroke-mac-observations.json).

| Run | Load / 16 CPUs | End-to-end p50 / p95 | Dropped | Daemon-hop samples |
| --- | --- | --- | --- | --- |
| 1 | 2.677 / 16 | 6 / 10 ms | 0 | 0 |
| 2 | 2.270 / 16 | 6 / 10 ms | 0 | 0 |
| 3 | 2.120 / 16 | 6 / 10 ms | 0 | 0 |

These remain invalid full-chain observations. The recorder's keyboard driver
forced `keypress` after xterm already handled `keydown`, sending each OSC key
identity twice. The Daemon correctly marks repeated input identities ambiguous.
The existing no-window `r20_hop_report_accounts_for_the_echo_round_trip` now
uses the actual driver instead of paste: before the repair its queued write
contains two identical markers; after it, one key writes one marker and the
complete calibrated hop distribution still holds. The driver now makes keydown
cancelable, sends keypress only when keydown was not canceled, then sends keyup.
The existing Rust duplicate-identity proof remains. No tests were added or cut.

This repairs probe input, not production latency. The invalid reports above
remain retained; the first valid full-chain observation follows.

### Valid full-chain idle baseline (2026-10-25)

After #4047 merged, the [Mac observation at
`e2c9e2db8f94f3fc16841ed453cb5c7dfe613024`](https://github.com/roundup-app/roundup/issues/3550#issuecomment-6399945881)
exited 0. The [retained observations](perf-keystroke-mac-observations.json)
include the complete report, console output and all three diagnostic directories'
text. All earlier observations remain. The command was
`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --out target/perf-keystroke-before.json`
under `caffeinate -dis`, after a `--runs 0` prebuild (expected exit 2).

The host was an Apple M4 Max, 16 CPUs, 64 GiB, macOS 26.0.1 (25A362), on
AC power with `powermode 0` (automatic), no Low Power Mode line, unlocked and
untouched. Each run has 1000 measured keys, zero drops, WebGL, device pixel
ratio 2 and 1 ms timer resolution. All loads meet R20's quiet-machine threshold.

| Run | Load / CPU | End-to-end p50 / p95 | `parsed_to_frame` p50 / p95 | `dispatch_to_echo_event` p50 / p95 | Calibration uncertainty | Mean frame |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 5.4346 / 16 = 0.340 | 6 / 10 ms | 4 / 7 ms | 1 / 3 ms | ±1.308 ms | 8.322 ms |
| 2 | 3.4297 / 16 = 0.214 | 6 / 10 ms | 4 / 8 ms | 1 / 3 ms | ±1.601 ms | 8.339 ms |
| 3 | 3.3442 / 16 = 0.209 | 6 / 11 ms | 4 / 8 ms | 2 / 4 ms | ±2.000 ms | 8.339 ms |

**Dominant hop: `parsed_to_frame`.** Its p95 is 7/8/8 ms, versus the next
largest recorded span's 4 ms (`write_reply`, which overlaps the echo round trip).
This lead exceeds each run's reported calibration uncertainty. The dominant hop
uses the webview clock alone; its quantization is 1 ms. Cross-clock uncertainty
is reported separately above. Percentiles of overlapping spans are not additive;
these figures do not allocate exclusive shares of the end-to-end p95.

The Daemon receipt, physical write, echo read and encoding boundaries each have
1000 samples per run. Their p50/p95, calibration exchanges, renderer and timing
metadata are in the retained JSON. The original one-in-flight write queue is
still present. The largest cross-clock hop p95 is 2.075 ms; the measured queue
wait p95 is at most 1 ms. These idle results give no evidence for removing reply
serialization or replacing base64. The dominant wait is consistent with the
8.3 ms frame cadence; this is an inference, not proof of a production bottleneck.

These are before-repair idle observations. The reported slowdown beside another
Terminal's `yes` output has no full-chain native attribution yet.
[#4067](https://github.com/roundup-app/roundup/issues/4067) supplies the missing
isolated flood observer before another native request. R20's repeatable
Solo comparisons and R21's measured production repair, shared Agent/shell path
proof and final idle/flood observations remain open in #3550. Passing idle runs
do not establish that the flood regression is fixed. This evidence update changes
no production scheduling and requests no repeat of this idle baseline.


### Flood repair attempt (2026-10-29)

The [flood observation at `b6fe73f7`](https://github.com/roundup-app/roundup/issues/3550#issuecomment-6400874363)
(p95 19–20 ms, 0 dropped, `parsed_to_frame` p95 13 ms) is retained above. The
flooding Terminal is a visible Bubble in the same webview, so its parse loop
competes with the typing Terminal's frame. `screens.ts` now rests a backlogged
stream between chunks for as long as the chunk took (at most 8 ms), holding a
flooding Terminal to half the thread. `r21_backlogged_output_rests_as_long_as_each_chunk_took`
proves the rest. This is unmeasured natively: no <16 ms claim until one Mac
`just perf-keystroke --flood` rerun reports.

### Flood render work, adaptive chunks (#3550)

At `81d638f0` the flood misses (p95 19–20 ms) with parsed→frame the largest hop (12–13 ms against 7–8 idle). A parse cannot be interrupted, so the flooding Terminal's chunk is now sized from how fast the previous one parsed, to about 3 ms (512 to 8192 bytes), instead of a fixed 8 KB that could hold the thread for 8 ms before the typed echo's frame. The rest between chunks is unchanged. Proof without a window: `r21_flood_chunks_shrink_to_a_parse_the_echo_can_wait_behind`. No after-repair timing is claimed until the owner's Mac run.

### Flood render work, yield between frames (2026-10-30)

The owner's AC-power, Low Power Mode off observation at `f464337` still exits 1:

| Run | Load | p50 / p95 / p99 ms | Dropped | dispatch→daemon p95 | echo read→event p95 | parsed→frame p95 |
|---|---|---|---|---|---|---|
| 1 | 4.3 | 11 / 20 / 36 | 0 | 6 | 6 | 13 |
| 2 | 5.2 | 11 / 18 / 22 | 0 | 5 | 6 | 13 |
| 3 | 5.7 | 11 / 19 / 24 | 0 | 2 | 9 | 13 |

Renderer: WebGL, 8.3 ms frames (120 Hz). Adaptive chunks did not move native
latency. This continuation of #4879 keeps its chunk sizing, but replaces the
between-chunk timer with `requestAnimationFrame`: one backlog chunk resumes per
display frame, rather than repeated timer turns competing with that frame.
Queued contiguous output events coalesce up to the adaptive chunk limit, so
small events share one parse instead of taking one frame each. X14's existing
300-event flood observer caught that throughput regression before coalescing.
xterm's public `write` schedules the backlog chunk's parsing in a later task.
An isolated echo still writes immediately; streams retain their existing byte cap
and gap recovery. Flood throughput may fall as rendering gets more of the thread.

`r21_backlogged_output_yields_to_each_display_frame` replaces
`r21_backlogged_output_rests_as_long_as_each_chunk_took`: the timer-rest policy is
retired; the new observer proves no backlog restart between display frames.
`r21_flood_chunks_shrink_to_a_parse_the_echo_can_wait_behind` retains the adaptive
chunk/lossless-output proof, and `r21_agent_and_terminal_share_the_repaired_input_path`
retains the independent echo/input proof for both item kinds. X14's channel-byte
and U103's snapshot-order observers assert the complete ordered stream rather
than retired one-event-per-write boundaries; their byte, binary-type and snapshot
precedence assertions remain. These tests start
no native App. No native latency improvement is claimed. After merge, one
`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --flood` on the owner's Mac decides
whether all three runs have p95 < 16 ms and zero dropped keys; retain its complete
reports even on failure. R20/R21 and #3550 remain open until full acceptance holds.

Coalescing observer cleanup (rule 10):
`u34_output_is_handed_to_the_selected_terminals_emulator_in_order_and_none_is_sent_for_another`
is removed; `u11_only_the_selected_terminal_is_sent_output_and_it_reaches_its_emulator_in_order`
proves that same clause with ordered bytes independent of write boundaries.
`u34_the_real_emulator_is_constructed_with_a_bound_of_10_000_lines` and
`u34_the_factory_builds_its_real_emulator_with_xtermOptions` are replaced by
`u34_the_real_emulator_retains_only_10_000_scrollback_lines`, which writes past
the cap through a real factory-created emulator instead of copying config values.
U11's refused-subscription observer keeps its one semantic alert assertion;
its paragraph-tag and icon-shape assertions are retired as appearance checks.

### 2026-10-30: draw Turn gutters at render only

The owner's observation at `1cd37792e`, after #5103, still exits 1 on AC
power, idle and unlocked, with stray test browsers closed first:

| Flood run | Load | p50 / p95 / p99 ms | Dropped | dispatch→daemon p95 | echo read→event p95 | parsed→frame p95 |
|---|---|---|---|---|---|---|
| 1 | 4.0 | 11 / 19 / 23 | 0 | 7 | 4 | 13 |
| 2 | 4.8 | 11 / 19 / 25 | 0 | 7 | 5 | 14 |
| 3 | 6.1 | 11 / 19 / 24 | 0 | 6 | 5 | 13 |

The 120 Hz WebGL recorder still spends more than one frame in parsed→frame.
A window-free real-xterm observer found 198 gutter `clientHeight` reads while
parsing 200 output lines: `onScroll` fires per line, and each gutter draw
interleaves a layout read with style writes. `onWriteParsed` and `onResize`
repeat that work before `onRender` draws it again. The gutter now uses xterm's
existing `onRender` event for output, scroll and resize; no new scheduler is
introduced. Explicit shell marks retain their existing immediate updates.

`r21_flood_gutters_draw_once_per_frame_without_losing_turn_selection` reproduces
those 198 reads before the repair, then asserts zero during parsing and one at
the next render, with a gutter click selecting the complete 200-line Turn.
This continues #4879's adaptive scheduling, already preserved on main, and
changes no byte ordering or recorder boundary. It proves fewer layout reads,
not native latency. R20/R21 remain open. Before review, run
`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --flood` once on the owner's Mac at
the PR head and retain all three reports. Every run must have p95 < 16 ms and
zero dropped keys; another exit 1 keeps the measured render hop open, and exit
2 means the recorder needs repair. No after-repair native timing is claimed.
