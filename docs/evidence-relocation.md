# L112 observer relocation

Inventory revision: `b0d75619e9631910b325e647597e58bbaa33ad67`. `loop/evidence-paths.json` defines the complete per-path classification: enumerate that revision's tracked files under its three `roots`; an explicit `relocated` row is an observer or input, and every other path is generated evidence. This avoids copying 4,992 payload names into a second inventory. The audit checks the revision, root counts and every relocation destination.

| Inventory | Tracked | Relocated | Generated remaining for #1651 |
| --- | ---: | ---: | ---: |
| artifacts/ | 4,874 | 12 | 4,862 |
| crates/rpc/r16/ | 81 | 9 | 72 |
| crates/rupd/evidence/ | 37 | 2 | 35 |
| Total | 4,992 | 23 | 4,969 |

Relocation preserves the tracked-file count. Added source/summary files are `loop/evidence.test.py`, `loop/evidence-paths.json` and this summary. #1651 must reconcile against its actual base; this inventory fixes the original universe, not later unrelated additions. Generated payloads are not added or edited here.

```text
apps/desktop/observers/       U152, U157, U346, U431, journey/J14
crates/rpc/tests/observers/   R16 collectors, comparators and four inputs
crates/rupd/tests/observers/  Rail reply collector and comparator
loop/fixtures/               L103 verdicts
```

## Reader audit

| Observer/reader | Direct and indirect inputs | Output/regeneration |
| --- | --- | --- |
| Builder L103 | Two exact-byte fixtures in `loop/fixtures/`; no generated report input | Two named tests below |
| U152's three scripts | Running isolated `tree-40` harness, width/theme arguments; browser seed and in-page RPC wrapper. No adjacent files read | `bash apps/desktop/observers/U152/observe{,-agent,-motion}.sh <width> <theme>`; stdout readings. U156 motion/reduced-motion sampling unchanged |
| U157 | Isolated real harness on port 5199 with the recorded Workstreams/Todos; RPC responses, width/theme arguments. No adjacent file read | `bash apps/desktop/observers/U157/observe-real.sh <width> <theme>`; stdout. Historical method names require the recorded historical production revision |
| U346/N7 | Adjacent `observe.sh`; root `target/debug/rupd`, `rup`, fake Claude at `crates/rup/tests/e2e/fake_claude.py`; Vite/RPC/browser doubles or real Daemon. Root depth updated; every original lifecycle/isolation assertion retained | `cargo build -p rupd -p rup`, then `python3 apps/desktop/observers/U346/observe.test.py`. Live observer runs from root and creates `artifacts/ux/U346`; six isolated headless profiles, owned data and stdin cleanup unchanged |
| U431/U432 | Running isolated `tree-40` harness, browser DOM; no adjacent input | `bash apps/desktop/observers/U431/observe.sh` from root. Creates `artifacts/ux/U431` and `U432`, never writes beside source |
| J14 | Adjacent `observer.ts.txt`; `apps/desktop/package.json`; source-owned testing helpers `captures`, `checks`, `chromePage`, `realDaemonFixture`, `realSeam`, then their fake Claude/Daemon/browser inputs. No generated evidence read | `python3 apps/desktop/observers/journey/J14/reproduce.py`; installs temporary test, runs `just capture J14`, restores package/test. Root depth updated; four passes, journey partition and all assertions unchanged; historical assertions run against their recorded production revision |
| R16 collectors | Explicit binary paths, historical worktree and generated temporary reports; binary hashes read for provenance. No adjacent payload input | `python3 crates/rpc/tests/observers/r16/observe.py <profiles\|isolation\|pairs> <fresh-output> <paths...>`; modes retain original calls, retries, load threshold and misses |
| R16 build/resume | Source-owned `probe-client.patch`, `staging/probe-repair.patch`, `historical-reply.rs`, `observe.py`, staging `compare.py`; historical/current lockfiles, historical perf sources/budgets, current Client sources and frozen binaries. Compatibility setup also needs relocated `probe-compatible.patch` | Build commands below; output is required via `ROUNDUP_OBSERVER_OUTPUT`, independent of source location. Root derived from script; resume uses same output |
| Two R16 comparators | Newly generated `pairs.jsonl` in `ROUNDUP_OBSERVER_OUTPUT`; historical `/tmp/rpc-1374-history/crates/perf/budgets.json` | `ROUNDUP_OBSERVER_OUTPUT=<output> python3 <relocated-compare.py>`; unchanged nine-pair assertions, metric/limit/RSS comparisons |
| Rail reply collector/comparator | Collector takes explicit binaries/worktree/output, reads own temporary report and binary hashes. Comparator reads `<output>/observations/pairs.jsonl` and explicit budgets argument | `python3 crates/rupd/tests/observers/rail-reply/supported-7763/observe.py <mode> <fresh-output>/observations <paths...>`; `ROUNDUP_OBSERVER_OUTPUT=<output> python3 crates/rupd/tests/observers/rail-reply/supported-7763/compare.py <historical-budgets>` |

