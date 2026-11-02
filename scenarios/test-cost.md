# Cost of rupd tests

Policy — N5467d (`scenarios/local-data-retirement.md`, #5467) retires R3778b–e's additive-upgrade and legacy-BLOB compatibility requirements, the historical portion of `r3778c_legacy_and_file_reopen`, and the mixed legacy/file representation requirements of R4160a/b. Replace those fixtures with current-format publications; retain exact quota boundary/refusal, chosen-allocation cleanup, identities, bytes, reopen, file durability and current crash recovery. Remove legacy BLOB decoders and their exclusive quota accounting. The historical upgrade measurement pairs and historical-fixture regression anchors below are retired; fresh/current-format measurements and product limits remain. The test named `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity` retains only fresh-from-empty equivalence and distinct identities under N5467c. Remaining historical wording below describes retired acceptance, not a compatibility exception.

Module: `crates/rupd`. Source: #2964. Acceptance below is policy for the implementation and its review; it requires no new test that checks test text or inventory text.

**T2964a remove redundant cost without losing behavioral proof.** Given the 24 tests in the inventory below, when their tests are audited under `AGENTS.md`, Rules, rule 10, then each original test has exactly one disposition in the implementation PR body (policy):

| Action | Required evidence in that test's row |
| --- | --- |
| Cut | Identify the compiler/type/lint check that catches the same break, the surviving test whose body catches it, or the explicitly retired scenario clause. A copied-value assertion alone is removed; retain any independently useful behavioral assertion. |
| Make cheap | Name the replacement test and the scenario clause it asserts. It fails for the same behavior break while starting no process, browser, Daemon, PTY or real `claude`. |
| Keep | Name the scenario clause and the specific real process or clock it needs, and explain why an observation starting none cannot catch that break. Put that requirement in the owning scenario if absent. A fixture using a process is not by itself evidence that the behavior needs one. |

Policy: inspect assertions and callers, not test names alone. Every retained scenario clause keeps a test whose body fails when that clause breaks, including after consolidation. Name replacements for renamed, split or merged tests in each original row. Do not replace a real behavioral assertion with an assertion only about a test double. Apply rule 10 to every edited test file, naming each additional cut and its surviving proof or retirement. No coverage target or prescribed number of kept tests applies.

Inventory: binary names identify the original CI test binaries; seconds are the baseline per-test elapsed times from green `check` run 39378452452. These are the fixed audit set, not a work queue.

| test | binary | seconds |
|---|---|---|
| `cleanup_completion::b6_resume_completion_waits_for_both_promotion_failure_cleanups` | `rupd::b6_cleanup_completion` | 82.3 |
| `cleanup_completion::b6_ack_timeout_waits_for_rollback_cleanup_and_accounts_for_refusal` | `rupd::b6_cleanup_completion` | 20.6 |
| `b21_start_releases_each_changed_child_under_b22s_caps` | `rupd::b21_stopped_door` | 16.9 |
| `b6_later_door_effects_cannot_overtake_a_released_resize` | `rupd::held_resizes` | 14.0 |
| `b21_a_reopened_door_waits_until_explicit_start` | `rupd::b21_stopped_door` | 11.5 |
| `b2704a_rename_updates_context_and_queues_one_note` | `rupd::b50_note_inbox` | 10.3 |
| `resources::tests::d8_a_disk_size_is_cached_for_30_s_and_the_walk_never_holds_the_call_past_1_s` | `rupd` | 10.2 |
| `b2704a_first_prompt_rename_notifies` | `rupd::b50_note_inbox` | 10.0 |
| `b6_wire_later_door_effects_wait_for_all_earlier_resizes` | `rupd::held_resizes` | 9.9 |
| `cleanup_completion::b6_unconfirmed_terminal_exit_preserves_the_resume_failure_and_blocks_a_blind_retry` | `rupd::b6_cleanup_completion` | 9.7 |
| `b2704a_workstream_rename_notifies_its_door` | `rupd::b50_note_inbox` | 9.6 |
| `b21_a_failed_start_keeps_the_entries_waiting` | `rupd::b21_stopped_door` | 9.3 |
| `b21_a_stopped_door_waits_silently_and_gets_the_newest_entry_on_start` | `rupd::b21_stopped_door` | 9.3 |
| `b21_a_refusal_other_than_a_stopped_door_is_logged_and_retried` | `rupd::b21_stopped_door` | 9.2 |
| `x14_daemon_observer::x14_daemon_observer_capacity_matches_its_receiver` | `rupd::n7_data` | 9.1 |
| `b2704a_unchanged_names_produce_no_note_for_a_no_word_first_prompt` | `rupd::b50_note_inbox` | 8.8 |
| `b6_checked_effects_exclude_prompt_replacement_under_parallel_load` | `rupd::prompt_identity` | 6.7 |
| `cleanup_completion::b6_cleanup_refusal_preserves_the_resume_failure_and_blocks_a_blind_retry` | `rupd::b6_cleanup_completion` | 5.5 |

**T2964b measure the implementation head.** Given T2964a's dispositions and a green `check` on the implementation PR's head, when its CI test timings are read, then the PR reports that run URL and head, each surviving original test's elapsed time and their sum against the recorded 313 s baseline (policy). Include the timings and a separate sum for replacement tests so moving work to another name cannot hide its cost. A cut contributes zero; a split or merge maps its measured tests back to all affected original rows and counts each executed test once in the total. Use per-test elapsed times from that run, not job duration, local timings or the baseline substituted for missing data. Missing timing evidence leaves acceptance unmet. No workflow or loop change is required or authorized by this scenario (policy).

Checks (existing acceptance on main; all remain in force):

1. `AGENTS.md`, Rules, rule 10: a test must detect its scenario's break without duplicating a cheaper proof.
2. `scenarios/messages.md`, B6's retired Takeover (its surviving cleanup amendments), B21 pushed on change, B22 caps, and B2704a: preserve action ordering, cleanup, stopped-Door delivery and rename-note behavior when changing their tests.
3. `scenarios/resources.md`, D8 the Daemon samples an Agent's Resource use when asked: preserve disk-cache and bounded-walk behavior.
4. `crates/rupd/tests/n7_data.rs`, `x14_daemon_observer::x14_daemon_observer_capacity_matches_its_receiver`: preserve actual receiver capacity, ordered delivery at capacity and lag at capacity plus one unless a named surviving test proves the same boundary.

Policy: this scope changes tests and the production seams needed to test the same behavior cheaply; it changes no product outcome, contract, performance budget or merge gate. Any scenario amendment must state the needed observer or an explicit retirement, never silently drop an existing behavioral requirement. Engineering progress and questions belong on #2964.

# Slow-test cost audit

Module: tests in `crates/agents`, `crates/terminal`, `crates/messages`, `crates/perf` and `crates/desktop`. Ids: R2965.

**R2965 preserve failure detection at lower test cost.** Given the 27 tests below, when their test cost is audited under AGENTS.md rule 10, then every original test has one disposition in the implementation PR's table: cut, make cheap, or keep. All acceptance below is policy, verified by independent review of the diff, surviving test bodies and the implementation head's CI evidence; add no test that rereads this specification or asserts the audit table.

1. Cut a test whose break already fails compilation, type checking or linting, whose assertions only repeat values copied from its implementation, or whose break another test already detects. Each cut names the surviving test and the then-clause it still proves, or explicitly retires the scenario's then-clause. For a compiler/type/lint rejection, name the failing check and the rejected construct. Do not retire required product behavior merely to delete its only observer.
2. Otherwise, make it cheap when a test starting no process, browser, Daemon, PTY or `claude` detects the same break. Replace the expensive setup with that observer, preserving the scenario's behavioral assertion and naming the replacement test. A shorter sleep alone does not establish equivalent failure detection.
3. Keep an expensive observer only when its scenario explicitly names the real process or clock it needs and the behavior that a process-free or controlled-time observer cannot detect. Add that need to the owning scenario if absent. A timer's existence alone does not require wall-clock waiting. Preserve the real-process assertion rather than merely exercising startup or checking a test double.
4. Every affected scenario's retained then-clause has a test whose body fails when it breaks. Further consolidation is allowed only with that mapping; changing test names or merging setup cannot hide a missing assertion. Apply rule 10 to the whole of each edited test file, naming the surviving proof or retirement for any additional cut.
5. The implementation PR has one row per original test below, with disposition, surviving/replacement test or retirement, and the reason. Renamed or consolidated tests remain traceable from every original row. Scope is these tests, their shared setup and the production seams necessary to remove their expensive setup, plus their owning acceptance scenarios; no product behavior change or loop machinery change is authorized.
6. From a successful `check` run on the implementation PR's own head, report the run URL, head SHA, each surviving observer's elapsed test time and their sum against the original 205 s group total. Include replacement tests, not only unchanged names; count a consolidated observer once and a cut with no replacement as zero. Use the same Linux test observations as the baseline, separating macOS observations and retries rather than adding them together. Missing timing evidence is incomplete acceptance. No fixed reduction target or weakening of existing product/performance bounds is authorized.

## Baseline inventory

Source: green `check` run [39378452452](https://github.com/saadshahd/roundup/actions/runs/39378452452). Times are elapsed test seconds, not workflow wall time; 205 s is the work order's rounded group baseline.

| test | binary | seconds |
|---|---|---|
| `x14_flood_leaves_rail_events_unlagged_and_cleans_up` | `perf::flood` | 14.8 |
| `d9_the_app_worktree_provision_wait_stays_within_the_call_bound` | `desktop::app` | 13.8 |
| `a35::a35_agent_wrong_acknowledgements_time_out_and_retry_the_same_copy` | `agents::scenarios` | 10.5 |
| `a35::a35_door_wrong_acknowledgements_time_out_and_retry_the_same_copy` | `agents::scenarios` | 10.5 |
| `orders::o8_the_prompt_survives_a_reopen_and_a_resume` | `agents::scenarios` | 10.4 |
| `resume::a2693a_a_stop_or_removal_claim_refuses_an_explicit_resume` | `agents::scenarios` | 10.4 |
| `resume::a21_a_failed_save_while_held_fails_the_whole_spawn` | `agents::scenarios` | 10.3 |
| `worktrunk::tests::u2556b_timeout_ends_a_stalled_collector` | `agents` | 10.1 |
| `a24::a24_a_start_never_acknowledged_fails_within_the_bound` | `agents::scenarios` | 8.3 |
| `events::tests::a14_a_signal_released_once_the_agent_is_registered_never_outruns_the_held_one` | `agents` | 8.2 |
| `n7_launch_sites_clean_on_success_and_failure` | `perf::n7` | 8.1 |
| `prepared_observer::g2542e_warm_launch_observer` | `agents::scenarios` | 8.0 |
| `x14_library_screen_edit_observation_survives_checkpoint_replay` | `terminal::library_edits` | 6.5 |
| `x14_library_screen_restore_state_is_bounded` | `terminal::library_attach` | 6.2 |
| `steer::a2703a_prompt_errors_use_rail_names` | `agents::scenarios` | 5.8 |
| `worktree_wiring::tests::u2875c_unpublished_resources_are_reconciled_at_every_durable_step` | `agents` | 5.5 |
| `orders::o3_a_workstream_gives_its_door_the_order_and_stopping_the_door_keeps_it` | `agents::scenarios` | 5.5 |
| `steer::h11_an_agent_that_ends_while_a_steer_waits_is_not_found` | `agents::scenarios` | 5.4 |
| `tests::b1_concurrent_sends_at_the_bound_never_both_succeed` | `messages` | 5.4 |
| `a41_removing_a_workstream_fails_its_queued_part` | `agents::asks` | 5.4 |
| `remove::a16_a_delete_failure_after_a_successful_stop_leaves_the_node_with_its_exited_agent` | `agents::scenarios` | 5.2 |
| `resume::a2681a_stopping_attempt_hides_parts` | `agents::scenarios` | 5.2 |
| `remove::a16_a_workstreams_failed_delete_leaves_its_children_under_it` | `agents::scenarios` | 5.2 |
| `resume::a2693a_stop_failure_launches_nothing` | `agents::scenarios` | 5.2 |
| `resume::a21_a_failed_save_after_spawn_returned_errors_settles_error_and_stops_the_terminal` | `agents::scenarios` | 5.2 |
| `events::tests::a14_a_failed_rail_write_for_a_held_signal_does_not_poison_the_locks` | `agents` | 5.1 |
| `events::tests::a21_a_failed_held_save_reinserts_so_the_caller_can_clean_up` | `agents` | 5.1 |

## Existing checks

1. `AGENTS.md`, Rules, rule 10: assertions must detect a scenario break; redundant or needlessly expensive tests are removed.
2. `justfile`, `lint-rust` and `lint-web`: compiler, lint and type-check rejection can replace tests of already-rejected constructs.
3. `crates/messages/src/lib.rs`, `tests::b1_concurrent_sends_at_the_bound_never_both_succeed`: the current B1 race observer is one of the audit subjects, not evidence that all observers require processes.
4. `crates/agents/src/worktrunk/tests.rs`, `u2556b_timeout_ends_a_stalled_collector`: the current collector timeout observer is one of the audit subjects; retention must identify the collector behavior that needs a real process or clock.


# Web test cost

Module: web tests in `apps/desktop/src` and their lint configuration under `tools/oxlint/` and `.oxlintrc.json`. Source: #3779. These scenarios specify T1's web timeout limit, T3's assertion limit and T4's web cuts. Implementation follows this specification in a dependent Issue; this specification delivers no lint or cut.

**T3779a bound web test timeouts.** Given a web test and the timeout it inherits or explicitly sets, when the repository lint runs, then a timeout above 60,000 ms fails unless an exact-test allowlist entry names its scenario, the real process or clock it needs, why a test starting none cannot prove that clause, and its finite maximum timeout. A value at or below that maximum passes only for that named test. Zero (unlimited) fails; an unresolved timeout expression fails with its location rather than silently escaping the limit. An absent override inherits the configured timeout; the existing 15,000 ms default passes. Configuration must not grant an unnamed test an over-limit timeout. A permitted exception is not permission to add retries or pad a wait.

Observer: planned lint fixture test `t3779a_timeout_boundary` runs the actual lint entry point on fixtures for the cases below. The fixtures use Vitest's numeric timeout argument, options-object `timeout`, imported `it`/`test` aliases, chained forms such as `test.each` and `test.skip`, local numeric constants/arithmetic and the inherited `testTimeout`. Each supported form must yield the same boundary result. The fixture test starts no browser, Daemon, PTY or vendor process.

| Input | Required lint exit |
| --- | --- |
| No override with the current default; explicit 60,000 ms | 0 |
| 60,001 ms without an entry | 1 |
| Exact exception within its declared finite maximum, with the required reason | 0 |
| Exception timeout on another test | 1 |
| Exception missing its process/clock reason | 1 |
| Timeout above the exception maximum | 1 |
| Zero (unlimited) timeout | 1 |
| Unresolved timeout expression | 1 |
| Inherited over-limit timeout on an unnamed test | 1 |

Policy: the implementation PR identifies the lint command that normal `pnpm lint` reaches and records one row per failing fixture with its input, diagnostic and exit code. No fixture may pass solely because its source was excluded from linting. Hooks, assertion polling and process-call deadlines are not per-test timeout exceptions; their existing bounds remain in force.

**T3779b prevent new appearance and copy assertions.** Given the web tests on the implementation's base and a proposed head, when the assertion lint runs, then it rejects each new assertion on computed style, measured position/size, or exact App-authored text. A baseline allowlist identifies each existing assertion by file, containing test and assertion identity, not a file-wide suppression, line number or count allowance. The head's entries must be a subset of the base's entries; deleted assertions lose their entries, and stale entries fail. Editing, moving or renaming an assertion cannot grant permission to add a different one. Baseline creation inventories the actual offenders once; subsequent cuts only remove entries (policy, checked by the independent review against the base and head).

Appearance assertions include `toHaveStyle`, values obtained from `getComputedStyle`, bounding rectangles, offset/client/scroll dimensions and equality/range assertions on their derived values, including values returned by browser evaluation. Exact-copy assertions compare App-authored labels, paragraphs, notifications or snapshots containing them to literal expected wording, through text matchers, DOM text reads or exact-text queries. A regex anchored to the complete copy is an exact-copy assertion too. Reads used only to set up an action are not assertions. Role/accessibility queries used to locate an action, nonempty accessible names, user-authored content round trips, call counts, RPC contracts and action/focus outcomes remain valid behavior observations. Such a query must not double as an assertion that App copy equals a literal. Appearance/capture observations remain the design critic's work; do not disable those observers to satisfy this lint (policy).

Observer: planned lint fixture test `t3779b_assertion_boundary` exercises the actual lint entry point, including TS/TSX and embedded browser expressions; Python browser assertions are included in the audit and may not become a way to move a forbidden assertion outside enforcement. The implementation must either lint a retained Python form or replace/remove its forbidden assertions before claiming acceptance.

| Input | Required lint exit |
| --- | --- |
| New computed-style assertion | 1 |
| New geometry assertion | 1 |
| New exact App-copy assertion | 1 |
| Forbidden assertion through a local alias | 1 |
| Forbidden assertion on a browser-evaluation result | 1 |
| Unchanged baseline assertion with its exact entry | 0 |
| Additional assertion in the same allowed file/test | 1 |
| Deleted assertion with a stale entry | 1 |
| Added entry after baseline creation | 1 |
| Broadened entry after baseline creation | 1 |
| Role query locating a click target, name-presence check, user-content round trip, call/contract assertion | 0 |

Policy: record each negative fixture's diagnostic and exit code separately. Test the lint's accept/reject behavior, not a copy of this specification or an inventory count. Before writing custom machinery, inspect the installed Oxlint plugin seam and Vitest timeout API, and evaluate maintained `eslint-plugin-testing-library` and Oxlint rules under AGENTS rule 9. Role-query rules alone do not establish the appearance/copy or shrinking-baseline boundary. The implementation's Reuse section states the selected capability and specific uncovered cases; this specification does not authorize a custom parser or a new dependency in advance.

**T3779c remove measured web test cost while preserving behavior.** Given the audit groups below, after both lints enforce T3779a and T3779b, when the web tests are cut or moved, then every removed original test has a row in its implementation PR body naming its scenario clause and the surviving test whose body still fails for that clause, or an explicit retirement of that scenario clause (policy). A rename, split, consolidation or move identifies its replacement in every affected original row. A fake that merely asserts its own implementation is no replacement. Apply AGENTS rule 10 to every edited test file, including additional cuts in that file.

| Audit group | Required disposition (policy) |
| --- | --- |
| Real-Daemon web tests: enumerate test consumers, including indirect fixture imports, from the measured base | Move to jsdom with a fake App/Daemon, or cut with the clause mapping above; retain exactly one real-Daemon web smoke, named with its behavior and justified real-process need. Helpers and metadata are not tests. |
| Chromium appearance tests: `header/u440_boxed_tabs.test.ts`, `app/u510_ink_feedback.test.ts`, `header/u2232_flat_tabs.test.ts`, `keys/u2230b_browser.test.ts`, `shelf/u371_reserved_modes.test.ts` | Remove appearance assertions/tests; retain independent action, focus and contract assertions cheaply. Explicitly replace any owning scenario's automated-looks observer with the design-critic observer rather than silently deleting acceptance. |
| Library re-proofs: `ui/u474_browser.test.ts`, `ui/u484_browser.test.ts`, `ui/u491_browser.test.ts`; drag stacks in `ui/u484_browser.test.ts`, `ui/u535_browser.test.ts`, `rail/u522_browser.test.ts`, `testing/u362_todo_drag.test.ts`, `todos/u155_reorder.test.tsx` | Keep one smoke per distinct library whose re-proofs are cut. Map each original to the named smoke and retain separate roundup behavior proof for unique actions, cancellation, calls and contracts. One smoke per file, widget or consumer is not one per library. Inspect current imports before identifying the library; historical filenames do not identify it. |
| Gutter: `terminal/u514_browser.test.ts` | Split setup/observations or reduce to the required then-clauses, preserving actual emulator-dependent behavior; do not delete its only observer or merely increase its timeout. |
| Copy strings: `u471_copy_preservation.test.tsx` in `bubbles/`, `header/`, `ink/`, `orders/`, `todos/`; `app/u472_copy_journey.test.ts` | Cut exact-copy proof. Preserve independent content preservation, recipient identity and delivery assertions in surviving behavior tests; retire only the copy-specific observer where needed. |
| Rendered/capture: `rail/u378_rendered.test.ts`, `keys/u2240_browser.test.ts`, `rail/u466_edges.test.ts`, `shelf/u460_rendered.test.ts`, `testing/u375_captures.test.ts`, `testing/u367_captures.test.ts`; control-name sweeps `ink/u501_browser.test.ts`, `header/u494_keyboard.test.ts` | Cut or move behavior to jsdom; design-critic observations own looks. Map redundant control-name checks to the assertions actually covered by `testing/y1_axe.test.tsx`, retaining any distinct behavioral assertion it does not prove. |
| Python/browser pairs: `todos/u3741`, `todos/u3760`, `todos/u3774`, `todos/u3776`, `settings/u3799` (each `_browser.test.py` plus `_rendered.test.ts`) | Cut or move behavior to jsdom, accounting for both the launcher and the Python assertions in each disposition. |

Paths in the table are relative to `apps/desktop/src`. They identify the fixed audit groups, not an instruction to delete whole files regardless of assertions. Each group's dispositions cover the whole group, in PRs bounded by one module directory; a directory PR may not silently leave part of its assigned class unaudited. Order directory work by measured cost after the lint baseline lands (policy).

Policy: preserve untouched the timing tests under `crates/terminal`, the failure tests `testing/u26_chromePage*.test.ts`, the real-Claude scheme test `terminal/x17_scheme.test.ts` and `crates/rup/tests/e2e/`. No change to those files, their helpers, acceptance, timeout allowances or execution selection may weaken those observers. The one real-Daemon smoke and one smoke per affected library have their existing scenario-prefixed test names recorded in the PR body; independent review runs them and the surviving tests for each retained clause. No new inventory-text test is required for T3779c.

## Measurement and regression policy

Before each cut, obtain a successful base CI run covering every affected original test, run `loop/web-durations.py` on its Vitest logs, and record the run URL, head SHA, executed files and elapsed seconds on the implementation Issue. Account separately for Python work included in a launcher's time, hooks, replacements and retries; count an executed test file once. A partial CI run or absent duration is missing evidence, never zero. Inventory the actual style/size/copy assertions and real-Daemon consumers with a reproducible command and source revision before creating the allowlists. The work order's “275 lines in 87 files” and “about 400 s” are audit claims to verify, not acceptance counts or measured savings (policy).

The committed `apps/desktop/src/testing/shardDurations.json` sums to 4,424 s and records 456 s for the gutter file at the specification base `a284e11af`; these are shard-planning values, not a fresh complete CI observation. `rg -l 'real_daemon|realDaemon|startDaemon' apps/desktop/src` finds 39 files there, including helpers, metadata and documentation; that count is not 39 executed tests. Reconcile the consumer inventory rather than cutting by a filename match (policy).

After each directory change, report the successful implementation-head CI run URL/SHA, affected original and replacement file seconds, and their total against the same base inventory. A removed test without replacement contributes zero only after its disposition is established; a merged/split observer maps back to every original and counts once in the total. Show which assertions, setup or waits were removed; no fixed reduction target, retry increase or product/performance regression is authorized. Missing baseline or head timing leaves implementation acceptance unmet. Progress and engineering questions belong on the work Issue, never in scenario Work tables (policy).

## Existing checks

1. `AGENTS.md`, Rules, rules 3, 9 and 10: bounded module PRs, reuse before machinery and surviving behavioral proof for every cut.
2. `apps/desktop/vite.config.ts`, default `test.testTimeout`: the inherited timeout is 15,000 ms; the new lint must reach overrides without raising this default.
3. `justfile`, `lint-web`, `lint-rust` and `test-web-since`: keep lint/type/compile rejection and affected behavior tests as merge evidence. This specification authorizes no frozen loop or workflow change.
4. `scenarios/ui-verify.md`, Y1 axe-core runs on the harness page: accessibility checks remain; do not assume a name-sweep's distinct action assertions are covered by axe.
5. `scenarios/terminal.md`, X17 a program's colour query is answered from the App's scheme: retain its real-Claude observation unchanged.
6. `scenarios/ui.md`, U26 concurrent cold Chromium readiness: retain failure detection, bounded replies and cleanup unchanged.
7. `scenarios/ui-terminal-turns.md`, U514 each command in a shell Terminal is a Turn the user selects from its gutter: preserve the real-emulator then-clauses when reducing the gutter test.

Policy: no product outcome, App/RPC contract, runtime performance budget or merge gate changes. Every Principle gate for a changed product path remains in force; this specification changes no such path. Its observers are lint rejection fixtures and independent review of retained behavioral assertions and CI measurements. Implementation scenario amendments may change the ordered test observers or explicitly retire redundant copy/looks proof; they may not retire required product behavior to fit a cut.

# Rust test timeout and fixture cost

Module: `.config/nextest.toml` and the Rust observers named below. Source: #3778. All acceptance in R3778 is policy for the dependent implementation and independent review; add no test that rereads this specification or counts test declarations.

**R3778 bound Rust test time without losing behavioral proof.** Given the inventory below, when the implementation reduces test cost, then all of the following hold (policy):

1. **Measure before cutting.** Before changing tests, run `cargo nextest run --profile default` on the implementation base and retain its slow-test list and per-test elapsed seconds. Record the SHA, command/filter, nextest version, OS, runner, concurrency, retries and failures. Separately time every test in `rup::yolo_modes`, `rup::u516_working_agent` and `rup::b55_new_session`, including tests absent from the slow list. Each is either cut with its specific unnecessary wait and surviving proof/retirement named, or kept with measured seconds, its scenario clause and why the real process/clock is necessary. Do not assume a fake-Claude wait: inspect the actual launch path. These binaries currently use real Claude against aimock, sometimes behind a launch gate. A missing or failed measurement is incomplete evidence, never zero seconds. The Issue's 2,632 s suite total, 66.6 s deliverables time and approximately 780 s fixture total are audit estimates to verify, not new measurements or product budgets.
2. **T1: terminate at 30 s.** The default nextest profile sets `slow-timeout = { period = "30s", terminate-after = 1, grace-period = "0s" }`; timeout is failure. Every CI/mac profile inherits that bound unless an exact package, binary and test allowlist entry gives a finite longer termination bound. Each exception names the owning scenario clause, the required real process or clock and measured duration explaining that bound; a whole-crate/binary or generic real-Claude exception is insufficient. No unlimited timeout or timeout-as-pass is allowed. Preserve `fail-fast = false`, the real-Claude concurrency cap and existing isolated performance observers. Keep `retries = 1` under the existing L122 policy and the timed observers' `retries = 0`; report first-attempt times and retries separately, so a retry cannot conceal a timeout or cost regression.
3. **Observe the timeout, not its text.** With the installed nextest version, run an isolated temporary probe outside the product suite using the effective configuration: a non-allowlisted test that remains alive beyond 30 s is terminated and nextest exits nonzero; a named exception remains alive beyond 30 s and finishes before its declared longer bound; the same exception exceeding that bound is terminated and fails. Record command, effective profile, elapsed time, result and exit code for each row. Run the non-allowlisted probe with each CI and Mac profile as well, selecting the temporary test explicitly so profile default filters cannot skip it; these runner-configuration probes need no native App or logged-in Claude. Do not add a permanent 30-second sleep test or change frozen loop machinery. A skipped or failed probe leaves implementation acceptance open.
4. **T4a: preserve each proof.** Every cut has a row in the implementation PR body naming the original test, its then-clause and the surviving test whose body still fails for that break, or the explicitly retired clause. Inspect assertions, not names. Renames, splits and merges map every original to its replacements. A scenario requiring an expensive seam is amended in the same implementation PR when that seam is replaced; retire an observer requirement explicitly, never required product behavior merely to delete its only test. Apply rule 10 to the whole of each edited test file. Keep tests for unrelated behaviors separate.
5. **T4b: one fixture build per binary.** Each `rup::a32_*` binary and `rup::a35` builds its expensive baseline fixture once per binary per run, shared or consolidated, while every retained original assertion still passes. Include `crates/agents/tests/scenarios/a35.rs` in the fixture audit without disturbing other tests in `agents::scenarios`. Record actual fixture-construction counts and before/after seconds for each affected binary under nextest, with a clause-to-observer mapping. Nextest runs each test in a separate process: a process-local singleton alone cannot meet this requirement. Shared immutable setup must leave each mutable case with isolated Project data, files and cleanup; serial order or leftover state cannot make an assertion pass. Consolidation must preserve rule 10's distinct behavioral proofs and T1's finite bound; do not hide repeated expensive setup in a renamed helper.
6. **T4c: one N7 launch-site proof.** Only `rupd::n7_data` retains the two launch-site observer families. Remove their copies from `rup::project_data`, `perf::n7`, `desktop::h18` (the `_h18` names) and `perf::bin/perf-keystroke` (the in-source tests). These are four duplicate locations across three other crates, not five crates. Before removing them, transfer any unique launch path or success/failure assertion to the canonical observers so both N7 then-clauses still cover every real launch family: absolute owned temporary data, seeded App data unchanged, confirmed exit before deletion on success and failure. Keep distinct N7 assertions that these two families do not duplicate. Any duplicate-name allowlist introduced by #3780 shrinks for the removed names; no new exception replaces them.

| Original observer/setup | Required disposition, in addition to the policies above |
| --- | --- |
| `rup::deliverables`, `dv2_publish_failures` | Cut with equivalent surviving DV2 boundary assertions, or replace/cheapen to under 5 s elapsed per test. Retain every DV2 refusal, exact-size/quota success boundary and absence of partial publication/eviction. |
| `rup::x14`, `x14_ten_busy_terminals_do_not_lag_rail_events` | Cut; keep `perf::flood`, `x14_flood_leaves_rail_events_unlagged_and_cleans_up`, proving flood isolation, ordered Rail markers and cleanup. |
| `rup::d2_agent_status`, `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` | Cut with mapped surviving H15 assertions, or observe the same hook-call success, ordering and final idle behavior without launching Claude. Explicitly replace the real-Claude retention requirement in the H15/real-Claude specifications when doing so. |
| `rup::a35`; `agents::scenarios`' a35 setup | Apply T4b; preserve A35 rewind/acknowledgement behavior. |
| `rup::yolo_modes` (A2693a/B2693b), `rup::u516_working_agent` | Measure and decide each test first under policy 1. U516 selection delivery is already retired; preserve any independent general Message proof before deleting its observer. B55's Clear-only assertions retire under A32 (#4542); independent YOLO authority assertions remain required. |

Policy: report equivalent before/after full-run evidence and the successful implementation head's `check` URL/SHA, per-test elapsed seconds and totals for retained and replacement observers, fixture construction counts, retries and timeout exceptions. Count each executed replacement once; a cut without replacement contributes zero. Separate local and CI observations, OSes and first attempts/retries; include setup cost so sharing or renaming cannot hide it. Missing evidence leaves acceptance incomplete. No fixed speedup, product behavior change, raised performance budget, new dependency, or workflow/loop change is authorized. Progress and engineering questions stay on the work Issues.

Checks (existing acceptance on `origin/main`; all remain in force):

1. `AGENTS.md`, Rules, rule 10: a test detects its scenario break without a redundant or needlessly expensive proof.
2. `.config/nextest.toml`, `profile.default`, its timed-test overrides and `test-groups.real-claude`: retain complete failure reporting, retry policy, timed-test isolation and bounded real-Claude concurrency.
3. `scenarios/workstream-rewind.md`, A35: retain rewind outcomes when their fixtures change.
4. `scenarios/deliverables.md`, DV2: retain publication refusal, exact limits, atomicity and revision identity.
5. `crates/perf/tests/flood.rs`, `x14_flood_leaves_rail_events_unlagged_and_cleans_up`: preserve the surviving real flood proof.
6. `scenarios/test-project-data.md`, N7; `crates/rupd/tests/n7_data.rs`, `n7_launch_sites_use_owned_data` and `n7_launch_sites_clean_on_success_and_failure`: retain owned data and exit-before-cleanup across all launch families.
7. `scenarios/agents.md`, A2693a; `scenarios/messages.md`, B2693b and B55; `scenarios/ui-terminal-turns.md`, U516: preserve the required continuation, authority and fresh-input outcomes, honoring U516's existing retirement.
8. `scenarios/control.md`, H15; `scenarios/test-real-claude.md`, E10 and the H15 retention row: this owner-ordered implementation may replace H15's expensive observer requirement as specified above, with equivalent surviving behavioral assertions explicitly mapped.

Reuse: use cargo-nextest's existing [slow-test termination](https://nexte.st/docs/features/slow-tests/) and [process-per-test model](https://nexte.st/docs/design/why-process-per-test/). No new timer, runner or fixture library is specified. Research installed/platform facilities under rule 9 before implementing shared setup.

## WAL-preserving publication I/O

Module: the existing Project publication/storage owner in `crates/rupd`; source: #3961, implementation: #3942. R3778a–R3778e below are policy for implementation and independent review. They preserve R3778, DV1–DV4 and R3696c; this specification delivers no production repair or five-second acceptance.

**R3778a retain simultaneous snapshots and commits.** Given `crates/rup/tests/pad_sources.rs::dv2_source_incarnation_survives_edits_home_and_restart` (planned rename retaining the snapshot observer), when its read transaction pins the original Pad, then public `pad.write`, append and move commit before that transaction ends, its second read still returns the original Pad, and restart returns the new contents, Revision and Home (existing observer, removing only its retired transfer operation/assertion). Keep Project SQLite in WAL mode, the existing synchronization settings, read isolation, lock timeouts, retry profiles and owner-read lease bounds. No observer cut or early snapshot release is permitted (policy).

[SQLite isolation](https://sqlite.org/isolation.html) explains that DELETE, PERSIST and TRUNCATE all use rollback locking: a writer needs readers to leave before it updates the database and commits. EXTRA strengthens synchronization, not concurrency. Thus no global rollback mode can implement this sequence. [WAL mechanics](https://sqlite.org/wal.html), sections 2.1–2.3, describe independent reader end marks and later backfill into the main database. Changing checkpoint timing can defer or batch that backfill, but cannot remove the eventual second write of retained BLOB pages. Disabling checkpoints indefinitely is not a repair: it grows the log and shifts cost into shutdown/reopen. ATTACH is not an atomic two-database escape: WAL transactions are atomic per database, not across the attached set (same documentation).

Actual-production evidence on #3942, base `26b54614499f4baf8362eeaceaa7ad65d691f013`, uses 32 real public-RPC publications of 32 MiB each. WAL accepted transactions wrote 2,170,810,368 bytes, retained 1,109,230,152 bytes, and spent 10.340679 s in commit/checkpoint. A larger checkpoint interval still wrote 2,155,147,264 bytes; its traced wall time is not comparable with untraced observations. The earlier PERSIST strategy is excluded by the snapshot observer, independently of its smaller write count. These are observations, not new product budgets (policy).

**R3778b select durable files with WAL references, subject to ownership authorization.** New local publication payloads use one immutable file per publication id in Project data, outside the disposable `deliverables/` materialization cache. SQLite remains the sole authority for Project/maker/Home/target identity, replay, access, removal and quota. Keep capture, size validation, source identity and hash checks at the existing `Daemon::deliverable_call` seam. Do not deduplicate equal payloads, compress, fabricate quota rows, add a database or change RPC/contracts (policy).

This changes the physical payload representation and DV2's current instruction to store bytes with the record in one SQLite transaction. It exceeds #3942's journal-configuration ownership. **Before production implementation, the user or the ownership authority named in #3961 must explicitly authorize** the file/reference representation, the allowed files below and an amendment of that physical-storage sentence in `scenarios/deliverables.md`, preserving its atomic visibility and durability outcomes. A Builder cannot infer that authorization from this specification's merge, a prototype, or an implementation review. Record the authorization permalink on the implementation Issue; without it only investigation/specification may proceed. The authorization prerequisite #3964 is a native blocker of #3942, alongside #3961, until that decision and its specification amendment merge. No product question is introduced (policy).

The authorized implementation remains inside this file set (policy):

| File | Responsibility/callers |
| --- | --- |
| `crates/rupd/src/deliverables.rs` | `Publications::open`, `Daemon::deliverable_call`, `bounded`, `resolve`, `invalidate_revoked`; publish/read/remove/replay/quota and private file handling, including its existing metadata-only test. No separate public storage interface. |
| `crates/rupd/src/storage.rs` and one new SQL migration under `crates/rupd/migrations/project/` | Add the reference metadata and constraints through the existing migration sequence; extend existing schema/fresh-image tests. Do not rebuild the payload table or rewrite old payloads. |
| `crates/rupd/build.rs` | Only if the additive migration needs an adjustment to the existing fresh-image generator; no new image facility, repaging or runtime VACUUM. |
| `crates/rup/tests/deliverables.rs` | Preserve all behavioral assertions; adapt direct physical BLOB allocation/corruption/deletion probes to the selected retained location and add the missing crash/recovery cases. Apply rule 10 to this file and name every cut's surviving proof. The 32-publication observer's sequence, payloads and limits remain unchanged. |
| `scenarios/deliverables.md`, `scenarios/test-cost.md`, `docs/adr/0004-sqlite-wal-and-md-pads.md` | Record authorized physical representation and its observers; no identity, durability, quota, atomicity or concurrency weakening. |

Audit, but do not reconfigure, callers in `crates/rupd/src/{open,event_log,reaction}.rs`, `crates/agents/src/rail.rs` and `rail/owner_reads.rs`, `crates/pads/src/store.rs`, `crates/todos/src/store.rs`, `crates/messages/src/{store,digest}.rs`, `crates/checkpoints/src/lib.rs` and `crates/provenance/src/lib.rs`. `storage::open` still migrates before `Publications::open`; all stores share `project.db`. The Event log's WAL/NORMAL policy remains unchanged, and publication commits retain FULL or stronger synchronization. Standalone stores retain WAL and their existing leases. No new connection owner, timer, queue, dependency or frozen loop change is authorized. A necessary file outside this set needs separate ownership authorization, never a silent expansion (policy).

Installed capabilities checked first: bundled `rusqlite` 0.40.2 transactions/pragmas, SQLite WAL and ATTACH, existing `cap-std` 4 source-path confinement, `rustix` 1 filesystem calls and Rust file synchronization. Native SQLite journaling cannot eliminate both payload copies while preserving the pinned reader. The selected design reuses installed directory/file facilities; it requires coordination between a durable file and the existing transaction, not another store's transaction protocol. Before implementing any new machinery, perform rule 9's two-library audit and document specific uncovered capabilities and current maintenance evidence; this specification approves no custom persistence helper or new library in advance (policy).

Selection evidence on specification base `983eb53c1704f845465dda22f234bce24a8761e9`: Linux x86_64 / EPYC 7763, four vCPUs, dev profile with the existing optimized SHA-256/SQLite packages. A temporary patch of the actual production `Daemon::deliverable_call` replaced only payload placement/quota/resolve for the probe, retaining WAL and the real capture/hash/identity path. An isolated baseline then candidate each accepted 32 actual 32 MiB public-RPC publications, refused stale/oversize/quota excess, compared the exact public listing and reopened/resolved/hashed every payload. All are first attempts; no retries (policy: these observations justify the design, not implementation acceptance).

| Isolated observation | WAL/BLOB baseline | WAL/file prototype |
| --- | ---: | ---: |
| Accepted transactions, seconds | 5.061913 | 2.369052 |
| Capture / hash within those transactions, seconds | 0.621244 / 0.679760 | 0.646080 / 0.679220 |
| BLOB insert or file write/sync/link / metadata commit, seconds | 1.409603 / 2.258951 | 0.934062 / 0.012696 |
| Daemon `/proc/<pid>/io` transaction write bytes | 2,187,530,240 | 1,075,228,672 |
| Transaction `syscw` (includes RPC/log writes) | 394,695 | 1,006 |
| Physical data bytes before shutdown | 1,109,336,648 | 1,076,351,232 |
| Physical data bytes after shutdown | 1,075,429,376 | 1,074,864,128 |
| Fresh startup / source-refusal setup, seconds | 0.018279 / 0.054745 | 0.019917 / 0.055362 |
| Final refusal/list / shutdown, seconds | 0.034555 / 0.010304 | 0.035701 / 0.007480 |
| Reopen and all-payload verification / second shutdown, seconds | 2.642966 / 0.004644 | 2.648077 / 0.003259 |
| Cleanup / complete elapsed, seconds | 0.167921 / 7.995594 | 0.101247 / 5.240702 |

Both retain exactly 1,073,741,824 logical payload bytes. The prototype writes/syncs each real payload and syncs its final directory before the WAL commit; it uses an empty legacy-table marker and committed record lengths for quota only as temporary instrumentation, not the selected production schema. It omits migration, orphan/removal recovery and power-loss injection, so none is claimed proved. No prototype code is retained. The unchanged Pad snapshot test passes against this temporary Daemon (0.116 s, nextest default 0.9.149, first attempt). Initial exploratory observations and these isolated repetitions are separate in the raw evidence on #3961; the candidate's initial observation overlapped test compilation and is not a timing comparison. The prototype is not an implementation head and has no successful implementation-head CI URL. R3778c–R3778e still require the full authorized implementation, ten-pair distributions and CI (policy).

**R3778c publish and recover without partial visibility.** The implementation follows this ordering (policy; new implementation tests named below cross the real Daemon/public publication seam):

```text
BEGIN IMMEDIATE; validate identity/replay/authority/capture/hash/size/quota
recover the preceding pending file, if any, before allocating another
write a private staging file; sync its contents and metadata
link it under the never-reused publication id; sync the containing directory
commit the record and reference/length together in project.db with WAL/FULL
remove the staging link; sync its directory; acknowledge
```

Create authoritative directories with private permissions and synchronize their parent before they can be referenced. Use directory handles and no-follow/create-new operations; client paths never select the authoritative filename. Keep at most one pending publication file per Project under the existing publication serialization. A staging link identifying the publication remains until metadata commit, so restart can distinguish an uncommitted orphan from a committed file without reading payloads or scanning the retained collection. Recover it under that same serialization before another allocation; failed recovery refuses further allocation with its cause rather than accumulating uncharged files. A directory sync that fails prevents acknowledgement. On platforms requiring a stronger file flush for power-loss durability, use it; demonstrate the ordering and effective publication connection settings rather than assuming SIGKILL proves power-loss safety (policy).

| Cut/result | Required implementation observer (new unless identified as existing) |
| --- | --- |
| Write, file sync, link or directory sync fails before metadata commit | `r3778c_file_failure_has_no_publication`: list unchanged, exact quota unchanged, existing publications resolve; retry recovers pending storage before another allocation. Inject each operation separately. |
| Crash before file sync, after file sync, after directory sync, or immediately before SQLite commit | `r3778c_pending_file_recovery`: reopen has no partial record; recovery reclaims unreferenced storage, then the same key can publish once. Count all retained and pending bytes. |
| Crash after SQLite commit, before staging cleanup or before reply | Extend existing `dv2_publish_replay`: reopen resolves the exact length/hash, equal replay returns one id/one retained allocation, conflicting replay refuses. Exercise both additional file cuts as well as the original pre/post-commit cuts. |
| Missing or corrupt committed file | Extend existing `dv3_no_substitution`: missing revision or integrity failure, never source/current bytes; get/list retain the record after restart. No fallback to a legacy BLOB once a file reference was selected. |
| Power loss after acknowledged metadata commit | `r3778c_durable_reference_order`: fault-inject the actual persistence seam and assert file flush, directory flush and WAL commit ordering, including first-directory creation; retain the installed SQLite durability guarantee and report filesystem/platform assumptions. SIGKILL observations above are separate. |
| User removal/revocation | Existing `dv4_removal_replay`, `dv4_cached_access`, `dv3_revoked_access`, `dv3_file_recreation_revokes_identity`: access is checked before file reads/materialization, invalidation remains effective, removal cannot resurrect an id. Extend removal with `r3778c_removed_file_cleanup` for crash/unlink/sync failure and retry. |

Removal first invalidates materializations and commits a tombstone. Keep the payload reference and its quota charge until unlink and directory synchronization complete; then delete the allocation metadata. A failed or interrupted unlink leaves the tombstone unavailable and cleanup recoverable, never releases quota while retaining unbounded physical garbage. A successful remove releases its bytes/materializations; repeated cleanup is idempotent, and replay never republishes the removed identity. Cleanup selects only the requested or durably pending id, never another live publication. Recovery cannot delete a referenced live file. Metadata-only list/get reads neither authoritative files nor their directory (policy).

Migration is additive and preserves historical bytes in place: existing `deliverable_bytes` BLOBs remain readable and charged at their actual length until their publication is removed; new publications use a separate reference table containing id and bounded length. Database constraints prevent an id from occupying both representations. Resolve selects exactly one representation from metadata; corruption or absence is unavailable, not permission to try another. Sum both allocations in the same IMMEDIATE quota transaction, including tombstoned allocations pending cleanup. Empty and external publications retain their current semantics. No bulk conversion, background copier, startup payload scan, new scheduler or read-time rewrite is required. Historical BLOB reading is serialized-data compatibility behind the same public interface, not two caller contracts. A later conversion/removal of compatibility requires its own measured work order (policy).

`r3778c_legacy_and_file_reopen` (new implementation test) starts with a real pre-upgrade database and committed WAL, upgrades, publishes both Pad/file payloads, and verifies old/new exact bytes, identities, revisions, mixed quota equality/excess, removal and repeated reopen. Exercise an interrupted additive migration; SQLite recovery retains the old state or the complete new schema. Existing `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity` continues to compare fresh/migrated schemas and distinct Project identities. Do not rewrite migrations already applied or hand-edit the generated image (policy).

**R3778d keep every product proof.** The original product outcomes remain acceptance (policy):

| Outcome | Observer retained/extended by implementation |
| --- | --- |
| All 32 actual 32 MiB transactions, 1 GiB retained, exact file-size/quota equality, stale/oversize/excess refusals and intact listing | `crates/rup/tests/deliverables.rs::dv2_publish_failures`, unchanged sequence and real on-disk bytes; additionally enumerate/hash every retained payload after shutdown/reopen, counting equal contents separately. |
| Authenticated Project/maker identity, explicit-only publication, roots/traversal/symlink refusal, Pad incarnation and captured-file change | All existing DV1 tests and `dv2_changed_capture` in that file; unchanged `crates/rup/tests/pad_sources.rs`. |
| Retained original revisions after edits, maker/Worktree cleanup and restart; replay/conflict and pre/post-commit crashes | Existing `dv4_home_lifecycle`, `dv2_publish_replay` and their exact-byte assertions, plus R3778c's file cuts. |
| Revocation, corruption/missing revision, current external identity, user Home and removal | All existing DV3/DV4 observers in `deliverables.rs`, with physical corruption/allocation probes adapted, not removed. |
| Metadata-only proof | Existing `crates/rupd/src/deliverables.rs::tests::dv2_metadata_only`, extended to deny/count both legacy BLOB and file payload reads through list/get; keep its positive resolve control. |
| Public concurrency, owner reads, Event durability and standalone leases | Retained Pad snapshot observer; B32 snapshot/lease observers are retired by R5460; existing D10/D11 in `crates/rupd/src/event_log.rs`. Add `r3778d_publication_with_public_reads_and_writes` through public Daemon calls while an old snapshot is retained; compare exact old/new Pad facts, publication list/resolve, fresh owner facts and ordered durable Events across reopen. No ordinary-path busy refusal or longer bound. |

Run the entire retained DV1–DV4 suite, `pad_sources`, reached storage/image/migration/owner tests and both required lints. Report each first attempt and any configured retry separately. Existing rule 10 and scenario observers cannot be weakened to accommodate the repair. P6's Gate forbids losing the user's Home; P12's Gate forbids substituted revisions, lost publication identity or ineffective removal/revocation. The DV1–DV4 and Pad observers above answer those Gates (policy).

**R3778e measure the complete implementation.** Before changing production code, obtain baseline evidence; after the authorized implementation, obtain its successful `check` URL and full head SHA. On the same quiet Linux runner execute ten pairs in order `baseline₁, head₁, …, baseline₁₀, head₁₀`, each in fresh isolated Project/data directories with the same settings, executable build profile and 32 real 32 MiB sources/publications. Each observation includes fresh startup, setup/refusals, every accepted transaction, final refusal/list, shutdown/checkpoint, reopen, hash verification of all retained bytes, reopened shutdown and deletion. Also run ten alternating pairs on an existing mixed-format upgrade fixture; include additive migration and pending/tombstone recovery in phase accounting. No omitted setup, moved checkpoint, cache warmup or conversion cost counts as a saving (policy).

For each observation report OS/CPU/filesystem, baseline/head SHA, command/filter, runner, nextest version/profile, concurrency, effective journal/sync settings, first-attempt seconds, retries separately, per-phase and total seconds, per-publication seconds, accepted-transaction write bytes/calls and read bytes, and physical retained bytes before/after checkpoint/shutdown/reopen. Account for database/WAL/SHM, legacy BLOBs, authoritative files, staging links counted once by inode, materializations and source fixtures separately; report logical payload bytes as well. Include startup/image/file sizes, process RSS at readiness and settled idle, and user/system CPU. Report min/median/p95/max and every raw sample. Attribute capture, hash, file write/sync, directory publication/sync, metadata insert, commit/checkpoint, recovery and cleanup. Include writes deferred to shutdown/reopen; a smaller transaction-only number cannot prove elimination. A missing or failed observation is missing evidence, never zero (policy).

Preserve AGENTS rule 7's cold start <300 ms, keystroke-to-render p95 <16 ms and ten idle Agents <150 MB extra RSS, plus unchanged `crates/perf/budgets.json` and its 10% regression gate. Run reached performance observers, and explain/repair any >10% regression rather than increasing a budget. Existing native/macOS CI jobs supply their own observations; R3696c's separate required Mac remains owned by that scenario. This specification introduces no new Mac question (policy).

#3942 remains implementation work until these observers and implementation-head CI pass. #3904 remains open until its separate unchanged real DV2 observer is under five seconds and its implementation-head Linux CI acceptance holds; neither prototype time nor this specification closes it. #3872 and #3809 remeasure after the eventual complete repair. Native Issue dependencies, progress, authorization and raw run evidence belong on the work Issues, never a scenario Work table (policy).

Checks (existing on specification base `983eb53c1`; none is retired):

1. `scenarios/deliverables.md`, DV1–DV4 and Cost observer (TC1): identity, authority, exact limits, atomic publication and real retained payloads.
2. `crates/rup/tests/pad_sources.rs`, `dv2_source_incarnation_survives_edits_home_and_restart` (planned rename): the old snapshot survives all three public Pad mutations.
3. `crates/rup/tests/deliverables.rs`, `dv2_publish_failures`, `dv2_publish_replay`, `dv2_changed_capture`, `dv3_no_substitution` and `dv4_removal_replay`: actual quota transactions, crash/replay, capture, integrity and removal.
4. `crates/rupd/src/deliverables.rs`, `tests::dv2_metadata_only`: public metadata calls do not load BLOBs, with resolve as positive control.
5. `crates/rupd/src/storage.rs`, `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity`: fresh/migrated equivalence and distinct identities.
6. Retired by R5460: B32 fresh owner facts and bounded owner-read WAL leases; the Message-to-Terminal guard they supported was retired by B3563c. The other R3778d concurrency and durability observers remain required.
7. `crates/rupd/src/event_log.rs`, `d10_every_event_but_terminal_output_is_saved_and_numbered`, `d10_numbers_never_repeat_across_a_reopen`, `d11_an_after_older_than_the_window_names_the_oldest_kept`: Event durability and replay bounds.
8. `scenarios/perf-macos-write.md`, R3696c; `docs/perf.md`, What is enforced, and what is not; `AGENTS.md`, Rules, rule 7: unchanged runtime/performance acceptance.

## Mixed publication quota

Policy: use the real Daemon/public publication seam in `crates/rup/tests/deliverables.rs` and the historical BLOB fixture from `r3778c_legacy_and_file_reopen`. For R4160a and R4160b, Q is a small test-fixture quota applied by the real quota-enforcement path; charge actual retained bytes in both representations. The production Project quota remains 1,073,741,824 bytes and the per-publication limit remains 33,554,432 bytes. Do not fabricate allocation lengths or replace `dv2_publish_failures` with a lowered-quota fixture. This acceptance changes no storage representation, contract or product limit; R5457a and R5457b govern the cheaper fixture and its evidence.

**R4160a mixed allocations reach the quota exactly.** Given an upgraded Project retaining nonempty legacy BLOB publications and new file-backed publications, when a public publication brings their combined retained payload length to exactly Q, it succeeds; a subsequent one-byte publication refuses. The refusal leaves the exact public listing and charged total unchanged, and every accepted publication retains its recorded identity and exact bytes after restart (`r4160a_mixed_quota_boundary`, new real-Daemon test in `crates/rup/tests/deliverables.rs`).

**R4160b cleanup releases only the chosen allocation.** Given a mixed-format Project at exactly Q with at least two nonempty publications in each representation and unequal payload lengths for the chosen legacy and file-backed publications, run the following independently for each chosen representation. Remove one publication through `deliverable.remove` and complete cleanup; its allocation disappears and the combined charge becomes exactly Q minus that publication's payload length B. Every other publication remains listed with the same identity and exact resolvable bytes, including survivors in both representations. Repeating removal and reopening releases no additional bytes and does not restore the removed identity. Publishing B real replacement bytes under a fresh key succeeds, restoring exactly Q; a subsequent one-byte publication refuses without changing the listing or charge (`r4160b_cleanup_releases_only_chosen_bytes`, new real-Daemon test in `crates/rup/tests/deliverables.rs`, table over legacy BLOB and file-backed removal).

Policy: use existing fixture/publication facilities, and inspect actual BLOB lengths and file allocation lengths only as observations alongside public calls. Preserve existing assertions in `r3778c_legacy_and_file_reopen`, `r3778c_removed_file_cleanup` and `dv2_publish_failures`; apply AGENTS rule 10 to any edited test file and name the surviving proof for each cut. Injected cleanup failures remain covered by `r3778c_removed_file_cleanup`; this case exercises successful cleanup. P12's Gate asks whether cleanup loses or substitutes another publication or defeats explicit removal; R4160a and R4160b's public listing, exact-byte, identity and removal observations answer it.

Checks (on specification base `f1f59fb1d`; none retired):

1. `crates/rup/tests/deliverables.rs`, `r3778c_legacy_and_file_reopen`: historical BLOB upgrade and mixed-format identity/byte retention across repeated reopen.
2. `crates/rup/tests/deliverables.rs`, `dv2_publish_failures`: real 32 MiB and 1 GiB boundaries, refusal without eviction, and retained payload verification after reopen.
3. `crates/rup/tests/deliverables.rs`, `r3778c_removed_file_cleanup` and `dv4_removal_replay`: recoverable file cleanup, surviving publication bytes and removal replay refusal.
4. `scenarios/deliverables.md`, DV2 and DV4; `scenarios/test-cost.md`, R3778c: unchanged quota, mixed allocation charging and publication-specific cleanup contract.


# Retired Message receiver lookup

Source: #5460. Acceptance is policy, checked by grep, independent review and the implementation head's checks; add no test that rereads code or inventories tests.

**R5460 remove the unused Terminal-owner seam and preserve live behavior.** Given B32's retirement and B3563c's inbox-only Message delivery, when the unused receiver lookup is removed, then:

1. Policy: `git grep -n with_terminal_owner -- crates` has matches only for `terminal::Terminals::with_terminal_owner` and calls to that live Terminal API. There is no `Agents::with_terminal_owner`, `messages::TerminalOwners`, implementation, mock or obsolete benchmark reference to the retired method. Preserve the live Terminal API, its callers and its durable-owner tests; it is a different capability.
2. Policy: before deleting dependent machinery, grep its definitions and callers. Remove `agents::TerminalOwner`, `Rail::terminal_owner` in `crates/agents/src/rail/view.rs`, and machinery whose last caller disappears with them, including `OwnerReads` and its Rail field/module/initialization in `crates/agents/src/rail/owner_reads.rs` and `crates/agents/src/rail.rs`. Replace Messages' `Arc<dyn TerminalOwners>` dependency with its existing `rpc::Module` seam and update every constructor, caller and fake in the same PR. No new abstraction, RPC method or replacement owner query is required. Keep shared helpers and Terminal-owner machinery with other live callers. No dead-code allowance or feature flag may retain the retired seam.
3. Policy: cut the 18 `b32_*` tests and `r16_owner_read_recovers_after_row_conversion_error` in `crates/agents/src/rail_view/tests.rs`, plus helpers used only by them (including `owner_transition` in `crates/agents/src/store.rs`). These prove only the retired receiver lookup, not a remaining B32 obligation. Preserve the other tests in that file. In `crates/agents/tests/scenarios/steer.rs`, remove the retired owner-read assertions while preserving the live B37 assertions: a live-error Agent can receive a Steer and an exited Attempt refuses it. Apply AGENTS rule 10 throughout each edited test file, mapping every additional cut to its surviving proof or explicit retirement in the implementation PR.
4. Policy: remove the retired receiver lookup's entries from `GLOSSARY.md` and its definition in `scenarios/messages.md`, preserving the live Terminal owner terms. Retire only the B32 snapshot/lease retention requirement in R3778d above; its Pad snapshot, public publication/concurrency, Event durability and other acceptance remain required. Obsolete benchmark scripts or notes under `crates/agents/r16/` must not keep references that fail clause 1; retain unrelated evidence.
5. Policy: every surviving test that proves a live scenario passes. In particular preserve B3563c's zero Terminal writes, inbox identity, receipt/restart behavior and unavailable-inbox recovery; B37 live-error Steer and ended-Attempt refusal; and live Terminal ownership/reopen behavior. The implementation head passes `just check origin/main` (CI may supply this observer), plus the grep observations below. This specification alone demonstrates no implementation acceptance and never closes #5460.

Observer results (one row per failure; report the actual command exit and offending matches on the implementation Issue/PR):

| Observation | Pass | Failure |
| --- | --- | --- |
| `git grep -n with_terminal_owner -- crates` | Exit 0; every match resolves to the live `terminal::Terminals` API or its callers | Exit 1 (live API missing), exit >1 (grep failed), or exit 0 with any retired-seam match |
| `git grep -n -E 'TerminalOwners|OwnerReads|owner_reads' -- crates` | Exit 1, no matches | Exit 0 with remaining retired plumbing, or exit >1 |
| `git grep -n TerminalOwner -- crates/agents/src` | Only the live `terminal::TerminalOwner` alias/use in `owners.rs` | Any retired Agents receiver-facts type/reference, or grep error |
| `git grep -n terminal_owner -- crates/agents/src/rail/view.rs` | Exit 1, no matches | Exit 0 with the retired query, or exit >1 |
| `just check origin/main` on the implementation head | Exit 0 | Any nonzero exit; name each failed check/test |

Principles: P1 and P11's Gates ask whether a Message can write to live Terminal input; their observer remains B3563c's real-Daemon inbox/Terminal test. P4's Adapter boundary and P9's authorized prompt paths remain unchanged. Removing receiver lookup must introduce no alternate Terminal delivery path.

Checks (on main when specified):

1. `scenarios/messages.md`, B32 retired by #3563 and B3563c transport: inbox delivery replaces the unsent-input guard; B37 an error with a live Terminal still receives input remains live.
2. `crates/rupd/tests/b50_note_inbox.rs`, `b3563c_all_senders_use_the_inbox_while_terminal_input_is_unsent`, `b3563c_receipt_and_restart_preserve_each_message_once` and `b3563c_unavailable_inbox_keeps_pending_identity_and_reports_the_cause`: Message isolation, identity, receipt/restart and recovery observers.
3. `crates/agents/tests/scenarios/steer.rs`, `b37_live_error_refuses_concurrent_input` and `b37_live_error_owner_is_open_until_terminal_exit`: preserve live-error Steer behavior and exited-Attempt refusal through the remaining public behavior assertions.
4. `crates/terminal/src/remote.rs`, `Terminals::with_terminal_owner`; `crates/agents/src/owners.rs`, `Agents::save_owner` and `Agents::reattach_owners`: distinct capability retained.
5. `justfile`, `check`; `AGENTS.md`, Rules, rule 10: implementation checks and each removed test's proof/retirement mapping.
## Quota tests without GiB fixtures

Scope: R4160a/R4160b fixtures in `crates/rup/tests/deliverables.rs`, their existing test support, and the production quota seam needed to exercise the same enforcement with fewer bytes. Shared-failure repairs may reach the existing R3778c/NR3 test support when the evidence identifies it as the cause; preserve those scenarios and assertions. No loop machinery, product contract or storage-format change (policy).

**R5457a small fixtures preserve quota proofs.** Given R4160a and R4160b, when their fixtures use a smaller quota Q, then all their existing then-clauses still hold through the real Daemon/public publication calls: exact equality accepts, one byte beyond refuses without mutation, mixed BLOB/file charges equal actual retained lengths, identities and exact bytes survive restart, and each removal releases only its chosen allocation once before B replacement bytes restore Q. Observers remain `r4160a_mixed_quota_boundary` and `r4160b_cleanup_releases_only_chosen_bytes` in `crates/rup/tests/deliverables.rs`; the latter retains both removal representations, unequal chosen lengths and survivors in both formats.

Policy: the fixture quota applies only to the selected test Project, survives its test restarts and cannot alter another test Project or a production build's limit. Reuse existing test-support facilities; this specification approves no new public RPC or production configuration. Use real payload bytes and the production accounting/comparison/cleanup path, never mock quota results, padded metadata lengths or a separate test implementation. The unchanged `dv2_publish_failures` remains the observer of the real 32 MiB and 1 GiB product boundaries; add no test that only compares a copied quota constant.

**R5457b fast tests and an evidenced shared-failure repair.** Given the implementation head, when its required `check` Rust lanes run, then each R4160 observer passes in strictly less than 5 seconds on its first attempt. Policy observer: the implementation PR records that head SHA, successful run URL, lane and nextest duration for each observer; local timing or a specification-only check run does not satisfy this acceptance. Retries, longer timeouts, ignored tests and weaker assertions are forbidden.

Policy: before claiming the four-test failure cluster repaired, inspect failed runs from the work order's 24-hour window ending 2026-11-01 17:37 UTC. Record the run URLs/heads, full test names for the R4160a, R4160b, R3778c and NR3 failures, and the failure output or resource observations identifying their shared cause. The implementation PR names that cause, the change removing it and the evidence connecting them; simultaneous failure alone does not establish disk exhaustion. Its successful head's required Rust lanes must include passing observations of those identified tests, preserving their assertions. Missing cause evidence is incomplete acceptance; investigate on the Issue rather than weakening the requirement. Progress and engineering questions belong on the work Issue, never in scenario Work tables.

P12 Gate: can smaller fixtures hide lost/substituted publications or ineffective removal? Observer: R4160a/R4160b's unchanged exact-byte, identity, listing, restart and cleanup assertions, plus the unchanged production-boundary observer (policy).

Checks (on main at specification time; none retired):

1. `scenarios/test-cost.md`, R4160a and R4160b: mixed-format equality/excess and publication-specific cleanup outcomes.
2. `crates/rup/tests/deliverables.rs`, `r4160a_mixed_quota_boundary` and `r4160b_cleanup_releases_only_chosen_bytes`: existing real-Daemon boundary, restart and cleanup observers.
3. `crates/rup/tests/deliverables.rs`, `dv2_publish_failures`: production-size boundary acceptance and retained bytes after reopen.
4. `crates/rupd/src/deliverables.rs`, `bounded`: combined BLOB/file accounting and production limit enforcement.
5. `scenarios/test-cost.md`, R3778c, and `scenarios/named-reactions.md`, NR3: publication recovery and durable reaction acceptance remain required.
6. `AGENTS.md`, Rules, rule 10: quota tests exceeding five seconds have no process/clock exemption.
