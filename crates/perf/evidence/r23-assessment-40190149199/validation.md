# Offline assessment validation

Python 3.12.15. Product/test source is merged head
`a4395b90a14b9426644c08d48854af3c611cca3b`; the merge of `60ab27fec` had no
conflict resolutions and its remerge diff is empty. No new workload or timing
observation ran. The final commit adds validation records only.

| Command / check | Actual exit | Result |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | Frozen dependencies installed before push. |
| Original capture's `extract.py` and `endpoints.py`, redirected to fresh scratch | 0 | All eight 2200-write joins and both physical joins reproduce the original JSON and decompressed CSV exactly. See the capture's `reproduce.txt`. |
| This directory's `assess.py.txt.gz`, as README commands | 0 | Both JSON files and both decompressed CSVs reproduce exactly. All six consumed file hashes match the original checksum manifest; all example selected-poll scheduler partitions have known state. |
| `CARGO_TARGET_DIR=/home/runner/work/roundup/roundup/target just lint-rust` | 0 | Initial and merged-head runs pass, including `ALL PROOFS CHECK`; final log retained. |
| `just lint-web` | 0 | Initial and merged-head runs pass; final log retained. |
| `CARGO_TARGET_DIR=/home/runner/work/roundup/roundup/target cargo build -p rupd -p rup` | 0 | Debug fixtures built; temporary worktree `target` link exposes the shared build path. Link removed after tests. |
| `CARGO_TARGET_DIR=/home/runner/work/roundup/roundup/target cargo nextest run -p perf` | 0 | 99 passed, none skipped. |
| `pnpm --filter desktop exec vitest related --run /tmp/r23-assessment/apps/desktop/src/testing/realDaemonPlugin.ts` | 1 | 157 passed, 13 skipped, two failed. N5 first times out at 120 s, then retries with a fixture-path assertion failure. U463 first-run times out twice at 180 s. The run overlaps debug fixture builds, Rust checks and web lint. No causal claim about those failures is made. |
| `pnpm --filter desktop exec vitest run src/testing/n5_real_daemon.test.ts -t n5_fixture_data_is_private_and_survives_restart` | 0 | Failed test passes; two other tests excluded by filter. |
| `pnpm --filter desktop exec vitest run src/testing/u463_real_daemon.test.ts -t u463_first_run_chooses_the_configured_project_and_reaches_its_real_door_terminal` | 0 | Failed test passes; five others excluded by filter. |
| `loop/rules.sh vocab`, `loop/rules.sh merge-loss`, `git diff --check origin/main` | 0 each | No vocabulary, merge-loss or whitespace defect. |

Across the suite and its focused reruns all 159 executed web tests pass at
least once; 13 remain intentionally skipped. The first failed run and both
reruns are retained separately as compressed logs, not reported as one clean
suite invocation. Browser observations use isolated headless test sessions.
No test, timeout, scenario or production source was edited.
