# State: draft revisions, pending Messages and live Worktrees

Module: `apps/desktop/src/state`. Work order: #5643. This specifies internal
ownership and work counts; it changes no consumer interface, RPC, storage schema,
user action or rendered surface. The three existing state interfaces remain the
test seams. New observers below are planned additions to the named existing test
files, not claims of implementation.

## Policy and gates

Policy: use Solid's installed reactive ownership, the installed validated storage
and the existing App clock. Add no store library, custom clock, parallel state
owner or public instrumentation interface. Keep recovery state, pending revisions,
loaded/failed state and late-reply guards: these record ownership and progress.
Full validation and JSON serialization at actual persistence remain required.
Remove earlier deep draft snapshot copies, historical Message payload retention,
recipient read-time filtering/sorting and poll-time Rail identity scans/strings.

P11 gate: can sharing queued draft references alter exact text, caret, original
Project/object/recipient, submitted revision or recovery after an older reply or
failed save; consume unacknowledged work; send restored work; persist credentials;
or hide retention failure? Observers: U5643a below and checks 1–2. Every answer
must be no. P1/P9 gate: can a read, restore, event fold or poll send a Message,
write Terminal input or start/prompt an Agent? Observe the existing fake App's call
log in the new tests and the retained zero-send storage/reference-fold observers;
only the existing list/status/drop calls explicitly exercised are authorized.

Policy: this state-only change moves no visual Check and orders no motion or
capture. It preserves the existing visible failure and Worktree facts; no UI
consumer changes are required. Scope is `storage.ts`, `noteQueue.ts`, `worktrees.ts`
and the five test files in the command below. Target implementation size is
650–800 changed lines; acceptance, rather than padding to that range, decides done.

## Checks on main

These numbered references exist on `origin/main`; they identify regression
observers and current holders, not evidence that the new work-count clauses pass.

1. `apps/desktop/src/state/storage.ts`, `draftStorage`; `apps/desktop/src/state/u2773_storage.test.ts`, `u2773a_storage_restores_exact_work`, `u2773a_storage_restoration_writes_nothing`, `u2773b_storage_settlement_preserves_other_revisions_%s`, `u2773b_storage_late_out_of_order_replies_keep_original_project`, `u2773b_storage_discard_consumes_only_selected_revision`, `u2773b_storage_pending_reopens_as_unknown_without_resubmission`, `u2773e_storage_retry_merges_external_records_without_reviving_discard`, `u2773e_storage_failure_keeps_memory_at_utf8_bound` and `u2773e_credentials_keep_existing_policy`: exact values/selection, defensive reads, revision ownership, restoration, recovery, capacity and secret policy. Retain the remaining invalid/unreadable/incompatible and shared-Project cases in that file too.
2. `apps/desktop/src/state/u3787f_storage.test.ts`, `u3787f_store_acknowledgement_waits_for_commit_and_retry_keeps_newer_memory` and `u3787f_retry_never_rebases_an_older_write`: native commit acknowledgement, serialized writes and recovery without replacing newer memory/disk.
3. `apps/desktop/src/state/noteQueue.ts`, `createNoteQueue`; `apps/desktop/src/state/z3802g_note_queue.test.ts`, `z3802g_note_events_match_reference_fold`; `scenarios/rust-libraries.md`, **Z3802g one parser and one reducer gain generated properties**: latest event per id, recipient changes, repeated events, every status transition, ascending id order and zero unsolicited calls.
4. `apps/desktop/src/state/p3557c_failure_lifetime_note_queue_state.test.ts`, `p3557c_failure_lifetime_note_queue_state`; `scenarios/pads.md`, **P3557c item failure lifetime throughout the App**: distinct failure identities, explicit dismissal, per-Message recovery and independent list failure/retry.
5. `apps/desktop/src/state/worktrees.ts`, `createWorktreeState`; `apps/desktop/src/state/u2556_worktree.test.ts`, `u2556d_both_views_share_facts_and_identity`, `u2556b_late_results_do_not_cross_identity: $change / $request / $outcome`, `u2556b_reopening_does_not_reuse_the_previous_owners_reply: %s`, `u2556b_failure_is_contained_and_the_next_tick_recovers`, `u2556b_opening_near_a_tick_does_not_add_a_poll` and `s3806b_refresh_refuses_an_unavailable_entry: %s`: shared facts, visibility/lifetime, identity replacement, stale success/failure replies, recovery and polling cadence. `scenarios/ui-worktree-status.md`, **U2556b optional enrichment stays off interaction paths** and **U2556d the Worktree view and Rail agree** retain their behavioral contracts.

## Acceptance

**U5643a queued saves own immutable draft records.** Given 100 ordinary drafts
with distinct destinations and identifiable Unicode payloads, when one draft is
edited while persistence is held before execution, then enqueueing copies none
of the other 99 payloads. The queued membership contains references to immutable
records; editing replaces the selected draft without deep-copying the retained
set. Assert payload-copy counts in planned
`u5643a_edit_copies_no_unrelated_payloads` in `u2773_storage.test.ts`. Measure the
synchronous edit/enqueue phase separately from subsequent validation, persistence
serialization and explicit caller reads; do not waive serialization or count a
shallow membership-array copy as a payload copy.

