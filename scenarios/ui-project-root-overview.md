# UI: the Project root overview

Module: `apps/desktop/src/ask` (the overview beside the Ask bar's rows) and `apps/desktop/src/rail` (the attention helpers it reads). Ids: U2567a, U2567b, U2567c, U2567d. Terms: Project root, Workstream, Door, Agent, Rail, Status, Kind, Glyph, Ink, Ask (`GLOSSARY.md`). Work Issue: #2567. Journey stage: Understand (`.agents/data/journey.md`): the user sees which work needs them and reaches its Terminal.

Source: the owner's answer of 2026-10-18, "A — Project overview" (#2567): the root shows the Ask plus a compact list of Workstreams and what needs the user; selecting one opens its real terminal. roundup complements the agent programs and never overrides or competes with their views. Narrows U504 (the Ask bar is the home screen) and U38 (the centre with nothing selected). Changes no RPC method, contract, App seam command or Token, and adds no `GLOSSARY.md` term. No implementation is claimed by this specification.

The overview is read from `rail.tree` and its events, which the Rail already holds. It shows facts the Rail knows (name, Kind, who needs the user) and nothing a model wrote. Reading an Agent's conversation, drawing a chat, a Worktree diff, a note box and a voice control are not part of it: the Agent's view stays its Terminal, and changes are per Agent (#2549, #2540, #2562).

**U2567a the home screen lists the Workstreams and who needs the user.** Given an open Project whose Rail has at least one Workstream and selects none (U504's home), then, below the Ask input and above the Ask rows:

- **One entry per Workstream**, in Rail order, never reordered by Kind: its name (cut with an ellipsis and readable in full as U2228a says) and its Door's Glyph and Kind label (`KindGlyph`, as U505's rows show). A Workstream whose Door has no Status shows no Glyph and no label.
- **Who needs the user.** When a Workstream's Door or any Agent under it has Kind `error` or `needs-you`, its entry shows beneath it one line for each such Agent, most urgent first and then oldest `since` (the order of `rail/attention.ts`): the Agent's name and its Kind label in Ink. A Workstream with none shows no such line. A heading line above the list reads the count of all such Agents, or `Nothing needs you` when it is zero. A Terminal has no Kind and never counts.
- **Compact.** The list takes no more than one line for each entry and each attention line; the home screen scrolls as one area when it overflows, and the Ask input stays above the list.

Tests: `u2567a_entries_follow_rail_order_with_door_status`, `u2567a_attention_lines_sit_under_the_right_workstream` (a `needs-you` Agent under Workstream B, an `error` Door of A, a Terminal and a `working` Agent: the lines are exactly the Door of A, then the Agent under B, and the heading counts two), `u2567a_nothing_needs_you` (Vitest with the fake App). Looks are the design critic's (rule 10).

**U2567b the overview follows the Rail.** Given U2567a on screen, then when `rail.tree` changes or an `agent.status` event arrives, the overview shows the new Kind, the attention lines and the count within the same frame as the Rail's row, without a reload; a Workstream that is created appears at its Rail position, and a removed one leaves with its lines; an Agent whose Kind leaves `error` and `needs-you` loses its line. The overview calls no RPC method of its own: its reads are `rail.tree` and the events the Rail already subscribes to. Tests: `u2567b_a_status_event_moves_the_line_and_the_count`, `u2567b_create_and_remove_follow_the_tree`, `u2567b_the_overview_makes_no_call_of_its_own` (the fake App's call log between mount and an event holds only the Rail's and Ask's calls).

**U2567c selecting work opens its real Terminal.** Given U2567a, then:

- **Select.** Activating a Workstream entry by click, or by Enter or Space with keyboard focus, selects that Workstream as a click on its Rail row does; activating an attention line selects that Agent. The home screen then gives way and the centre shows the selected node's Terminal as U467 and U143 say. Each entry and line is a native button, reached by Tab in list order, with a visible focus state and an accessible name holding the name and the Kind label.
- **Selection starts nothing (U9, P9).** Activating an entry whose Door is stopped calls no `rail.startDoor` and no `terminal.*` method; the centre shows U143's Door state with its `Start supervisor` button as today.
- **Nothing is taken over.** The activation calls no `takeover.begin`, no `message.send` and no `ask.*` method. Watch and Takeover, direct access (P1) and U524's Terminal action from the Project root behave as on `main`.
- **The Ask is unchanged.** With the overview on screen, `ask.send`, `@` mentions, placement, rows and `⌘/` behave exactly as U504 to U506 and A40 to A42 say; their tests pass unmodified. `⌘/` over a selected Workstream shows the Ask bar and its rows only, with no overview.

Tests: `u2567c_activating_an_entry_selects_its_workstream_and_shows_the_terminal`, `u2567c_activating_an_attention_line_selects_that_agent`, `u2567c_a_stopped_door_is_selected_but_not_started` (call log has no `rail.startDoor`, `terminal.*`, `takeover.begin`), `u2567c_the_entries_are_reachable_by_keyboard_in_order`. The existing `u504_`, `u505_` and `u506_` tests are the proof of the last clause.

**U2567d empty, loading and failed states.** Given the Project root, then:

- **Empty.** With no Workstream, U143's `No Workstream yet` and `start a Workstream` show, with no overview, no heading and no Ask bar, as today. #2571's key list joins that state and this scenario adds nothing to it.
- **Loading.** Before the first `rail.tree` answer there is no row, so U143's empty state shows as it does today; no `Nothing needs you` line appears until a tree has answered.
- **Failed.** When `rail.failure()` is set, the overview keeps the last tree it has and shows the Rail's `✕ <message>` line (`ErrorLine`) above it; the Ask input and rows keep working. The line clears with the next successful tree (U3).
- **Worst case.** A Workstream name of 200 characters, a non-Latin name, twelve Workstreams and ten attention Agents under one Workstream neither widen the page sideways nor hide the Ask input; failure text stays visible on the densest seed (`.agents/builder.md`).

Tests: `u2567d_no_workstream_shows_u143_and_no_overview`, `u2567d_before_the_first_tree_shows_no_all_clear`, `u2567d_a_failed_refetch_keeps_the_list_and_shows_the_error`, and a Chromium test on the U26 harness for the worst-case no-sideways-scroll clause.

**Bounds, for the review run.** The PR adds no RPC method, App seam command, contract type, `GLOSSARY.md` term, Token, dictation or voice control, Worktree diff, tree or note action at the Project root, transcript renderer or parser of Agent output, and no notification policy or automatic start (#2567). Interactive controls use `apps/desktop/src/ui/` primitives; a native button is the control here, so the PR needs no new primitive. It carries no `Reuse:` section unless it adds a file under `apps/desktop/src/`, and then names Ark UI (installed in `apps/desktop/package.json`, already wrapped in `ui/`) and Kobalte (`@kobalte/core` 0.13.14, MIT, released 2026-09-07) with the reason for the choice: the overview is a list of buttons and needs no new component machinery.

Observer: Vitest with the fake App for U2567a to U2567d's calls, focus and order; isolated headless Chromium on the U26 harness at 1512 by 950 (`?seed=agents-10`, plus a worst-case seed) for D2, D5 and D6 in light and dark, which the design critic judges. A real-Daemon test on `just harness-real` (U144) shows one `needs-you` Agent under the right Workstream and that selecting its entry shows its Terminal. The native window and a real `claude` remain the user's Mac observation.

Moves: D2, D4, D5, D6 (`docs/design-system.md`); existing Tokens only.
