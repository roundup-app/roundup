# Repeated inbox notes

Module: `crates/messages`, with the Claude Adapter in `crates/agents` and Daemon observers in `crates/rupd`. Terms: Message, Actor, Attempt, Adapter, Route (`GLOSSARY.md`). Policy: reuse the existing inbox write, durable store and delivery events; no new RPC, Message status, queue or Terminal transport.

**B5763a repeat comparison uses the peer sender and rendered content.** The reference programs are Claude Code 2.1.302 and 2.1.316 (the npm `latest` version inspected on 2026-11-02). Their distributed Linux binaries contain the same peer admission rule: a map keyed by `from:<peer from address>` (falling back to verified PID only for an unknown address), retaining the last admitted body for each sender. String content is compared by exact equality; non-string content is serialized before comparison. For roundup's string entries this is the entire `<cross-session-message …>` content, including attributes and newlines, not the durable Message body, `msg_id`, authenticated Actor id or Message kind. The Adapter sends every Actor's entries, the user's included, under `from: uds:<socket dir>/rupd`.

The vendor additionally checks elapsed time against a configurable `dedupWindowMs` (default 30 000 ms) and bounds remembered senders (default 256). Policy: the owner's rule deliberately has no expiry or sender eviction for rupd's last entry in a receiving session; it prevents equal consecutive rupd notes even when that vendor window has elapsed. Do not present this stronger policy as the vendor's default duration. Vendor configuration is not changed.

Given a real reference program with its inbox enabled, when the following sequences use distinct `msg_id` values and run within the vendor's repeat window, then the probe records these results:

| Sequence in one receiving session | Result |
| --- | --- |
| rupd content A, rupd content A | First admitted; second shows `Dropped a peer message` with `identical to the previous message from this sender`; no receipt for the second id |
| rupd A, native user prompt, rupd A | Second rupd A still dropped |
| rupd A, another peer's B, rupd A | Second rupd A still dropped; another peer has its own sender key |
| rupd A, different rupd B, rupd A | All three admitted |
| rupd A, same body with a different rendered `from-name` or `from-mode` | Both admitted because whole content differs |

Observer to implement: `b5763a_recorded_peer_repeats_match_the_inbox_rule` in `crates/agents/tests/inbox.rs`. A bounded probe with real Claude Code records sanitized input envelopes, operation order, admitted transcript ids and the actual drop notice under `crates/agents/tests/fixtures/inbox/<version>/` for both reference versions. Record version, package source and checksum, invocation, repeat-window timing and any nondefault guard configuration with each fixture. Keep credentials, peer tokens, personal paths and unrelated transcript content out. Replay the recorded cases through the production rendering/comparison path and compare admitted/suppressed ids, not a test-only copy of the rule. The replay test is offline and starts no vendor process. Policy: fixture capture is an implementation deliverable; binary inspection alone is not that observer. Package sources: [2.1.302](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.302), [2.1.316](https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/2.1.316).

**B5763b the shared inbox write closes repeats once.** Given a delivery-ready receiving Attempt, an `auto` Route and a passing inbox check, when pending notes reach `crates/messages/src/inbox.rs`, `send`, then compare each fully rendered entry with the last entry rupd wrote to that receiving session, including earlier entries in this batch, in actual write order. A different rupd entry of either kind replaces the comparison value; a skipped repeat does not. Native user prompts and other peers do not reset it. All authenticated senders participate, including user-authored notes. Rendering remains inside the Claude Adapter (P4); do not recreate its escaping, question header or one-line cut in `crates/messages`.

A matching note writes no entry. Its existing Message becomes `delivered` with a durable reason containing `repeat` and identifying equality with the last inbox entry; its in-flight record is cleared and exactly one `message.delivered` is emitted. `message.get` preserves its original id, Actor, kind, body and reply identity and exposes that reason. This is an explicit repeat outcome, not an invented transcript receipt. Later idle edges, duplicate receipts and restart emit no second delivery and never retry it. A nonmatching entry still saves its in-flight record before write and remains `pending` until its own B50(c) receipt. Questions keep their distinct reply ids; no two questions are merged or answered by one receipt.

Tests to implement in `crates/rupd/tests/b50_note_inbox.rs`, using the real store and fake inbox through production delivery:

