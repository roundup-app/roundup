# Door baseline probes

DCL1–DCL9 specification prerequisite, #5928. Baseline: `f364d79c84ffc01f8fd10a227b2f544d1f4d53f7`, Linux, 2026-11-03. The patch adds tests and configures existing test observers only; it changes no product behavior. Tests exercise the existing real Daemon/store/RPC/inbox, fake Claude, or real Claude Adapter. No real vendor login is needed.

These are initial red assertions for the seven work-order failure cases, not the complete implementation tests. A failure before a later clause proves nothing about that later clause. The 27 implementation test names in the scenario remain obligations; they are not claimed as passing or fully implemented by these probes.

## Replay

From the specification checkout, save its absolute path, then apply the retained test additions to an isolated baseline:

```sh
spec_checkout=$PWD
git worktree add --detach /tmp/door-baseline-replay f364d79c84ffc01f8fd10a227b2f544d1f4d53f7
cd /tmp/door-baseline-replay
git apply --unidiff-zero "$spec_checkout/docs/observations/door-closed-loop/baseline.patch"
cargo build -p rup -p rupd
cargo nextest run -p agents --test dcl_baseline --no-fail-fast
cargo nextest run -p rupd --test b50_note_inbox dcl --no-fail-fast
cargo nextest run -p rupd --lib dcl5_inactive --no-fail-fast --retries 0
```

The build must exit 0. Each test command must compile and reach its behavioral assertion; a setup error, timeout during readiness, missing executable or compilation failure does not establish the baseline gap. `--no-fail-fast` runs the separate fault cases even after another assertion fails. Existing harness Drop handlers clean up their own Daemon/Terminals; the background-shell probe kills and reaps its own shell before asserting. Use a fresh worktree path on another replay.

## Observed assertions

Each row identifies its first unmet boundary; recovery, rendering and subsequent lifecycle clauses require the implementation observers.

| Failure case | Probe | Behavioral assertion failure | Exit |
| --- | --- | --- | --- |
| Unreadable transcript | `dcl1_unreadable_transcript_exposes_delivery_failure` | Pending Message; Agent row still has `inbox: ok`, with no actionable delivery cause. | 100 |
| Previous-entry read failure | `dcl1_previous_read_and_write_errors_keep_original_pending_batch_previous_read` | Pending Message; Agent row still has `inbox: ok`, with no actionable read failure. | 100 |
| Inbox write failure | `dcl1_previous_read_and_write_errors_keep_original_pending_batch_write` | Pending Message and `inbox: missing`, with no cause or recovery action. | 100 |
| Live background shell | `dcl3_background_bash_monitor_and_task_hold_working` | Adapter returned `Idle` after foreground Stop while the controlled shell was live; expected `Working`. | 100 |
| Daemon killed during burst | `dcl4_burst_crash_at_each_delivery_boundary_replays_all_facts` | No replay of the stored 100-Todo burst at startup or within one supervisor pass after removing the publication fault. | 100 |
| Subagent killed with open Todos | `dcl5_kill_reports_owned_open_todos_without_reassigning` | Ownership stayed intact; no ending note naming seven owned open Todos and no report arrived within 31 seconds. | 100 |
| Busy then stopped Door | `dcl8_stopped_and_crashed_door_keep_backlog_across_restart` | First original Message became `dropped`; expected `pending`. | 100 |
| Stalled turn | `dcl5_inactive_turn_stalls_but_live_background_work_does_not` | Live Door still returns `working` after ten minutes without activity and one supervisor interval; no stall is exposed. | 100 |
| Idle Job without report | `dcl9_idle_job_without_report_is_actionable_consult_idle_is_rest` | No actionable stop fact within 31 seconds of the Job's first idle without a report. | 100 |

The Adapter command ran one test; the Daemon integration command ran seven; the injected-clock Daemon command ran one. All nine reached the intended behavioral assertion. The first two commands used nextest's configured one retry; the final stall run disabled retries. An earlier stall attempt paused Tokio during process startup and had a hook-loader readiness timeout on retry; that setup failure is excluded. The retained probe leaves startup/cleanup on real time and pauses only the supervisor interval.

## Limits

- DCL1 observes the returned Agent row. Rendered Agent/Workstream rows and recovery are future App obligations. Separate read and write probes do not imply repair or retry passed.
- DCL3 demonstrates background Bash at foreground Stop with a live controlled shell and the actual Adapter. Monitor, native Agent, process filtering, PID reuse and restart remain separate implementation obligations. The real vendor observation is retained in the scenario.
- DCL4 kills the Daemon after 100 persisted Todo changes and an acknowledged comparison, with publication faulted through the existing Messages fault hook. Reopen uses the same Project/data, without a new child event or automatic resume. Later delivery boundaries, fold accounting and every original identity remain implementation obligations.
- DCL5's killed-child probe seeds seven owned and fourteen unassigned Todos, kills the child program with SIGKILL, checks ownership and waits one supervisor interval for the ending note. The stall probe uses the real Daemon with injected time and a live fake-Claude program and real start/signal calls, with no background work; it checks the Workstream's own stall, not vendor model behavior.
- DCL8 queues two Messages while the Door is busy and fails at the stop boundary before restart. No crash/restart success is claimed.
- DCL9 uses an authenticated Door's real spawn call and the first idle of its Job, without a report. Consult behavior, migration, restart and role refusal remain implementation obligations.

No product gate is weakened and no permanently red test is added to CI. The patch is a replay artifact; implementation PRs must land their complete observers with the behavior they prove.
