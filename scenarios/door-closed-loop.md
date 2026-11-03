# The Door closes the work loop

Specification for #5928. First-journey stages: Request, Understand, Intervene and Review (`.agents/data/journey.md`, **What must work**). These clauses specify future behavior; publishing this file establishes no implementation result.

The user deals with the Workstream's Door. Each Subagent fact that changes what happens next reaches that Door through the Message inbox, or exposes its delivery failure on the Agent and Workstream rows. The system observes endings independently of a Subagent sending its own report. Direct Agent access remains available; normal progress requires none. The user opens a Subagent only to answer its native permission prompt (policy: P1, P3, P6).

Rebuild each derived view from stored records on each relevant change, Project startup and a 30-second pass. A lost bus notification or Daemon restart cannot erase a fact. Keep the Door's own Kind as the transport predicate and derive Workstream state separately (policy: P4, P9, P10).

```text
stored Agent / Message / Todo / Pad records
             ↓ change, startup, 30-second pass
missing facts → durable Message → inbox → transcript receipt
             ↓
Workstream state and visible delivery failure
```

## Terms

- **Workstream state:** most urgent derived state of all Agents in one Workstream, distinct from its Door's own Kind.
- **Job:** a Subagent given one bounded outcome that fits one context, a done condition and a report; it ends when that work is resolved.
- **Consult:** a Subagent that answers its Door's questions and rests idle between questions.
- **Stalled:** a live working Agent with ten minutes of unchanged activity and no running foreground/background work; an actionable fact, not a vendor command.
- **Settled note:** one Message requesting Todo/Pad reconciliation and a summary after child work becomes quiescent. Door-only activity cannot re-arm it.

## Acceptance


These are new IDs DCL1–DCL9, not claims that their tests already exist. Each named test is an implementation obligation. Use real store/RPC/inbox seams with fake Claude, an injected clock and bounded acknowledgements; only DCL3's vendor observation uses real Claude. Fault injection below is part of the named scenarios, so its failure is acceptance failure. At publication, first demonstrate the named behavioral assertions fail on the pinned baseline; source inspection alone is not a red-test result.

Baseline execution, replay patch, per-failure exit codes and assertion limits: [Door baseline probes](../docs/observations/door-closed-loop/README.md). These probes demonstrate the first unmet behavioral boundary in each of the seven required failure cases; the complete named tests below remain implementation obligations.

**DCL1 Delivery failures are visible.** Given an eligible receiver and pending Messages, inject (separately) an unreadable transcript record, an inbox previous-entry read failure, and an inbox write failure. On the next reconciliation, the Agent row and its Workstream row expose `can't reach <Agent>: <cause>`, including a recovery action appropriate to that cause. A failed attempt is visible immediately after reconciliation. An eligible pending Message with no receipt for 30 seconds exposes the same failure by the next pass. Time spent in a busy, stopped or native-permission state does not count toward the eligible-pending bound. A transcript that cannot establish eligibility exposes that read failure without waiting for eligibility. IDs, bodies, sender, question identity and ordering remain stored; none becomes delivered without its transcript receipt. Repair the fault without a new Message: the next eligible reconciliation writes the original batch and clears the failure after matching receipts. Tests: `dcl1_unreadable_transcript_exposes_delivery_failure`, `dcl1_previous_read_and_write_errors_keep_original_pending_batch`, `dcl1_eligible_pending_deadline_recovers_without_a_new_event` in the Messages module, with rendered row behavior proved by `dcl1_failure_reaches_agent_and_workstream_rows` in the App. Expected baseline gap F1: `crates/messages/src/inbox.rs`, `send`, silently returns on a previous-entry read failure; #5927 owns tolerant transcript reading, not this visible failure.

