# U134/U135 Builder observations

Linux x86_64; dark Chromium; 1512×950; isolated session `material-40306587184`. Production source is `57ab7c11dd4880b20d85b70e2ae750bd917df35b`, including main `75bdfb892`. Subsequent commits retain observations only.

| Observer | Result |
|---|---|
| Paired `first-run`, `agents-10`, `tree-40`, `daemon-exits`, `conflict` | D1–D14 and D16 pass on base and head |
| Paired open Todo #5 Drawer, Homes menu, selected Shelf, Terminal tabs | Every Check passes; directory delta exits 0 |
| Material delivery, window preferences, rendered Checks and real-Daemon attention | 65 tests pass |
| Reduced transparency, reduced motion and system accent | 3 tests pass |
| Desktop native/webview configuration and permission boundaries | 3 tests pass |
| `just lint-rust` | Pass; ALL PROOFS CHECK |
| `just lint-web` | Code/style/type/cycle checks pass; report spelling corrected, `pnpm lint:boundaries` then exits 0 |
| `vocab`, `merge-loss` | Pass |

Paired captures use the same renderer, seed and compiled Radix imports. Base removes only the native-material Token block, the sole harness stylesheet difference from main. The initial raw-CSS substitution dropped those imports and made D3/D10 unmeasurable; these invalid readings were replaced. No failing reading is counted as a pass. The earlier U134 directory has an unmatched main capture; the complete U135 paired directory is the delta observer.

The Drawer opens with Enter; triage's `w` opens the Homes menu. `head/surfaces-complete.webm` records these interactions. Images and video remain uncommitted. Recording initially lacked ffmpeg; installing it repaired recording. Browser/server processes belong to this run only.

`just capture U130,U131,U132,U133,U134,U135,U136,U137` was invoked; its broad repository suite was stopped after unrelated browser suites to finish the focused observers above. No full-suite pass is claimed; CI judges the push. The prior run's attention-test compilation timeout is resolved by the passing focused real-Daemon test.

No native rendering or native App launch-cost result is claimed. Per #4072 and U134, the loop owner observes the merged App once on the Mac; this does not gate Linux acceptance. Unsupported-host opaque fallback is what these captures show.

Performance uses unchanged `just perf`, with separate locked release builds of immutable base/head on the same host. Dependency build caches are copied before each build; source and observer are unchanged. `perf/first.json` reports all nine metrics passing, clean, no skips, internal exit 0. The surrounding invocation returned 143 after writing it (`first-command-exit.txt`); `first.log.gz` retains its output. The quiet `just perf` repeat exits 0 and passes all nine metrics, clean, without skips (`perf/repeat.json`, `repeat.log.gz`). The interrupted broad suite left one isolated headless browser; it was terminated during the first base observation and before the repeat.

## Quiet repeat performance

`just perf`; host `runnervmtai0g`; boot `ab288602-403d-454b-96a1-a887e1bbf242`; job `40306587184/1/fix-run`. Each side has 11 samples. Observer, source revisions, executable hashes, commands, loads and raw samples are in `perf/repeat.json`. No budget or baseline changed.

| Metric | Base | Head |
|---|---:|---:|
| cold_plugin_materialization_ms | 9.753106 | 9.739450 |
| cold_start_ms | 9.236027 | 8.937569 |
| hook_loop_ms | 200.838340 | 195.940697 |
| ping_p95_ms | 0.037246 | 0.037046 |
| rail_tree_10_p95_ms | 0.120432 | 0.115744 |
| rail_tree_40_p95_ms | 0.322456 | 0.311910 |
| rss_extra_mb | 2.132812 | 2.191406 |
| terminal_write_p95_ms | 0.054963 | 0.053541 |
| write_to_output_p95_ms | 0.109385 | 0.108163 |
