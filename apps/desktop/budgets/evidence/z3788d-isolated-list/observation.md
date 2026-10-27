# Z3788d isolated destination-list observer

Continues #4312; its corrected evidence and OSC 52 copy are already merged through #4353. This slice follows #4374's incomplete measurements, without changing App source, dependencies or the excluded Switcher. #3853 remains open.

## Observer

The original full-App observer timed out populating 4000 Rail rows and selecting at 400. Its input interval also included style recalculation across the mounted Rail. This fixture mounts the unchanged production Switcher, Leader and connected Project directly, using the existing fake App seam, browser draft storage, Ark Combobox and production styles. There is no Rail DOM or alternate matcher. Selection reads the actual connected Rail state; the ordinary focus target lets the Switcher complete its existing focus-return path. This isolates list work; it makes no full-App journey or native Mac claim.

P1/P9: every selection journal records zero Terminal writes. P11: the production query-retention implementation remains mounted. No runtime behavior or design Check is changed.

Names, lengths, query order, 20 warmups and 200 measured edits match the earlier observer. The fresh dedicated headless session uses one profile, dark 1512×950, one host and Vite development throughout. The interval remains trusted input EventTiming to presentation of the committed exact filtered identities, paired through Paint, DrawFrame and PipelineReporter. An incomplete/ambiguous frame is exit 2, never zero latency. Results from this isolated fixture are not before/after improvements over the different full-App observer.

## Reproduce

From the repository root:

```sh
pnpm install --frozen-lockfile
cp apps/desktop/budgets/evidence/z3788d-isolated-list/fixture.tsx.txt apps/desktop/z3788d-observer.tsx
cp apps/desktop/budgets/evidence/z3788d-isolated-list/fixture.html.txt apps/desktop/z3788d-observer.html
pnpm --filter desktop exec vite --host 127.0.0.1 --port 5257 --strictPort
```

In another shell, from the root, run `python3 apps/desktop/budgets/evidence/z3788d-isolated-list/observe.py.txt`, then `python3 apps/desktop/budgets/evidence/z3788d-isolated-list/analyze.py.txt`. Remove only the two copied fixture files afterward. The collector closes its own session and removes its temporary browser profile. The analyzer preserves original traces as individually valid gzip members under 900000 bytes; concatenate parts in name order and gzip-decompress the concatenation to reconstruct each original trace. Raw samples retain exact ordered-identity digests and trust flags. Screenshots remain uncommitted in `artifacts/ux/Z3788d`.

`initial-setup-failure.json` retains the first fixture's missing Leader registration: the open-field wait timed out. Mounting the existing Leader repairs this setup; no synthetic event or product workaround is used. The first environment record was committed before this failure; the final environment describes the actual collection revision.

## Reuse

Installed agent-browser 0.27.0 supplies trusted key input, isolated profiles and Chromium profiling; its native profiler provides the required frame evidence. The existing collector/analyzer from #4374 is reused. Playwright's maintained trace viewer records actions and DOM snapshots but does not itself prove Chromium presentation of the matching result. No additional automation dependency is required. `libraries.json` records registry release metadata for both candidates. Sources: [agent-browser](https://github.com/vercel-labs/agent-browser), [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro).

The existing Switcher/Leader, connected Project, browser storage and Ark Combobox provide every mounted capability; no UI implementation or pass-through adapter is introduced.

## Results

| Destinations | Warmup / measured edits collected | p50 ms | p95 ms | Presented-frame validation |
| --- | ---: | ---: | ---: | --- |
| 40 | 20 / 200 | — | — | Sample 3 fails exact presentation pairing; no timing pass. |
| 400 | 20 / 200 | 51.942 | 82.259 | Every sample pairs; budget exceeded. |
| 4000 | 20 / 200 | 457.234 | 732.659 | Every sample pairs; budget exceeded. |

All three lengths select `row-0000` with Enter, restore focus to the declared focus target and record zero Terminal writes. Collection exits 0 and cleans up its dedicated browser profile. The analyzer exits 2 because the 40-row trace fails, including though that sample is a warmup: its DrawFrame occurs after the matched PipelineReporter's endpoint, and EventTiming ends at another timestamp. `40-trace-failure.json` records those exact timestamps and the original trace hash. The existing strict analyzer is unchanged; no sample, criterion or failure is dropped to obtain a decision.

At 4000, input dispatch p95 is 587.720 ms, style recalculation 65.470 ms, Layout 41.024 ms, PrePaint 31.199 ms and Paint 6.790 ms. These nested phases are not additive. They locate expensive work in the isolated existing list, with no mounted Rail, but an incomplete three-length observer authorizes no virtualization. Z3788d remains incomplete. Repair the 40-row frame-presentation observation and repeat the complete observer before filing a measured implementation successor. Do not compare these isolated numbers as a before/after improvement against #4374's full App.

| Failure condition | Exit |
| --- | ---: |
| Initial fixture omits Leader; opening field times out | 2 |
| 40-row sample 3 has no matching presented frame | 2 |
| Complete 400-row timing exceeds 16 ms p95 | 1 |
| Complete 4000-row timing exceeds 16 ms p95 | 1 |
| Overall decision lacks valid timings at all three lengths | 2 |

Remaining on #3853: Z3788d's valid three-length decision and any licensed measured successor; Z3788a Find/query retention, authoritative scrollback/reload, bounded images, ten-Agent memory, entry/static/lazy/WASM byte requirements and rendered observers. This archive completes no addon feature or native observation. The user reports what they meet on the Mac.

Validation: all three decompressed trace hashes match the recorded originals; archive replay reproduces exit 2. Both Python programs compile. Vitest related exits 0 with no related tests. The first readiness run found a spelling-scanner decode failure on split compressed bytes; independently compressed gzip members fix the archive format without changing trace content, and the complete web-boundary rerun passes. No lint configuration or exemption changed.
