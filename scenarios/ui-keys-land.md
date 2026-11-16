# UI: keys land where you think you're typing

Acceptance for #7158. Webview only: no App command, no Daemon method, nothing under `contracts/`. Amends U3787c (`scenarios/ui-mac-expectations.md`, heading U3787c X3) and U40 (`scenarios/ui.md`, heading U40).

Policy (owner, #7158): one rule owns stray keys, `keys/stray.ts`, called by the window-capture dispatcher in `keys/registry.ts`. It moves focus during `keydown`, so the browser delivers the key itself; a key is never re-sent through `terminal.write` or a synthetic event. Hover changes nothing. Type-to-find is dropped from every list outside an open menu or dialog: the Rail, Todos, Pads, the Shelf and the Changes tree no longer move on a letter (open menus and dialogs keep it). Opening a Drawer still moves focus into it (U40); closing it returns the keyboard to the centre Terminal when one runs, and to the row it left only when none does.

**U7158a Navigation puts the keyboard in the centre.** Given a live centre Terminal, then after each of: a click on a Rail row (also on the selected row after focus moved), Enter on a focused Rail row, the Switcher closing on a row, the Switcher closing on Escape, a Todo Drawer closing, a Pad Drawer closing, Settings closing, a typed character reaches that Terminal's input and no `terminal.write` was sent.
- Test: `u7158a_every_navigation_action_puts_the_keyboard_in_the_centre`, table-driven over these ways, in `apps/desktop/src/keys/`.

**U7158b A stray character goes to the centre.** Given a live centre Terminal and focus on a Rail row, a Project tab, a button or the page body, a character with no ⌘, Ctrl or Option moves focus to the Terminal during `keydown` and is typed there once.
- Test: `u7158b_a_character_pressed_on_something_that_takes_no_text_goes_to_the_centre`.

**U7158c Keys that mean something keep their meaning.** ↑, ↓, Tab, Enter, Escape, Space on a button, ⌘K and every key with ⌘, Ctrl or Option act as before and leave focus where it was.
- Tests: `u7158c_keys_that_mean_something_keep_their_meaning`, `u7158c_keys_pressed_with_a_command_modifier_stay_where_they_are`.

**U7158d A text owner keeps every key.** Given focus in an input, a textarea or a contenteditable element (or an open menu or dialog), a typed character stays there.
- Test: `u7158d_a_text_owner_keeps_every_key`.

**U7158e No live centre, no move.** Given a selected Rail row with no Terminal running, a character moves no focus, selects no row and sends nothing.
- Test: `u7158e_with_no_running_terminal_a_stray_key_does_nothing`.

**U7158f A waiting Agent gets the focus and not the key.** Given the centre Agent needs the user, a stray character moves focus to its Terminal, is cancelled and sends no `terminal.write`.
A key typed while focus is already inside that Terminal reaches it untouched.
- Tests: `u7158f_an_agent_that_needs_you_gets_the_focus_and_not_the_key`, `u7158f_a_key_typed_inside_the_waiting_terminal_is_left_alone`.

**U7158g Composed and dead keys arrive whole.** A key during IME composition stays where it is; a dead key moves focus without being cancelled, so the browser composes it in the Terminal.
- Test: `u7158g_a_composed_key_and_a_dead_key_arrive_whole`.

Retired by this Issue: the name-prefix steps of `u3787c_each_list_navigates_visible_rows` (Ask, Importer, Inbox, Changes, Rail inventory and Rail G clause) and `u3787c_name_prefix_precedes_commands`, the final `z` step of `u5645c_keyboard_skips_unavailable_rows` and the final `m` step of `u520_three_level_keyboard_walk` (each now asserts the letter finds no row); each list's remaining steps prove the rest of U3787c X3. The Pierre trees patch keeps its `typeahead` option; the Changes tree no longer sets it.
