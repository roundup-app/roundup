# UI: Needs you in the Overview

Owner amendment #4966 retires U3770's Inbox Drawer, its opener/Close/slide, Running and Done catalogues, and duplicate attention list. Module: `apps/desktop/src/inbox/` and the connected Overview. Journey: Understand and Intervene. Inbox remains a code term; these clauses specify the user-facing Needs you section. No RPC or permission change.

**U3770a Needs you groups who needs the user.** Given a Project with attention, when Needs you expands in U504's Overview accordion, then it contains one entry for each `needs-you` or `error` Agent, in U2567a's `attentionOrder`, plus U3742's unread comment entries in their existing order. Group entries by the Agent who needs the user; multiple entries for one Agent share that Agent's group, ordered by its first attention entry. Do not add working/done Agents merely for their Kind. Empty groups are absent. Policy: each entry retains its Agent name and KindGlyph, unread comment text/mark, and the expanded empty section shows one quiet line. Tests: amend `u3770a_sections_hold_their_agents_in_order_with_counts` to assert membership, grouping/order and counts in Needs you; retain `u3770a_unread_comment_rows_keep_u3742_behaviour`. U504 owns the persistent outer heading, accordion and unseen state; reading attention clears unseen only, never resolves the native request or substitutes for U3742's existing read action.

**U3770b a row opens to the last steps and one next step.** Given Needs you expanded, activating a row by pointer, Return or Space expands it in place with its latest real formatted step (U456) and accessible expanded state, with at most one row open. An error offers Retry; a native request offers Open, selecting and focusing that exact Agent's Terminal, where its question/permission continues under A3564a. No App answer form remains. Toggling the row or Escape collapses it and returns focus to the row. Tests retained at the Overview seam: `u3770b_a_row_opens_to_its_state_s_one_action`, `u3770b_one_row_is_open_at_a_time`, `u3770b_escape_collapses_and_returns_focus`. Policy: expanding a row moves no preceding row; the critic observes this.

**U3770c Retry resumes.** Given an expanded error row, activating Retry calls `agent.resume {id}` once, disables Retry while pending and follows the Agent's next Kind after success. Failure leaves the row expanded with its cause and Retry enabled; no unrelated call runs. Retain `u3770c_retry_resumes_the_failed_agent` and `u3770c_a_failed_call_keeps_the_row_open_with_the_error`, mounted within Needs you. The old Drawer answer/confirmation/fold/next-question paths remain retired by A3564a–f (policy).

