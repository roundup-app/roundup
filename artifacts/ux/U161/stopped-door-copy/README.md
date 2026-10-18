# Stopped centre actions: U143 / U161

Baseline: `5816906d1` (main, including #2682 styling and #2707 specification). Isolated headless Chromium session `builder-39156517649`, fresh profile `/tmp/browser-39156517649`, U26 fake-Daemon harness, 1512×950. This observes the webview.

| Before | After | Why |
| --- | --- | --- |
| Supervisor stopped, then Start supervisor | Supervisor stopped, then Start | Name the state once |
| Retry supervisor after a failure | Retry beside the original failure | Keep the action plain |

Moves: D2, D5, D6. `base/stopped` and `head/stopped` pair full screenshots and Check readings; all published Checks pass before and after. Existing Token styling and the play icon from #2682 match the empty-Project action. The Rail keeps its full labels. The closed Agent overview belongs to #2683 under main’s U143 acceptance.

The head captures also cover empty Project, failure in light and dark, and an injected failure on tree-40 with backend selected. Every published Check passes on these captures. The error remains visible in the dense seed. Failure injection: `__fake.failNext(-32003, "Launch failed: executable unavailable")`, then activate the centre button.

`head/pending.observation.json` holds the stopped and pending pane rectangles, the disabled action and full Check readings. Both rectangles are 904×848 at (288,38); starting does not resize the pane. Hold `app.of(app.opened.project.path).handlers["rail.startDoor"]` on an unresolved promise, then activate Start. Behaviour tests prove a second activation calls nothing.

Retired tests: `u143_the_words_tell_the_four_states_apart` is retired as #2707 directs; the five state-selection tests retain its behavioural proof and the critic owns words. `u471_action_labels_describe_the_existing_action_start_supervisor` duplicated `u143_a_door_that_exited_reads_stopped_with_its_code_and_start_runs_it_once`; the retry test retains selected-Workstream and no-creation checks. New U143 tests cover signal exit, fresh reload after failed first launch, and Cmd-T ownership.

No native App or real Claude observation is claimed; the user reports what they meet on the Mac.
