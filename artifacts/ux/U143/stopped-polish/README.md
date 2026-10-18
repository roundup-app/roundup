# Stopped centre, U143 / U161

Observer: isolated headless Chromium, 1512×950. Base: `23e930fddb6367308f7b3d8f78c9d1191c63bb04`; head: this PR. The fake App seam proves webview rendering and interaction, not native macOS or a real supervisor.

| Before | After |
| --- | --- |
| Supervisor stopped → chevron + Start supervisor | Supervisor stopped → play + Start |
| Output-history note alone for an earlier Agent | Done or Agent stopped above the retained note |

`base/` and `head/` pair stopped-state screenshots and full Check readings in light and dark. `head/failure` injects a failed start with `failNext`, retaining an alert and Retry. `head/agent` observes the earlier-run seed. All Checks pass on these screens.

`dense-failure` uses tree-40 in light, injects a failed create through the Rail's Workstream button, and keeps the failure text visible. Base and head both pass D1–D5, D8–D9, D11–D14 and D16. Both fail D6 (missing hover observation), D7 (three pressed targets, instant false), and therefore D10. There is no new failing Check; D2 and D5 pass on this dense screen.

The existing primary-button and Lucide play patterns are reused. No new control machinery is introduced. The empty Project shares the action spacing and title Token; the Rail keeps its full supervisor action labels.

Removed duplicate copy tests: `u471_action_labels_describe_the_existing_action_start_supervisor` is proved by `u143_a_door_that_exited_reads_stopped_with_its_code_and_start_runs_it_once`; `u471_action_labels_describe_the_existing_action_retry_supervisor` is proved by `u143_a_failed_door_launch_retries_the_same_workstream_without_creating_another`. The catalogue-boundary test remains.
