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

The next step is the offline attribution prerequisite below, using the retained capture; it needs no build or new window. Only after an attributable native source is established, use this sequence for an authorized Mac run:

1. Build the source revisions first. Keep the existing three alternating base/head pairs, all workload variants, load/fixture, 10 s warmup, 60 s sample and 30 s idle. Use the same observer on both revisions. For an older base, transfer only the observer changes from the merged PR; retain the original source revision and the observer patch/binary hashes separately. No concurrent builds during sampling.
2. Start an all-process Instruments recording, then run the existing `ROUNDUP_ALLOW_WINDOW=1 just perf-frames <workload>` command. Stop recording after the report is written; save each `.trace` under a unique name beside its original scheduling JSON and diagnostics. Retain failures and missing-stage captures. Record Instruments/Xcode versions and settings along with the existing machine, fixture, load, binary and cleanup metadata. Keep the screen unlocked, awake and uncovered throughout; a locked screen invalidates the run.
3. In Instruments, identify the **actual** presentation endpoint of the WKWebView's frames and its one surface/display. Retain the attribution view with the trace. Do not combine different surfaces, displays or expected/actual lifetimes. If that track is unsupported or cannot be attributed, return the trace/table-of-contents and reason as **unmeasured**; do not manufacture timestamps or repeat the old callback-only observation as a presentation result.
4. Export only the tables needed for attribution, one at a time, with the installed `xcrun xctrace export`. First save the table of contents, then inspect its run numbers and schema names. Use a new output directory, retain stdout/stderr and check free space before each export. Do not run the bulk `instruments-analyzer` exporter: its parallel workers each unpack the trace and exhausted the owner's disk in the [2026-10-24 capture](https://github.com/saadshahd/roundup/issues/3013#issuecomment-6388867069). A failed export is retained as an observer error, never an empty successful series.

```sh
# Offline: uses the retained trace; opens no App or native window.
# Create a new directory first; never overwrite an earlier export.
mkdir /tmp/p3013-attribution
xcrun xctrace export --input /tmp/i3013/layers.trace --toc \
  --output /tmp/p3013-attribution/toc.xml
# Confirm number="1" and each schema in toc.xml before exporting it.
# Run each command separately; inspect its exit status, log and disk space before the next.
df -h /tmp
xcrun xctrace export --input /tmp/i3013/layers.trace \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="visual-chain"]' \
  --output /tmp/p3013-attribution/visual-chain.xml \
  > /tmp/p3013-attribution/visual-chain.log 2>&1
```

Repeat the single-table export for `visual-connection`, `process-info`, and `metal-known-compositor-process` only when present in the table of contents, each with its own XML/log. Start with the existing trace and existing `hitches-frame-lifetimes.xml`, `displayed-surfaces-interval.xml` and `display-surface-swap.xml` in `/tmp/i3013`; do not record another window to obtain these files. Stop on a failed export or unexpected disk growth and keep its diagnostics. These schema names are investigation targets observed in that trace, not a promise that they contain an ownership join.

### Attribution prerequisite before another capture

The owner's capture at `17e407711302654aedeb34350c69ba89c46a8a8d` did **not** establish an attributable presentation series. Its three surface ids (7, 12, 13) each ran at roughly 39 frames/s on a 120 Hz display, with a combined rate near 117 frames/s; the owner identified them as rotating display buffers, with no link to roundup or its WebContent process. A surface id and display id alone are insufficient. Do not rerun the same capture or use a lifetime endpoint as a WKWebView presentation just because its rate looks plausible.

```text
retained trace → ownership links + actual endpoint semantics → native input
missing link  → unmeasured; retain evidence, no interval distribution
```

Inspect the selected exports for an explicit chain from the recorded roundup/WebContent process identity through its rendered content to actual presentation events. Retain the field names, identifiers and matching rows for every link, including process lifetime, display identity and endpoint interpretation. Do not join by temporal proximity, matching numeric ids in unrelated namespaces, combined display refresh, or App pid alone. A render/commit/GPU-completion event is not an actual presentation. If no complete chain exists, return the exports and the missing link on #3013; keep presentation unmeasured and investigate a different native source before requesting another capture. [Apple distinguishes commit, render and presentation times](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app).

Only after verifying both ownership and actual endpoint semantics may a complete per-target timestamp series be normalized below. Derive the extraction from the observed schema and retain the exact query and raw rows; the previous `start_ns + duration_ns` query over a guessed `hitches-frame-lifetimes` surface is not valid evidence for this captured WKWebView. Never combine the three display-buffer series, filter late frames, zero-fill missing rows or substitute refresh ticks. Hash the retained trace files and keep a manifest mapping hashes to relative paths, plus the attribution evidence, with the report. A changed instrument schema requires renewed verification.

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

Paste both reports and retain the trace, clock conversion, raw exports, attribution and full run manifest. The 30 s idle observation, style/layout/paint attribution, cleanup and same-machine three-pair regression comparisons remain required, separate evidence. A passing imported presentation sample alone cannot close #3013. Request a new Mac capture only after the observer repair merges and the attribution prerequisite establishes a usable native source.
