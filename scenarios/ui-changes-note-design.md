# UI: a designed note, anchored to its lines, with sent notes that stay (U7677a–U7677f, U7956a)

Module: `apps/desktop/src/changes/`, the fake App and its fixtures. Ids: U7677a, U7677b, U7677c, U7677d, U7677e, U7677f, U7956a. Work order: [#7677](https://github.com/roundup-app/roundup/issues/7677), blocked by #7676. Owner, 2026-11-18: "the style of added notes needs work, design and UX wise"; sent notes stay on the diff (the owner's final pick). No Daemon method, Message or contract change: U2540c's one Message per batch stands. The implementation PR's `Reuse:` section names `@pierre/diffs` 1.6.1 line annotations (already used for notes). Capabilities Pierre lacks, found in the prototype on 1.6.1: (a) no line decoration API, so the gutter bar and the noted-line tint go through `unsafeCSS` into its shadow DOM, keyed on `data-line`; (c) `:focus-within` reads false on a form slotted into a line annotation until a blur and refocus, so the note marks its focus with its own attribute. Size: about 600 changed lines. Observer: Vitest against the fake App for U7677a to U7677e; the isolated Chromium harness (U26) for U7677f. Never a native Mac capture.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** The quoted words below are asserted through `copy.ts`, never layout or looks (rule 10).

**U7677a a note reads as attached to its lines.** Given a loaded text diff (U7674) and a saved note, then:
- **Anchor.** Each line of the note's range carries a marker the stylesheet keys on (`data-noted`), also after save and not only while editing; the note renders as the line annotation under the range's last line. The bar (2 px, accent) and the faint tint are drawn from that marker through `unsafeCSS`; no new border (D8). Asserted in `u7677a_noted_lines_keep_their_marker_after_save`, which also asserts the marker leaves when the note is removed.
- **Light surface.** The note and its icon buttons sit inside the diff's light surface scope (U7674d) and take its colours; the notes bar stays in the App's theme scope. Asserted in `u7677a_the_note_sits_in_the_diff_surface_and_the_bar_in_the_app_theme`.

**U7677b a saved note shows its body and one meta line.** Then:
- **Meta.** No header label. The body comes first; under it one meta line "Lines 51-53 · Not sent" (a one-line range reads "Line 51"), and on the old side "Old lines 4-6". "New" is not written. Asserted in `u7677b_a_saved_note_shows_body_then_one_meta_line`.
- **Fold.** A note whose body runs over 6 lines folds to 6 behind "Show all"; Show all opens the rest. A note of 6 lines or fewer offers no Show all. Asserted in `u7677b_a_long_note_folds_behind_show_all`.

**U7677c actions appear on demand.** Then:
- **Hidden at rest.** Edit and Remove are not reachable at rest; on hover of the note or keyboard focus within it they appear as two icon buttons whose tooltips name the keys, "Edit (E)" and "Remove (Delete)" (U510). Asserted in `u7677c_edit_and_remove_appear_on_hover_or_focus_with_key_tooltips`.
- **Click to edit.** A click on the note's text opens the field with that text. The Edit button does the same; Remove removes only that note and offers "Note removed · Undo" as U7676d does. Asserted in `u7677c_clicking_the_text_edits_and_the_buttons_edit_and_remove`.

**U7677d the composer.** Then:
- **Field.** A borderless field on the note surface, with no resize grip, growing with its text to 12 lines and then scrolling. Asserted in `u7677d_the_field_grows_to_twelve_lines_then_scrolls`, which reads the row count the component sets, never pixels.
- **Focus mark.** While the field holds focus the note carries its own attribute (`data-focused`) and the gutter bar turns full accent; no ring is drawn. Asserted in `u7677d_focus_is_marked_by_the_note_attribute`.
- **Footer.** "⌘↵ Save · Esc Cancel" on the left, a Save button on the right, disabled while the text is blank. Asserted in `u7677d_save_is_disabled_while_the_field_is_empty`; ⌘↵ and Esc keep U7676b's behaviour.

**U7677e sent notes stay on the diff.** Given the fake App, then:
- **Sent.** A confirmed accepted response marks the submitted notes Waiting, not Sent, and keeps them: dimmed, meta line "Lines 51-53 · Waiting". A note reads "Sent 14:02" only once its Message lands (U7956a), so Sent claims delivery and acceptance alone claims none (U2540c). Notes added meanwhile stay unsent. Asserted in `u7677e_acceptance_marks_the_submitted_notes_waiting_and_keeps_them`.
- **Unsent only.** The batch, its count and `Send notes: <Agent>` hold unsent notes only; a second send never includes a Sent note, and with none unsent it submits nothing. Asserted in `u7677e_a_sent_note_is_never_sent_twice`. The notes bar's "Sent N notes to <Agent>" line (U7676d) stands.
- **Outdated.** When the Agent rewrites a Sent note's lines, meaning the note's retained source text no longer matches the lines now shown (U2540b's older-context rule), the note reads "Outdated" and folds to one line; its Show all opens it. A note whose lines still match stays Sent. Asserted in `u7677e_a_rewrite_over_the_lines_turns_a_sent_note_outdated_and_folded`, with a fake Agent write.
- **Restart.** Sent notes are kept in the same store as unsent ones (U2773), with their Sent mark, so they come back with the restored unfinished work and are never offered again as unsent. Decided here (P11): losing the Sent mark on restart would offer the same note twice. Asserted in `u7677e_sent_notes_return_marked_sent_after_a_restart`.
- **No clearing.** Nothing clears sent notes in bulk; the user removes one at a time (Remove, with its Undo). Asserted in `u7677e_no_control_clears_sent_notes`, the batch list and the note offering only Remove.

**U7956a a note reads Waiting until its Message lands.** Owner, 2026-11-26: two notes read "Sent 20:15" while rupd held their Message `pending` until the Agent's turn ended; asked whether a note should reach a working Agent at once, the owner chose "No: it keeps waiting, and the Changes view shows Waiting until it lands". Given the fake App and an accepted send, then:
- **Waiting.** While the note's Message is `pending` its meta line reads "Waiting" (copy in `copy.ts`) in place of a time. Asserted in `u7956a_a_note_with_a_pending_message_reads_waiting`.
- **Sent.** When the App receives `message.delivered` for that Message the line reads "Sent HH:MM", the time it landed, with no reload and no other action; no poll is added, the event the App already receives carries it. Asserted in `u7956a_a_delivered_message_turns_waiting_into_sent`.
- **Merged.** A note whose Message is dropped with reason `merged` keeps reading Waiting, and reads Sent when the delivery that merged it lands. Asserted in `u7956a_a_merged_note_reads_sent_when_the_merging_delivery_lands`.
- **Kept.** Sent then Outdated (U7677e) follows as before; rupd's delivery timing, the Message and the contract are unchanged; a Waiting note is never sent twice (U7677e). The Waiting state is stored with the note (U2773), so it returns after a restart and then follows its Message's status. Asserted in `u7956a_a_waiting_note_survives_a_restart_and_follows_its_message`.

**U7677f the rendered notes at 1512 by 950.** Given the U26 harness, App dark and light, then these states draw, each capture prefixed `note-`: draft, saved at rest, saved hovered, editing, sending, sent, outdated, send failed, and a worst case (a 2,000-character note and 50 notes on one file). From a still capture with no hover, a reader can name each note's lines and state. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7677f`; evidence under `artifacts/ux/U7677f/`, uncommitted. Policy; the design critic judges layout and looks, never a Vitest test (rule 10).

**Amended.** U2540c ("A confirmed accepted response clears only the submitted notes"): marks only the submitted notes Sent and keeps them; its pending, rejection and unknown rules stand. U2540b where it names the note's label: a saved note carries no label, only the meta line. U7676d's "Until #7677 builds, an accepted send clears the submitted notes": the submitted notes are marked Sent. U7676c's state words gain "Sent HH:MM" and "Outdated". Kept: everything #7676 built (the gutter +, the keys, the states, the notes bar), U2540b's recovery rules and U2540c's one Message per batch.

Not wanted: a header label on a note, a resize grip, clearing of sent notes, a new border, a new Daemon method; Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-notes.md`, U7676c and U7676d: the states, the bar and its Undo.
2. `scenarios/ui-diff-notes.md`, U2540b and U2540c: the note's retention, older-context rule and the send.
3. `scenarios/ui-changes-redesign.md`, U7674d: the light diff surface.
4. `scenarios/unfinished-input.md`, U2773a and U2773e: restore of unfinished work.
5. `apps/desktop/src/changes/notes.ts`, `notesFor`: the notes store.
6. `PRINCIPLES.md`, P11: the unfinished-input gate.
