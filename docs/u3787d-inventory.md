# U3787d literal editing inventory

Paths below are relative to `apps/desktop/src`. `testing/u3787d_literal_fields.test.tsx`
opens the production App and parameterizes `u3787d_each_field_keeps_literal_input`
with the case names below. Every case inspects the actual editing element, types
combining Unicode, emoji, punctuation and whitespace, retains a backward selection
through the value update, and blurs through its existing action contract. The native
Capture panel is a separate production entry point and is tested through CapturePort.

| Holder | Real opening → App case |
| --- | --- |
| `header/ProjectTab.tsx` | Project name double-click → Project rename |
| `rail/RailRow.tsx` | Workstreams → Agent or Workstream → F2 → Agent rename / Workstream rename |
| `ui/Editable.tsx` | Work items → Todo or Pad row → F2 → Todo rename / Pad rename |
| `bubbles/Bubbles.tsx` | Open Terminal tabs → tab double-click → Terminal rename |
| `ink/EntryRow.tsx` | Work items → Todos → add Todo → New Todo |
| `pads/Pads.tsx` | Work items → Pads → Add Pad → New Pad |
| `todos/NewWorkstream.tsx` | Todo → O → New Workstream → New Workstream |
| `todos/Capture.tsx` | Capture command → Capture |
| `todos/CapturePanel.tsx` | Native capture request → native CapturePanel request |
| `ui/Mentions.tsx` | Project overview → Ask → Ask prompt |
| `rail/SpawnPromptField.tsx` | Workstreams → ⇧⌘N → Spawn prompt |
| `rail/OpeningPrompt.tsx` | Workstream native menu → Opening prompt → Opening prompt |
| `importer/ImportPanel.tsx` | Project menu → Import Claude Code → Import prompt |
| `todos/EditableText.tsx` | Open Todo → title double-click / Add notes → Todo title / Todo body |
| `todos/TodoComments.tsx` | Open Todo → comment field → Todo comment |
| `changes/NoteForm.tsx` | Agent → changed files → file → View diff → Add note → Change note |
| `settings/AppSettings.tsx` | Settings → Terminal → Font family → Font family |
| `ui/Combobox.tsx` | ⌘K K → Switcher query; ⌘K P → Project query |
| `ui/Combobox.tsx` | Settings → Agents → Engine / Model → Engine query / Model query |
| `ui/Combobox.tsx` | New reaction → Target Agent → Reaction target query |
| `ui/Combobox.tsx` | Todo selection → ⌘K A → Owner query; Todo → Blocker → Blocker query |
| `ui/Combobox.tsx` | Todo → O → New Workstream → Start after Todo → Choose a Todo → Wait-for query |

## Dependency and excluded-field audit

Ark Editable.Input, Field.Input/Textarea and Combobox.Input accept native HTML
attributes; Listbox.Input's supported `asChild` renders the Mentions textarea.
No editable root is copied, replaced or patched after creation. All prompt and name
roots in these holders are native inputs/textareas, including Ark-created inputs.
The installed Milkdown CrepeBuilder enables blockEdit, listItem, linkTooltip,
placeholder and topBar, not its AI prompt feature. Its ProseMirror contenteditable
root is ordinary Pad prose and keeps its existing policy. The link tooltip's URL
entry is part of that prose editor, not an App prompt, filesystem path or name.
Excalidraw's drawing text and vendor xterm input likewise retain their editor owners.

Read-only recovery textareas in Capture, CapturePanel and Rail, and recovery `pre`
values in Project/Terminal dialogs, cannot edit text. Restoring an editable revision
uses the original holder above, with its same attributes. Numeric fields are
ProjectSettings' Workstreams-at-once textarea, Settings font size, NoteForm start/end
line and reaction PR/firing counts. Reaction civil dates/time and zone choice are
structured scheduling controls, not names or prompts; Form.Text already disables
assistance for its free-text time field. Checkboxes, hidden Ark selection inputs,
radio, switches and non-editable select triggers are not text editing surfaces.
Fixture-only fields (`*Fixture.tsx`) are not production controls.

## Preserved contracts and observers

This change adds attributes only: existing trim-on-submit contracts stay in their
own actions; no input, draft, persistence, normalization or selection owner changes.
No existing test is deleted. U16/U19 creation tests retain submission semantics;
U183/U511a retain Enter and click-away rename; U3787c retains cancellation with no
rename and exact recoverable work. `shelf/u3789_rows.test.tsx`,
`todos/u2773_unfinished_input.test.tsx`, `rail/u2773_drafts.test.tsx`,
`keys/u3713_capture.test.tsx`, `reactions/nr9_reactions.test.tsx` and
`changes/u2540b_notes.test.tsx` retain rejected-submit, revision and identity proofs.
`header/u184_close.test.tsx` and `bubbles/u511a_browser.test.ts` retain real-Project
and real-Terminal reload/ended-original observations. Import's three baseline
attributes are unchanged and exercised by the App inventory.

P3/P9: no attention, Agent start or Terminal write from editing. P6/P11: preserve
Project/Home/object/recipient, exact drafts, revision settlement and recovery.
P14: no usage data. D2/D5/D6/D9: existing Tokens, layout and instant feedback.
Dark 1512×950 tree-40/tabs-8/conflict captures and video remain uncommitted under
`artifacts/ux/U3787d/`; the observer uses the isolated production harness and adds
five Todo rows including duplicate and long Unicode names. The tree-40 and conflict
observers open Capture with its leader command and retain the full failed-create
cause and retry instruction beside its literal prompt field.

Paired readings in `artifacts/ux/U3787d/base/` and `head/` cover eleven states
at 1512×950 in dark mode. Every recorded Check passes on both revisions, and
`loop/rules.sh delta` reports no regression. `observation.json` records the source
revisions, observer hash and command results. These are Chromium observations;
previous macOS CI evidence remains on #4307, and the user reports what they meet
on the Mac.
