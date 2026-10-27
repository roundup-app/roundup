# Z3788d continuation evidence

The rendering budget remains unmet. Neither #4401 nor #3853 is completed.

The same runnervm48cm3 host, Chromium 156, dark 1512×950 viewport, deterministic alternating alpha/beta lists and 20 warmups plus 200 measured edits are retained. Every run used a dedicated headless agent-browser session and a fresh empty profile. The interval remains trusted input to the compositor frame showing its filtered results. Collectors batch the identical alternating l/Backspace actions, waiting on the observer acknowledgement after every edit.

## Valid development candidate

| Destinations | p50 ms | p95 ms | Exit |
|---|---:|---:|---:|
| 40 | 8.219 | 19.940 | 1 |
| 400 | 4.544 | 16.213 | 1 |
| 4,000 | 8.175 | 16.348 | 1 |

All 660 samples validate exact ordered logical identities, mounted viewport membership, visible selected identity, paint/draw and exact compositor presentation pairing. Normal selection reaches the expected destination and focus target with zero Terminal writes. The original baseline retained in ../z3788d-40507415273 validates all 660 edits on this host/browser/build. Fresh baseline recollection failed its stricter event/frame pairing at each size; those failures remain in baseline/result.json. The new production pair also has observer failures, retained without replacement or a budget claim. Its timestamp-based input pairing encountered browser DOM timestamp quantization; compositor pairing was never weakened. No clean new paired or native performance pass is claimed.

## Observer diagnosis

profile/cpu.json records the original observer's 30-edit diagnostic. Of its overlapping inclusive samples, 644,291 are under entriesOf called by window.__logical; ranking has much smaller counts, and draft retention is recorded separately. The observer rebuilt the Rail order on every input while production memoizes it. The corrected fixture derives the immutable seeded entries once, retaining exact independent ordered-id validation after each query. This repairs measurement overhead, not production ranking. profile-final retains a second 30-edit CPU trace after that correction. Diagnostic collection overlapped verification and is not a latency comparison. Original failed observations and source hashes remain.

## Replay and provenance

Each directory holds its collector, fixture, samples, environment, selections and verifier where applicable. Run its verify.py.txt from the repository root; exit 2 means missing/invalid evidence, 1 valid over budget and 0 only a valid budget pass. Every .part-NNN.gz is a gzip wrapper around an original compressed-stream fragment: gzip-decompress each wrapper, concatenate in numeric order, then gzip-decompress the joined stream. Full-trace SHA256 values are retained in result.json. archive.py.txt records packaging. Older after/ fragments were wrapped identically without changing their original bytes; library metadata is retained as libraries.json.gz. No image/video is committed.

The production fixtures were built using production.config.ts.txt with main's Combobox for the baseline and the keyed candidate for after. Each phase records its exact source hashes. The navigation change updates TanStack's getItemKey callback when the logical list changes, invalidating index measurements even when filtering changes order without changing length.

## Verification

The three existing Switcher suites passed 70 tests, including selected identity, exact single activation, retained query/caret, actions, content selection and zero Terminal writes. The caret observer now waits for the dialog's acknowledged focus return before reopening; no tests were removed. pnpm install and merge-loss passed. The production entry budget passed at 433301/437814 gzip bytes. Six 1512×950 dark App captures (tree-40, agents-10, conflict, each normal and draft-save failure) pass D2/D5/D6 and retain visible failure text under artifacts/ux/Z3788d/fix-40511803272. Main CI 40507426523 passed mac and mac-clippy; the user reports what they meet on the Mac.

just ready was rerun after repairing accidental fixture files and the compressed fragment text-decoding failure. just capture Z3788d was invoked; its complete workspace suite exceeded the available run time and was stopped, while the explicit rendered captures above completed. No full-suite capture pass is claimed. The remaining engineering work is a clean complete paired observer, all three p95 values below 16 ms without a rule-7 regression, and complete byte/capture verification. These remain under #4401; no product decision is requested.
