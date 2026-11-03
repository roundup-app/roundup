# U5741 keyboard entry points

Audited main: `092fcafbf910f292d7180c97d35bd381aff984b3`. This report extends the [App reconciliation](entry-points.md); it is not the complete feature audit or an owner decision request. No retirement is authorized.

## Observer and boundary

The [source catalogue](catalogues/keyboard-source.json) records 67 production source files and 146 keyboard registration/handler sites, each with source excerpts and a full-file SHA-256, plus 21 installed Milkdown source files and the actual runtime action catalogue. The query and excluded test, fixture and performance paths are retained. This is a source census, not a claim all registered paths were exercised. Runtime observations are in [rendered-keyboard.json](rendered-keyboard.json); screenshots stay uncommitted under `artifacts/ux/U5741/`.

`keys/chords.ts::ACTION_ROWS` has 60 named actions. `keys/actions.ts::listActions` returns every row, including unavailable actions. `runAction` rechecks the captured focused owner, arguments and availability; `rup actions` / `rup do <name>` use that same authority. No new MCP authority follows from appearing in Help. Native Project menu projections are reconciled in [native-menus.md](native-menus.md).

The action id is not always the operation: `terminal.switch` is also registered as Bold by `PadRichEditor`; `todo.export` exports a Pad; `rail.rename` renames Project tabs and content rows too. The final inventory must enumerate those independent controls separately. Conversely local raw keys and installed editor keymaps need rows even when absent from `ACTION_ROWS`. No executable offer is declared absent merely because `listActions` says unavailable for one focus.

## Named actions and owning controls

Paths below are relative to `apps/desktop/src/`. These are entry-point mappings, not grouped keep/delete choices. Each action's feature-level Q1/Q2/Q3 and direction evidence must join its owning independent control before the one complete ask. The argument schemas and catalogue-time availability are retained verbatim in the source catalogue; availability is state-specific, never usage evidence.

