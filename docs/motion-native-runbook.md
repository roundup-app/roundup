# Native motion run: the owner's Mac runbook

For U3010d (#3013). Native scheduling procedure and retained owner observations; no displayed-frame claim.

## Build

Base and head are the two commits U3010d compares; build and run each in its own checkout, alternating base, head, base, head, base, head. The recorder (U3010e) must be in both: for a base before it, cherry-pick `apps/desktop/src/perf/` and the `perf-frames` recipe onto it.

## Returned owner observation for #3013 (2026-10-25)

The requested sequence is complete. [The owner returned all three scheduling reports](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399603127) from measurement revision `95e2219df28a5483a869415f72ed64c557fa555b`, following this runbook at `9b005c00230c2f43989f78b534cac0851574147f` (PR #4035). That PR already retired the presentation-only acceptance clauses and repaired scheduling verdicts. Do not repeat this request or reinterpret the older `incomplete` verdicts as scheduling failures.

| Scheduling, milliseconds unless noted | Layers | Todos | Glyphs |
| --- | --- | --- | --- |
| Sample count | 7160 | 7199 | 7200 |
| p50 / p95 / p99 | 8 / 11 / 12 | 8 / 10 / 11 | 8 / 10 / 11 |
| Maximum | 26 | 14 | 15 |
| Intervals >12.5 ms | 61 (0.852%) | 7 (0.097%) | 1 (0.014%) |
| Idle p95 / maximum | 10 / 11 | 10 / 11 | 10 / 14 |
| Recorder exit / verdict | 0 / pass | 0 / pass | 0 / pass |

Recomputation from the posted raw interval arrays agrees with every sample/idle count, nearest-rank percentile, maximum and long-interval rate. All three reports have empty `invalid` lists and meet the absolute scheduling thresholds at recorded 120 Hz (P=8.333 ms): p95 ≤12.5 ms, p99 ≤25 ms, long rate ≤5%, maximum ≤50 ms. These are recorder results, not full protocol acceptance. Presentation, style, layout, paint and compositor remain explicitly unmeasured; `update` measures aggregate main-thread update cost only. No displayed-frame claim follows.

The owner reports release builds on a MacBook Pro Mac16,6, M4 Max, 16 CPUs, 64 GB, macOS 26.0.1 (25A362), system WebKit `21622.1.22.11.15` (UA `AppleWebKit/605.1.15`), built-in Retina display, AC power and Low Power Mode off. Each command was `caffeinate -dis env ROUNDUP_ALLOW_WINDOW=1 just perf-frames <workload>`, sequentially after a fresh frozen-lockfile install, with the screen unlocked and no user input. Starting loads were 5.46, 3.00 and 2.22. The viewport was not recorded; the reports' 120 Hz is not an independent fixed-display-setting record. Another job may have briefly started `pnpm install` near the Glyphs sample/idle boundary; retain that attempt as possibly disturbed, not clean comparison evidence.

Raw reports and diagnostics remain on the Issue and Mac:

| Workload | Raw report | Report SHA-256, as supplied by owner | Mac diagnostics |
| --- | --- | --- | --- |
| Layers | [JSON](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399603386) | `82311d7b4ae021f941db0ba9ee5480ddc9630c2c579735406fa5ee2aeec6b4b7` | `target/perf-frames-zFqLPu` |
| Todos | [JSON](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399603640) | `81e3697b0c55bdcbcb3b2ed490f810fc8ba1f4ef67342b3fdb000df0c3e09198` | `target/perf-frames-dCMjJQ` |
| Glyphs | [JSON part 1](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399603901), [part 2](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399604138) | `fe082cc1827e4738183456a9b4a351f30ba79767b069ad8411ec5fd649921a3a` | `target/perf-frames-7bIDOP` |

The report JSON was reformatted for comments; the listed hashes identify the original files and matching diagnostics `report.json`, not the comment text. Complete report arrays were posted (concatenate the two Glyphs JSON blocks). Diagnostics comments for [Layers](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399604401), [Todos](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399604659) and [Glyphs](https://github.com/roundup-app/roundup/issues/3013#issuecomment-6399604922) truncate large collection files and build logs; keep the full originals in `/tmp/roundup-motion-3013` and logs `/tmp/perf-3013-{layers,todos,glyphs}.log`. Reported collection errors are null and App stdout/stderr empty; the lifecycle files record cleanup initiation/status, not an independently verified zero-survivor inventory.

Keep earlier valid and failed attempts too: the `ce9c8f2f7` Layers scheduling result and `/tmp/p3013-out3`, the locked-screen `1f1b9a991` failure in `/tmp/p3013-out4`, and the historical presentation investigations below. None is overwritten by this sequence.

## Before another native request

#3013 stays open. The returned sequence supplies no three alternating immutable baseline/head pairs or paired median regression result. It also does not establish the final dense fixture, reserved/overlay variants or live reduced-motion cases required by `docs/motion.md`, **Native performance protocol**. Missing viewport, fixture/action hashes, stream byte/batch receipts and separate style/layout/paint records cannot be recovered from percentile summaries.

The existing `apps/desktop/src/perf/frame_run.ts`, function `prepare`, seeds four flat Todos for Layers/Todos; `layersCycle` reverses after a fixed 90 ms rather than observed 50% displacement. It has no reserved/overlay or live reduced-motion run selection. These are observer coverage gaps, not demonstrated production motion-budget failures. [#3821](https://github.com/roundup-app/roundup/issues/3821) already owns U3010a–d's final Motion implementation and performance observers; finish and qualify those observers there before requesting full native acceptance. Prove fixture/action/report validity through existing fake App/clock tests without starting a window; retain rendered calibration separately. Do not invent an optimisation from these passing samples.

Before a paired Mac request, retain the exact final implementation head, its pre-implementation baseline and a qualified identical observer-only overlay on both. The historical pre-layer baseline is `843150f7ce0f09569c6eea1a6c21b076c92d2635`; neither this verdict repair's parent nor a newer convenient commit replaces it. Preserve source production code, fixture identity, patch and binary hashes, existing timing/load rules and every failed run. The final Motion migration's comparison must identify its own pre-implementation source explicitly. Request only the remaining protocol once preparation is complete; no further presentation collection or native permission is required.

## Before you run

- AC power on, Low Power Mode off, display refresh fixed (System Settings > Displays), no concurrent build, the window uncovered, the Mac awake and the screen session unlocked.
- No Project is needed: the run makes its own temporary Project with one Workstream and one Terminal under the 64 KiB/s stream, and ignores any Project you have open. Python 3 must be on the `PATH`: the `glyphs` run starts ten stand-in Agents (`fake_claude.py`, no model call) and tells each it works. `layers` and `todos` first make four Todos.
- The command drives the workload itself, every 2 s: `layers` the Drawer and Shelf open, close and reopen sequence, `todos` one insertion, completion, done-fold toggle or reorder, `glyphs` nothing beyond keeping ten working Glyphs under the stream. Touch nothing in the window. A control the command cannot find leaves the run invalid (exit 2).

## Run

```
ROUNDUP_ALLOW_WINDOW=1 just perf-frames <layers|todos|glyphs>
```

It builds the App with the recorder, opens a window kept above everything for about 100 s (10 s warm-up, 60 s sample, 30 s idle) under the 64 KiB/s Terminal stream, and writes the report to `target/perf-frames-<workload>.json`. Set `ROUNDUP_ALLOW_WINDOW=1` only for this run; no agent or CI job sets it.

## What the report measures

`stages.scheduling` is the `requestAnimationFrame` interval series the thresholds judge. `stages.update` is the main-thread cost of each sample frame's rendering update (style, layout and paint recording together, from the animation callback to the next task); it has no threshold and is not displayed time. `stages.presentation` stays `unmeasured` in the page report, its reason naming the entry types the webview lists (`performance_entry_types`). Presentation is outside acceptance under the owner’s 2026-10-25 direction on #3013; callback timing never fills this stage or proves displayed frames.

## Exit codes

| Code | Meaning | Decides |
| --- | --- | --- |
| 0 | valid scheduling sample meets thresholds | scheduling passes for this run; all workloads and paired comparisons still required |
| 1 | a valid sample misses the scheduling thresholds | diagnose and repair; keep the report |
| 2 | invalid run or no scheduling report | incomplete: retain diagnostics and repeat after repairing the cause |

## Paste back into #3013

````
Report (contents of target/perf-frames-<workload>.json):
<paste>

Base: <commit>   Head: <commit>
Hardware: <model, chip, RAM>
macOS: <version>   WebKit: <Safari/WebKit version>
Display: <Hz>   Power: <AC or battery, Low Power Mode on or off>
````

## Historical native presentation investigation (retired)

The remaining sections retain failed source investigations and importer documentation. They are historical, not instructions for another capture. The owner retired this acceptance stage on 2026-10-25 and closed #3776 as not planned. No presentation collector, export or native permission is requested; unmeasured presentation does not block scheduling acceptance.

The page cannot fill `stages.presentation`. `perf-presentation` consumes a separate native export; it never starts a window, sends input or changes the scheduling report. Its tests use invented timestamps and prove report validity only. No native presentation result is claimed by those tests.

Use Xcode Instruments' **Animation Hitches** instrument, recording all processes so the WKWebView's WebContent/render-server work is included. [Apple describes its frame lifetime and displayed-frame tracks](https://developer.apple.com/documentation/xcode/improving-app-responsiveness). Availability for this Mac, display and WKWebView must be established by the trace, not by the template's name. A vsync track alone measures display opportunities; callback, commit, GPU completion, expected presentation and hitch-only rows cannot supply actual presentation intervals.

The retained trace has completed both ownership inspections below without establishing an attributable source. **No further export or timing run is requested.** First establish a different source with an explicit ownership chain and actual endpoint semantics; then use this sequence for an authorized Mac run:

1. Build the source revisions first. Keep the existing three alternating base/head pairs, all workload variants, load/fixture, 10 s warmup, 60 s sample and 30 s idle. Use the same observer on both revisions. For an older base, transfer only the observer changes from the merged PR; retain the original source revision and the observer patch/binary hashes separately. No concurrent builds during sampling.
2. Start an all-process Instruments recording, then run the existing `ROUNDUP_ALLOW_WINDOW=1 just perf-frames <workload>` command. Stop recording after the report is written; save each `.trace` under a unique name beside its original scheduling JSON and diagnostics. Retain failures and missing-stage captures. Record Instruments/Xcode versions and settings along with the existing machine, fixture, load, binary and cleanup metadata. Keep the screen unlocked, awake and uncovered throughout; a locked screen invalidates the run.
3. In Instruments, identify the **actual** presentation endpoint of the WKWebView's frames and its one surface/display. Retain the attribution view with the trace. Do not combine different surfaces, displays or expected/actual lifetimes. If that track is unsupported or cannot be attributed, return the trace/table-of-contents and reason as **unmeasured**; do not manufacture timestamps or repeat the old callback-only observation as a presentation result.
4. Export only the tables needed for attribution, one at a time, with the installed `xcrun xctrace export`. First save the table of contents, then inspect its run numbers and schema names. Use a new output directory, retain stdout/stderr and check free space before each export. Do not run the bulk `instruments-analyzer` exporter: its parallel workers each unpack the trace and exhausted the owner's disk in the [2026-10-24 capture](https://github.com/saadshahd/roundup/issues/3013#issuecomment-6388867069). A failed export is retained as an observer error, never an empty successful series.

### Attribution prerequisite before another capture

The owner's capture at `17e407711302654aedeb34350c69ba89c46a8a8d` did **not** establish an attributable presentation series. Its three surface ids (7, 12, 13) each ran at roughly 39 frames/s on a 120 Hz display, with a combined rate near 117 frames/s; the owner identified them as rotating display buffers, with no link to roundup or its WebContent process. A surface id and display id alone are insufficient. Do not rerun the same capture or use a lifetime endpoint as a WKWebView presentation just because its rate looks plausible.

```text
retained trace → ownership links + actual endpoint semantics → native input
missing link  → unmeasured; retain evidence, no interval distribution
```

The [owner's completed offline export](https://github.com/saadshahd/roundup/issues/3013#issuecomment-6389100337) found:

| Source | Observed result | Missing link |
| --- | --- | --- |
| `visual-chain` | 28 rows of connection UUID chains and route `CB` | No process or surface identity |
| `visual-connection` | Schema only, zero rows, export exit 0 | No source/sink relation for those UUIDs |
| `process-info` | 5,355 rows, including roundup and WebContent identities | No display, layer or surface identity |
| `metal-known-compositor-process` | One row identifying WindowServer | No relation to roundup/WebContent content |

Those four exports cannot establish attribution. Keep `/tmp/i3013-x2` and its logs; do not repeat them or reinterpret their absence as a presentation-budget failure.

### Completed Metal ownership inspection

The [owner's completed Metal export](https://github.com/saadshahd/roundup/issues/3013#issuecomment-6389400184) at `626e639af` also failed to establish attribution. Both sequential exports exited 0; free space remained 433 GiB. Retain the full XML, referenced definitions, per-file hashes and logs in `/tmp/i3013-x3`; do not repeat these exports.

| Source | Rows / bytes | Observed limit |
| --- | --- | --- |
| `metal-io-surface-access` | 124,477 / 56,827,450 | GPU access records have process/surface fields, but no display, window, layer or actual presentation event |
| `metal-object-dependency-chain-display` | 11,301 / 3,096,745 | Dependency rows have in/out times, root/block ids, colour and track; no process, surface or display fields |

The access table contains eight roundup rows, all on tiny 64×64 or 128×64 surfaces, and zero rows for the three identified WebContent pids. The WebKit GPU process has 256 rows on thirteen surfaces, none shared with WindowServer. Numeric surface ids occur with different sizes and unrelated processes, so equality alone does not establish the same rendered content over time. The single roundup segment/root numeric match is 10.5 s apart and has different engineering types; it is not an ownership join. A dependency out-time is not an independently established display endpoint.

```text
process → rendered content → displayed surface → actual endpoint
         missing links in the retained trace
```

Presentation remains unmeasured. No timestamp extractor can be derived from these rows, and another run of the same capture would not repair their missing semantics. Keep the original scheduling reports separate; these failed attribution attempts demonstrate no presentation-budget failure.

### Source capability required before another Mac request

The then-proposed engineering step was to establish a source that exposes both target identity and actual presentation times without a new native permission. Retain the field names, rows, referenced definitions, identifier namespaces and lifetimes for every ownership link; do not join by temporal proximity, equal numbers in unrelated namespaces, combined refresh or App pid alone. [Apple distinguishes commit, render and presentation times](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app). It must identify its clock/resolution, distinguish dropped frames from displayed frames and provide complete coverage of the fixed sample window. Review its API or observed schema before writing a collector; test extraction and refusal of unsupported evidence without starting a window. That proposed prerequisite is retired; the remaining sequence uses scheduling evidence.

Two native API names do not supply that missing source:

| Candidate | Capability checked | Why it cannot fill this report |
| --- | --- | --- |
| WKWebView `_doAfterNextPresentationUpdate:` | [WebKit implementation at `e381818e`](https://github.com/WebKit/WebKit/blob/e381818e3a0e7ec7883904754024b603c2fb2272/Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm), method of that name | Its source describes a callback after the next WebProcess transaction. The callback supplies no actual display timestamp or complete per-frame series; measuring its invocation would substitute another callback clock. This is upstream source research, not a claim about the installed WebKit build. |
| Metal `MTLDrawable.presentedTime` | [Apple's displayed-time property](https://developer.apple.com/documentation/metal/mtldrawable/presentedtime) and [drawable ownership](https://developer.apple.com/documentation/metal/mtldrawable) | It is an actual endpoint for an owned drawable (zero for an unpresented/dropped frame). No WKWebView-to-drawable ownership relation has been established here. A separate Metal layer would measure that layer rather than roundup's existing rendered content. |

Neither a private callback hook nor a new renderer is justified by these findings. Source unavailability stays an engineering gap on #3013, with acceptance open; it does not authorize a new permission, relaxed thresholds, inferred FPS or another callback-only timing request.

### Alternative source considered: ScreenCaptureKit

ScreenCaptureKit can select [specific windows on a display](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:including:)), and Apple defines [`SCStreamFrameInfo.displayTime`](https://developer.apple.com/documentation/screencapturekit/scstreamframeinfo/displaytime) as a WindowServer display timestamp. These offer a candidate identity and endpoint, unlike page callbacks. They do not establish a complete WKWebView presentation series: [`minimumFrameInterval`](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/minimumframeinterval) throttles delivery, and [a complete frame status](https://developer.apple.com/documentation/screencapturekit/scframestatus/complete) describes a generated capture buffer, not proof that none were omitted. Captured window updates would also need to distinguish Terminal changes from the animated content before supporting a smoothness claim.

[Apple's capture sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) requires Screen Recording permission. U3010d authorizes no new native permission, so this runbook does not prescribe that sample, a permission prompt or a capture helper. Even with existing access, a stream must not set `all_frames: true` merely because its requested capture rate matches the display. This is source research, not a supported observer or a request for a ScreenCaptureKit run.

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

Paste both reports and retain the trace, clock conversion, raw exports, attribution and full run manifest. The 30 s idle observation, style/layout/paint attribution, cleanup and same-machine three-pair regression comparisons remain required, separate evidence. A passing imported presentation sample alone cannot close #3013. No further presentation capture is requested.
