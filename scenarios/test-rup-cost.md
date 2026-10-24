# Slow rup test audit

## Checks on main

1. Test value and cost: `scenarios/loop-rules.md`, heading L119; `AGENTS.md`, rule 10 (policy).
2. Repository validation: `scenarios/workspace.md`, heading W1; `justfile`, `check` recipe (policy).

**TC1 each listed test earns its cost.** Given the fixed inventory below, apply check 1 to every row. The implementation PR contains exactly one disposition row per original test, identifying its binary, action, reason and surviving or replacement test names (policy).

- **Cut:** remove a test whose break the compiler, type check or lint already rejects, whose assertion only repeats a value copied from its implementation, or whose break another test already catches. Name the rejecting check and break where applicable, and the surviving test whose assertions prove each retained then-clause, or explicitly retire that scenario clause. A test name alone is not proof (policy).
- **Make cheap:** when the same break can be caught without starting a process, browser, Daemon, PTY or `claude`, replace the expensive test with that test. Name the original scenario clause and replacement test; the replacement must fail when that behaviour breaks, rather than checking only a double. Existing cheaper proof permits a cut instead (policy).
- **Keep:** retain an expensive test only when its scenario explicitly names the real process or clock it needs and the behaviour that cannot be proved without it. Add that statement to its scenario if absent; mere use of a process or passage of time is not a reason. The PR row cites that scenario clause (policy).

Merged tests preserve a test whose assertions fail for each retained scenario clause; the disposition rows map every original test to the surviving test. Apply check 1 to the rest of each test file edited, including the required cut accounting. Product behaviour and unrelated tests remain outside this audit; no coverage target is introduced (policy).

**TC2 CI reports the group's measured cost.** Given the implementation PR's own completed `check` run on its reviewed head, report the run URL and head SHA and the measured seconds for each surviving test mapped from TC1's inventory, including cheap replacements. Sum the kept tests separately and compare that sum with the 341 s baseline from green `check` run 39378452452. Report the total including replacements too, so a rename or merge cannot hide cost. Count a surviving test shared by several rows once per binary/test identity. Removed tests contribute zero; missing, skipped or failed observations do not count as measured zero. These are summed test durations, not parallel lane elapsed time; no numerical speedup threshold is specified (policy).

Observer: independent review reads the disposition rows against the test bodies and scenario clauses, and reads the implementation head's `check` durations for TC2. Existing scenario-prefixed behaviour tests supply the regression proof; add no test that rereads this inventory or asserts the disposition table. Check 2 remains required. This specification PR delivers acceptance only; timing and dispositions belong to implementation (policy).

## Fixed inventory

Baseline: `rup` binaries on green `check` run 39378452452, 341 s together. The rounded per-test readings below identify the group; retain 341 s as the comparison baseline.

| test | binary | seconds |
|---|---|---|
| `dv2_publish_failures` | `rup::deliverables` | 46.7 |
| `n7_launch_sites_clean_on_success_and_failure` | `rup::project_data` | 30.3 |
| `m1_list_tools_send_null_params_to_the_daemon` | `rup::mcp` | 20.1 |
| `m3_a_call_the_daemon_never_answers_exits_1_saying_it_may_have_been_applied` | `rup::mcp` | 20.1 |
| `d9_clear_with_a_sixty_second_handoff_keeps_the_connection_available` | `rup::d9` | 18.6 |
| `x14_ten_busy_terminals_do_not_lag_rail_events` | `rup::x14` | 16.0 |
| `h14_ask_user_waits_past_the_call_bound_and_returns_the_answer_and_the_note` | `rup::mcp` | 11.1 |
| `o12_the_door_spawns_with_order_and_the_users_words` | `rup::o12` | 10.2 |
| `i7_a_daemon_that_never_answers_exits_1_in_ten_seconds` | `rup::cli` | 10.2 |
| `o4_agent_set_order_fills_its_own_id_and_retains_the_captured_order` | `rup::mcp` | 10.1 |
| `x11_agent_run_over_mcp_runs_under_the_caller` | `rup::mcp` | 10.1 |
| `m4_the_full_tools_list_carries_a_numeric_ttl_ms_and_cache_scope` | `rup::mcp` | 10.1 |
| `m4_the_empty_list_a_cursor_gets_carries_a_numeric_ttl_ms_and_cache_scope` | `rup::mcp` | 10.1 |
| `m3_a_daemon_that_never_answers_exits_nonzero_with_one_line_naming_the_socket` | `rup::mcp` | 10.0 |
| `d9_workstream_removal_keeps_finite_shutdown_waits_within_the_app_bound` | `rup::a34` | 8.2 |
| `d3_provenance_names_the_agent_that_created_the_todo` | `rup::e2e` | 7.9 |
| `e11_a_tool_result_matches_the_next_turn` | `rup::e2e` | 7.0 |
| `a33_deleting_the_todo_reads_idle` | `rup::e2e` | 6.8 |
| `a16_removing_an_agent_leaves_its_pads_and_todos_untouched` | `rup::e2e` | 6.8 |
| `t15_list_and_rail_do_not_load_history` | `rup::t15` | 6.7 |
| `a33_completing_the_blocker_reads_idle` | `rup::e2e` | 6.5 |
| `d9_clear_failure_is_evented_without_an_app_timeout` | `rup::d9` | 6.2 |
| `a33_an_idle_agent_with_a_blocked_todo_reads_blocked` | `rup::e2e` | 6.2 |
| `u468_a_door_direct_answer_still_resumes_a_native_question` | `rup::u468` | 5.7 |
| `u468_a_child_cannot_claim_user_to_answer_its_own_question` | `rup::u468` | 5.7 |
| `u468_replaced_question_cannot_take_a_late_native_answer` | `rup::u468` | 5.6 |
| `u468_a_child_question_is_answered_in_its_terminal` | `rup::u468` | 5.6 |
| `u468_consecutive_questions_keep_each_terminal_answer` | `rup::u468` | 5.5 |
| `u468_a_tool_subprocess_cannot_report_a_user_answer` | `rup::u468` | 5.5 |
| `u468_dismissing_the_native_form_refuses_without_an_answer` | `rup::u468` | 5.5 |
