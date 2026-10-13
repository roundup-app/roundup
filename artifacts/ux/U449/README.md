# Shared window bar

U449–U451; Issue #1104. `head/` and `base/` hold 76 matching 1280×800 / 1600×800 cases in light and dark: first run, ten Agents, eight tabs, the dense Rail, each Drawer with either Shelf state, selection, Shelf resize, overflow, tooltip, tab menu, rename, failed rename and exited Daemon.

The refreshed base is main `9bfe7fb9`; the head includes the same Rail and Daemon changes. The head adds the shared row, selected Project — Workstream title and window actions. Every case records rendered boxes and `window.__checks()`. Drawer cases also record opening and closing frames, bounded by the actual transform transition. The observer uses a fresh, isolated headless agent-browser session.

`just capture U449,U450,U451` exited 0 before the final main merge: 2,817 tests passed. After merging main `9bfe7fb9`, the refreshed rendered observer exits 0 with all ten acceptance tests passing; four window-gesture tests also pass. The title stays on the window's midpoint; content and Drawers start at the bar's bottom; traffic-light reservation, overflow, tooltip and menu bounds hold. Failed rename text remains visible below the bar. No Check passing in the matching base case regresses.

Pre-existing failures remain: Pad editor styles expose D1 / D2 / D6 / D7 failures; the long stopped-Workstream fixture exposes D4 and an unmeasurable empty Thread (D11); tab rename exposes D6 / D7. D10 reports those failures. The committed base readings and the comparison test preserve these findings rather than treating them as passes.

These are webview observations. Native traffic lights, Window menu / Mission Control titles and actual movement / zoom require the U451 Mac observer described in `../U451/head/README.md`.

After merging main `a0264d03`, the full capture suite passed 2,846 tests and failed only U370's obsolete lookup for `Show Shelf` inside the header. U449 requires that control below the bar. The repaired test retains its close/reopen assertions in `.content-actions`; the focused U449/U450/U451 capture and Shelf rerun passed all 66 tests and refreshed these captures. The ten rendered checks introduce no regression against the committed base. This main merge changes only loop machinery.

`just check` then exited 0: 1,604 Rust tests, `ALL PROOFS CHECK`, and 2,837 desktop tests passed. Vocabulary and scenario-ID checks passed. U451's native Mac observations remain outstanding.
