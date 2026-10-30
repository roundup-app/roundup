# U3787b command menu integration

The existing `registerKeys` action registration and `captureActions` own target
capture and availability. `App.tsx` projects the selected Project menu and handles
`open-project-page`; `menu::select_project_menu` and `menu::app_chosen` own Tauri
construction and event forwarding. This work adds no dispatcher.

## Delivered coverage

| Commands | Production holder | Observer |
|---|---|---|
| New Agent, prompted Agent, Terminal, Ask, configured Capture; leader Project, attention, work items, Inbox, assignment, changes | Existing `App.tsx` Project projection and registered owners | #4278 / merged #4336: `u4278b_native_accelerator_runs_the_action_once`, `u4278a_unavailable_actions_are_hidden_or_explain_on_use`, `u4278b_one_step_items_carry_native_accelerators`, `u4278b_leader_hints_register_no_accelerator` |
| Row Switcher; Agent/Bubble switch; Bubble minimise/close; Rail Remove; deletion Undo | Existing `Switcher.tsx`, `Bubbles.tsx`, `Rail.tsx` and Project-owned `todoUndo`; the Project projection includes these registered owners | `u3787b_menu_and_key_share_one_action` covers the production Switcher and Bubble minimise by key/menu; `u3787a_delete_has_no_question_and_freezes_targets_u3787b` extends the original deletion proof to both routes; `u3787a_editor_and_terminal_keep_undo` also refuses menu Undo in editors/Terminals |
| Focused Terminal Find catalogue/label and existing menu route | `keys/chords.ts`, `App.tsx`; Terminal owner registers its action through `registerKeys` | `u3787b_menu_and_key_share_one_action` uses the connected App, real registry and registered Terminal owner; `u3787b_scoped_menu_does_not_steal_terminal_input` covers unavailable/removed owners and editor input; existing `u2539b_native_menu_projects_the_task_chords` adds actual Tauri Find event forwarding for two Projects |

Find's SearchAddon, floating control and query retention remain #3853. When several Terminal owners register Find, projection and activation choose the
available captured owner rather than stopping at an inactive registration. That
owner invokes its captured callback once by either entry path. Without an available
owner, the Project item is omitted under U4278a. An editor's Cmd+F remains unhandled
by this registry. Building the menu changes no focus and writes no Terminal input.
This is shared integration, not Z3788a implementation or native responder proof.

The Tauri event observer extends an existing parameterized forwarding proof rather
than adding a duplicate. No existing behavioral test is removed or retired.

## Remaining acceptance on #4308

The fixed Project task subset is not the complete real-registration inventory.
Remaining production coverage includes scoped Shelf/list/triage commands, Rail
rename, Help, settings,
and Terminal clipboard actions in `terminal/screens.ts`.
Library-owned editor/list navigation must retain its control ownership. Each named
command still needs its current binding, scoped capture and menu equivalence.
The complete inventory/configuration observers remain required.

Native standard Close Window and responder Find availability must be verified
without inventing Project-close/global-search actions. The installed Tauri
`PredefinedMenuItem` supports Close Window but exposes no Find constructor; native
responder integration remains an engineering task. Preserve #4278 grouping and
shortcut alignment and the existing context-menu construction.

