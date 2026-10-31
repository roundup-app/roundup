# Terminal program status

Module: `crates/terminal` (PS1–PS6), `crates/rupd` with `crates/contracts` (PS7–PS9) and `apps/desktop` (PS10–PS12). Ids: PS1–PS12. Work order: [#5227](https://github.com/roundup-app/roundup/issues/5227); implementation Issues #5228 (parse), #5229 (fold), #5230 (App), in that order. Principles served: P3, P4 (`PRINCIPLES.md`). Term: **Program status** (`GLOSSARY.md`).

Outside evidence: the Program Status Protocol, OSC 7501, rev 0.4 (https://www.superlogical.com/rex/docs/build/program-status), read by Rex. Any program in a Terminal can report that it is working, waiting on the user, done or failed, and why; roundup shows that state as it shows an Agent's Kind. This file fixes the wire syntax, limits and lifetime (PS1–PS6), how records become one Terminal Status (PS7), how it is published (PS8), how it meets Agents (PS9) and how the App shows it (PS10, PS11). Merging this specification delivers no runtime change.

**Wire form.** A report is `ESC ] 7501 ; <pair> : <pair> … ST`, `ST` being `ESC \` or `BEL`. A pair is `key=value`. Keys: `state` (`idle`, `working`, `done`, `blocked`, `error`, `clear`), `kind` (`permission`, `question`, `auth`; with `blocked` only), `id` (a `/` path of record names; absent is the root record), `progress` (0–100), `app`, `title` and `msg` (base64 of one line of UTF-8 with no control character; `app` and `id` are plain text). A **record** is the last accepted report for one `id` in one Terminal.

**PS1 a report becomes a record.** Given a Terminal whose program writes a report, when the Terminal's mirror (`crates/terminal`) reads it, even split across any two chunks, then:

1. a report with a valid `state` makes the record for its `id`, holding `state`, `kind`, `progress`, `app`, `title`, `msg` and the time it was applied;
2. a pair with no `=`, an unknown key, an unknown `kind`, a `kind` with a state other than `blocked`, a `progress` outside 0–100 or not an integer, a `msg` or `title` that is not valid UTF-8 or holds a control character, or an `id` with an empty level is skipped, and the other pairs apply; a report with no valid `state` changes nothing;
3. a `msg` or `title` whose base64 is invalid drops the whole report, which changes nothing;
4. one change is emitted to the Daemon per applied report, naming the Terminal and holding the records after it, and none for a report that changes nothing.

Tests (`ps1_`, Rust, `crates/terminal/tests/`): `ps1_a_report_makes_its_record_across_chunk_boundaries`, `ps1_a_bad_pair_is_skipped_and_the_rest_apply`, `ps1_bad_base64_drops_the_whole_report`, `ps1_one_change_per_applied_report`. Observer: the Rust tests through `Terminals` with a real PTY running `printf`.

**PS2 limits.** Given a report over a limit, then it is dropped whole and changes nothing: more than 4096 bytes in all; `msg` over 2732 encoded or 2048 decoded bytes; `title` over 256 encoded or 192 decoded; `id` over 128 bytes or 8 levels. A report within every limit applies, at the limit itself included. A Terminal holds at most 256 records: the 257th applied record evicts the least recently updated one. Test: `ps2_limits_drop_whole_reports_and_the_record_cap_evicts_the_oldest` in `crates/terminal/tests/`, with reports at, one byte under and one byte over each limit. Policy: the limits are the protocol's; a later scenario changes them.

**PS3 replace and clear.** Given records in a Terminal, then a report replaces the record of its `id` whole (a field the new report omits is gone, not kept). `state=clear` removes the record of its `id` and every record below it (`build` removes `build/lint`); `clear` without `id` removes every record of the Terminal; `clear` of an absent `id` changes nothing. Tests: `ps3_a_report_replaces_its_record_whole` and `ps3_clear_removes_a_record_and_the_records_below_it` in `crates/terminal/tests/`. Policy: `clear` with a path removing the records below it is chosen here; rev 0.4 says only "removes records".

**PS4 lifetime.** Given records, then `working` and `blocked` records are dropped when the Terminal's program exits and when the mirror reads OSC 133 `A` (a new shell prompt); `done` and `error` records survive both. A full reset (`ESC c`, RIS) removes every record. Each drop emits one change when it removed a record. Tests: `ps4_working_and_blocked_drop_on_exit_and_on_a_new_prompt_and_done_and_error_stay` and `ps4_a_full_reset_clears_every_record` in `crates/terminal/tests/`; a Terminal running the X15 shell integration (`scenarios/terminal.md`, X15) is the real-prompt case.

**PS5 feature detection.** Given a program that writes `ESC ] 7501 ; ? ST`, then the Terminal's input receives exactly one reply, `ESC ] 7501 ; ? : states=idle,working,done,blocked,error,clear : kinds=permission,question,auth` followed by the terminator the query used, and the reply holds nothing from any report. A report, valid or not, writes nothing to the PTY. A `?` with more bytes after it is not a query and is answered with nothing. Tests: `ps5_the_query_gets_the_fixed_reply_and_nothing_else` and `ps5_no_report_writes_to_the_pty` in `crates/terminal/tests/`, alongside X17's reply path (`x17_a_colour_query_gets_one_reply_in_the_current_scheme`). Policy: the reply spelling is chosen here (rev 0.4 fixes only that it holds `?`, the states and the kinds).

**PS6 other output is unchanged and the cost is bounded.** Given a Terminal that prints OSC 0, OSC 7, OSC 133 marks and ordinary text between and inside reports, then titles, marks, cwd and output bytes are as without reports; the output stream and `terminal.snapshot` still carry the report bytes untouched, so the App's emulator sees them as it sees any unknown OSC. A program that writes 100000 reports with distinct `id`s holds at most 256 records, and memory stays within the cap of PS2. Tests: `ps6_other_osc_handling_is_unchanged_beside_reports` and `ps6_a_flood_of_reports_stays_within_the_record_cap` in `crates/terminal/tests/`. Observer: `just perf` holds `write_to_output_p95_ms` (`crates/perf/budgets.json`) and keystroke-to-render (rule 7). Regression checks on main: `x4_title_is_emitted_and_listed` (`crates/terminal/tests/scenarios/title.rs`) and `x15_a_command_prints_the_four_marks_with_its_exit_code_and_the_directory` (`crates/terminal/tests/scenarios/shell_marks.rs`).

**PS7 records fold into one Terminal Status.** Given a Terminal's records (PS1–PS4), when `crates/rupd` folds them, then:

1. **Kind.** `idle`, `working`, `done` and `error` map to the Kind of the same name; `blocked` maps to `needs-you`, whatever its `kind`. A report never yields Kind `blocked`: that Kind stays rupd's, from Todos and Routes (ADR 0006, A33). `clear` is no Kind: it removes records.
2. **Roll-up.** The Terminal's Status takes the most urgent Kind among its records, in the order `error`, `needs-you`, `working`, `idle`, `done` (the Glyph's, `scenarios/agents.md` Kind); of equal Kinds the most recently applied record wins. A Terminal with no record has no program status.
3. **Label.** The label is the winning record's `msg`, else its `title`, else empty (the App then shows the Kind's own word). It is one line, never longer than 200 characters (cut with `…`), and is held as text, not markup.
4. **Since.** `since` is the time the rolled-up Kind last changed; a report that leaves the rolled-up Kind as it was leaves `since` as it was. `finished` is `"0"`.
5. **`progress`, `app` and `kind`.** They are held on the record and shown by no surface in this lesson (policy; the App may show them in a later scenario).

Tests (`ps7_`, Rust, `crates/rupd/`): `ps7_each_state_maps_to_its_kind_and_blocked_to_needs_you`, `ps7_the_most_urgent_record_wins_and_ties_go_to_the_latest`, `ps7_label_is_msg_then_title_and_is_cut_to_one_line`, `ps7_since_changes_only_when_the_kind_changes`. Observer: the Rust tests, fed records through the mirror's change.

**PS8 publication.** Given a Terminal with a program status, then (Contract recipe of `.agents/builder.md`; `crates/contracts`, regenerated `contracts/generated/`, every caller in the same PR):

1. `terminal.list` returns it as `status` on that Terminal's entry, and the Rail node of the Agent that owns the Terminal carries it for PS9 (a Terminal is never a Rail node: A10, X11); a Terminal with no program status has no `status`;
2. a new event `terminal.status {id, status}` is emitted when the Terminal's Status changes, with `status: null` when its last record is removed;
3. what a record causes outside the Terminal is rate-limited: at most one `terminal.status` per Terminal per 250 ms, the first at once and the last value always delivered after the window (an injected clock decides), and a report that leaves the Status as it was emits nothing; nothing a report holds reaches a log, an OS call or a file;
4. a Terminal's removal or exit-and-removal ends its Status and emits `status: null` once.

Tests: `ps8_terminal_list_carries_a_terminals_program_status` in `crates/rupd/tests/`, `ps8_status_events_are_coalesced_per_terminal_and_the_last_is_delivered`, `ps8_a_removed_terminal_loses_its_status_once` in `crates/rupd/src/program_status/tests.rs`; the generated-contract case (regeneration changes nothing) and `just ready`. Observer: `just perf` holds `rail_tree_10_p95_ms` and `rail_tree_40_p95_ms`, and #5180's fix stays (`crates/perf/budgets.json`). Names to add to `GLOSSARY.md`: **Program status** (code `ProgramStatus`, `terminal.status`, user label "status").

**PS9 Agents keep their Kind.** Given a Terminal that backs an Agent, then:

1. an Agent whose Adapter has a hook Signal keeps the Kind its Signals give: a report from inside its Terminal, of any state, changes neither its Kind, its label nor its `since`, whether sent before, during or after a hook (ADR 0006); the record is held and its roll-up is not shown for that Agent;
2. an Agent whose Adapter has no hook Signal takes the Terminal's Status as an Observation: the Kind of PS7 becomes the Agent's Kind and the label its label, `blocked` from Todos and Routes (A33) still applying over it;
3. an Agent Terminal's exit ends it as before (a stopped Agent is `done`, not `error`).

Tests: `ps9_a_report_in_a_hooked_agents_terminal_never_changes_its_kind` and `ps9_an_agent_without_signals_takes_its_terminals_status` in `crates/agents/tests/scenarios/ps9.rs`, the second with a fake Adapter that has no Signal and so names no vendor (P4: no vendor string outside `crates/agents/<vendor>/`; `loop/rules.sh vocab` passes). Regression checks on main: `scenarios/agents.md`, A1 and A33, whose tests stay green.

**PS10 the Rail and the Terminal tab show it.** Given a Terminal with a program status, when `rail.tree` or `terminal.status` delivers it, then in `apps/desktop`:

1. its Rail row and its tab show the Kind's KindGlyph in the Kind's Ink, as an Agent's row does; the row's name stays the Terminal's name;
2. on hover, focus or selection the row also shows the label and its age (D5), as an Agent's row does; with an empty label it shows the Kind's word;
3. the label is rendered as text: markup stays visible as characters, Unicode direction overrides and isolates (U+202A–U+202E, U+2066–U+2069) are removed, and a label wider than its place is shortened with `…`;
4. a status event updates the row in the same frame, and a burst ends in its last state;
5. the Kind has at most three resting places (F2): Rail row, tab and Needs you;
6. a Terminal with `status: null` shows the row it showed before program status existed.

Tests (`ps10_`, `apps/desktop/src/`, behaviour only): `ps10_a_terminal_row_shows_its_status_glyph_and_label_on_focus`, `ps10_a_label_is_text_with_direction_overrides_removed`, `ps10_a_status_event_updates_the_row_and_a_burst_ends_in_the_last_state`. Layout and looks are the design critic's: it observes the densest seed, a 2000-character label with markup, an unbreakable word and a right-to-left label (`artifacts/ux/ps10/`, dark mode).

**PS11 Needs you, the Switcher and attention.** Given Terminals with program status, then:

1. Needs you (U3770a) holds one entry for each `needs-you` or `error` Terminal, beside Agents, in `attentionOrder`; the entry names the Terminal it came from first, then its label as text (PS10.3); a `working`, `idle` or `done` Terminal adds none;
2. the entry's Open selects and focuses that Terminal, as A3564a does for an Agent; an `error` Terminal's entry has no Retry (a Terminal has nothing to resume);
3. the Switcher orders Terminals with Agents by Kind urgency (PS7.2);
4. P3: a status of any Kind raises no bell, OS notification or Toast, and a routine Kind adds nothing to Needs you; a Terminal leaving `needs-you` or `error` leaves Needs you with its count;
5. OSC 133 Turn marks and OSC 7 cwd keep working in a Terminal that reports (`apps/desktop/src/terminal/turns.ts`, the OSC 133 handler).

Tests (`ps11_`, `apps/desktop/src/`): `ps11_needs_you_lists_needs_you_and_error_terminals_with_their_names`, `ps11_open_focuses_the_reporting_terminal`, `ps11_routine_kinds_add_no_entry_and_no_interruption`, `ps11_a_reporting_terminal_keeps_its_turn_marks_and_cwd`. Observers: the design critic's captures of PS10 and PS11 on the densest seed, and a real-Daemon run (the U144 harness) in which a shell runs `printf '\e]7501;state=blocked:kind=question:msg=%s\e\\' …` and the Rail row and Needs you entry appear, then `state=clear` removes them. Regression checks on main: `scenarios/ui-inbox.md`, U3770a–U3770d, whose amended tests stay green, and `scenarios/native-questions.md`, A3564a. The Top ten tasks keep their press counts.

**PS12 the dock badge and the tab count it, with its age.** Narrows U182 and U10. Given Terminals with program status, then in `apps/desktop`:

1. the Project tab's counts (U182's `n` and `m`), its Tab mark (U398) and the Dock badge (U10) count each `needs-you` Terminal with the `needs-you` Agents and each `error` Terminal with the `error` Agents, so one Terminal reporting `state=blocked` makes the badge 1 and the tab's tooltip `1 needs you; 0 have errors.`; a `working`, `idle` or `done` Terminal adds none; a Terminal leaving `needs-you` or `error` leaves the counts in the same frame;
2. the counts and the entries of Needs you (PS11.1) agree: for any set of Agents and Terminals the badge equals the number of attention entries of `attentionOrder` that are not dismissed (U5151c);
3. a Terminal's own tab shows the label and its age (D5) on hover, focus or selection, as its Rail row does (PS10.2); with an empty label it shows the Kind's word.

Tests (`ps12_`, `apps/desktop/src/`): `ps12_a_blocked_terminal_counts_in_the_tab_and_the_dock_badge`, `ps12_counts_equal_the_attention_entries_for_agents_and_terminals`, `ps12_a_terminal_tab_shows_its_status_label_and_age_on_focus`. Regression checks on main: `u182_` and `u10_dock_badge.test.tsx` stay green; PS10 and PS11 tests. Layout and looks are the design critic's. Moves: D5.
