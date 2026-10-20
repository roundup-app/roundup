# Cheaper rewind and Door tests

Source: #2961. Scope: the fixed inventory below from `crates/rup/tests/a35.rs`, its existing helpers and any process-free replacements in the owning crates. Product behaviour and public contracts do not change (policy).

## Existing checks on main

1. Rewind selection and isolation: `crates/rup/tests/a35.rs`, `a35_rewind_selects_one_or_all_children` and `a35_unselected_children_keep_their_files_and_conversations`; acceptance in `scenarios/workstream-rewind.md`, heading A35.
2. Takeover enforcement: `crates/rup/tests/a35.rs`, `a35_a_taken_over_child_waits_without_any_effect` and `m16_door_calls_cannot_bypass_a_child_takeover`; acceptance in `scenarios/workstream-rewind.md`, heading A35, and `scenarios/door-terminal.md`, heading M16.
3. Restart and conversation isolation: `crates/rup/tests/a35.rs`, `a35_restart_accounts_for_a_held_rewind` and `a35_each_agent_resumes_a_copy_cut_at_its_mark`; acceptance in `scenarios/workstream-rewind.md`, heading A35.
4. Test cost and value: `AGENTS.md`, rule 10 (policy).

**A2961 each listed test earns its execution cost.** Given the 35-test inventory below, apply check 4 to every test. The implementation PR records one row per original name, its action, and the evidence specified here (policy):

- **Cut:** identify the compiler/type/lint rejection that catches the same break, the assertion that merely copies a production value, or the surviving named test and assertions that fail for that same break. If no behaviour remains required, name the retired scenario clause. Removing an observer does not retire its product behaviour; a retirement must be explicitly specified first (policy).
- **Make cheap:** name the replacement test and scenario clause it asserts. It starts no process, browser, Daemon, PTY or Claude, including through fixtures, helpers or setup. Exercise production logic rather than a test double's behaviour; its assertions must fail for the same break as the original. A process-free filesystem/database test is allowed. Move assertions to the existing owner rather than introducing a public contract solely for testing (policy).
- **Keep:** name in the test's product scenario the exact real process or clock required, the observable break it catches and why a process-free test cannot catch that break. A shared fixture's use of a process, or the existing blanket observer instruction, is not evidence of necessity. Apply cut and cheap conditions before keeping; merely adding a process requirement cannot justify a redundant test (policy).

For this inventory only, these cost conditions supersede blanket real-Daemon, MCP, vendor and git observer requirements in A35 (`scenarios/workstream-rewind.md`), M16 (`scenarios/door-terminal.md`) and A35's regression paragraph in `scenarios/checkpoint-store.md`. Their product outcomes remain required. Retained integration tests still use isolated test-owned configuration and existing public seams; this does not authorize paid model calls or personal profiles. Other tests' observers are unchanged (policy).

Every still-required then-clause touched by a cut, rewrite or merge has a named surviving test whose body asserts it and fails when it breaks. Existing combined tests may merge further only with that mapping for each clause; merging does not justify retaining redundant or process-dependent assertions that can be cheap. Preserve checks 1–3 and all other required A35/M16 outcomes, including refusal before effects, files and conversation isolation, durable outcomes, failure/retry, event ordering and Reach. No assertion of layout or exact app copy is added (policy).

**A2961b the implementation head reports its measured cost.** The implementation PR's own green `check` run supplies the duration of each retained process-dependent test from this inventory and their sum, compared with the recorded 779 s baseline. Link that run and head commit, name the timing source, and map renamed/merged tests back to original names. Count a merged test once; also list and total process-free replacements separately so moved runtime stays visible. A cut contributes zero; no retained tests gives a kept total of zero. Missing timing evidence is not a pass, and elapsed lane time is not summed test time. No fixed percentage reduction is required (policy).

Observer: independent review of the inventory mapping, surviving test bodies, related test results and the implementation head's `check` timing output. These are policy acceptance checks; add no test that rereads this specification or asserts the inventory count. This specification PR changes acceptance only and leaves #2961 open; implementation follows after it merges (policy).

## Fixed inventory

The baseline is `main`'s green `check` run 39378452452, 779 s in total as recorded in #2961; row durations are rounded seconds (policy).

| Original test (`rup::a35`) | Baseline seconds |
| --- | ---: |
| `m16_door_calls_cannot_bypass_a_child_takeover` | 85.7 |
| `m16_a_door_can_perform_each_user_action_on_a_child` | 30.6 |
| `a35_a_selected_later_child_cannot_orphan_an_unselected_descendant` | 29.5 |
| `a35_rewind_selects_one_or_all_children` | 26.7 |
| `a35_a_later_subagent_leaves_the_rail_and_keeps_its_worktree` | 26.3 |
| `a35_each_agent_resumes_a_copy_cut_at_its_mark` | 26.2 |
| `a35_restart_accounts_for_a_held_rewind` | 25.8 |
| `a35_a_selected_rewind_keeps_other_child_marks` | 24.8 |
| `a35_a_failed_restart_leaves_the_others_rewound_and_retries` | 24.6 |
| `a35_messages_todos_pads_and_checkpoints_stay` | 24.5 |
| `a35_a_taken_over_child_waits_without_any_effect` | 24.3 |
| `a35_no_slash_command_is_typed` | 24.0 |
| `a35_rewound_is_emitted_once_after_the_last_session_start` | 22.8 |
| `a35_a_clear_makes_earlier_marks_unusable` | 21.8 |
| `a35_all_children_rewind_waits_only_for_taken_over_children` | 21.5 |
| `a35_a_door_cannot_override_takeover` | 21.2 |
| `a35_release_revalidates_the_checkpoint_and_runs_at_most_once` | 19.4 |
| `a35_keep_changes_no_file` | 19.4 |
| `a35_only_a_door_is_offered_and_can_call_rewind` | 19.3 |
| `a35_the_door_is_told_what_was_rewound` | 18.9 |
| `a35_one_rewind_at_a_time` | 18.9 |
| `m16_door_actions_keep_reach_restrictions` | 18.3 |
| `a35_unselected_children_keep_their_files_and_conversations` | 17.4 |
| `a35_marks_do_not_follow_a_replaced_directory_symlink` | 17.3 |
| `a35_plan_lists_each_agent_and_changes_nothing` | 17.2 |
| `a35_marks_survive_a_restart` | 17.2 |
| `a35_restore_returns_each_worktree_to_its_snapshot` | 16.9 |
| `a35_restore_moves_no_branch_and_pushes_nothing` | 16.4 |
| `a35_a_missing_saved_conversation_is_a_recording_failure` | 16.2 |
| `a35_the_original_conversation_is_untouched` | 16.1 |
| `a35_plan_refuses_an_unrewindable_checkpoint` | 16.0 |
| `a35_rewind_outcomes_survive_reopen` | 14.7 |
| `a35_an_old_checkpoint_is_not_rewindable` | 14.6 |
| `a35_rewind_refuses_another_workstream_or_its_door` | 13.3 |
| `a35_write_records_a_mark_per_agent` | 11.4 |
