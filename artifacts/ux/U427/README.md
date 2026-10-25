# U427 clear prompt

Issue #3882, main baseline `b2d337467`, isolated headless agent-browser with a fresh profile, dark `tree-40`, 1512×950.

| Failure state | Before | After |
| --- | --- | --- |
| Prompt | relative, y=1308..1524 | fixed, y=358..574 |
| Reason | below viewport | `  Keep payments  `, y=389..414 |
| Cause | below viewport | `Summary timed out.`, y=478..502 |
| Actions | below viewport | normal clear, clear without a summary, Keep, y=506..562 |
| Checks | all pass | all pass, including D2/D5/D6 |

`failure.png` shows the rejected clear with its reason and next actions together. `prompt.png` and `pending.png` show the preceding states. Their adjacent JSON files record bounds and Checks; bounds are observations, never test assertions. Images stay uncommitted for the workflow to attach.

`u427_the_clear_icon_opens_a_visible_reason_prompt_without_selecting` drives pointer actions through the real rendered prompt. It selects payments, opens auth's prompt without changing selection or clearing, keeps auth, then opens payments, submits, emits NOT_ACKED for payments, retains the exact reason, chooses clear without a summary and keeps the rejected prompt. Before the repair, Keep cannot dismiss the offscreen prompt; after it, the pointer path completes. `rail/u350_clear.test.tsx` remains the action and identity proof.

Retired `u426_the_stopped_door_keeps_a_readable_control_beside_the_group`: its label/icon assertions measured appearance. The start/retry action is proved by `u9_actions.test.tsx`; this capture adds no layout assertion. Existing historical captures are unchanged.