**DCL2 Door Kind and Workstream state are separate.** Given an idle Door and children of differing urgency, the Daemon returns a distinct Workstream state, derived from all Agents currently in that Workstream, including internal and nested descendants. Rank `needs-you > error > stalled > working > waiting > idle > settled`. A live background shell, Monitor or background task contributes working even after its foreground turn stops; waiting means an outstanding dependency/wake wait with no executing work, never a live background task. Done Agents contribute no active urgency. A stopped Door's expected done Kind does not hide working children; a crashed Door's error remains urgent. Settled is eligible only under DCL6, not merely because every child is done. Preserve the Door's own Kind and use it, with its own background work and existing Attempt eligibility, for delivery/wake; never gate the Door on a child's work. The idle Door receives one batch while a child remains working. A child's native permission prompt makes the Workstream needs-you; one action on its attention entry opens that exact child's Terminal, where the user's answer continues it. State text itself remains non-interactive. Tests: `dcl2_urgency_is_derived_without_overwriting_door_kind`, `dcl2_idle_door_receives_while_child_works`, `dcl2_permission_action_opens_requesting_terminal`. The first two use real Daemon RPC and inbox; the last uses the App seam. Expected baseline F2: `crates/agents/src/rail_view.rs`, `present`, presents the Door's own Status; `apps/desktop/src/rail/layout.ts`, `agentKindsBelow`, aggregates children for presentation only.

**DCL3 Background work survives foreground Stop.** Given each of the real-Claude cases recorded below, replay its sanitized observations through the Adapter and a controlled process snapshot. A foreground Stop while any such work remains does not complete its owner for `agent.wake`, does not settle the Workstream and contributes working. Reap the actual work and reconcile: completion becomes eligible exactly once. Include a native background Agent whose work has no separate long-lived OS process; a process tree alone is insufficient. Include only MCP servers, `rup mcp` and hook processes as negative controls: they contribute no work. Include a stale/spurious stop and PID reuse: neither ends unrelated work. Rebuild the result after a dropped hook and Daemon reopen from retained task facts and current liveness. An unavailable process observation exposes its cause; it cannot silently assert no work. Tests: `dcl3_background_bash_monitor_and_task_hold_working`, `dcl3_service_and_hook_processes_do_not_hold_working`, `dcl3_missing_hook_restart_and_stale_stop_reconcile`. Adapter decoding stays in `crates/agents/src/claude_code/`; normalized facts cross the existing Adapter seam. Expected baseline F3: `STATE_EVENTS` omits background lifecycle; `crates/messages/src/wake.rs`, `finished`, treats idle as finished without background liveness. The background fix changes wake's predicate atomically with its new caller inputs.

**DCL4 Supervisor repairs missing delivery accounting.** Given one Door and 100 stored child changes, suppress one bus notification and kill the Daemon separately (a) after a stored fact but before queuing, (b) after queuing but before inbox write, and (c) after inbox write but before receipt. Reopen the same Project without another child event. Startup and subsequent 30-second passes recover every untold fact from persisted records and ledger, obey B22 caps/counts, preserve original Message identity once allocated, and mark facts told only through durable receipt accounting. Repeated passes and restarts do not duplicate a logical fact. No startup baseline marks unseen facts told. Distinct meaningful lifecycle facts (such as an ask, error and ending during one busy Door turn) retain their own durable identities; comparing only the newest Kind must not erase them. Folded notes retain references through which the original stored facts/Messages remain readable. While the Door is busy, facts remain accounted for and visible; at its next eligible idle they reach the inbox as one scheduled batch, subject to existing caps. Tests: `dcl4_burst_crash_at_each_delivery_boundary_replays_all_facts`, `dcl4_timer_repairs_a_lost_notification` in `crates/rupd/tests`. Separately kill a busy Subagent with two pending Messages: each is terminally accounted for and the original sender receives one note listing the original IDs and `never reached <Agent>: <cause>`. If that sender is a stopped Door, retain the return note under DCL8. Repeat reconciliation/restart: no second return note and no pending Message stranded on the closed Subagent. Test: `dcl4_killed_subagent_returns_pending_messages_once`. Expected baseline F5/F9: `push_changes` baselines then waits on events; existing receiver reconciliation drops or indefinitely reserves pending Messages without a returned batch. Return-note creation and closure must be crash-safe; reuse the existing Message store, not an external notification queue.