All other tracked PNG/JSON/JSONL/log/text/report/README files are historical generated results or their report narratives, not executable or test inputs. Historical reports can be fetched from the inventory revision. Comparators regenerate their report inputs into an explicit output directory; none require committed pairs. Scenario artifact-relative citations and historical-checkout commands remain valid at their recorded revisions. Current source paths are in the manifest above; no QA workflow or production Rust implementation changes.

For R16 continuation regeneration, use disposable historical worktree `/tmp/rpc-1374-history` at `1d1618d2d9bb5c0f25ecb6b32de1cde20bfad6d0` and original Client worktree `/tmp/rpc-1476-original` at `0698c9f1`. Create `/tmp/r16-1476-binaries`. Apply the relocated `probe-compatible.patch` by absolute path with `git apply --unidiff-zero` in the historical worktree; build `cargo build --release -p rupd -p rup -p perf` there. Build `cargo build --release -p rupd -p rup -p rpc --examples` in the selected repaired checkout and install its dependencies. Historical exact performance regeneration uses the recorded repaired revision `b856ae9a`, importing these observer sources/inputs from this relocation revision; current measurements must name their actual head instead. Then run `ROUNDUP_OBSERVER_OUTPUT=<fresh-output> python3 crates/rpc/tests/observers/r16/staging/continuation-7763/build-and-observe.py` from the repaired checkout. The driver finishes builds and check before observing; run `r16_parse` three times afterward if parser profiles are required. Never equate a collector exit with performance acceptance. `resume.py` is only for the recorded build-stage continuation, not overwriting observation files.

#1651 already lists #1700 as a native prerequisite. It stays blocked until this PR merges and closes #1700. Coordination references: #1615 owns RPC migration, #1620 owns Daemon readers, #1613 owns QA callers/publication; this PR moves their observer files without changing their implementations.

## Validation

Captures disabled. Exit rows are updated after each command ends; no new browser/performance pass is claimed by relocating source.

| Command | Exit |
| --- | ---: |
| `python3 loop/evidence.test.py` before relocation | 1 (missing manifest; red) |
| `pnpm install` | 0 |
| `cargo build -p rupd -p rup` | 0 |
| `python3 loop/builder.test.py Critic.test_l103_replay_of_an_undesigned_pr_rejects_with_a_named_cause Critic.test_l103_replay_of_an_accepted_pr_approves L104.test_l104_recorded_sequence_runs_build_check_review_idle` | 0 |
| `python3 apps/desktop/observers/U346/observe.test.py` | 0 |
| `python3 loop/evidence.test.py` (inventory, assertion preservation, import/syntax audit, three Builder regressions and N7 without evidence directories, J14 restoration, comparator failure counts) | 0 |
| `python3 loop/builder.test.py` | 0 |
| `bash loop/captures.test.sh` | 0 |
| `loop/rules.sh vocab` | 0 |
| `env -u ROUNDUP_CAPTURES VITEST_MAX_WORKERS=2 just check` (before main refresh) | 100; unrelated `rupd::b6_prompt_identity::b6_a_checked_effect_completes_before_a_racing_prompt_replacement` failed; 1,577 Rust tests passed |
| `cargo nextest run -p rupd --test b6_prompt_identity b6_a_checked_effect_completes_before_a_racing_prompt_replacement` (after merging main `eedfce650e37b6de385a7622e75b0639063026c3`) | 100; same Q11 non-TTY fake-runtime failure |

