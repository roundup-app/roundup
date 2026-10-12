U426–U429 row actions. Baseline: main `92232cc9`. Captured with `just capture U426,U427,U428,U429` in isolated headless Chromium.

| Evidence | Captures |
|---|---|
| Icons hidden and shown; every row keeps its top and 28 px height | `base/` and `head/`: agents-10 and tree-40, 1280×800 and 700×800, light and dark |
| Visible ellipsis before all four icons at 163 px | [long-name-163.png](long-name-163.png) |
| Unselected Workstream opens a visible, focused reason prompt | [reason prompt](../U427/unselected-workstream-reason.png) |
| Agent’s Stop and directory icons | `../U428/` |
| Missing editor appears in one failure line | [missing editor](../U429/missing-editor.png) |

Every passing baseline Check still passes. D14 fails on tree-40 in both baseline and head; agents-10 passes every reported Check. `loop/rules.sh delta artifacts/ux/U426/base artifacts/ux/U426/head` exits 0.

The rendered tests also walk every Workstream icon by Tab, activate editor with Enter and folder with Space, and preserve selection. Project tabs and opened Pad/Todo leaves carry no row icons. Rust U429 tests inspect the launch arguments and refusals with the system launcher replaced.
