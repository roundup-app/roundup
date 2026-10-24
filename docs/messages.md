# Messages between Actors

Design for `scenarios/messages.md` (B1–B18, B39/B40 and B50–B52) Serves `PRINCIPLES.md` P1, P3, P4, P9, P10 and P11 (the ids in `PRINCIPLES.md`, not `pads.md`'s). Terms are in `GLOSSARY.md`; the one new word is "digest" (the type `Digest`, `agent.digest`, the tool `agent_digest`), the user's choice, defined in `GLOSSARY.md`.

## Existing delivery seams

`crates/messages` owns the durable Message store, Routes and holds.
`crates/rupd` wires delivery to Agents, and `crates/rup` exposes the existing RPC/MCP calls.
The Adapter input seam supplies user prompt typing and cross-session inbox delivery;
B50–B52 specify the sender-based selection and receipt rules. These changes reuse
those seams rather than adding a queue or another Adapter seam.

## Status of a Message

| Status | Meaning | Leaves it by |
|---|---|---|
| `pending` | awaits transport and receipt when the current Attempt is delivery-ready (`idle` or B37's live `error`) | acknowledged (`delivered`), held, or the receiver exits (`dropped`) |
| `held` (`ask-first`, `takeover` or `inbox`) | waits for the user, for a Takeover to end, for unsent input to be submitted or cleared, or for the Agent's Claude inbox to pass its check | `message.deliver`, `message.drop`, the end of a Takeover or the submit or clear of unsent input (only `takeover`), a passing check at the Agent's next `idle` (only `inbox`; `message.deliver` of it needs that check too, else `INBOX_UNAVAILABLE`) |
| `delivered` | receipt acknowledged by the Agent on the selected transport, or stored for the user (B10) | final |
| `dropped` | ended without delivery, with a reason | final |

Default Route is `auto`. A Held Message never blocks a later one (B7). Delivery acknowledgement follows the selected transport (B39/B40, B50–B52): user prompts use `UserPromptSubmit`; non-user inbox Messages use the transcript receipt for `msg_id`. Successful writing alone is not delivery. A prompt id line cannot acknowledge an inbox Message or block a prompt that names one. An unacknowledged id may be retried after restart, without another delivered transition. `blocked` is unchanged: this series gives Routes no say in Kind (`GLOSSARY.md`, "Who decides Kind").

## B50 to B52: authenticated sender selects transport

For an Agent receiver, both `note` and `question` use this table; authenticated identity, never a caller-supplied sender or body, selects the row:

| Sender | Transport | Receipt |
| --- | --- | --- |
| User | Existing `Agents::prompt` user-input path, B2/B30 batching | `UserPromptSubmit`, B39/B40 |
| Agent, Extension, Daemon | Existing Adapter cross-session inbox only | Transcript `msg_id`, B50–B52 |

Messages addressed to the user have no Agent inbox: B10 stores direct Messages. No non-user Message reaches `Agents::prompt` or a Terminal fallback, including questions, retries and explicit user delivery. Reuse the existing Adapter, store and holds; no replacement queue or conversion of question to note.

The Adapter owns socket authentication, protocol checking, envelope and receiving Attempt permission mode. An inbox question remains a durable `question` with its original sender, body, id, and `replyTo`. The Adapter prefixes question content with `[question, replyTo: <id>]`; notes keep their existing content. This identifies the kind and the id to answer; transport metadata does not rewrite the stored body. Questions never enter note folding or note queue-bound exemptions, even when their authored body starts with `[digest]` or `[wake]`. Receipt resolves the same Message id through the existing transcript mechanism. The in-flight record precedes the socket write, and the Message stays pending until receipt. Repeated idle edges skip an in-flight id in this Daemon run. After restart an unacknowledged id may be resent with the same `msg_id`; this is a transport retry, not a second Message or answer. An acknowledged id is never resent and emits `message.delivered` once.

Missing or Mismatch holds either non-user kind for `inbox`, exposes the existing Rail fact and emits one held event with no false delivery. Mismatch returns `INBOX_UNAVAILABLE` after storing the held Message; Missing retains the existing send response. Manual `message.deliver` requires a usable inbox or fails visibly while leaving it held. A passing check at eligible idle or Attempt start releases inbox holds in order only after every remaining Takeover/input hold ends; AskFirst/Drop retain their own semantics. Explicit user delivery retains its hold override but cannot select another transport. Recovery binds a held id to the checked current Attempt before making it pending. The merged inbox-recovery repair's final-hold guards apply to questions as well as notes.

The vendor suppresses consecutive equal sender/text entries within a receiving Attempt. B51(g) conservatively refuses equal authenticated sender/body against the latest pending/delivered non-user Message in B7 delivery-rank order across both kinds, before allocating a Message id. Tests cover all four ordered kind pairs and all non-user senders; another sender/body, an intervening entry or a new receiving Attempt remains accepted. A repeated same id is a B52 retry. Adapter fixtures for 2.1.300 and 2.1.302 pin the envelope and full question content; the Daemon fake peer suppresses repeated `msg_id` values and consecutive equal sender/content envelopes. The question header includes its distinct id, but does not relax the sender/body refusal. Recovery and manual release can deliver older ids after newer ids; the repeat boundary follows that release order, never allocation id. A refused held Message remains held and explicit delivery exposes `CONFLICT`; Distinct accepted questions keep distinct Message ids.

### Questions and holds

A question is one ordinary Message to one receiver. No timer, hop or held question passes it on: the user answers in the asking Agent's Terminal (A3564a), and a question nobody answers stays as its status says.

### Model interpretation and observers

The existing `Type(id)` effect denotes the selected delivery transport; for non-user Messages it is an inbox effect, not Terminal typing. Missing/Mismatch projects that attempted transport to a hold, outside `step`. The pure model's atomic delivery abstraction does not establish Rust's in-flight, transcript or vendor repeat behavior. The sender/kind routing, receipt and hold observers exercise the Rust path independently of the model. The separate model-correspondence finding remains separate work.

Affected laws: M1 (delivery/receipt and same-id retry), M2 (hold ownership), M3 (Takeover isolation), M4 (release order), M5 (unique ids and final states), M6 (no silent loss), M7 (receiver ending), M9 (restart replay), M10 (eligible-idle progress). No law may be weakened. The implementing Contract PR updates every changed interface's callers together and keeps the model and this interpretation agreeing. `just proofs` must print `ALL PROOFS CHECK`; it proves models, not Rust wiring.

B50's sender/kind table exercises actual Daemon delivery, inbox entries, `Agents::prompt` calls and Terminal writes. B51 covers failure, explicit delivery and the tested repeat boundary. B52 counts entries per id, receipts and events over 30 idle edges and the four restart states (pending, in flight, acknowledged, held). Assertions run after each completed operation/handshake. Every regression names its clause and rejected mutation, including the Note-only transport gate and missing current-hop validation. Existing note regressions remain unless a named surviving test rejects the same break.

Gates and observers: P1/P11 require zero automatic inbox entries during Takeover/unsent input, including inbox recovery and overlapping holds; P3 requires no alert from ordinary Messages; P4 keeps vendor handling in the Adapter; P9/P10 require authorized delivery with user prompt batching retained and zero non-user prompt calls. These are behavior observers, not new App visuals.

## B37 lifecycle-to-model mapping

The model's `Idle` event and `World.idle` mean delivery readiness, not a literal
Kind. For the current Attempt, a running Terminal at `idle` or at `error` after
`StopFailure` is delivery-ready. Kind `error` alone is not evidence of ending.
The Attempt identity and authoritative ending facts must be checked before
projecting Status into model events; a Status observation cannot revive an ended
Attempt. B9 still applies to `done`, an ended Attempt or receiver removal.

| Current receiver fact or action | Existing model interpretation |
|---|---|
| Live current Attempt becomes `idle` or reports `StopFailure` / `error` | `Idle`: flush pending Messages in B7 order, with B30 batching in Rust; do not drop them or wait for another `idle` Signal. |
| New Message while already delivery-ready | `Send` with the current Route and sender; the ready state permits delivery immediately. |
| Route `ask-first` or `drop` | `Send` retains the ask-first hold or drops respectively; readiness bypasses neither Route. `UserDeliver` / `UserDrop` retain their existing guards. `UserDrop` also drops a `pending` Message the user sent that has no in-flight record: it leaves the queue as `dropped` (reason `removed`) and nothing is typed (U3782). |
| Existing Takeover or unsent input | `TakeoverBegin` / `UserInput` keeps automatic delivery held, including Messages from the user (B32). `TakeoverEnd` clears only Takeover; `UserSubmit` and `UserClear` clear only unsent input. Automatic release waits until both are clear, then makes held Messages pending in B7 order; ask-first holds remain. Explicit `UserDeliver` still wins. B37 gives no new `takeover.begin` eligibility. |
| Current Attempt is not ready, or typing is refused as `Busy` | `Busy`: no Type effect; keep the batch pending, or takeover-held if a Takeover began meanwhile. Rust undoes its pre-typing delivery record on refusal; the model's atomic record-and-Type step represents only accepted typing. A newer readiness revision supplies `Idle` again, including when its handler ran before the Busy completion: Rust re-reads authoritative readiness after rollback and retries only at a strictly newer revision of the same Attempt. An unchanged revision does not retry. |
| Current Attempt actually ends, even with last Kind `error`; Kind `done`; or receiver is removed | `Exit`: drop pending and takeover-held Messages as receiver-gone in id order, retain ask-first holds, refuse later sends and manual delivery. A later `Idle` cannot clear `gone`. |
| Observation belongs to an older Attempt or a stale Status revision | No model event for the current receiver: neither `Idle` nor `Exit`. An older `StopFailure` cannot reopen an exited receiver or close a resumed Attempt. |

A resumed Attempt has a new receiver generation; its predecessor's final Messages
stay final (B36). Bus-lag reconciliation and fresh send/release scheduling use the
same current-Attempt facts, never the last Kind alone. A35's explicit reservation
projections below still apply after this lifecycle classification.

M1 retains the conditional record/at-most-once typing boundary; M4 retains queue
ranks and hold-release order; M6 retains every pending or held record on live
failure and Busy refusal; M7 applies `Exit` to actual ending, not live failure;
M10's fair `Idle` progress includes live `error`. Fairness still requires eventual
accepted delivery: an indefinitely Busy receiver cannot promise progress.
`LAWS.bend`, predicates and transitions are unchanged. Proofs cover the model,
not Rust lifecycle classification, batching or Terminal effects.

This is the required B37 interpretation, not a claim that the runtime projection
already implements it. At this alignment, `crates/agents/src/lib.rs`'s `prompt`
accepts live `Idle | Error` and refuses ended/closing Attempts, while
`crates/messages/src/lib.rs`'s `ended`, `on_status` and fresh-delivery scheduling
still classify by Kind. #1847 owns that projection repair and B37's runtime,
real-Claude observer acceptance; this alignment does not close
it. V4's existing pure transition correspondence remains unchanged; V7 must also
check the lifecycle projection against those seams.

## Modules

| Module | Change |
|---|---|
| `crates/contracts` | `Message`, `MessageKind`, `MessageStatus`, `Held` reason, `Route`, `Delivery` (moved out of `contracts/hooks.ts`, which imports it); methods `message.send`, `message.get`, `message.list`, `message.deliver`, `message.drop`, `route.set`, `route.list`, `takeover.begin`, `takeover.end`; events `message.sent`, `message.held`, `message.delivered`, `message.dropped`, `route.changed`, `takeover.changed`; `generated/` is regenerated, never edited |
| `crates/messages` (new) | stores Messages and Routes in `messages.db` of the Project data folder (N1, ADR 0004), holds Takeovers in memory, listens to `agent.status` on the bus, and delivers through the existing Adapter inbox or `Agents::prompt` according to authenticated sender |
| `crates/agents` | the existing Adapter input seam handles inbox delivery for non-user Messages and `Agents::prompt` for user text; no fourth seam (P4) |
| `crates/rupd` | registers the module |
| `crates/rup` | MCP tools `message_send`, `message_get`, `message_list` (B12) |
| `crates/provenance` | none: `item` is a free string, `message:<id>` joins `todo:` and `pad:` (B11) |

B32's Daemon-internal `TerminalOwners` dependency keeps `rpc::Module` unchanged. Production
uses `Agents::with_terminal_owner`: Rail then Attempts then the Message store. Reconciliation
and input recording commit together, including in-memory Takeover and input holds; SQL or
recording errors roll all of them back and publish no buffered events. A fenced receiver commits
only authoritative ending reconciliation. Ownership lookup errors do no store work. Events and
ordinary delivery scheduling follow the returned operation; delivery resolves current Status and
Message fences again, so an escaped owner id is only a scheduling hint. This touches M1, M3,
M6, M7, M9 and M10; their modeled input, ending and replay transitions stay unchanged, and
none of M1–M10 is weakened.

Bounds, from the codes `rpc::code` already has: 32 `pending` or `held` Messages per receiver (pushed digests have their own bound of 20, B22) and 8192 bytes of body (`CONFLICT` and `INVALID_PARAMS`). No new error code.

## The gates

- **P1.** No new path makes the user address an Agent instead of the Thread, or makes an Agent reachable only through the Thread. During a Takeover or unsent input, no automatically delivered Message reaches the Agent; the user's explicit `message.deliver` still wins (B6, B32).
- **P3.** Nothing here interrupts the user. A Message to the user is stored, changes no Kind and carries no signal beyond the event (B10). The Inbox UI is not in this series; when it inks a badge for Held Messages it must answer this gate itself.
- **P4.** The `messages` crate reads no vendor string; typing goes through the Adapter seam that exists.

## Child digests

Serves P1, P3 and P4. P3: pushes go to a Door as `note` Messages, never to the user, and change no Kind. P1: a Door learns its children through a tool and Messages, so nothing makes the user address the Thread through it. P4: the envelope reads Status labels, Messages, Todos and Pads, never Terminal output or a vendor string. P7: a merge names the two Messages it folds and drops them with the reason `merged`, so `message.get` still opens them. Added contract: `agent.digest`, the type `Digest` and the `Reason` `merged`; the MCP tool `agent_digest` is offered to Doors only. Tool set per kind of Agent, for this PR alone: M1's tools and B12's four for every Agent, plus `agent_digest` for a Door. The numbers in B19 to B22 (512 bytes, 20 children, 8 pushes per minute, 20 held, 4096 bytes) are starting values: the Builder measures them, and a later PR may change them. The composer is `crates/messages`, which listens to `agent.status` and the Todo and Pad events; it reads no new input.

## Contract timing

The contract is not a separate PR: types and methods with no caller would be unused exports (`AGENTS.md` rule 2). It lands with the first Builder PR below, as A16's did, and rule 4 applies to that PR: the review run's approve covers it. `docs/extension-interface.md` now says `to: Actor`; Group fan-out and the `bus.route` Hook are not in this series.

## Open

Two choices came from the user's ask and are settled in `scenarios/messages.md`: Takeover starts and ends by an explicit call from the webview (B6), and a Held Message does not block a later one (B7).

## A35 retained-Agent restart

This in-process seam is for #808's Daemon coordinator, not RPC. Consent, Proof,
selection, lifecycle acknowledgements and the per-Workstream retry belong to that
coordinator. It must persist/reuse its operation key and exact Door first prompt.

```text
reserve_restart(agent, key, first_prompt?)
  → stop and restart through Agents; observe matching SessionStart
  → Door: observe first-prompt acknowledgement; record_restart_prompt(agent, key, attempt)
  → release_restart(agent, key, attempt)
```

Reserve before any selected Agent stops. Reservation waits for accepted Message
prompts to finish. It persists in `messages.db`, holds no Message by a new Reason,
and changes no Takeover. A conflicting key, changed first prompt or a missing
receiver is refused. An already stopped retained Agent can reserve its next
Attempt; its ordinary B9 ending is reconciled first, and no final Message revives. The reserved first prompt is allowed only for a Door.
There is one active reservation per retained Agent, and a completed-key tombstone
makes repeats no-ops. No caller changes outside Messages are needed until #808
uses these operations; that Issue remains open for full A35/U374 acceptance.

A reservation keeps the logical Message receiver alive while its Terminal is
replaced. Stop/error, next Attempt, delayed earlier Statuses, lag resync and Daemon
reopen preserve pending and held records and never type them. In the pure model,
`restart_event` projects these temporary Exit/Idle/Restart inputs to Busy; entering
the window first applies Busy. Final receiver removal without an explicit retirement reservation bypasses this
projection, ends the restart reservation and follows B9. Outside a reservation,
actual ending applies Exit and drops pending and Takeover-held Messages; a live
StopFailure instead applies Idle under B37. Ask-first
holds retain their Reasons; skipped Agents' Takeovers are untouched.

Release requires a live matching Attempt greater than the reserved Attempt, and
any Door note's acknowledgement to be recorded for that Attempt or an earlier
completed Attempt of the same operation. It rebinds only
pending/held records, retains their B7 ranks, and nudges an already delivery-ready
receiver (idle or B37 live error).
Final Messages are never rebound or revived. A failed restart or recording leaves
its reservation available to the same retry, including after reopening the Daemon.
On reopen, reservations replay from SQLite before reconciliation. Takeovers and
unsent input remain memory-only under B6/B32; their reserved held records wait
until recovery releases them, then become pending in their normal release order.
The coordinator must complete a successful next Attempt with the same key; a
reopen alone never releases a reservation or repeats a prompt.

`record_restart_prompt` records the exact reserved lifecycle text as one delivered
`you`/`note`, without calling Deliver/Steer, changing Iteration or rewriting earlier
Thread records. The reservation and Message id commit atomically. A Touch failure
or injected recording/publication failure can be retried: the existing note and
user's wrote Touch are reused. Successful recording emits normal `message.sent`
and `message.delivered` events once. Like other bus events, these are live signals,
not a durable subscriber log; reopening reads the Thread. The coordinator passes the acknowledged Attempt even if it has since stopped.
Recording this fact needs no live Terminal; queue release does. The lifecycle seam owns
acknowledgement/replay of the already typed prompt, so the coordinator retries
recording rather than sending it with `message.send`.

Affected laws: M1 (no second typing or note), M3 (no Takeover as an internal lock),
M4 (B7 ranks retained), M5 (final records untouched), M6 (no queue loss), M7 (final
ending remains Exit, temporary restart is Busy), M9 (durable reservation/note
replay), M10 (delivery follows coordinator release and fair Idle, including B37
live error). M2's holds stay
unchanged. `model.bend` models the reservation as a schedule projection into the
unchanged delivery transitions and the already-typed prompt as an idempotent
record journal that allocates one delivered id from the shared supply without a
Type effect. Its stored frame replays the reservation bit before interpreting
receiver loss on reopen. `PROOF.bend` checks the projection's safety,
record preservation on reserved stop/reopen, journal idempotence, at-most-once
acknowledgement, final-state disjointness and shared-id conservation. The existing
laws and predicates are unchanged; proofs cover this model, and `a35_` public-seam
and invariant replays tie its guards to Rust.


## A35 later-Agent retirement

This separate in-process operation supplies #808's coordinator. The coordinator
validates user Proof, selects later Agents and obtains Takeover consent. A skipped
Agent is never reserved or removed and keeps its Takeover. This operation supplies
no RPC, consent, lifecycle removal, rewind completion event or Thread action.

```text
reserve_retirement(agent, key)
  → if authorized: takeover.end (ends Takeover, preserves its held records)
  → Agents::retire (stop and remove from Rail; keep Worktree and branch)
  → complete_retirement(agent, key)
```

Reserve before stopping: it waits for in-flight Messages delivery, then atomically
persists the key It changes no existing Message id,
content, status, Reason, rank or ordering, and creates no Takeover. It refuses an
empty key, a missing receiver, stale Attempt or another restart/retirement
reservation. An already stopped later Agent can reserve retirement after reconciling
its ordinary B9 ending; dropped/final records never revive. Same-key retries succeed before or after removal and completion.
Selected retirement immediately makes the receiver ineligible for new sends and
manual delivery, including while still on the Rail. Explicit drop retains
its existing Actor permissions; the operation never drops an archived record automatically.
An authorized `takeover.end` clears its Takeover without promoting held records.
Retirement does not itself end a Takeover; the coordinator must end a selected
Takeover before lifecycle removal. Unsent input cannot mutate retired records.

Stopping Statuses, delayed older Statuses and lag resync still reconcile receiver
generations. The durable retirement selection projects their automatic Exit/Idle/
Restart inputs to Busy and marks the receiver closed; it does not skip resync or
make a missing receiver live. Ordinary final ending still follows B9's Exit:
pending and Takeover-held Messages are dropped as receiver-gone, even if a retained
restart had been reserved. A35 retirement instead retains archived pending/held/
final records in a permanently ineligible receiver. Completed records have no
Terminal and can never be automatically typed by a later event or Attempt.

Completion requires the matching key and absence from the Rail, then durably marks
completion. It needs no SessionStart. Repeating completion is a no-op, and the
completed tombstone keeps the same operation's protection forever. A reservation,
Rail read or completion failure returns its error without releasing prior protection
or another Agent's completed work. Before removal, retry the same key and finish
lifecycle removal; after removal, retry completion. On Daemon reopen, SQLite replays
both states before receiver reconciliation. Neither reopen nor completion releases
archived holds, rebinds records or types pending Messages. Takeover/unsent memory
still vanishes under B6/B32, while archived Takeover-held Reasons remain unchanged.

Affected laws M1–M10: M1/M3 prevent typing and internal Takeover locks; M2/M4 retain
held Reasons and delivery ranks; M5 keeps final records final; M6 conserves every
record; M7 keeps ordinary receiver-gone safety and distinguishes retirement's
ineligible archive; M9 replays selection/completion and records durably; M10 permits delivery only to
eligible receivers. `LAWS.bend` is unchanged: its fair-delivery cycle proves the
ordinary eligible receiver. The retirement refinement proves ineligibility,
completion idempotence, no typing on Idle, refused send/manual delivery, and record
preservation on stop, authorized Takeover end and reopen. Public `a35_` regressions
also cover lag, stale events, lifecycle/coordinator failures and same-key recovery.

#808 must compose these operations with `Agents::retire` in real-Daemon tests,
including `a35_a_later_subagent_leaves_the_rail_and_keeps_its_worktree` and
`a35_messages_todos_pads_and_checkpoints_stay`. This prerequisite leaves #808 open
for full A35/U374 acceptance.

## B6 Door resize actions

Door `terminal.resize` calls during Takeover are stored in the Daemon's Project database before their receipts return. `terminal.resizeHistory` (MCP `terminal_resizeHistory`) exposes the accepting Agent's own receipts; the user sees all receipts for that Terminal, including after it is gone. The receipt's `ResizeOutcome` distinguishes waiting for Takeover, an effect in progress, completion and a drop reason. Direct user resizing retains its null result and remains available during Takeover.

The socket reader registers each authorized resize’s child order with Tokio watch channels before spawning its request, so pipelined frames cannot acquire durable ids in scheduler order. Completed requests release those channels and retire their entries. Release serializes accepted resizes for one child before any later Door resize. Before each physical effect, its in-progress outcome is committed; a crash after that cut never retries it. A restarted Daemon has no surviving Terminals or Takeovers, so unfinished resizes receive a durable drop reason, distinguishing an unavailable original Terminal from an uncertain prior effect. Completed outcomes remain completed. Terminal exit or child Attempt replacement also drops unavailable resizes; later valid resizes proceed.

This is an integration-tested B6 slice for resize only, touching M1, M3, M4, M6, M7, M9 and M10. The Message model in `proofs/messages` still models Messages, not Door resizes; none of its laws or Message exceptions changes. #1581 retains the other action paths and full B6 acceptance.

## B6 Door rename actions

Door `rail.rename` calls during Takeover return a durable `HeldAction`, rather
than the Rail node returned by an executed rename. `agent.actionHistory {id}`
(MCP `agent_actionHistory`) lists the accepting Agent's own actions on that
child; the user can read all of them, including after removal. Receipts retain
method, parameters and the same outcome tags as resize receipts. The MCP tool
keeps that JSON, so a waiting receipt is never described as an executed rename.
The wire reader captures a known Agent process's identity before waiting for
prior calls; claiming the user cannot bypass rename holds or receipt privacy.

Resizes and renames share one append-only acceptance sequence and outcome
ledger. Existing resize history migrates with its ids and outcomes intact;
`terminal.resizeHistory` keeps its existing shape and filters only resizes.
Release preserves their mixed order and checks current Reach before effect.
User renames remain immediate. Child removal or lost Reach drops the rename
with a retained reason and does not block later actions.

No Takeover survives restart. A waiting rename can still name the same
persistent child, so startup releases it. An in-progress rename is never retried:
its retained reason explains that its effect may have happened. Terminal resize
recovery retains the unavailable-original-Terminal rule. A child exit releases
valid renames through the Takeover change observer.

This slice integration-tests M1, M3, M4, M6, M7, M9 and M10. The existing Message
proofs model Messages, not held Door actions; no law or Message transition is
changed. #1581 still owns the remaining action families and full B6 acceptance.

## B6 Door Stop actions

Door `agent.stop` calls during Takeover use the same durable `HeldAction`
receipts, `agent.actionHistory`, per-child arrival order and append-only ledger
as resizes and renames. MCP preserves both waiting receipts and the null result
of an immediate Stop; it never describes acceptance as a completed stop.
Known Agent processes cannot bypass the hold by claiming the user. Direct user
Stop remains immediate.

Release rechecks Reach and the original Attempt before stopping. A Terminal
attaching to that same starting Attempt keeps its waiting Stop valid. During
pending Resume, the old displayed Terminal does not invalidate a Stop of the
resuming Attempt. The Agent checks the ordinal atomically with its Stop claim.
A removed child, an exited Terminal or a replaced Attempt produces a retained
drop reason; later actions still proceed. Stop completion waits for the Agent's
existing exit confirmation. An uncertain effect remains explained by its
recorded reason and is never automatically retried.

No Takeover or Terminal survives restart. A waiting Stop is dropped with the
original-Attempt reason rather than applied to a replacement Attempt. A Stop
recorded in progress is dropped as possibly already applied; a completed Stop
retains its completion. These are integration-tested action guarantees for
M1, M3, M4, M6, M7, M9 and M10. Message proofs and laws are unchanged. #1581
retains the remaining action families and full acceptance.

## B6 Door Interrupt actions

Door `agent.interrupt` calls during Takeover use the same durable `HeldAction`
receipts, `agent.actionHistory`, per-child arrival order and ledger as Stop.
Without a Takeover an Interrupt still runs under the shared child lock, so it
reaches an in-flight Steer; the Takeover check is made under that lock, where
`takeover.begin` cannot interleave. MCP preserves the waiting receipt and tells
the Door that acceptance is not execution.

Release rechecks Reach and claims the Escape only while the original Attempt
still runs, so a replacement Attempt's turn is never interrupted. A removed
child, an exited Terminal or a replaced Attempt gives a retained drop reason and
later actions proceed. A waiting Interrupt does not survive a Daemon restart: it
is dropped with the original-Attempt reason; one recorded in progress is dropped
as possibly applied, and none is retried. These are integration-tested guarantees
for M1, M3, M4, M6, M7, M9 and M10; Message proofs and laws are unchanged. #1581
retains the remaining action families and full acceptance.

## B6 Door prompt actions

Door `agent.prompt` calls during Takeover use the same durable `HeldAction`
receipts, `agent.actionHistory`, per-child arrival order and ledger as Interrupt.
Release rechecks Reach and writes the prompt only while the original Attempt
still runs, checked under the admission lock that claims the Terminal, so a
replacement Attempt never receives it. A prompt that finds the child busy, a
removed child, an exited Terminal or a replaced Attempt gives a retained drop or
failure reason and later actions proceed. A waiting prompt does not survive a
Daemon restart: it is dropped with the original-Attempt reason; one recorded in
progress is dropped as possibly typed, and none is retried. These are
integration-tested guarantees for M1, M3, M4, M6, M7, M9 and M10; Message proofs
and laws are unchanged. #1581 retains the remaining action families (resume,
Terminal writes, rewind, reads) and full acceptance.

## B6 Door Terminal close and kill actions

Door `terminal.close` and `terminal.kill` calls on a taken-over child's Terminal
use the same durable `HeldAction` receipts, `agent.actionHistory`, per-child
arrival order and ledger as resize. Release rechecks that the child still owns
the original Terminal and that it still runs; an exited Terminal, a removed or
replaced child gives a retained drop reason and later actions proceed. A waiting
call does not survive a Daemon restart: it is dropped with the original-Terminal
reason, and none is retried. These are integration-tested guarantees for M1, M3,
M4, M6, M7, M9 and M10; Message proofs and laws are unchanged. #1581 retains
rewind and reads.

## B6 Door Terminal writes

Door `terminal.write` calls on a taken-over child's Terminal use the same durable
`HeldAction` receipts, per-child arrival order and ledger as close and kill. The
bytes and any prompt identity are kept as accepted; release rechecks Reach and
Terminal ownership and writes through the same guarded path, so bytes aimed at a
prompt the user has since answered or replaced are refused and dropped with a
reason. A waiting write does not survive a Daemon restart (dropped with the
original-Terminal reason) and none is retried. The user's own writes are never held.
Integration-tested guarantees for M1, M3, M4, M6, M7, M9 and M10; Message proofs and
laws are unchanged.

## B6 Door Orders

Door `agent.setOrder` calls on a taken-over child use the same durable `HeldAction`
receipts, per-child arrival order and ledger as rename. Nothing is stored and no
Steer is typed while the Takeover lasts; an invalid Order is refused at once.
Release rechecks Reach, stores the Order and Steers the child's current Attempt,
so a replacement Attempt takes it as the child's own. A waiting Order that a
Daemon restart finds is released in order; one recorded in progress is dropped as
possibly applied, and none is retried. An Agent's own Order is never held.
Integration-tested guarantees for M1, M3, M4, M6, M7, M9 and M10; Message proofs and
laws are unchanged.

## Wake (B41 to B45)

Serves P1 and P3. An Agent asks `agent.wake {ids, any?}` to be told when all, or any, of the named Agents finish (`idle`, `done`, `error` or `needs-you`), and ends its turn instead of polling. The request is a row in `wakes` (migration 003 of `crates/messages`, saved in `project.db`), so a Daemon restart keeps it (D6). `rupd`'s `Waker` decides it from the Event log (`Bus::saved_after`, D10) and the present Kinds; a firing deletes the row and inserts the one `[wake]` note from `rupd` in one transaction, so it fires exactly once and is typed as B39 says. The note is outside B1's open bound and B22's caps. A child that enters `error` or `needs-you` always sends its parent a `[digest]` note at once (B43), which replaces B21's push for that change. There is no timer: only Events and the restart replay wake a request. The MCP tool `agent_wake` and `rup agent wake <id>... [--any]` are built from the one command list (I1), and the Brief says to wake instead of poll.


## Reaction firing (NR3, NR8)

A Reaction firing is accepted by `Messages::fire_reaction` in the one transaction that inserts its Message: the check that the Reaction is active with a firing left, the Message, and the `reaction_firings` row (`project.db`, migration 0009) holding the definition bytes and evidence as accepted. A fault before the commit leaves neither; after it, both, with the ids they were given. A retried `operation` returns the first firing and sends nothing. The Message is from the Daemon, outside B1's open bound like a Wake note, and is otherwise an ordinary Message: B2, B6, B32, B39 and B40 decide whether it is pending, Held, delivered or dropped, and recovery starts no program. `reaction.get` shows the firing's `matched` flag and the Message's status as `outcome`; delivery is not verified work. This adds no delivery state, so M1 to M10 and `proofs/messages` stand unchanged.

## B6 Door Resumes

Door `agent.resume` calls on a taken-over child use the same durable `HeldAction`
receipts, per-child arrival order and ledger as Orders. Nothing starts while the
Takeover lasts. Release resumes the child if it has exited, as an exit ends the
Takeover; a child still running makes the Resume invalid, and it is dropped with that
reason. A Resume refused while the exit settles had no effect and is tried again.
A waiting Resume that a Daemon restart finds is released in order; one recorded in
progress is dropped as possibly applied, and none is retried. Integration-tested
guarantees for M1, M3, M4, M6, M7, M9 and M10; Message proofs and laws are unchanged.

## B6 Door Terminal reads

A Door's `terminal.snapshot`, `terminal.screen`, `terminal.read` and `terminal.search`
of a taken-over child's Terminal return nothing until the Takeover ends. A read has
no effect to record, so it holds no receipt: the call waits at the Daemon, then runs
behind the actions released at the end, and a Daemon restart drops the connection.
A begin that races a read is isolated by the child's effect lock. The user's own
reads are never held. Rewind has no Daemon method yet, so there is no call to hold.
Integration-tested for M3 and M4; Message proofs and laws are unchanged.

## Reaction evaluation (NR2, NR4, NR5)

The Daemon decides an Agents Reaction from `agent.status` Events and the Rail's present Kinds, never from a Model or a clock, in the same Kind sense as Wake (B41). It reads the Event head, then the Rail, then replays the Events after the head, and accepts a firing only through `Messages::fire_reaction` with the operation `auto-<n>`, so a crash between acceptance and its saved progress returns the first firing. A repeat-enabled Reaction re-arms only after every named Agent was seen not finished since the last firing. Stop, explicit run and automatic acceptance meet in `fire_reaction`'s one write, which reads the state and the bound. Expired Event history or a failed read records a gap; an Agent with no present state never matches. No delivery state is added, so M1 to M10 stand unchanged.

## Passive coordination measurement

`send_message_with` observes the initiating authenticated Agent only when its existing
`nudge` / `settle_logged` routing future yields Pending. The observation retains the
original Project, Agent, Attempt and Message identity, ending when that call returns
or is cancelled. Pending Message residence and Wake registration supply no blocking
interval. The observer cannot authorize, deliver, hold, drop or retry a Message.

M1–M10 retain their transitions and laws: this adds no Type effect (M1/M3), changes
no queue or retained identity (M4/M5/M6), revives no receiver (M7), changes no
replay (M9), and adds no progress requirement or await (M10). Routes and Held authority
(M2) are unchanged. `proofs/messages` therefore needs no model or law change.


## External result reconciliation (U3078h)

An unknown external effect remains current across later claims, instruction changes
and reopen. A later report or acceptance cannot remove that guard, and retained-byte
or PR checks cannot resolve it. `message.resolveResult` is user-only: the Daemon GETs
the read-only receipt URL the user designates as authoritative, without credentials,
redirects, Model calls or Messages. A response is a `ResultResolution`, for example:

```json
{"target":{"id":"payment","revision":"v1"},"revision":"provider-receipt-37","observed_at":1792540800,"outcome":{"kind":"completed"}}
```

`observed_at` is Unix seconds at the source observation, not an effect timestamp.
The other outcomes are `{"kind":"not-performed"}` and
`{"kind":"inconclusive","cause":"provider still reconciling"}`.
The user command is `rup message resolve-result <project> <id> <report> <source> --json`;
it needs no Agent flag. A vendor child remains an authenticated Agent and is refused,
even when the CLI identifies as the user.

The source must return this declared receipt contract; arbitrary provider responses
are unsupported. Only a fresh, exact-target/version, revision-bearing conclusive
receipt resolves the report. HTTP/parse/read failures, stale or future timestamps,
wrong versions and inconclusive answers append unknown causes and checking actions.
Conclusive observations retain the source, authorizer and receipt in the existing
Message fact holder, readable after restart. Verification can read that retained
resolution without contacting the source again. A later failed read preserves the
historical conclusive evidence. Completion and confirmed non-performance are distinct;
continuation eligibility remains outside this holder.

M1–M10, Message/Route/Held/Takeover transitions and `proofs/messages` stay unchanged:
resolution reads and appends evidence; it neither creates nor delivers a Message.


## Resuming unfinished work (U3078d-h)

`message.reconcileWork` reads and `message.resumeWork` (user only, `rup message resume-work`)
accepts. Both read the retained Result reports; neither starts a program, restarts an Agent
or calls a Model.

An action is a current report whose `next` is not empty, or a resolved not-performed
external effect. Its id hashes the Agent, instruction and order revisions, target and
version, output and next step, so a retry, a fresh client request id, a restart and a
concurrent observer name the same action. A report on an older instruction or version is
history: its acceptance appears as context marked older and verifies nothing about the
replacement. An unresolved unknown-effect report is never an action; the successor lists it
under "never issue again, check the receipt first". Only a user-authorized receipt showing
the exact target and version was not performed makes it an action, and its text tells the
Agent to read the receipt again before issuing the effect.

One decision accepts all its actions at most once ever. `continuation_decisions` and
`continuation_actions` are written in the same transaction as the successor Message
(`Messages::continue_work`, through `send_message_with`), so a fault before the commit
leaves neither and a fault after it leaves both. A retry of the request returns the
original; the same request id with another payload is refused. A reaction run whose
operation is `continue:<action id>` records its firing against the decision's Message, and
an existing firing with that operation is the Message a resume returns.

The successor is an ordinary Note from the Daemon: Takeover, unsent input, busy receiver,
Held/pending/drop, batching and the ended-Agent refusal apply unchanged, so a stopped Agent
refuses with the cause and only the separate `agent.resume` can start it. A successor
delivered as an instruction revision continues the instruction: reports before it stay
current. This guarantees one decision-to-Message identity, never exactly-once external
effects. M1-M10, Routes, Held and Takeover are unchanged; `proofs/messages` needs no change.
