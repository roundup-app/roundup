# Agent status explanations

Acceptance for Issue #5151. This specification adds no runtime behavior. The implementation owns the first journey's Understand and Intervene stages: identify why an Agent stopped and choose whether to retry or dismiss its failure without spending another turn.

Policy: reuse Status, Kind, Attempt and Status revision. Vendor-code interpretation belongs in the Claude Code Adapter (P4), not in App components. The App shares the resulting user label across presentations. No new domain entity is required. Any new contract or App seam command follows the Contract recipe and changes every caller together; generate contracts from Rust. Dismissal is presentation acknowledgement, not a vendor observation or a successful turn.

**U5151a explain the failed turn wherever its status appears.** Given an open Project and an Agent whose current Attempt receives a `StopFailure` hook payload with `error: "server_error"`, when its Status reaches the App, then:

- Its Rail row exposes the cause and next action on screen: Claude's servers failed; send the Agent a message to retry. An accessible name alone does not satisfy this. Use visible error text, or a shared tooltip reachable by both pointer hover and keyboard focus on the row; the full explanation must be readable without opening the Terminal. Planned observer: `u5151a_stop_failure_reaches_the_rail`, passing the hook through the production Adapter/Agent observation path and rendering the resulting Status in the App. A fixture that supplies an already-mapped label is insufficient for this clause.
- Needs you, Inbox and Overview entries that present that Agent's error expose the same cause and next action without first expanding a last-step/history disclosure. Each entry may use visible text or the same pointer/keyboard tooltip behavior. Planned observer: `u5151a_each_error_surface_explains_recovery`, with named cases for all four surfaces through the existing App seam. Cover an Agent and a Workstream's Door; do not mistake an aggregate Error count for an explanation of the affected Agent.
- Any other App presentation of an individual Agent's error, including its Terminal bar/bubble or a mention that displays its Kind, exposes that explanation by the same rule. Aggregate marks/counts retain navigation to the affected Agents and their explanations; they do not concatenate every failure into a tab title. Planned observer: extend `u5151a_each_error_surface_explains_recovery` for each individual-status consumer found in the U5151d audit. Policy: preserve existing aggregate navigation and calm-screen limits.
- Reading, focusing or opening the explanation neither sends input nor retries, launches or stops an Agent. Native requests still open the requesting Terminal and never become an error-retry form. Planned observer: `u5151a_reading_a_failure_spends_no_turn`, checking App calls and retained native-attention navigation.

Policy: exact wording and clipping belong to the design critic, except the work order's mapped-label observer above. Behavioral tests assert displayed explanations/tooltip access and action contracts, not geometry, colour or arbitrary exact copy.

**U5151b translate known failure codes and retain unknown evidence.** Given a `StopFailure` payload, then the Adapter's Status label states the corresponding cause and recovery in the table. Planned observer: `u5151b_failure_codes_have_actionable_labels`, a table-driven production-Adapter test with one named case per code. It asserts cause and recovery meaning, rather than only comparing a copied lookup constant.

| Hook error | Cause and next action |
|---|---|
| `rate_limit` | Claude's request limit was reached; wait, then send a message to retry. |
| `overloaded` | Claude is overloaded; wait, then send a message to retry. |
| `authentication_failed` | Claude could not sign in; open its Terminal, sign in, then retry. |
| `oauth_org_not_allowed` | This login cannot use the organization; check Claude's organization/login, then retry. |
| `account_on_hold` | The account is on hold; resolve its account restriction, then retry. |
| `billing_error` | Claude refused the account's billing; resolve billing in the provider account, then retry. |
| `invalid_request` | Claude rejected the request; check the Terminal details and revise the request before retrying. |
| `model_not_found` | The chosen Model is unavailable; choose an available Model, then retry. |
| `server_error` | Claude's servers failed; send the Agent a message to retry. |
| `max_output_tokens` | Claude reached its response limit; send a message asking it to continue in smaller steps. |
| `cloud_credential_error` | Cloud credentials could not load; repair the configured credentials, then retry. |
| `unknown` | Claude failed without a classified cause; inspect its Terminal, then retry. |

