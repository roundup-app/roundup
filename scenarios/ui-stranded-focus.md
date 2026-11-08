# UI: row keys work after a click leaves focus on the page body

Acceptance for #6829, Journey Review. Extends U3723 (`scenarios/ui-shelf-keys.md`, heading U3723) and U460 (`scenarios/ui-shelf-delete.md`, heading U460), which fixed only Backspace for this case. Webview only: no App command, no Daemon method, nothing under `contracts/`. These are implementation obligations, not claims about main.

Policy: a click on a button row in the Webview may leave focus on `document.body`. A key a surface binds to a focused row of that surface then acts on the row the click chose, never on nothing. The fix reuses the stranded-focus test already in `apps/desktop/src/shelf/BulkDelete.tsx` (`strandedFocus`) by moving it to one shared helper under `apps/desktop/src/keys/`; add no second focus tracker, global focus owner or state machine. Modifier, repeat, text-field, Drawer, dialog and menu exclusions of the bound key stay exactly as U3723 and U2241 state them.

**U6829a Shelf row keys work after a click.** Given the Shelf's Todos or Pads tab, a row clicked with the pointer and focus left on `document.body`, then:

- The plain keys `d`, `e` (Pad row only), `↑` and `↓` act on the clicked row as for a focused row (U3723); `e` on a Pad opens the save chooser and calls `pad.export {name, path}` only once a path is chosen; `d` asks once and deletes nothing before it is confirmed.
- With focus on `body` and no row clicked, the keys do nothing.
- The keys stay inert with a modifier, on a repeat, in a text field, a Drawer, a dialog or a menu (U3723).
- Test: planned `u6829a_row_keys_work_when_a_click_leaves_focus_on_body`, table-driven over both tabs and the keys `d`, `e`, `ArrowUp`, `ArrowDown`, with a negative row for each exclusion, in `apps/desktop/src/shelf/`.

**U6829b Rail row keys work after a click.** Given a Rail row clicked with focus left on `document.body`, then the Rail's focused-row keys (`rail.collapse-expand`, `rail.move`, `rail.rename`, `agent.restart-mode`, the row arrows) act on the clicked row, and are inert with a modifier, on a repeat, in a text field, a Drawer, a dialog or a menu. Test: planned `u6829b_rail_keys_work_when_a_click_leaves_focus_on_body`, table-driven over the `inRail` rows of `CHORDS` in `apps/desktop/src/rail/`.

**U6829c Switcher and Project tab keys keep their owner after a click.** Given the open Switcher, and given a Project tab clicked with focus left on `document.body`, then: Switcher keys act inside the open Switcher regardless of which element holds focus (it is a modal layer), and the Project tabs' arrow keys move to the neighbouring tab from the clicked tab. Where the audit finds a key that already works, the test records it with no code change. Test: planned `u6829c_switcher_and_project_tab_keys_work_after_a_click`, in `apps/desktop/src/switcher/` and `apps/desktop/src/header/`.

**U6829d the audit is complete.** Every `CHORDS` row with `inRail` or `inShelf`, and every Switcher and Project tab key, appears in U6829a to U6829c's tables or in a one-line exemption with its reason in the PR. Test: `u6829d_every_row_bound_key_is_in_the_body_focus_table`, reading `CHORDS` only, no mount.

Observer: the named Vitest cases against the fake App; one headless U26 Chromium session on `tree-40`, dark, clicking a Pad row then pressing `e` and `d`. Moves: D6. Linux/Chromium is the rendered observer; the user reports what they meet on the Mac.
