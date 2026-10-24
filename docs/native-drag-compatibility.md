# Native drag compatibility for U3800

This is the first qualification step for #3540, before implementing or selecting a replacement. It supplies no frame comparison or finished-design acceptance. The probe installs Pragmatic 4.0.0 and hitbox 3.0.0 only in an opt-in measurement build. Normal builds retain the existing Sortable and omit the probe.

## Build and launch on macOS

Check out the exact head of draft PR #3551 into its own worktree. Record `git rev-parse HEAD` with the results. Install with `pnpm install`, then run:

```sh
ROUNDUP_ALLOW_WINDOW=1 just perf-frames drag-compatibility
```

The existing native runner builds the App, starts its own temporary Project/data directories and a 64 KiB/s Terminal, and opens a window above other windows. It does not use your Projects or credentials. Finish within four minutes, the runner's existing report bound. Do not disable Tauri's file-drop handler. Use a 1512×950 window, dark appearance. This is a manual compatibility run; unlike the other frame workloads, it waits for your actions.

## Observe in order

| Step | Required result | What it decides |
| --- | --- | --- |
| Drag A to the bottom edge of B, then release. | Moves reads `[{"id":"A","parent":null,"index":1}]`; the rows are B,A,C. | Internal native drag reaches the drop callback with file-drop handling enabled. |
| Drag A into the middle of C, then release. | Moves appends `{"id":"A","parent":"C","index":0}`; A appears indented below C. | The native tree hitbox can select a child destination. |
| Drag B over C, press Escape, then release. | Moves still has two entries; Cancelled is 1; B remains at the root. | Native cancellation reaches the library without a mutation. |
| Press B, move less than 4 CSS px, and release; also click B without moving. | Each click increments Clicks once, without another move or trusted drag start. | The OS activation threshold preserves a click; record if its threshold differs from the App's 4 px contract. |
| Drag two real files from Finder onto the uncovered Terminal beside the panel. Include a space and an apostrophe in the file names, e.g. `My Pics/it's.png`. | Native file events has one drop with the identical ordered absolute paths. The Terminal receives each quoted path once. Moves and Trusted starts do not change. | Real path delivery coexists with internal native drag. A DOM `File` name is insufficient. |
| Drag B below C, release, then click Finish compatibility probe. | One more root move appears; the report is saved. | A cancelled drag and an external file drop leave internal dragging usable. |

A native operation that never starts, never lands, or loses/duplicates file paths is a compatibility failure. Preserve the report even on failure; click Finish to save the observed counters and raw native file-drop payloads. Inspect the Terminal as well: a native event by itself does not prove delivery by its handler. This probe does not claim keyboard, scrolling, all-parent validation or the final shared slot.

## Return evidence

Attach `target/perf-frames-drag-compatibility.json` to #3540 with the exact commit, macOS/WebKit version, hardware, display refresh, power settings and each row's observed result. Screenshots/video of the internal drop and the Terminal's path delivery help diagnose a failure.

The command exits **2 intentionally**, even if the manual checks succeed: it records compatibility facts and claims no measured presentation or performance pass. A launch/build timeout also means incomplete qualification, never a candidate pass. This report's `probe` is `roundup-native-drag-compatibility`; it has no frame intervals and must not enter a timing comparison.

A pass permits implementing and measuring the three candidate integrations using the existing frame protocol on the same Mac. A failure disqualifies this native integration; preserve absolute-path delivery, investigate the native conflict, and evaluate a compatible library. Choose no winner until the three-library qualification in `scenarios/ui-drag.md` is complete. Keep #3540 open throughout.
