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

Cost observer (TC1): `e11_a_tool_result_matches_the_next_turn` also asserts D3’s creator Provenance from the same real-Claude Todo creation. It needs the actual vendor MCP/tool-result round trip and strict aimock request match; a scripted vendor or a directly invoked Todo method cannot prove that the tool result reaches Claude’s next model request.

**E12 isolated configuration preserves credential stripping.** Given a fresh test-owned `CLAUDE_CONFIG_DIR`, its `settings.json` env routes `ANTHROPIC_BASE_URL` to that test's loopback aimock and supplies a dummy credential through `apiKeyHelper` or `ANTHROPIC_AUTH_TOKEN`. The real model request reaches aimock while the dummy credential reaches neither the MCP shim nor hooks (`e12_model_routing_keeps_credentials_out_of_hooks_and_mcp`). Both tests in check 1 still pass; roundup continues stripping inherited `ANTHROPIC_*` (regression).
- `permissions.defaultMode` is `default`; an unallowed tool raises `needs-you` through the PermissionRequest hook and stays so until the user allows it in the Terminal (`e12_default_permissions_raise_needs_you_until_allowed`).
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


**E2704b real Claude speaks its current Rail name.** Given a started Agent named `sad` in an isolated test Project, when asked `who are you`, its answer identifies itself as `sad` and contains no machine-id token. Rename it through `rail.rename` to `sad-2`, wait for B2704a's rename note in the Claude inbox to be acknowledged by its `msg_id` in the transcript (B50–B52), with no Terminal delivery, then ask again: the answer identifies itself as `sad-2`, not `sad` as its current name, and contains no machine-id token. Repeat for a Door and Scout. Observer: `e2704b_real_claude_answers_with_current_rail_name` in `crates/rup/tests`, using real Claude through roundup's hooks and MCP. A fake-Claude or model fixture reply scripted to say the expected name proves transport only and does not satisfy this observer (policy). Record commit, Claude version, Context, delivered note and answers on Issue #2704; use an authorized isolated real-model run, or the required logged-in Mac observation when unavailable. Existing credential stripping and personal-profile isolation remain policy. This scenario extends this file's test ownership for #2704 only; it does not expand E10's migration inventory (policy).


**E3206 the real-Claude tests live in concept files, each under 1000 lines.** Given `crates/rup/tests/real_claude.rs` at 5338 lines, when it is split, then:
- `wc -l` prints under 1000 for every resulting file, and `crates/rup/tests/real_claude.rs` no longer exists (policy).
- Every test keeps its name, its `#[ignore]` where it had one, and its assertions; a test moves and nothing else about it changes, so each commit is one followable move (policy).
- Every caller that names the old test target (`.config/nextest.toml` filters and `ci4` shards, the `justfile`, `package.json`, workflows, `scenarios/` citations) names the new targets in the same PR, so the same tests run in the same groups and shards (policy).
- The split lands as one PR or several, each leaving the tree green and citing `Refs #3206`; only the last cites `Closes #3206`.
Observer: `wc -l crates/rup/tests/*.rs` and `cargo nextest list -p rup` before and after list the same test names; `cargo nextest run -p rup` passes.

**E2962 slow real-Claude tests prove only what needs a real program.** Given the fixed 45-test inventory below, apply rule 10 to every entry. Scope: `crates/rup/tests/` and the existing scenario clauses those tests prove; no production behaviour, contract, dependency migration or loop machinery change (policy). This scenario supersedes E10's real-Claude requirement and its no-other-exemption clause for this inventory only; E11–E14 still govern tests that retain real Claude (policy).

