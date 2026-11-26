# UI: tests hold every Changes action to its icon (U7933b)

Module: `apps/desktop/src/changes/` tests only. Id: U7933b. Work order: [#7938](https://github.com/roundup-app/roundup/issues/7938), from the review of PR #7937. U7933a's rule is unchanged; this scenario asks that its tests cover every action it names. No Daemon method, Message or contract change. Observer: Vitest against the fake App (rule 10: behaviour, roles and names only, never looks).

**U7933b a text label re-added to any Changes action fails a test.** Given each Changes view state that shows an action, then:
- **Icon only, all actions.** `u7933a_no_action_button_shows_text` renders each state and asserts, for Close changes, the updated-file line's Reload, the remote chip's Fetch and Retry, Recover notes (`copy.openNotesRecovery`) and each button of its dialog, the trace Retry and the repeat Retry, Show all, and the note dismiss, undo and check-message-history actions, besides the edit, remove and send actions it holds, that its text content is empty and it holds an `svg.icon`. Asserted in `u7933a_no_action_button_shows_text`.
- **Name and tooltip, all actions.** `u7933a_each_icon_button_keeps_its_name` finds each of those buttons by `getByRole("button", { name })` with its `copy` string and asserts its tooltip text equals that name. Asserted in `u7933a_each_icon_button_keeps_its_name`.
- **Words stay.** `u7933a_status_lines_stay_words` renders the updated-file line, the remote moved, fetched and trace-failed lines and asserts each shows its `copy` text (`copy.updatedFile`, `copy.remoteMoved`, `copy.fetched`, `copy.traceFailed`) as visible text. Asserted in `u7933a_status_lines_stay_words`.
- **One proof each.** Each action is asserted once, in the two tests above; a test file that adds or edits these cuts duplicates (rule 10). Policy.

Not wanted: a test of looks; a new test that starts a browser or process.
