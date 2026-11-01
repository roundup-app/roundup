# Pad lists keep their reading width

Acceptance for #5559. Narrows U147's formatted document (`scenarios/ui-rail.md`, heading **U147 the Pad is one live-preview surface**); changes list spacing only. Journey stage: Review — read the Pad's result from its Workstream. No new storage, editing mode, permission, contract, App command or Token is specified (policy).

**U5559a lists indent one small step per level.** Policy, rendered acceptance: given a Pad with a heading and paragraph followed by bullet, numbered and task lists, each three levels deep, when opened in the Pad editor or any existing App surface rendering that Pad read-only, then:

- A top-level marker starts at the paragraph's text edge or one small spacing step inside it; item text follows its marker with a small gap.
- Each further nesting level adds one fixed small step, shared across list types, including a numbered list nested inside a bullet list. Browser list padding and the editor's marker column must not accumulate extra indentation at each level.
- A wrapped item's continuation lines start at that item's text edge, never under its marker. Three levels retain readable line width, without clipping text or markers or causing horizontal scrolling.
- Checked and unchecked task markers, single- and multiple-digit numbers, and bullet markers remain legible and separate from their text.

Policy: the design critic chooses and judges the small step and marker gap from existing spacing Tokens, using paired main/head rendering; this specification sets no pixel value or CSS implementation. Use the same spacing rule for editable and existing read-only Pad rendering. Inventory those renderers in the implementation Issue; a read-only configuration of the same editor is included, without adding a new read-only product mode. No geometry, spacing, wrapping, colour or exact-copy assertions belong in tests.

**U5559b block handles keep their gutter.** Policy, rendered acceptance: given U5559a's Pad, when the pointer or keyboard interaction exposes the editor's block handle (+ and ⠿) beside top-level and nested list items, then both controls fit in the left gutter without covering a marker or item text. Showing or using the handle does not shift the list's text column. The task checkbox remains operable; making the marker column compact does not reduce D6's hit-area or keyboard requirements.

## Rendered observer

Policy: implement within `apps/desktop/src/pads/`, starting from `editor.css` and the existing Milkdown/Crepe list-item binding and optional App theme. Read the installed dependency and browser list defaults before changing styles; do not replace the editor, introduce a list state machine or change Markdown serialization. Existing shared consumers of these styles retain their passing Checks. Any required scope expansion and its reason go on #5559, following the Builder recipe.

Policy: the design critic compares `origin/main` and head in the same dedicated headless browser setup, at 1512×950, dark, on `tree-40`, using identical Pad text and interaction states. The fixture includes:

- A heading and ordinary paragraph establishing the text edge.
- Separate bullet, numbered and task lists, each three levels deep; tasks include checked and unchecked items, and numbering crosses from 9 to 10.
- A bullet → numbered → task branch reproducing mixed nesting.
- At least one long item at every depth in every list type, long enough to wrap in the actual Pad width.
- Rest, visible block handles at each depth, keyboard focus, and an existing rejected Pad action with its complete failure text visible.

Policy: observe every existing read-only Pad renderer with the same source; where it is the editor's read-only configuration, exercise that configuration through the existing harness/binding rather than inventing a product navigation path. Record the renderer inventory, how each was reached and any observer failure on #5559. The critic judges U5559a/b directly from the paired rendering; automated Check readings alone cannot prove list alignment.

Policy: Moves D2, D5 and D6 (`docs/design-system.md`, heading `The checks`): Token spacing, readable marker/text contrast and operable handles/task checkboxes. Use only existing Tokens; no Check passing on the same main baseline may regress. Run `just capture U5559a,U5559b`; leave paired screenshots, interaction videos and Check readings under `artifacts/ux/U5559a/` and `artifacts/ux/U5559b/` following `.agents/data/harness.md`, heading `Captures`. Never commit images or videos. This specification changes no rendered surface and requires no captures; the implementation supplies them.

## Retained behavior and verification

Policy: preserve list editing, task toggling, stored Markdown, untouched source bytes, autosave, conflict recovery and read-only refusal to edit. Do not add a test that merely pins CSS, Token values or the fixture. Run the existing affected behavioral guards; add a behavior test only if the implementation introduces a distinct behavior not already proved (rule 10).

Existing regression checks on main:

1. Unchanged documents retain exact source and send no write: `apps/desktop/src/pads/u147_live_preview.test.tsx`, `u147_an_unchanged_document_keeps_its_source_bytes_and_writes_nothing`.
2. New lists and authored list markers retain their source rules: `apps/desktop/src/pads/p2544c_source.test.tsx`, `p2544c_new_lists_use_dash_existing_markers_survive`.
3. Source survives successive saves and reload: `apps/desktop/src/pads/p2544c_source.test.tsx`, `p2544c_repeated_saves_and_reload_preserve_bytes`.
4. Conflict recovery retains the draft choice: `apps/desktop/src/pads/u36_pad_conflict.test.tsx`, `u36_use_theirs_loads_the_latest_text_and_calls_nothing_else` and `p2544d_conflict_choices_preserve_latest_draft`.

Policy: applicable P11 gate — does a spacing change alter or lose unfinished Pad text, its identity or recovery? Observer: checks 1–4 above; spacing must not change their outcomes. This is a presentation repair, with no new first-journey capability claim or native Mac-only observation.

Policy: implementation runs `just ready`, the test files it changes and the guards above, then relies on CI `check` for other tests; no whole-suite run. For each failed command or rendered observer, put one row on #5559 naming the command/state, actual exit code (or observer failure), diagnostic and repair. The specification runs `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. This PR delivers acceptance only; #5559 remains open for implementation.
