# Native motion run: the owner's Mac runbook

For U3010d (#3013). One command per workload, one paste back. This document claims no result.

## Build

Base and head are the two commits U3010d compares; build and run each in its own checkout, alternating base, head, base, head, base, head. The recorder (U3010e) must be in both: for a base before it, cherry-pick `apps/desktop/src/perf/` and the `perf-frames` recipe onto it.

## Before you run

- AC power on, Low Power Mode off, display refresh fixed (System Settings > Displays), no concurrent build, the window uncovered and the Mac awake.
- No Project is needed: the run makes its own temporary Project with one Workstream and one Terminal under the 64 KiB/s stream, and ignores any Project you have open. Python 3 must be on the `PATH`: the `glyphs` run starts ten stand-in Agents (`fake_claude.py`, no model call) and tells each it works. `layers` and `todos` first make four Todos.
- The command drives the workload itself, every 2 s: `layers` the Drawer and Shelf open, close and reopen sequence, `todos` one insertion, completion, done-fold toggle or reorder, `glyphs` nothing beyond keeping ten working Glyphs under the stream. Touch nothing in the window. A control the command cannot find leaves the run invalid (exit 2).

## Run

```
ROUNDUP_ALLOW_WINDOW=1 just perf-frames <layers|todos|glyphs>
```

It builds the App with the recorder, opens a window kept above everything for about 100 s (10 s warm-up, 60 s sample, 30 s idle) under the 64 KiB/s Terminal stream, and writes the report to `target/perf-frames-<workload>.json`. Set `ROUNDUP_ALLOW_WINDOW=1` only for this run; no agent or CI job sets it.

## What the report measures

`stages.scheduling` is the `requestAnimationFrame` interval series the thresholds judge. `stages.update` is the main-thread cost of each sample frame's rendering update (style, layout and paint recording together, from the animation callback to the next task); it has no threshold and is not displayed time. `stages.presentation` stays `unmeasured` in the page report, its reason naming the entry types the webview lists (`performance_entry_types`). The native presentation procedure below supplies a separate report; callback timing never fills this stage.

## Exit codes

| Code | Meaning | Decides |
| --- | --- | --- |
| 0 | every required stage measured and passing | acceptance evidence complete (never printed while presentation is unmeasured) |
| 1 | a valid sample misses the scheduling thresholds | diagnose and repair; keep the report |
| 2 | invalid run, unmeasured stage or no report | incomplete: repeat an invalid run; an unmeasured presentation stage leaves U3010d incomplete even when scheduling passes |

## Paste back into #3013

````
Report (contents of target/perf-frames-<workload>.json):
<paste>

Base: <commit>   Head: <commit>
Hardware: <model, chip, RAM>
macOS: <version>   WebKit: <Safari/WebKit version>
Display: <Hz>   Power: <AC or battery, Low Power Mode on or off>
````

## Native presentation evidence (after the observer PR merges)

The page cannot fill `stages.presentation`. `perf-presentation` consumes a separate native export; it never starts a window, sends input or changes the scheduling report. Its tests use invented timestamps and prove report validity only. No native presentation result is claimed by those tests.

Use Xcode Instruments' **Animation Hitches** instrument, recording all processes so the WKWebView's WebContent/render-server work is included. [Apple describes its frame lifetime and displayed-frame tracks](https://developer.apple.com/documentation/xcode/improving-app-responsiveness). Availability for this Mac, display and WKWebView must be established by the trace, not by the template's name. A vsync track alone measures display opportunities; callback, commit, GPU completion, expected presentation and hitch-only rows cannot supply actual presentation intervals.

For the next authorized Mac sequence:

1. Build the source revisions first. Keep the existing three alternating base/head pairs, all workload variants, load/fixture, 10 s warmup, 60 s sample and 30 s idle. Use the same observer on both revisions. For an older base, transfer only the observer changes from the merged PR; retain the original source revision and the observer patch/binary hashes separately. No concurrent builds during sampling.
2. Start an all-process Instruments recording, then run the existing `ROUNDUP_ALLOW_WINDOW=1 just perf-frames <workload>` command. Stop recording after the report is written; save each `.trace` under a unique name beside its original scheduling JSON and diagnostics. Retain failures and missing-stage captures. Record Instruments/Xcode versions and settings along with the existing machine, fixture, load, binary and cleanup metadata. Keep the screen unlocked, awake and uncovered throughout; a locked screen invalidates the run.
3. In Instruments, identify the **actual** presentation endpoint of the WKWebView's frames and its one surface/display. Retain the attribution view with the trace. Do not combine different surfaces, displays or expected/actual lifetimes. If that track is unsupported or cannot be attributed, return the trace/table-of-contents and reason as **unmeasured**; do not manufacture timestamps or repeat the old callback-only observation as a presentation result.
4. Export the native data. Reuse [instruments-analyzer](https://github.com/jlreyes/instruments-analyzer) at commit `647a8f4da2f14cb146014152be0526484634f272` (its script uses `uv` to supply DuckDB/PyArrow/lxml). In a separate scratch checkout of that tool, run `uv run scripts/export_to_duckdb.py /absolute/run.trace /absolute/run.duckdb`. Retain its stdout/stderr and original XML exports (`xcrun xctrace export --input /absolute/run.trace --toc --output /absolute/toc.xml` identifies supported tables). A supported `hitches-frame-lifetimes` table becomes `hitches_frame_lifetimes`. Only when Instruments confirms its endpoints are actual presentations for the selected surface/display, use the query below. Empty or unsupported tables leave the stage unmeasured. No custom XML parser or guessed table schema is used here.

```sql
-- Run with duckdb run.duckdb; replace both identity values with the attributed ones.
-- Retain the full surface series, including the frames bracketing the sample.
SELECT to_json(list(start_ns + duration_ns ORDER BY start_ns + duration_ns)) AS timestamps_ns
FROM hitches_frame_lifetimes
WHERE surface_id = <WKWebView surface> AND display = '<fixed display>';
```

A lifetime's duration is NOT a presented-frame interval: the query uses its actual ending instant; the consumer differences consecutive ending instants. Verify that interpretation against the native track before using the query. Retain the query, trace hash and attribution evidence. Do not filter out late frames, zero-fill missing rows or substitute refresh ticks. Exported data from an instrument version with different semantics needs investigation, not relabelling.

The scheduling JSON now records `windows_epoch_ms.sample_start`, `sample_end` and `idle_end` using `performance.timeOrigin` plus the first recorder callback and the fixed protocol windows. They exclude setup and warmup. Convert `sample_start` to trace-relative nanoseconds by subtracting the trace's start epoch (from its run metadata), then multiplying milliseconds by 1,000,000. Retain both clock origins, conversion and their resolution; a clock change, unalignable origins or resolution coarser than the display period invalidates the observation. Do not choose a favourable subwindow. Check the scheduling report's `invalid` list before attributing its matching native sample.

Normalize the native export to this JSON shape. Angle-bracket values are observed metadata, not defaults; `timestamps_ns` is the native query's numeric array, including a presentation at/before sample start and at/after sample end. `resolution_ns` is the effective instrument AND clock-alignment resolution, not the number of digits exported. `all_frames` is true only for a complete attributed presentation series, never a hitch list. Keep this input file with the original trace and scheduling report.

```json
{
  "source": {
    "stage": "presentation",
    "tool": "<Instruments and Xcode versions>",
    "trace": "<retained .trace path and SHA-256>",
    "schema": "<verified actual-presentation table and endpoint interpretation>",
    "target": "<WKWebView attribution evidence, surface and display>",
    "all_frames": true
  },
  "revision": "<full immutable source SHA>",
  "workload": "layers",
  "refresh_hz": 120,
  "resolution_ns": 1000000,
  "sample_start_ns": 0,
  "timestamps_ns": []
}
```

The example's empty array deliberately cannot pass. Replace its refresh, resolution, start and samples with observed values, then run this offline command from roundup (it needs no `ROUNDUP_ALLOW_WINDOW`):

```sh
cargo run --release -p perf --bin perf-presentation -- \
  --input /absolute/native-input.json --out /absolute/presentation-report.json
```

The consumer retains raw timestamps and intervals, nearest-rank p50/p95/p99/max and the >1.5P count/rate. It applies U3010d's existing presentation thresholds independently. It refuses incomplete coverage, duplicate/reversed timestamps, missing provenance, a callback stage or insufficient resolution; it includes intervals crossing the sample boundaries so cropping cannot hide a late frame. Exit 1 means a measured presentation budget miss; exit 2 means invalid/unmeasured evidence or a passing **single stage** with full acceptance still incomplete. This command never exits 0, never overwrites an existing output and never promotes the page's scheduling report to a presentation pass.

Paste both reports and retain the trace, clock conversion, raw exports, attribution and full run manifest. The 30 s idle observation, style/layout/paint attribution, cleanup and same-machine three-pair regression comparisons remain required, separate evidence. A passing imported presentation sample alone cannot close #3013. Request this Mac observation only after the observer PR merges.
