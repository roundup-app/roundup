# Remove Clear from roundup (A32, U350)

Source: #4542, owner decision of 2026-10-28: remove the whole Clear functionality. This specification replaces the former Clear/Handoff/Iteration acceptance; it does not claim the implementation is removed. Module: `apps/desktop`, `crates/agents`, `crates/rupd`, `crates/rup`, `crates/messages`, `crates/checkpoints`, `crates/contracts` and `contracts/generated/`.

**U350 the App offers no Workstream Clear.** Given running, stopped, resumable, queued and Todo-blocked Workstreams and a Subagent, when the user selects, hovers or focuses each row and opens its menu, then there is no Clear action or reason prompt; start/resume/stop, add, folder/editor, Opening prompt settings and removal retain their own acceptance. Extend `apps/desktop/src/rail/u350_clear.test.tsx` with `u350_workstream_actions_have_no_clear` at the connected App seam, asserting absence of the removed control and menu action and activating a surviving action with its original id and one call. Retire the old positive Clear tests instead of retaining their fixtures.

Policy: delete `rail/ClearPrompt.tsx`, `rail/clear.ts`, their imports, menu model actions/targets, row action props, `.rail-clear` styles, copy catalogue entries, pending/failure UI and Clear-only fixtures. Remove the `rail-clear` draft destination, recovery rendering and replay path. Drop saved Clear drafts outright; preserve other surfaces' exact text, selection and recipient. Extend the existing Rail draft suite only where needed with `u350_retired_clear_drafts_do_not_reopen_or_send`: load a Clear draft beside an unsent task draft, reopen the Project, and assert no Clear surface or call, with the task draft still recoverable unchanged. Delete Clear-only draft tests under the retired U2773a clause. No replacement prompt, shortcut or generic destructive action is introduced.

Rendered observer: Intervene in `.agents/data/journey.md`, isolated headless U26, dark, 1512×950, `tree-40`, `agents-10`, `door-stopped` and `conflict`. Use pointer and keyboard to select a Workstream, open/dismiss its menu, reach an Agent Terminal and open Opening prompt settings; retain visible failure text from a surviving rejected action on `tree-40`. Policy: D2, D5 and D6 (`docs/design-system.md`, **The checks**) hold with no previously passing Check regressed. Run `just capture U350`; keep PNG/video under `artifacts/ux/U350/`, never committed. Moves: D2, D5, D6. No new motion or Token is required. This is a Chromium/webview observer; no native Mac observation is needed for removal.

**A32 the Clear contract and lifecycle are retired.** Given a real Daemon with a Workstream and Door, when a client calls either `workstream.clear` or `workstream.handoff`, then it receives `METHOD_NOT_FOUND`, with no node, Todo, Pad, Message, Attempt, file or branch mutation and no Clear event. Planned `a32_removed_methods_are_unknown_and_change_nothing` in `crates/rupd/tests/` uses the real dispatcher and snapshots the existing stores; no Claude process or timeout is needed. Given Door and ordinary-Agent MCP identities, when their tools are listed and either retired tool name is called, then neither tool is offered and both calls are unavailable without effects. Extend `crates/rup/tests/mcp/tool_lists.rs` with `a32_removed_tools_are_unavailable`, reusing its existing shim seam. `workstream_clear` was already withheld; it must not become a generic fallback tool when its M5 exclusion row is removed.

Policy: delete `crates/rupd/src/clear.rs` and its registration/coordinator state, acknowledgement/timeout/retry/archive paths, `workstream_handoff` offering/result prose and both methods' declarations, params/results/events/exports. Remove `workstream.cleared` and `workstream.clearFailed`; regenerate `contracts/generated/` from `crates/contracts`, never edit generated output by hand. Update every caller, contract inventory and fixture in the same contract PR. Remove Clear-only `restart_door` Handoff launch plumbing, `end_iteration`, Rail/Message/Mark Iteration fields, storage reads/writes and eligibility guards, including Clear-only stored tables/columns. No release exists: drop that stored state outright, without a data conversion or compatibility alias. Preserve all unrelated Project data, ordinary Message history, Checkpoint snapshots and Rewind's stale-Mark rules. Update fresh/reopened schema observers and retain Rewind tests for those surviving boundaries.