- **Cut:** remove a test when its break is already rejected by the compiler, type check or lint, it asserts only a value copied from the implementation, or another test fails for the same break. For each removed then-clause, name the surviving test and its assertions, or explicitly retire that scenario clause. For a compiler/type/lint cut, also name the rejecting check and the break it rejects; copied-value assertions alone do not establish that a behaviour is covered (policy).
- **Make cheap:** when the same break can fail a test starting no process, browser, Daemon, PTY or Claude, replace the expensive test with that test. Preserve the scenario outcome and name its asserting test in the scenario and the implementation mapping. Calling a fixture that starts a program does not qualify as process-free (policy).
- **Keep:** retain an expensive test only when its scenario explicitly names the real program or elapsed-clock boundary required, the outcome observed through it, and the break a process-free test cannot catch. Add this need to the existing scenario if absent; merely saying “integration” or “real Claude” is insufficient. A real-clock need does not by itself justify launching Claude (policy).
- Every listed entry receives exactly one action in the implementation PR's 45-row table: original name, action, surviving/replacement test and scenario clause (or retirement), and the rejecting check or required real boundary as applicable. Renames and merged tests map back to every original entry. Merging tests is allowed only when each covered scenario still has a test whose assertions fail for its break; the same assertions hidden behind one successful path do not prove unexecuted cases. Apply rule 10 to all tests in any edited test file (policy).
- The implementation PR reports the sum of durations for the kept tests from its own successful head's `check` run, beside the 608 s baseline below. Include run URL, head SHA, each kept test's duration and the arithmetic; count a shared surviving test once, report removed tests as zero, and list replacement process-free durations separately. No kept tests means a kept sum of 0 s. Missing, skipped or unreported kept tests do not establish a sum; rerun/correct the observation rather than treating missing data as zero. A faster total obtained by dropping unretired behaviour is not acceptance. No extra timing test or workflow change is required (policy).

Observer: independent review of the mapping, scenario needs and assertion bodies, execution of the surviving/replacement tests, and the implementation head's `check` timing output (policy). This is test-retention policy, not a new product outcome or a coverage target; no self-referential test of this text is required (policy). Existing checks 1–4 above remain applicable. No P1–P13 product path changes; their Gates acquire no new path and their Observers are preserved (policy).

## E2962 fixed inventory