| Action id | Default keys | Focus/availability and action target | Owning implementation | Acceptance |
| --- | --- | --- | --- | --- |
| `agent.new` | ⌘N | App; spawn permitted or prompt already open | `rail/Rail.tsx::Rail` | U32/U4324b |
| `agent.new-with-prompt` | ⇧⌘N | App; first Workstream on empty Project, otherwise prompt | `rail/Rail.tsx::Rail` | U33/U5216 |
| `workstream.new` | ⌥⌘N | App; spawn permitted | `rail/Rail.tsx::Rail` | U5216 |
| `mode.new` | ⇧⌘M | App; spawn permitted | `rail/Rail.tsx::Rail` | U5216 |
| `leader.assign` | ⌘K A | Selected assignable Todo opens owner picker; otherwise return to Ask | `todos/OwnerPicker.tsx::OwnerPicker; rail/Rail.tsx::Rail` | U4453b |
| `leader.project` | ⌘K P | Project picker if several tabs | `App.tsx::App` | U184 |
| `leader.changes` | ⌘K C | Selected Agent; available original Worktree with changes | `changes/WorktreeControl.tsx::WorktreeControl` | U2539/U2540 |
| `leader.attention` | ⌘K J | Attention target exists | `rail/AttentionKey.tsx::AttentionKey` | U30/U4692 |
| `leader.attention-other-project` | ⌘K ⇧J | Attention in another Project | `header/Strip.tsx::Strip` | U186 |
| `leader.row` | ⌘K K | No modal; optional query | `switcher/Switcher.tsx::Switcher` | U5240 |
| `leader.bubble-minimise` | ⌘K M | Eligible Bubble | `bubbles/Bubbles.tsx::Bubbles` | U165 |
| `leader.bubble-close` | ⌘K W | Eligible Bubble; consent where required | `bubbles/Bubbles.tsx::Bubbles` | U165 |
| `leader.shelf` | ⌘K B | Project open; import not pending | `App.tsx::App` | U370 |
| `leader.capture` | ⌘K T | Project connected; Capture closed | `todos/Capture.tsx::Capture` | U3713 |
| `leader.inbox` | ⌘K I | Connected Project; shows Needs you | `inbox/Inbox.tsx::InboxKey` | U4453a |
| `terminal.new` | ⌘T | App; eligible owner, no pending open or tab-name edit | `bubbles/Bubbles.tsx::Bubbles` | U165 |
| `leader.open` | ⌘K | App; no modal | `keys/Leader.tsx::Leader` | U2239 |
| `switcher.open` | ⇧⌘P | App; no modal | `switcher/Switcher.tsx::Switcher` | U5240 |
| `attention.jump` | ⌃⌘J | App; attention target exists | `rail/AttentionKey.tsx::AttentionKey` | U4692 |
| `todo.capture` | ⇧⌘T | App; chooser if no Project | `App.tsx::App; todos/Capture.tsx::Capture` | U4324b |
| `terminal.switch` | ⌘B | Terminal/tab; also Bold in editor | `bubbles/Bubbles.tsx::Bubbles; pads/PadRichEditor.tsx::PadRichEditor` | U2742c/U4698b |
| `rail.collapse-expand` | ← → | Focused Rail; raw binding, no named-action owner | `rail/Rail.tsx::Rail` | U5171 |
| `rail.move` | M | Focused movable Rail row | `rail/Rail.tsx::Rail` | U152; exact move-key clause remains to reconcile |
| `rail.rename` | F2 | Focused Rail/Project/Pad/Todo row | `rail/Rail.tsx::Rail; header/ProjectTab.tsx::ProjectTab; pads/Pads.tsx; todos/RowButton.tsx::RowButton` | U140/U3787c |
| `help.open` | ? | Noneditable App focus; no Terminal | `keys/Help.tsx::Help` | U54/U4324a |
| `agent.restart-mode` | R | Focused Workstream with saved opening prompt | `rail/Rail.tsx::Rail` | U4547d |
| `rail.remove` | ⌘⌫ | Focused Rail row; connected | `rail/Rail.tsx::Rail` | U358 |
| `ask.open` | ⌘/ | App; protected Ask | `ask/AskBar.tsx::AskBar` | U4453b/P1 |
| `todo.assign-slot` | 1–9 | Shelf; eligible Todo and owner slot | `todos/ownerAssignment.ts` | U3720 |
| `todo.open-draft` | ⏎ | Focused Todo or Pad row | `todos/RowButton.tsx::RowButton; pads/Pads.tsx` | U3789a |
| `todo.add` | N | Todos; captured Home/owner still match | `shelf/keys.ts::todoCreationKeys` | U3789b |
| `todo.assign` | O | Shelf; assignable Todo | `todos/ownerAssignment.ts` | U3720 |
| `shelf.maximise` | M | Shelf; open and not overlay | `shelf/keys.ts::shelfKeys` | U370/U3721 |
| `todo.delete` | D | Shelf; focused Todo or Pad | `shelf/keys.ts::shelfRowKeys` | U3723 |
| `todo.export` | E | Shelf; focused Pad only | `shelf/keys.ts::shelfRowKeys` | U3723 |
| `shelf.close` | Esc | Shelf; excludes editor, Drawer, triage, menu and drag | `shelf/keys.ts::shelfKeys` | U370/U3721 |
| `terminal.text-larger` | ⌘= | Focused screen; connected | `terminal/Pane.tsx::Pane` | U2241 |
| `terminal.text-smaller` | ⌘- | Focused screen; connected | `terminal/Pane.tsx::Pane` | U2241 |
| `terminal.text-reset` | ⌘0 | Focused screen; connected | `terminal/Pane.tsx::Pane` | U2241 |
| `editor.quote` | ⇧⌘B | Focused editable document; same document and selection | `pads/PadRichEditor.tsx::PadRichEditor` | U4698b |
| `editor.bullet-list` | ⌥⌘8 | Focused editable document; same document and selection | `pads/PadRichEditor.tsx::PadRichEditor` | U4698b |
| `editor.numbered-list` | ⌥⌘7 | Focused editable document; same document and selection | `pads/PadRichEditor.tsx::PadRichEditor` | U4698b |
| `editor.code-block` | ⌥⌘C | Focused editable document; same document and selection | `pads/PadRichEditor.tsx::PadRichEditor` | U4698b |
| `editor.italic` | ⌘I | Focused editable document; same document and selection | `pads/PadRichEditor.tsx::PadRichEditor` | U4698b |
| `editor.inline-code` | ⌘E | Focused editable document; same document and selection | `pads/PadRichEditor.tsx::PadRichEditor` | U4698b |
| `terminal.find` | ⌘F | Focused screen; connected | `terminal/Pane.tsx::Pane` | Z3788a |
| `edit.undo` | ⌘Z | Focused item region; native editors retain ownership | `App.tsx::App` | U3787a |
| `edit.redo` | ⇧⌘Z | Focused item region; native editors retain ownership | `App.tsx::App` | U3787a |
| `settings.open` | ⌘, | Raw App binding; no named-action owner | `settings/AppSettings.tsx::AppSettings` | U3799 |
| `settings.forward` | ⌘] | Raw App binding; Back previously closed Settings | `settings/AppSettings.tsx::AppSettings` | U5242c |
| `todo.triage-enter` | T | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-move` | J K | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-assign` | A | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-workstream` | W | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-nest` | Tab | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-unnest` | ⇧Tab | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-done` | X | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-comment` | C | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `todo.triage-leave` | Esc | Todos tab; triage active except enter; excludes editing/modal | `todos/Todos.tsx::Todos; todos/RowButton.tsx::RowButton` | U3751–U3753/U3709 |
| `project.choose-folder` | ⌘O | First run only | `app/FirstRun.tsx::FirstRun` | U4464 |

## Local bindings outside the action table

These source owners account for the production keyboard census. The excerpts in `keyboard-source.json` retain exact registrations; a listener that only tracks input/focus is explicitly classified rather than invented as a user action. `ui/RowCollection.ts` supplies inherited keys even though it contains no matching registration syntax. Library widgets remain separate from App named actions.

| Owner under `apps/desktop/src/` | Exact keys / condition | User action and owning surface |
| --- | --- | --- |
| `App.tsx::App` | Escape in Project picker; native Undo/Redo focus exclusions | Dismiss Project choice; focused item history; native text/Terminal keeps input. Other key listeners retain draft selection, not additional commands. |
| `app/FirstRun.tsx::FirstRun` | ⌘O | Choose Project; first-run only. |
| `ask/AskBar.tsx`, `ask/AskRows.tsx` | Escape/Tab/Enter through mentions and Ask scope; ↑/↓ between Ask result buttons | Ask typing/submission and result navigation; protected. Made content additionally inherits the row collection. Overview/Reactions remain excluded. |
| `bubbles/Bubble.tsx::Bubble` | Header arrows; Shift+arrows; Escape during preparation/resize | Move/resize Bubble; cancel pending opening or resize. This presentation is distinct from protected Agent Terminal access. |
| `bubbles/Bubbles.tsx::Bubbles`, `bubbles/tab.tsx::Tab` | Escape during pull; Escape in tab-name editor | Cancel pull or name edit; ordinary Bubble commands are in the named table. Recovery layer suppresses underlying commands. |
| `changes/ChangedTree.tsx::ChangedTree` | Enter on focused tree path; inherited library tree navigation | Open selected file; click/focus also chooses the diff. `WorktreeControl` Escape closes its popover; leader C opens it only with an available original Worktree and nonempty changes. |
| `drawer/DrawerHost.tsx::DrawerHost` | Escape only outside editable fields | Close Drawer. Escape inside a rich editor does not itself close it; the real Close control was used by this observer. |
| `header/ProjectTab.tsx::RenameField` | Enter / Escape in modal rename | Commit/cancel Project name; blur has draft-dependent behavior. Recovery modal has no commands of its own. Project tabs otherwise use Ark. |
| `header/Strip.tsx::Strip` | Leader Shift+J | Open attention in another Project; no ordinary next-tab action is inferred from this registration. |
| `importer/ImportPanel.tsx::ImportPanel` | Inherited collection keys on candidate checkboxes | Navigate/select import candidates; not an extra import endpoint. |
| `inbox/Inbox.tsx::Inbox` | Escape when selection/detail is open; collection keys | Clear selection/close expanded target; leader I shows Needs you. Nonempty work evidence still requires a separate rendered observation. |
| `ink/EntryRow.tsx::EntryRow` | Enter; Escape | Submit trimmed nonempty row, or close empty entry; cancel entry. |
| `ink/SectionHead.tsx::SectionHead` | Stops key propagation | Keep section-control keys from reaching row shortcuts; native button activation owns the action. |
| `keys/Help.tsx::Help`, `keys/Leader.tsx::Leader` | ?; Escape; ⌘K then registered leader key | Open/close Help; arm leader without moving focus. Unmatched leader press ends the wait and runs nothing; modifiers alone do not end it. |
| `keys/registry.ts::dispatch` | Scope arbitration, repeat guard, modal Escape/Tab exceptions | Dispatch infrastructure, not an independent product action. |
| `pads/PadRichEditor.tsx::PadRichEditor` | Seven explicit toolbar command bindings plus installed keymaps below | Format selection; a restored-selection keydown listener merely releases restoration. |
| `pads/Pads.tsx` | Enter/F2 on focused row; Escape in rename | Open/rename Pad; cancel editing. Inherited Shelf export/delete keys remain separate controls. |
| `pads/agentDetails.ts::agentDetailsView` | Enter in toggle title | Save by blurring title. Native details disclosure and the separate body textarea remain independent editor controls. |
| `pads/drawingBlock.ts` | Any key marks the embedded editor touched | Dirty-state tracking, not a named drawing shortcut; embedded drawing offers still require their own inventory. |
| `rail/AttentionKey.tsx::AttentionKey` | ⌃⌘J; leader J | Attention target navigation; native requesting Agent access stays protected. |
| `rail/ProjectSettings.tsx::ProjectSettingsBody` | Enter in numeric field | Commit Project limit; no independent shortcut setting. |
| `rail/Rail.tsx::Rail` | ContextMenu / Shift+F10; collection selection keys; local focus listeners | Open focused row/root menu; selection/typeahead; keydown clears pointer-menu bookkeeping. Door control stops propagation so it does not select another row. |
| `rail/RailRow.tsx`, `rail/SpawnPromptField.tsx` | Enter / Escape in name/prompt fields; unmodified nonrepeat F2 on row | Commit/cancel edit or submit/cancel Agent prompt; draft policy still applies. |
| `rail/drag.ts`, `rail/rows.ts`, `rail/RailFooter.tsx` | Space lifts row; Enter selects; control key propagation stopped | Keyboard drag versus selection; footer key listener records keyboard opening for focus placement only. |
| `settings/AppSettings.tsx::AppSettings` | Raw ⌘, / ⌘[ / ⌘]; Enter numeric/custom font; search Escape/↓ | Open/Back/Forward; commit setting; clear query before closing, or focus search result. These raw bindings are not proof `rup do settings.open` succeeds. |
| `settings/SettingsShell.tsx::SettingsShell` | Unhandled Escape | Close settings; composition/default-prevented keys do not close it. |
| `settings/ShortcutSetting.tsx::ShortcutSettings` | Escape; any nonmodifier while recording or finding | Cancel; record/conflict-check/reset chosen action or inspect key owner; export overrides uses its own Save to file control. |
| `settings/preferences.ts` | Keyboard-related schema field match | Data declaration only; no listener or independent shortcut. |
| `shelf/BulkDelete.tsx::BulkDelete` | Escape with selection; Backspace in bulk controls | Clear selection or request deletion through its owning state; tabs also clear selection. |
| `shelf/keys.ts::shelfKeys` | Tab / Shift+Tab across Shelf tabs and first control | Traverse boundary; Escape close is guarded against editable, Drawer, menu, triage and drag ownership. |
| `switcher/Switcher.tsx::Switcher` | Escape; opening chord again; ⌘Enter; recorded nonmodifier; plain Enter for creation | Close; record highlighted eligible command's shortcut; create named item where offered. Ark handles list navigation; keyup retains text selection. |
| `terminal/Find.tsx::Find` | Enter / Shift+Enter / Escape | Next/previous match and close Find; query input immediately searches. |
| `terminal/Pane.tsx::Pane` | ⌘= / ⌘+ / ⌘- / ⌘0 / ⌘F | Screen text zoom/reset and Find; focus/connection guards apply. |
| `terminal/emulator.ts::createXtermEmulators` | Shift+Enter; bare ⌘ or ⌥ with Backspace/←/→ | Encode newline/macOS line/word editing bytes. ⌘ tracking only changes link affordance. Other keys stay xterm/vendor input; protected Terminal ownership. |
| `terminal/screens.ts` | ⌘C; native paste; modified ⌘V refusal | Copy selected Terminal text; focus-bound text/image/path paste; refuse alternate modified paste shortcut. No Message writes to Terminal. |
| `todos/BlockerMenu.tsx`, `todos/NewWorkstream.tsx` | Escape; Enter in new Workstream field | Close picker/popover; submit Workstream form. Shared combobox owns list keys. |
| `todos/Capture.tsx::Capture`, `todos/CapturePanel.tsx::CapturePanel` | Enter / Shift+Enter / Escape | File capture (Shift selects its alternate filing path) or dismiss; native session/sequence identity is preserved. |
| `todos/EditableText.tsx::EditableText`, `todos/creation.tsx` | Enter / Escape with field-specific modifier guards | Start/commit/cancel editing or add row; rich text uses the shared editor keys. |
| `todos/OpenRow.tsx`, `todos/RowButton.tsx::RowButton` | ⌘Enter, arrows with Shift/Alt, Backspace/Escape, Tab/Shift+Tab; Enter/F2 | Selection/reordering, bulk deletion/cancellation, nesting, open/rename. Guards distinguish reorderable/selected rows and editing; typeahead wins over plain-letter shortcuts. |
| `todos/OwnerPicker.tsx`, `todos/ownerAssignment.ts` | Leader A; Escape; O; 1–9 | Open owner picker, cancel, or assign eligible Todo to captured owner slot. |
| `todos/TodoComments.tsx::TodoComments` | ⌘Enter | Submit comment; ordinary Enter remains text editing. |
| `todos/Todos.tsx::Todos` | T; J/K; A; W; Tab/Shift+Tab; X; C; Escape | Enter/advance/assign/move/nest/complete/comment/leave triage, with active tab/focus/typeahead guards. |
| `ui/RowCollection.ts::createRowCollection` | ↑/↓, Home/End, Enter/Space, ⌘A, printable typeahead; Shift/⌘ click | Collection navigation, activation, select-all and ranges; owning content supplies activation. |
| `ui/Accordion.tsx`, `ui/Checkbox.tsx`, `ui/Combobox.tsx`, `ui/Dialog.tsx`, `ui/Editable.tsx`, `ui/Menu.tsx`, `ui/Select.tsx` | Library navigation/edit/commit/dismiss keys and boundary propagation | Shared widget semantics below; not extra App named commands. |
| `ui/Mentions.tsx::Field` | Tab accepts highlighted mention; Escape reaches caller | Ark owns open-list keys; Ask owns submission/second Escape. |
| `ui/Splitter.tsx::Splitter` | Arrows 16 px; Shift+arrows 64 px; Home/End; Enter; Escape while resizing | Resize Rail/Shelf within limits, reset default, cancel resize; inherited machine direction/boundary rules apply. |
| `ui/Toast.tsx` | Escape | Dismiss that toast; alert source and recovery controls remain independently inventoried elsewhere. |
| `ui/pressFeedback.ts` | Keydown/keyup tracking | Visual pressed-state bookkeeping; not a command or feature candidate. |
| `ui/sortable.tsx::Sortable` | Space/Enter on handle; arrows; Escape; tree ←/→ depth | Library drag lifecycle and bounded nesting preview. Pressable row content keeps Enter/Space activation, separate from its grip. |

## Installed editor keys the toolbar does not enumerate

`PadRichEditor` selects eleven top-bar items but uses `CrepeBuilder` 7.22.2. Its constructor installs `commonmark`, `gfm`, `history`, `indent`, `clipboard`, `upload`, `listener` and `trailing` before roundup adds optional features. The library source paths and hashes are retained in the catalogue. Filtering `topBar` items does not remove those installed keymaps or input rules.

`Mod` is the library's platform modifier: Control in this Linux Chromium observer, Command on macOS. The seven explicit roundup toolbar bindings additionally use its Command-key convention. The rendered observer used real Control key combinations to exercise inherited keymaps; it makes no native Mac observation.

| Entry id | Exact inherited keys | Operation / source in installed 7.22.2 |
| --- | --- | --- |
| E01 | Mod+Alt+0 | Paragraph; commonmark `node/paragraph.ts`, `paragraphKeymap` |
| E02 | Mod+Alt+1 | Heading 1; commonmark `node/heading.ts`, `headingKeymap` |
| E03 | Mod+Alt+2 | Heading 2; same source |
| E04 | Mod+Alt+3 | Heading 3; same source |
| E05 | Mod+Alt+4 | Heading 4, absent from roundup's heading picker; same source; rendered `keys-heading-four` |
| E06 | Mod+Alt+5 | Heading 5, absent from picker; same source; not rendered in this slice |
| E07 | Mod+Alt+6 | Heading 6, absent from picker; same source; not rendered in this slice |
| E08 | Mod+B | Bold; commonmark `mark/strong.ts`, `strongKeymap` |
| E09 | Mod+I | Italic; commonmark `mark/emphasis.ts`, `emphasisKeymap` |
| E10 | Mod+E | Inline code; commonmark `mark/inline-code.ts`, `inlineCodeKeymap` |
| E11 | Mod+Shift+B | Blockquote; commonmark `node/blockquote.ts`, `blockquoteKeymap` |
| E12 | Mod+Alt+8 | Bullet list; commonmark `node/bullet-list.ts`, `bulletListKeymap` |
| E13 | Mod+Alt+7 | Numbered list; commonmark `node/ordered-list.ts`, `orderedListKeymap` |
| E14 | Mod+Alt+C | Code block; commonmark `node/code-block.ts`, `codeBlockKeymap` |
| E15 | Shift+Enter | Hard break; commonmark `node/hardbreak.ts`, `hardbreakKeymap` |
| E16 | Tab / Mod+] | Sink list item; commonmark `node/list-item.ts`, `listItemKeymap` |
| E17 | Shift+Tab / Mod+[ | Lift list item; same source |
| E18 | Mod+Alt+X | Strikethrough, absent from toolbar; GFM `mark/strike-through.ts`; rendered `keys-strikethrough` |
| E19 | Tab / Mod+] | Next table cell; GFM `node/table/input.ts`, `tableKeymap` |
| E20 | Shift+Tab / Mod+[ | Previous table cell; same source |
| E21 | Mod+Enter / Enter | Exit/break table where command permits; same source |
| E22 | Mod+Z | Editor Undo; `@milkdown/plugin-history/src/index.ts`, `historyKeymap` |
| E23 | Mod+Y / Shift+Mod+Z | Editor Redo; same source |
| E24 | Tab | Indent eligible text (Crepe config: four spaces); `@milkdown/plugin-indent/src/index.ts`, `indentPlugin`; context/plugin order determines which Tab command applies |

Heading 4 and strikethrough were reached through the ordinary Pad editor, using actual keyboard input, and rendered as `h4` and `del`. Every recorded D check passes on those two states and the initial editor. This proves those offers exist despite the narrower toolbar. It does not prove that every source-listed library shortcut wins precedence in every context. Source-only E entries remain explicitly unverified for rendered reachability until individually probed or covered by an existing behavior observer.

## Shared widget ownership and remaining work

Ark/Zag owns menus (arrow movement, typeahead, activation, Escape), tabs (orientation-specific arrows/Home/End, manual or automatic activation), dialogs (Tab focus containment/Escape), comboboxes (filter/list navigation and commit), and editable controls. `@dnd-kit` owns drag activation/drop/cancel; `@pierre/trees` owns changed-file navigation. The local bindings above compose with these owners. The installed dependency and its exact configured widget, rather than a second App shortcut list, are the source of these inherited offers. The source census does not assert every library key is reachable in every mounted configuration.

Remaining before U5741's one owner request: reconcile library-owned navigation against each actual configured widget; render source-only editor keys and their conditional contexts; inventory slash-menu blocks, table/link operations and embedded drawings separately; join every named/local entry to the independently removable App control and its three criteria/direction evidence; finish the rest of the App and endpoint assessments listed in `entry-points.md`. The catalogue's source exclusions are test/performance observers, not claims production features were removed. There is no complete candidate count or owner answer record yet.
