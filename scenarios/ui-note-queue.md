# UI: an Agent's note queue (U3780 to U3784)

Module: `apps/desktop` (the webview), with one Daemon change in `crates/messages` (U3782). Ids: U3780 to U3784. Work Issue: #3305. Journey stage: Understand (`.agents/data/journey.md`).

The owner asked for AffectUI's Agent Steering (https://www.affectui.com/components/agent-steering, a paid Pro item): rebuild the look from its public docs, copy no code. The queue is built on what exists, not beside it: a queued note is a user-authored Message to the Agent (B1, B2); waiting notes are the Agent's Messages in `pending` or `held` that the user sent or a Route holds (B3, B32); `Pause` and `Resume` are Takeover (B6), labelled `Pause` and `Resume` in App prose because it is the one hold that exists; ⌘⏎ sends now through `agent.interrupt`. Narrows U531 (`⌘⏎` takes control) only while focus is in the note field. Typing into the Terminal, U12, U107 and B1 to B18, B50 to B52 are unchanged. The plan-steps look for Todos is #3300's; this file covers the queue only. Contract policy (AGENTS.md rule 4): U3782 changes `message.drop` (B3) and every caller in the same PR; no other contract, App command or `GLOSSARY.md` term is added, and the App prose terms go in `copy.ts`. U3782's `drop` of a `pending` Message touches laws M1 (a dropped Message is never typed, and one with an in-flight record is not dropped), M5 and M6 (`dropped` stays terminal and carries the reason `removed`); `proofs/messages/model.bend` gains the event, `LAWS.bend` weakens no law, and `docs/messages.md` agrees.

Pause holds delivery, not the running turn: the Agent finishes the step it is on and takes nothing until `Resume`; stopping a turn is `agent.interrupt`, as before.

**U3780 the queue sits above the field of an Agent's pane and lists what waits.** Given a watched Agent's pane (U12), when it shows, then a note field sits under the Terminal and the queue sits directly above it:

- The field is a `ui/` textarea with the accessible name `Note to <Agent name>`. Typing in it reaches no Terminal write (`terminal.write` call count stays 0) and never starts a Takeover; Typing into the emulator keeps U12 and creates no note. Test: `u3780_the_field_takes_notes_and_never_types_into_the_terminal`.
- The queue lists, oldest first (B7), every Message to this Agent in `pending` or `held` that the user sent, plus the ones a Route holds (U3783); the list is read from `message.list` and `message.sent`, `message.held`, `message.delivered` and `message.dropped`, never from a second store. An empty queue draws nothing above the field (no empty state, no height). Each row is the note's first line with `…` and the whole text as the row's accessible description; a count `N waiting` heads a queue of two or more. Test: `u3780_the_queue_is_the_agents_waiting_messages_in_order`.
- A note longer than 8192 bytes shows the refusal of B1 (`INVALID_PARAMS`) under the field and keeps the text in it; an empty or blank field sends nothing. Test: `u3780_a_refused_note_stays_in_the_field_with_its_cause`.
- The queue and field belong to one Agent: selecting another Agent shows that Agent's queue and a field holding its own draft; no row or text crosses (the Draft law of `GLOSSARY.md`). Test: `u3780_two_agents_never_share_a_queue_or_a_draft`.

Observer: Vitest `u3780_` cases on the fake App seam; the design critic judges the look against the Agent Steering docs and the Checks. Moves: D2, D5, D6. Captures to `artifacts/ux/U3780/`.

**U3781 Enter queues a note for the next step and ⌘⏎ sends it now.** Given the note field with text (U3780), then:

