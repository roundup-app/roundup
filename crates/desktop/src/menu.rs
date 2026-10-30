//! U2694a: the macOS system menu (`NSMenu`) the webview asks for, popped up at the pointer.

use std::sync::Mutex;
use std::time::Duration;

use rpc::{RpcError, code};
use serde::Deserialize;
use tauri::Emitter;
use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, LogicalPosition, Manager, Runtime, State, WebviewWindow};
use tokio::sync::oneshot;

/// U3799: extend Tauri's standard application menu without replacing its native actions.
pub(crate) fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    #[cfg(target_vendor = "apple")]
    let application = menu
        .items()?
        .into_iter()
        .next()
        .and_then(|item| {
            if let MenuItemKind::Submenu(submenu) = item {
                Some(submenu)
            } else {
                None
            }
        })
        .expect("Tauri's macOS default starts with the application submenu");
    #[cfg(not(target_vendor = "apple"))]
    let application = {
        let submenu = Submenu::new(app, app.package_info().name.clone(), true)?;
        submenu.append(&tauri::menu::PredefinedMenuItem::about(app, None, None)?)?;
        menu.prepend(&submenu)?;
        submenu
    };
    application.insert(
        &MenuItem::with_id(app, "app-settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
        1,
    )?;
    let project = Submenu::with_id(app, "project-menu", "Project", false)?;
    menu.insert(&project, 1)?;
    Ok(menu)
}

pub(crate) fn app_chosen<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    if event.id().0 == "app-settings" {
        if let Err(error) = app.emit("open-app-settings", ()) {
            crate::diagnostics::failure("open Settings", &error);
        }
    } else if matches!(event.id().0.as_str(), "import-work" | "project-settings")
        || event.id().0.starts_with("view:")
        || event.id().0.starts_with("action:")
    {
        let enabled = app
            .menu()
            .and_then(|menu| menu.get("project-menu"))
            .and_then(|item| match item {
                MenuItemKind::Submenu(project) => project.get(event.id().0.as_str()),
                _ => None,
            })
            .and_then(|item| {
                if let MenuItemKind::MenuItem(item) = item {
                    item.is_enabled().ok()
                } else {
                    None
                }
            })
            .unwrap_or(false);
        if !enabled {
            return;
        }
        let selected = app.state::<ProjectMenu>();
        let path = selected.0.lock().expect("Project menu lock");
        if let Some(path) = path.as_ref()
            && let Err(error) = app.emit(
                "open-project-page",
                serde_json::json!({ "path": path, "command": event.id().0 }),
            )
        {
            crate::diagnostics::failure("open Project page", &error);
        }
    } else {
        app.state::<Choice>().chosen(event);
    }
}

/// The webview's selected Project, captured by each native command at activation.
#[derive(Default)]
pub struct ProjectMenu(Mutex<Option<String>>);

#[tauri::command]
pub fn select_project_menu<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
    items: Option<Vec<Item>>,
) -> Result<(), RpcError> {
    let menu = app.menu().ok_or_else(|| internal("No application menu"))?;
    let Some(MenuItemKind::Submenu(project)) = menu.get("project-menu") else {
        return Err(internal("No Project menu"));
    };
    for item in project.items().map_err(internal)? {
        project.remove(&item).map_err(internal)?;
    }
    project.set_enabled(path.is_some()).map_err(internal)?;
    if path.is_some() {
        let items = items.unwrap_or_default();
        // Keep native separators between nonempty groups, including when availability changes.
        let mut separated = false;
        let mut hints = Vec::new();
        for group in ["create", "navigate", "views"] {
            let entries: Vec<_> = items
                .iter()
                .filter(|item| {
                    applicable(item) && item.group.as_deref().unwrap_or("navigate") == group
                })
                .collect();
            if entries.is_empty() {
                continue;
            }
            if separated {
                project
                    .append(&tauri::menu::PredefinedMenuItem::separator(&app).map_err(internal)?)
                    .map_err(internal)?;
            }
            for item in entries {
                let (entry, item_hints) =
                    project_kind(&app, item, |app, id, label, enabled, accelerator| {
                        MenuItem::with_id(app, id, label, enabled, accelerator)
                    })
                    .map_err(internal)?;
                let index = project.items().map_err(internal)?.len();
                project.append(&entry).map_err(internal)?;
                hints.extend(item_hints.into_iter().map(|(mut path, hint)| {
                    path.insert(0, index);
                    (path, hint)
                }));
            }
            separated = true;
        }
        if separated {
            project
                .append(&tauri::menu::PredefinedMenuItem::separator(&app).map_err(internal)?)
                .map_err(internal)?;
        }
        for (id, label) in [
            ("import-work", "Import Claude Code work…"),
            ("project-settings", "Open Project settings…"),
        ] {
            project
                .append(&MenuItem::with_id(&app, id, label, true, None::<&str>).map_err(internal)?)
                .map_err(internal)?;
        }
        #[cfg(target_vendor = "apple")]
        native::project_menu_hints(&app, hints).map_err(internal)?;
    }
    *app.state::<ProjectMenu>()
        .0
        .lock()
        .expect("Project menu lock") = path;
    Ok(())
}