Policy: code inventory verified against the official [Claude Code StopFailure input reference](https://code.claude.com/docs/en/hooks#stopfailure) on 2026-10-30. Codes are opaque outside the Adapter. Billing recovery explains a refusal without parsing, computing or showing usage, money or token counts (P14).

- For an unrecognized nonempty code, preserve that exact code in the explanation alongside Terminal inspection and retry guidance. For missing/empty `error`, explain that Claude ended the turn without a reason and offer those actions; never render an empty explanation or a bare `error`. Planned observer: `u5151b_unrecognized_and_missing_errors_remain_actionable`, with `future_failure_5151`, missing and empty cases through the production hook parser.
- Known-code guidance must work when `error_details` and `last_assistant_message` are absent, as in the owner report. Optional vendor details cannot replace the cause/recovery label, become executable markup or be required to understand it. Planned observer: include absent-details and markup-bearing-details cases in `u5151b_unrecognized_and_missing_errors_remain_actionable`.

**U5151c clear the mark without buying another turn.** Given an Agent showing a last-turn error, then:

- Its explanation states that the next turn's status replaces the failure mark. Sending a new message remains an explicit user action through existing delivery; no automatic retry is introduced. A subsequent working/idle/done Status removes the old error explanation and mark from every active presentation. Planned observer: `u5151c_next_status_replaces_the_failure`, using ordered Status events through the App seam and checking no unsolicited command.
- The Agent's existing menu offers Dismiss error while that failure is current. It clears that failure's error mark and attention contribution throughout the App, including aggregate counts and jump-to-attention; it sends no Message, prompt, Terminal input, interrupt, stop or restart and changes no authoritative Kind to a fabricated success. Keep the last failure and its explanation inspectable from the Agent's opened destination, labelled as dismissed. Planned observer: `u5151c_dismissal_clears_only_the_chosen_failure`, with two failed Agents, an independent native request, the menu action, aggregate/jump behavior, inspectable dismissed reason and zero turn-producing calls.
- Dismissal binds to Project, Agent, Attempt and Status revision. It survives navigation, Project switching and App reload for that same failure. A later error, even with the same code, appears again; dismissing one Agent/Project never hides another's failure. Planned observer: `u5151c_dismissal_is_scoped_to_one_failure`, covering remount, two Projects and a later revision/Attempt. Policy: use existing App persistence and failure handling; introduce no second status store or process supervisor.

Policy: this amends only the unconditional inclusion of an explicitly dismissed error in attention/Kind presentations. Authoritative Status and Message terminal-outcome handling remain unchanged. It does not dismiss `needs-you`, resolve a native request, discard drafts or claim the failed work succeeded. If persistence cannot retain dismissal, expose that failure through its existing owning recovery surface rather than promise it survived reload.

**U5151e a dismissal that cannot be saved says so.** Given an Agent showing a last-turn error and an App persistence write that rejects, when the user chooses Dismiss error, then:

- The error mark and attention contribution clear for the session, as U5151c orders, and the App shows one failure line through the existing owning recovery surface (U3791c): the dismissal could not be saved, so the failure mark will return after a reload. It names the Agent and offers Retry, which writes the same dismissal again, and Dismiss for the line. Planned observer: `u5151e_unsaved_dismissal_is_explained`, through the production state module with a rejecting storage double and the rendered App, asserting the line's presence, its Agent, and the zero turn-producing calls.
- Retry that is acknowledged removes the line, and a reload then keeps the failure dismissed; a Retry that fails again keeps the line. A successful first write shows no line. Planned observer: `u5151e_retry_saves_the_dismissal`, covering both Retry outcomes and a reload with the persisted result.
- The line is bound to the one failure it names (Project, Agent, Attempt, Status revision); a later failure of any Agent never inherits or hides it. Policy: reuse the existing failure line and persistence; no second store.

**U5151f a dismissed error leaves the Inbox row.** Given an Agent whose current last-turn error was dismissed from its Rail menu (U5151c), when the Inbox lists that Agent, then:

- Its row shows neither the error mark nor the failure line; the mark and line return for a later failure of that Agent, and another Agent's undismissed failure keeps both. Planned observer: `u5151f_inbox_row_drops_a_dismissed_error`, through the rendered Inbox and the production dismissal state, with two failed Agents, asserting the dismissed row's mark and failure line are absent, the other row's present, and the zero turn-producing calls.
- The dismissed failure stays inspectable from the opened Agent, labelled as dismissed, as U5151c orders. Policy: the Inbox reads the same dismissal state as the Rail, Switcher, AskBar, AskRows and TodoComments; no second store.

**U5151g a later saved dismissal does not leave an earlier unsaved line up.** Given Agent A's dismissal whose write was rejected, so its U5151e line is showing, when the user dismisses Agent B and storage acknowledges that write, then:

- The line for A stays while A's dismissal is unsaved, and names A only; a write that stores the full dismissed set including A's key removes A's line, and B's own acknowledged write shows no line of its own. Planned observer: `u5151g_later_saved_dismissal_clears_the_earlier_line`, through the production state module with a storage double that rejects once then accepts, asserting the line's presence after A, its absence after B, and both keys stored.
- If B's write also rejects, one line per unsaved Agent remains, and Retry on either writes the full dismissed set. Planned observer: `u5151g_each_unsaved_dismissal_keeps_its_line`. Policy: reuse the existing failure line and persistence; no second store.

**U5151d audit every Agent status label.** Given the App's complete set of Status producers and presentation consumers, then:

- Every known status code displayed as App copy is translated to its glossary user label or a cause and recovery action. Cover all six Kinds, starting, SessionEnd reasons, Terminal disappearance/exit, startup failures, blocked-Todo explanations and native permission/question labels. Preserve meaningful user/vendor-authored questions and commands rather than replacing them with a generic state. Unknown failure codes retain their raw evidence under U5151b. Planned observer: `u5151d_status_labels_read_as_user_actions`, table-driven production-path cases for each producer discovered in the audit; extend existing observers when they already prove a clause.
- Every individual error consumer satisfies U5151a, including consumers that previously used only `aria-label` or a generic Kind tooltip. Planned observer: `u5151a_each_error_surface_explains_recovery` owns this proof; do not add a duplicate test or a source-text assertion that merely checks for a helper call.

Policy: record the producer/consumer inventory, remaining gaps and implementation progress on Issue #5151. Audit Agent status, not unrelated Todo/Pad/PR state models or arbitrary vendor prose. No scenario Work table or open-ended repository redesign is required.

## Gates and rendered observation

Policy: P1 — can any explanation hide direct Agent access? P3 — can routine progress gain attention or a native request lose its Terminal continuation? P4 — can App code interpret vendor codes or change credentials? P9 — can reading/dismissal spend a turn or type vendor commands? P11 — can these actions discard or misaddress a draft? P14 — can recovery introduce usage or cost computation? Each answer must be no; the named observers check status visibility, zero unsolicited input, attention continuation and retained App delivery behavior.

Policy: implementation Moves D2, D5, D6. At 1512×950 in dark mode, use the isolated headless harness with ten Agents, then the densest `tree-40` seed, a long Agent name, all known errors and an unknown long code. Inspect Rail/Needs you/Inbox/Overview, pointer and keyboard explanations, dismiss/reload/new failure, and a visible recovery failure. Preserve every Check passing on main. Run `just capture U5151a,U5151b,U5151c,U5151d`; leave PNG/video under `artifacts/ux/<id>/`, uncommitted. This is Chromium evidence; the user reports what they meet on the Mac. This specification requires no current captures or Mac-only check.

## Main baseline and regression Checks

All citations below exist on origin/main. Planned tests above are implementation obligations, not claims of passing behavior.

1. Adapter mapping: `crates/agents/src/claude_code/mod.rs`, `hook_status` currently passes `StopFailure.error` and `SessionEnd.reason` through; `permission_label` preserves the native question/tool. Keep interpretation at that boundary.
2. Rail visibility: `apps/desktop/src/rail/RailRow.tsx`, `RailRowView`, exposes Status label in the tree accessible name. Overview: `apps/desktop/src/ask/AskBar.tsx`, `OverviewEntry`, uses only the Kind tooltip. Inbox: `apps/desktop/src/inbox/InboxRow.tsx`, `InboxRow`, puts Status label under collapsed last-step content.
3. Attention: `apps/desktop/src/rail/attention.ts`, `attentionOrder`, `attentionCounts` and `nextAttention`; these currently include every error. Amend only explicit dismissal as U5151c orders. `scenarios/journey.md`, J14, retains Understand/Intervene and native continuation.
4. Ordering: `scenarios/agents.md`, A20; `crates/agents/src/events/tests.rs`, `a7_status_revisions_order_transitions_even_when_the_clock_ties` and `b37_a7_old_title_tick_exit_and_signal_do_not_change_a_new_run`. Retain revision and Attempt isolation.
5. Status producers: `crates/agents/src/rail_view.rs`, `waiting_on` and `State::present`; `scenarios/agents.md`, A33, retains blocked-Todo priority and recovery. These are the audit's starting points, not an exhaustive fixed list.
6. Design Checks: `docs/design-system.md`, “The checks”, and `apps/desktop/src/testing/checks.ts`, `runChecks`, define D2 typography/spacing, D5 contrast and D6 target/focus. Shared state marks and row action budgets remain under `.agents/data/journey.md`, “The owner's visual taste”. Error explanations do not add a second state glyph or make state an action.
7. Recovery and retained input: `scenarios/failure-handling.md`, U3791a and U3791c; `scenarios/unfinished-input.md`, U2773b and U2773e. Reuse those owners without replaying remote commands or losing drafts.
