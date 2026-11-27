# UI: Space reads on, a viewed row leaves the list, and a row's dot opens its first flagged line (U8011a–U8011c)

Module: `apps/desktop/src/changes/` (`ChangesView.tsx`, `ChangedTree.tsx`, `ModuleScroll.tsx`, the key handling, `copy.ts`), the fake App. Ids: U8011a, U8011b, U8011c. Work order: [#8011](https://github.com/roundup-app/roundup/issues/8011), after #8010 (open on code); the chain continues with #8012 (change map). Owner, 2026-11-26/27, on the Changes list: "Too many steps to reach code"; on draft 2: "fits but now we need to optimise interactivty and ux and user steps to goal"; decided 2026-11-27: "Yes, Space reads on", "Hide, with a toggle to show", "A: at its first flagged line". No Daemon method, Message or contract change: the steps read the listing, the marks (U7680c) and the flagged lines the view already holds. Size: about 450 changed lines.

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**U8011a Space reads on and marks at the item's end.** Given the open view, the lens fixture (U7679), an open item taller than the pane and the fake App, then:
- **Scroll.** With focus in the list or the diff and no note field, text input or editor holding focus (U7680a), Space scrolls the open item down by one pane height and Shift-Space up by one, and neither marks anything. Space mid-item marks nothing, and no `agent.compareFile` call is made beyond what the scroll reads (U7678c). Asserted in `u8011a_space_mid_item_scrolls_and_marks_nothing`.
- **End.** Space with the item's last line already in view marks the item viewed and opens the next unviewed item exactly as V does (U7680a, U7680b), the next lens included, with focus as J gives it. A press that scrolls to the end only scrolls: the mark takes a further press. Asserted in `u8011a_space_at_the_items_end_marks_it_and_opens_the_next_unviewed_item`.
- **Shift-Space.** Shift-Space at the top of an item does nothing, and at no point un-marks a viewed item. Space at the end of an item already viewed opens the next unviewed item and leaves the mark, as V on an item twice would not. Asserted in `u8011a_shift_space_scrolls_back_and_never_un_marks`.
- **Nothing left.** With no lens holding an unviewed item, Space at the end changes nothing and the header reads "All M viewed" (U7680b's "Nothing left"). Asserted by `u7680b_the_last_mark_leaves_focus_where_it_is`.
- **Typing.** In a note field Space types a space and marks nothing; on a button or the lens switch Space is that control's own (U7679e). Asserted in `u8011a_space_in_a_note_field_types_a_space`.
- **Keys list.** The ? list gains "Space reads on: scroll, then mark viewed and open the next item" from `copy.ts`. Asserted in `u7679e_the_keys_list_names_the_lens_and_find_keys`, edited for that line.

**U8011b a viewed row leaves the list, and a toggle shows it again.** Given the lens fixture, the fake App and two viewed items, then:
- **Leaves.** In every lens a viewed item's row (U7680a) is not in the list; the noise rows (U7678b) stay. "N of M viewed" still counts every item (U7680a's "Progress"). Asserted in `u8011b_a_viewed_row_leaves_the_list`.
- **Open item.** The open item stays listed while it is open, though viewed, and leaves when another item opens. Marking an item opens the next unviewed one (U7680b), so the marked row leaves at once. Asserted in `u8011b_the_open_item_stays_listed_until_another_opens`.
- **Toggle.** The list's header holds an icon button with a tooltip and an accessible name from `copy.ts`, drawn pressed (`aria-pressed`) while viewed rows show; it defaults to not pressed for each opening of the view. Pressing it lists the viewed rows again in list order, each with its ✓, and pressing again hides them. The toggle shows only when the open lens holds a viewed item. Asserted in `u8011b_the_toggle_lists_the_viewed_rows_again`.
- **Changed.** A row un-marked by a change (U7680d) is unviewed and returns to the list with its restore glyph; un-marking an item by V or its button keeps it open and so listed (U7680a). Asserted in `u8011b_a_changed_item_returns_to_the_list`.
- **Keys.** J, K, Up and Down walk the rows the list shows (U8010c); with the viewed rows hidden they skip them, and with the open item viewed and listed they step from it. Policy for the rest; the walk is asserted in `u8011b_the_open_item_stays_listed_until_another_opens`.

**U8011c a row's dot opens the item at its first flagged line.** Given the lens fixture, an item holding a note, a repeat, a finding, a moved block or a risk mark (U7676d, U7685, U7700c, U7696b, U7704b), and the fake App, then:
- **Dot.** Clicking the dot (U8034's icon) of a row opens that item, reads its files as opening does, scrolls the first flagged line of the item in scroll order into view and puts the focus on it, the line `]` would reach (U7678d). `]` and `[` go on from there as built. Asserted in `u8011c_clicking_a_dot_focuses_the_first_flagged_line`.
- **Row.** Clicking elsewhere on the row, or Enter, opens the item at its top as U8010a does, with focus in the list. Asserted in `u8011c_clicking_the_row_focuses_the_items_top`.
- **Open already.** Clicking the dot of the open item moves its focus to its first flagged line without reloading it. Asserted in `u8011c_clicking_the_dot_of_the_open_item_moves_to_its_flagged_line`.
- **Keys and name.** The dot is a pointer target only, so the row stays one stop in the tab order and its accessible name still says each signal (U8009a); the keys reach a flagged line by `]` from the item's top. Policy.

**Amended.** U7680a ("Marking": Space joins V as a way to mark, only through U8011a's end), U7680b ("Next": Space at an item's end is the other way to mark that opens the next unviewed item), U7679e (the keys help list), U8009a ("Dot": the dot is a click target). Kept: U7679, U7680c to U7680f, U8009, U8010, the batch and notes.

Not wanted: Space acting while a note field, text input or the editor holds focus; a mark that Space makes without reaching the item's end; Shift-Space un-marking; a viewed row sinking to the list's bottom or staying in place; a Daemon method or contract change; a Vitest test of looks (rule 10).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-viewed.md`, U7680a, U7680b and U7680d: the marks, the next item, the change that un-marks.
2. `scenarios/ui-changes-lenses.md`, U7679e: the keys and the ? list.
3. `scenarios/ui-changes-modules.md`, U7678d: `]` and `[` and the flagged lines.
4. `scenarios/ui-changes-rows.md`, U8009a: the row, its dot and its accessible name.
5. `scenarios/ui-changes-open-on-code.md`, U8010a and U8010c: the landing and the walk this follows.
