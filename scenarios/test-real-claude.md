# Real Claude Code with a fake model

Ownership: `crates/rup/tests/` (the five files below, shared helper, `e2e/fake_claude.py` and fixtures), `crates/rupd/tests/b21_stopped_door.rs`, the twenty listed web test files, `.config/nextest.toml`, `.github/workflows/check.yml` install/cache steps, `package.json` and `pnpm-lock.yaml`. No production behaviour change, contract change or spike files belongs to this work (policy). Land the shared helper and `crates/rup` first, then `crates/rupd`, then `apps/desktop`, one module directory per PR (policy). Progress, exceptions and engineering questions belong on the work Issue, never in a scenario Work table (policy).

## Library selection

Use [aimock](https://github.com/CopilotKit/aimock), whose [v1.45.1 release](https://github.com/CopilotKit/aimock/releases/tag/v1.45.1) was published 2026-10-12. Its [fixture documentation](https://aimock.copilotkit.dev/fixtures) and [strict-mode documentation](https://aimock.copilotkit.dev/docker/) cover Anthropic responses, request matching and unmatched-request failure. [wiremock](https://github.com/LukeMathWalker/wiremock-rs), maintained through [v0.6.5](https://github.com/LukeMathWalker/wiremock-rs/tree/v0.6.5) on 2025-08-24, supplies HTTP matching but would require custom Anthropic streaming response construction; choose aimock's existing protocol support (policy). No custom model server or spike implementation is copied (policy).

## Existing checks on main

1. Credential stripping: `crates/rup/tests/environment.rs`, `a30_an_api_key_in_the_daemons_environment_is_not_in_the_agents` and `a30_resume_and_start_door_remove_them_too`.
2. Daemon memory: `crates/rup/tests/e2e.rs`, `d4_ten_idle_agents_cost_the_daemon_less_than_150_mb` and `d8_ten_idle_agents_with_sampling_stay_under_the_budget`.
3. Launch configuration: `crates/agents/tests/launch.rs`, `a4_the_argv_runs_claude_with_a_per_agent_settings_file`.
4. Test value: `scenarios/loop-rules.md`, heading L119 (policy).

**E10 real Claude executes the selected behaviour tests.** Given the fixed inventory below, each Rust test and each web file's selected fake-driven behaviour tests run pinned Claude Code against `@copilotkit/aimock`, with one fixture file for each test's turns. The inventory counts 81 entries, including two memory exceptions and twenty web files; it is not a claim that there are exactly 81 individual test functions (policy).
- Every retained behaviour test asserts its original scenario's outcome using real Claude, real hooks and the real MCP shim; the original named tests below remain the acceptance tests, with renamed tests mapped in the implementation PR (policy).
- Each cut test names the surviving test whose assertions prove its then-clause, or its retired scenario, under check 4; the implementation PR holds this mapping (policy).
- The two tests in check 2 remain on the stub and pass under their existing names. If aimock cannot pause between permission events for the two GATE-dependent tests, those tests alone may remain on the stub: the PR names both tests and the missing aimock capability with library evidence (policy). No other behaviour-test exemption is allowed (policy).
- The 22 HOLD_START cases retain their original assertions: a held launch does not start Claude before release, and release starts real Claude. The existing named cases using HOLD_START prove this; a wrapper may gate launch without scripting Claude's behaviour (policy).

**E11 the fixture and request log decide each turn.** Given a real-Claude test, aimock runs with `--strict`; its fixture matches each turn by the last user message or tool result, not only an internal turn counter. A matched MCP round trip appears in aimock's request log with the expected tool result (`e11_a_tool_result_matches_the_next_turn`). An intentionally unmatched request fails and is visible in that log (`e11_an_unmatched_request_fails`). Every retained E10 test checks aimock's own request log for its expected requests and zero unmatched requests; harness counters are not the proof (policy). Do not require StopFailure from print mode: where an original clause asserts that hook, use the TUI to observe it or apply E10's safe-cut policy (policy).

**E12 isolated configuration preserves credential stripping.** Given a fresh test-owned `CLAUDE_CONFIG_DIR`, its `settings.json` env routes `ANTHROPIC_BASE_URL` to that test's loopback aimock and supplies a dummy credential through `apiKeyHelper` or `ANTHROPIC_AUTH_TOKEN`. The real model request reaches aimock while the dummy credential reaches neither the MCP shim nor hooks (`e12_model_routing_keeps_credentials_out_of_hooks_and_mcp`). Both tests in check 1 still pass; roundup continues stripping inherited `ANTHROPIC_*` (regression).
- `permissions.defaultMode` is `default`; an unallowed tool reaches PermissionRequest and the hook's answer controls it (`e12_default_permissions_reach_the_permission_hook`).
- Disable nonessential traffic (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`), autoupdates and official marketplace auto-install. Deny and observe non-loopback egress: a complete test performs no connection past loopback and no paid model call (`e12_a_complete_turn_has_only_loopback_traffic`). Dependency installation is outside this runtime assertion (policy).
- Seed the test-owned `.claude.json`: `hasCompletedOnboarding: true`, `theme: "dark"`, `lastOnboardingVersion: "2.1.300"`, `customApiKeyResponses.approved: [<last 20 characters of dummy key>]` with `rejected: []`, `projects.<cwd>.hasTrustDialogAccepted: true`, `lastReleaseNotesSeen: "2.1.300"`, and `hasSeenAutoDefaultNudge`, `hasResetAutoModeOptInForDefaultOffer`, `hasSeenAutoModeEntryWarning` all `true`. Seed the canonical cwd alias too where the OS supplies one. A fresh interactive launch reaches prompt input without onboarding, trust, key-approval or auto-mode dialogs (`e12_a_fresh_configuration_accepts_the_first_prompt`). Never use a personal profile (policy).

**E13 the stub has no model behaviour script.** Given the remaining 140 fake-starting tests plus E10's permitted exceptions, the stub retains fault injection, launch holding and logging, but none of these fifteen behaviour settings: `ON_PROMPT`, `ON_PROMPT_ASK`, `PASTE_WHOLE`, `ORDER_PROMPTS`, `KINDS`, `EVENTS`, `PAYLOADS`, `PROMPT`, `TOOL`, `TOOLS`, `DOOR_TOOLS`, `AGENT_TOOLS`, `DOOR_ONCE`, `LOOP`, `MARKS` (policy). The retained stub tests pass under their existing names; safe cuts follow E10 (regression). A named GATE exception must not restore any of the fifteen removed settings (policy). The observer below exits 1 for no matches; exit 0 is a failure and any other exit is an observer error (policy).

| Observer | Failure | Exit |
| --- | --- | --- |
| `rg -n 'FAKE_CLAUDE_(ON_PROMPT\|KINDS\|EVENTS\|TOOLS\|DOOR_TOOLS\|AGENT_TOOLS\|LOOP\|MARKS)' crates apps` | Behaviour setting remains | 0 |
| Same command | Observer error | 2 |

**E14 pinned launch and bounded concurrency.** Given the installed test dependencies, Claude Code is pinned to 2.1.300 and aimock to 1.45.1 in the lockfile and CI caches both (policy). A launch check exercises roundup's actual Agent and Door argv, initial start and `--resume`, `--model` and `--effort`; aimock's request log verifies model and effort and that resumed turns include the earlier conversation (`e14_roundup_launches_and_resumes_real_claude`). Check 3 remains a regression, not a substitute for executing Claude.
- A nextest group in `.config/nextest.toml` caps concurrently running real-Claude Rust tests at four, and the web runner caps those files at four (`e14_real_claude_test_concurrency_is_at_most_four`, observer: overlapping test start/end timestamps during a full Rust and web run). This caps tests, not the number of children one test creates (policy).
- The final implementation PR reports before/after `check` lane elapsed times and peak runner memory, with baseline/head commits, runner type, cache state and commands, from equivalent full runs. Missing measurements are not a pass (policy). The expected cost is 0–1.3 minutes above a 5–5.8 minute baseline and approximately 7 GB peak; these are estimates, not new product budgets (policy). Check 2 remains the Daemon budget proof.

## Inventory for E10

<details><summary><code>crates/rup/tests/a32.rs</code>: 20</summary>

- `a32_a_bad_id_in_the_handoff_keeps_the_clear_pending`
- `a32_a_failed_restart_keeps_the_workstream`
- `a32_a_failed_stop_retries_without_double_archive`
- `a32_a_valid_clear_only_asks_the_door`
- `a32_an_empty_reason_changes_nothing`
- `a32_iteration_advances_once`
- `a32_kept_items_keep_their_ids_and_owners`
- `a32_message_list_spans_iterations`
- `a32_no_handoff_times_out_and_changes_nothing`
- `a32_no_slash_command_is_typed`
- `a32_only_the_door_may_hand_off`
- `a32_resume_is_held_until_session_start`
- `a32_subagents_stop_deepest_first_and_leave_the_rail`
- `a32_the_door_restarts_fresh_from_the_handoff`
- `a32_the_handoff_read_waits_for_a_delayed_prompt_write`
- `a32_the_workstream_and_its_terminals_survive`
- `a32_unkept_todos_and_pads_are_archived_not_lost`
- `a32_without_handoff_archives_everything`
- `a32_worktrees_and_branches_survive_even_dirty`
- `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear`

</details>

<details><summary><code>crates/rup/tests/a35.rs</code>: 8</summary>

- `a35_a_clear_makes_earlier_marks_unusable`
- `a35_a_missing_saved_conversation_is_a_recording_failure`
- `a35_an_old_checkpoint_is_not_rewindable`
- `a35_marks_do_not_follow_a_replaced_directory_symlink`
- `a35_marks_keep_door_only_write_authorization`
- `a35_marks_survive_a_restart`
- `a35_the_original_conversation_is_untouched`
- `a35_write_records_a_mark_per_agent`

</details>

<details><summary><code>crates/rup/tests/d9.rs</code>: 2</summary>

- `d9_clear_failure_is_evented_without_an_app_timeout`
- `d9_clear_with_a_sixty_second_handoff_keeps_the_connection_available`

</details>

<details><summary><code>crates/rup/tests/e2e.rs</code>: 24</summary>

- `a16_removing_an_agent_leaves_its_pads_and_todos_untouched`
- `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp`
- `a33_an_idle_agent_with_a_blocked_todo_reads_blocked`
- `a33_completing_the_blocker_reads_idle`
- `a33_deleting_the_todo_reads_idle`
- `b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp`
- `d2_status_follows_the_hooks_in_order`
- `d2_the_first_prompt_names_the_agent`
- `d3_provenance_names_the_agent_that_created_the_todo`
- `d3_the_todo_the_agent_created_is_listed`
- `d4_ten_idle_agents_cost_the_daemon_less_than_150_mb`
- `d8_ten_idle_agents_with_sampling_stay_under_the_budget`
- `e3_the_fake_claude_runs_both_session_start_commands_and_reads_the_context`
- `e6_a_late_shim_goes_missing_then_up`
- `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing`
- `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count`
- `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on`
- `f3_a_door_starts_a_child_with_agent_spawn_and_the_child_is_the_doors_own`
- `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle`
- `h21_a_message_delivered_after_the_decision_cleared_is_still_typed`
- `h21_observer_a_door_allows_its_childs_permission_request_and_the_touch_names_it`
- `h21_observer_the_childs_and_another_workstreams_agents_are_forbidden_and_the_user_wins`
- `m9_a_door_asked_for_a_workstream_makes_one`
- `t8_creator_survives_removing_the_agent_that_made_the_todo`

</details>

<details><summary><code>crates/rup/tests/o12.rs</code>: 1</summary>

- `o12_the_door_spawns_with_order_and_the_users_words`

</details>

<details><summary><code>crates/rupd/tests/b21_stopped_door.rs</code>: 6</summary>

- `b21_a_failed_start_keeps_the_entries_waiting`
- `b21_a_refusal_other_than_a_stopped_door_is_logged_and_retried`
- `b21_a_removed_door_gets_no_waiting_digest`
- `b21_a_reopened_door_waits_until_explicit_start`
- `b21_a_stopped_door_waits_silently_and_gets_the_newest_entry_on_start`
- `b21_start_releases_each_changed_child_under_b22s_caps`

</details>

<details><summary><code>apps/desktop (web test files)</code>: 20</summary>

- `src/testing/a33_blocked_real_daemon.test.tsx`
- `src/testing/u146_door_answers.test.tsx`
- `src/testing/u159_workstream_todos.test.tsx`
- `src/testing/u160_workstream_thread.test.tsx`
- `src/testing/u166_door_permission.test.tsx`
- `src/testing/u176_agent_names.test.tsx`
- `src/testing/u177_restarted_door.test.tsx`
- `src/testing/u178_workstream_todos.test.tsx`
- `src/testing/u187_thread_mode_real_daemon.test.tsx`
- `src/testing/u189_conversation_real_daemon.test.tsx`
- `src/testing/u192_card_real_daemon.test.tsx`
- `src/testing/u194_real_daemon.test.tsx`
- `src/testing/u195_real_daemon.test.tsx`
- `src/testing/u347_real_daemon.test.tsx`
- `src/testing/u351_kinds_real_daemon.test.tsx`
- `src/testing/u354_real_daemon.test.tsx`
- `src/testing/u356_blocked_real_daemon.test.tsx`
- `src/testing/u364_real_daemon.test.ts`
- `src/testing/u366_measure.test.ts`
- `src/testing/u463_real_daemon.test.ts`

</details>


**E2704b real Claude speaks its current Rail name.** Given a started Agent named `sad` in an isolated test Project, when asked `who are you`, its answer identifies itself as `sad` and contains no machine-id token. Rename it through `rail.rename` to `sad-2`, observe B2704a's acknowledged note, then ask again: the answer identifies itself as `sad-2`, not `sad` as its current name, and contains no machine-id token. Repeat for a Door and Scout. Observer: `e2704b_real_claude_answers_with_current_rail_name` in `crates/rup/tests`, using real Claude through roundup's hooks and MCP. A fake-Claude or model fixture reply scripted to say the expected name proves transport only and does not satisfy this observer (policy). Record commit, Claude version, Context, delivered note and answers on Issue #2704; use an authorized isolated real-model run, or the required logged-in Mac observation when unavailable. Existing credential stripping and personal-profile isolation remain policy. This scenario extends this file's test ownership for #2704 only; it does not expand E10's migration inventory (policy).
