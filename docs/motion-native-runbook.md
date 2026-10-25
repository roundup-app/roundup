# Native motion run: the owner's Mac runbook

For U3010d (#3013). One command per workload, one paste back. This document claims no result. Acceptance uses scheduling evidence only; presentation stays unmeasured with no displayed-frame claim.

## Build

Base and head are the two commits U3010d compares; build and run each in its own checkout, alternating base, head, base, head, base, head. The recorder (U3010e) must be in both: for a base before it, cherry-pick `apps/desktop/src/perf/` and the `perf-frames` recipe onto it.

The historical pre-layer baseline is `843150f7ce0f09569c6eea1a6c21b076c92d2635`. For the final Motion migration, identify its pre-implementation source and final implementation head on #3013; apply the same observer-only overlay to both and retain source, patch and binary hashes.

## Before you run

- AC power on, Low Power Mode off, display refresh fixed (System Settings > Displays), no concurrent build, the window uncovered, the Mac awake and the screen session unlocked.
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

## U3800 shared drag qualification

The `drag` workload runs the current shared Sortable, with forty Todos and the existing 64 KiB/s Terminal stream. It observes trusted native releases and Escape cancellations; it generates no pointer input. This is distinct from the already completed Pragmatic `drag-compatibility` probe in #3551, which must not be repeated.

```sh
ROUNDUP_ALLOW_WINDOW=1 just perf-frames drag
```

Use the build and machine controls above. Start dragging during the ten-second warm-up, then complete at least one gesture in every two-second window of the sixty-second sample. Repeat this sequence: move a Todo below another, drag it right into a child gap and release, move it back out, then drag and Escape. Keep the Terminal visible and streaming. Stop input for the thirty-second idle window. Missing gestures invalidate the run (exit 2); they never count as a performance pass. The report retains `dragActions.released` and `dragActions.cancelled` alongside the raw frame series and completed-action verdict. Verify both counts are nonzero and inspect the resulting order/parents; gesture counts alone establish no mutation result.

For the provisional installed dnd-kit candidate, retain three same-host reports, the commit and binary hashes, dependency versions and each failed command/exit. For the 10% regression check, alternate three base and three head runs. The base is main `a87bbeffc`; transfer only this head's `apps/desktop/src/perf/frame_run.ts` observer to a separate base checkout, retaining the base revision and observer-patch hash separately. The observer accepts the existing library drag marker as well as the new source marker, so both builds count actual gestures. Keep U3010d's thresholds and rule 7's 10% bound. Report presentation stages as unmeasured; scheduling evidence makes no displayed-frame claim. No Chromium result selects a WKWebView timing winner.

In a normal App build of that same commit, also exercise a Rail, Todo and Pad drag, Escape, a small-travel click and keyboard reorder. With Tauri file handling enabled, drop two real files into a Terminal and verify their quoted absolute paths arrive once. A failed internal drag or lost/duplicate path rejects this candidate; a missing native observation leaves qualification incomplete. Retain #3551's Pragmatic failure as its disqualification, not as evidence about this pointer-based implementation.
