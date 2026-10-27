# Z3788d archived presentation replay

All 660 archived edits now pair to their displayed results. Chromium p95 exceeds 16 ms at every length. This repairs the observer; it neither completes Z3788d nor authorizes virtualization. Keep #3853 open for cause attribution and the remaining Terminal acceptance.

| Destinations | Warmups / measured | p50 ms | p95 ms | Exit |
| --- | ---: | ---: | ---: | ---: |
| 40 | 20 / 200 | 16.272 | 18.800 | 1 |
| 400 | 20 / 200 | 51.942 | 82.259 | 1 |
| 4000 | 20 / 200 | 457.234 | 732.659 | 1 |

These are the original collection's timings, not new browser observations or before/after improvements. `../environment.json` records revision `1494ab15241e8811f0f1f7c8b96dc441ff5f7f2f`, host, fresh profile, dark 1512×950 viewport, seed, build and source hashes. No current-main, native Mac, production-build or design Check pass is claimed. The 400/4000 percentiles are unchanged. Each original selection acknowledged `row-0000`, returned focus and recorded zero Terminal writes.

## Exact frame repair

The old analyzer required the `PipelineReporter` wrapper to end at EventTiming's presentation endpoint. For 40-row warmup 3, its wrapper ends at Commit, before DrawFrame. Its separately traced presentation stage ends exactly at EventTiming's endpoint:

```text
trusted input                          514995866 µs
exact filtered identities ready        515005820 µs
reporter wrapper end / Commit start    515007324 µs
submission stage start                 515008528 µs
DrawFrame sequence 291, layer tree 4    515008612 µs
submission stage end / EventTiming end 515015292 µs
```

The replay pairs `SubmitCompositorFrameToPresentationCompositorFrame` begin/end with its reporter by process, thread, category and local trace id. It handles reused local ids in timestamp order. The reporter still must declare `STATE_PRESENTED_ALL`, with DrawFrame's exact sequence and layer tree. DrawFrame must occur inside that submission/presentation interval, and its endpoint must match EventTiming within the original 2 µs tolerance. Exact ordered result digests, trusted input, processing/ready/commit ordering and the Switcher Paint remain mandatory. No sample, including warmups, is skipped.

Chromium documents this presentation stage in [Life of a frame](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/life_of_a_frame.md). Its [CompositorFrameReporter implementation](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/metrics/compositor_frame_reporter.cc) names the submission-to-presentation interval. The retained trace supplies the exact identities and timestamps above; the replay does not infer presentation from a nearby unrelated frame.

All original archives, samples, failure reports and analysis remain unchanged. The replay checks decompressed trace hashes against the original reports before reading samples; outputs go only in this directory. A first replay attempt indexed reused reporter ids globally and failed pairing at sample 0 for every length (exit 2). Timestamp-ordered association repairs it. Running the original analyzer also exposed its archive writer's compressed-part cap; those generated changes were discarded. Replay is read-only with respect to the original archive.

## Reproduce

From the repository root:

```sh
python3 apps/desktop/budgets/evidence/z3788d-isolated-list/replay.py.txt
```

Expected exit: **1**, valid over-budget measurements. `result.json` contains all three reports; each timings file retains 220 samples and their frame evidence. The command uses Python's installed standard library and needs no browser, server, install or new profile because it replays the same archived collection.

| Condition | Exit |
| --- | ---: |
| All valid measured p95 values below 16 ms | 0 |
| Valid measured p95 at or above 16 ms | 1 |
| Missing samples or selection | 2 |
| Wrong archived trace/revision pairing | 2 |
| Different collection substituted for the archived host/observer | 2 |
| Unsupported frame pairing or missing presentation stage | 2 |
| Unreadable archive / setup failure | 2 |
| Incomplete identity, input, selection or focus action | 2 |

This read-only replay creates no external resource needing cleanup. `validation.json` records successful replay and negative probes for a missing sample, wrong identities, missing presentation and wrong trace pairing. Every negative probe exits 2. No failed measurement is converted to a budget pass.

## Reuse and remaining work

Continues PR #4312: its corrected compatibility evidence and OSC 52 copy already landed through #4353. This slice extends #4377's existing archived analyzer only, within one evidence module. It changes no App source, dependency, excluded #3742 surface, contract or frozen machinery.

The installed agent-browser 0.27.0 already collected the trusted input and Chromium profiler trace; Python's JSON/gzip/hash libraries read it directly. The existing candidate evidence in `../libraries.json` records agent-browser 0.27.0 (published 2026-05-07; newer maintained releases available) and Playwright 1.64.1 (2026-10-14). [agent-browser](https://github.com/vercel-labs/agent-browser) remains selected: no additional collector is needed. [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro) does not itself pair these Chromium frame identities to presentation, and replacing collection would lose the same-observer replay. No new automation or UI library, adapter or custom runtime machinery is added or deleted.

The isolated fixture has no Rail DOM, and input dispatch grows with list length, but nested dispatch/style/layout totals alone do not isolate the causal cost of whole-list rendering. Attribute the expensive work before selecting virtualization or filing its measured implementation successor; compare any implementation on that same observer, host and actions. No no-gap decision is available. Z3788a still needs Find/query retention, authoritative serialized scrollback/reload, bounded images, ten-Agent memory, strict entry/static/lazy/WASM bytes and rendered observers. No cancelled prerequisite is needed or restored. The user reports what they meet on the Mac; no user-only decision is pending.
