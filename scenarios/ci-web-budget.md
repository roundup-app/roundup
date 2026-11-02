# Web CI time budget

Work order: [#5527](https://github.com/roundup-app/roundup/issues/5527). This specification partitions the complete slow-file audit into eight independently deliverable children. It claims no new measured speedup.

Scope: web test mounts and queries under `apps/desktop/`, the existing reporting/measurement surfaces under `tools/e14/`, and the web budget wiring in `.github/workflows/check.yml`. Existing test fixtures and production mount boundaries may change only to preserve the behavior their scenarios require while reducing mounted or queried content. No new product behavior, RPC, App seam command or domain term. Frozen loop machinery stays unchanged.

## Checks on main

1. Full web workload and required aggregate gate: `.github/workflows/check.yml`, `jobs.plan`, `jobs.web` and `jobs.check`. A main push runs all seven web partitions on `ubuntu-24.04`; `test-web` has a 15-minute timeout and the job has a 35-minute timeout.
2. Existing reports and elapsed measurement: `tools/e14/observe.py`, `run`, `web_rows` and `evidence`; `tools/e14/reporter.mjs.in`, `LifecycleReporter.onTestRunEnd`; `apps/desktop/vite.config.ts`, `defineConfig` test reporters. Reports retain test identities, results and timing; Actions records the whole step interval separately from the observer's child-command interval.
3. File timing including hooks: `loop/web-durations.py`, module docstring and stdin parser; `justfile`, `web-durations`. Prefer Vitest's printed file duration, which includes file hooks, to its JSON assertion interval, which omits them.
4. Existing shard assignment: `apps/desktop/src/testing/shardSequencer.ts`, `TimedSequencer`; `apps/desktop/src/testing/shardDurations.json`; `justfile`, `test-web-since`. A full observation uses an empty base, not a PR's affected selection.
5. Assertion preservation and library reuse: `AGENTS.md`, Rules 9 and 10. The installed Ark UI and Testing Library capabilities are inspected before introducing machinery; existing test behavior remains acceptance.

## Acceptance

**CI5527a every slow file is assigned exactly once.** Given one green full `check` run on main before implementation, when its seven web shards are audited, then the implementation records every executed test file whose unrounded Vitest file duration exceeds 30,000 ms, including hooks, across all seven shards (policy; observer: the baseline job logs and reports in Checks 2–3). The seven files in the work order are examples, not the audit boundary. Record the run URL, commit, shard, file, duration and test count; retain the source reports. Never infer a file's cost from a stale shard weight or summed assertion time alone.

The fixed baseline is green full main run [41343826661](https://github.com/roundup-app/roundup/actions/runs/41343826661), commit `95ed599054a7f74d856a565324d8f938f4b4f135`: 77 files exceed 30,000 ms across seven shards. The child tables below partition that inventory exactly once. Each child owns only its listed files; completion of one child requires no repair or measurement for a later child. For every file in its table, reduce what it mounts or the content its queries traverse, and record the concrete change and a lower measured duration under the same command, runner class and workload (policy; observer: a baseline/head table on that child Issue with report links). Keep the test action sequence and each then-clause it proves. A failed, skipped or missing observation supplies no speedup evidence; record every failure separately with its command and exit code. Changed test files pass by their explicit filenames. Rule 10 removals name the surviving test and the then-clause it still asserts; other tests, assertions and scenarios are not removed, skipped or weakened to meet the budget (policy; observer: the diff and those tests).

### Child acceptance (policy)

Each child below is a separate implementation work order. Given the listed baseline files and its completed prerequisite, when its mount/query repairs run, then every listed file has a concrete repair and a paired lower hook-inclusive Vitest duration, passing unchanged action sequences and then-clauses under explicit filename selection (policy; observers: CI5527a's paired table, report identities and changed tests). Each table gives baseline shard, unrounded milliseconds and test count including existing skips; paths are relative to `apps/desktop/`. A current file already improved on main still needs attributable paired evidence; a missing or slower sample does not retire it. No child adds a timeout, retry, shard or runner change, or weakens coverage. Rule 10 cuts retain their named surviving test.

CI5527d is the requested exception to slowest-first ordering: it preserves the ten measured files from [PR #5610](https://github.com/roundup-app/roundup/pull/5610). Its Builder starts from `ab19b5738c7146f634066a582a6447ca5ec95d87` (`refs/pull/5610/head`), merges current main preserving both sides, and retains the applicable mount/query repairs. Its source evidence is `tools/e14/ci5527-paired.json` at that head: seven files there plus three prior measurements linked on #5527. Existing source reports may supply paired evidence when their command, runner, workload and test identities still match the retained repair; changed or conflicted repairs need fresh paired measurements. Keep the complete inventory and failure records. The source head also contains budget/report work: defer active budget enforcement to CI5527c after all repair children; do not silently enable it in the first child. Review the existing observer/reporter changes against that final scope rather than discard them.

The remaining files are sorted by descending baseline duration, path as tie-breaker, in contiguous batches of at most ten. Each child is natively blocked by the preceding child; CI5527d is blocked by the specification Issue. A separate final implementation Issue owns CI5527b and CI5527c and is blocked by CI5527k. The Issue tracker holds links, scheduling and progress; these tables hold acceptance only.

**CI5527d preserve the ten measured repairs.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/shelf/u3789_rows.test.tsx` | 2 | 271223 | 65 |
| `src/todos/u3787a_undo.test.tsx` | 2 | 161698 | 32 |
| `src/keys/u4324_app_chords.test.tsx` | 7 | 153540 | 81 |
| `src/keys/u2539b_tasks.test.tsx` | 6 | 141691 | 51 |
| `src/shelf/u3723_keys.test.tsx` | 2 | 137542 | 27 |
| `src/testing/u3787d_literal_fields.test.tsx` | 2 | 83544 | 27 |
| `src/keys/u4692_attention.test.tsx` | 7 | 80065 | 22 |
| `src/shelf/u3787c_selection.test.tsx` | 6 | 64602 | 16 |
| `src/testing/u3787c_inventory.test.tsx` | 1 | 55674 | 18 |
| `src/app/u23_layout.test.ts` | 1 | 38962 | 1 |

**CI5527e repair slow-file batch 2.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/ui/s3806b_actions.test.tsx` | 1 | 267262 | 128 |
| `src/bubbles/u3756_focus.test.ts` | 3 | 254339 | 27 |
| `src/terminal/u514_browser.test.ts` | 4 | 177032 | 22 |
| `src/keys/u3787b_menu.test.tsx` | 2 | 145835 | 52 |
| `src/todos/u4698d_browser.test.ts` | 6 | 132837 | 9 |
| `src/drawer/u4458_browser.test.ts` | 7 | 126952 | 6 |
| `src/switcher/u3787c_browser.test.ts` | 5 | 125027 | 4 |
| `src/keys/u2230_hints.test.tsx` | 3 | 119433 | 43 |
| `src/testing/u463_real_daemon.test.ts` | 3 | 116953 | 6 |
| `src/bubbles/u4274_navigation.test.tsx` | 1 | 106179 | 44 |

**CI5527f repair slow-file batch 3.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/rail/persist/u100_persist.test.tsx` | 3 | 104361 | 17 |
| `src/todos/u3720_real_daemon_owner.test.tsx` | 4 | 96780 | 2 |
| `src/drawer/u3010b_rendered.test.ts` | 4 | 84758 | 17 |
| `src/inbox/u3770_inbox.test.tsx` | 1 | 79861 | 33 |
| `src/settings/u3799_app_settings.test.tsx` | 3 | 78889 | 15 |
| `src/testing/u346_pad_confirm.test.tsx` | 2 | 78508 | 2 |
| `src/testing/u137_checks.test.tsx` | 3 | 78374 | 54 |
| `src/todos/u5119_browser.test.ts` | 5 | 77987 | 2 |
| `src/ask/u505_ask_rows.test.tsx` | 7 | 70982 | 12 |
| `src/bubbles/u2694e_right_click.test.tsx` | 3 | 70247 | 42 |

**CI5527g repair slow-file batch 4.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/changes/u2540c_send.test.tsx` | 3 | 69490 | 25 |
| `src/testing/u2580a_key_layers.test.tsx` | 6 | 64555 | 5 |
| `src/keys/u4690_clicks.test.tsx` | 6 | 64324 | 51 |
| `src/testing/u177_restarted_door.test.tsx` | 7 | 64130 | 1 |
| `src/ui/u484_browser.test.ts` | 5 | 63977 | 4 |
| `src/todos/u492a_browser.test.ts` | 5 | 62965 | 4 |
| `src/reactions/nr9_reactions.test.tsx` | 7 | 62847 | 40 |
| `src/header/u183_rename.test.tsx` | 7 | 62511 | 46 |
| `src/todos/u461_rendered.test.ts` | 6 | 60680 | 10 |
| `src/keys/u4690_browser.test.ts` | 2 | 59806 | 10 |

**CI5527h repair slow-file batch 5.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/rail/menu/u3787a_browser.test.ts` | 3 | 58189 | 2 |
| `src/shelf/u371_reserved_modes.test.ts` | 1 | 58122 | 4 |
| `src/todos/u152_every_action.test.tsx` | 6 | 56101 | 65 |
| `src/shelf/u3789_browser.test.ts` | 6 | 54406 | 39 |
| `src/todos/u3710_browser.test.ts` | 2 | 53646 | 11 |
| `src/bubbles/u2742_browser.test.ts` | 7 | 53208 | 6 |
| `src/terminal/u3517_browser.test.ts` | 4 | 51291 | 50 |
| `src/todos/u4698e_browser.test.ts` | 3 | 51111 | 2 |
| `src/testing/u159_workstream_todos.test.tsx` | 2 | 50320 | 23 |
| `src/pads/p2544a_browser.test.ts` | 1 | 49569 | 4 |

**CI5527i repair slow-file batch 6.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/shelf/u3721_browser.test.ts` | 3 | 49465 | 3 |
| `src/todos/u3718_owner_drag.test.ts` | 5 | 47640 | 5 |
| `src/todos/u3751_triage.test.tsx` | 1 | 47285 | 67 |
| `src/pads/u3787a_restore.test.tsx` | 7 | 44215 | 26 |
| `src/keys/u481_browser.test.ts` | 6 | 42282 | 5 |
| `src/perf/k1_opt_in.test.ts` | 1 | 41676 | 8 |
| `src/testing/u362_todo_drag.test.ts` | 1 | 40144 | 4 |
| `src/app/m8_project_requested.test.tsx` | 3 | 39643 | 21 |
| `src/bubbles/u469_bar.test.ts` | 6 | 39528 | 7 |
| `src/shelf/u373_frame.test.tsx` | 1 | 38136 | 19 |

**CI5527j repair slow-file batch 7.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/settings/u5239_shortcut_settings.test.tsx` | 2 | 37960 | 12 |
| `src/rail/u2875d_import.test.tsx` | 1 | 37683 | 25 |
| `src/switcher/u529_switcher.test.tsx` | 5 | 36942 | 19 |
| `src/ui/u535_browser.test.ts` | 1 | 36861 | 6 |
| `src/ui/u133_press.test.ts` | 7 | 36709 | 15 |
| `src/rail/u426_rendered.test.ts` | 4 | 36371 | 5 |
| `src/changes/u2539b_rendered.test.ts` | 5 | 34385 | 5 |
| `src/rail/u4547e_browser.test.ts` | 3 | 34357 | 2 |
| `src/settings/u3806_preferences.test.tsx` | 4 | 33263 | 27 |
| `src/rail/pads/u4457_pads_control.test.tsx` | 6 | 33160 | 5 |

**CI5527k repair slow-file batch 8.** Given this table, apply the child acceptance above to every row (policy; observers: paired file measurements and existing scenario tests named by each file).

| File | Shard | Baseline ms | Tests |
| --- | ---: | ---: | ---: |
| `src/shelf/u371_reserved_motion.test.ts` | 1 | 33128 | 3 |
| `src/ui/u3512_rendered.test.ts` | 5 | 32628 | 4 |
| `src/switcher/u2572_actions.test.tsx` | 2 | 32388 | 43 |
| `src/rail/menu/u2694_menu.test.tsx` | 7 | 30590 | 31 |
| `src/terminal/u3707_browser.test.ts` | 6 | 30478 | 1 |
| `src/todos/u490a_browser.test.ts` | 4 | 30473 | 8 |
| `src/terminal/u102_emulator.test.ts` | 1 | 30119 | 12 |

**CI5527b all seven full shards finish under ten minutes.** Given the first green full main `check` run after the implementation merge, when Actions records each web shard's `test-web` start and completion, then every interval is strictly less than 600 seconds (policy; observer: Actions step timestamps, with one Issue row per shard naming run/job URL, commit, start, finish, seconds and conclusion). Step time includes preparation inside `test-web`, test execution and report/budget work; neither whole-job time nor the observer's child-command time replaces it. A missing shard, cancelled run, failed step or affected-only PR run cannot satisfy this observation. If an earlier full post-merge run fails, retain its evidence and repair forward; do not conceal it by selecting only successful samples.

Keep all seven shards, their full test selection, runner class and concurrency configuration. Neither a timeout increase, a new retry, moving tests out of the measured step nor extra shards obtains this result. The 900-second step limit and existing job limit stay unchanged. Refreshing existing duration weights may accompany the mount/query repairs but cannot substitute for them (policy; observer: Checks 1 and 4, the diff and the main-run reports).

**CI5527c an over-budget shard fails with its slowest files.** Given a web shard whose tests pass, when its `test-web` elapsed time exceeds 720 seconds, then the shard fails and the required `check` cannot pass. Exactly 720 seconds passes this budget gate; 720.001 seconds fails. Apply the guard to both full and affected selections, measuring the whole step interval defined above with a monotonic clock. Tests that fail retain a failing result even below the budget. The guard runs from the real web CI path, never solely as a report annotation (test: planned `ci5527c_web_budget_controls_the_exit_result`, at the production budget/exit seam under `tools/e14/`, with elapsed time supplied through the clock seam rather than a twelve-minute wait; policy observer: `jobs.web` and `jobs.check` effective wiring).

On a budget failure, print the shard identity, actual elapsed seconds, 720-second budget, and its five slowest executed files with their durations in descending order, or all executed files when fewer than five exist. Rank the current shard's Vitest file durations including hooks from the report it already produces (Checks 2–3); do not rerun tests, start a browser or add a second test pass. Tie order is by path. Missing or malformed timing evidence fails visibly with its cause rather than passing or substituting stale data (tests: planned `ci5527c_budget_failure_names_the_five_slowest_files` and `ci5527c_missing_or_invalid_report_cannot_pass`, exercising the production reader with report fixtures).

The regression fixtures exercise below/at/above 720 seconds, an already-failed test command, six files supplied out of duration order, tied durations, fewer than five files, and absent/malformed reports. Assert exit results and diagnostic identities/durations, not workflow text or a copy of the budget constant. No fixture waits for 720 real seconds (tests: the three named tests above). A controlled invocation of the production guard with passing test results and an elapsed interval above 720 seconds records a nonzero exit and the five-file diagnostic; this observation uses fixture timing, never an intentionally slowed shared main run (policy; observer: command, output and exit code on the Issue).

## Completion (policy)

The specification is complete when CI5527a partitions all 77 baseline files exactly once into CI5527d–k, each has a scoped child Issue with the native prerequisite chain, and a final CI5527b/c implementation Issue is blocked by the last child. The specification PR closes #5527 only for this split; it does not claim the performance target or guard is implemented. Implementation Issues remain open for their own acceptance and are blocked until these scenarios merge.

The final implementation Issue retains CI5527b's first green full-main observation after its implementation merge. Its guard PR alone cannot supply that post-merge evidence: keep that Issue open until a subsequent run records all seven full step intervals, repairs forward on failure, and closes it with the observation evidence. A green PR with selected tests supplies no full-run performance result. Progress, measurements and unresolved engineering work belong on the Issues. No scenario Work table or Mac-only observation is required.
