# UI: the Changes view has two heads, not a band across it (U8026a–U8026d)

Module: `apps/desktop/src/changes/` (`ChangesView.tsx` header and side, `styles.css`, `copy.ts`), the fake App and the U26 harness. Ids: U8026a, U8026b, U8026c, U8026d. Work order: [#8026](https://github.com/roundup-app/roundup/issues/8026), after #8010 (open on code), whose ⌂ and Send notes it places. Owner, 2026-11-27, on the header: "I don't like this bar and find it fluffy honestly and so textual and I don't like that it has a different bg that makes the after look cut"; then "We need to use proper icons too i think". The owner picked this sketch (`[name]` is a `@lucide/solid` icon; hovering an icon shows its words):

```
│ Build Compose-or-r… │ +676 −10   [check] 0/2  [home] [x] │
│ [compare] main [v]  │                                    │
│                     │ src/compose.ts                     │
│ Flows 21  Modules 3 │  12 + const world = …              │
│ Every changed folder│  13 + …                            │
│ ✓ agents   ▮▮▮▯     │                                    │
```

No Daemon method, Message or contract change. Reuse: the App's menu component, `ui/IconButton` and `@lucide/solid`.

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** `<Agent>` is the Agent's name, `<N>` the viewed count, `<M>` the item count, `<pick>` Tree, Branch or Changes. Every word of the heads is read from `copy.ts`. Beside the Agent's name the heads' only text is "main", `+<added> −<removed>` and `<N>/<M>`; tooltips and accessible names keep the full words.

**U8026a the view has two heads and no band.** Given the open view at 560 px or wider, then:
- **Heads.** The list's column is headed by `<Agent>` and the menu button (U8026b); the code's column is headed by `+<added> −<removed>`, the viewed status (U8026c), the Overview icon button (U8010b) and the close icon button. Nothing spans both columns. Asserted in `u8026a_the_list_head_and_the_code_head_hold_their_controls`.
- **Gone.** The header holds no "From", "To" or "changed files" and no file count (amends U7674b's Content clause and U7672c's From label and Switch clauses). Asserted in `u8026a_the_heads_hold_no_from_to_or_file_count`.
- **Ground.** The list's `--sunken` ground runs from the view's top edge to its bottom and meets the code's ground at one full-height vertical edge; no ground edge starts under a head, and no new border line (D8) is added. Policy; the design critic judges it (U8026d).
- **Narrow.** In a view under 560 px, where the list stacks above the code (U7854a), both heads join into one line on top, in the order of the sketch. Policy; the critic judges it (U8026d).
- **Close.** The close icon button and Escape close the view as U7674b's do. Asserted by the tests those ids name.
- **Totals.** `+<added> −<removed>` follows the listing's totals as U7674b's did (U7675c). Asserted by `u7675c_the_rail_count_and_header_totals_follow_the_list` in `apps/desktop/src/changes/u7675_states.test.tsx`.

**U8026b one menu button picks the target.** Given the open view for an Agent and the fake App, then:
- **Button.** The list's head holds one menu button of the current pick's icon, "main" and a chevron. Its accessible name names the current pick and the remote's main (the words come from `copy.ts`; "main" is the remote's main, U7672a). Asserted in `u8026b_the_menu_buttons_name_holds_the_pick_and_remote_main`.
- **Menu.** It opens a menu of Tree, Branch and Changes, each with its icon and its words, on the App's menu component. Picking an item lists that target's files (`agent.changedFiles` for Tree and Branch, `agent.ownedChanges` for Changes), clears the open file and changes the button's icon, as U7672c's switch did. Asserted in `u8026b_picking_an_item_lists_that_targets_files`.
- **Remembered.** The pick is remembered per Agent as U7672d states, unchanged. Asserted by `u7672d_one_agents_choice_never_changes_another` and `u7672d_the_choice_is_remembered_and_falls_back_without_a_worktree`, edited to read the menu.
- **No Worktree.** For an Agent with no Worktree of its own the button offers Changes alone, shows no chevron and opens no menu. Asserted in `u8026b_with_no_worktree_no_menu_opens`.
- **Icons.** One icon each for Tree, Branch and Changes. Assumed (Loop control): the button shows the current pick's icon. Policy.

**U8026c the viewed status is a check icon and `N/M`.** Given the open view with `<M>` items of which `<N>` are viewed (U7680a), then:
- **Status.** The code's head shows a check icon and `<N>/<M>`; its tooltip and accessible name read "<N> of <M> viewed" (U7680a's words), and "All <M> viewed" when every item is viewed. For these heads only this overrides the 11-26 rule that status lines stay words. Asserted in `u8026c_the_viewed_status_names_n_of_m_viewed`.
- **Send notes.** With every item viewed and a note, U8010d's Send notes icon button takes the status's place, unchanged. Asserted by `u8010d_with_every_item_viewed_and_one_note_the_header_sends_one_message`.
- **Words.** Policy: no test asserts the tooltip text beyond the accessible name.

**U8026d the rendered heads for the critic.** Given the U26 harness (`u2540.html?shared` and `?dense`), then at 1512 by 950 and at 388 px, dark and light: the view matches the sketch, no background edge starts under a head, no sideways scroll, and D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U8026d`; evidence under `artifacts/ux/U8026d/`, uncommitted. Policy; the critic judges layout and looks against the sketch, never a Vitest test (rule 10).

**Amended.** U7674b and U7674f ("one header line": two heads, one line each; one line when stacked), U7672c ("quiet From label" and "one switch": the menu button of U8026b), U7854c (the heads' text inset by the spacing Tokens), U7679a ("the header gains only U7680a's count": the code's head gains the status of U8026c), U7680a ("Progress": its words are the status's tooltip and accessible name), U8010b and U8010d (⌂ and Send notes sit in the code's head). Kept: U7672a, U7672d, U7693c (the remote chip stays beside "main", moved with it), U8010a to U8010d's behaviour.

Not wanted: the words "From", "To" or "changed files" in the heads, a new border line (D8), a new Daemon method or contract change, a Vitest test of looks (rule 10).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-remote-main.md`, U7672a, U7672c and U7672d: the target, its switch and its memory.
2. `scenarios/ui-changes-redesign.md`, U7674b and U7674f: the header and the capture.
3. `scenarios/ui-changes-layout.md`, U7854a, U7854c and U7854f: the stacking, the inset and the critic.
4. `scenarios/ui-changes-viewed.md`, U7680a: the progress words.
5. `scenarios/ui-changes-open-on-code.md`, U8010b and U8010d: ⌂ and Send notes.
6. `apps/desktop/src/changes/copy.ts`, `viewedProgress`: the words.