Baseline: `rup::real_claude` on successful [check run 39378452452](https://github.com/saadshahd/roundup/actions/runs/39378452452), commit `b9809141a98c881e41ce55726a8eb773442dfcc8`; reported group total 608 s (policy). Per-test times below are rounded; compare against the reported group total, not a sum presented as unrounded precision (policy).

| test | binary | seconds |
|---|---|---|
| `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` | `rup::real_claude` | 32.5 |
| `a32_a_failed_restart_keeps_the_workstream` | `rup::real_claude` | 27.7 |
| `a32_no_handoff_times_out_and_changes_nothing` | `rup::real_claude` | 23.4 |
| `a32_without_handoff_archives_everything` | `rup::real_claude` | 22.6 |
| `a32_a_failed_stop_retries_without_double_archive` | `rup::real_claude` | 20.6 |
| `a32_unkept_todos_and_pads_are_archived_not_lost` | `rup::real_claude` | 20.6 |
| `a32_the_workstream_and_its_terminals_survive` | `rup::real_claude` | 20.2 |
| `a32_subagents_stop_deepest_first_and_leave_the_rail` | `rup::real_claude` | 19.7 |
| `a32_the_door_restarts_fresh_from_the_handoff` | `rup::real_claude` | 19.1 |
| `a32_iteration_advances_once` | `rup::real_claude` | 19.0 |
| `a32_a_bad_id_in_the_handoff_keeps_the_clear_pending` | `rup::real_claude` | 18.6 |
| `a32_kept_items_keep_their_ids_and_owners` | `rup::real_claude` | 18.5 |
| `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing` | `rup::real_claude` | 17.4 |
| `a2693a_real_claude_resumes_yolo_and_restarts_normal` | `rup::real_claude` | 15.9 |
| `a32_no_slash_command_is_typed` | `rup::real_claude` | 15.3 |
| `a32_an_empty_reason_changes_nothing` | `rup::real_claude` | 14.4 |
| `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear` | `rup::real_claude` | 13.5 |
| `a32_a_valid_clear_only_asks_the_door` | `rup::real_claude` | 13.5 |
| `a32_worktrees_and_branches_survive_even_dirty` | `rup::real_claude` | 13.4 |
| `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp` | `rup::real_claude` | 12.8 |
| `e14_roundup_launches_and_resumes_real_claude` | `rup::real_claude` | 12.1 |
| `a32_resume_is_held_until_session_start` | `rup::real_claude` | 11.9 |
| `e12_a_complete_turn_has_only_loopback_traffic` | `rup::real_claude` | 11.9 |
| `b2693b_real_yolo_receiver_takes_a_note_without_approval` | `rup::real_claude` | 11.8 |
| `a32_message_list_spans_iterations` | `rup::real_claude` | 11.6 |
| `lc9_the_profile_holds_in_the_real_tui` | `rup::real_claude` | 11.2 |
| `m16_real_claude_runs_tests_with_bash_without_a_run` | `rup::real_claude` | 10.5 |
| `a32_only_the_door_may_hand_off` | `rup::real_claude` | 10.2 |
| `b55_a_restart_and_start_door_still_holds_no_word` | `rup::real_claude` | 9.5 |
| `f3_a_door_starts_a_child_with_agent_spawn_and_the_child_is_the_doors_own` | `rup::real_claude` | 9.4 |
| `e12_model_routing_keeps_credentials_out_of_hooks_and_mcp` | `rup::real_claude` | 9.0 |
| `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count` | `rup::real_claude` | 8.8 |
| `e12_a_fresh_configuration_accepts_the_first_prompt` | `rup::real_claude` | 8.7 |
| `a2693a_real_claude_skips_only_yolo_tool_permissions` | `rup::real_claude` | 8.2 |
| `e6_a_late_shim_goes_missing_then_up` | `rup::real_claude` | 7.7 |
| `b55_thirty_idle_edges_of_the_new_session_type_none_of_it` | `rup::real_claude` | 7.7 |
| `b55_the_next_session_holds_no_word_of_the_old_ask` | `rup::real_claude` | 7.2 |
| `x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch` | `rup::real_claude` | 7.2 |
| `b55_pending_held_and_waiting_messages_of_the_old_iteration_are_not_replayed` | `rup::real_claude` | 7.0 |
| `b55_the_word_appears_only_inside_the_handoff_when_the_summary_has_it` | `rup::real_claude` | 6.9 |
| `b37_real_claude_receives_a_note_after_a_scripted_server_error` | `rup::real_claude` | 6.7 |
| `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on` | `rup::real_claude` | 6.0 |

## E2962 retention boundaries

The following requirements narrow the existing named clauses for this inventory under E2962. Retained observers in `crates/rup/tests/` execute the named real boundary; each observes the stated outcome and catches a transport, process or elapsed-deadline failure a process-free test cannot observe. No new product outcome is added. Cut observers map to surviving assertions; LC9’s recurring observer is retired while its one-time measurement policy remains.

| Original test | Action | Observer / existing clause | Required boundary or surviving assertions |
|---|---|---|---|
| `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` | Keep | `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle`; H15 | real Claude executes 100 tools and 200 rup signal child processes; exit statuses, hook ordering and final live Agent Status catch dropped or blocked hook I/O. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_a_failed_restart_keeps_the_workstream` | Keep | `a32_a_failed_restart_keeps_the_workstream`; A32 Failure | gated real Claude replacement misses the rupd restart deadline; unchanged Iteration/stopped Door followed by a real start recovery. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_no_handoff_times_out_and_changes_nothing` | Cut | `a32_without_handoff_archives_everything`; A32 No handoff | Move unchanged Rail/Todo/Pad snapshots and stopped-Door refusal into the existing timeout-and-fallback case. |
| `a32_without_handoff_archives_everything` | Keep | `a32_without_handoff_archives_everything`; A32 No handoff | real rupd handoff deadline and actual Claude input followed by process replacement; observe NOT_ACKED before fallback, unchanged state on timeout and fallback archive of every item. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_a_failed_stop_retries_without_double_archive` | Keep | `a32_a_failed_stop_retries_without_double_archive`; A32 Failure / Then (2–3) | gated real Claude resume makes a child un-stoppable; observe partial deepest-first removal, retry, one archive and branch ordering in actual restarted input. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_unkept_todos_and_pads_are_archived_not_lost` | Keep | `a32_unkept_todos_and_pads_are_archived_not_lost`; A32 Then (1) | real rupd clear across Claude stop/restart; read durable archive text and deleted Pad source after process retirement. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_the_workstream_and_its_terminals_survive` | Keep | `a32_the_workstream_and_its_terminals_survive`; A32 Nothing else | real rupd/PTY Terminal alongside Claude processes; verify the existing Terminal remains running after Door replacement. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_subagents_stop_deepest_first_and_leave_the_rail` | Cut | `a32_a_failed_stop_retries_without_double_archive`; A32 Then (2–3), Failure | The failed-stop case already proves grandchild removal before child and final child removal; move the Handoff branch-order assertion there. |
| `a32_the_door_restarts_fresh_from_the_handoff` | Keep | `a32_the_door_restarts_fresh_from_the_handoff`; A32 Then (3–4) | real Claude invocation/session identity and model request after rupd restart; fresh argv and Handoff first input can diverge from stored configuration. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_iteration_advances_once` | Keep | `a32_iteration_advances_once`; A32 Then (4) | real SessionStart after Claude replacement; read Iteration before/after completion and during the next pending clear. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_a_bad_id_in_the_handoff_keeps_the_clear_pending` | Keep | `a32_a_bad_id_in_the_handoff_keeps_the_clear_pending`; A32 Handoff | real rupd pending clear with live Claude descendants; invalid keep ids must not trigger process retirement or consume the pending clear. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_kept_items_keep_their_ids_and_owners` | Keep | `a32_kept_items_keep_their_ids_and_owners`; A32 Then (1), Nothing else | real rupd clear across Claude stop/restart; kept Todo blockers and removed-child Pad ownership survive the lifecycle. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing` | Keep | `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing`; E6 | real Claude launches rup mcp and hooks; observe Pending→Up and absence of Missing throughout agents::CHANNEL_DEADLINE, catching startup/deadline races. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a2693a_real_claude_resumes_yolo_and_restarts_normal` | Keep | `a2693a_real_claude_resumes_yolo_and_restarts_normal`; A2693a | real Claude --resume and fresh normal Restart with saved transcript; request/session identity and actual permission mode must follow selected launch. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_no_slash_command_is_typed` | Keep | `a32_no_slash_command_is_typed`; A32 Then (4), P9 | real Claude parser and model journal across restart; a vendor slash command would execute without appearing as a normal user prompt. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_an_empty_reason_changes_nothing` | Keep | `a32_an_empty_reason_changes_nothing`; A32 Reason | real rupd with live Worktree-backed Claude descendants; rejects clear before any prompt or process/tree mutation. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear` | Keep | `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear`; Q11 | real Claude plugin load on initial launch, resume and clear; inspect actual plugin/tool requests across all three launch paths. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_a_valid_clear_only_asks_the_door` | Keep | `a32_a_valid_clear_only_asks_the_door`; A32 Ask | real Claude model request after rupd Steer; inspect actual prompt inventory and preserve live tree before Handoff. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_worktrees_and_branches_survive_even_dirty` | Keep | `a32_worktrees_and_branches_survive_even_dirty`; A32 Then (2), Nothing else | real git branches and dirty Worktree directories belonging to live descendants; clearing must stop processes without git cleanup. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp` | Keep | `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp`; A26 / F3 | real Claude calls rup mcp agent_spawn twice; verify caller-derived parent in both MCP results and Rail plus live child hooks, including a forged parent. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e14_roundup_launches_and_resumes_real_claude` | Keep | `e14_roundup_launches_and_resumes_real_claude`; E14 | real Claude Agent/Door launch and --resume; model/effort and previous conversation in actual HTTP requests detect ignored or overridden argv. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_resume_is_held_until_session_start` | Keep | `a32_resume_is_held_until_session_start`; A32 Failure / Then (4) | gated real Claude launch and real SessionStart; resume must stay pending while no hook can acknowledge it. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e12_a_complete_turn_has_only_loopback_traffic` | Keep | `e12_a_complete_turn_has_only_loopback_traffic`; E12 | real Claude complete MCP turn inside an observed loopback-only network namespace; strace destinations detect vendor nonessential/external traffic. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b2693b_real_yolo_receiver_takes_a_note_without_approval` | Keep | `b2693b_real_yolo_receiver_takes_a_note_without_approval`; B2693b | real Claude resumes YOLO then restarts normal; inbox transcript acknowledgement, model request, Delivered count and no roundup permission record prove receiver-mode transport. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_message_list_spans_iterations` | Keep | `a32_message_list_spans_iterations`; A32 Old Thread | real rupd and Claude replacement; prior and new Iteration Messages stay readable after the live restart. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `lc9_the_profile_holds_in_the_real_tui` | Cut | `retired recurring LC9 observer`; LC9 | LC9 explicitly requests a one-time implementing-PR measurement and no ongoing budget test; retire its recurring tool/relative-size assertions. LC1–LC6 launch tests remain unchanged. |
| `m16_real_claude_runs_tests_with_bash_without_a_run` | Keep | `m16_real_claude_runs_tests_with_bash_without_a_run`; M16 | real Claude worker executes Bash tests after Door MCP spawn; actual test output without a Terminal run catches vendor tool restrictions. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a32_only_the_door_may_hand_off` | Keep | `a32_only_the_door_may_hand_off`; A32 Handoff | real rupd connections identified as Door, child and user during a real Claude clear turn; refuses unauthorized handoff without completing it. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b55_a_restart_and_start_door_still_holds_no_word` | Keep | `b55_a_restart_and_start_door_still_holds_no_word`; B55 (b) | restart the real rupd after clear then start real Claude again; whole launch-file/model-input record must exclude old ask across persisted resume state. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `f3_a_door_starts_a_child_with_agent_spawn_and_the_child_is_the_doors_own` | Cut | `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp`; F3 / A26 | The three-deep case already asserts Door/child ownership and live child hooks; add the forged parent and absent Worktree assertions. |
| `e12_model_routing_keeps_credentials_out_of_hooks_and_mcp` | Keep | `e12_model_routing_keeps_credentials_out_of_hooks_and_mcp`; E12 | real Claude consumes isolated routing/dummy credentials; wrappers inspect environments of actual hook/MCP children and aimock authenticates the model request. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count` | Keep | `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count`; E6 | fail the real Claude-launched MCP subprocess while real SessionStart/Submit/Stop hooks succeed; Missing must remain independent of Agent Status. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e12_a_fresh_configuration_accepts_the_first_prompt` | Keep | `e12_a_fresh_configuration_accepts_the_first_prompt`; E12 | real interactive Claude TUI accepts bracketed-paste first input from a fresh isolated profile; seed-only assertions cannot catch new onboarding dialogs. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a2693a_real_claude_skips_only_yolo_tool_permissions` | Keep | `a2693a_real_claude_skips_only_yolo_tool_permissions`; A2693a | real Claude tool permission machinery executes YOLO tools without PermissionRequest but retains other hooks; argv-only proof cannot detect vendor interpretation. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e6_a_late_shim_goes_missing_then_up` | Keep | `e6_a_late_shim_goes_missing_then_up`; E6 | gate the real rup mcp subprocess across the Daemon channel deadline; observe Pending→Missing→Up after releasing the shim. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b55_thirty_idle_edges_of_the_new_session_type_none_of_it` | Keep | `b55_thirty_idle_edges_of_the_new_session_type_none_of_it`; B55 (a–b, d) | real Claude new session after clear then 30 idle signals; whole request/launch record proves fresh argv and no old-Iteration retyping, including delayed delivery. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b55_the_next_session_holds_no_word_of_the_old_ask` | Cut | `b55_thirty_idle_edges_of_the_new_session_type_none_of_it`; B55 (a–b, d) | The idle-edge case already checks the whole second-session input for the same word; assert fresh argv before its idle probes. |
| `x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch` | Keep | `x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch`; X17 | real Claude TUI OSC colour queries at start and live scheme switch; Terminal snapshots expose actual vendor palette response. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b55_pending_held_and_waiting_messages_of_the_old_iteration_are_not_replayed` | Keep | `b55_pending_held_and_waiting_messages_of_the_old_iteration_are_not_replayed`; B55 (d) | real Claude new session after clear with ask-first pending/held/waiting delivery; whole request/launch record must exclude queued old-Iteration text. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b55_the_word_appears_only_inside_the_handoff_when_the_summary_has_it` | Keep | `b55_the_word_appears_only_inside_the_handoff_when_the_summary_has_it`; B55 (c) | real Claude new-session request and launch files; remove only the Handoff substring and verify no other occurrence of the old ask. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b37_real_claude_receives_a_note_after_a_scripted_server_error` | Keep | `b37_real_claude_receives_a_note_after_a_scripted_server_error`; B37 | real Claude HTTP 500 produces StopFailure while its PTY stays live; next request in the same vendor session must carry the note. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on` | Keep | `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on`; F3 | real Claude MCP agent_spawn with Worktrees enabled; real git Worktree location and branch in the returned child verify provisioning through vendor transport. A process-free test cannot observe this vendor/process lifecycle boundary. |
