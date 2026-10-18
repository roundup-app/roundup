# U143 / U161 stopped centre

Isolated headless Chromium, fresh profile `browser-39150906597`, 1512×950. Base: `42778f757` (`origin/main`); head: this PR. The U26 harness serves the unchanged App seam. These observations claim the webview only.

| Before | After | Why |
| --- | --- | --- |
| Supervisor stopped / chevron + Start supervisor | Supervisor stopped / play + Start | One mention of supervisor; an action icon instead of a disclosure mark |
| A stopped Agent has only the history note | Done or Agent stopped above the retained note | Distinguish state from missing output |
| Centre actions have no icon gap | Shared Token spacing and title type for Start and New Workstream | Match the centre empty-state pattern |

Moves: D2, D5, D6. D1–D10 pass before and after on the stopped Door and Agent in light and dark, and on the empty Project in light. On tree-40, D5 and D10 already fail on main and retain the same failures after the change; the other Checks pass. The failure text itself remains visible. The JSON files also retain D11–D14 and D16.

- [Stopped Door, light](head/door.png), [dark](head/door-dark.png).
- [Stopped Agent, light](head/agent.png), [dark](head/agent-dark.png).
- [Empty Project](head/empty.png).
- [Failed start, dark](head/failure-dark.png): injected `failNext(-32003, ...)`, visible failure and Retry.
- [Pending start](head/pending.png): held `rail.startDoor`, disabled button and one call. The recorded `.pane` bounds are identical before and after.
- [Failure on tree-40](head/tree-failure.png): selected backend, injected start failure, full failure visible. Compare [base](base/tree-failure.png); readings accompany both captures.

The behaviour tests find Start / Retry by button role and catalogue name, assert the selected Workstream id and call count, and prevent repeated pending activation. Launch, retry, direct Agent access and running-Door behaviour retain their existing paths.

Test cuts (rule 10): `u471_action_labels_describe_the_existing_action_start_supervisor` duplicated `u143_a_door_that_exited_reads_stopped_with_its_code_and_start_runs_it_once`; that U143 test remains. `u143_a_failed_start_reads_did_not_start_with_the_message_and_retry` duplicated `u471_action_labels_describe_the_existing_action_retry_supervisor`; the U471 test remains and preserves the supplied failure text. `u143_the_words_tell_the_four_states_apart` is retired as an exact-copy assertion: the five state-transition tests remain, and the design critic owns the words. The earlier-run test drops its CSS-class assertions and retains its history-note and no-Terminal-call checks.
