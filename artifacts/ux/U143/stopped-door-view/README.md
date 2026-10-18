# U143 / U161 stopped Door centre

Isolated headless Chromium session `builder-39157244772`, 1512×950, fake App seam. No native Mac or real Claude observation is claimed.

| Before | After |
| --- | --- |
| Supervisor stopped, exited 0 / Start supervisor | Supervisor stopped, exited 0 / Start |
| Failure state / Retry supervisor | Failure state / Retry |

The centre retains the existing empty-Project composition, primary button and play icon. Rail labels retain their existing names. Closed Agent content belongs to #2683.

All published Checks pass in the adjacent JSON readings: before and after stopped Door in light, stopped Door in dark, injected launch failure, dense tree-40 launch failure, empty Project and held pending start. D1–D10 have no baseline failure or regression. Moves: D2, D5, D6.

`pending.json` records equal pane bounds before and during a held `rail.startDoor`, with `aria-disabled=true`. `failure.png` and `dense.png` retain the injected failure text and centre Retry action. Focused behavioral tests cover pending repeat protection, failed-start retry without creation, signal/code exit, a failed first-launch tree after reload, and Cmd-T inside the selected stopped Workstream.

Retired test: `u143_the_words_tell_the_four_states_apart`, as U143 requests. The five `doorState.test.ts` state-selection tests retain its behavioral proof; the design critic owns wording. No other test is cut.