- `b5763b_identical_daemon_digests_write_once`: two accepted Daemon digests with equal rendered entries write one entry; acknowledge the first and assert the second's status, reason, cleared flight and one delivered event. Exercise separate eligible deliveries and adjacent entries queued for one batch. Use the internal digest producer rather than `message.send`'s refusal. Advance the fake clock beyond 30 000 ms in the separate-delivery case to assert roundup's no-expiry policy. Deliver the batch rather than letting Quiet Digest deferral prevent the observer.
- `b5763b_a_different_inbox_entry_breaks_the_repeat`: A/B/A from rupd writes all three and each stays pending until its own receipt. Include a question as B. In a separate pair, equal raw bodies with different rendered names both write. In another pair, long multibyte digests differing only beyond the one-line cut render identically and the second closes as a repeat. A user-authored entry participates in the same last-entry history. Assert writes/status after each operation, zero prompt calls and zero Terminal bytes.
- `b5763b_repeat_delivery_is_final`: after suppression, repeat 30 idle edges, matching/repeated receipt scans and a Daemon reopen; assert unchanged identities/reason and a total of one delivered event for the repeat, with no further entry. The first test's ordinary receipt assertions reject treating every successful socket write as delivered.

Policy: honor existing Route, receiver generation, readiness, first-input admission and inbox availability checks before suppression. Missing/Mismatch and a failed write cannot establish a successfully written last entry or falsely deliver an unrelated pending Message. Persist necessary comparison history across Daemon restart; do not retain an unbounded transcript or infer write order from Message allocation ids. Distinct receiving sessions never share comparison state. Tests: extend `b3563c_unavailable_inbox_keeps_pending_identity_and_reports_the_cause` for unavailable repeat candidates; add session-isolation cases to `b5763b_a_different_inbox_entry_breaks_the_repeat`.

**B5763c a dropped in-flight repeat reaches a final outcome after restart.** Given a durable `pending` note with an in-flight record whose rendered content equals the last entry rupd wrote to the same receiving session, with no receipt for this id, when the Daemon reopens and the receiver next becomes eligible, then it writes nothing for this note, records the B5763b repeat reason, clears its in-flight record and emits one delivered event. This includes an in-flight repeat left by the previous implementation. Recovery uses persisted write evidence, not a last-created Message or a receipt for another id. The existing same-session restart does not erase comparison history; a genuinely new receiving session starts independent history. A Message never written, with no equal predecessor write, remains ordinary pending delivery; no migration can declare delivery just from equal stored bodies.

Test to implement: `b5763c_restart_closes_a_dropped_inflight_repeat` in `crates/rupd/tests/b50_note_inbox.rs`. Seed the real durable store with prior-version in-flight/write evidence for A followed by equal A with a different id, and a fake peer with no receipt for the latter. Reopen the real Message delivery path with that receiving session preserved, run its next eligible event and assert zero new writes, the second id's delivered/repeat outcome, cleared flight and one event. Reopen again and assert no retry or second delivery. Include a pending-before-write control with no matching write, and a new-session control that must write. Extend `b52_a_restart_with_a_sent_note_delivers_it_once` and `b3563c_receipt_and_restart_preserve_each_message_once` only where B5763's note-repeat outcome replaces an old replay expectation; retain question replay and all nonrepeat receipt assertions.

Policy: do not wait for a receipt the peer cannot produce. If legacy storage lacks sufficient evidence, recover it from the existing session/transcript and durable in-flight records; never assume a not-written note was written. The implementing PR documents the recovery evidence used and its test fixture on the work Issue.

**B5763d every producer shares the rule and sender refusal remains audible.** Policy: implement one delivery-time repeat decision at the shared inbox write, with vendor rendering/comparison supplied by the existing Adapter. Producer-specific filters are not a substitute. B51(g)'s authenticated Agent repeat refusal remains: `CONFLICT` reaches the sender before a new Message, event or Touch is allocated. Its existing conservative cross-kind refusal is unchanged; a different sender, body or receiving Attempt continues to pass that acceptance check, with accepted notes subsequently subject to B5763b. User and Daemon entries that bypass this refusal still pass the shared write rule.

Extend `b51_a_note_repeating_the_last_one_is_refused_and_made_no_record` in `crates/rupd/tests/b50_note_inbox.rs` only as needed; keep its all-kind-pairs/non-user-senders coverage and the existing `b51_other_senders_and_a_new_attempt_keep_distinct_messages` question-identity regression. Add `b5763d_all_inbox_producers_share_the_repeat_rule` in that file: exercise the existing producer seams below with a real store and fake inbox, asserting producer-to-shared-write traversal and repeat outcome, not only that two handcrafted entries compare equal.

