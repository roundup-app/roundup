# Z3788d paired production observation

Both phases validate all 660 native input edits, exact ordered logical identities,
mounted identities, selected-row visibility, input EventTiming/native dispatch,
matching paint/draw and exact compositor presentation. Both verifiers return 1:
valid observations over budget. No missing sample is assigned zero latency.

| Destinations | Baseline p50 / p95 ms | Candidate p50 / p95 ms |
| --- | --- | --- |
| 40 | 10.870 / 19.106 | 10.495 / 18.370 |
| 400 | 58.080 / 70.345 | 10.407 / 18.059 |
| 4,000 | 649.587 / 730.303 | 17.129 / 19.726 |

The candidate improves each p95, but none meets 16 ms. #4401 and #3853 remain open.
Candidate input-dispatch p95 is 8.243 / 7.091 / 10.811 ms; layout p95 is
0.330 / 0.251 / 0.325 ms. These are trace spans, not attribution to individual
functions. No native or rule-7 pass is claimed.

Collected on one host, Chrome 155, production builds, dedicated headless sessions,
fresh test profiles, 1512 by 950 dark viewport, with no builds or tests running.
The per-phase environment records host, revision, browser and source hashes.
Both builds use the same fixture, current Switcher and merged-main dependencies;
baseline replaces only Combobox with the retained full-list source. Runtime source
snapshots identify the builds. The production config is the earlier continuation's
`../z3788d-40511803272/production.config.ts.txt`. Baseline precedes candidate.

The fixed action is Control+A then one native character, alternating `l` and `b`.
The deterministic alpha/beta suffix seed is unchanged. Queries are disjoint:
`l` selects row-0000, `b` selects row-0001. All 20 warmups and 200 measured edits
per size validate the corresponding exact ordered even/odd identities. Enter at
the end selects row-0001, returns focus to the content target, and writes no
Terminal input at every size in both phases.

`failed-overlapping-query/` retains the first observer's scripts, environment and
failure. Its overlapping `a`/`b` queries incorrectly assumed returning to `a`
would reset highlight; Ark correctly preserves the still-matching row-0001. That
run failed before saving samples or stopping its profiler, so no trace was saved.
The corrected observer saves raw samples and stops the profiler before checking
identities. `profile/` retains a separate diagnostic load timeout under concurrent
validation; it establishes no function attribution or latency result.

Replay from repository root: `python3 <phase>/verify.py.txt`, substituting the
full baseline or after directory path. Exit 2 means missing/invalid evidence, 1
means valid over budget, 0 requires complete sub-16-ms results. Every compressed
trace fragment is independently gzip wrapped: decompress wrappers, concatenate
in numeric order, then gzip-decompress the joined stream. Raw trace SHA256s are
in result.json. Large JSON reports use lossless gzip. Original raw observations
remain as `*-raw-samples.json[.gz]`; decode gzip before inspecting them.

The next engineering step is synchronous input-path profiling on an idle host,
then a measured repair and another complete paired run. No product decision or
user observation is needed to choose that work.

Fresh captures: all six screens pass every rendered Check, including D2/D5/D6.
Production build passes: startup 433619 / 437814 gzip bytes; static output
17962526 / 18000000 bytes. Main CI 40520992110 passed mac and mac-clippy.
The user reports what they meet on the Mac. Validation outcomes are in validation.json.

The focused suite passed 71 tests and failed its browser assertion that End reaches
the last initially mounted row (agent-20). Native End reaches the logical final
agent-30. The corrected test names that fixture endpoint and checks select-all in
both endpoint viewports; its rerun is recorded separately. No test was cut: this
is the sole mounted-App observer for native query editing and content navigation.
