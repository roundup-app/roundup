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

**U3727 New Todo text shares the tick-only title column.** Extends U3726 and U360 for Issue #3086. This serves the first journey's Review stage: adding a Todo uses the same text column as reading one.

- **Shared column (policy).** Given the Shelf's `Todos` list at 1512×950 in dark mode with a root Todo without an external-blocker mark and the `New Todo` entry row open, when the field is empty with its placeholder, contains typed text, or rests with that text, then its first visible character starts at the root Todo title's x within 1 CSS px. Use the field's text edge, including its padding, rather than its border box. One Token-derived tick-to-text column governs every Shelf row pairing a tick box with text, including the entry row and later such rows; it must not depend on the presence of a title button or `.shelf-head`. U3726's drawn-box gap, 24 px hit area and separate title action hold. Rows with an external-blocker mark retain U3726's wider cluster column; nested Todo rows retain U3708's indent and U3726's gap.
- **D12 includes the entry field.** Given `window.__checks()` with that entry row and tick-only Todo rows, when D12 measures left edges, then it includes the field's text edge in the tick-only title group, normalizing tree indentation as before. A difference at most 1 CSS px passes; a larger difference fails, reports the largest difference in px and identifies an offending row. Empty placeholder and non-empty input states are both measured. Existing Glyph-column groups, later-line alignment, and the no-Shelf-row pass remain U360. Implementation test to add: `u3727_d12_measures_the_entry_text_with_tick_only_titles` in `apps/desktop/src/testing/u360_checks.test.ts`, using fixture boxes to exercise aligned, 1 px and greater-than-1 px offsets for empty and non-empty fields. This tests the Check's reporting contract; the critic judges the App's geometry (AGENTS.md rule 10).

Observer (policy): use U26's existing harness, isolated headless `agent-browser` session and fresh profile, at 1512×950 in dark mode. Start with `tree-40` and U3726's densest fixture, including root/child/grandchild rows, an external blocker, long title, description and visible rejected-move error. Open `New Todo`; capture its placeholder, typed text and resting text, and compare its text edge with a tick-only root title. Read `window.__checks()` in each state, including the densest state with the error visible. Run `just capture U3727`, `just capture U3726` and `just capture U3708`; leave PNGs/videos under `artifacts/ux/<id>/` uncommitted as `.agents/data/harness.md`, **Captures**, requires. This Linux/Chromium observer makes no native Mac rendering claim; the user reports what they meet on the Mac.

The implementing change moves these numbered Checks, held on main by `docs/design-system.md`, **The checks**; D12's current implementation is `d12` in `apps/desktop/src/testing/checks.ts`:

1. D2: the shared column uses existing spacing Tokens.
2. D5: title, field, placeholder, mark and focus contrast pass.
3. D6: existing tick/title actions, feedback, focus and hit areas pass.
4. D12: the entry field joins the tick-only title group within 1 px, while external-blocker groups and tree-indent normalization remain distinct as above.

Regression (policy): retain U3726 and U3708's captures and existing behavioral proofs named above, plus U360's Check fixtures. Every design Check passing on main still passes at 1512×950. Run the lints and tests reached by implementation changes under the Code recipe. No creation, completion, nesting, drag, focus, call-count, App command or contract behavior changes are requested. For this editable surface, P11's Gate is whether alignment changes lose or alter unfinished input; its Observer is U3727's typed/resting text with U16's existing creation behavior retained.

Specification validation: `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. Record progress, measurements and command failures on Issue #3086, with one row per failure naming the command, exit code and repair. This specification delivers acceptance only; Issue #3086 remains open for implementation and rendered evidence.
