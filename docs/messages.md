# Messages between Actors

Design for `scenarios/messages.md` (B1–B18, B39/B40 and B50–B52) Serves `PRINCIPLES.md` P1, P3, P4, P9, P10 and P11 (the ids in `PRINCIPLES.md`, not `pads.md`'s). Terms are in `GLOSSARY.md`; the one new word is "digest" (the type `Digest`, `agent.digest`, the tool `agent_digest`), the user's choice, defined in `GLOSSARY.md`.

## Existing delivery seams

`crates/messages` owns the durable Message store, Routes and escalation chain.
`crates/rupd` wires delivery to Agents, and `crates/rup` exposes the existing RPC/MCP calls.
The Adapter input seam supplies user prompt typing and cross-session inbox delivery;
B50–B52 specify the sender-based selection and receipt rules. These changes reuse
those seams rather than adding a queue or another Adapter seam.

## Status of a Message

| Status | Meaning | Leaves it by |
|---|---|---|
| `pending` | awaits transport and receipt when the current Attempt is delivery-ready (`idle` or B37's live `error`), or while its inbox check fails | acknowledged (`delivered`), `message.drop`, or the receiver exits (`dropped`) |
| `delivered` | receipt acknowledged by the Agent on the selected transport, or stored for the user (B10/B15) | final |
| `dropped` | ended without delivery, with a reason | final |

Default Route is `auto`. Pending Messages are delivered in B7 order. Delivery acknowledgement follows the selected transport (B39/B40, B50–B52): user prompts use `UserPromptSubmit`; non-user inbox Messages use the transcript receipt for `msg_id`. Successful writing alone is not delivery. A prompt id line cannot acknowledge an inbox Message or block a prompt that names one. An unacknowledged id may be retried after restart, without another delivered transition or escalation chain. `blocked` is unchanged: this series gives Routes no say in Kind (`GLOSSARY.md`, "Who decides Kind").

## B50 to B52: authenticated sender selects transport

For an Agent receiver, both `note` and `question` use this table; authenticated identity, never a caller-supplied sender or body, selects the row:

| Sender | Transport | Receipt |
| --- | --- | --- |
| User | Existing `Agents::prompt` user-input path, B2/B30 batching | `UserPromptSubmit`, B39/B40 |
| Agent, Extension, Daemon | Existing Adapter cross-session inbox only | Transcript `msg_id`, B50–B52 |

Messages addressed to the user have no Agent inbox: B10 stores direct Messages and B15 stores the final Escalated question. No non-user Message reaches `Agents::prompt` or a Terminal fallback, including questions, generated hops, retries and explicit user delivery. Reuse the existing Adapter, store and escalation chain; no replacement queue or conversion of question to note.

The Adapter owns socket authentication, protocol checking, envelope and receiving Attempt permission mode. An inbox question remains a durable `question` with its original sender, body, id, `replyTo` and `passedFrom`. The Adapter prefixes question content with `[question, replyTo: <id>]`; notes keep their existing content. This identifies the kind and the id to answer; transport metadata does not rewrite the stored body. Questions never enter note folding or note queue-bound exemptions, even when their authored body starts with `[digest]` or `[wake]`. Receipt resolves the same Message id through the existing transcript mechanism. The in-flight record precedes the socket write, and the Message stays pending until receipt. Repeated idle edges skip an in-flight id in this Daemon run. After restart an unacknowledged id may be resent with the same `msg_id`; this is a transport retry, not a second Message, answer or hop. An acknowledged id is never resent and emits the delivered event once.

Missing or Mismatch leaves either non-user kind `pending`, exposes the existing Rail fact and emits no false delivery. Mismatch returns `INBOX_UNAVAILABLE` after storing the pending Message; Missing retains the existing send response. A passing check at eligible idle or Attempt start delivers pending Messages in order. No path bypasses the inbox or selects another transport.

The vendor suppresses consecutive equal sender/text entries within a receiving Attempt. B51(g) conservatively refuses equal authenticated sender/body against the latest pending/delivered non-user Message in B7 delivery-rank order across both kinds, before allocating a Message or chain id. Tests cover all four ordered kind pairs and all non-user senders; another sender/body, an intervening entry or a new receiving Attempt remains accepted. A repeated same id is a B52 retry. Adapter fixtures for 2.1.300 and 2.1.302 pin the envelope and full question content; the Daemon fake peer suppresses repeated `msg_id` values and consecutive equal sender/content envelopes. The question header includes its distinct id, but does not relax the sender/body refusal. Recovery and manual release can deliver older ids after newer ids; the repeat boundary follows that release order, never allocation id. A refused new hop follows B16's unable-to-take skip. Distinct accepted questions keep distinct Message and chain ids.

### Escalation

B13–B17's chain is frozen at send: initial receiver, nearest ancestors in its Workstream, Door when present, then the user; skip the origin, never revisit or cross Workstreams. Every non-user Agent hop uses the inbox with the original authenticated sender and kind `question`; `passedFrom` identifies the previous hop. Each hop's 60 000 ms bound applies while pending or delivered, It starts when the hop is first eligible for delivery, not at receipt. Receiver ending, Drop and other B16 unable-to-take cases skip immediately. Only an authorized note from the current delivered hop, addressed to the origin with that hop's `replyTo`, stops advancement. Earlier-hop answers, pending-hop answers and answers after escalation do not. The final Escalated user Message is stored `delivered`, made once, changes no Kind and raises no Decision or alert. B18 permission Decisions remain outside this chain.

### Model interpretation and observers

The existing `Type(id)` effect denotes the selected delivery transport; for non-user Messages it is an inbox effect, not Terminal typing. Missing/Mismatch leaves the Message pending, outside `step`. The pure model's atomic delivery abstraction does not establish Rust's in-flight, transcript or vendor repeat behavior. The sender/kind routing, receipt and escalation observers exercise the Rust path independently of the model. The separate model-correspondence finding remains separate work.

Affected laws: M1 (delivery/receipt and same-id retry), M4 (delivery order), M5 (unique ids and final states), M6 (no silent loss), M7 (receiver ending), M8 (bounded escalation and current-hop answer), M9 (restart replay), M10 (eligible-idle progress). No law may be weakened. The implementing Contract PR updates every changed interface's callers together and keeps the model and this interpretation agreeing. `just proofs` must print `ALL PROOFS CHECK`; it proves models, not Rust wiring.

B50's sender/kind table exercises actual Daemon delivery, inbox entries, `Agents::prompt` calls and Terminal writes. B13–B17 replay the chain through inbox questions with a fake clock. B51 covers failure, explicit delivery and the tested repeat boundary. B52 counts entries per id, receipts and events over 30 idle edges and the three restart states (pending, in flight, acknowledged). Assertions run after each completed operation/handshake. Every regression names its clause and rejected mutation, including the Note-only transport gate and missing current-hop validation. Existing note regressions remain unless a named surviving test rejects the same break.

Gates and observers: P1/P11 require zero Message writes to Terminal input, so native input is not overwritten; P3 requires no Decision/alert from ordinary Messages or escalation; P4 keeps vendor handling in the Adapter; P9/P10 require authorized delivery with user prompt batching retained and zero non-user prompt calls. These are behavior observers, not new App visuals.

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
| Route `auto` or `drop` | `Send` makes the Message pending or drops it respectively; readiness bypasses neither Route. `UserDrop` drops a `pending` Message the user sent that has no in-flight record: it leaves the queue as `dropped` (reason `removed`) and nothing is typed (U3782). |
| Current Attempt is not ready, or typing is refused as `Busy` | `Busy`: no Type effect; keep the batch pending. Rust undoes its pre-typing delivery record on refusal; the model's atomic record-and-Type step represents only accepted typing. A newer readiness revision supplies `Idle` again, including when its handler ran before the Busy completion: Rust re-reads authoritative readiness after rollback and retries only at a strictly newer revision of the same Attempt. An unchanged revision does not retry. |
| Current Attempt actually ends, even with last Kind `error`; Kind `done`; or receiver is removed | `Exit`: drop pending Messages as receiver-gone in id order and refuse later sends. A later `Idle` cannot clear `gone`. |
| Observation belongs to an older Attempt or a stale Status revision | No model event for the current receiver: neither `Idle` nor `Exit`. An older `StopFailure` cannot reopen an exited receiver or close a resumed Attempt. |

A resumed Attempt has a new receiver generation; its predecessor's final Messages
stay final (B36). Bus-lag reconciliation and fresh send/release scheduling use the
same current-Attempt facts, never the last Kind alone. A35's explicit reservation
projections below still apply after this lifecycle classification.

M1 retains the conditional record/at-most-once typing boundary; M4 retains queue
ranks; M6 retains every pending record on live
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
Decision-note and real-Claude observer acceptance; this alignment does not close
it. V4's existing pure transition correspondence remains unchanged; V7 must also
check the lifecycle projection against those seams.

## Modules

| Module | Change |
|---|---|
| `crates/contracts` | `Message` (with `passedFrom`), `MessageKind`, `MessageStatus` (`pending`, `delivered`, `dropped`), `Route`, `Delivery` (moved out of `contracts/hooks.ts`, which imports it); methods `message.send`, `message.pass`, `message.get`, `message.list`, `message.drop`, `route.set`, `route.list`; events `message.sent`, delivered and dropped events, `route.changed`; `generated/` is regenerated, never edited |
| `crates/messages` (new) | stores Messages and Routes in `messages.db` of the Project data folder (N1, ADR 0004), listens to `agent.status` on the bus, and delivers through the existing Adapter inbox or `Agents::prompt` according to authenticated sender |
| `crates/agents` | the existing Adapter input seam handles inbox delivery for non-user Messages and `Agents::prompt` for user text; no fourth seam (P4) |
| `crates/rupd` | registers the module |
| `crates/rup` | MCP tools `message_send`, `message_get`, `message_list`, `message_pass` (B12) |
| `crates/provenance` | none: `item` is a free string, `message:<id>` joins `todo:` and `pad:` (B11) |

Bounds, from the codes `rpc::code` already has: 32 `pending` Messages per receiver (pushed digests have their own bound of 20, B22) and 8192 bytes of body (`CONFLICT` and `INVALID_PARAMS`). No new error code.

## The gates

- **P1.** No new path makes the user address an Agent instead of the Thread, or makes an Agent reachable only through the Thread. Messages reach an Agent only through its inbox, never Terminal input, so the user can still type to any Agent.
- **P3.** Nothing here interrupts the user. A Message to the user is stored, changes no Kind and carries no signal beyond the event (B10). The Inbox UI is not in this series; when it inks a badge for Messages to the user it must answer this gate itself.
- **P4.** The `messages` crate reads no vendor string; typing goes through the Adapter seam that exists.

## Escalation

Serves P1 and P3. P1: the user can still address any Agent, and a question never reaches the user through an Agent that owns the Thread's place. P3: the Escalated question is a stored Message, with no signal beyond the event, and a permission Card skips the chain, so only a valid Card interrupts. Added contract: `message.pass`, and `passedFrom` on `Message`; the clock is injected, as B14's fake clock needs. A Door's hop uses the Door's own Agent, so nothing here adds a seam.

## Child digests

Serves P1, P3 and P4. P3: pushes go to a Door as `note` Messages, never to the user, and change no Kind. P1: a Door learns its children through a tool and Messages, so nothing makes the user address the Thread through it. P4: the envelope reads Status labels, Messages, Todos and Pads, never Terminal output or a vendor string. P7: a merge names the two Messages it folds and drops them with the reason `merged`, so `message.get` still opens them. Added contract: `agent.digest`, the type `Digest` and the `Reason` `merged`; the MCP tool `agent_digest` is offered to Doors only. Tool set per kind of Agent, for this PR alone: M1's tools and B12's four for every Agent, plus `agent_digest` for a Door. The numbers in B19 to B22 (512 bytes, 20 children, 8 pushes per minute, 20 pending, 4096 bytes) are starting values: the Builder measures them, and a later PR may change them. The composer is `crates/messages`, which listens to `agent.status` and the Todo and Pad events; it reads no new input.

## Contract timing

The contract is not a separate PR: types and methods with no caller would be unused exports (`AGENTS.md` rule 2). It lands with the first Builder PR below, as A16's did, and rule 4 applies to that PR: the review run's approve covers it. `docs/extension-interface.md` now says `to: Actor`; Group fan-out and the `bus.route` Hook are not in this series.

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
prompts to finish. It persists in `messages.db` and holds no Message by a new Reason. A conflicting key, changed first prompt or a missing
receiver is refused. An already stopped retained Agent can reserve its next
Attempt; its ordinary B9 ending is reconciled first, and no final Message revives. The reserved first prompt is allowed only for a Door.
There is one active reservation per retained Agent, and a completed-key tombstone
makes repeats no-ops. No caller changes outside Messages are needed until #808
uses these operations; that Issue remains open for full A35/U374 acceptance.

A reservation keeps the logical Message receiver alive while its Terminal is
replaced. Stop/error, next Attempt, delayed earlier Statuses, lag resync and Daemon
reopen preserve pending records and never type them. In the pure model,
`restart_event` projects these temporary Exit/Idle/Restart inputs to Busy; entering
the window first applies Busy. Final receiver removal without an explicit retirement reservation bypasses this
projection, ends the restart reservation and follows B9. Outside a reservation,
actual ending applies Exit and drops pending Messages; a live
StopFailure instead applies Idle under B37.
Question bounds pause while their receiver is reserved and restart on release;
an explicit `message.pass` remains the Actor's choice.

Release requires a live matching Attempt greater than the reserved Attempt, and
any Door note's acknowledgement to be recorded for that Attempt or an earlier
completed Attempt of the same operation. It rebinds only
pending records, retains their B7 ranks, and nudges an already delivery-ready
receiver (idle or B37 live error).
Final Messages are never rebound or revived. A failed restart or recording leaves
its reservation available to the same retry, including after reopening the Daemon.
On reopen, reservations replay from SQLite before reconciliation.
The coordinator must complete a successful next Attempt with the same key; a
reopen alone never releases a reservation or repeats a prompt.

`record_restart_prompt` records the exact reserved lifecycle text as one delivered
`you`/`note`, without calling Deliver/Steer, changing Iteration or rewriting earlier
Thread records. The reservation and Message id commit atomically. A Touch failure
or injected recording/publication failure can be retried: the existing note and
user's wrote Touch are reused. Successful recording emits normal `message.sent`
and delivered events once. Like other bus events, these are live signals,
not a durable subscriber log; reopening reads the Thread. The coordinator passes the acknowledged Attempt even if it has since stopped.
Recording this fact needs no live Terminal; queue release does. The lifecycle seam owns
acknowledgement/replay of the already typed prompt, so the coordinator retries
recording rather than sending it with `message.send`.

Affected laws: M1 (no second typing or note), M4 (B7 ranks retained), M5 (final records untouched), M6 (no queue loss), M7 (final
ending remains Exit, temporary restart is Busy), M9 (durable reservation/note
replay), M10 (delivery follows coordinator release and fair Idle, including B37
live error). M8's bound fairness additionally requires completion of the explicit
restart. `model.bend` models the reservation as a schedule projection into the
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
validates user Proof and selects later Agents. A skipped
Agent is never reserved or removed. This operation supplies
no RPC, consent, lifecycle removal, rewind completion event or Thread action.

```text
reserve_retirement(agent, key)
  → Agents::retire (stop and remove from Rail; keep Worktree and branch)
  → complete_retirement(agent, key)
```

Reserve before stopping: it waits for in-flight Messages delivery, then atomically
persists the key and pauses question bounds. It changes no existing Message id,
content, status, Reason, rank or ordering. It refuses an
empty key, a missing receiver, stale Attempt or another restart/retirement
reservation. An already stopped later Agent can reserve retirement after reconciling
its ordinary B9 ending; dropped/final records never revive. Same-key retries succeed before or after removal and completion.
Selected retirement immediately makes the receiver ineligible for new sends and
manual delivery, including while still on the Rail. Explicit drop/pass retain
their existing Actor permissions; the operation never drops or passes an archived record automatically.

Stopping Statuses, delayed older Statuses and lag resync still reconcile receiver
generations. The durable retirement selection projects their automatic Exit/Idle/
Restart inputs to Busy and marks the receiver closed; it does not skip resync or
make a missing receiver live. Ordinary final ending still follows B9's Exit:
pending Messages are dropped as receiver-gone, even if a retained
restart had been reserved. A35 retirement instead retains archived pending and
final records in a permanently ineligible receiver. Completed records have no
Terminal and can never be automatically typed by a later event or Attempt.

Completion requires the matching key and absence from the Rail, then durably marks
completion. It needs no SessionStart. Repeating completion is a no-op, and the
completed tombstone keeps the same operation's protection forever. A reservation,
Rail read or completion failure returns its error without releasing prior protection
or another Agent's completed work. Before removal, retry the same key and finish
lifecycle removal; after removal, retry completion. On Daemon reopen, SQLite replays
both states before receiver reconciliation. Neither reopen nor completion rebinds records or types pending Messages.

Affected laws M1 and M4–M10: M1 prevents typing; M4 retains
delivery ranks; M5 keeps final records final; M6 conserves every
record; M7 keeps ordinary receiver-gone safety and distinguishes retirement's
ineligible archive; M8 pauses automatic hop bounds for this selected receiver;
M9 replays selection/completion and records durably; M10 permits delivery only to
eligible receivers. `LAWS.bend` is unchanged: its fair-delivery cycle proves the
ordinary eligible receiver. The retirement refinement proves ineligibility,
completion idempotence, no typing on Idle, refused send/manual delivery, and record
preservation on stop and reopen. Public `a35_` regressions
also cover lag, stale events, lifecycle/coordinator failures and same-key recovery.

#808 must compose these operations with `Agents::retire` in real-Daemon tests,
including `a35_a_later_subagent_leaves_the_rail_and_keeps_its_worktree` and
`a35_messages_todos_pads_and_checkpoints_stay`. This prerequisite leaves #808 open
for full A35/U374 acceptance.

## Wake (B41 to B45)

Serves P1 and P3. An Agent asks `agent.wake {ids, any?}` to be told when all, or any, of the named Agents finish (`idle`, `done`, `error` or `needs-you`), and ends its turn instead of polling. The request is a row in `wakes` (migration 003 of `crates/messages`, saved in `project.db`), so a Daemon restart keeps it (D6). `rupd`'s `Waker` decides it from the Event log (`Bus::saved_after`, D10) and the present Kinds; a firing deletes the row and inserts the one `[wake]` note from `rupd` in one transaction, so it fires exactly once and is typed as B39 says. The note is outside B1's open bound and B22's caps. A child that enters `error` or `needs-you` always sends its parent a `[digest]` note at once (B43), which replaces B21's push for that change. There is no timer: only Events and the restart replay wake a request. The MCP tool `agent_wake` and `rup agent wake <id>... [--any]` are built from the one command list (I1), and the Brief says to wake instead of poll.


## Reaction firing (NR3, NR8)

A Reaction firing is accepted by `Messages::fire_reaction` in the one transaction that inserts its Message: the check that the Reaction is active with a firing left, the Message, and the `reaction_firings` row (`project.db`, migration 0009) holding the definition bytes and evidence as accepted. A fault before the commit leaves neither; after it, both, with the ids they were given. A retried `operation` returns the first firing and sends nothing. The Message is from the Daemon, outside B1's open bound like a Wake note, and is otherwise an ordinary Message: B2, B39 and B40 decide whether it is pending, delivered or dropped, and recovery starts no program. `reaction.get` shows the firing's `matched` flag and the Message's status as `outcome`; delivery is not verified work. This adds no delivery state, so M1 and M4 to M10 and `proofs/messages` stand unchanged.

## Reaction evaluation (NR2, NR4, NR5)

The Daemon decides an Agents Reaction from `agent.status` Events and the Rail's present Kinds, never from a Model or a clock, in the same Kind sense as Wake (B41). It reads the Event head, then the Rail, then replays the Events after the head, and accepts a firing only through `Messages::fire_reaction` with the operation `auto-<n>`, so a crash between acceptance and its saved progress returns the first firing. A repeat-enabled Reaction re-arms only after every named Agent was seen not finished since the last firing. Stop, explicit run and automatic acceptance meet in `fire_reaction`'s one write, which reads the state and the bound. Expired Event history or a failed read records a gap; an Agent with no present state never matches. No delivery state is added, so M1 and M4 to M10 stand unchanged.

## Passive coordination measurement

`send_message_with` observes the initiating authenticated Agent only when its existing
`nudge` / `settle_logged` routing future yields Pending. The observation retains the
original Project, Agent, Attempt and Message identity, ending when that call returns
or is cancelled. Pending Message residence and Wake registration supply no blocking
interval. The observer cannot authorize, deliver, drop or retry a Message.

M1 and M4–M10 retain their transitions and laws: this adds no Type effect (M1), changes
no queue or retained identity (M4/M5/M6), revives no receiver (M7), changes no hop
(M8/M9), and adds no progress requirement or await (M10). Routes are unchanged.
`proofs/messages` therefore needs no model or law change.


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

M1, M4–M10, Message/Route transitions and `proofs/messages` stay unchanged:
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

The successor is an ordinary Note from the Daemon: busy receiver, pending/drop, batching
and the ended-Agent refusal apply unchanged, so a stopped Agent
refuses with the cause and only the separate `agent.resume` can start it. A successor
delivered as an instruction revision continues the instruction: reports before it stay
current. This guarantees one decision-to-Message identity, never exactly-once external
effects. M1, M4–M10 and Routes are unchanged; `proofs/messages` needs no change.
