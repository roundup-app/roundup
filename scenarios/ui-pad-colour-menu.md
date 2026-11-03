# Pad text colour stays beside its control

Acceptance for #5808. Extends `scenarios/ui-rail.md`, **U5562b text colour and highlight have one source form**. Journey stage: Review — read and edit findings in a Pad. Implementation follows Issue #5562, which supplies the Text colour control; this specification adds no runtime capability and leaves #5808 open (policy).

**U5808a keyboard opening keeps the menu associated with Text colour.** Given an editable Pad is open with its formatting toolbar ready, when the user tabs to Text colour and presses Enter, then exactly one colour menu opens, its trigger reports expanded, and its accessible labelling resolves to that same connected Text colour control. Focusing the control and showing its tooltip must not replace the menu's trigger identity or leave an unresolved trigger reference. When the user presses Escape, the menu closes and focus returns to that control. Repeating Enter and Escape has the same result; opening and dismissing without choosing a colour changes no Pad text and sends no `pad.write`.

Planned behavioral observer: `u5808a_keyboard_open_and_escape_keep_the_colour_trigger` under `apps/desktop/src/pads/`, using the real editor and shared Menu/Tip through the existing App fixture. Assert roles, expanded state, the live menu-to-trigger reference, focus and write count; exercise both an opening after keyboard focus and a reopening after dismissal. Reuse an existing test when it already proves a clause. Add no geometry, style, colour or exact-copy assertion (AGENTS.md rule 10).

**U5808b the colour menu is anchored beside Text colour.** Policy, rendered acceptance: given U5808a's open Pad at 1512×950 in dark mode, when Text colour is opened first by keyboard focus plus Enter, and then by pointer activation after dismissal, then the settled palette is adjacent to that trigger on both openings, rather than at the window origin. The same holds when the Pad body is scrolled with its sticky toolbar visible and the control is opened again.

Policy: judge adjacency from the trigger and palette rectangles and the library's resolved placement. Their projections overlap on the axis perpendicular to the placement; the gap between their facing edges equals the existing Menu positioning offset within 1 CSS px. The palette fits within the viewport without clipping its choices, trigger or focused item. Library collision shifting/flipping is allowed while preserving adjacency. Record rectangles, placement and offset with the capture; no new positioning system or arbitrary fixed window coordinates are requested.

## Rendered observer

Policy: compare immutable `origin/main` and implementation head in dedicated isolated headless `agent-browser` sessions with fresh profiles, on U26's `tree-40`, at 1512×950, dark. Start after #5562's implementation is on main. Use the same editable Pad and prose selection in both revisions, with enough text to scroll. Reach Text colour by keyboard, open with Enter, capture the settled menu, dismiss with Escape, reopen by pointer, then repeat after scrolling. Record the tooltip/trigger composition on the keyboard path. Wait for the editor's ready state and the positioning library's completed layout, with a bounded observer failure; a missing readiness signal is an observer failure, never permission to use a fixed sleep or silently pass the corner placement.

Policy: include a rejected Pad save with the whole existing cause/recovery line visible on the dense seed. Read `window.__checks()` in matching main/head states; preserve every Check passing on main. Moves D2, D5 and D6 (`docs/design-system.md`, **The checks**): Token spacing, legible choices and keyboard/focus ownership. The design critic judges U5808b from paired rendering and recorded placement; Check readings alone do not prove anchoring.

Policy: register capture coverage through the existing `apps/desktop/src/testing/captures.ts` table, run `just capture U5808a,U5808b`, and leave paired screenshots, interaction videos and readings under `artifacts/ux/U5808a/` and `artifacts/ux/U5808b/`, following `.agents/data/harness.md`, **Captures**. Never commit images or videos. This specification changes no rendered surface and requires no captures. Chromium supplies this observer; no native Mac-only claim or observation is required.

## Scope and retained behavior

Policy: implementation starts in `apps/desktop/src/pads/PadRichEditor.tsx` and its behavioral/capture observers under `pads/`. Inspect installed Ark Menu/Tooltip composition and the shared `apps/desktop/src/ui/Menu.tsx`, `Tip.tsx` and `Tooltip.tsx` before choosing a repair. Prefer their supported composition and positioning APIs; preserve tooltip access and one keyboard control. Rule 9 applies to any added machinery; no custom menu, anchor tracker or copied library attributes are authorized by this specification. If a shared primitive needs repair, widen #5808's Scope with the file and reason before editing it, and retain its existing callers' behavior.

Policy: keep U5562b's colour selection, Default, Highlight, editor selection/focus and save/reopen acceptance. Do not change Markdown serialization, the fixed palette, Tokens, contracts, App commands or Todo formatting. Keep U4698b's existing toolbar actions reachable. Applicable P11 gate: does the repair alter or lose unfinished Pad text, its identity or recovery? Observer: U5808a's no-mutation/no-write dismissal and the existing source/conflict guards below.

Existing regression checks on main:

1. No-op editor source and writes: `apps/desktop/src/pads/u147_live_preview.test.tsx`, `u147_an_unchanged_document_keeps_its_source_bytes_and_writes_nothing`.
2. Formatting actions still edit and reopen: `apps/desktop/src/pads/u4698b_toolbar.test.tsx`, `u4698b_toolbar_edits_and_reopens_each_format`.
3. Saved source survives reload: `apps/desktop/src/pads/p2544c_source.test.tsx`, `p2544c_repeated_saves_and_reload_preserve_bytes`.
4. Conflict recovery keeps the draft choice: `apps/desktop/src/pads/u36_pad_conflict.test.tsx`, `u36_use_theirs_loads_the_latest_text_and_calls_nothing_else` and `p2544d_conflict_choices_preserve_latest_draft`.
5. Colour selection and clearing retain their acceptance: `scenarios/ui-rail.md`, **U5562b text colour and highlight have one source form**. After #5562 lands, run its affected behavioral observer rather than duplicate its proof.

Policy: implementation runs `just ready`, changed test files and the affected guards above; CI judges the remaining tests. Specification verification is `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. Progress, actual observer failures and engineering questions belong on #5808, never in scenario Work tables. For each failed command or observer, report one Issue row with command/state, exit code (or observer failure), diagnostic and repair.
