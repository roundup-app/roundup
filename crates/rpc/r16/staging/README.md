# R16 bounded Client object staging

The Client stages eight object entries, allocates a map at the actual size for a smaller object, and reserves sixteen entries only after seeing a ninth. It preserves every value and field; serde's deserializer still enforces syntax, UTF-8, numbers and recursion limits. The sixteen-entry candidate overflowed the debug reader stack on a valid deep object; the final eight-entry repair passes the 126-level seam test.

```text
complete JSON frame → bounded prefix → complete owned payload → existing caller/event routing
```

The supported 9V74 candidate profiles in `candidates-growth.jsonl` retain three quiet 3,300-sample comparisons: complete 11,045-byte parsing takes 63.536–64.167 µs versus 77.086–77.207 µs for the existing Value parser. Direct reservation is faster but overallocates small objects; the collected-vector and four-entry candidates do not justify production changes. Typed-result serialization already reserves from struct field counts; required additional Rail fields remain present. No conversion rewrite is added.

## Supported 7763 continuation

`continuation-7763/` retains new observations after the previous run ended. Ubuntu 24.04, x86_64, four online/available CPUs and unrestricted 0–3 affinity select the 7763 class. These are not 9V74 baselines. Historical source is `1d1618d2d9bb5c0f25ecb6b32de1cde20bfad6d0`; repaired source is `b856ae9a` (production parser `8bb34848`, main merged at `0698c9f1`). The original Client fixture uses `0698c9f1` without staging. Each reference uses its committed lockfile and default release settings.

Parser-only medians on this host are 84.337–84.403 µs staged versus 96.760–97.402 µs for Value parsing. Socket-inclusive real-Client original/repaired medians are 170.954/155.620, 162.278/157.699 and 160.018/159.588 µs. The diminishing difference is retained; these observations do not establish a stable end-to-end saving. Typed historical/current conversion is 22.041/48.590 µs; the historical payload has 8 fields per row versus the required current 17. Envelope moving and frame rendering remain separately attributed.

The compatible original probe rebuilds to `c0acc38b…`. Ownership-only and ownership-plus-staging probes have identical perf source. Three alternating pairs on identical frozen current Daemon bytes isolate staging: original/repaired Rail-40 medians are 0.714191/0.712769, 0.709192/0.709282 and 0.704805/0.705615 ms. Every invocation qualifies (maximum load/CPU 1.5625); these show no consistent full-probe saving.

Nine alternating eleven-fresh-Daemon historical/repaired pairs then use identical ownership-plus-staging probe bytes. Every report retains the ten login-shell workload, 1,000 calls, existing metrics, absolute limits, noise, 2.0 load threshold and RSS comparisons. All eighteen qualify (maximum invocation-median load/CPU 1.44), and all exit 1 against unchanged boxd budgets. No busy/failed invocations occurred; ceiling misses are not retried.

| Metric | Historical median | Existing ceiling | Repaired median | Repaired misses |
|---|---:|---:|---:|---:|
| Rail-40 (ms) | 0.314115 | 0.3465265 | 0.708700 | 9/9 |
| Ping (ms) | 0.063819 | 0.0712009 | 0.119813 | 9/9 |
| Terminal write (ms) | 0.103642 | 0.1150062 | 0.575913 | 9/9 |
| Write-to-output (ms) | 0.212245 | 0.2344695 | 0.691167 | 9/9 |
| Extra RSS (MB) | 2.496094 | 2.795703 | 2.597656 | 0/9 |

Every absolute limit passes. `comparison.json` retains every metric and checks RSS at every load. Full #1374 acceptance remains unmet. This PR delivers measured parser work and comparison evidence with `Refs #1374`; it does not close the Issue or assert parser optimality. Existing #1361 owns broader Daemon diagnosis/combined comparison, #1365 Rail presentation, #1366 Message input tracking and #1251 class baselines/completion. The full Rail result does not justify expanding this RPC-only PR or raising a baseline.

## Reproduction and validation

Earlier 9V74 commands, metadata, hashes, failures and candidate logs stay unchanged. For the continuation, create detached worktrees `/tmp/rpc-1374-history` at the historical SHA and `/tmp/rpc-1476-original` at `0698c9f1`; create `/tmp/r16-1476-binaries`. In the historical worktree apply `crates/rpc/r16/probe-compatible.patch` using its absolute repository path and `git apply --unidiff-zero`, then `cargo build --release -p rupd -p rup -p perf`. In this checkout run `cargo build --release -p rupd -p rup -p rpc --examples`, and `pnpm install --frozen-lockfile`. `continuation-7763/build-and-observe.py` records the subsequent build, freeze, check and observation sequence with the checkout path used by this run. Use a fresh output directory; `observe.py` refuses to overwrite records. Run the rebuilt `target/release/examples/r16_parse` three times after all compilation/checks end; `candidates.jsonl` retains each output, exit and binary/source hash. Finally run `continuation-7763/compare.py` against the retained pairs and historical budgets.

The first helper attempt failed before timing because the historical examples directory did not exist. It was created and execution resumed with `resume.py`; no binary or observation was discarded. Long build/check logs are gzip-compressed without removing output. `commands.jsonl`, `metadata.json`, `hashes.json`, `profiles.jsonl`, `isolation.jsonl` and `pairs.jsonl` retain commands, references, exits, reports, loads and exact bytes. The continuation is separate from earlier 9V74 evidence; binaries rebuilt to the recorded hashes rather than being assumed to survive between runs.

All 17 RPC tests pass. Full post-merge `VITEST_MAX_WORKERS=1 just check` exits 0: 1,594 Rust tests, Message proofs, lint/type/slop checks and 2,756 desktop tests pass, with four configured skips. `check-summary.json` and `check.log.gz` retain the result. No timeout, assertion, contract, workload, threshold, baseline or loop gate changed. Timing began only after all builds/checks exited; no Mac observation is requested or claimed.