The initial check failure was owned by prerequisite #1708, now completed through main. No B6 assertion or production runtime is changed by this relocation. The surviving relocated Resume-cleanup proof is `cleanup_completion::b6_resume_completion_waits_for_both_promotion_failure_cleanups` in `crates/rupd/tests/b6_cleanup_completion.rs`; its behavioral acceptance is B6’s Resume cleanup amendment in `scenarios/messages.md`. The former Takeover race is retired there by B3563d (`scenarios/remove-control-consent.md`).

| Final refreshed command | Exit |
| --- | ---: |
| `env -u ROUNDUP_CAPTURES VITEST_MAX_WORKERS=2 just check` after merging main `eedfce650e37b6de385a7622e75b0639063026c3` | 100; same B6/Q11 fake-runtime failure; 1,577 Rust tests passed, 89 not run, two skipped |
| `python3 loop/evidence.test.py` after the merge | 0; all four relocation audits pass |
| `just check-web` with captures unset | 0; lint, typecheck, slop, reporting tests and 2,880 desktop tests pass; 11 skipped |

Validation checkout: `1d16268dcc9886ece0a52ed73d31ef3b0d0765e8`. The final follow-up commit records these result rows only. These failures preceded the completed prerequisite repair.

## Completion validation

Merged main `c8194f2677e7315d4121246577070d11f2296a2d`, including the prerequisite repair, into validation checkout `2ce739bbd330fe61a0969b770c11b9d65217b97e`. The diff against main contains only this relocation's files. Captures remain unset; no generated payload is added or edited.

| Command | Exit |
| --- | ---: |
| `pnpm install` | 0 |
| `env -u ROUNDUP_CAPTURES VITEST_MAX_WORKERS=2 just check` | 0; 1,704 Rust tests pass, two skipped; proofs, lint, types and 2,880 desktop tests pass, 11 skipped |
| `python3 loop/evidence.test.py` during concurrent Rust build | 1; N7 real-Daemon launch record missing |
| `python3 loop/evidence.test.py` rerun | 0; all four audits, including three required Builder regressions and N7 removal simulation, pass |
| `python3 loop/builder.test.py` | 0; all 188 tests pass |
| `bash loop/captures.test.sh` | 0 |
| `loop/rules.sh vocab` | 0 |

#1700's scoped relocation acceptance is complete. #1651 remains dependent on this PR merging; the full evidence-directory removal belongs to that Issue.

## Refreshed validation

Validation checkout: `299ad342a55f09e403bfcfc81eb4671419b7243a`, after merging main `29f31e2b`. The diff against main contains only the relocation's files. Captures remain unset.

[CI run 38564538715](https://github.com/saadshahd/roundup/actions/runs/38564538715) records startup timeouts in U359, U426 and U441 before Chromium's first DevTools reply; its captured browser main thread is waiting on disk reads. All 56 tests in those three suites pass in the full validation below. Browser timeouts and assertions are unchanged.

| Command | Exit |
| --- | ---: |
| `pnpm install` | 0 |
| `env -u ROUNDUP_CAPTURES VITEST_MAX_WORKERS=2 just check` | 0; 1,704 Rust tests pass, two skipped; proofs, lint, types and 2,880 desktop tests pass, 11 skipped |
| `python3 loop/evidence.test.py` | 0; all four audits, including the required Builder regressions and N7 removal simulation, pass |
| `python3 loop/builder.test.py` | 0; all 188 tests pass |
| `bash loop/captures.test.sh` | 0 |
| `loop/rules.sh vocab` | 0 |
