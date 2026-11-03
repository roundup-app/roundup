# U5741 Message and result decisions

Audited main: `f966e5b580ab4ed8205d350a80d003d656e1c70b`. This continues the inventory with five independently callable Message read and result operations. It is a source and declaration reconciliation; no fresh App rendering, runtime call or vendor probe is claimed for it. Candidate status authorizes no deletion. Result claims, user acceptance, authoritative checks, unknown-effect resolution, Message authority, real Agent Terminals, native continuation and Ask remain required until the owner answers.

## Entry points and decisions

All five are declared in `crates/contracts/src/declarations.rs` and offered as `rup message <verb>`, `message_<method>` in the Agent MCP list and `message_<method>` in the Door MCP list (`endpoints.md`, `catalogues/public-current.json`). No mounted App source calls `acceptResult`, `verifyResult`, `resolveResult` or `message.report`. `message.get` appears in the App only inside `apps/desktop/src/state/connectedProject.ts`'s connected-method list; the Work progress panel (`orders/WorkProgress.tsx`) reads `message.reconcileWork`, which is outside these rows.

| Row | Independent action and exact public entry points | Implementation / acceptance |
| --- | --- | --- |
| MR01 | Read one Message: `message.get {id}`; `rup message get`; `message_get` | `crates/messages/src/contract_handlers.rs::rpc_message_get` → `Messages::get`; the caller must be a sender or receiver. `scenarios/messages.md` B-series, `scenarios/mcp.md` M5, `scenarios/cli.md` I1/I5. |
| MR02 | Report one's own Attempt result: `message.report`; `rup message report`; `message_report` | `crates/rupd/src/evidence.rs::evidence_call`; Agent and Attempt come from the authenticated connection. U3078b (`crates/rup/tests/evidence.rs::u3078b_delivery_report_acceptance_and_verification_are_distinct`, `u3078b_public_reports_cannot_forge_authority`, `u3078b_public_reports_cannot_claim_an_earlier_attempt`). |
| MR03 | Record user acceptance of one exact report: `message.acceptResult`; `rup message accept-result`; `message_acceptResult` | Same dispatcher; U3078a/U3078b/U3078c. Acceptance is evidence only, never verification. |
| MR04 | Observe a report's declared condition: `message.verifyResult`; `rup message verify-result`; `message_verifyResult` | Same dispatcher; `crates/rupd/src/pr_checks.rs::u3078b_checks_require_fresh_complete_exact_pr_evidence`, `u3078b_wrong_version_source_cannot_verify_a_report`. |
| MR05 | Authorize a receipt source for an unknown external effect: `message.resolveResult`; `rup message resolve-result`; `message_resolveResult` | `evidence_call` refuses a non-user Actor; `crates/rup/src/cli.rs` sends it as the user. U3078h (`u3078h_unknown_external_effects_require_authoritative_resolution`, `u3078h_exact_external_resolution_survives_reopen`, `u3078h_unusable_external_evidence_leaves_the_effect_unknown`). |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| MR01 | **Not established.** No vendor comparison was run in this slice; none is assumed. | **No.** Request needs the Door's real tool action and its Message observed through the Daemon (`.agents/data/journey.md`, Request); reading a Message by id is how an Agent or the user inspects it. | **No.** The read returns the exact instruction body that an Agent acts on. | Not a candidate on the evidence here. |
| MR02 | **Not established.** No vendor comparison was run. | **Yes.** The journey's Review stage needs the outcome and its retained work, not an Agent's explicit signed claim; Terminal and Rail Status reach the user without it. U3078 acceptance, though, orders this claim as the input to acceptance and Resume, so removal retires U3078a–j clauses. | **No.** It writes a durable claim that later reconciliation reads. | Candidate: Q2; retirement would amend U3078. |
| MR03 | **Not established.** | **Yes.** No journey stage requires the user to record acceptance of a Result report; the App has no accept control. | **No.** Acceptance changes what Work progress and Resume treat as accepted. | Candidate: Q2. |
| MR04 | **Not established.** | **Yes.** The journey needs no Daemon check of a report; it relies on reading outcomes. | **No.** A verdict changes what is accepted and what remains. | Candidate: Q2. |
| MR05 | **Not established.** | **Yes.** No journey stage resolves an unknown external effect. | **No.** It releases a held continuation. | Candidate: Q2; user-only authority must stay if kept. |

## Dependencies

MR02–MR05 share stored Result reports, observations and acceptances read by `message.reconcileWork`, `message.resumeWork`, `message.progress` and the Work progress panel. The rows are independent choices, but selecting MR02 makes MR03–MR05 unreachable, since all act on a report; the final request must say so rather than treat one answer as another's permission. Deleting any of them must still open older Projects whose stored reports, acceptances and observations exist, retaining exact identities (N5467). Unknown effects must never be retried.

## Remaining

Vendor Q1 comparisons for these five rows, a fresh isolated runtime role census, and reconciliation of the other methods that no decision file names (74 of the 163 declarations by a name search) (`entry-points.md` continuation order) are unfinished. No owner choice or deletion is made.
