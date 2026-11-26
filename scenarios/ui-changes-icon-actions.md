# UI: the Changes view draws its actions as icons (U7933a)

Module: `apps/desktop/src/changes/` and its copy. Id: U7933a. Work order: [#7933](https://github.com/roundup-app/roundup/issues/7933). Owner, 2026-11-26: "use proper icons I don't like textual actions like these and close changes that suck". No Daemon method, Message or contract change. Observer: Vitest against the fake App; the design critic judges the icons, never a Vitest test (rule 10).

**U7933a every action in the Changes view is an icon with a name.** Given the open Changes view in each state that shows an action, then:
- **Icon only.** Every action button in `apps/desktop/src/changes/` draws an `Icon` glyph from `apps/desktop/src/ink/Icon.tsx` and no visible text: Close changes, the updated-file line's Reload, the remote chip's Fetch and Retry, Recover notes (`copy.openNotesRecovery`) and the buttons of its dialog, the trace and repeat Retry, Show all, Show anyway, Show whitespace changes, the note and batch actions (dismiss, undo, edit, remove, send, check message history). Asserted in `u7933a_no_action_button_shows_text`, which renders each state and asserts each action button's text content is empty and that it holds an icon.
- **Name.** Each icon button keeps its accessible name from `copy` (the same string the text button showed, or its existing `copy` tooltip such as `copy.editTip`), and a tooltip with that name through `ui/IconButton`; tests that find a button by name keep passing. Asserted in `u7933a_each_icon_button_keeps_its_name`, which finds each button by `getByRole("button", { name })` and asserts its tooltip text.
- **Words stay.** Status lines and messages (`copy.updatedFile`, `copy.remoteMoved`, `copy.fetched`, `copy.traceFailed`) and toggles whose text is their state (a lens, a group, `copy.viewed`'s state) stay words; only actions become icons. Asserted in `u7933a_status_lines_stay_words`.
- **Kept.** Keyboard shortcuts and focus order are unchanged: Escape, Enter, E and Delete act as before and the Tab order matches `main`. Asserted by the existing `u7692_keys.test.tsx` and `u7674_redesign.test.tsx` tests, unedited.
- **Glyphs.** Glyphs come from the installed `@lucide/solid` set through `ink/Icon.tsx`; a glyph the set lacks needs the PR's `Reuse:` section to show it. Policy.
- **No label beside.** No icon button has a text label beside it. Policy: the design critic judges it.

Not wanted: an icon with a text label beside it; a test of looks. The readback action (#7688, PR #7860) already draws an icon and is out of scope.
