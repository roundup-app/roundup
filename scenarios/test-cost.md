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