| Inbox-entry path | Required observer |
| --- | --- |
| `message.send`, user/Agent/Extension/Daemon | Existing B51 refusal test plus `b5763d_all_inbox_producers_share_the_repeat_rule` for accepted entries |
| Eligible-idle delivery hops through `delivery.rs`, `on_idle` | `b5763d_all_inbox_producers_share_the_repeat_rule`, busy-to-idle batch |
| Digest pushes, rollups and merges through `pushes.rs` | `b5763b_identical_daemon_digests_write_once`; producer observer covers rolled/merged rendered entries |
| Wake notes through `crates/messages/src/wake.rs` and `crates/rupd/src/wake.rs` | Producer observer, with wake-request creation/firing and surviving B47 per-child guard |
| Todo hand-offs through `crates/rupd/src/owner_told.rs`, `hand_off` (`Next: #N`) | Producer observer after the existing hand-off trigger |
| Rail rename notes through `crates/rupd/src/wake.rs` | Producer observer after actual committed rename; unchanged/rejected rename creates none |
| B8/B40/B52 restart rewrites | `b5763c_restart_closes_a_dropped_inflight_repeat` and existing nonrepeat/question restart observers |

Policy: the implementing PR lists each path and its actual test function, reusing assertions where one test proves multiple rows. Quiet Digest deferral and B47's producer guard still apply; arrange eligible inputs so those do not mask the shared-write observer. No duplicate queue or change to Todo selection, rename semantics or wake authorization is ordered.

## Amendments and gates

Policy: these clauses amend B8/B39/B40/B50(c)/B51(g)/B52(b) in `scenarios/messages.md` only for the explicit delivered/repeat outcome. A new entry's socket success still cannot confirm delivery. B51(g)'s pending-repeat retry sentence yields to B5763b–c for notes, so a peer-dropped note does not wait forever. B22 caps, B47 producer guards and B2704a rename semantics remain. No question loses reply identity.

Policy: applicable gates are P1/P11 (zero Message writes to Terminal), P3 (no routine attention), P4 (vendor rendering stays in the Adapter; no fourth `AgentAdapter` seam), P7 (original Messages remain readable) and P9/P10 (no new prompt or turn, batching retained). Observers are the real-store tests above, counting entries, prompt calls, Terminal bytes, records and events after each completed operation, plus the offline vendor-fixture replay. No UI Check moves.

Policy: the implementation names M1 (at-most-once delivery), M4 (write order), M5 (ids/final states), M6 (conservation), M9 (restart) and M10 (eligible progress) from `scenarios/proofs.md`, keeps `docs/messages.md` and `proofs/messages` agreeing and runs `just proofs`; no law is weakened. Proofs check the models; the real-store/vendor observers establish Rust delivery and peer behavior.

## Checks on origin/main

1. `crates/messages/src/inbox.rs`, `send`, is the shared entry builder/write caller; `crates/messages/src/delivery.rs`, `on_idle`, supplies eligible batches. `crates/agents/src/claude_code/inbox.rs`, `Launcher::inbox_write`, holds the actual envelope, escaping, cut and single rupd sender address.
2. `crates/rupd/tests/b50_note_inbox.rs`, `b51_a_note_repeating_the_last_one_is_refused_and_made_no_record`, holds the existing sender refusal; `b51_other_senders_and_a_new_attempt_keep_distinct_messages` holds accepted question identities across sender/Attempt changes.
3. `crates/rupd/tests/b50_note_inbox.rs`, `b50_a_note_is_delivered_when_the_transcript_records_it`, `b3563c_receipt_and_restart_preserve_each_message_once` and `b3563c_unavailable_inbox_keeps_pending_identity_and_reports_the_cause`, hold receipt, restart and failed-check regressions. `crates/agents/tests/inbox.rs`, `b50_the_transcript_records_a_note_as_a_peer_message_under_its_msg_id`, holds receipt parsing against existing fixtures.
4. `crates/messages/src/tests/b_push_tests.rs`, `b22_after_a_burst_of_100_changes_every_change_is_counted_once`, holds digest conservation. `scenarios/messages.md`, **B47 a status flip makes no note, and the same agent and kind twice in a row is one note** and **B2704a an Agent learns each Rail rename once**, hold the separate producer constraints.
5. `PRINCIPLES.md`, **P4 Black-box harness**, holds the Adapter boundary. `crates/agents/Cargo.toml` and `crates/messages/Cargo.toml`, `[dependencies]`, provide Serde and the existing SQLite store; implementation researches reuse before adding any rule-9 machinery.

## Implementation verification

On a prepared checkout, run the changed Daemon test file and the offline Adapter fixture replay, followed by the proof observer:

```sh
cargo nextest run -p rupd --test b50_note_inbox
cargo nextest run -p agents --test inbox b5763a_
just proofs
```

Policy: each command exits zero; bound the combined targeted test run to five minutes on the prepared checkout. The real-vendor capture is a separate bounded observation; offline tests do not require credentials or a network. Run `just ready` before pushing. Name each added observer's rejected mutation (raw-body comparison, Actor-keyed history, batch-history omission, restart-history loss, receipt bypass for nonrepeats or duplicate delivered event) beside its test. An implementation that cannot observe a vendor drop records the exact probe failure on the Issue and repairs the observer; it does not fabricate a fixture.
