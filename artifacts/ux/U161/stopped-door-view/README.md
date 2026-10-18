# Stopped centre: U143 / U161

Baseline: `f87bc1490` (origin/main). Application head: `e8d43edfd`; the following evidence commit changes only captures and this report. Isolated headless Chromium session `builder-39153403242`, fresh profile `/tmp/browser-39153403242`, U26 fake-Daemon harness. This observes the webview.

| Before | After | Why |
| --- | --- | --- |
| Chevron beside Start supervisor / Retry supervisor | Play icon, Token gap and title type | Show a launch action |
| Fixed 28px action height | Token minimum height | Match centre actions |
| Rounded empty-state block | Flat block constrained to pane width | Keep the centre consistent with the App |

Moves: D2, D5, D6. All published Checks pass before and after on the stopped Door at 1280×800, 1440×800 and 1512×950, light and dark. Each PNG has the full `window.__checks()` reading beside it in `base/` or `head/`. No passing Check regresses.

The empty Project and tree-40 failure are also captured at 1512×950, light. All their Checks pass before and after. The dense seed selects backend, injects `failNext(-32003, "Supervisor launch failed: executable unavailable")`, then activates the centre start button. The full failure is visible in the centre and the Rail, with Retry supervisor available.

Main's scenario files, catalogue, Agent history presentation and tests are retained. In particular, `u143_a_failed_start_reads_did_not_start_with_the_message_and_retry` asserts the failed state, both alerts and Retry supervisor; `u143_the_words_tell_the_four_states_apart` asserts the distinct state strings. No test is cut relative to main.

The shorter centre labels require the separate specification #2707 before implementation in #2679. The closed Agent overview remains #2683's work. This styling PR does not close #2679.