/// Native menus share one-step accelerators, sequence hints and group metadata.
#[derive(Deserialize)]
pub struct Item {
    id: String,
    label: String,
    shortcut: Option<String>,
    group: Option<String>,
    enabled: bool,
    children: Option<Vec<Item>>,
}

/// The chosen id arrives as a menu event after the pop-up returns; at most one menu is open.
#[derive(Default)]
pub struct Choice(Mutex<Option<oneshot::Sender<String>>>);

impl Choice {
    pub fn chosen(&self, event: &MenuEvent) {
        if let Some(sender) = self.0.lock().expect("choice lock").take() {
            let _ = sender.send(event.id().0.clone());
        }
    }
}

fn applicable(item: &Item) -> bool {
    item.enabled
        && item
            .children
            .as_ref()
            .is_none_or(|children| children.iter().any(applicable))
}

fn append<R: Runtime>(app: &AppHandle<R>, into: &Menu<R>, items: &[Item]) -> tauri::Result<()> {
    let mut group = None;
    for item in items.iter().filter(|item| applicable(item)) {
        if group.is_some() && group != Some(&item.group) {
            into.append(&tauri::menu::PredefinedMenuItem::separator(app)?)?;
        }
        group = Some(&item.group);
        into.append(&kind(app, item, |app, id, label, enabled, accelerator| {
            MenuItem::with_id(app, id, label, enabled, accelerator)
        })?)?;
    }
    Ok(())
}

fn kind<R: Runtime>(
    app: &AppHandle<R>,
    item: &Item,
    build: impl Fn(&AppHandle<R>, &str, &str, bool, Option<&str>) -> tauri::Result<MenuItem<R>> + Copy,
) -> tauri::Result<MenuItemKind<R>> {
    project_kind(app, item, build).map(|(entry, _)| entry)
}

// The constructor is the platform boundary: observers can inspect the actual arguments supplied to Tauri.
fn project_kind<R: Runtime>(
    app: &AppHandle<R>,
    item: &Item,
    build: impl Fn(&AppHandle<R>, &str, &str, bool, Option<&str>) -> tauri::Result<MenuItem<R>> + Copy,
) -> tauri::Result<(MenuItemKind<R>, Vec<(Vec<usize>, String)>)> {
    if let Some(children) = &item.children {
        let sub = Submenu::new(app, &item.label, item.enabled)?;
        let mut hints = Vec::new();
        for (index, child) in children
            .iter()
            .filter(|child| applicable(child))
            .enumerate()
        {
            let (entry, child_hints) = project_kind(app, child, build)?;
            sub.append(&entry)?;
            hints.extend(child_hints.into_iter().map(|(mut path, hint)| {
                path.insert(0, index);
                (path, hint)
            }));
        }
        return Ok((MenuItemKind::Submenu(sub), hints));
    }
    let (accelerator, hint) = match item.shortcut.as_deref() {
        Some(shortcut) if shortcut.starts_with("⌘K ") => (None, Some(shortcut.to_owned())),
        // A plain key (a Shelf row's `D`) is control-owned: shown as a hint, never a global accelerator.
        Some(shortcut) if item.id.starts_with("action:") && !shortcut.contains(['⌘', '⌃', '⌥']) => {
            (None, Some(shortcut.to_owned()))
        }
        Some(shortcut) => (
            Some(
                shortcut
                    .replace('⌃', "Ctrl+")
                    .replace('⌥', "Alt+")
                    .replace('⇧', "Shift+")
                    .replace('⌘', "Super+")
                    .replace('⏎', "Enter")
                    .replace('⌫', "Backspace")
                    .replace('⌦', "Delete")
                    .replace('↑', "ArrowUp")
                    .replace('↓', "ArrowDown")
                    .replace('←', "ArrowLeft")
                    .replace('→', "ArrowRight"),
            ),
            None,
        ),
        None => (None, None),
    };
    let entry = build(
        app,
        &item.id,
        &item.label,
        item.enabled,
        accelerator.as_deref(),
    )?;
    Ok((
        MenuItemKind::MenuItem(entry),
        hint.into_iter().map(|hint| (Vec::new(), hint)).collect(),
    ))
}

