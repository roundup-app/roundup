# Z3788d continuation: native viewport reset

Reference: `b006be0532720dd3405757555fa589de61767c92`. Candidate source is committed as `b61a05611019fb4e951381974c3bbfcf821aa691`; its collection preceded that commit and records the reference HEAD plus exact source snapshots/hashes. The subsequent clean main merge changes no candidate source. Host `runnervmtai0g`, Builder session `40538658071`, Linux, Chrome 155, production Vite, isolated fresh profiles, dark 1512×950, 20 warmups and 200 measured native edits per size. Both phases use the same observer and build settings. No validation process overlaps either collection.

The interval is trusted native input EventTiming start to the compositor presentation of its committed filtered results. Exact ordered logical identities, mounted subsets, displayed selected identity and visibility, native dispatch, paint/draw, compositor frame and selection/focus/zero Terminal writes are checked. No callback-only or native performance claim is made.

| Destinations | Before presentation p95, ms | Candidate presentation p95, ms | Before input dispatch p95, ms | Candidate input dispatch p95, ms |
| --- | ---: | ---: | ---: | ---: |
| 40 | 17.502 | 17.749 | 3.255 | 3.177 |
| 400 | 17.778 | invalid | 3.159 | invalid |
| 4,000 | 17.669 | 18.201 | 5.391 | 4.321 |

Before verifier: exit 1, all 660 samples valid and over budget. Candidate verifier: exit 2, because sample 180 at 400 destinations has no matching paint/draw before presentation. The two validated candidate lengths remain over budget. This is not a complete passing pair and does not complete #4401 or parent #3853. The unchanged sub-16-ms gate remains open; the input-dispatch saving at 4,000 is provisional until a complete pair reproduces it. No failed attempt is discarded.

The retained profile from session 40533566740 attributes 95 input samples to TanStack `_elementMaxScrollOffset`. Ark requests scroll-to-top during query edits. The candidate uses native `scrollTop = 0` for logical index zero, retaining TanStack index scrolling for every other destination. This uses an existing browser operation, introduces no scroll state machine, and preserves Ark ownership.

`rejected-single-input` retains a separate unmeasured source experiment and its failed test log. Replacing the Switcher native input listener with Ark input-value callbacks breaks five existing retained-query/recovery tests (66/71 pass). That experiment was removed; no test was weakened. The final candidate's original focused run passes all 71 tests, including the mounted native-editing observer.

Replay from the repository root: `python3 <before|after>/verify.py.txt`. The original observer source and fixture/config are retained; restore fixture/config at their original desktop paths, build with `Z3788D_BUILD_DIR` and serve that production output at port 5259, then run the corresponding `observe.py.txt`. Raw sample JSON is gzip-compressed without alteration. For each trace, decompress the individual numbered gzip fragments, concatenate in numeric order, then decompress the resulting gzip stream. Verification exit 0 means complete and below budget; 1 valid over budget; 2 invalid/incomplete. Preserve the failed 400 sample when recollecting.

Six fresh rendered captures pass every Check on tree-40, agents-10 and conflict, including visible storage failure, under `artifacts/ux/Z3788d/fix-40538658071/`. Their readings are in `visual/`; PNGs remain uncommitted. `just capture Z3788d` was also attempted and ended at its explicit 40-second bound. Main CI 40531762446 passed mac and mac-clippy; the user reports what they meet on the Mac.
