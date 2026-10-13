# U427 Clear placement

Clear preserves selection and opens beside its Workstream row, without a border.

| Capture | Placement |
|---|---|
| [Reason](unselected-workstream-reason.png) | Below auth-refactor at 1280×800, light |
| [Flipped light](clear-flipped-light.png), [dark](clear-flipped-dark.png) | Above payments at 1440×400 |
| [Clamped](unselected-workstream-reason-clamped.png) | Fully visible at 700×260 |

`u427_the_clear_icon_opens_a_visible_reason_prompt_without_selecting` asserts the row anchor, focus, unchanged selection, no premature RPC, viewport clamp and reattachment after resize. `u427_clear_flips_above_its_row_near_the_viewport_bottom` asserts the upper anchor in both themes. Their D1, D2, D5, D6 and D8 readings pass. Rail captures compared with `origin/main` (`848e92e9`) show no Check regression.

Captures: `just capture U426,U427,U428,U429`. Observer: isolated headless Chromium on a fresh profile.