**DCL5 End, stall and compaction are facts.** Kill a Subagent owning seven open Todos and having no report; within one supervisor pass its Door has a stored note naming the ended Agent, seven open Todos and no report, delivered when eligible. Owners stay unchanged until the Door explicitly assigns them. Also seed fourteen unassigned open Todos: snapshot/reconciliation must not invent an owner or ignore them when the Door reconciles its Workstream. For a live working Agent, hold activity unchanged for ten minutes with no executable/background work; on the next pass a stalled fact reaches its Door or remains visibly pending if that Door is busy. A stalled Door exposes its own stall on the Workstream row; it is not sent a self-addressed Message. Genuine activity clears stalled; a live ten-minute shell never triggers this stall. Replay the vendor's completed-compaction observation twice: one context-compacted fact reaches the Door for that actual compaction, with no token or cost fields. A compaction start alone is not completion. The Door chooses handoff or continuation; roundup neither compacts nor starts a replacement itself. Tests: `dcl5_kill_reports_owned_open_todos_without_reassigning`, `dcl5_inactive_turn_stalls_but_live_background_work_does_not`, `dcl5_completed_compaction_is_reported_once`. Expected baseline F4/F7: no timed inactivity supervisor, and B49's missing-summary note does not prove open Todo ownership. Use stored Todo `owner`, not B19's creator-based open-Todo count. Adapter fixtures prove context decoding; model compliance with a recommended handoff remains policy.

**DCL6 Settlement produces one Door turn per child change period.** Given children that have changed since the previous settlement and now have no working/waiting work, no unfinished Job needing a report/decision, and no pending delivery, create one settled note instructing the Door to reconcile its Todos and Pads and summarize. Idle Consults do not block it. Unfinished Jobs cannot be silently counted complete; their stop note first gives the Door the choice to resume, replace or accept the outcome. The settled note's own pending/delivered transitions and the Door's reply never re-arm settlement. Persist the child-change marker before publication and link it to the note's receipt so a crash cannot lose or duplicate it. A later child change followed by quiescence produces exactly one more settled note. Tests: `dcl6_quiescence_with_idle_consult_costs_one_door_turn`, `dcl6_door_reply_and_restart_do_not_rearm_settlement`, `dcl6_open_job_blocks_settlement_until_door_decides`. Assert delivered IDs, work states and turns with fake Claude; merely counting generated strings is insufficient. Expected baseline F8: no settlement mechanism exists in `push_changes`. Policy: the one resulting Door turn costs usage as the owner authorized; roundup computes none of it.

**DCL7 Door reconciles work through its tools.** Given a delivered update describing an ended Job, seven owned open Todos, unassigned open work and a changed Pad, the Door Brief directs the Door to read authoritative work records, decide each remaining outcome, reconcile Todos/Pads and report the result before ending its turn. On a new Door start it receives the open-Job snapshot and resumes only the Jobs it needs by its own tool call; idle Consults remain stopped until asked a question. Job instructions name one outcome, done condition, report and end; Consult instructions name the question and allow idle rest. The Brief remains identical for every Door and unchanged during a session; identities and restart snapshots arrive as start text/tool results/Messages. Preserve the shell-less Door and direct user conversation in its Terminal. Tests: extend the existing real-Daemon/fake-Claude B24 tool observer with `dcl7_update_reconciles_todos_and_pads_through_mcp` and `dcl7_restart_resumes_only_jobs_selected_by_door`; assert stored effects and authenticated spawn/resume calls, not a test double's promises. Brief wording, one-context sizing, the model deciding well and actually following its instructions are policy reviewed against the delivered tools, not claims a fake model establishes. Expected baseline F8: B24 role guidance lacks the update/settled/restart protocol. No second report system: preserve existing ResultReport/instruction coordination where applicable and B49's child-to-Door summary; do not equate arbitrary Terminal final text with a report.

**DCL8 Stopped Door retains its backlog.** Given a Door with two pending Messages and changed child facts, stop or crash its program, then restart the Daemon. Preserve original pending Messages and untold facts. The Workstream row shows `Door stopped · N waiting` and one Start action; N counts retained pending Messages plus not-yet-materialized capped updates, counting a fact once, not both its ledger entry and its Message. B22 folding/count weights remain separately conserved. A failed Start leaves that backlog and its visible cause intact. Without a user Start or Agent tool call, launch count is zero. On user Start, deliver retained Messages in order as one scheduled inbox batch under B21/B22 caps, with original sender/body/question identity; receipts alone mark delivery. Include an open-Job snapshot; resumption remains the Door's DCL7 decision. Tests: `dcl8_stopped_and_crashed_door_keep_backlog_across_restart`, `dcl8_start_replays_one_batch_and_failed_start_preserves_it`, `dcl8_row_start_and_waiting_count_follow_stored_backlog`. Expected baseline F6: B21 retains only unsent digest state, while B9 still drops already stored Messages; both must change for this Door case. Removing a Workstream is distinct from stopping its Door and retains its existing explicit removal semantics.