Given a queued save whose records have not yet been serialized, when selection,
submit status or failed/unknown settlement changes a retained revision, then each
operation replaces its record and leaves that queued save's exact value,
selection and status unchanged. Later queued saves contain the later records in
order. Assert the values actually handed to storage, with controlled save
completion, in planned parameterized
`u5643a_queued_records_survive_later_changes_%s` in `u3787f_storage.test.ts`.
Retain its existing failed-save/newer-memory observer and check 1's successful
acknowledgement, late failure, selected discard and credential observers; these
remain the proof of their existing clauses rather than duplicate tests. Policy:
input and returned-value mutation must not mutate retained records; preserve the
existing consumer contract and its defensive-read proof.

**U5643b pending Messages are owned by recipient.** Given pending Messages for
at least two recipients, when sent/delivered/dropped events move or remove an id,
then each recipient's rows equal the latest-event fold in ascending id order,
without duplicate ids or an old-recipient row. Check 3's generated observer
continues to assert this after every event. Policy: maintain sorted pending
records per recipient and an id lookup for moves/removals; do not clone the whole
historical Message map per event or filter/sort a global collection at read time.

Given 1000 distinct past Message bodies, split between delivered and dropped,
plus pending rows for two recipients, when all transitions have been folded,
then queue-owned state retains no delivered/dropped Message payload, including
body copies nested in any index. Compact observed-id metadata may remain to
protect list/event precedence; it contains no historical body. Assert retained
payload counts through test-local instrumentation of production-owned
collections in planned `u5643b_settled_messages_release_payloads` in
`z3802g_note_queue.test.ts`; do not depend on garbage-collector timing or count
the fake App/event fixture's own references as queue ownership.

Given that populated queue, when repeatedly reading one recipient, then reads
inspect no other recipient's pending records and no historical records and
perform no filtering or sorting. Assert production traversal/sort call counts
alongside the returned rows in planned
`u5643b_recipient_reads_touch_only_its_pending_rows` in the same file. A spy that
only counts RPCs does not assert this clause.

Given `message.list` held pending for either recipient, when events arrive before
its reply, then the eventual list never replaces an event-observed id's newer
body, recipient or status, nor resurrects a delivered/dropped id. Exercise a move
between recipients, repeated events, all three statuses, overlapping recipient
loads, and another load started after the event. Assert results after each event
and list completion in planned parameterized
`u5643b_events_outrank_lists_%s` in `z3802g_note_queue.test.ts`. List-only pending
rows still appear in id order; list-only delivered/dropped bodies are not retained
(include them in the retained-payload observer above). Check 4 continues to prove
failure identities, retry and dismissal. Policy: loaded/failed state is retained,
not inferred from whether a recipient currently has pending rows.

**U5643c Worktree ticks poll live entries without Rail reconciliation.** Given
a visible watched Project with Worktree and non-Worktree Rail nodes, when the
existing clock advances with unchanged membership/identity, then due live entries
are polled on the existing cadence with zero Rail membership reconciliations,
zero Rail identity scans/serializations and no per-read Rail lookup. Repeated
`read`/`refresh` calls likewise use the live entry lookup. Assert Rail traversal,
identity-field access/serialization and RPC call counts in planned
`u5643c_unchanged_ticks_do_not_reconcile_rail` in `u2556_worktree.test.ts`. Observe
the production work, not merely whether a named helper was called.

Given those live entries, when a node's id, Worktree presence, path, branch or
Base changes, then reconcile the changed membership/identity once independently
of the clock; dispose removed/replaced entries and create each new entry once.
An unrelated Rail name/Status change preserves existing entry/resource identity
and starts no extra status request. Assert reconciliation and RPC counts plus
unchanged/new facts in planned parameterized
`u5643c_relevant_rail_changes_reconcile_once_%s` in `u2556_worktree.test.ts`.
Policy: compare identity fields without repeatedly building JSON identity strings
or searching the Rail once per entry. Check 5's existing tests remain the
observers for visibility, Project/owner removal, identity changes, stale replies,
Daemon exit, shared consumers and near-tick behavior; the optimization changes
none of their outcomes.

## Verification

Policy: extend the five existing test files only where a new clause needs proof;
use copy/call counts with controlled promises and the existing clock accessor,
not wall-clock performance thresholds, a browser, process or real Daemon. Record
baseline and implementation counts on the work Issue. Frontend allocation and
idle work are the targets; Daemon `rss_extra_mb` cannot prove frontend heap use.
Retire redundant tests in any edited test file under rule 10, naming the surviving
proof or retired scenario on the Issue. This specification retires no behavior.

The implementation's one test command must complete in under five minutes:

```sh
pnpm --dir apps/desktop exec vitest run src/state/u2773_storage.test.ts src/state/u3787f_storage.test.ts src/state/z3802g_note_queue.test.ts src/state/p3557c_failure_lifetime_note_queue_state.test.ts src/state/u2556_worktree.test.ts
```

| Failure | Exit | Result |
|---|---|---|
| A behavioral or copy/call-count assertion fails | 1 | Acceptance is unmet; retain the failing test/case in the report. |
| Vitest cannot load/collect the named tests | 1 | No acceptance proof; report the setup/collection cause. |
| The five-minute deadline expires when run under `timeout 300s` | 124 | Verification exceeds this work order's budget. |
| A launcher/setup failure occurs | Actual nonzero status | No acceptance proof; report the command and status. |

Policy: apply the Code recipe's lints and rule 9 reuse research before adding
machinery in the implementation PR. This specification adds no runtime machinery
and claims neither allocation improvements nor implementation completion.
