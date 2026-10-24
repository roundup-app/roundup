# UI: the Inbox Drawer as a grouped list

Module: `apps/desktop/src/inbox`. Ids: U3770a–U3770e. Terms: Inbox, Drawer, Agent, Kind, Glyph, Rail, Ink, Token (`GLOSSARY.md`). Work Issue: [#3303](https://github.com/saadshahd/roundup/issues/3303). Journey stage: Intervene (`.agents/data/journey.md`): the user sees who needs them and answers from one place.

Source: the owner's pick of 2026-10-22: restyle the existing Inbox Drawer in the list layout of AffectUI's Agent Inbox (public docs, `https://www.affectui.com/llms-full.txt`, "Agent Inbox"), not a centre task board. It is a paid item with no public source: the look is rebuilt from its docs and no code is copied. The Needs you group follows AffectUI's Decision Inbox (`https://www.affectui.com/components/decision-inbox`, free, MIT): its CSS may be copied with credit, and the credit (name, URL, licence) is recorded. Solid, Ark UI primitives of `apps/desktop/src/ui/` and Tokens only. No new RPC method or contract: Retry calls `agent.resume` (A22). If the spec's Retry fits no failed Agent, the build run files the missing contract as a blocking Issue.

**U3770a the Drawer groups its rows as Needs you, Running and Done.** Given a Project with Agents, when the Inbox opens (`⌘K I`), then it shows three sections in this order, each headed by its name and a count of its rows, and a section with no rows is not shown:

- **Needs you:** one row for each Agent with Kind `needs-you` or `error` (the entries of U2567a's who-needs-you line, same order from `rail/attention.ts`), plus U3742's unread comment rows, which keep their text, amber line, order among themselves and behaviour.
- **Running:** one row for each Agent with Kind `working`.
- **Done:** one row for each Agent that ended with Kind `done`, newest first.

Each row leads with the Rail's `KindGlyph` of its Agent's Kind and the Agent's name. The empty Inbox keeps `Nothing waits for you`. Tests: `u3770a_sections_hold_their_agents_in_order_with_counts` (its Needs you order is `attentionOrder`'s, the overview line's), `u3770a_unread_comment_rows_keep_u3742_behaviour`. Moves: D2, D5, D6.

**U3770b a row opens to the last steps and one next step.** Given U3770a's rows, when the user activates a row by pointer, `Enter` or `Space`, then it expands in place (one row open at a time, the others unchanged) to show the Agent's latest real step (U456's formatted step, without a clock that ticks) and the one action that fits its state, and `aria-expanded` is set on the row:

- Kind `error`: `Retry`.
- Any other Agent, a needs-you one included: `Open`, which selects the requesting Agent's Terminal in the Rail and closes the Drawer; the question or permission prompt is answered there (A3564a).

Escape or activating the row again collapses it and returns focus to the row. Opening a row moves no row above it. Tests: `u3770b_a_row_opens_to_its_state_s_one_action`, `u3770b_one_row_is_open_at_a_time`, `u3770b_escape_collapses_and_returns_focus`.

**U3770c Retry resumes.** Given an `error` row of U3770b, when the user activates `Retry`, then `agent.resume {id}` is called once; while the call is pending the action is disabled, and after success the row follows the Agent's next Kind into its new group (U3770d). On failure the row stays open with an `ErrorLine` and the action enabled. The Drawer makes no other call. The former quick answers, answer confirmation, fold and next-question opening are retired by A3564a–f. Tests: `u3770c_retry_resumes_the_failed_agent`, `u3770c_a_failed_call_keeps_the_row_open_with_the_error`.

**U3770d a row follows its Agent without shifting the list under the reader.** Given U3770a on screen, when an `agent.status` event changes an Agent's Kind, then its row moves to its new group and the counts change in place within the same frame; a burst of events leaves the last state with no queued moves. The Needs you heading's count is a polite live region (`aria-live="polite"`); the other counts are not announced. A change below the row the user has open, or in a group below it, moves no row above it and keeps the open row where it is (#3294); a change above it never closes it. A removed Agent's row leaves with its count. Tests: `u3770d_a_status_event_moves_the_row_and_counts`, `u3770d_a_burst_ends_in_the_last_state`, `u3770d_changes_do_not_close_or_move_the_open_row`, `u3770d_the_needs_you_count_is_a_polite_live_region`. 

**U3770e motion and the opening state.** Given U3770a to U3770d, then: opening the Drawer shows its end state (U5's slide only, no row stagger); expanding and collapsing a row and a row's move to its new group use the `--easing-out` Token and durations from `docs/motion.md`; counts never animate and no clock ticks (#3298, U3016); under `prefers-reduced-motion` every change is instant. Policy: the design critic judges the look and motion against D2, D5, D6 and the rendered continuity protocol of U3010b at 1512×950 in dark on the densest seed with a failed Retry visible, capturing with `just capture U3770a U3770b U3770e` into `artifacts/ux/`, never committed. Test: `u3770e_reduced_motion_makes_every_change_instant` (behaviour only: no animation is created).

Observer: Vitest with the fake App for calls, focus and order; isolated headless Chromium on the U26 harness for the capture. No native Mac claim; the user reports what they meet in the App.