Main check [40816406986](https://github.com/roundup-app/roundup/actions/runs/40816406986)
at `c51582653069dc50ff66451a5c8341c073070b54` passed mac and mac-clippy. These establish
compilation/plugin coverage, not native displayed-key, responder availability or
AppKit-accelerator/webview exactly-once dispatch. #4278's recorded evidence remains
on that Issue; the older #3843 launch/link observation is not menu evidence.
The complete implementation SHA still needs the native-only observations after
remaining command integration. This slice closes neither #4308 nor #3843.

## Scoped-command continuation

The Project menu now projects every available non-Shelf command owner, keeping
#4278's existing create/navigate/views groups and labels. Existing Bubble and Rail
owners supply their capture and availability; no selection or dispatcher is added.
The Leader prefix is excluded as a standalone command; its actions display their
complete sequences, such as `⌘K J` and `⌘K K`.
The Switcher and deletion Undo register actions instead of separate raw bindings.
Undo captures the Project and its existing restoration holder; both routes recheck
availability and pending restoration. Editor and Terminal focus omit deletion Undo
and leave native Cmd+Z untouched. Unavailable Project actions remain omitted under
U4278a. This does not install global accelerators for plain Shelf/list commands.

No existing test is removed or retired. The original frozen-deletion/one-restore
proof is parameterized over key and menu rather than duplicated; its original
editor/Terminal ownership proof now also checks menu refusal. The ordinary
`u2241_no_other_chord_is_taken_at_app_scope` modifier sweep remains unchanged.

macOS CI [40832209878](https://github.com/roundup-app/roundup/actions/runs/40832209878)
at `0c29b966db434106efbc5ec5ab717ed1bb93d3a9` passed `mac` and `mac-clippy`.
It is compilation/CI evidence only. Preserve earlier native evidence on #4278;
this continuation claims no AppKit displayed-key, responder or combined-dispatch
observation. Remaining native observations follow the complete implementation,
not this partial catalogue slice.


## Terminal font continuation

The production pane's Larger Terminal text (`⌘=`), Smaller Terminal text (`⌘-`)
and Reset Terminal text size (`⌘0`) now register captured actions. The existing
Project projection discovers them without another command list or dispatch path.
Each capture retains the Project's font holder and selected Terminal identity;
changing that selection or removing the owner makes the capture unavailable.
The same screen/editor/Daemon guard owns both menu availability and key handling.

`u3787b_menu_and_key_share_one_action` exercises all three production commands by
key and the App's native-menu event seam, asserting exactly one font update,
unchanged focus and no Terminal writes. Its unavailable-owner observer refuses a
capture after changing the selected Terminal. The existing Tauri
`u2539b_native_menu_projects_the_task_chords` forwards these menu events for two
Projects, and `u4278b_one_step_items_carry_native_accelerators` checks their native
accelerator construction. These extend existing proofs; none is retired or removed.

The unmodified U102 file retains the logical `=`/`+` and optional Shift aliases,
held-key resizing, bounds, saved Project size, configured reset, frame-coalesced
refitting, scrollback preservation, storage failures and editor/Daemon exclusion.
The unmodified U2241 ordinary Terminal modifier sweep remains required. The
registry accepts these existing logical aliases and repeat policy directly,
using tinykeys rather than another keyboard listener.

macOS CI [40843663089](https://github.com/roundup-app/roundup/actions/runs/40843663089)
at `626a412ebc62c185c754885872ffdc744d34a673` passed `mac` and `mac-clippy`.
Installed Tauri 2.12.1 `menu::Menu::default` includes predefined Close Window;
muda 0.20.0 sends its `performClose:` responder action. Neither is replaced here.
Neither CI nor Chromium observes native font key equivalents or combined
AppKit/webview dispatch. Existing #4278 native evidence is retained; the remaining
complete inventory, clipboard, scoped lists/triage/Help/settings/Rail rename,
responder Find and final native observations keep #4308 open.

## Terminal clipboard continuation

Terminal Copy and Paste stay the standard responder commands of Tauri's default
Edit menu; no Project-menu accelerator is added, because one would take ⌘C/⌘V from
every editor. Paste already arrives as the webview `paste` event. The Terminal
screen now also takes the `copy` event the Edit menu sends, writing the selection
through the same `copy` as the ⌘C key. A key press is consumed before the event
exists, so either path acts once; an empty selection or an editor leaves the event
to the browser. `u3787b_edit_menu_copy_event_copies_the_terminal_selection_once`
proves it; the U101 key proofs are unchanged and no test is removed or retired.

Still open on #4308: scoped Shelf/list/triage, Rail rename, Help and settings
inventory, the complete real-registration inventory observer, and the native
displayed-key, responder Find and combined-dispatch observations against the
final implementation SHA. No native result is claimed here.

## Registry-to-menu inventory observer

`u3787b_menu_covers_bound_commands` compares, for a focused Terminal and a focused
Rail row in the connected App, every available captured Project action with the
menu items the App writes: each has an item, displays its chord or `⌘K` sequence,
and the menu holds no item the registry does not offer (so no unavailable command
is shown). Building the menu leaves focus where it was. This is the real-registration
inventory for those two foci; Shelf, triage and Help foci, Rail rename, and the
native displayed-key, responder Find and combined-dispatch observations stay open.
No test is removed or retired, and no native result is claimed.

## Shelf row commands

The Shelf's registered row commands (`D`, `E`, `M`, the triage keys) now join the
Project menu from the same `captureActions` inventory, so a focused row's command has
a menu item and an editor focus has none. A plain key is control-owned, so
`menu::project_kind` shows it as a hint and registers no native accelerator
(`u3787b_plain_key_commands_register_no_accelerator`); the key keeps working in the
webview. `u3787b_shelf_row_commands_are_menu_hints_that_act_once_on_the_focused_row`
proves item, hint, one `todo.delete` by menu, unchanged focus and omission in a text
field. Two rows sharing an id (`Esc`) yield one item. No test is removed or retired.

Still open on #4308: Rail rename and Help in the inventory observer, responder Find,
and the native displayed-key, responder and combined-dispatch observations against the
final implementation SHA. No native result is claimed.


## Help and Rail rename continuation

Continues unmerged PR #4877 from its head, preserving Shelf hint projection and
plain-key accelerator exclusion. Help (`?`) now registers its existing opener;
Rail rename (`F2`) registers with the owning Rail and calls its existing editing
state directly. The obsolete `Keys` component's synthetic double-click is removed,
along with its mounts in App and fixtures. Ark still owns tree navigation and
Help's dialog; neither command installs a native accelerator for its plain key.

`u3787b_menu_and_key_share_one_action` now exercises Help and focused Rail rename
by both routes. Rename addresses the focused row even when another is selected;
its editor omits menu Rename, Escape returns focus, and opening sends no rename
RPC. Help closes back to the original row and writes no Terminal input. Existing
U140 focused-row, U4324 Help focus exclusions and U2241 Terminal modifier observers
remain required. No test is removed or retired; fixture edits only remove the
obsolete component mount. The real Tauri event proof
`u2539b_native_menu_projects_the_task_chords` now forwards Help/F2 in two Projects;
`u3787b_plain_key_commands_register_no_accelerator` adds both hints.

The Rail inventory observer now requires F2. Complete Shelf and triage inventory
coverage remains open; the inherited Shelf menu/delete proof remains intact. Settings stays
the standard application menu's `app-settings` event, with equivalence proved by
`u3799_the_event_and_cmd_comma_open_app_settings_in_the_center_with_four_groups`.
Configured Capture remains covered by #4278's existing
`u2539b_native_menu_projects_the_task_chords` observer rather
than a duplicate test. Terminal clipboard responders remain covered by U101 and
its Edit-menu copy event proof. Library-owned editing and list navigation stay
with their controls.

Read current main macOS CI:
[40916673952](https://github.com/roundup-app/roundup/actions/runs/40916673952),
`c7cf55de270fcdf9c0c2490df607b5a2113f0bc6`: `mac` and `mac-clippy` both passed.
Earlier macOS compilation records and #4278 native evidence above remain valid
for their recorded SHAs. This run makes no new native dispatch claim.

Remaining on #4308: native responder Find integration and actual responder
availability for Find/Close Window; complete library/native inventory validation;
and displayed-key, alignment, responder and combined accelerator/webview dispatch
observations against the final implementation SHA. Tauri 2.12.1 and muda 0.20.0
expose predefined Close Window but no Find constructor. AppKit's
[performTextFinderAction:](https://developer.apple.com/documentation/appkit/nsresponder/performtextfinderaction(_:))
is the responder-chain capability to investigate. A WebKit/AppKit observer must
establish support and availability; adding a webview global search is not authorized.
This continuation closes neither #4308 nor #3843.

The U480 Help binding audit now explicitly presses F2, since its modified
key sweep cannot see it. Help retains logical `?` matching through `HELP_KEYS`,
with no physical US-layout shortcut added to the App-scope inventory; the
unmodified U2241 Terminal sweep retains its existing boundary. No test was removed. Its menu Help dismissal assertion
was redundant with U54 and the same test's focus return, and was removed. All
U3787b menu tests use one Project: they never switch Projects, and the existing
Tauri forwarding observer above retains the two-Project proof.

## Captured triage actions

Triage Assign (`A`), Move (`W`), Complete (`X`) and Comment (`C`) now
register with the existing action holder. Their capture retains the focused Todo
and checks that the mode, Todos tab and row remain available; Move is omitted
without another Home. The same capture invokes the existing picker/mutation by
menu or key. J/K remain control-owned navigation, with no native accelerator.

`u3787b_triage_commands_share_the_focused_todo` covers all four commands through
the connected App, plus exactly one completion/comment call for the captured id.
`u3787b_triage_menu_refuses_an_owner_after_leaving_the_mode` refuses both the menu
route and a retained capture after Escape. The Tauri forwarding observer
`u2539b_native_menu_projects_the_task_chords` includes all four commands for both
Projects. U3751/U3474 retain the ordinary triage, continuation and draft proofs;
U2241 retains its unmodified Terminal modifier sweep.

Retired `u3724_each_new_key_is_in_chords_and_help`: it asserted catalogue entries
against other catalogue entries. The production Shelf menu/triage tests and U54
Help observers retain the behavioral discovery proofs. No other proof is removed.

This continues PR #4877 through its already-merged continuation #4891. Still open:
complete Shelf/triage inventory (including assignment and nesting), library/native
inventory and responder Find/Close availability, then native displayed-key and
combined dispatch observations against the complete implementation SHA. No native
completion is claimed. macOS check 40941756743 at
`d780754c8e12a9cf4e81e25cee8ff682a8986a8c` passed mac and mac-clippy; earlier native
records retain their original scope and SHA.

## Captured Todo nesting

The production `RowButton` now registers Tab and Shift+Tab through its existing
row layer and `nest` callback. The Project menu discovers the same captured
nesting plan; focus leaving the row, lifting it, opening a modal or losing the
available nesting operation refuses that capture. A row with no nesting operation
keeps ordinary Tab navigation. Plain Tab hints still register no native accelerator.

`u3787b_nesting_captures_the_focused_todo_once` uses the connected production App
and menu-event seam for both directions and entry paths: one `todo.setBlockers`
for the focused Todo, unchanged focus during menu projection, no action from the
retained capture or menu after an editor takes focus. Existing U3709/U3711 proofs
retain ordinary Tab navigation, dependency identity, cycle refusal and visible
failure; no test is removed or retired. The existing Tauri
`u2539b_native_menu_projects_the_task_chords` also forwards both nesting commands
for two Projects. This extends the accepted #4877 work through main's merged
continuations, without changing accepted menu grouping or context menus.

Main check [40981393565](https://github.com/roundup-app/roundup/actions/runs/40981393565)
at `7595b070bbb91dae1c3c2fc5d2d2970f48461250` passed mac and mac-clippy.
This is CI evidence only; earlier native observations keep their original scope.
Complete assignment/library/native inventory, responder Find/Close availability
and final native displayed-key/combined-dispatch observations remain on #4308.
This slice closes neither #4308 nor #3843.

## Numbered assignment projection

The Project projection now includes each available registration beneath a
catalogue chord, including the existing `1–9` registrations with their distinct
`Digit1` through `Digit9` ids. The available numbered actions share one `Assign to` submenu, in Rail order.
Each leaf reads `<Agent name>` and shows its digit only as a hint; it installs no native accelerator. Retained
assignment captures refuse invocation after focus leaves the captured row. Selection uses
the existing Project event and `captureActions` route. Catalogue order, accepted
Project groups and context-menu construction stay intact. Help, O and hints use
`Assign`; the shared native constructor retains submenu digit hints by index path,
so duplicate Agent names keep their own digits.

`u3787b_numbered_assignment_captures_one_todo_and_owner` drives ninth-Agent
assignment by key and menu through the connected production App, pinning the Todo,
Agent identity, one assignment and zero Terminal writes. The inventory observer
now also visits the Shelf and triage. The existing Tauri forwarding observer adds
both numbered ids for two Projects; the existing no-accelerator proof includes
plain `1` and `9`. The first-Agent variants of this new proof repeat its numbered registration path;
the ninth-Agent variants retain equivalence and the nine-item inventory assertion.
No earlier proof is removed or retired.

This continues #4877 through the merged continuations. The installed tinykeys
registry already owns these per-press captures; Tauri's existing menu items and
native plain-key hint construction are reused without another dispatcher.
Read installed Tauri 2.12.1 `Menu::default` and muda 0.20.0's Close Window action:
Close Window remains the platform `performClose:` responder. Tauri still supplies
no Find predefined item; native responder integration remains required.

Main check 40981393565, SHA `7595b070bbb91dae1c3c2fc5d2d2970f48461250`,
has passing `mac` and `mac-clippy` jobs. This is compilation evidence only.
Earlier #4278 native evidence retains its original scope and SHA. Remaining on
#4308: named row Open/Rename and add-row callers that still use raw handlers
(`RowButton` Enter/F2 and Todos creation), the complete library/native command
inventory, responder Find integration
and actual Find/Close availability, followed by native displayed-key/alignment
and combined AppKit/webview dispatch observations at the complete implementation
SHA. No new native result is claimed; #4308 and #3843 remain open.

Rendered evidence for the numbered-assignment continuation is under
`artifacts/ux/U3787b/assignment/`: dark 1512×950 tree-40, tabs-8 and conflict,
plus the focused assignment and dense refusal. All recorded Checks pass; the
refusal shows its full cause/fix with the Todo retained. Screenshots and the keyboard
assignment recording remain uncommitted. These are Chromium observations only.
The menu observer's cleanup batches disposal of production registrations using
Solid's existing `batch`, avoiding repeated menu projection during unmount.

## Focused Todo Open and Rename

`RowButton` now captures its existing Open (Return) and Rename (F2) callbacks
through the same row registration as navigation and nesting. The menu and key
invoke that focused Todo, even when another row is selected. Editing, suspension,
modal ownership, removal or leaving the row makes the capture unavailable. Both
plain keys remain native menu hints, without accelerators.

`u3787b_todo_open_uses_the_focused_row` proves one comments request for the focused
Todo by either route. `u3787b_todo_rename_keeps_the_captured_row` proves the editor
belongs to that Todo, sends no update on opening, and refuses retained/menu
Rename while editing. `u2539b_native_menu_projects_the_task_chords` forwards Open
and Rename through actual Tauri menu events for both Projects. No test is removed
or retired; existing U3789 and U3787c observers retain selection and rename
cancellation.

Main check [41018682543](https://github.com/roundup-app/roundup/actions/runs/41018682543)
at `3eb7454cd284bf09dcf5199ad3202d3683b54f1b` passed mac and mac-clippy. This is
compilation evidence, with no new native dispatch claim. Remaining #4308 work:
Pad/add-row command coverage, complete library/native inventory, responder
Find/Close availability and final native displayed-key/combined-dispatch
observations. This continuation closes neither #4308 nor #3843.

Rendered comparison: `artifacts/ux/U3787b/open-rename/{base,head}/`, dark
1512×950, tree-40/tabs-8/conflict, base `997b1e5a6`, implementation
`aaec581772e66868b1edaaa09102d0b61ba920b9`. All D1–D14 and D16 readings
pass; D2/D5/D6 retain their baseline. Interaction captures show focused Rename,
Escape then Open, and full actionable rename failure beside retained input.
Images and the interaction recording stay uncommitted. These observe Chromium
only. `just capture U3787b` exits 1 because the installed observer table rejects
that id; these explicit isolated captures supply the rendered evidence.

The existing `u3723_keys_are_inert_in_the_drawer_field` fixture now focuses its
row before Return, matching keyboard dispatch through the captured row holder.
Its editor-key and zero-mutation assertions are unchanged.

Connected-App Help/attention, row-name recovery, completion and unfinished-input
fixtures focus the Todo row before Return/F2 and supply its key code. Their
existing assertions remain. The U2580a browser observer installs before the
registry at window capture, retaining its first-frame open/focus proof after
the registry consumes Return. No test is removed or retired.

## Focused Pad Open and Rename

The production Shelf Pad row now captures its existing Open (Return) and Rename
(F2) callbacks through `registerKeys`, replacing its local key handlers. Both
entry paths retain the focused Pad's name/incarnation in its originating Project;
selection of another Pad does not redirect them. Editing, pending deletion,
hidden/removed rows, modal ownership or leaving the row refuses the capture.
Both keys remain plain native-menu hints, without accelerators.

`u3787b_menu_and_key_share_one_action` now covers focused Pad Open and Rename
through the connected production App and menu-event seam. Open requests exactly
one read of the focused Pad; Rename opens only that Pad's editor without a write,
refuses retained/menu actions during editing and returns focus on Escape. The
existing inventory observer includes Pad focus. Existing Tauri
`u2539b_native_menu_projects_the_task_chords` and
`u3787b_plain_key_commands_register_no_accelerator` already cover both ids and
plain hints. No test is removed or retired. U3789a and U3787c retain their draft,
rename cancellation and list-navigation proofs; U2241 retains Terminal ownership.

Main check 41018682543 at `3eb7454cd284bf09dcf5199ad3202d3683b54f1b`
passed mac and mac-clippy; current-main checks were pending when read. This is
compilation evidence only. Earlier #4278 native observations retain their scope
and SHA. Add-row, complete library/native inventory, responder Find/Close
availability and final native displayed-key/combined-dispatch observations remain
on #4308. This continuation closes neither #4308 nor #3843.

Supporting Pad fixtures and the existing hint/attention/export observers now
focus the Pad row before Return/F2, preserving all behavioral assertions. No test
is cut; only unused browser imports from the edited export observer are removed.

Rendered comparison: `artifacts/ux/U3787b/pad-commands/`, base
`655a3934664bfc5d52dc34188ecbd758fb0c73a9`, implementation
`30811ff3b6373435326f39888b1f9f05ed47a596`, with export setup repair
`9fedc02bf1e36da3d74032d579fcd0d9b439e0e3`. Dark 1512×950 resting
tree-40/tabs-8/conflict and Rename pass D1–D14/D16. Pad Open retains
main's D2 margin-right failure in `div.pad-head` and consequent D10 failure;
`delta` records no regression. The dense tree-40 refusal capture maximises the
Shelf to show the entire cause/fix beside retained rename input. Screenshots and
the keyboard interaction recording stay uncommitted. The supported capture table
rejects `just capture U3787b`; these explicit isolated captures supply the rendered
evidence, with no native claim.


## Scoped Add Todo

The existing Todos `N` binding now registers its captured action rather than a
raw binding. The Project menu and Help discover it from `CHORDS`; the native menu
shows N as a plain-key hint through the existing projection, without an
accelerator. Its owner captures the selected Home and Agent, reuses `openField`
and the existing draft holder, and refuses typing, hidden/inactive lists and a
changed scope. Ark name search retains precedence on content rows.

The connected-App `u3787b_menu_and_key_share_one_action` cases for Add Todo prove
both routes open the same field and submit one creation for the captured Agent,
without Terminal writes. The Add Todo case of
`u3787b_scoped_menu_does_not_steal_terminal_input` refuses a retained capture after
scope changes. The existing inventory observer covers its registration on Todo
rows; no test or behavioral assertion is removed or retired.

Main check [41039086603](https://github.com/roundup-app/roundup/actions/runs/41039086603)
at `5774c480097657f2ab5d0aa2a49e95ed846b4aa9` passed mac and mac-clippy.
This is compilation evidence only; earlier native evidence keeps its recorded
scope and SHA. Complete library/native inventory, responder Find/Close Window
availability and final native displayed-key/combined-dispatch observations remain
on #4308. This slice closes neither #4308 nor #3843.