**DCL9 Every spawned Subagent is a Job or Consult.** Given a Door calling `agent_spawn`, require the discriminated role Job or Consult in the stored spawn contract; missing/unknown role is refused without starting a program. Update all public clients and role instructions atomically. For existing stored Subagents, infer no completed Job: migrate them explicitly as Jobs with their retained order and surface missing bounded instructions to the Door for repair. A Job's first idle without its current Attempt's report becomes one actionable stop fact and does not silently satisfy its work. A Consult's idle is normal; its actual answer reaches the Door, but idle alone creates no failed-Job note. Kill either role without a final report: the supervisor supplies the ending fact without relying on a model tool call. Restart retains role and reports open Jobs; no automatic resume follows. Tests: `dcl9_spawn_requires_and_persists_job_or_consult`, `dcl9_idle_job_without_report_is_actionable_consult_idle_is_rest`, `dcl9_restart_preserves_roles_without_launching_agents`. Use existing Message/instruction/result records to identify the report for that work; a question alone and a previous Attempt's report do not complete a Job. Expected baseline rule-4 gap: `SpawnParams` has no Job/Consult discriminator. The exact new wire spelling must be added to the glossary in its Contract PR; no overloaded use of the existing Agent/Workstream node kind.

## Real Claude evidence for DCL3

Observed on Linux, 2026-11-03, real Claude Code **2.1.296**, checkout **80e543464d7c01eedeff7f864bd0933adaa18cda**. Isolated cwd `/tmp/door-5928`; existing configured login/gateway and settings retained, with observational hooks added through `--settings`. Invocation used `claude -p`, `--permission-mode dontAsk`, allowed Bash/Agent/Monitor and text output; no model override, vendor command or UI attachment. Child task did only a fifteen-second sleep. This is vendor-signal evidence, not a roundup integration or macOS process-observer result.

The hook observer projected only event, tool, Agent/session identity and wall time; the process observer projected PID/PPID/name. Usage fields are outside the observation contract and must be discarded at the Adapter before fixture storage. Local raw vendor output is not a publishable fixture.

| Case | Actual request/result | Observed hooks/processes |
| --- | --- | --- |
| Background Bash | `Bash {command: "sleep 30", run_in_background: true}` returned a background task ID and output-file identity; later completed with exit 0. | PreToolUse/PostToolUse Bash; no SubagentStart/Stop for Bash. Claude PID 938 had Bash 1002 → sleep 1003. |
| Monitor | Loaded through ToolSearch, then Monitor ran a bounded shell loop watching the sleep, `timeout_ms: 120000`; returned a task ID immediately, later a stream-ended notification and final event. | PreToolUse/PostToolUse Monitor; no SubagentStart/Stop for Monitor. Claude 938 had Bash 1020 → sleep 1116 while the Monitor waited. |
| Background Task | This vendor calls it `Agent`: `{subagent_type: "general-purpose", run_in_background: true, prompt: "run sleep 15 then report observation complete; do no other work."}`. It returned immediately and later notified completion. | SubagentStart at **17:48:40.545 UTC**, parent Stop at **17:48:42.767**, child Bash PreToolUse at **17:48:46.617**, PostToolUse at **17:49:01.658**, SubagentStop at **17:49:02.924**. The parent had already stopped its foreground turn while the child continued. |

The sampler found two shell/sleep descendant chains but no separate native-Agent OS process. Do not infer native Agent liveness from a dedicated PID. Background completion notifications carry task identity and completion status; those facts can reconcile the retained task record when a hook is missed. The existing `docs/adr/0006-claude-code-hooks-for-state.md`, “Claude Code hooks as the state Signal”, explicitly warns about spurious SubagentStop. Keep that warning; match identity and reconcile facts instead of blindly flipping Kind.

