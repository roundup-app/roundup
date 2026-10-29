# U3787b command menu integration

The existing `registerKeys` action registration and `captureActions` own target
capture and availability. `App.tsx` projects the selected Project menu and handles
`open-project-page`; `menu::select_project_menu` and `menu::app_chosen` own Tauri
construction and event forwarding. This work adds no dispatcher.

## Delivered coverage

| Commands | Production holder | Observer |
|---|---|---|
| New Agent, prompted Agent, Terminal, Ask, configured Capture; leader Project, attention, work items, Inbox, assignment, changes | Existing `App.tsx` Project projection and registered owners | #4278 / merged #4336: `u4278b_native_accelerator_runs_the_action_once`, `u4278a_unavailable_actions_are_hidden_or_explain_on_use`, `u4278b_one_step_items_carry_native_accelerators`, `u4278b_leader_hints_register_no_accelerator` |
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
rename/remove, Bubble commands, Switcher/Help, deletion Undo from `App.tsx`, settings,
and Terminal clipboard/font actions in `terminal/Pane.tsx` and `terminal/screens.ts`.
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
