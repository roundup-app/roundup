# U5741 native menu reconciliation

Audited App: `6d36d21c90b43cd4a244cc3f60d0a54ff1cf9dd8`. This closes the native-default discovery gap in the source census; it does not complete the feature audit or authorize deletion. The native host is not rendered by Chromium. Source construction, projected menu models and a macOS visual observation are different observers.

`crates/desktop/src/menu.rs::app_menu` starts with `tauri::menu::Menu::default`, inserts Project, replaces Edit, and extends the application submenu. `Cargo.lock` pins Tauri 2.12.1 and muda 0.20.0. The exact published crate archives were read, including Tauri's `src/menu/menu.rs::Menu::default` and muda's `src/items/predefined.rs::{default_text,accelerator}` and macOS selector dispatch. Sources: [Tauri 2.12.1 source](https://docs.rs/tauri/2.12.1/src/tauri/menu/menu.rs.html), [muda 0.20.0 source](https://docs.rs/muda/0.20.0/src/muda/items/predefined.rs.html). Both downloaded archive SHA-256 values match Cargo.lock. No substitute version or guessed list was used.

## Default items and roundup extensions

Each row below is an entry point, not a combined deletion choice. Standard item labels and accelerators come from the locked muda implementation. Separators carry no operation. A dash means no accelerator supplied by this construction. Native responder availability remains owned by macOS; a source offer is not a claim that every responder is enabled in every focus state.

| ID | Menu / exact item | Key | Implementation and available action |
| --- | --- | --- | --- |
| N01 | roundup / About roundup | — | Tauri `Menu::default`, muda `About`: opens native application metadata. Supports identifying the install when diagnosing an error. |
| N02 | roundup / Copy Version Info | — | `menu.rs::{app_chosen,info_text,version_info}`: copies the application version/build, with visible copy failure. |
| N03 | roundup / Copy Debug Info | — | `menu.rs::{app_chosen,info_text,debug_info,daemon_reachable}`: copies version/build, macOS version and Daemon reachability; supports reporting a failed connection without Project data. |
| N04 | roundup / Settings… | ⌘, | `menu.rs::app_chosen`: emits `open-app-settings`; `App.tsx::App` opens App Settings even without a Project. Individual settings remain separate S rows. |
| N05 | roundup / Services | — | Tauri default, muda `Services`: native services submenu; its dynamic service contents are supplied by the host, not a roundup registry. |
| N06 | roundup / Hide roundup | ⌘H | Tauri default, muda `Hide`: native `hide:` action. |
| N07 | roundup / Hide Others | ⌥⌘H | Tauri default, muda `HideOthers`: native `hideOtherApplications:` action. |
| N08 | roundup / Quit roundup | ⌘Q | Tauri default, muda `Quit`: native application termination request. This is not a Rail removal command. |
| N09 | File / Close Window | ⌘W | Tauri default, muda `CloseWindow`: native `performClose:` request. File remains after Project is inserted; it is not replaced by Project. |
| N10 | Edit / Undo | ⌘Z | `menu.rs::{app_menu,select_project_menu}`: native responder when editing text; otherwise `App.tsx::menuItems` projects the focused region's exact history label and availability. U3787a (amended by #4910), P11. |
| N11 | Edit / Redo | ⇧⌘Z | Same projection as N10, with `redoLabel`/`redoAvailable`; native text editing retains ownership. U3787a (amended by #4910), P11. |
| N12 | Edit / Cut | ⌘X | `menu.rs::app_menu`, muda `Cut`: native focused responder; supports moving chosen editable text. |
| N13 | Edit / Copy | ⌘C | Same native path, muda `Copy`: copies chosen text; it does not send an Agent Message. |
| N14 | Edit / Paste | ⌘V | Same native path, muda `Paste`: pastes into the focused responder. Native Terminal/editor behavior remains separate from App history. |
| N15 | Edit / Select All | ⌘A | Same native path, muda `SelectAll`: selects the focused responder's content. App row collections have their own scoped handling. |
| N16 | View / Toggle Full Screen | ⌃⌘F | Tauri default, muda `Fullscreen`: native `toggleFullScreen:` action, distinct from Bubble/Shelf maximisation. |
| N17 | Window / Minimize | ⌘M | Tauri default, muda `Minimize`: native `performMiniaturize:` action, distinct from minimising a Terminal Bubble. |
| N18 | Window / Zoom | — | Tauri default, muda `Maximize`: native `zoom:` action. The macOS label is Zoom, not Maximize. |
| N19 | Window / Close Window | ⌘W | Tauri default: second entry point to the same native close request as N09. One eventual decision may cover both only when it retires that one operation. |
| N20 | Help | — | Tauri default constructs an empty macOS submenu. There is no roundup help leaf in this builder; `help.open` is a separate App action. System-supplied contents are not inferred absent. |

The locked default does not construct Show All, Bring All to Front, Paste and Match Style, Start Speaking, Stop Speaking, Start Dictation or Emoji & Symbols. Those types existing in muda is not evidence that roundup offers them. macOS can supply dynamic Services/Help/window entries; this report makes no exhaustive claim about the owner's installed services or OS additions.

## Selected-Project menu

`App.tsx::menuItems` projects the named action catalogue retained in `settings.md` and `rendered.json::registries`. `menu.rs::select_project_menu` preserves Create, Navigate and Views grouping with separators between nonempty groups. Each named action retains its own row and exact current key; these are alternate entry points, not new permissions. A plain control-owned key and a leader sequence are shown as hints, not registered as global native accelerators (`menu.rs::project_kind`).

| ID | Entry or condition | Implementation and action |
| --- | --- | --- |
| N21 | Create group | `App.tsx::menuItems`: creation actions classified by `taskKeys`; new Agent/Agent with prompt/Workstream/Mode/Terminal and Choose Project use the same captured action as their keys. Disabled actions keep their position. |
| N22 | Navigate group | Same projection: leader actions, Ask/Find/attention, applicable row/editor/Triage actions. `captureActions(menuFocus())` binds the target and availability to the focused region. Exact names/defaults are in the 60-row action census. |
| N23 | Resources | `App.tsx::views/menuItems`: show/hide resource inspection; enabled only for a selected Agent or started Workstream. It is not a permanent resting resource meter. |
| N25 | Made | Same view projection: opens/closes published-work inspection. P12 and the Review stage apply. It is not permission to retire output discovery. |
| N26 | Recover notes | Same view projection: opens/closes retained line-note recovery, including when no note editor is mounted. P11 applies. |
| N27 | Import Claude Code work… | `menu.rs::{select_project_menu,app_chosen}`, `App.tsx::App`: emits `open-project-page` with the selected Project and `import-work`; opens `importer/ImportPanel`. |
| N28 | Open Project settings… | Same native dispatch with `project-settings`; opens `rail/ProjectSettingsView`. S17/S18 remain independent controls. |
| N29 | No selected Project | `select_project_menu`: Project submenu is disabled and its children removed; native Edit Undo/Redo restored when no projected history items exist. App Settings remains available. |

`1–9` assignment uses a submenu of live captured assignment targets, not nine presumed global accelerators. Unavailable text/local/Triage actions listed in `nativeKeys` are omitted; unavailable ordinary commands remain disabled. Native menu membership therefore needs focus/state fixtures as well as the initial projection. The census is not proof that all conditional actions have been rendered.

## Menu-bar mark and attention entries

`apps/desktop/src/app/menuBar.ts::watchMenuBar` computes the projection; `crates/desktop/src/menu_bar.rs::{set_menu_bar,chosen}` supplies native rows and routes only current action identities. Owning acceptance is U5502; P3/P12 preserve attention and work discovery. The existing `menu-bar-10` capture is a fake-seam projection, not an NSMenu screenshot.

| ID | Entry | Available action / condition |
| --- | --- | --- |
| N30 | Waiting / Ready group heads | Non-action labels organising actionable Agent entries, not independent Agent records. Waiting includes native requests and undismissed errors; Ready includes unseen finishes/publications. |
| N31 | Agent entry | Opens the window, selects its original Project/Agent, reaches its work. At most seven, waiting first; quiet or disconnected rows omitted. Missing captured identities produce a failure instead of selecting a replacement. |
| N32 | Age after Agent label | Supports choosing which pending attention/work to inspect. Native refresh changes the label; it never adds an Agent turn. |
| N33 | Overflow | When more than seven qualify, opens roundup. The exact excess count is projected, not another Agent selection. |
| N34 | Open roundup | Opens/focuses the window regardless of whether any Agent qualifies. |
| N35 | Empty mark / empty label | Shows that no eligible entry qualifies; Open roundup is still available. The mark itself is not a new monitoring service. |

## Dock implementation boundary

The requested custom Dock Agent list is not an offered feature on the audited revision. [#5521](https://github.com/roundup-app/roundup/issues/5521) owns U5503 implementation and is open. Source inspection of `crates/desktop/src/`, `crates/native/src/` and `app/menuBar.ts` finds the menu-bar integration, with no custom Dock callback/Agent-menu registration. The existing App Dock badge is a separate setting/action path; it is not evidence that U5503 is implemented. Native macOS Dock items remain platform supplied and no native visual claim is made.

## Remaining assessment boundary

The rows resolve construction and action ownership, not all three U5741 candidate questions. In particular, native window actions have macOS equivalents by construction, but that does not establish a replacement for roundup's captured Project actions or protected Agent Terminals. No native rendering claim or owner non-use is inferred. Per-row journey necessity, rendered information/action evidence and dated owner-direction searches remain part of the complete inventory worklist. No candidate request is sent from this partial table.
