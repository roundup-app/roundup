# Z3788d rendered Switcher observer

This slice measures the existing consumer; it changes no product code or virtualizer. #3853 stays open. Applicable gates are P1/P9 (search must write no Terminal input) and P11 (retain the query); selection journals record the webview action only. No journey, native Mac timing, addon or whole-Issue completion is claimed.

## Reproduce

From the repository root, install with `pnpm install --frozen-lockfile`, serve `apps/desktop` with `pnpm exec vite --host 127.0.0.1 --port 5257 --strictPort`, then run `python3 apps/desktop/budgets/evidence/z3788d-list-observer/observe.py.txt` followed by `python3 apps/desktop/budgets/evidence/z3788d-list-observer/analyze.py.txt`. The archive invokes installed agent-browser 0.27.0's Linux binary and `/opt/google/chrome/chrome`. Each collection uses one dedicated headless session and fresh profile, 1512×950, dark, Vite development. No personal browser connection. `environment.json` names the measured source revision and host.

Each length (40, 400, 4000) gets 20 warmups and 200 measured edits alternating `a`/`al`. Names are distinct zero-padded `row-NNNN-alpha`/`row-NNNN-beta`. The displayed order for `a` is even ids then odd ids; `al` contains even ids only. Samples retain the query, trust flag, exact ordered identity digest and count. SHA-256 uses UTF-8 compact JSON of that ordered id array. Enter then chooses the first destination once; selection journals retain the selected id's state and Terminal writes. Selection failure is retained separately and never represented as a pass.

## Interval and validity

```text
trusted input EventTiming → input mark → exact result identities in rAF
  → Switcher Paint → committed DrawFrame → matching presented frame
```

The analyzer requires one input EventTiming within 2 ms of its capture mark, correct ordered identities, processing end before the result mark, and commit completion after it. Paint must identify the Switcher in that same document frame. DrawFrame's sequence/layer identity must match a `PipelineReporter` in `STATE_PRESENTED_ALL`, whose end agrees with EventTiming's exact endpoint within 2 µs. Missing or ambiguous pairing is exit 2, never zero latency. The trace's exact duration is used, rather than the thresholded and rounded PerformanceObserver API. [Chromium's `PerformanceEventTiming::ToTracedValue`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/timing/performance_event_timing.cc) explicitly recalculates that duration; [Event Timing](https://www.w3.org/TR/event-timing/) describes the browser API.

`*-samples.json` retain all 220 edits; `*-timings.json` retain paired frame identities and rendering phase durations. `*-full-trace.json.gz.part-*` retain original traces in chunks below the file-size cap (concatenate parts in filename order, then gzip-decompress); their uncompressed SHA-256 is in the result. Filtered traces also retain the compositor reporter. Nearest-rank p50/p95 exclude exactly the first 20 samples. Exit 0 means all three measured p95 values are below 16 ms with selection acknowledged; exit 1 means a valid complete observation exceeds the budget; exit 2 means a missing/invalid timing or selection observer. These are Chromium development-build observations with instrumentation overhead, not native rule-7 results.

## Retained failures

`attempts.json` preserves the preceding run's setup and incomplete-collection failures. `first-attempt/` retains this run's first collection and its 400-row selection timeout; 4000 was not attempted there. A preliminary analysis ran concurrently with part of that attempt's 400-row collection, so that attempt is diagnostic only. The second collection runs without concurrent lints or analysis. No failed trace is silently discarded.

## Result

| Destinations | Measured edits | p50 ms | p95 ms | Result |
| --- | ---: | ---: | ---: | --- |
| 40 | 200 | 33.967 | 36.602 | All input/frame pairs valid; first row selected, zero Terminal writes. |
| 400 | 200 | 218.304 | 237.075 | All input/frame pairs valid; subsequent selection observer timed out. |
| 4000 | 0 | — | — | Populating the list timed out before sampling. |

`result.json` exits 2. No complete three-length measurement exists; no virtualization is authorized and Z3788d remains open on #3853. At 400, UpdateLayoutTree p95 is 150.164 ms and input dispatch p95 is 203.804 ms (nested intervals, not additive). This identifies expensive rendering work but does not isolate Switcher list cost from the rest of the seeded App. A successor must isolate that cause and repair the observer before selecting a virtualizer. `collection-failure.json` retains the exact failed operation. No timeout, retry, product acceptance or budget was weakened.

The first attempt's preliminary 40-row result was 39.605 ms p95. Its full 400-row trace is also retained, without claiming a budget result for that attempt. The prior draft only proposed this observer; the current evidence replaces its pending collection claim with a reproducible failure and the completed paired samples.

Validation: replaying the compressed full traces reproduces both timing reports and exit 2 exactly; both trace hashes match and both archived scripts compile. Vitest's related run over these archive files exits 0 with no related test files; no product source or behavioral test changed. Boundary lint passes after storing raw browser fields in gzip archives.
