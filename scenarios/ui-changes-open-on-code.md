# UI: Changes opens on the first unviewed item's code, the Overview is a header icon, and a fully viewed tab offers Send notes (U8010a–U8010d)

Module: `apps/desktop/src/changes/` (`ChangesView.tsx`, `ChangedTree.tsx`, `Overview.tsx`, `copy.ts`, the key handling), the fake App. Ids: U8010a, U8010b, U8010c, U8010d. Work order: [#8010](https://github.com/roundup-app/roundup/issues/8010), after #8009 (rows and tabs); the chain continues with #8011 (steps) and #8012 (change map). Owner, 2026-11-26/27, on the Changes list: "Too many steps to reach code"; on draft 2: "fits but now we need to optimise interactivty and ux and user steps to goal". Scope: the list and the header above it. No Daemon method, Message or contract change: the landing reads the listing and the marks the view already holds, and notes go by the same batch and the same Message as today (U2540c).

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**U8010a opening Changes shows the first unviewed item's code.** Given the lens fixture (U7679), the fake App and an Agent with no remembered place, then:
- **Landing.** The view opens the first item of the open lens's list (the lens last used, U7679c) that is not viewed (U7680a), at its top, with focus in the list, and calls `agent.compareFile` for that item's files before any click or key. With two unviewed modules the first one's scroll shows and the second's files are not read. Asserted in `u8010a_the_view_opens_on_the_first_unviewed_items_code_with_no_click`.
- **All viewed.** When every item of the open lens is viewed, the view opens the lens's first item. Asserted in `u8010a_with_every_item_viewed_the_view_opens_the_first_item`.
- **Changed group.** A view whose Compare value or group changes (U7674e) lands the same way, from the marks that comparison holds (U7680c). Asserted in `u8010a_a_changed_comparison_lands_on_its_first_unviewed_item`.
- **Kept.** Reopening for an Agent with a remembered place restores it (U7679c's "Reopening"), and a lens with no item opens its empty state (U7679c's pane line "No changes in <lens>"). Asserted by the tests those ids already name; no test is added.
- **Replaces.** U7679c's "Landing" (the Overview of the lens last used, no `agent.compareFile` call) reads as this clause; `u7679c_the_view_opens_on_the_overview_of_the_lens_last_used` is replaced by `u8010a_the_view_opens_on_the_first_unviewed_items_code_with_no_click`. U7679a's "Keeps" and "A module the new lens lacks" read: opens the new lens's first unviewed item, else its first item, in place of "the Overview row". U7679c's "A module leaves" falls to the neighbour, and with none to the open lens's empty state, in place of the Overview row.

**U8010b the Overview is a header icon, and the list holds items only.** Given the open view and the fake App, then:
- **Icon.** The header holds a ⌂ icon button, with its tooltip and accessible name from `copy.ts` ("Overview"), that opens the Overview pane (U7679c's "Pane", unchanged) from any open item. Choosing a module in the pane opens it as before. Asserted in `u8010b_the_home_icon_opens_the_overview_and_choosing_a_module_opens_it`.
- **List.** No lens's list holds an Overview row: it holds the item rows, then the noise rows (U7678b). Up and Down, a click and Enter on a row open that row's item. Asserted in `u8010b_no_list_holds_an_overview_row`, replacing `u7679c_the_overview_row_is_first_in_every_lens_and_never_takes_a_mark_or_a_place`.
- **Still no item.** The Overview takes no mark and no note and V does nothing there (U7680a's "No item"), and the Overview's brackets, Enter and Tab walk are U7679e's, unchanged; Shift-Tab from the pane's first entry goes to the ⌂ button in place of the Overview row. Asserted by the tests those ids already name, `u7679e_in_the_overview_brackets_do_nothing_and_tab_walks_its_modules` edited for that one stop.
- **Words.** The tooltip, the accessible name and the keys line (U8010c) are read from `copy.ts`. Policy: no test asserts their text.

**U8010c J and K walk the items only.** Given the open view with no note field, text input or editor holding focus, then:
- **Wrap.** J on the last item opens the first item, and K on the first item opens the last, never the Overview; the Overview open, J opens the first item and K the last. A noise file open, J opens the first item and K the last module item (U7679e's noise rule, with the Overview gone). While a find holds letters they step the shown items, wrapping, and with the open item not among them J opens the first and K the last. Asserted in `u8010c_j_from_the_last_item_wraps_to_the_first_and_never_to_the_overview`, replacing `u7679e_j_and_k_step_the_overview_and_the_modules_and_skip_noise_rows`.
- **The ? list.** Its J and K line reads "J and K go to the next and the previous item." in `copy.ts`, replacing "J and K go to the Overview, then each module." and "Up and Down move between the Overview and the modules." reads "Up and Down move between the items." Asserted in `u7679e_the_keys_list_names_the_lens_and_find_keys`, edited for those words.

**U8010d a fully viewed tab offers Send notes.** Given the open view, the fake App and a lens whose items are all viewed (U7680a), then:
- **With notes.** The header's progress ("All N viewed") gives way to a Send notes icon button, with its tooltip and accessible name `copy.sendNotesTo(<Agent>)` as U2540c's batch button reads, and pressing it sends the note batch as one Message exactly as the batch's button does: one `message.send` call, the same text and the same failure and retry states. With one note and every item viewed, the header holds the button and no progress text. Asserted in `u8010d_with_every_item_viewed_and_one_note_the_header_sends_one_message`.
- **No notes.** With no note the header reads "All N viewed" and holds no button. Asserted in `u8010d_with_every_item_viewed_and_no_note_the_header_reads_all_viewed`.
- **Not yet.** With an unviewed item left, the header reads "N of M viewed" whatever the notes (U7680a's "Progress"), unchanged. Asserted by `u7680a_the_header_reads_n_of_m_viewed_then_all_m_viewed`.
- **Kept.** The batch's own button, its notes and U2540c's delivery are as built; this button is a second way to the same batch, and pressing either leaves one batch, never two. Marking Viewed opening the next unviewed item (U7680b) is as built. Asserted by the tests those ids name.

**Amended.** U7679a ("Keeps"; "the Overview, which every lens lists"), U7679c ("Row", "Landing", "A module leaves"), U7679e ("J and K", the ? list's J and K line and Up and Down line), U7680a ("No item": the Overview is a header pane, not a row), U7680b ("Nothing left": with every item viewed the open item and focus stay and the header holds Send notes with a note, else "All M viewed"). U8009c's "No change to the open item" is this order's U8010a. Kept: U7679b, U7679d, U7680c to U7680f, U7683, U8009, notes and the batch.

Not wanted: a text button (icons with tooltips, owner 11-26), a change to how notes are sent, a Daemon method or contract change, a Vitest test of looks (rule 10), the steps to code (#8011) and the change map (#8012).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-lenses.md`, U7679a, U7679c and U7679e: the lens, the Overview and the keys.
2. `scenarios/ui-changes-viewed.md`, U7680a to U7680c: the marks, the next item, the progress.
3. `scenarios/ui-changes-rows.md`, U8009c: the tabs this follows.
4. `scenarios/ui-diff-notes.md`, U2540c: the batch and its one Message.
5. `apps/desktop/src/changes/NoteBatch.tsx`, `NoteBatch`: the batch's Send button.
6. `apps/desktop/src/changes/copy.ts`, `viewedProgress` and `sendNotesTo`: the words.
