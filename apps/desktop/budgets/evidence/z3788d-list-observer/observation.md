# Z3788d rendered list investigation

The observer measures trusted input dispatch through presentation of the frame containing the filtered destination identities. It uses the existing App and Switcher consumer, a deterministic alternating alpha/beta list, one isolated headless Chromium profile, 1512×950 dark, and the unchanged Vite development build. Each size (40, 400, 4000) receives 20 warmups and 200 measured edits alternating `a` and `al`. Selection chooses the first matching Workstream once after collection. No product code or virtualizer changes.

Before adoption, identify the exact filtered destinations at the animation callback preceding commit; pair its mark with Chrome's input EventTiming trace, commit, Paint, DrawFrame and presentation. A missing pair or presentation is exit 2, never a zero sample. Use trace data rather than the thresholded/rounded browser PerformanceObserver API. Retain the inputs, result identity digest, trace timing and nearest-rank p50/p95.

This continues #4312 from its final corrected head. Merging current main fast-forwards to ceac38461, because #4353 already merged the corrected probe and clipboard adoption. All prior review's rejected source/test changes are absent from this slice.

## Method and reproduction

From this checkout, run `pnpm install`, then serve `pnpm --filter desktop exec vite --host 127.0.0.1 --port 5257 --strictPort` in its own process. With other builds and lints stopped, run `python3 apps/desktop/budgets/evidence/z3788d-list-observer/observe.py.txt` from the repository root. Stop only that server afterwards. The observer creates and closes its own headless browser and temporary profile. It returns 0 only for three valid below-budget lists, 1 for a valid budget miss, and 2 for missing/incomplete/unsupported/setup/cleanup observations. `result.json` retains one row for each failed size; `attempts.json` retains abandoned setup/trial attempts. No before/after comparison is claimed: product source is unchanged.

`environment.json` identifies the measured checkout. `collection.py.txt` is the executed collector; `observe.py.txt` corrects its result-order validation for reproduction. The collector's original `identitiesMatch` flag incorrectly expects interleaved input order for `a`. The analyzer instead validates the full recorded SHA-256 identity sequence against all even rows followed by all odd rows for `a`, and even rows alone for `al`. The retained trial identities demonstrate that score order. This corrects extraction without changing samples, trace timestamps or the measured path.

The capture-phase listener records a mark and schedules the next animation callback. That callback reads every destination identity and emits `ready`; it does not end the latency measurement. A second callback bounds collection readiness only. The analyzer requires the trusted input's trace timestamp, processing end, identity callback, commit completion and presentation in order, with both Paint and DrawFrame after the identity callback and before presentation. It uses the trace's unrounded `EventTiming.duration`. Missing trace pairs or filtered identities fail the observer. Durations include result-identity observation and tracing overhead; this is an instrumented Chromium development-build investigation, not a native or production rule-7 pass.

The [Event Timing specification](https://www.w3.org/TR/event-timing/) describes input-to-render duration and the API's 8 ms rounding/reporting threshold. The archive keeps raw input/ready/after marks, EventTiming begin/end, input dispatch, layout/style/paint, draw and commit events. These are unmodified selected events from the complete trace; each complete trace's SHA-256 is retained in the result. Full trace files remain in `/tmp/z3788d-raw/` and dark result screenshots under `artifacts/ux/Z3788d/`; no image or video is committed.

## Reuse

The installed [agent-browser 0.27.0](https://github.com/vercel-labs/agent-browser) profiler supplies Chrome trace collection directly; npm publication is 2026-05-07. [Playwright 1.64.1](https://github.com/microsoft/playwright), published 2026-10-14, offers browser automation and tracing, but this run explicitly requires agent-browser sessions; it adds no second browser driver or protocol connection. Registry integrity, releases and primary repository links are in `libraries.json`. Native performance timing alone omits result identities, and the thresholded public Event Timing observer cannot prove a sub-16 ms result from absent entries. No custom runtime parser, clock, adapter, matcher or lifecycle is introduced. No custom product implementation is replaced by this measurement-only slice. Virtualizer candidates remain unselected until the measured cause licenses a separately scoped implementation.

## Regression boundary

No App behavior, control, style, dependency, contract or frozen loop file changes. No Check moves. Existing App source is byte-identical to the measured main base; the observation adds no skipped, retired or duplicate behavior test. The Intervene journey and P1/P3/P9/P11 owners remain untouched. This slice supplies no Terminal addon, native clipboard, native timing, memory, startup-byte or serialized-output completion claim. Keep #3853 open.

## Result

The collection stops with exit 2 during the selection action after the 400-row query trace: agent-browser returns `CDP command timed out: Runtime.evaluate`. This is an internal command of this run's dedicated browser, not a connection to another browser. The browser is closed in the collector's `finally` block; its temporary profile is removed. No 4000-row observation is reached. `collection-failure.json` retains the command error. The failure is not converted to zero latency or a virtualization decision.

The 40-row selection readback chooses `row-0000` with no RPC calls. The 400-row trace contains all 20 warmups and 200 measured edits, but its selection readback is missing. `result.json` distinguishes measured timing from incomplete actions. All three sizes and their complete actions are still required before Z3788d can complete. Continue with a bounded, isolated repair of the selection/readback observer, retain this failed run, then collect all three sizes together. Investigate the input-handler cost before choosing a virtualizer: small-list latency is already over budget, so list length alone is no cause attribution.

| Destinations | Measured edits | p50 ms | p95 ms | Action / decision |
| --- | ---: | ---: | ---: | --- |
| 40 | 200 | 36.377 | 40.712 | Exact result identities and keyboard selection pass; valid budget miss (1). |
| 400 | 200 | 250.826 | 278.281 | Exact result identities pass; selection readback times out, incomplete (2). |
| 4000 | 0 | — | — | Not reached; missing samples (2). |

Overall exit: **2**. No completed Z3788d decision or virtualization authorization. Style-recalculation p95 is 20.413 ms at 40 and 176.301 ms at 400, nested inside input dispatch; these overlapping components must not be added together. Layout p95 is 0.743 / 5.551 ms. The retained traces support a style-cost investigation but do not isolate a particular selector or prove that virtualization is the appropriate repair.
