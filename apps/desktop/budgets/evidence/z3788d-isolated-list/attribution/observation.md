# Z3788d whole-list rendering attribution

Browser style/layout alone exceeds 16 ms on every measured 4,000-destination edit. This licenses the scoped measured successor required by Z3788d; it does not complete its gap branch or demonstrate an improvement. Keep #3853 open.

| Destinations | Input-to-presentation p95 ms | Style/layout p50 / p95 ms | Style/layout minimum ms | Samples over 16 ms from style/layout alone |
| --- | ---: | ---: | ---: | ---: |
| 40 | 18.800 | 1.032 / 1.160 | 0.604 | 0 / 200 |
| 400 | 82.259 | 8.547 / 9.458 | 4.351 | 0 / 200 |
| 4000 | 732.659 | 58.458 / 105.566 | 45.825 | 200 / 200 |

These are additional analysis of the original collection at `1494ab15241e8811f0f1f7c8b96dc441ff5f7f2f`, not a new browser run, current-main result, production measurement or native rule-7 pass. The host, browser, profile, viewport, build, seed and trusted actions remain exactly those in `../environment.json`. All 20 warmups and 200 measured edits per size retain exact ordered result identities and compositor presentation pairing through the existing replay. The original traces and earlier failures remain unchanged.

## What the trace establishes

For the alternating queries `al` and `a`, the result list contains half and all destinations. Same-renderer-thread, same-frame UpdateLayoutTree events restyle 12,001–24,001 elements at 4,000 destinations; Layout reports 14,009–28,009 dirty objects. At 40 destinations these ranges are 121–241 and 149–289; at 400 they are 1,201–2,401 and 1,409–2,809. The fixed fixture has no Rail and renders the unchanged Switcher with the real connected Project, draft storage, Ark Combobox and production styles. `ui/Combobox.tsx` Root mounts every filtered item with Solid For; no viewport window limits it. The changing result rows account for the list-sized rendering workload.

Each sample retains the original rendering event timestamps, durations, frame and element/object counts. The calculation takes the union of style/layout intervals fully contained between that trusted input and its validated presentation, on the ready mark's renderer thread and EventTiming frame. It neither sums nested intervals twice nor includes compositor threads, inclusive input dispatch, callbacks, Paint or garbage collection. The 45.825 ms minimum therefore proves a rendering lower bound beyond 16 ms without attributing the larger inclusive callback duration to rendering. Chromium's [LocalFrameView](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/frame/local_frame_view.cc) and [trace instrumentation](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/inspector/inspector_trace_events.cc) define these Layout and UpdateLayoutTree facts.

Inference: rendering the whole filtered list is one independently over-budget cause at 4,000 destinations. Virtualization is licensed for a scoped implementation; it is not proven sufficient. The trace contains no sampled JavaScript profile. Switcher's synchronous input callback includes matching, reactive row creation, collection work and draft retention, so its inclusive duration cannot identify their individual costs. Profile that path in the successor and preserve the existing query/draft owner rather than treating all input time as rendering. No causal rendering claim is made for the 40-row gap.

## Reproduce

From the repository root:

```sh
python3 apps/desktop/budgets/evidence/z3788d-isolated-list/attribute.py.txt
```

Expected exit **1**, valid measurements over budget. The command first reruns the existing exact-presentation replay and verifies original trace hashes. It writes only replay outputs and the derived attribution samples/result; it launches no browser or server. Python's installed JSON, gzip and hash libraries suffice. No runtime machinery, test, dependency, source or excluded #3742 file changes.

| Failure condition | Exit |
| --- | ---: |
| Valid measurements below budget | 0 |
| Valid measurements at or above budget | 1 |
| Missing samples, wrong identities, incomplete selection/focus/input or failed presentation replay | 2 |
| Wrong archived trace/revision pairing or substituted collection | 2 |
| Unsupported/missing rendering evidence for the renderer thread/frame | 2 |
| Unreadable archive/setup failure | 2 |

Negative probes reproduce with:

```sh
python3 apps/desktop/budgets/evidence/z3788d-isolated-list/attribution/verify.py.txt
python3 apps/desktop/budgets/evidence/z3788d-isolated-list/replay/verify.py.txt
```

Both verification commands exit 0 when their invalid cases correctly exit 2. `validation.json` records missing-layout and wrong-frame cases; both fail at sample 40/0 with missing rendering evidence, leaving original evidence unchanged. The existing replay verification separately checks missing samples, wrong identities, missing presentation and wrong trace pairing. Evidence-related Vitest discovery exits 0 with no runtime tests; no new behavior or test retirement is claimed.

There is no external resource requiring cleanup. No failed or missing sample becomes a pass. The derived samples preserve event evidence for every warmup as well as measured edit.

## Successor requirements

Scoped successor [#4401](https://github.com/roundup-app/roundup/issues/4401) owns the measured implementation. Z3788d orders TanStack Solid Virtual after #3788 and #3742 (both completed). Coordinate with #4391's active Switcher navigation ownership as well. Recollect a paired baseline and implementation using the same observer, host, profile, lists, actions and build settings; archived numbers on this other host are not a paired baseline. The observer must distinguish logical filtered identities from the mounted window after virtualization while still proving that the presented viewport contains the selected result. Keep trusted EventTiming/frame pairing and all failure codes; do not substitute callback duration or two animation frames for presentation. Retain original failed runs.

The implementation must achieve below 16 ms p95 at every required length with no regression above 10%, and implement `z3788d_virtual_navigation_preserves_selected_identity`: last matching item by keyboard, filtering while selected, choosing it, returning and scrolling preserve identity, focus, accessible option navigation and exactly one original action. Keep destination/action groups, action eligibility/opening context, input ownership and exact query/caret/draft recovery. Maintain entry/static/lazy/WASM budgets and capture D2/D5/D6 at the specified dark viewport. A virtualizer install alone satisfies none of this.

Installed Ark/Zag provides Combobox collection and navigation, not a mounted viewport window in this Root. TanStack's [Solid adapter](https://tanstack.com/virtual/latest/docs/framework/solid/solid-virtual) supplies element-scroll virtualization. Registry evidence checked 2026-10-27: [@tanstack/solid-virtual](https://registry.npmjs.org/@tanstack/solid-virtual) 3.13.50 published 2026-10-26, MIT; [alternative Solid virtualizer](https://registry.npmjs.org/virtua) 0.54.0 published 2026-10-27, MIT, also supports Solid. Both are maintained; the accepted scenario selects TanStack, with no claimed alternative capability failure. No candidate is installed by this evidence-only slice. The successor must probe Ark's virtualized navigation support before implementation and document any missing capability instead of rebuilding its state machine.

Continues PR #4312, whose corrected evidence and OSC 52 work already landed through #4353; main fast-forwards cleanly. Remaining Z3788a work is Find/query retention, authoritative serialized scrollback/reload, bounded images, ten-Agent RSS, strict entry/static/lazy/WASM bytes and required rendered observers. The user reports what they meet on the Mac; no user-only decision is pending.
