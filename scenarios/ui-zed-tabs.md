# UI: one flat tab style for Project tabs and Terminal tabs (U2231 to U2235)

Module: `apps/desktop` (the webview: `apps/desktop/src/header/`, `apps/desktop/src/bubbles/`, the shared tab component in `apps/desktop/src/ui/`, `apps/desktop/src/styles.css`). Ids: U2231 to U2235. Terms: Project tab, Tab mark, Terminal, Run (`GLOSSARY.md`). Direction: #2210. The owner on the Project tabs: "the borders and design of the tabs is too annoying not elegant and not native". Shown four drafts (Chrome, Zed, VS Code, Safari compact), the owner picked Zed.

Policy: this scenario supersedes the bordered box and the grey selected ground of U440 and U441, the `--hairline` ruled header of U442, the box in U469's tab chips and the pill in `scenarios/ui-terminal-rename.md`'s scope line. Their other clauses stay acceptance: the Tab mark (U443), one centre line, the 24 px hit height, U382's clip, U183 and U511a's rename, U184's overflow edges, U469's one-Bubble control and U534. Webview only: no RPC method, contract or App seam command. The surfaces use existing Tokens (`docs/design-system.md`, Tokens) with no new colour literal; U441's scoped header Token table is replaced by the roles below, and the implementation run rewrites its rows in the same PR as the Contract recipe says (`.agents/builder.md`). Chromium shows the webview against the fake App (as U131 does), so the observers are rendered pages; the user reports what they meet on the Mac.

**U2231 one tab component.** Given the Project strip and the Terminal tab region (U469), then both render their tabs, their `+` and their close control with one component in `apps/desktop/src/ui/`, wrapping the Ark UI tabs part (rule 9: `@ark-ui/solid` is already the UI library); `header/` and `bubbles/` pass it only content, selection, a Tab mark and handlers.

**U2232 flat bar, selected tab joins the page.** Given the strip with one, three and eight Projects and the Terminal region with one and with eight Runs, in light and dark, with increased contrast, at 1512 by 950, the one supported size (U453), then:

- **Contrast.** Inactive labels keep 4.5:1 against the bar's ground and the selected label against `--ground` (D5), in both schemes. The design critic judges this contrast (AGENTS.md rule 10).
- **Spacing.** Every Terminal tab and the `+ Terminal` button keep one inner padding, equal at left and right, so a tab's name and the `+` sit as far from the divider before them as the tab's × sits from the divider after it; the status mark follows its name by one small gap and sits at least twice that gap from the ×. Judged by the design critic.

**U2233 hover, the plus and focus.** Given the same states, then:

- **Focus.** A tab, the `+` and the close control reached by keyboard show a `--accent` focus ring; a pointer click shows none (`:focus-visible` only). Asserted by `u2233_keyboard_focus_draws_a_ring_and_a_click_does_not`.
- **Checks.** D1 to D8, D10 hold for these controls with rest, hover, focus and pressed states (D6, D7); the only border is 1 px `--hairline` (D8). The design critic judges these Checks over the strip and the Terminal region (AGENTS.md rule 10).

**U2234 rename stays inside the tab.** Given a Project tab (U183) or a Terminal tab (U511a) in rename, then opening the field does not select the tab, in the selected and an inactive tab. Asserted by `u2234_a_rename_field_opens_without_selecting_the_tab` for both surfaces.

**U2235 many Terminal tabs stay inside the centre pane.** Narrows U534 only in tab look; every clause of U534 and U469's Dense layout stays. Given the selected Agent with 8 Runs (seed `bubbles`) and an open Shelf, at 1512 by 950, the one supported size (U453), in light and dark, then extra tabs are reached by keyboard focus, each tab's full name stays its accessible name, shown by the shared Tooltip when cut (U477 allows no new `title=`). Asserted by `u2235_flat_tabs_scroll_inside_the_pane_and_stay_reachable`.

**Retirements and updates (policy).** The implementation run changes the checks that pinned the box or the pill, each naming the test that still proves its then-clause:
- `u440_a_tab_is_one_bordered_box` is retired; `u440_boxed_tabs_keep_passing_checks` is retired; the design critic judges the Checks (AGENTS.md rule 10).
- `u441_hover_colours_the_whole_box`, `u441_dark_selection_is_no_brighter_than_the_rail` and `u441_painted_names_keep_both_insets` are retired with the box and the grey selected ground; the scoped header Tokens they pinned are gone, so `u441_token_surfaces_keep_contrast`, `u441_selected_press_keeps_baseline_checks`, `u441_token_scope_keeps_other_surfaces` and `u441_token_observers_resolve_the_surface` are retired, rendered contrast of every label judged by the design critic (AGENTS.md rule 10) and the focus ring by `u2233_keyboard_focus_draws_a_ring_and_a_click_does_not`.
- `u442_a_hairline_runs_under_the_header` and `u442_the_rule_shows_with_no_project` are retired.
- `u440_a_tab_has_no_project_icon` and the `u469_` and `u534_` tests keep passing and are edited only where they assert a border, radius or ground of the old look.
