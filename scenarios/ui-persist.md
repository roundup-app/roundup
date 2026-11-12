# UI: the Rail's layout survives a restart (U100)

Module: `apps/desktop` (the webview). Ids: U100.

Webview only. No App command, no Daemon method and nothing under `contracts/` changes: the webview keeps this state in its own storage: the selected row and collapsed Groups per Project path, the viewer state once for the App (table below). `docs/motion.md` has no row for it, because nothing animates.

**U100 the Rail's layout survives a restart.** Given an open Project whose Rail has a selected row and one or more collapsed Groups (U3, U8), when the webview is closed and opened again on the same Project path, or reopens it after `daemon-exited` (S5, U37), then after the first `rail.tree` the same row is selected, its Terminal shows as a click on it would (U6), and the same Groups are collapsed (U8) and the same head-groups (U172: the Rail's `workstreams`, `modes` and `agents`; kept once for the App, so every Project shows the same ones), all in the frame that first shows the tree: no expand, collapse or scroll animation runs for it, and no row shows expanded and then collapses. Before that tree arrives nothing is selected and nothing is drawn from the saved state. A Door selection also survives; Door folding is a separate U41 follow-up because the current Rail has no collapse control for one.

- Only these two facts are kept: which row is selected and which nodes are collapsed. Drag state, the unfolded `✓ n done` lines (U8), scroll position and open Drawers are not.
- A saved id that is not in the first `rail.tree` is ignored: a selected node that is gone leaves nothing selected (U3), and a gone collapsed node is not collapsed; any saved id that is no Workstream or Group, including a stale `shelf:todos` or `shelf:pads`, is dropped (the head-groups and the Shelf's open tab belong to the App's viewer state, saved apart). The next write drops it from the saved state. A node is never created, selected or collapsed because of the saved state alone.
- A restored selection under a restored collapsed Group is never hidden: that Group is expanded, as U30 does, and the saved state records it expanded.
- Another Project path starts with nothing selected and no Group collapsed, and never reads or changes this Project's saved state. The viewer state is not this state: a Project switch leaves it as it is.

**Each stored family is App or Project.** A new family names its row here (policy; `loop/rules.sh` does not check it).

| Family | Holder | State |
|---|---|---|
| `roundup:viewer` | App | the Rail's width and strip state (U389, U6228), the Shelf's width (U390), open, maximised and tab choices (U370, U373), each Drawer surface's maximised choice (U4698a), the collapsed head-groups (U100, U172) |
| `roundup:app-settings` | App | Settings, including the one Terminal size `⌘+`, `⌘-` and `⌘0` change (U102, U3517d, U3803) |
| `roundup:rail:<path>` | Project | the selected row and collapsed Groups (U100) |
| `roundup:drafts:<path>`, `roundup:unseen:<path>`, `roundup:import:<path>`, `roundup:dismissed:<path>`, `roundup:resumed:<path>` | Project | drafts, finish and unseen marks, imports, dismissals, resumptions |

A change to the viewer state while one Project is active shows in every Project; a Project switch changes, writes and animates none of it (`u389_viewer_state_is_the_same_in_every_project`). An old path-keyed `roundup:widths:`, `roundup:shelf:` or `roundup:terminal-font:` record is ignored, with no upgrade code (#5467).
- Restoring calls no method of its own, only the `terminal.resize` that U13 makes when the restored Terminal first shows, and moves no focus (U41): focus stays where the window put it, and the Rail never reorders. After restore, every selection and collapse behaves as U3, U8 and U30 say, and each change is saved.
- A saved value the webview cannot read is treated as absent and replaced by the next change. When the storage refuses a write, the webview shows one line `✕ <message>` in Ink above the pinned line, as U9 does, and keeps working with the state it holds.

Tests (`u100_`) use the fake App and the U26 harness seeds `agents-10` and `tree-40` with jsdom's storage: mount, select a row and collapse a Group, unmount, mount again on the same path and assert the selection and the collapsed Groups after the first tree; again on another path; with a tree that lost the saved nodes; with an unreadable value; with a storage that throws on write; and assert the fake App saw no call beyond the ones U3 makes and the one `terminal.resize` of U13; plus a saved selection under a saved collapsed Group.
