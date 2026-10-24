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

The next step is the **Metal ownership inspection** below, using the retained capture; it needs no build or new window. The earlier visual-connection inspection is complete and did not establish attribution. Only after an attributable native source is established, use this sequence for an authorized Mac run:

1. Build the source revisions first. Keep the existing three alternating base/head pairs, all workload variants, load/fixture, 10 s warmup, 60 s sample and 30 s idle. Use the same observer on both revisions. For an older base, transfer only the observer changes from the merged PR; retain the original source revision and the observer patch/binary hashes separately. No concurrent builds during sampling.
2. Start an all-process Instruments recording, then run the existing `ROUNDUP_ALLOW_WINDOW=1 just perf-frames <workload>` command. Stop recording after the report is written; save each `.trace` under a unique name beside its original scheduling JSON and diagnostics. Retain failures and missing-stage captures. Record Instruments/Xcode versions and settings along with the existing machine, fixture, load, binary and cleanup metadata. Keep the screen unlocked, awake and uncovered throughout; a locked screen invalidates the run.
3. In Instruments, identify the **actual** presentation endpoint of the WKWebView's frames and its one surface/display. Retain the attribution view with the trace. Do not combine different surfaces, displays or expected/actual lifetimes. If that track is unsupported or cannot be attributed, return the trace/table-of-contents and reason as **unmeasured**; do not manufacture timestamps or repeat the old callback-only observation as a presentation result.
4. Export only the tables needed for attribution, one at a time, with the installed `xcrun xctrace export`. First save the table of contents, then inspect its run numbers and schema names. Use a new output directory, retain stdout/stderr and check free space before each export. Do not run the bulk `instruments-analyzer` exporter: its parallel workers each unpack the trace and exhausted the owner's disk in the [2026-10-24 capture](https://github.com/saadshahd/roundup/issues/3013#issuecomment-6388867069). A failed export is retained as an observer error, never an empty successful series.

```sh
# Offline: uses the retained trace; opens no App or native window.
# Create a new directory first; never overwrite an earlier export.
mkdir /tmp/p3013-metal
xcrun xctrace export --input /tmp/i3013/layers.trace --toc \
  --output /tmp/p3013-metal/toc.xml
# Confirm number="1" and each schema in toc.xml before exporting it.
# Run each command separately; inspect its exit status, log and disk space before the next.
df -h /tmp
xcrun xctrace export --input /tmp/i3013/layers.trace \
  --xpath '/trace-toc/run[@number="1"]/data/table[@schema="metal-io-surface-access"]' \
  --output /tmp/p3013-metal/metal-io-surface-access.xml \
  > /tmp/p3013-metal/metal-io-surface-access.log 2>&1
metal_export_status=$?
echo "$metal_export_status" > /tmp/p3013-metal/metal-io-surface-access.exit
df -h /tmp
```

Inspect the exit file, log, output size and free space before proceeding. Only on exit 0 and no unexpected disk growth, repeat this single-table export for `metal-object-dependency-chain-display`, with its own XML/log/exit files, if present in the saved table of contents. Stop after these two tables; do not export `kdebug` or bulk-export the trace. A schema-only result is a successful empty export; a failed export is an observer error. Retain both distinctly.

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

### Metal ownership inspection (offline, before another capture)

The retained trace's table of contents also lists `metal-io-surface-access` and `metal-object-dependency-chain-display`. Their **rows and field semantics remain unchecked**. Inspect these native Metal event sources for an explicit ownership relation; their names are not evidence that a relation exists. This inspection neither starts a new recording nor changes the App, renderer or permissions.

```text
recorded process lifetime → rendered-content identity → displayed surface → actual endpoint
Metal access/completion alone → ownership candidate only; presentation stays unmeasured
```

Use the two sequential exports above and the existing `/tmp/i3013` presentation XML and `/tmp/i3013-x2/process-info.xml`. Return each schema, total row count, exit/log and the matching rows for any claimed link. Keep the original XML files, their SHA-256 hashes, and referenced definitions: an xctrace `ref` may point to an earlier row, so a matching row without its definitions is insufficient. If a table is large, share its schema and the relevant rows plus referenced definitions, retaining the full file on the Mac. Do not paste the entire process table again. If no matching row exists, report that explicitly; do not invent a join from similar values.

For any candidate link, establish the identifier's namespace and lifetime from the actual schema and instrument interpretation. A Metal resource, IOSurface, display swap buffer and visual connection are not interchangeable identities. GPU access or completion does not show when the window server displayed that content. Retain the field names and rows for **every** ownership link and an independently established actual presentation endpoint, including display and clock origins. Do not join by temporal proximity, matching numeric ids in unrelated namespaces, combined display refresh, or App pid alone. [Apple distinguishes commit, render and presentation times](https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app).

| Inspection result | Next action |
| --- | --- |
| Explicit ownership chain and actual endpoint semantics established | Derive an extractor from those observed rows; test it without a window, merge, then request the fixed paired sequence |
| Only resource ownership, GPU work, empty tables or an ambiguous join | Keep presentation unmeasured; return the missing link on #3013; no new timing run |
| Export failure or unexpected disk growth | Stop, retain diagnostics; no empty-series substitution or further exports |

No extractor is implemented from an unobserved schema. The offline inspection is the remaining Mac-only evidence request for this slice; it builds nothing and opens no window. It is not the remaining full workload sequence.

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

Paste both reports and retain the trace, clock conversion, raw exports, attribution and full run manifest. The 30 s idle observation, style/layout/paint attribution, cleanup and same-machine three-pair regression comparisons remain required, separate evidence. A passing imported presentation sample alone cannot close #3013. Request a new Mac capture only after the observer repair merges and the attribution prerequisite establishes a usable native source.
