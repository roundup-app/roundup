# Real Claude Code with a fake model

Policy: A32/U350 (#4542) retire Clear-only inventory entries and their process requirements; the mixed `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear` observer keeps launch/resume and retires only its Clear branch; all surviving behavior retains its original observer and cost boundary. T3779c moves `src/testing/u176_agent_names.test.tsx` to mounted-App jsdom observers; production sibling naming remains covered by `crates/agents/tests/scenarios/naming.rs::u176_agents_with_one_prompt_are_numbered_among_their_siblings`. Its real-Claude web observer is retired as a duplicate naming proof. Historical baseline counts precede those retirements.

Ownership: `crates/rup/tests/` (the five files below, shared helper, `e2e/fake_claude.py` and fixtures), `crates/rupd/tests/b21_stopped_door.rs`, the twenty listed web test files, `.config/nextest.toml`, `.github/workflows/check.yml` install/cache steps, `package.json` and `pnpm-lock.yaml`. No production behaviour change, contract change or spike files belongs to this work (policy). Land the shared helper and `crates/rup` first, then `crates/rupd`, then `apps/desktop`, one module directory per PR (policy). Progress, exceptions and engineering questions belong on the work Issue, never in a scenario Work table (policy).

## Library selection

Use [aimock](https://github.com/CopilotKit/aimock), whose [v1.45.1 release](https://github.com/CopilotKit/aimock/releases/tag/v1.45.1) was published 2026-10-12. Its [fixture documentation](https://aimock.copilotkit.dev/fixtures) and [strict-mode documentation](https://aimock.copilotkit.dev/docker/) cover Anthropic responses, request matching and unmatched-request failure. [wiremock](https://github.com/LukeMathWalker/wiremock-rs), maintained through [v0.6.5](https://github.com/LukeMathWalker/wiremock-rs/tree/v0.6.5) on 2025-08-24, supplies HTTP matching but would require custom Anthropic streaming response construction; choose aimock's existing protocol support (policy). No custom model server or spike implementation is copied (policy).

## Existing checks on main

1. Credential stripping: `crates/rup/tests/environment.rs`, `a30_an_api_key_in_the_daemons_environment_is_not_in_the_agents` and `a30_resume_and_start_door_remove_them_too`.
2. Daemon memory: `crates/rup/tests/e2e.rs`, `d4_ten_idle_agents_cost_the_daemon_less_than_150_mb` and `d8_ten_idle_agents_with_sampling_stay_under_the_budget`.
3. Launch configuration: `crates/agents/tests/launch.rs`, `a4_the_argv_runs_claude_with_a_per_agent_settings_file`.
4. Test value: `scenarios/loop-rules.md`, heading L119 (policy).

**E10 real Claude executes the selected behaviour tests.** Given the fixed inventory below, each Rust test and each web file's selected fake-driven behaviour tests run pinned Claude Code against `@copilotkit/aimock`, with one fixture file for each test's turns. The pre-retirement inventory counted 81 entries, including two memory exceptions and twenty web files; A32/U350 remove the Clear-only entries below. That baseline count is not a required retained test count (policy).
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


<details><summary><code>crates/rup/tests/a35.rs</code>: 8</summary>

- `a35_a_missing_saved_conversation_is_a_recording_failure`
- `a35_an_old_checkpoint_is_not_rewindable`
- `a35_marks_do_not_follow_a_replaced_directory_symlink`
- `a35_marks_keep_door_only_write_authorization`
- `a35_marks_survive_a_restart`
- `a35_the_original_conversation_is_untouched`
- `a35_write_records_a_mark_per_agent`

</details>

<details><summary><code>crates/rup/tests/d9.rs</code>: 2</summary>


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
- `h15_every_hook_call_of_a_ten_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle`
- `m9_a_door_asked_for_a_workstream_makes_one`

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
- `src/testing/u177_restarted_door.test.tsx`
- `src/testing/u178_workstream_todos.test.tsx`
- `src/testing/u187_thread_mode_real_daemon.test.tsx`
- `src/testing/u189_conversation_real_daemon.test.tsx`
- `src/testing/u192_card_real_daemon.test.tsx`
- `src/testing/u194_real_daemon.test.tsx`
- `src/testing/u195_real_daemon.test.tsx`
- `src/testing/u347_real_daemon.test.tsx`
- `src/testing/u354_real_daemon.test.tsx`
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
| `h15_every_hook_call_of_a_ten_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` | `rup::real_claude` | 32.5 |
| `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing` | `rup::real_claude` | 17.4 |
| `a2693a_real_claude_resumes_yolo_and_restarts_normal` | `rup::real_claude` | 15.9 |
| `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear` | `rup::real_claude` | 13.5 |
| `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp` | `rup::real_claude` | 12.8 |
| `e14_roundup_launches_and_resumes_real_claude` | `rup::real_claude` | 12.1 |
| `e12_a_complete_turn_has_only_loopback_traffic` | `rup::real_claude` | 11.9 |
| `b2693b_real_yolo_receiver_takes_a_note_without_approval` | `rup::real_claude` | 11.8 |
| `lc9_the_profile_holds_in_the_real_tui` | `rup::real_claude` | 11.2 |
| `m16_real_claude_runs_tests_with_bash_without_a_run` | `rup::real_claude` | 10.5 |
| `f3_a_door_starts_a_child_with_agent_spawn_and_the_child_is_the_doors_own` | `rup::real_claude` | 9.4 |
| `e12_model_routing_keeps_credentials_out_of_hooks_and_mcp` | `rup::real_claude` | 9.0 |
| `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count` | `rup::real_claude` | 8.8 |
| `e12_a_fresh_configuration_accepts_the_first_prompt` | `rup::real_claude` | 8.7 |
| `a2693a_real_claude_skips_only_yolo_tool_permissions` | `rup::real_claude` | 8.2 |
| `e6_a_late_shim_goes_missing_then_up` | `rup::real_claude` | 7.7 |
| `x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch` | `rup::real_claude` | 7.2 |
| `b37_real_claude_receives_a_note_after_a_scripted_server_error` | `rup::real_claude` | 6.7 |
| `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on` | `rup::real_claude` | 6.0 |

## E2962 retention boundaries

The following requirements narrow the existing named clauses for this inventory under E2962. Retained observers in `crates/rup/tests/` execute the named real boundary; each observes the stated outcome and catches a transport, process or elapsed-deadline failure a process-free test cannot observe. No new product outcome is added. Cut observers map to surviving assertions; LC9’s recurring observer is retired while its one-time measurement policy remains.

| Original test | Action | Observer / existing clause | Required boundary or surviving assertions |
|---|---|---|---|
| `h15_every_hook_call_of_a_ten_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` | Keep | `h15_every_hook_call_of_a_ten_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle`; H15 | real Claude executes 10 tools and 20 rup signal child processes; exit statuses, hook ordering and final live Agent Status catch dropped or blocked hook I/O. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing` | Keep | `e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing`; E6 | real Claude launches rup mcp and hooks; observe Pending→Up and absence of Missing throughout agents::CHANNEL_DEADLINE, catching startup/deadline races. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a2693a_real_claude_resumes_yolo_and_restarts_normal` | Keep | `a2693a_real_claude_resumes_yolo_and_restarts_normal`; A2693a | real Claude --resume and fresh normal Restart with saved transcript; request/session identity and actual permission mode must follow selected launch. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear` | Keep | `q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear`; Q11 | real Claude plugin load on initial launch and resume; inspect actual plugin/tool requests across both surviving launch paths. The Clear branch is retired by A32 (#4542). A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp` | Keep | `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp`; A26 / F3 | real Claude calls rup mcp agent_spawn twice; verify caller-derived parent in both MCP results and Rail plus live child hooks, including a forged parent. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e14_roundup_launches_and_resumes_real_claude` | Keep | `e14_roundup_launches_and_resumes_real_claude`; E14 | real Claude Agent/Door launch and --resume; model/effort and previous conversation in actual HTTP requests detect ignored or overridden argv. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e12_a_complete_turn_has_only_loopback_traffic` | Keep | `e12_a_complete_turn_has_only_loopback_traffic`; E12 | real Claude complete MCP turn inside an observed loopback-only network namespace; strace destinations detect vendor nonessential/external traffic. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b2693b_real_yolo_receiver_takes_a_note_without_approval` | Keep | `b2693b_real_yolo_receiver_takes_a_note_without_approval`; B2693b | real Claude resumes YOLO then restarts normal; inbox transcript acknowledgement, model request, Delivered count and no roundup permission record prove receiver-mode transport. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `lc9_the_profile_holds_in_the_real_tui` | Cut | `retired recurring LC9 observer`; LC9 | LC9 explicitly requests a one-time implementing-PR measurement and no ongoing budget test; retire its recurring tool/relative-size assertions. LC1–LC6 launch tests remain unchanged. |
| `m16_real_claude_runs_tests_with_bash_without_a_run` | Keep | `m16_real_claude_runs_tests_with_bash_without_a_run`; M16 | real Claude worker executes Bash tests after Door MCP spawn; actual test output without a Terminal run catches vendor tool restrictions. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `f3_a_door_starts_a_child_with_agent_spawn_and_the_child_is_the_doors_own` | Cut | `a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp`; F3 / A26 | The three-deep case already asserts Door/child ownership and live child hooks; add the forged parent and absent Worktree assertions. |
| `e12_model_routing_keeps_credentials_out_of_hooks_and_mcp` | Keep | `e12_model_routing_keeps_credentials_out_of_hooks_and_mcp`; E12 | real Claude consumes isolated routing/dummy credentials; wrappers inspect environments of actual hook/MCP children and aimock authenticates the model request. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count` | Keep | `e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count`; E6 | fail the real Claude-launched MCP subprocess while real SessionStart/Submit/Stop hooks succeed; Missing must remain independent of Agent Status. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e12_a_fresh_configuration_accepts_the_first_prompt` | Keep | `e12_a_fresh_configuration_accepts_the_first_prompt`; E12 | real interactive Claude TUI accepts bracketed-paste first input from a fresh isolated profile; seed-only assertions cannot catch new onboarding dialogs. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `a2693a_real_claude_skips_only_yolo_tool_permissions` | Keep | `a2693a_real_claude_skips_only_yolo_tool_permissions`; A2693a | real Claude tool permission machinery executes YOLO tools without PermissionRequest but retains other hooks; argv-only proof cannot detect vendor interpretation. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `e6_a_late_shim_goes_missing_then_up` | Keep | `e6_a_late_shim_goes_missing_then_up`; E6 | gate the real rup mcp subprocess across the Daemon channel deadline; observe Pending→Missing→Up after releasing the shim. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch` | Keep | `x17_real_claude_takes_the_apps_scheme_at_start_and_on_a_switch`; X17 | real Claude TUI OSC colour queries at start and live scheme switch; Terminal snapshots expose actual vendor palette response. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `b37_real_claude_receives_a_note_after_a_scripted_server_error` | Keep | `b37_real_claude_receives_a_note_after_a_scripted_server_error`; B37 | real Claude HTTP 500 produces StopFailure while its PTY stays live; next request in the same vendor session must carry the note. A process-free test cannot observe this vendor/process lifecycle boundary. |
| `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on` | Keep | `f3_a_door_spawns_into_a_worktree_when_the_setting_is_on`; F3 | real Claude MCP agent_spawn with Worktrees enabled; real git Worktree location and branch in the returned child verify provisioning through vendor transport. A process-free test cannot observe this vendor/process lifecycle boundary. |

**E5417 real-Claude waits hold on a busy runner.** Given a test started by `start_real` (`crates/rup/tests/e2e/daemon.rs`) on a runner as loaded as `check`'s `rust 5` shard, when it waits for an event from a real `claude` (its start, a Status change or its answer), then the wait is bounded by one named constant, `REAL_BOUND`, sized for a real `claude`'s start and answer and longer than the fake-`claude` `BOUND`, and no real-`claude` wait uses `BOUND` or a literal duration.
- `next` takes its bound from the Project: a Project from `start_real` waits `REAL_BOUND`, one from `start` keeps `BOUND` (`e5417_a_real_project_waits_the_real_bound_and_a_fake_one_the_short_bound`, process-free).
- The waits of `a2693a_real_claude_skips_only_yolo_tool_permissions` and `b37_real_claude_receives_a_note_after_a_scripted_server_error` run through that bound, including `b37`'s Rail-poll wait for the Door's idle edge (policy; proven by both tests passing in `check`).
- No retry, `#[ignore]`, skip or removed assertion is added, and both tests stay in `check` under their names (policy).
Observer: the two named tests pass in `check` on the implementing PR's head, and the process-free bound test above.