- `Enter` calls `message.send {to, kind: "note", body}` once; the field clears when the result returns, and the row appears from `message.sent`. `⇧Enter` inserts a newline. The Message waits for the Agent's next step as B2 says (delivered at the Agent's next `idle`, all waiting notes as one prompt in id order, B30), so Enter never calls `agent.interrupt`. Test: `u3781_enter_queues_one_message_and_interrupts_nothing`.
- `⌘⏎` calls `message.send` once, then `agent.interrupt {id}` once, in that order, and the note is delivered on the `idle` that follows, together with the notes already waiting, in id order (B30). An Agent already `idle` takes the note by B2 with no interrupt call. If `message.send` is refused, `agent.interrupt` is not called. If a Takeover holds the Agent (Pause or control), the note is also made deliverable with `message.deliver {id}` after the send (B6: the user's call wins). Test: `u3781_cmd_enter_sends_then_interrupts_and_a_refusal_interrupts_nothing`.
- Both keys are bindings of the key registry scoped to the note field, with their hint in `HintLine`; `⌘⏎` in the Rail or Pane (U531) still takes control, and U2241's allowlist gains only these two scoped entries. No handler lives in `terminal/` (U3706). Test: `u3781_note_keys_are_scoped_to_the_field_and_u531_is_unchanged`.
- While `message.send` is pending a second `Enter` sends nothing; the text is never sent twice. Test: `u3781_a_double_enter_sends_one_message`.

Observer: Vitest `u3781_` cases on the fake App seam and a real-Daemon case with a fake `claude` that observes the order of calls and the one prompt typed (`u3781_a_real_daemon_note_is_typed_once_at_idle`). Moves: D5, D6.

**U3782 each waiting note is removable with ×, and Pause and Resume hold the Agent.** Given a queue of two notes (U3780), then:

- The `×` on a row (a `ui/IconButton` named `Remove note: <first line>`, with a `ui/Tooltip`) calls `message.drop {id}` once; the row leaves when `message.dropped` arrives; the other rows keep their order and focus moves to the next row's `×`, or to the field when none is left. A note that was `delivered` meanwhile cannot be removed: the `CONFLICT` shows under the field and the row goes with `message.delivered`. Test: `u3782_remove_drops_one_message_and_keeps_the_rest`.
- Contract change: `message.drop` (B3) also accepts a `pending` Message the user sent, when no in-flight record exists (B39(a)); it becomes `dropped` with the reason `removed`, nothing is typed, `message.dropped` is emitted, and the same call on a `pending` Message of another sender or with an in-flight record stays `CONFLICT`. Only the user may call it. Tests in `crates/messages/src/tests/`: `u3782_drop_of_a_pending_user_message_types_nothing`, `u3782_drop_is_refused_once_the_prompt_is_in_flight`.
- `Pause` (a `ui/` toggle button in the queue's header) calls `takeover.begin {agent}` once; `Resume` calls `takeover.end {agent}` once. While paused, notes sent are `held` for `takeover` (B32), the header reads `Paused`, and a queue with rows keeps them; `Resume` releases them as one batch in id order (B6, B32). The control is the same state as `You control` (U107): pausing shows it, taking control shows `Resume`, and each is undone by `takeover.end`. A failed call leaves the button as it was and shows the cause. Test: `u3782_pause_and_resume_are_takeover_and_show_its_state`.
- Pause does not stop the turn: no `agent.interrupt` is called. `Pause` and `Resume` are not offered for an Agent whose Kind is `done` or `error` (B6: `CONFLICT`). Test: `u3782_pause_stops_no_turn_and_is_absent_for_a_finished_agent`.

Observer: Vitest `u3782_` cases; Rust tests named above; `just proofs` prints `ALL PROOFS CHECK`. Moves: D5, D6, D7.

**U3783 a Door's or the decision-maker Model's note waits in the same queue only when its Route says ask.** Given a note to the Agent from a Door or the decision-maker Model (B50: it goes through the inbox, never the Terminal), then by the Route (B5):

- `auto`: the note is delivered by B50 and does not appear in the queue. `drop`: it is dropped (B4) and does not appear. `ask-first`: it is `held` (B3), appears as a row marked with the sender's Rail name (or `Model`, in App prose `decision-maker`), and offers `Allow` (`message.deliver {id}` once, B3: the transport stays the inbox, B50(f)) and `×` (`message.drop {id}` once). Test: `u3783_only_an_ask_first_note_waits_for_the_user`.
- Such rows sort with the user's notes by id (B7). A Pause does not hide them; `Resume` does not release an `ask-first` row (B6). `Allow` on a row whose inbox is unusable shows B51's cause and leaves the row. Test: `u3783_allow_delivers_one_and_resume_leaves_ask_first_rows`.

Observer: Vitest `u3783_` cases plus a real-Daemon case (`u3783_a_real_door_note_waits_under_ask_first`). Moves: D5.

**U3784 a note glides into the step that takes it.** Given a queue (U3780) and the Agent's step line (U456's formatter, shown in the queue header as `Now: <step>`), then:

- When `message.delivered` arrives for a row the user can see, that row moves with a transform to the step line and fades, in one `--duration-note` with `--ease-note` (Tokens added to `tokens.css`); the remaining rows close up in the same time. It plays on the user's act (`⌘⏎`, `×`, `Resume`) or when the Agent takes the note; it never plays on mount, on selecting another Agent, on reopening the pane or when the queue was off screen. Test: `u3784_a_taken_note_glides_once_and_a_mount_plays_nothing`.
- Several notes taken at once glide as one group, no stagger; a later delivery retargets from the current state and never queues a backlog. A removed note leaves at once without gliding to the step. Test: `u3784_a_batch_glides_together_and_a_removal_does_not`.
- No timer or clock decides when the glide starts or ends: it is a CSS transition on the row's state, and the row leaves on `transitionend`, or at once under `prefers-reduced-motion` (D9). Only `transform` and `opacity` animate. Test: `u3784_reduced_motion_removes_the_row_with_no_transition`.
- `docs/design-system.md` carries the same carve-out as #3300: nothing moves unless the user acted or an Agent took a note the user can see.

Observer: Vitest `u3784_` cases with `matchMedia` forced; `just capture U3784` for a video of one delivery; the design critic accepts or shortens the duration. Moves: D2, D5, D9.