**U5265 Retry is offered only where the Daemon accepts it.** Narrows U3770b and U3770c; applies A5213 to Needs you (found by the review of #5224). Given an `error` Agent row, when its `RailNode.can_resume` is true, then the row offers Retry as U3770c says (test `u5265_an_error_row_that_can_resume_offers_retry`). When `can_resume` is false (an Agent with no saved conversation), then the row offers Open, as a native request does, and no Retry; activating Open selects that Agent's Terminal and calls no `agent.resume` (test `u5265_an_error_row_that_cannot_resume_offers_open_not_retry`). Policy: the row still shows its failure line; no RPC or permission change.

**U3770d attention follows events.** Given Needs you on screen, `agent.status` updates membership and counts in the same frame, with a burst ending in the last state. An Agent leaving attention is removed, not moved to a Running/Done group; a removed Agent leaves with its count. Unrelated updates never close the reader's still-present expanded row. The Needs you count is a polite live region; other section counts are not newly announced. Amend `u3770d_a_status_event_moves_the_row_and_counts`, retain `u3770d_a_burst_ends_in_the_last_state`, `u3770d_changes_do_not_close_or_move_the_open_row` (behavior: row identity/expanded state), and `u3770d_the_needs_you_count_is_a_polite_live_region`. Policy: changes below an expanded row move no row above it; the critic observes geometry, not tests.

**U3770e the Inbox route opens Needs you.** Given an open Project, the former Inbox menu action or `⌘K I` selects Overview, expands Needs you and collapses other sections, including with no attention. Repeat from Rail, Ask, Bench, non-modal Drawer and a focused Agent/shell Terminal. It creates no Inbox Drawer, sends no Terminal input and starts/resumes/sends nothing. Repeating the route keeps Needs you open. Planned test `u3770e_inbox_route_opens_overview_needs_you_once` asserts destination, disclosure states, focus on its heading and zero unrelated calls through the connected App/real key handler. U2239's modal guards and leader consumption still apply; Ask drafts retain their exact text/Project under P11. Retire only the Drawer opening-state/slide proof. Policy: existing row expansion/collapse and membership moves retain `--easing-out` and the durations in `docs/motion.md`; counts never animate, no clock ticks, and reduced-motion changes are instant. Retain `u3770e_reduced_motion_makes_every_change_instant` for the row transitions (behavior only: no animation is created). No new motion is ordered.

### U3770e empty-route acceptance (#4995)

Given an open Project with no `needs-you` Agents, no `error` Agents and no unread comments, with Needs you collapsed and Made expanded, run each route independently from each starting state:

| Starting state | Action |
|---|---|
| Empty Project, Overview visible | `⌘K`, then `I` |
| Empty Project, Overview visible | Activate the native menu's Inbox action |
| Project with an idle Agent selected | `⌘K`, then `I` |
| Project with an idle Agent selected | Activate the native menu's Inbox action |

Then Overview is selected, Needs you is expanded with its empty content, Asks/Reactions/Made are collapsed, the Needs you heading owns focus and no Drawer is open. Invoke the same route again: Needs you remains expanded and focused. The active Project and exact Ask draft remain unchanged, and neither invocation starts/resumes an Agent, sends an Ask or writes Terminal input. Test: extend `u3770e_inbox_route_opens_overview_needs_you_once` in `apps/desktop/src/inbox/u3770_inbox.test.tsx` with these four cases, asserting the same endpoint and call counts after each invocation. Retain its existing origins; reuse its empty-route proof rather than adding a duplicate test. Menu cases enter through the existing menu dispatch (`openProjectPage`), and key cases use the connected App's real leader handler; calling the route callback directly proves neither route.

Policy — this narrows the existing U3770e observer to an explicit empty-state regression matrix; it does not retire any U3770e origin or guard. At 1512×950, dark, isolated headless U26 `empty-project`, collapse Needs you/open Made before each route, then capture the resulting expanded empty section under `artifacts/ux/U3770e/` using `just capture U3770e`. The menu dispatch observer establishes webview routing; existing native menu construction/dispatch tests establish the menu command. Keep D2, D5 and D6 and every Check passing on main; use only Tokens. No native Mac observation or specification-only capture is required.

Regression Checks for #4995 on main:

1. `apps/desktop/src/inbox/u3770_inbox.test.tsx`, `u3770e_inbox_route_opens_overview_needs_you_once`: existing route origins, heading focus, accordion state, repeated route, retained draft and unrelated-call refusal.
2. `scenarios/ui-shortcuts.md`, U2239 and U2241: modal guards, leader consumption and Terminal key ownership.
3. `scenarios/ask-bar.md`, U504 and U505: Overview accordion, initial attention opening and Ask acknowledgement.
4. `scenarios/ui-worktree-changes.md`, U2539b: Inbox menu/key destination and matching native-menu action.

Regression Checks on main:

1. `scenarios/ui-project-root-overview.md`, U2567a–d: attention order, exact requesting Terminal and refresh.
2. `scenarios/ui-attention.md`, U3742: unread comment actions and identity.
3. `scenarios/agents.md`, A22; `scenarios/ui-shortcuts.md`, U2239/U2241: Retry contract, leader guards and no stolen Terminal keys.
4. `scenarios/ask-bar.md`, U504/U505: section toggles, attention-first initial opening, per-Project unseen and independent Ask acknowledgement.

Policy — implementation observer: the shared #4966 observer under U504 uses isolated headless Chromium/fresh profile at 1512×950, dark, ten Agents, multiple entries per Agent, empty section, burst updates and a failed Retry visible on the densest seed. Capture U3770a/U3770b/U3770e under `artifacts/ux/<id>/`, uncommitted. Moves D2, D5, D6; only Tokens, no passing-main Check regression. P3's observer opens the requesting Terminal and continues there through the real Daemon/fake vendor; P9's call counts prove no automatic start/send, P11's draft observer retains exact input through routing. No native Mac appearance claim. The specification changes no implementation or loop machinery.
