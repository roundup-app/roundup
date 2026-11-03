# Pad text colour stays beside its control

Acceptance for [#5808](https://github.com/roundup-app/roundup/issues/5808), extending U5562b (`scenarios/ui-rail.md`, heading **U5562b text colour and highlight have one source form**). Journey stage: Review — read and edit findings in a Pad. This specification adds acceptance only; test names marked planned are not implementation evidence. The implementation Issue stays open until these scenarios are on main and prerequisite #5562 is completed.

**U5808a keyboard dismissal keeps the colour trigger and document.** Given an editable Pad with selected prose in the real editor, when the user focuses the toolbar's Text colour control and presses Enter, then one menu opens, its accessible name resolves to that same live control, and its `aria-labelledby` resolves to that control's unique DOM ID. The trigger's `aria-controls` resolves to the open menu and `aria-expanded` is true. Tooltip focus/hover must not replace that ID or create a second trigger. Test `u5808a_keyboard_open_and_escape_keep_the_colour_trigger` (planned, under `apps/desktop/src/pads/`) asserts this association through the real `PadRichEditor` and shared Menu/Tip composition, not a stub menu.

Given that open menu, when Escape is pressed without choosing a colour, then the menu closes, the same Text colour control remains mounted and receives focus, and its `aria-expanded` is false. Reopen with Enter, dismiss with Escape, then repeat with Space: each opening retains the live association above and each dismissal returns focus to that same control. The selected prose's range and exact Markdown remain unchanged throughout; leaving and reopening the unchanged Pad produces zero `pad.write` calls and preserves its original source bytes (same planned test through the existing editor/App seams). Opening or dismissing must not apply Default, a colour or Highlight. Compare calls after the initial Pad read; menu interactions add no Pad mutation. These are facets of the no-edit dismissal outcome, not new formatting acceptance.

Policy: extend an existing observer where it proves this path without duplicating another test. Keep behavioral assertions to roles, associations, identity, selection, focus, exact source and calls; geometry belongs to U5808b's rendered observer. No test that merely pins an ID string, class, CSS value or fixture is required.

**U5808b the rendered palette follows its toolbar control.** Policy, rendered acceptance: given the dense Pad fixture below at 1512×950, dark, when Text colour is opened by keyboard or pointer, then after library positioning and entry animation settle the palette sits beside that toolbar control, entirely inside the viewport, with every choice visible and reachable. It never remains at the window corner because an anchor cannot resolve. Repeat after Escape/reopen and after scrolling the Pad body while the toolbar remains visible; the palette uses the control's current box, not an earlier editor or scroll position.

Policy: the design critic judges adjacency using the menu and trigger rectangles plus the library's resolved placement and effective offset, recording any collision flip/shift. On the resolved side, the gap between the facing trigger/menu edges equals the effective library offset within 1 CSS px; their projections overlap on the other axis. All menu edges lie within the viewport. Collision handling may flip the side or shift along it to keep the menu visible; it must still be attached to this trigger. These are critic measurements, never geometry assertions in a UI test. Record the rendered menu box, not just a positioner wrapper, so a hidden or zero-sized menu cannot count as evidence.

## Rendered observer

Policy: use the existing U26 App harness, real editor and shared Menu/Tip in an isolated headless Chromium session with a fresh profile. Use the same `tree-40` seed, Pad source, viewport and dark scheme on main and head. The fixture has a 200-character Pad title, selected formatted prose near the start, enough paragraphs to scroll the body by at least one visible body height, and existing colour/highlight wrappers. Record its source and the actual scroll offset so both revisions replay the same state.

Policy: capture these states, with bounded waits on menu mount, library positioning completion and animation completion rather than a fixed sleep:

| State | Observation |
|---|---|
| Keyboard | Focus Text colour, press Enter, capture the settled open palette, press Escape and record focus return. |
| Reopen | Reopen using Enter and then Space, each followed by Escape; record the same trigger/menu association and settled placement. |
| Pointer | Click Text colour, capture the settled open palette, then dismiss with Escape. |
| Scrolled | Scroll the body by at least one visible body height, leaving the sticky toolbar visible; repeat keyboard and pointer openings and record current trigger/menu boxes. |
| Rejected save | On the dense seed, edit separate prose, reject that save through the harness, and show the full cause and recovery action with the recoverable draft. Open the palette in that state; capture its placement and unobscured recovery text, then dismiss without a further write. |

Policy: the planned `u5808b_colour_palette_capture` observer under `apps/desktop/src/pads/` records interaction video, paired main/head screenshots, `window.__checks()` readings, trigger ID, menu labelling/control association, rectangles, resolved placement/offset and scroll state. Register it in `apps/desktop/src/testing/captures.ts` for `just capture U5808a,U5808b`. Record immutable App SHAs and matching observer/fixture metadata. A missing anchor, failed launch, unpositioned palette or positioning wait that expires is an observer failure; record it rather than skipping the state. Leave media under `artifacts/ux/U5808a/` and `artifacts/ux/U5808b/`, following `.agents/data/harness.md`, heading **Captures**; commit no image or video. This acceptance-only PR requires no capture and claims no rendered pass.

Policy: Moves D2, D5 and D6 (`docs/design-system.md`, heading **The checks**): Token spacing, legible palette/recovery text and reachable controls. Use existing Tokens and retain every Check passing on the matching main baseline. Preserve tooltip access, one keyboard control, library-owned placement and existing motion; add no custom menu, anchor tracker, positioning timer, contract or App command. Keep the fixed palette, Markdown serialization, Todo formatting and existing shared-primitive callers unchanged. Do not copy library attributes to bypass composition. Inspect the installed Ark composition APIs and `apps/desktop/src/ui/Menu.tsx`, `Tip.tsx` and `Tooltip.tsx` before implementing. Any necessary shared-primitive scope expansion and its reason go on #5808 before editing it, with rule 9's reuse evidence for added machinery. Chromium proves this observation; the user reports what they meet on the Mac.

## Existing checks and verification

Existing regression checks on main; retain these proofs rather than adding copies:

1. Colour, Default and Highlight selection/source behavior: `apps/desktop/src/pads/u5562ab_formats.test.tsx`, `u5562b_selection_colour_and_highlight` (including its parameterized cases) and `u5562b_colour_action_saves_and_reopens`.
2. Real-editor selection and focus after colour/Highlight, preserving bold and clearing formats: `apps/desktop/src/pads/u5562c_browser.test.ts`, `u5562b_selection_colour_and_highlight_in_the_real_editor`.
3. Existing formatting actions and save/reopen: `apps/desktop/src/pads/u4698b_toolbar.test.tsx`, `u4698b_toolbar_retains_the_eleven_formats` and `u4698b_toolbar_edits_and_reopens_each_format: Pad %s`.
4. Unchanged source and no-op writes: `apps/desktop/src/pads/u147_live_preview.test.tsx`, `u147_an_unchanged_document_keeps_its_source_bytes_and_writes_nothing`.
5. Untouched source and serialization across saves/reloads: `apps/desktop/src/pads/p2544c_source.test.tsx`, `p2544c_only_edited_ranges_change: $name` and `p2544c_repeated_saves_and_reload_preserve_bytes`.
6. Conflict choices and refusal to write implicitly: `apps/desktop/src/pads/u36_pad_conflict.test.tsx`, `p2544d_conflict_choices_preserve_latest_draft` and `u36_typing_more_while_the_line_shows_keeps_the_line_and_blur_sends_no_write`.
7. Rejected-save recovery: `apps/desktop/src/pads/u20_pad_drawer.test.tsx`, `p2544b_failure_preserves_draft_and_retry`.

Policy: applicable P11 gate — does opening, dismissing or repositioning the palette alter unfinished Pad source, selection, identity or conflict recovery? U5808a and checks 1–7 answer it; U5808b adds rendered placement evidence, not a new storage or journey capability.

Policy: the implementation runs `just ready`, the added/changed test files and the named regression guards above (targeted Vitest files/test filters, never a whole suite); CI judges other tests. The specification runs `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. For any failed command or observation, put one row on #5808 with the command/state, actual exit code or observer failure, diagnostic and repair. Progress and unresolved engineering questions belong on that Issue, never in scenario Work tables. The specification PR references #5808 and never closes it.
