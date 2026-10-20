# UI: Todo titles sit beside their tick boxes

Module: `apps/desktop` (webview). Acceptance for Issue #3041. The surface is U3708's Todo tree in the Shelf's `Todos` list; the Rail's Agent-owned Todo rows remain U60. This serves the first journey's Review stage: inspect the resulting Todo without a misleading empty column before its title.

**U3726 a Todo title starts one small step after its tick box.** Policy (rendered acceptance; the design critic judges spacing, not a layout test): given the Todo tree with root rows, children and grandchildren, when reading it at 1512×950 in dark mode, then:

- On a row without an external-blocker mark, the title's first visible character starts `--space-2` (8 CSS px) after the visible tick box's trailing edge. Measure from the drawn box, not the native input's larger hit area. No empty marker column or title hanging-indent padding adds to that gap.
- The same gap holds at every depth: nesting shifts the tick box and title together by U3708's indent step. Rest, hover, keyboard focus and selection do not shift either one relative to the other.
- Where U3712 requires an external-blocker mark, retain it beside the tick box, vertically centred, without overlap; the title starts `--space-2` after that visible cluster's trailing edge. Rows without the mark reserve no space for it.
- Long titles retain U359's two-line limit and truncation; the second line starts at the title's first-line edge. Descriptions, `also waits on` and errors remain readable below the title, without increasing the first-line gap. Hover actions and focus indicators cover no title text.

Policy: this narrows U361's tick-column spacing and U3712's Glyph-column width only as needed for the gap above. Keep the 24 px tick hit area and separate title action. Tree levels, blocker meaning, completion, Tab/⇧Tab nesting, drag order, focus and call counts remain U3708–U3712 and U361. No contract, App command, Daemon behavior or shared Pad/Drawer spacing changes are requested.

## Observer and regression checks

Policy: inspect the rendered App through U26's existing harness in an isolated headless `agent-browser` session with a fresh profile. Use `tree-40` and extend its data for this observation with root/child/grandchild rows, an external blocker, a 300-character title, ten open blockers, a description and a visible rejected-move error. Include rest, hover, keyboard focus, selection and the rejected move. Capture dark before/after states with `just capture U3726` under `artifacts/ux/U3726/`, following `.agents/data/harness.md`, **Captures**; leave PNGs/videos uncommitted. Record measurements and any failed command on the Issue, one row per failure with command, exit code and repair. This is a Linux/Chromium observer; the user reports what they meet on the Mac.

The implementing change moves these numbered Checks, all held by `docs/design-system.md`, **The checks**:

1. D2: spacing and type use existing Tokens, including the gap above.
2. D5: title, mark and focus contrast still pass.
3. D6: tick and title retain distinct pointer/keyboard actions, feedback and minimum hit areas.

Policy: run `window.__checks()` on the densest state with the failure visible; introduce no regression in a Check passing on main. The critic judges gap, alignment, wrapping, clipping and overlap; add no tests of geometry, computed style, colour or exact copy (AGENTS.md rule 10).

Existing behavioral proofs on main remain required: `apps/desktop/src/todos/u3708_nesting.test.tsx` holds `u3708_depth_is_read_from_the_first_blocker`, `u3708_the_other_blockers_show_as_one_quiet_line`, `u3708_the_list_is_a_tree_of_treeitems_with_levels`, `u3708_ticking_a_parent_unnests_its_children`, the three `u3709_` cases, both `u3711_` cases and `u3712_a_blocked_row_has_no_waits_on_line_and_a_centred_marker`; `apps/desktop/src/todos/u361_todo_row.test.tsx` holds `u361_a_tick_box_completes_a_todo` and `u361_nothing_draws_over_a_title_on_hover_or_focus`. These assert behavior and marker presence, not U3726's spacing. Run the lints and tests reached by the implementation's changed files as the Code recipe requires.

Specification validation: `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. This specification delivers acceptance only; Issue #3041 stays open for implementation and rendered evidence.