Local evidence: `/tmp/door-5928/hooks.jsonl`, `processes.jsonl`, `claude-result.txt`, `settings.json`, `hook.py`. These ephemeral paths are not acceptance artifacts. This Issue contains the portable observation; publication must retain a sanitized replay fixture or reproducible observer with the spec. The Monitor command used `pgrep -f`, which can match its own text; its event is evidence of task completion, not a validated general-purpose completion detector. No implementation may copy that polling command as its liveness algorithm. macOS process-tree filtering and compaction completion were not observed in this probe; implementation must verify those separately using Adapter fixtures and CI/platform observers. No user-only Mac question is raised by this Linux-observable specification.

## Reproduce the vendor observation

Save the following as `observe.py`, then run `python3 observe.py` with the configured real Claude login/gateway. It adds observational hooks through `--settings`, runs only bounded sleeps in a fresh temporary directory, and samples PID/PPID/name, never command arguments or usage fields. It does not attach to a desktop or change credentials. The scripts/logs stay outside the checkout. This is a vendor probe, not roundup's production process filter. The reply is model testimony; the projected hooks and process snapshots are the observation.

```python
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

# This is an isolated vendor observer, not a production liveness algorithm.
if len(sys.argv) == 3 and sys.argv[1] == 'hook':
    event = json.load(sys.stdin)
    keep = ('hook_event_name', 'session_id', 'agent_id', 'agent_type', 'tool_name', 'tool_use_id')
    row = {key: event[key] for key in keep if key in event}
    row['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(sys.argv[2], 'a') as out:
        out.write(json.dumps(row) + '\n')
    sys.exit(0)

root = Path(tempfile.mkdtemp(prefix='dcl3-'))
script = Path(__file__).resolve()
import shlex
command = shlex.join([sys.executable, str(script), 'hook', str(root / 'hooks.jsonl')])
events = ('PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop')
settings = {'hooks': {event: [{'hooks': [{'type': 'command', 'command': command}]}] for event in events}}
(root / 'settings.json').write_text(json.dumps(settings))
prompt = '''Observe three bounded background cases, using no filesystem changes:
1. Bash: sleep 30 with run_in_background true.
2. Load Monitor using ToolSearch, then run Monitor with command sleep 20 and timeout_ms 120000.
3. Agent general-purpose with run_in_background true, instructed only to run sleep 15 and report observation complete.
Start all three, then end your foreground turn immediately. Do not poll, wait, create files, use other tools or start further Agents. Report the returned task identities.'''
with (root / 'reply.txt').open('w') as reply, (root / 'stderr.txt').open('w') as err:
    process = subprocess.Popen(['claude', '-p', '--permission-mode', 'dontAsk', '--allowedTools',
        'Bash,Agent,Monitor,ToolSearch', '--settings', str(root / 'settings.json'), '--output-format', 'text', prompt],
        cwd=root, stdout=reply, stderr=err)
    deadline = time.monotonic() + 180
    with (root / 'processes.jsonl').open('w') as out:
        while process.poll() is None and time.monotonic() < deadline:
            rows = subprocess.check_output(['ps', '-eo', 'pid=,ppid=,comm='], text=True).splitlines()
            parsed = [line.split(None, 2) for line in rows]
            family = {process.pid}
            for _ in range(len(parsed)):
                added = {int(pid) for pid, parent, _ in parsed if int(parent) in family}
                if added <= family:
                    break
                family |= added
            selected = [{'pid': int(pid), 'ppid': int(parent), 'name': name}
                        for pid, parent, name in parsed if int(pid) in family]
            out.write(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'processes': selected}) + '\n')
            out.flush()
            time.sleep(0.25)
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
        raise SystemExit('observer timed out: ' + str(root))
print(json.dumps({'directory': str(root), 'exit': process.returncode}))
sys.exit(process.returncode)
```