Policy: remove `Clear`, `Handoff`, `Iteration` and the two Clear control terms from `GLOSSARY.md` with their last production consumers. A specialist's ordinary summary (LC12/LC13), Todo Hand-off, Message batching, Restart/Retirement reservations and Opening prompt are separate capabilities and stay. The Opening prompt is typed once only after the user's fresh session restart (A4452c); plain resume and Rewind type none. #4465's saved setting/inbox work merged in #4603; fresh restart/delivery remains in #4574. Do not rebuild that feature or route it through Clear.

## Entry-path audit

Policy: the implementation PR records each row's removal or retained behavior and its verification. Paths are the baseline on `origin/main`; these are ownership boundaries, not new machinery.

| Path on main | Disposition and reason |
|---|---|
| `apps/desktop/src/rail/Rail.tsx`, `rail/menu/model.ts`, `rail/rows.ts`, `rail/RowIcons.tsx` | Remove Clear row action, both menu construction paths, target state and prompt mount; preserve the other actions. |
| `rail/ClearPrompt.tsx`, `rail/clear.ts`, `rail/styles.css`, `copy.ts`, `copy/rail.ts` | Remove reason, fallback, pending/failure and summary copy; no Clear surface remains. |
| `rail/persist/`, `state/`, Rail draft/recovery tests and harness fixtures | Remove `rail-clear` destination and its stored drafts/recovery only. Keep unrelated unfinished input (P11). |
| `keys/registry.ts`, `keys/chords.ts`, `crates/desktop/src/` menu dispatch | Keep existing unrelated keys/menu commands. No dedicated Clear chord is registered on main; remove any Clear forwarding found during implementation, with no replacement binding. Vendor Terminal `/clear`, including the user's Ask-routed local command (A2698a), remains user input; it never calls Workstream Clear. |
| `crates/agents/src/asks.rs` and App Ask | Keep Ask routing and user text delivery: no Clear-specific Ask command exists. An Ask cannot invoke a retired RPC or change the Opening prompt. |
| `crates/rupd/src/clear.rs`, `lib.rs`, `open.rs`, dispatch registration | Remove both RPC handlers, coordinator, retry/archive state and Clear events. |
| `crates/agents/src/claude_code/brief.rs` | Remove Clear/Handoff tool descriptions and Door instructions; retain unrelated Brief guidance and cache stability. |
| `crates/rup/src/mcp.rs`, `mcp/agent_tools.rs`; M5/M2706a (`scenarios/mcp.md`) | Remove Door Handoff tool, success prose, special permission/dispatch branch and Clear exclusion row; reject retired calls. |
| `crates/agents/src/door.rs`, Rail/Marks; `crates/checkpoints`; `crates/messages` | Remove only Clear's fresh-Handoff restart and Iteration storage/guards; retain session restart reservations, normal history and Rewind. |
| A33 (`scenarios/agents.md`), `docs/messages.md`, Message delivery | Keep Todo-blocked presentation with the underlying idle inbox eligible for ordinary Messages. Remove only the Clear/Handoff example; blocked Todo state is not Terminal-busy state. |
| `crates/rupd/src/specialist.rs`, LC12/LC13 | Keep specialist summary/replacement behavior; it never calls `workstream.handoff`. P14's separate token-count retirement remains in force. |
| `contracts/c4-before.ts`, `contracts/c4-shapes.ts`, MCP before-fixtures | Remove Clear-specific inventory/shape obligations along with live declarations, preserving other contract boundaries. |

## Retired acceptance

Policy: these retirements authorize deletion of the tests that prove only the removed capability. A mixed test retains its surviving assertions. Test-cost inventories cease requiring the retired rows; they do not authorize weakening other scenarios.

