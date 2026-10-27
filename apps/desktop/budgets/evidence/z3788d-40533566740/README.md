# Z3788d input-path repair

All four production collections validate 660 trusted edits each, exact logical and mounted identities, displayed selection, native dispatch, paint/draw and exact compositor presentation. Every verifier exits 1 (valid, over budget). None meets the 16 ms gate.

| Destinations | Continuation baseline p95 | Final p95 | Baseline input dispatch p95 | Final input dispatch p95 |
| --- | ---: | ---: | ---: | ---: |
| 40 | 17.747 ms | 17.663 ms | 4.938 ms | 3.657 ms |
| 400 | 17.096 ms | 17.784 ms | 4.894 ms | 3.201 ms |
| 4,000 | 18.072 ms | 17.819 ms | 7.931 ms | 4.552 ms |

The continuation baseline is already virtualized head 4702f89a6, collected before edits. The original full-list baselines and failed runs remain in earlier evidence directories. This pair isolates this repair; it does not replace the full-list comparison. Production phases use one host, Chrome 155, fresh dedicated headless profiles, dark 1512×950, identical minified production builds, deterministic names and actions, 20 warmups and 200 measured edits per size. No validation process overlaps their collection. Source snapshots and hashes identify uncommitted candidates precisely.

`candidate-lazy` resolves Ark's lazy asChild attributes into one object, with no dispatch improvement. `candidate-direct` reads Zag's public item props once in Ark's asChild slot. `after` additionally memoizes the shared Tab stop and exposes the settled highlight during query updates, preserving the existing highlight effect. Each candidate passes the same 70 focused behavior tests; no test was added, removed or weakened. The final dispatch improvement is measured, but presentation remains over budget.

`profile` contains a separate 30-edit unminified diagnostic, not a latency comparison. Its environment inherited the collector's 20/200 labels; the source loop actually collects 30 edits and its mode explicitly says so. The analysis restricts V8 samples to native input dispatch. Tab-stop scans occupy 192 overlapping inclusive samples; collection serialization, rendering, ranking and TanStack scroll geometry remain visible. Inclusive samples overlap and are not individual latency intervals. The rebuilt unminified bundle is archived for the profile's source positions. Replay `analyze.py.txt` after restoring its trace under the named temporary path.

`calibration-clean` is a separate native-input/direct-DOM diagnostic, not Switcher acceptance. It validates all 220 edits and compositor presentations: p50 8.780 ms, p95 16.217 ms, input-dispatch p95 0.206 ms. It updates twelve option rows directly, with no Solid, Ark, virtualizer, ranking or draft storage. The diagnostic verifier permits any paint on that frame because this minimal document has no App paint layer; all production verifiers retain their original Switcher paint requirement. This observation suggests a host presentation floor; it neither waives 16 ms nor establishes a universal lower bound. `calibration-overlap` preserves the first unused attempt that overlapped archive compression; no acceptance relies on it.

Run each production verifier from the repository root: `python3 <phase>/verify.py.txt`. Exit 0 is a complete budget pass, 1 valid over budget, 2 incomplete/invalid. Decompress each trace fragment's gzip wrapper, concatenate numeric fragments, then decompress that gzip stream. Archives above the size bound are compressed without dropping samples. All original attempts remain.

Six fresh dark captures cover tree-40, agents-10 and conflict, including visible storage failure. JSON readings are here; media stay under artifacts/ux/Z3788d/fix-40533566740. Main CI 40531762446 passed mac and mac-clippy; the user reports what they meet on the Mac. No native or budget pass is claimed; #4401 and parent #3853 remain open.