| Failure | Observer result / exit |
| --- | --- |
| Claude cannot launch, settings cannot be written, or `ps` fails | Python names the operation and exits nonzero; no passing observation. |
| Claude exceeds 180 seconds | Observer terminates its own Claude, reports `observer timed out` and exits 1. |
| Claude refuses a tool or omits a requested case | Inspect projected hooks/reply: that case has no evidence, even if the program exited 0. |
| Claude exits nonzero | Observer prints its directory and exit, then returns that exit; keep stderr locally. |

Re-observed on Linux at baseline `f364d79c84ffc01f8fd10a227b2f544d1f4d53f7`, Claude Code 2.1.296, 2026-11-03 **18:05:47–18:06:20 UTC**. The command exited 0. It recorded 141 process snapshots: Claude PID 1132 had three Bash→sleep chains (1214→1215, 1233→1234, 1239→1240). Hook descendants were sh→python3 and were transient. Several pre-existing `claude.exe` descendants were present: process names alone do not identify their purpose and are not evidence of a native Agent PID. All three tasks completed; no Bash/Monitor SubagentStart/Stop occurred. The observed parent Stop preceded its native Agent's tool completion.

Sanitized replay projection of that run (session `S`, child `C`, tool `T`; these aliases preserve equality). These are selected actual hook fields, not fabricated full vendor payloads. Implementation fixtures must retain event identity and pair starts/stops; this projection proves ordering only, not every completion payload or process-filter case of DCL3.

```jsonl
{"hook_event_name":"PreToolUse","session_id":"S","tool_name":"Bash","at":"2026-11-03T18:05:47.887419+00:00"}
{"hook_event_name":"PostToolUse","session_id":"S","tool_name":"Bash","at":"2026-11-03T18:05:47.987550+00:00"}
{"hook_event_name":"SubagentStart","session_id":"S","agent_id":"C","agent_type":"general-purpose","at":"2026-11-03T18:05:48.640889+00:00"}
{"hook_event_name":"PreToolUse","session_id":"S","agent_id":"C","agent_type":"general-purpose","tool_name":"Bash","tool_use_id":"T","at":"2026-11-03T18:05:49.664924+00:00"}
{"hook_event_name":"PreToolUse","session_id":"S","tool_name":"Monitor","at":"2026-11-03T18:05:50.064175+00:00"}
{"hook_event_name":"PostToolUse","session_id":"S","tool_name":"Monitor","at":"2026-11-03T18:05:50.106831+00:00"}
{"hook_event_name":"Stop","session_id":"S","at":"2026-11-03T18:05:52.127521+00:00"}
{"hook_event_name":"PostToolUse","session_id":"S","agent_id":"C","agent_type":"general-purpose","tool_name":"Bash","tool_use_id":"T","at":"2026-11-03T18:06:04.721455+00:00"}
{"hook_event_name":"SubagentStop","session_id":"S","agent_id":"C","agent_type":"general-purpose","at":"2026-11-03T18:06:05.337676+00:00"}
```

## Existing acceptance and proof reconciliation

This work order explicitly requests the following scenario amendments with implementation, rather than weakening assertions to match code:

- DCL1/DCL4 replace B51(d)'s “never a timer” retry restriction with reconciliation-driven eligible retry, preserving original-ID receipts and zero Terminal writes.
- DCL3 narrows B41's idle-is-finished test: idle plus live background work is not finished. Native needs-you remains actionable under P3.
- DCL4/DCL8 replace B8/B9's treatment of a stopped/crashed Door and close stranded pending Subagent Messages with an auditable return note. B21 stopped-Door waiting becomes durable; B22 numeric caps, fold references and total change weights remain.
- DCL5/DCL9 amend B19/B49 only where needed to distinguish owned open work and a current Job report from a question or earlier Attempt; do not silently reinterpret a creator count as an owner count.
- DCL5/DCL6/DCL9 replace B35/B47's suppression only for meaningful Job turn-end, stall, compaction and settled facts; Consult idle/working flips without new content still do not start needless turns. DCL7 extends B24 and the Door's awareness guidance without restoring removed Thread UI or shell access.

