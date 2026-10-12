# UI: the Project tab is a box on a ruled header (U440 to U443)

Module: `apps/desktop` (the webview: `apps/desktop/src/header/` and the header rules in `apps/desktop/src/styles.css`). Ids: U440 to U443.

Webview only: no App command, no Daemon method, no `contracts/` file and no Token changes; every colour is a Token in `apps/desktop/src/tokens.css` and every size a space step. Found by the user's report #1093 (2026-10-12): "The project tabs is too undesigned and hover state and icon alignment is broken - also the thing need a border", and "the tab horizontal notification indicator should match that simple small properly placed blue indicator" (Solo's dot). The user picked boxed tabs and a line under the header together, and kept red and amber over one blue dot. Narrows U179 (its "no box, border, background or underline"), U180 and U182; overturns U398 and the Tab mark clause of U401. Chromium shows the webview against the fake App (as U131 does), so the observer is a rendered page. `GLOSSARY.md`'s **Tab mark** changes with this specification.

Seen on `main`: the hover touches the name because the name is a `quiet` button with no inline pad (`--button-inline: 0`, `apps/desktop/src/buttons.css`); the hover covers the name only and the × gets its own square because the tab is two buttons (`header/ProjectTab.tsx`); the × and the `+` sit off the name's line because `.header`, `.strip`, `.tablist` and `.project-tab` align on `baseline` (`header/strip.styles.css`, `apps/desktop/src/styles.css`) and the × is a 24 px `icon` button.

**U440 a Project tab is one box on one centre line.** Given the strip with one, two and eight open Projects (U26 seeds `first-run`, `agents-10`, `tree-40`), light and dark, at 1280 by 820 and 700 by 800, then:

- **One box.** Each tab is one element with a 1 px `--hairline` border, whose name, Tab mark and × are all inside it, with an inset of a space step on each side, so the name never touches the border. The tab's name and × are not separate hover surfaces. Test: `u440_a_tab_is_one_bordered_box`.
- **One centre line.** The name, the × and the `+` have vertical centres within 1 px of the tab's centre; no strip, header or tab rule aligns on `baseline`. The `+` sits on the same centre line as the tabs. Test: `u440_name_close_and_plus_share_a_centre_line`.
- **No icon.** A tab holds no folder or editor icon (those are the Rail rows', #1098). Test: `u440_a_tab_has_no_project_icon`.
- **Unmoved.** The tab's hit height stays 24 px or more, U382's clip and tail, U184's overflow edges and U183's rename field fit inside the box. Test: `u440_clip_overflow_and_rename_fit_the_box`.

**U441 hover and selection colour the whole box.** Given the strip with three Projects, then:

- **Hover.** Hovering anywhere in a tab, × included, sets `--hover` on the whole box and keeps the inset; the × keeps its own hover colour inside the box. Test: `u441_hover_colours_the_whole_box`.
- **Selected.** The open Project's tab has a lighter ground than the others (`--selected`, `--selected-hover` under hover) and stays in full ink; the others stay `--grey` (U179). The ground and the border keep 3:1 against the header's ground and `--grey` text keeps 4.5:1 (D5, U4), in light and dark. Test: `u441_selected_ground_is_lighter_and_keeps_contrast`.
- **U112.** Hovering or selecting a tab moves no other tab: every tab's `getBoundingClientRect` is unchanged. Test: `u441_hover_and_selection_move_no_other_tab`.

**U442 a hairline runs under the whole header.** Given the App with a Rail and panes, then a 1 px `--hairline` rule runs along the header's bottom edge across its full width, with the tabs' bottoms on it, and it separates the header from the Rail and the panes; with no Project open (U2) it still runs under the `+`. Tests: `u442_a_hairline_runs_under_the_header`, `u442_the_rule_shows_with_no_project`.

**U443 the Tab mark is a small dot after the name.** Replaces U180's characters and U398. Given Projects whose Agents are in Kind `error`, `needs-you`, both, `working` and none, then:

- **Dot.** The mark is a filled circle of `--space-2` just after the name, raised to the top of the name's letters, not on the centre line; `--red` for `error`, `--amber` for `needs-you`, absent otherwise. It is not a Glyph: no `KindGlyph`, ring or character. Test: `u443_the_mark_is_a_small_dot_by_the_name`.
- **Kept.** `error` over `needs-you`, an exited Daemon as `error` (U185), the count never shown (U180), the accessible names `error` and `needs you`, and the click (U184) all hold; the dot adds no width change to other tabs (U441's U112 clause). Test: `u443_the_mark_keeps_its_rule_name_and_click`.
- **Contrast.** The dot keeps 3:1 against the tab's ground, selected or not, in light and dark. Test: `u443_the_dot_keeps_contrast`.

Tests (`u440_` to `u443_`) live in `apps/desktop/src/header/`; the U179, U180, U182 and U398 tests that read `◉`, `⊗`, `KindGlyph` or "no border or background" change in the implementing PR, which names each.