| Scenario | Retirement / retained boundary |
|---|---|
| A32, U350 | All former reason, request, Handoff, archive, fallback, failure/retry, fresh-Clear restart and Iteration clauses are replaced above. |
| U427, U2694b, U3812, U422, U4322a/b, U4409a, U4461, U4275b | Clear icon/menu clauses retire; other row actions and menu-state rules stay. |
| U2773a, Z3799d, U3530a–c, U3517d | Clear draft/panel, focus and overflow clauses retire; other editable surfaces and library ownership stay. |
| U416, U471, U472, U2570a, U3512a | Clear copy/catalogue/journey/tooltip requirements retire; start/retry, authored text and surviving failure feedback stay. |
| B55 | Entire Clear-only fresh-session isolation probe retires; B50–B52 ordinary inbox acknowledgement/deduplication stay. |
| D9 | Only Clear completion/failure and App-bound-Clear probes retire; independent requests, connection state ordering, event delivery, cancellation and removal bounds stay. |
| A35, N14 | Earlier-Iteration invalidation/round-trip fields retire; old Marks, selected children, original files, conversation copies and later-Rewind invalidation stay. |
| A4452a/d/e, U3801/U3802, A3516a, B2706 | Remove Clear/Handoff launch examples and Clear-specific regression branches. Keep idle launch, inbox coordination, user launch settings and permission authority. A4452c retains fresh-restart once-only Opening prompt delivery, independent of Clear. |
| LC12/LC13, I5, I2706a, M2706a, F2/F8, Q11 | Drop A32 support, Handoff command/result and Clear launch examples only; specialist summaries, caller identity, naming and launch settings stay. |
| E10–E13, A2961, TC1/T4b | Retire inventories of `a32_*` positive Clear tests, `b55_*`, Clear-only D9 tests and `a35_a_clear_makes_earlier_marks_unusable`; retain process-cost requirements for surviving behavior. |

Policy: The Clear/Handoff retirement requirements are held by A32 and U350 above, following #4542. `docs/perf.md` drops Clear-only RPC coverage entries with the removed methods.

## Gates and regression observers

Policy: apply P1 (direct Agent access and Ask unchanged), P3 (native attention still reaches its Terminal), P6 (remove no held items), P9 (no automatic launch or typed vendor command), P11 (only retired Clear drafts discarded), and P7 (ordinary Messages remain readable). Observe U350/A32 above and checks 1–5 below. Message/Iteration contract cleanup touches M1, M4, M5, M6, M7, M9 and M10 (`scenarios/proofs.md`); M2/M3/M8 remain retired. Preserve all remaining laws; run `just proofs` and keep `proofs/messages` and `docs/messages.md` agreeing. No weakening to fit removal.

Checks on main (numbered references identify existing acceptance, not a claim it has passed on this branch):

1. `scenarios/agent-lifecycle.md`, **A4452c a sticky Workstream sends its saved opening prompt**: setting authority and fresh-restart once-only delivery, owned by the existing work orders.
2. `crates/messages/src/tests/a35_tests.rs`, `a35_reserved_messages_wait_for_the_next_attempt_release` and `a35_restart_keeps_b7_order`: retained restart Message guards and order.
3. `apps/desktop/src/rail/u2773_drafts.test.tsx`, `u2773a_rail_task_keeps_original_recipient_after_selection_changes`: unrelated task draft identity.
4. `scenarios/workstream-rewind.md`, **A35 the Door rewinds one or all children to its Checkpoint**: preserve Rewind with no Clear/Iteration dependency.
5. `scenarios/agents.md`, **A33 the Daemon decides Kind `blocked` from an Agent's Todos**: blocked display and normal Message delivery remain independent.

Specification acceptance (policy): A32/U350 define removal and named behavioral observers; the entry-path and retirement audits cover every Clear path; implementation is split into App #4653, RPC/Handoff #4654 and Iteration storage #4655, each checked with `python3 loop/orders.py check`, App first, natively blocked by this specification and then by their predecessor. This specification PR closes #4542 only; implementation Issues stay open. No library/parser/store/protocol or App seam is added by the specification.

Specification validation (policy): report a failed command on #4542 with its exit code; no failed observer demonstrates acceptance.

| Command | Failure | Exit |
|---|---|---|
| `loop/rules.sh vocab` | Public vocabulary violates rule 6 | 1 |
| `loop/rules.sh scenario-ids` | A scenario heading breaks the id inventory | 1 |
| `python3 loop/orders.py check <body-file>` | A dependent work order is malformed; do not file it | 1 |
| `just ready` | A required lint, trailer or frozen-boundary check fails | 1 |