Message-law review must cover **M1, M4, M5, M6, M7, M9, M10** in `scenarios/proofs.md`; M2/M3/M8 remain retired. M7 currently forbids pending Messages after done/error, which conflicts with the owner's retained stopped-Door inbox. This is an explicit engineering contract conflict to resolve in the Messages order: model the durable logical Door receiver separately from an ended Attempt and make the model/Rust/docs agree under independent Contract review. Do not claim that unchanged M7 proves retention, silently relax its predicate, or reset terminal Message statuses. If that distinction cannot meet the existing no-weakened-law rule, record the precise conflict on this Issue before publication; it is not permission to skip proofs or to drop the backlog. Every affected Contract PR runs the existing proof observer and retains its mutants.

Receipt accounting also has an existing exception: `scenarios/inbox-repeats.md`, B5763b–c, closes matching notes as delivered/repeat without a new transcript receipt. That outcome alone does not establish that a distinct lifecycle fact reached the Door under DCL1/DCL4. The Messages Contract order must reconcile the two contracts explicitly, preserving peer-repeat protection, readable original identities, questions and absorbing terminal statuses; neither resetting a terminal Message nor declaring an unseen fact told resolves it. This specification claims no existing repeat test proves the new receipt requirement (policy).

## Regression checks on main

1. `scenarios/messages.md`, **B50 every Message to an Agent goes through the inbox, never the Terminal**, and `crates/rupd/tests/b50_note_inbox.rs`, `b50_a_note_is_delivered_when_the_transcript_records_it`: original identity and transcript receipts, zero Message Terminal writes.
2. `scenarios/messages.md`, **B22 caps**, and `crates/messages/src/pushes.rs`, `flush`: preserve 8/60000 ms, 20 pending digests, fold identities, readable originals and weighted change conservation.
3. `scenarios/messages.md`, **B24 a Door's Brief describes its current role**, and `crates/agents/src/claude_code/brief.rs`, `Role`: shell-less Door and stable role Brief.
4. `docs/adr/0006-claude-code-hooks-for-state.md`, **Claude Code hooks as the state Signal**, and `crates/agents/src/claude_code/launch.rs`, `STATE_EVENTS`: preserve identity-checked lifecycle observations and the documented spurious-stop warning.
5. `docs/design-system.md`, **The checks**, and `apps/desktop/src/testing/checks.ts`, `runChecks`: D2 type/space, D5 contrast, D6 interaction; critic observations at dark 1512×950 on dense `tree-40`, with injected delivery failures visible. Preserve all checks passing on baseline, name changed Checks, use Tokens and existing Ark primitives. Capture DCL1/DCL2/DCL8 with `just capture` during UI implementation; leave media under `artifacts/ux/<id>/`, never commit it. UI behavior tests assert actions, focus, identities and RPC calls; critic owns appearance.
6. `scenarios/proofs.md`, **V7 the Reviewer checks the proofs**, and `proofs/messages/LAWS.bend`, `m7_receiver_gone`: independent review, actual model/Rust agreement, proof execution and no silently weakened law.

7. `scenarios/inbox-repeats.md`, **B5763b the shared inbox write closes repeats once**, and `crates/messages/src/inbox.rs`, `b5763b_identical_entries_write_once_and_close_the_repeat`: preserve shared peer-repeat protection while reconciling the receipt-accounting conflict above.

## Reuse research and observer limits

Installed: Tokio 1.53.1 provides the timer and injected clock; rusqlite 0.40.2 with existing migrations provides durable transactions; Agents already uses rustix and macOS libproc 0.14.11, while perf already uses sysinfo 0.37.2. No bespoke scheduler, clock, process parser, report protocol or queue is selected by this specification. [Tokio interval](https://docs.rs/tokio/latest/tokio/time/enum.MissedTickBehavior.html) supports skipped missed ticks; [rusqlite transactions](https://docs.rs/rusqlite/0.40.2/rusqlite/struct.Transaction.html) provide atomic commit. Process candidates are existing [libproc](https://docs.rs/libproc/0.14.11/libproc/) and [sysinfo](https://docs.rs/sysinfo/0.37.2/sysinfo/), not a hand-written process-tree implementation. The linked versioned documentation describes their process capabilities; the Agents builder must compare required PID identity/filtering capabilities and rule-7 costs before selection. Neither is rejected without measurement. [Claude's hooks reference](https://code.claude.com/docs/en/hooks) is supporting documentation; the dated real-binary trace above decides what was actually observed.
