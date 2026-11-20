# UI: the Changes view draws every state, keeps each file's place and answers the keys (U7675a–U7675g)

Module: `apps/desktop/src/changes/`, the fake App and its fixtures. Ids: U7675a, U7675b, U7675c, U7675d, U7675e, U7675f, U7675g. Work order: [#7675](https://github.com/roundup-app/roundup/issues/7675), blocked by #7674. Owner, 2026-11-18: "make it smooth and fully functional with clear convenient states that matches user expectations". After U7674 the view is right when all goes well; this draws the other cases a view that watches an Agent meets all day: a comparison that fails, a file that changes under the reader, a list that moves while the user reads. No Daemon method, Message or contract change. The implementation PR's `Reuse:` section names `registerKeys` for keys; `@pierre/diffs` 1.6.1 has no focus row, so keyboard line focus (each file's focused line, `]` and `[`) is built from its `setSelectedLines` and `getLinePosition`, and the PR says where it leans on them. Size: about 700 changed lines (states 300, scroll and line memory 100, keys 80, tests 220). Observer: Vitest against the fake App for U7675a to U7675f; the isolated Chromium harness (U26) for U7675g. Never a native Mac capture.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** `<From>` is the From label (U7672c), `<To>` the shown switch value, `<Agent>` the Agent's name, `<file>` the file's path. Each state below shows the quoted words; a test asserts the words through `copy.ts`, never layout or looks (rule 10).

**U7675a the view draws each of its states in plain words.** Given the fake App, then:
- **Opening.** While the first listing is pending nothing shows for 150 ms; after 150 ms a "Comparing" line shows, and a listing that answers sooner never shows it. Asserted in `u7675a_opening_names_comparing_only_after_150_ms`.
- **Loaded.** A listing with files shows the header and tree of U7674 and opens the first file. Kept: `u7674a_the_first_file_opens_and_focus_lands_in_the_tree`.
- **No changes.** A listing of no files says "No changes against <From>"; in Tree (U7672a's working tree target) it says "Everything in <Agent>'s folder matches <From>". Asserted in `u7675a_an_empty_listing_says_what_it_matches`.
- **Comparison failed.** A failed listing says "Couldn't compare <From> with <To>", the cause in full and a Retry that reads again; a successful Retry shows the listing. Asserted in `u7675a_a_failed_comparison_names_its_cause_and_retries`. The failure line is U80's and U7314c's, the cause never shortened.
- **Folder gone.** An Agent whose folder no longer exists says "<Agent>'s folder no longer exists" with Retry; Retry that finds it still missing adds "Checked again: it is still missing", and one that finds it shows the listing. Asserted in `u7675a_a_missing_folder_says_so_and_retry_checks_again`.
- **Close stays.** Every state above leaves the close button and Escape working (amends U2540a's "leave Back and Close usable": Back is gone, U7674a). Asserted in `u7675a_every_view_state_keeps_close_usable`.

**U7675b the file pane draws each state of a file in plain words.** Given an open view and the fake App's `agent.compareFile`, then:
- **Loading.** The previous diff stays on screen until the next file's diff paints (U7674e); a loading line naming the file shows only after 150 ms, and a read that answers sooner never shows it. Asserted in `u7675b_loading_names_the_file_only_after_150_ms` and, for the kept diff, `u7674e_up_and_down_never_blank_the_pane`.
- **Added, deleted, renamed.** An added file shows its lines as added, a deleted file as removed, and a renamed file shows its old path and its new path ("old to new"). Asserted in `u7675b_added_deleted_and_renamed_files_say_which`.
- **Binary and mode only.** A binary file says it is binary and offers no line note (U2540a); a file whose only change is its mode says so and shows no lines. Asserted in `u7675b_binary_and_mode_only_files_say_so`.
- **Whitespace only.** A text file whose comparison differs only in whitespace says "No remaining difference" with Show whitespace changes, which shows the lines. Asserted in `u7675b_whitespace_only_says_no_remaining_difference_and_can_show_it`.
- **Too large.** A file over the reader's limit says it is too large with Show anyway, which shows it; U5646c's 10,000-line fallback also holds. Asserted in `u7675b_too_large_offers_show_anyway`; the fallback stays in `u5646c_equal_refresh_keeps_fallback_notice`.
- **Changed on disk.** An open file whose entry's `blob` (U7673a) differs from the `blob` it painted, while it stays in the list, says "<Agent> updated this file" with Reload. The pane never reloads by itself: no further `agent.compareFile` call follows the new `blob`; Reload reads once and paints the new diff, and a saved note keeps its original context (U2540b). Asserted in `u7675b_a_file_changed_on_disk_offers_reload_and_never_reloads_itself`.
- **Left the list.** An open file that leaves the list says "<file> no longer differs from <From>". Asserted in `u7675c_when_the_open_file_leaves_its_pane_says_so`.

**U7675c the list moves under a reader without moving the reader.** Given an open view and the fake App's listing changing, then:
- **Focus and scroll stay.** A file that appears in or leaves the list moves neither the tree's focused row nor its scroll offset, when the changed file is not the focused row. Asserted in `u7675c_a_changing_list_leaves_the_trees_focus_and_scroll_alone`.
- **The open file leaves.** The pane says so (U7675b's last clause) and focus moves to the file's neighbour in tree order, the next, else the previous; with no file left, to the view's empty state (U7675a). Asserted in `u7675c_when_the_open_file_leaves_focus_moves_to_its_neighbour`.
- **Counts follow.** The Rail icon's count (U7186c) and the header's file count and totals (U7674b) follow the new list. Asserted in `u7675c_the_rail_count_and_header_totals_follow_the_list`.

**U7675d each file keeps its scroll and focused line across file switches.** Given two files, each scrolled and holding a focused line, then switching to the other file and back restores the first file's scroll offset and focused line; a file never opened starts at its top; a file whose `blob` changed (U7675b) starts at its top after Reload. The memory lives while the view is open (U7675f owns reopening). Asserted in `u7675d_a_file_keeps_its_scroll_and_line_across_switches`.

**U7675e the keys on the ? list do what they say.** Given the open view, with no note field, text input or editor holding focus, then:
- **Up and Down, Left and Right.** Up and Down move the tree's focus (U7674a); Left folds and Right unfolds the focused folder. Asserted in `u7675e_left_and_right_fold_a_folder` and, for Up and Down, `u7674a_up_and_down_open_the_next_and_previous_file`.
- **Tab.** Tab moves focus from the list to the diff, onto the file's focused line (U7675d), the first line when none. Asserted in `u7675e_tab_moves_from_the_list_to_the_diff`.
- **J and K.** J opens the next file and K the previous, in tree order, from the tree or the diff alike, and stop at the last and first file. Asserted in `u7675e_j_and_k_step_files_from_anywhere`.
- **] and [.** `]` moves the diff's focused line to the first line of the next change, `[` to the previous, and the diff scrolls it into view; both stop at the last and first change of the file. Asserted in `u7675e_bracket_keys_step_changes`.
- **Enter.** Enter opens the editor (U2539d). Kept: the U2539d tests of `u2539d_choose.test.tsx`.
- **Esc.** Esc closes the ? list first when open, else closes the view unless a note field holds it (U7674b). Asserted in `u7675e_escape_closes_the_keys_list_before_the_view`.
- **?.** `?` opens a list of these keys, each with its action; N, V and R are not listed until the Issues that build them do. Asserted in `u7675e_question_mark_lists_the_keys`.
- **No motion.** No key action animates: a key's scroll or focus change is instant. Policy; the design critic judges it (U7675g).
- **Notes first.** Typing into a note field (#7676) or the editor never fires a key above. Asserted in `u7675e_keys_do_not_fire_while_typing_in_a_note_field`.

**U7675f closing the view and reopening it restores the place.** Given an open view with a file open, scrolled and holding a focused line, then closing it returns focus to the Rail icon (U7186c), and reopening it for the same Agent opens that file at its scroll and line, with focus in the tree; the open file is restored only while it is still in the list, else the first file opens. Switching Agents or Projects restores that Agent's own place, never another's (U2540a). The memory lasts the App run. Asserted in `u7675f_reopening_restores_the_open_file_its_scroll_and_line`.

**U7675g the rendered states at 1512 by 950 and at 388 px.** Given the U26 harness, dark App, then at 1512 by 950 and at the centre's 388 px minimum each view state and each file state of U7675a and U7675b draws, and so do the worst cases: a 120-character path, a one-letter name, an emoji name, 0 files and 500 files. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7675g`; evidence under `artifacts/ux/U7675g/`, uncommitted. Policy; the design critic judges layout and looks, never a Vitest test (rule 10).

**Amended.** U2540a's state clause ("Loading, no remaining difference, binary content and unavailable Worktree each explain the state and leave Back and Close usable"): U7675a and U7675b hold the states, Back is gone, close stays usable; its Retry on a failed read stays. U2539b's "Open view" clause where it names focus or scroll when the list changes: U7675c. U7186c's "Opens the compare" where it names a state: U7675a. U5558c ("the reader displays the new comparison without a click"): an open file whose `blob` changed offers Reload and never reloads by itself (U7675b); a file the user is not reading still refreshes its entry, and U5558c's planned test `u5558c_worktree_refresh_updates_open_comparison` asserts the offer, not a read. Kept: U7674's header, tree and diff, the lazy reader (U2540d, U3010d), Enter and double click open the editor (U2539d), notes and their recovery rules (U2540b).

No remote and a stale remote main: no state is drawn here. A repository with no remote shows whatever #7672 picks (U7672a's local default branch as From); a remote main that has moved is #7693, which builds after this order, so no freshness is drawn.

Not wanted: a reload of a file the user is reading, a sound, motion on any key action, a new Daemon method; Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-redesign.md`, U7674a, U7674b and U7674e: the header, tree and the no-blank pane this builds on.
2. `scenarios/ui-changes-blob.md`, U7673a: the `blob` that tells a file changed on disk.
3. `scenarios/ui-diff-notes.md`, U2540a, U2540b and U5646c: the state clause amended, note context and the large-file fallback.
4. `scenarios/automatic-updates.md`, U5558c: the open reader's refresh, amended.
5. `scenarios/ui-worktree-changes.md`, U2539b and U2539d: the list's focus clause amended, and Enter.
6. `scenarios/ui-changes-remote-main.md`, U7672a and U7672c: the Tree target and the From label.
