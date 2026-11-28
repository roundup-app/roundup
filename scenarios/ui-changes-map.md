# UI: a thin change map beside the list shows the change's shape and opens an item by its block (U8012a–U8012c)

Module: `apps/desktop/src/changes/` (a map beside `ChangedTree.tsx`, `styles.css`, `copy.ts`), the fake App and the U26 harness. Ids: U8012a, U8012b, U8012c. Work order: [#8012](https://github.com/roundup-app/roundup/issues/8012), after #8011 (steps); the chain is #8009 (rows and tabs), #8010 (open on code), #8011, #8012. Owner, 2026-11-26/27, on the Changes list: "Too many steps to reach code"; decided: "Add it". No Daemon method, Message or contract change: the blocks read the listing, the counts (U7678a) and the marks (U7680a) the view already holds. Size: about 350 changed lines.

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** Each word is asserted through `copy.ts` (rule 10). Layout and looks (the strip's place, width, fill and the open block's darkness) have no Vitest test: the design critic judges them from U8012c's captures.

```
  changes                        ▮▮▮            ▕▒
✓ agents                         ▮▮▮▮▯      •   ▕█
  scenarios  crates/agents/tests ▮▮▮▮▮▮▯        ▕▒▒
▌ agent      +8 −0               ▮              ▕▓
  docs                           ▮▯             ▕▒
```

The strip at the right is the map: one block per item, sized by its changed lines, in list order; ▒ unviewed, █ viewed (filled in), ▓ the open item (darker).

**U8012a the map holds one block per item, and a click opens it.** Given the lens fixture (U7679), the fake App and the open lens's list, then:
- **Blocks.** The map holds one block per item of the open lens, in list order, as a button inside a labelled group (`copy.ts`); the noise rows (U7678b) have no block. A block's height follows the item's changed lines against the whole change, with a floor so a one-line item stays a target; an item whose `counts` are `null` (U7678a) takes the floor. Asserted in `u8012a_the_map_holds_one_block_per_item_in_list_order`; the heights are policy, the critic judges them.
- **Click.** A click on a block opens that item exactly as a click on its row does (U8010a's reading, the item at its top, `agent.compareFile` for its files, focus in the list): one step. A click on the open item's block changes nothing. Asserted in `u8012a_a_click_on_a_block_opens_its_item`.
- **Name.** A block's accessible name, from `copy.ts`, says the item's name, its size ("+<added> −<removed>", or no size when `counts` is `null`) and whether it is viewed ("viewed" or "not viewed"); the open block carries `aria-current`. The name changes when the item is marked. Asserted in `u8012a_a_blocks_name_says_the_item_its_size_and_whether_it_is_viewed`.
- **Keys.** A block is a pointer target and a screen-reader stop only: the list stays the keyboard's way (J, K, Up, Down), so the map adds no tab stop beyond the group's buttons being focusable by Tab in list order. Policy.

**U8012b the map shows progress through the whole change.** Given the lens fixture, two viewed items and the fake App, then:
- **Viewed.** A viewed item's block is drawn filled in (`data-viewed`), an unviewed one open, and the open item's block darker (`data-open`); marking the open item moves `data-open` to the next unviewed item's block (U7680b). Asserted in `u8012b_marking_fills_a_block_and_the_open_mark_moves_on`.
- **Hidden rows.** With viewed rows hidden (U8011b) the map still holds a block for each viewed item, so the map counts every item the header's "N of M viewed" counts (U7680a). A click on a viewed item's block opens it and lists its row while it is open (U8011b's open item). Asserted in `u8012b_viewed_blocks_stay_when_their_rows_are_hidden`.
- **Lenses.** Each lens has its own map from its own list; changing the lens (U7679a) changes the blocks. A lens with no item has no map. Asserted in `u8012b_each_lens_has_its_own_blocks`.

**U8012c the map sits in the scrollbar's place at 1512 by 950 and at 388 px.** Given the U26 harness on the 14-module fixture of U7679f with the flow fixture's files, dark and light, then:
- **Place.** The map is a thin strip on the list's right edge, where the list's scrollbar is; the list's own scrollbar is hidden or overlaid so no second scrollbar stands beside the map, and the map adds no column to the list. The map is never drawn outside the Tokens (rule 8).
- **Captures.** `just capture U8012c` leaves, in dark and light, at 1512×950 and 388 px, the 14-module list with viewed, open and unviewed blocks, a one-line item at the floor and a list taller than the pane. D2, D5, D6 and every Check passing on `main` still hold. The critic judges the place and the looks from them; no Vitest test checks them.
- **Reuse (rule 9).** Before code, the build run weighs `@ui-sdk/solid`'s scroll area (`docs/components/scroll-area.md`, which the tree already sits inside) and a minimap or overview-ruler library against a plain block strip, and names the choice in the PR's `Reuse:` section.

**Amended.** U8009d's sketch ("the strip at the right is the change map (#8012, not this order)") is this order's map. Kept: U7679, U7680, U8009, U8010, U8011, notes and the batch.

Not wanted: a second scrollbar beside the map; a column the map adds to the list; a block per file, per symbol or per line; a Daemon method or contract change; a Vitest test of looks (rule 10).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-rows.md`, U8009a and U8009d: the rows, the sketch and the captures.
2. `scenarios/ui-changes-viewed.md`, U7680a and U7680b: the marks and the next item.
3. `scenarios/ui-changes-modules.md`, U7678a and U7678b: the counts and the noise rows.
4. `scenarios/ui-changes-lenses.md`, U7679a and U7679f: the lens and the 14-module fixture.
5. `scenarios/ui-changes-open-on-code.md`, U8010a: opening an item.
6. `scenarios/ui-changes-steps.md`, U8011b: the hidden viewed rows.