#[cfg(any(target_vendor = "apple", test))]
fn sequence_hints(items: &[Item]) -> Vec<(String, String)> {
    items
        .iter()
        .filter(|item| item.enabled)
        .flat_map(|item| {
            if let Some(children) = &item.children {
                return sequence_hints(children);
            }
            item.shortcut
                .as_ref()
                .filter(|shortcut| shortcut.starts_with("⌘K "))
                .map(|shortcut| (item.label.clone(), shortcut.clone()))
                .into_iter()
                .collect()
        })
        .collect()
}

fn internal(error: impl ToString) -> RpcError {
    RpcError::new(code::INTERNAL, error.to_string())
}

#[tauri::command]
pub async fn show_context_menu<R: Runtime>(
    window: WebviewWindow<R>,
    choice: State<'_, Choice>,
    items: Vec<Item>,
    x: f64,
    y: f64,
) -> Result<Option<String>, RpcError> {
    let app = window.app_handle();
    let menu = Menu::new(app).map_err(internal)?;
    append(app, &menu, &items).map_err(internal)?;
    let (sender, mut receiver) = oneshot::channel();
    *choice.0.lock().expect("choice lock") = Some(sender);
    let (shown, closed) = oneshot::channel();
    let target = window.as_ref().window();
    let popped = target.clone();
    #[cfg(target_vendor = "apple")]
    let hints = sequence_hints(&items);
    target
        .run_on_main_thread(move || {
            #[cfg(target_vendor = "apple")]
            let result = native::context_menu(&popped, &menu, LogicalPosition::new(x, y), hints);
            #[cfg(not(target_vendor = "apple"))]
            let result = popped.popup_menu_at(&menu, LogicalPosition::new(x, y));
            let _ = shown.send(result);
        })
        .map_err(internal)?;
    closed.await.map_err(internal)?.map_err(internal)?;
    // The pop-up returns as the menu closes; the event of a choice follows at once.
    let picked = tokio::time::timeout(Duration::from_millis(100), &mut receiver)
        .await
        .ok()
        .and_then(Result::ok);
    choice.0.lock().expect("choice lock").take();
    Ok(picked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    fn item(id: &str, label: &str, shortcut: Option<&str>, children: Option<Vec<Item>>) -> Item {
        Item {
            id: id.to_owned(),
            label: label.to_owned(),
            shortcut: shortcut.map(str::to_owned),
            group: Some(
                if id.starts_with("view:") {
                    "views"
                } else if id.starts_with("action:chord:") && id != "action:chord:⌘/" {
                    "create"
                } else {
                    "navigate"
                }
                .to_owned(),
            ),
            enabled: true,
            children,
        }
    }

    fn plain<R: Runtime>(built: MenuItemKind<R>) -> MenuItem<R> {
        match built {
            MenuItemKind::MenuItem(plain) => plain,
            _ => panic!("expected a plain item"),
        }
    }

    #[test]
    fn u4322b_items_carry_native_accelerators() {
        let app = mock_app();
        for (chord, accelerator) in [
            (Some("F2"), Some("F2")),
            (Some("⌘⌫"), Some("Super+Backspace")),
            (None, None),
        ] {
            let built = kind(
                app.handle(),
                &item("action", "Rename", chord, None),
                |app, id, label, enabled, supplied| {
                    assert_eq!(supplied, accelerator);
                    MenuItem::with_id(app, id, label, enabled, supplied)
                },
            )
            .unwrap();
            let leaf = plain(built);
            assert_eq!(leaf.text().unwrap(), "Rename");
            assert_eq!(leaf.id().0, "action");
        }
    }

    #[test]
    fn u4322b_native_groups_and_submenus_reach_the_menu() {
        let app = mock_app();
        let menu = Menu::new(app.handle()).unwrap();
        let mut rename = item("rename", "Rename", Some("F2"), None);
        rename.group = Some("edit".into());
        let mut remove = item("remove", "Remove", Some("⌘⌫"), None);
        remove.group = Some("remove".into());
        let mut hidden = item("hidden", "Hidden", None, None);
        hidden.enabled = false;
        hidden.group = Some("omitted".into());
        append(
            app.handle(),
            &menu,
            &[
                rename,
                hidden,
                item("empty", "Empty", None, Some(vec![])),
                remove,
                item(
                    "add",
                    "Add",
                    None,
                    Some(vec![
                        item("child", "Pad", None, None),
                        Item {
                            enabled: false,
                            ..item("unavailable-child", "Unavailable", None, None)
                        },
                    ]),
                ),
            ],
        )
        .unwrap();
        let built = menu.items().unwrap();
        assert_eq!(built.len(), 5);
        assert_eq!(plain(built[0].clone()).id().0, "rename");
        assert!(matches!(built[1], MenuItemKind::Predefined(_)));
        assert_eq!(plain(built[2].clone()).id().0, "remove");
        assert!(matches!(built[3], MenuItemKind::Predefined(_)));
        let MenuItemKind::Submenu(sub) = &built[4] else {
            panic!("submenu missing")
        };
        assert_eq!(sub.items().unwrap().len(), 1);
        assert_eq!(plain(sub.items().unwrap()[0].clone()).id().0, "child");
    }

    #[test]
    fn u4322b_sequences_remain_hints() {
        let app = mock_app();
        let action = item("close", "Close", Some("⌘K W"), None);
        let (entry, hint) = project_kind(
            app.handle(),
            &action,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, None);
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        assert_eq!(plain(entry).text().unwrap(), "Close");
        assert_eq!(hint, [(vec![], "⌘K W".into())]);
        assert_eq!(sequence_hints(&[action]), [("Close".into(), "⌘K W".into())]);
    }

    #[test]
    fn u4322b_popup_accelerators_stay_in_the_popup() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder()
            .menu(app_menu)
            .build(mock_context(noop_assets()))
            .unwrap();
        let popup = Menu::new(app.handle()).unwrap();
        append(
            app.handle(),
            &popup,
            &[item("popup-rename", "Rename", Some("F2"), None)],
        )
        .unwrap();
        assert!(popup.get("popup-rename").is_some());
        assert!(app.menu().unwrap().get("popup-rename").is_none());
        drop(popup);
        assert!(app.menu().unwrap().get("popup-rename").is_none());
    }

    #[test]
    fn s_u3813_project_menu_tracks_the_selected_project() {
        use std::sync::Arc;
        use tauri::Listener;
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder()
            .manage(ProjectMenu::default())
            .menu(app_menu)
            .build(mock_context(noop_assets()))
            .unwrap();
        let menu = app.menu().unwrap();
        let project = menu
            .items()
            .unwrap()
            .into_iter()
            .find_map(|item| match item {
                MenuItemKind::Submenu(sub) if sub.text().unwrap() == "Project" => Some(sub),
                _ => None,
            })
            .expect("Project menu");
        let received = Arc::new(Mutex::new(Vec::new()));
        let observed = Arc::clone(&received);
        app.listen("open-project-page", move |event| {
            observed
                .lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap())
        });
        for path in [None, Some("/A"), Some("/B"), None] {
            select_project_menu(app.handle().clone(), path.map(str::to_owned), None).unwrap();
            let before = received.lock().unwrap().len();
            let items = project.items().unwrap();
            assert_eq!(items.len(), if path.is_some() { 2 } else { 0 });
            assert_eq!(project.is_enabled().unwrap(), path.is_some());
            for item in items.into_iter().map(plain) {
                assert!(item.is_enabled().unwrap());
                app_chosen(
                    app.handle(),
                    &MenuEvent {
                        id: item.id().clone(),
                    },
                );
            }
            let replies = received.lock().unwrap();
            if let Some(path) = path {
                assert_eq!(
                    &replies[before..],
                    &[
                        serde_json::json!({"path": path, "command": "import-work"}),
                        serde_json::json!({"path": path, "command": "project-settings"}),
                    ]
                );
            } else {
                assert_eq!(replies.len(), before);
            }
        }
    }
    #[test]
    fn u4278a_native_separators_split_action_groups() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder()
            .manage(ProjectMenu::default())
            .menu(app_menu)
            .build(mock_context(noop_assets()))
            .unwrap();
        select_project_menu(
            app.handle().clone(),
            Some("/A".to_owned()),
            Some(vec![
                item("action:chord:⇧⌘T", "Capture a Todo", Some("⇧⌘T"), None),
                item("action:chord:⌘/", "Focus Ask", Some("⌘/"), None),
                item("action:leader:A", "Assign Todo", Some("⌘K A"), None),
                item("action:leader:S", "Open work items", Some("⌘K S"), None),
                item("view:notes", "Recover notes", None, None),
                item("action:leader:C", "Review changes", Some("⌘K C"), None),
                item("action:chord:⌘N", "New Agent", Some("⌘N"), None),
                item("action:chord:⌘T", "New Terminal", Some("⌘T"), None),
                item("action:leader:T", "Capture a Todo", Some("⌘K T"), None),
                item(
                    "action:chord:⇧⌘N",
                    "New Agent with a prompt",
                    Some("⇧⌘N"),
                    None,
                ),
                item("action:leader:P", "Switch Project", Some("⌘K P"), None),
                item(
                    "action:leader:J",
                    "Jump to what needs you",
                    Some("⌘K J"),
                    None,
                ),
                item("action:leader:I", "Open the Inbox", Some("⌘K I"), None),
                item("action:future", "A newly registered action", None, None),
                item("view:workstreams", "Open Workstreams", None, None),
            ]),
        )
        .unwrap();
        let MenuItemKind::Submenu(project) = app.menu().unwrap().get("project-menu").unwrap()
        else {
            panic!("Project submenu");
        };
        let ids: Vec<_> = project
            .items()
            .unwrap()
            .into_iter()
            .map(|entry| match entry {
                MenuItemKind::MenuItem(entry) => entry.id().0.clone(),
                MenuItemKind::Predefined(_) => "separator".to_owned(),
                _ => panic!("Unexpected submenu"),
            })
            .collect();
        assert_eq!(
            ids,
            [
                "action:chord:⇧⌘T",
                "action:chord:⌘N",
                "action:chord:⌘T",
                "action:chord:⇧⌘N",
                "separator",
                "action:chord:⌘/",
                "action:leader:A",
                "action:leader:S",
                "action:leader:C",
                "action:leader:T",
                "action:leader:P",
                "action:leader:J",
                "action:leader:I",
                "action:future",
                "separator",
                "view:notes",
                "view:workstreams",
                "separator",
                "import-work",
                "project-settings",
            ]
        );
    }

    #[test]
    fn u4278b_one_step_items_carry_native_accelerators() {
        let app = mock_app();
        for (chord, expected) in [
            ("⌘N", "Super+N"),
            ("⌘T", "Super+T"),
            ("⇧⌘T", "Shift+Super+T"),
            ("⌃⇧Y", "Ctrl+Shift+Y"),
            ("⌘/", "Super+/"),
            ("⌥⏎", "Alt+Enter"),
            ("⌃↑", "Ctrl+ArrowUp"),
            ("⌘=", "Super+="),
            ("⌘-", "Super+-"),
            ("⌘0", "Super+0"),
        ] {
            let source = item(
                &format!("action:chord:{chord}"),
                "Run action",
                Some(chord),
                None,
            );
            let (built, hint) = project_kind(
                app.handle(),
                &source,
                |app, id, label, enabled, accelerator| {
                    assert_eq!(accelerator, Some(expected));
                    MenuItem::with_id(app, id, label, enabled, accelerator)
                },
            )
            .unwrap();
            assert_eq!(plain(built).text().unwrap(), source.label);
            assert!(hint.is_empty());
        }
    }

    #[test]
    fn u3787b_numbered_submenu_keeps_each_target_and_hint() {
        let app = mock_app();
        let source = item(
            "assignment",
            "Assign to",
            None,
            Some(vec![
                item(
                    "action:chord:1–9:Digit1",
                    "Assign to same name",
                    Some("1"),
                    None,
                ),
                Item {
                    enabled: false,
                    ..item("unavailable", "Assign to hidden", Some("2"), None)
                },
                item(
                    "action:chord:1–9:Digit9",
                    "Assign to same name",
                    Some("9"),
                    None,
                ),
            ]),
        );
        let (entry, hints) = project_kind(
            app.handle(),
            &source,
            |app, id, label, enabled, accelerator| {
                assert_eq!(accelerator, None);
                MenuItem::with_id(app, id, label, enabled, accelerator)
            },
        )
        .unwrap();
        let MenuItemKind::Submenu(sub) = entry else {
            panic!("assignment submenu missing")
        };
        let ids: Vec<_> = sub
            .items()
            .unwrap()
            .into_iter()
            .map(|item| plain(item).id().0.clone())
            .collect();
        assert_eq!(ids, ["action:chord:1–9:Digit1", "action:chord:1–9:Digit9"]);
        assert_eq!(hints, [(vec![0], "1".into()), (vec![1], "9".into())]);
    }

    #[test]
    fn u3787b_plain_key_commands_register_no_accelerator() {
        let app = mock_app();
        for key in [
            "D", "E", "M", "J K", "⇧Tab", "Tab", "1–9", "⏎", "F2", "?", "1", "9",
        ] {
            let source = item(
                &format!("action:chord:{key}"),
                "Run action",
                Some(key),
                None,
            );
            let (built, hint) = project_kind(
                app.handle(),
                &source,
                |app, id, label, enabled, accelerator| {
                    assert_eq!(accelerator, None);
                    MenuItem::with_id(app, id, label, enabled, accelerator)
                },
            )
            .unwrap();
            assert_eq!(plain(built).text().unwrap(), source.label);
            assert_eq!(hint, [(vec![], key.into())]);
        }
    }

    #[test]
    fn u4278b_leader_hints_register_no_accelerator() {
        let app = mock_app();
        for key in ["P", "J", "I", "C", "A", "S"] {
            let shortcut = format!("⌘K {key}");
            let source = item(
                &format!("action:leader:{key}"),
                "Run action",
                Some(&shortcut),
                None,
            );
            let (built, hint) = project_kind(
                app.handle(),
                &source,
                |app, id, label, enabled, accelerator| {
                    assert_eq!(accelerator, None);
                    MenuItem::with_id(app, id, label, enabled, accelerator)
                },
            )
            .unwrap();
            assert_eq!(plain(built).text().unwrap(), source.label);
            assert_eq!(hint, [(vec![], shortcut)]);
        }
    }

    #[test]
    fn u2539b_native_menu_projects_the_task_chords() {
        use std::sync::Arc;
        use tauri::Listener;
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder()
            .manage(ProjectMenu::default())
            .menu(app_menu)
            .build(mock_context(noop_assets()))
            .unwrap();
        let received = Arc::new(Mutex::new(Vec::new()));
        let observed = Arc::clone(&received);
        app.listen("open-project-page", move |event| {
            observed
                .lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
        });
        for path in ["/A", "/B"] {
            let mut unavailable = item("action:leader:A", "Assign Todo", Some("⌘K A"), None);
            unavailable.enabled = false;
            select_project_menu(
                app.handle().clone(),
                Some(path.to_owned()),
                Some(vec![
                    item("action:leader:C", "Review changes", Some("⌘K C"), None),
                    item("action:chord:⌘F", "Find…", Some("⌘F"), None),
                    item("action:chord:F2", "Rename", Some("F2"), None),
                    item("action:chord:?", "Help", Some("?"), None),
                    item("action:chord:⌘=", "Larger Terminal text", Some("⌘="), None),
                    item("action:chord:⌘-", "Smaller Terminal text", Some("⌘-"), None),
                    item(
                        "action:chord:⌘0",
                        "Reset Terminal text size",
                        Some("⌘0"),
                        None,
                    ),
                    item("action:chord:A", "Assign", Some("A"), None),
                    item("action:chord:W", "Move", Some("W"), None),
                    item("action:chord:X", "Complete", Some("X"), None),
                    item("action:chord:C", "Comment", Some("C"), None),
                    item("action:chord:Tab", "Nest", Some("Tab"), None),
                    item("action:chord:⇧Tab", "Unnest", Some("⇧Tab"), None),
                    item(
                        "action:chord:1–9:Digit1",
                        "Assign to first Agent",
                        Some("1"),
                        None,
                    ),
                    item(
                        "action:chord:1–9:Digit9",
                        "Assign to ninth Agent",
                        Some("9"),
                        None,
                    ),
                    unavailable,
                ]),
            )
            .unwrap();
            let menu = app.menu().unwrap();
            let MenuItemKind::Submenu(project) = menu.get("project-menu").unwrap() else {
                panic!("Project submenu");
            };
            let changes = plain(project.get("action:leader:C").unwrap());
            assert_eq!(changes.text().unwrap(), "Review changes");
            for id in [
                "action:leader:C",
                "action:chord:⌘F",
                "action:chord:F2",
                "action:chord:?",
                "action:chord:⌘=",
                "action:chord:⌘-",
                "action:chord:⌘0",
                "action:chord:A",
                "action:chord:W",
                "action:chord:X",
                "action:chord:C",
                "action:chord:Tab",
                "action:chord:⇧Tab",
                "action:chord:1–9:Digit1",
                "action:chord:1–9:Digit9",
                "action:leader:A",
            ] {
                app_chosen(app.handle(), &MenuEvent { id: id.into() });
            }
        }
        assert_eq!(
            *received.lock().unwrap(),
            vec![
                serde_json::json!({"path": "/A", "command": "action:leader:C"}),
                serde_json::json!({"path": "/A", "command": "action:chord:⌘F"}),
                serde_json::json!({"path": "/A", "command": "action:chord:F2"}),
                serde_json::json!({"path": "/A", "command": "action:chord:?"}),
                serde_json::json!({"path": "/A", "command": "action:chord:⌘="}),
                serde_json::json!({"path": "/A", "command": "action:chord:⌘-"}),
                serde_json::json!({"path": "/A", "command": "action:chord:⌘0"}),
                serde_json::json!({"path": "/A", "command": "action:chord:A"}),
                serde_json::json!({"path": "/A", "command": "action:chord:W"}),
                serde_json::json!({"path": "/A", "command": "action:chord:X"}),
                serde_json::json!({"path": "/A", "command": "action:chord:C"}),
                serde_json::json!({"path": "/A", "command": "action:chord:Tab"}),
                serde_json::json!({"path": "/A", "command": "action:chord:⇧Tab"}),
                serde_json::json!({"path": "/A", "command": "action:chord:1–9:Digit1"}),
                serde_json::json!({"path": "/A", "command": "action:chord:1–9:Digit9"}),
                serde_json::json!({"path": "/B", "command": "action:leader:C"}),
                serde_json::json!({"path": "/B", "command": "action:chord:⌘F"}),
                serde_json::json!({"path": "/B", "command": "action:chord:F2"}),
                serde_json::json!({"path": "/B", "command": "action:chord:?"}),
                serde_json::json!({"path": "/B", "command": "action:chord:⌘="}),
                serde_json::json!({"path": "/B", "command": "action:chord:⌘-"}),
                serde_json::json!({"path": "/B", "command": "action:chord:⌘0"}),
                serde_json::json!({"path": "/B", "command": "action:chord:A"}),
                serde_json::json!({"path": "/B", "command": "action:chord:W"}),
                serde_json::json!({"path": "/B", "command": "action:chord:X"}),
                serde_json::json!({"path": "/B", "command": "action:chord:C"}),
                serde_json::json!({"path": "/B", "command": "action:chord:Tab"}),
                serde_json::json!({"path": "/B", "command": "action:chord:⇧Tab"}),
                serde_json::json!({"path": "/B", "command": "action:chord:1–9:Digit1"}),
                serde_json::json!({"path": "/B", "command": "action:chord:1–9:Digit9"}),
            ]
        );
    }
}
