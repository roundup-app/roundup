# Native motion run: the owner's Mac runbook

For U3010d (#3013). One command per workload, one paste back. This document claims no result. Acceptance uses scheduling evidence only; presentation stays unmeasured with no displayed-frame claim.

## Build

Base and head are the two commits U3010d compares; build and run each in its own checkout, alternating base, head, base, head, base, head. The recorder (U3010e) must be in both: for a base before it, cherry-pick `apps/desktop/src/perf/` and the `perf-frames` recipe onto it.

The historical pre-layer baseline is `843150f7ce0f09569c6eea1a6c21b076c92d2635`. For the final Motion migration, identify its pre-implementation source and final implementation head on #3013; apply the same observer-only overlay to both and retain source, patch and binary hashes.

## Before you run

- AC power on, Low Power Mode off, display refresh fixed (System Settings > Displays), no concurrent build, the window uncovered, the Mac awake and the screen session unlocked.
- No Project is needed: the run makes its own temporary Project with one Workstream and one Terminal under the 64 KiB/s stream, and ignores any Project you have open. Python 3 must be on the `PATH`: the all three motion workloads prepare the same `tree-40-native-v1` fixture using the stand-in Agents (`fake_claude.py`, no model call). The fixture derives the nested tree, names, Todo body/long title and Pad contents from `testing/seeds.ts`: its 38-node tree gains two Agent leaves, all eight Todos start open, and each of two owners has a three-level branch plus a reorder sibling. Ten Agents work. The selected streaming shell remains visible. Setup refuses existing Todos/Pads or any Rail beyond the measurement Workstream; it neither adopts nor deletes user data. It requires dark 1512×950 and identifies the actual reserved/overlay Shelf mode. A fixture not prepared within the existing ten-second setup bound is incomplete; never increase the bound.
- The command schedules one workload cycle every 2 s: `layers` the Drawer and Shelf open, close and reopen sequence, `todos` one insertion, completion, done-fold toggle or observed native pointer reorder, `glyphs` nothing beyond keeping ten working Glyphs under the stream. Glyphs uses page-driven preparation; Layers observes trusted pointer/key activation. For Todos, the page performs insertion, completion and done-fold; pointer reorder is observed, never generated (see implementation status). A control the command cannot find leaves the run invalid (exit 2).

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

## Observer implementation status (#4244)

Do not request another owner sequence from this partial observer. The three reports
already returned at `95e2219df28a5483a869415f72ed64c557fa555b` stay retained,
including their missing viewport and possibly disturbed Glyphs tail. They are
historical scheduling evidence, with presentation unmeasured.

The Layers driver samples displayed bounding boxes to reverse at the first
observed crossing of half the displacement from the displayed box captured at
trusted activation to the requested destination.
It refuses missing targets, absent displacement, a jump directly to the endpoint,
and movement not observed within the existing 400 ms settling bound. Drawer
open/close/reopen segments each wait for that observation, then Escape interrupts
the reopening segment. Shelf closes/opens/closes at the same measured boundaries,
then a trusted keyboard activation reopens it immediately. The report's `observer` retains the viewport, actual Shelf
mode and layer segments (targets, timestamps, start/destination/observed positions
and completion), with trusted pointer/key sources named explicitly. The observer
never generates those inputs or changes focus. Each activation has the existing
one-second input bound; geometry retains the 400 ms settling bound. A reversal
or key interruption arriving after the preceding segment reaches its endpoint
is refused. The action's start box and timestamp are read in the capture listener before
the existing layer owner receives the activation, rather than when the input
phase began waiting or in the task after propagation. Its first journal sample
retains that box; post-propagation samples cannot move the displacement origin.
A trusted pointer activation completes only when the existing owner acknowledges
the requested Drawer or Shelf state. Missing activation is retained as an incomplete action. The Drawer reversal
observes a trusted primary `pointerdown` on its existing leading hairline,
not the corner Close button while that button is outside the viewport. The
observed press must be on the panel itself within its computed border width,
and the existing Drawer owner must acknowledge `data-open=false` after
propagation. Content/padding presses and unapplied activations do not qualify.
The action journal names `.drawer` as that reversal target; no new hit region,
input generation or focus owner is introduced.

In an eventual qualified Mac Layers sequence, select the first original Todo
during warmup so its Open control is exposed; this is preparation, not a measured
open. Alternate Drawer and Shelf every two seconds during the sample. For Drawer, pointer-open a Todo, press the Drawer’s existing leading hairline to close,
pointer-reopen, then Escape from inside the Drawer. For Shelf, pointer-toggle
closed/open/closed, then activate its focused tab with Space or Return. Reverse
on each measured half-displacement, and interrupt the third segment while it is
still moving. The page observes the existing controls; it cannot supply native
pointer input. Late, synthetic or missing input makes the run invalid. This is an
observer implementation, not a request to perform that sequence: complete the
remaining qualifications below first.

The App now prepares the same deterministic derived fixture for layers, Todos and
Glyphs. `observer.fixture` retains canonical UTF-8 JSON bytes, SHA-256, logical
identity, allocated Rail/Todo/owner/blocker targets, Pads, working Agent ids and
streaming Terminal id. Its readback must match the fixture; all ten Glyphs must be
visible before sampling, and the selected streaming Terminal must remain visible.
Base and head must retain identical `bytes`/`sha256`; allocated ids are reported
separately and need not match. Preserve this entire observer overlay unchanged on
both immutable sources. This is a preparation implementation, not native evidence.

The Todo driver restores the original eight open rows in canonical order before each
four-action repeat. It deletes only its recorded temporary insertion, preserves
original owners, bodies, homes and blockers, and refuses changed fixture content.
Each repeat inserts a temporary root in alternating owner groups, completes it,
toggles the done fold, then observes a pointer reorder of that group's original
root sibling before its first root. The report's `todo_actions` names actual ids,
input sources and completion, including refused/unapplied actions. Restoration
RPC reorders are preparation and never counted as pointer gestures.

For the eventual qualified Mac procedure, Todo cycles 3, 7, 11, … are observed
input phases: move the original sibling (`todo 4`, then `todo 8`, alternating)
before that owner's first root (`todo 1`, then `todo 5`) using the native pointer.
The phase begins 6 seconds after sampling starts and repeats every 8 seconds;
release within its one-second input bound. The existing drag owner performs the
mutation and focus work. Missing trusted down/release, missing rows, cancellation
or an order not acknowledged within the existing 400 ms settling bound leaves
the action incomplete. Synthetic events and RPC-only order changes cannot pass
this phase. Do not perform these steps yet: this partial observer still needs the
remaining qualification below, and no new owner sequence is requested.

Before #4244 can close, demonstrate this setup and trusted pointer reorder on the
rendered observer, qualify the trusted layer interruption sequence in both Shelf cases and complete the measured live reduced
motion variants through the existing preference owner. The report marks its variant `unqualified` and explicitly marks native
qualification incomplete. A scheduling pass alone does not complete that work.

Before any new Mac request, #3013 also needs its separately scoped `crates/perf`
stream/idle repair: qualify the exact batches and received bytes and stop the load
before settled idle. This App change neither qualifies nor changes that producer.
Keep the existing warmup/sample/idle windows, stream rate, scheduling thresholds,
pairing, baselines and native permission unchanged.

### Live preference evidence

`observer.preference` records the initial App reduced-motion value and every live
change, using the same accessor already supplied to all App motion consumers.
Each entry retains the page's `performance.now()` timestamp and the driver phase
(`warmup`, `sample`, or `after-actions`). Compare these timestamps with the layer
samples before attributing a switch to a halfway crossing. `after-actions` means
the action driver returned; it does not assert that the stream stopped or that
settled idle was qualified. Recorder cleanup removes only its observation and
never the App's preference listener.

The page neither changes the OS preference nor supplies a second preference
owner. This journal alone does not qualify a live reduced-motion variant: a
switch still needs measured halfway and completed-action evidence for that
workload. Reports retain `variant: "unqualified"` until that exists. Do not ask
for a Mac sequence to fill this implementation gap.

### Chromium activation preparation (2026-10-27)

On the isolated U26 App in dark 1512×950, the derived fixture read back forty
Rail nodes, eight Todos and four Pads, with SHA-256
`40f860b17ca9495710305f4dc4372aa08be3792b0fd5ebccaddf988131eeda55`.
The fake App's existing spawn handler was adapted to retain the requested Agent
name and its signal handler to emit Status changes; this proves no native spawn.
A headless agent-browser pointer opened original Todo 1 through its existing
Open control. `domLayers` retained the activation box at left 1512, destination
952 and first observed halfway crossing at 1174.516845703125, with completion
true. The activation box precedes the post-propagation samples. This observation
qualifies that origin/crossing path only: no full interruption sequence, pointer
reorder, live halfway preference switch or native timing was qualified.

### Displacement at a live source change

During `sample`, a live preference change now retains `movement` when the last
trusted pointer layer segment is still visibly between its endpoints. It includes
the panel, actual action target, activation timestamp, origin, destination,
displayed left edge and signed displacement fraction. The read happens in the
shared accessor recorder's synchronous computation; it is not a later frame,
an animation-time percentage or the most recently sampled position. The initial
preference value, warmup/after-actions changes, missing/unactivated targets and
settled geometry carry no movement claim.

For a halfway switch, compare `movement.progress` with 0.5 and the segment's raw
samples. A change observed before halfway or without `movement` does not establish
the reduced-motion variant. This evidence alone never changes `variant` from
`unqualified`: completed trusted actions, both Shelf cases, and Todo/Glyph halfway
switches still require their rendered observer qualification. The page observes
the existing preference; it generates no OS preference change or input. No Mac
sequence is requested by this slice.
