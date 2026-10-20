# Cost of rupd tests

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
| `cleanup_completion::b6_resume_completion_waits_for_both_promotion_failure_cleanups` | `rupd::b6_prompt_identity` | 82.3 |
| `cleanup_completion::b6_ack_timeout_waits_for_rollback_cleanup_and_accounts_for_refusal` | `rupd::b6_prompt_identity` | 20.6 |
| `b21_start_releases_each_changed_child_under_b22s_caps` | `rupd::b21_stopped_door` | 16.9 |
| `b6_later_door_effects_cannot_overtake_a_released_resize` | `rupd::b6_prompt_identity` | 14.0 |
| `b21_a_reopened_door_waits_until_explicit_start` | `rupd::b21_stopped_door` | 11.5 |
| `b6_interrupt_completion_accounts_for_a_blocked_escape_before_takeover` | `rupd::b6_prompt_identity` | 11.1 |
| `b6_takeover_acquisition_waits_for_a_door_spawned_first_prompt` | `rupd::b6_prompt_identity` | 11.1 |
| `b6_an_order_completion_waits_for_its_steer_effect` | `rupd::b6_prompt_identity` | 10.8 |
| `b2704a_rename_updates_context_and_queues_one_note` | `rupd::b50_note_inbox` | 10.3 |
| `resources::tests::d8_a_disk_size_is_cached_for_30_s_and_the_walk_never_holds_the_call_past_1_s` | `rupd` | 10.2 |
| `b2704a_first_prompt_rename_notifies` | `rupd::b50_note_inbox` | 10.0 |
| `b6_wire_later_door_effects_wait_for_all_earlier_resizes` | `rupd::b6_prompt_identity` | 9.9 |
| `cleanup_completion::b6_unconfirmed_terminal_exit_preserves_the_resume_failure_and_blocks_a_blind_retry` | `rupd::b6_prompt_identity` | 9.7 |
| `b2704a_workstream_rename_notifies_its_door` | `rupd::b50_note_inbox` | 9.6 |
| `b21_a_failed_start_keeps_the_entries_waiting` | `rupd::b21_stopped_door` | 9.3 |
| `b21_a_stopped_door_waits_silently_and_gets_the_newest_entry_on_start` | `rupd::b21_stopped_door` | 9.3 |
| `b21_a_refusal_other_than_a_stopped_door_is_logged_and_retried` | `rupd::b21_stopped_door` | 9.2 |
| `x14_daemon_observer::x14_daemon_observer_capacity_matches_its_receiver` | `rupd::n7_data` | 9.1 |
| `b2704a_unchanged_names_produce_no_note_for_a_no_word_first_prompt` | `rupd::b50_note_inbox` | 8.8 |
| `b6_checked_effects_exclude_prompt_replacement_under_parallel_load` | `rupd::b6_prompt_identity` | 6.7 |
| `b6_wire_door_decision_calls_wait_for_all_earlier_resizes` | `rupd::b6_prompt_identity` | 5.8 |
| `b6_begin_racing_a_door_interrupt_waits_for_the_child_effect` | `rupd::b6_prompt_identity` | 5.7 |
| `b6_a_door_interrupt_waits_for_takeover_release` | `rupd::b6_prompt_identity` | 5.5 |
| `cleanup_completion::b6_cleanup_refusal_preserves_the_resume_failure_and_blocks_a_blind_retry` | `rupd::b6_prompt_identity` | 5.5 |

**T2964b measure the implementation head.** Given T2964a's dispositions and a green `check` on the implementation PR's head, when its CI test timings are read, then the PR reports that run URL and head, each surviving original test's elapsed time and their sum against the recorded 313 s baseline (policy). Include the timings and a separate sum for replacement tests so moving work to another name cannot hide its cost. A cut contributes zero; a split or merge maps its measured tests back to all affected original rows and counts each executed test once in the total. Use per-test elapsed times from that run, not job duration, local timings or the baseline substituted for missing data. Missing timing evidence leaves acceptance unmet. No workflow or loop change is required or authorized by this scenario (policy).

Checks (existing acceptance on main; all remain in force):

1. `AGENTS.md`, Rules, rule 10: a test must detect its scenario's break without duplicating a cheaper proof.
2. `scenarios/messages.md`, B6 Takeover and its amendments, B21 pushed on change, B22 caps, and B2704a: preserve action ordering, cleanup, stopped-Door delivery and rename-note behavior when changing their tests.
3. `scenarios/resources.md`, D8 the Daemon samples an Agent's Resource use when asked: preserve disk-cache and bounded-walk behavior.
4. `crates/rupd/tests/n7_data.rs`, `x14_daemon_observer::x14_daemon_observer_capacity_matches_its_receiver`: preserve actual receiver capacity, ordered delivery at capacity and lag at capacity plus one unless a named surviving test proves the same boundary.

Policy: this scope changes tests and the production seams needed to test the same behavior cheaply; it changes no product outcome, contract, performance budget or merge gate. Any scenario amendment must state the needed observer or an explicit retirement, never silently drop an existing behavioral requirement. Engineering progress and questions belong on #2964.
