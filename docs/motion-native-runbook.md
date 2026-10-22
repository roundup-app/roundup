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
