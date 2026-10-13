U426–U429 row actions. Baseline: main `66f56358`. Captured with `just capture U426,U427,U428,U429` in isolated headless Chromium.

| Evidence | Captures |
|---|---|
| Icons hidden and shown; every row keeps its top and 28 px height and every name keeps its left edge | `base/` and `head/`: agents-10 and tree-40, 1280×800 and 700×800, light and dark |
| Stopped Door remains a full icon target in the group at 252 px and default 288 px Rail widths | `head/auth-focused-light.png` and `head/auth-focused-dark.png`, plus their `-default` pairs |
| Visible ellipsis before all four icons at 163 px | [long-name-163.png](long-name-163.png) |
| Unselected Workstream opens a visible, focused reason prompt | [reason prompt](../U427/unselected-workstream-reason.png) |
| Agent’s Stop and directory icons | `../U428/` |
| token-rotation stays whole with actions at the right edge, replacing the Pads count on hover and selection | `tokens-{hovered,selected}-{light,dark}-{1280,1440}.png` |
| Missing editor appears in one failure line | [missing editor](../U429/missing-editor.png) |

Every passing baseline Check still passes. D14 passes on both the refreshed baseline and head. `loop/rules.sh delta artifacts/ux/U426/base artifacts/ux/U426/head` exits 0.

The rendered tests also walk every Workstream icon by Tab, activate editor with Enter and folder with Space, and preserve selection. Project tabs and opened Pad/Todo leaves carry no row icons. Rust U429 tests inspect the launch arguments and refusals with the system launcher replaced.

Resting counts keep a `--space-1` (4 px) trailing inset at 288 px and 252 px Rail widths, in light and dark. `counts-resting-*.png` shows the counts; `u426_resting_counts_align_with_the_icon_marks` measures every visible count box and numeral against its row edge. Action targets keep their edge.
