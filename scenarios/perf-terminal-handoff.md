# Perf: readiness across the retained/live handoff

Acceptance for #4006. Ownership: the shared measurement-only readiness operation in `apps/desktop/src/perf/run.ts` and its tests in `apps/desktop/src/perf/r3841_ready.test.ts`. Production Terminal behavior, contracts, performance budgets, loop machinery and native drag qualification are outside this repair.

## Checks on main

1. Shared setup, selected shell and 10 s setup bound: `apps/desktop/src/perf/run.ts`, `terminalReady`, `reportTerminal`, `SETUP_BOUND_MS`; `scenarios/perf-terminal-ready.md`, R3841a every Terminal-driving perf run shares setup.
2. Readiness before opening, after opening and across retained pages: `apps/desktop/src/perf/r3841_ready.test.ts`, `r3841b_ready_before_or_after_bubble_open_releases_setup`, `r3841b_retained_readiness_crosses_read_pages_without_restarting_the_shell`.
3. Complete-line recognition, shell identity and one continuation: `apps/desktop/src/perf/r3841_ready.test.ts`, `r3841c_only_the_measured_shell_can_release_setup_and_receive_report`; `apps/desktop/src/perf/k2_keystrokes.test.ts`, `r20_only_a_complete_ready_line_selects_the_report_terminal`, `r20_the_ready_line_survives_every_output_split_after_parsing`.
4. Missing-readiness rejection and zero workload calls: `apps/desktop/src/perf/r3841_ready.test.ts`, `r3841d_missing_readiness_stops_before_workload`; collection diagnostics: `crates/perf/src/keystroke.rs`, `collect_report`, `u3010e_an_incomplete_report_times_out_with_its_raw_output`, `u3010e_launch_failure_writes_an_invalid_report_with_run_logs`.
5. Opt-in and no real vendor turns: `scenarios/perf.md`, K1 opt-in, R12 the window needs a yes; `crates/perf/src/keystroke.rs`, `r20_perf_workstream_never_starts_real_claude`.

**R4006a readiness has no handoff gap.** Given shared setup has selected its shell and a retained `terminal.read` has returned `truncated: false` with no complete `ready` line, when that shell emits its sole complete `ready\n` or `ready\r\n` line after the read returns but before its emulator parses any write, and those bytes remain available through `terminal.read`, then setup completes before the existing 10 s readiness bound, returns that shell's input and continues the workload exactly once. No live parsed write containing `ready`, second readiness emission, shell restart or second shell-open action is needed. Planned `r4006a_ready_between_retained_read_and_first_parsed_write_releases_setup` in `apps/desktop/src/perf/r3841_ready.test.ts` asserts these results through the real `terminalReady` and `reportTerminal` operations with the existing fake App and DOM seams.

Exercise both line endings, an initially empty retained response (`next` equals the requested `after`) and an initially nonempty response with no complete readiness line. Include a `ready` line split across consecutive retained responses where the first response is not truncated; setup remains pending until the terminating newline is available. The same planned test asserts that incomplete-line case and eventual single continuation. Order retained responses and parser callbacks explicitly; use fake time for the existing bound, with no process, browser, real clock or successful readiness stub.

## Regression requirements

Policy: preserve Checks 1–5. Extend the existing readiness test file rather than add another fixture framework. Keep retained and live recognition separate so overlapping bytes cannot manufacture a line. An Agent's output, a partial line or `already`, `not ready` and `readying` never authorize setup. Check 3 retains that proof; Check 4 retains rejection at the unchanged bound with zero workload calls when readiness never arrives. Keep their tests unless a named replacement proves the same clause under rule 10.

Policy: retain the runner's exit codes and diagnostics below. Recovering readiness permits measurement; it does not establish a performance pass. No budget, missing-stage rule, native observer or window authorization changes.

| Scripted observer failure | Exit | Required result |
| --- | ---: | --- |
| Agent input, shell input or complete shell readiness absent at its setup bound | 2 | Name the failed setup step; perform no measured workload |
| No complete report before the collection bound | 2 | Retain raw output and launch logs (Check 4) |
| A required stage remains unmeasured | 2 | Qualification remains incomplete |
| A valid measurement misses an existing performance budget | 1 | Retain the failing report |

Policy: P9's applicable gate asks whether this repair starts a real Agent or spends a Model turn; Check 5's fake-vendor sentinel remains its observer. This acceptance is a Linux fixture observation of readiness ordering; it requires no Mac observation and supplies no native qualification. No product surface or design Check moves.
