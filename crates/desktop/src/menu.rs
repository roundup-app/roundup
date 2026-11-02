//! U2694a: the macOS system menu (`NSMenu`) the webview asks for, popped up at the pointer.

use std::sync::Mutex;
use std::time::Duration;

use rpc::{RpcError, code};
use serde::Deserialize;
use tauri::Emitter;
use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, LogicalPosition, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
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
        &MenuItem::with_id(
            app,
            "copy-version-info",
            "Copy Version Info",
            true,
            None::<&str>,
        )?,
        1,
    )?;
    application.insert(
        &MenuItem::with_id(
            app,
            "copy-debug-info",
            "Copy Debug Info",
            true,
            None::<&str>,
        )?,
        2,
    )?;
    application.insert(
        &MenuItem::with_id(app, "app-settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
        3,
    )?;
    // Keep the standard native editing commands; only history changes with region focus.
    let edit_position = menu
        .items()?
        .into_iter()
        .enumerate()
        .find_map(|(index, item)| {
            if let MenuItemKind::Submenu(edit) = item
                && edit.text().ok().as_deref() == Some("Edit")
            {
                return Some((index, edit));
            }
            None
        });
    let edit_index = if let Some((index, edit)) = edit_position {
        menu.remove(&edit)?;
        index
    } else {
        menu.items()?.len()
    };
    let edit = Submenu::with_id(app, "edit-menu", "Edit", true)?;
    menu.insert(&edit, edit_index)?;
    edit.append(&tauri::menu::PredefinedMenuItem::undo(app, None)?)?;
    edit.append(&tauri::menu::PredefinedMenuItem::redo(app, None)?)?;
    edit.append(&tauri::menu::PredefinedMenuItem::separator(app)?)?;
    edit.append(&tauri::menu::PredefinedMenuItem::cut(app, None)?)?;
    edit.append(&tauri::menu::PredefinedMenuItem::copy(app, None)?)?;
    edit.append(&tauri::menu::PredefinedMenuItem::paste(app, None)?)?;
    edit.append(&tauri::menu::PredefinedMenuItem::select_all(app, None)?)?;
    let project = Submenu::with_id(app, "project-menu", "Project", false)?;
    menu.insert(&project, 1)?;
    Ok(menu)
}

/// U5244d: the one line `roundup <App version> (<build>)`.
fn version_info(version: &str, build: &str) -> String {
    format!("roundup {version} ({build})")
}

/// U5244e: exactly four lines, each a fact about the install; no Project, path or usage value.
fn debug_info(version: &str, build: &str, macos: &str, daemon_reachable: bool) -> String {
    let (daemon_version, reachability) = if daemon_reachable {
        // The Daemon ships in the App bundle, so it runs the App's own version.
        (version, "reachable")
    } else {
        ("unknown", "unreachable")
    };
    format!(
        "roundup {version} ({build})\nDaemon {daemon_version}\nmacOS {macos}\nDaemon {reachability}"
    )
}

fn macos_version() -> String {
    std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist")
        .ok()
        .and_then(|plist| {
            let (_, rest) = plist.split_once("<key>ProductVersion</key>")?;
            let (_, rest) = rest.split_once("<string>")?;
            Some(rest.split_once("</string>")?.0.to_owned())
        })
        .unwrap_or_else(|| "unknown".to_owned())
}

/// U5244e: the Daemon is reachable when an open Project's Daemon answers `daemon.ping`.
async fn daemon_reachable<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<crate::AppState>() else {
        return false;
    };
    let Ok(projects) = state.projects() else {
        return false;
    };
    let paths: Vec<String> = projects
        .into_iter()
        .filter(|project| project.running)
        .map(|project| project.path)
        .collect();
    any_answers(paths, |path| {
        let state = &state;
        async move {
            state
                .rpc(&path, "daemon.ping", serde_json::Value::Null)
                .await
                .is_ok()
        }
    })
    .await
}

/// True once any of `paths` has a Daemon whose `ping` answers.
async fn any_answers<F, Fut>(paths: Vec<String>, ping: F) -> bool
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    for path in paths {
        if ping(path).await {
            return true;
        }
    }
    false
}

/// The text a Copy item writes, or `None` for any other id.
fn info_text<R: Runtime>(app: &AppHandle<R>, id: &str, daemon_reachable: bool) -> Option<String> {
    let version = app.package_info().version.to_string();
    let build = env!("ROUNDUP_BUILD");
    match id {
        "copy-version-info" => Some(version_info(&version, build)),
        "copy-debug-info" => Some(debug_info(
            &version,
            build,
            &macos_version(),
            daemon_reachable,
        )),
        _ => None,
    }
}

pub(crate) fn app_chosen<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    if matches!(
        event.id().0.as_str(),
        "copy-version-info" | "copy-debug-info"
    ) {
        let app = app.clone();
        let id = event.id().0.clone();
        tauri::async_runtime::spawn(async move {
            let reachable = daemon_reachable(&app).await;
            if let Some(text) = info_text(&app, &id, reachable)
                && app.clipboard().write_text(text).is_err()
            {
                log::warn!(target: "roundup::shell", "copy info: clipboard write failed");
            }
        });
    } else if event.id().0 == "app-settings" {
        if let Err(error) = app.emit("open-app-settings", ()) {
            crate::diagnostics::failure("open Settings", &error);
        }
    } else if matches!(event.id().0.as_str(), "import-work" | "project-settings")
        || event.id().0.starts_with("view:")
        || event.id().0.starts_with("action:")
    {
        let enabled = app
            .menu()
            .and_then(|menu| {
                menu.get(
                    if matches!(
                        event.id().0.as_str(),
                        "action:chord:⌘Z" | "action:chord:⇧⌘Z"
                    ) {
                        "edit-menu"
                    } else {
                        "project-menu"
                    },
                )
            })
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
    let items = items.unwrap_or_default();
    if let Some(MenuItemKind::Submenu(edit)) = menu.get("edit-menu") {
        // Replace only the two history commands, leaving native Cut/Copy/Paste responders intact.
        for item in edit.items().map_err(internal)?.into_iter().take(2) {
            edit.remove(&item).map_err(internal)?;
        }
        let history: Vec<_> = items
            .iter()
            .filter(|item| item.group.as_deref() == Some("edit"))
            .collect();
        if history.is_empty() {
            edit.insert(
                &tauri::menu::PredefinedMenuItem::undo(&app, None).map_err(internal)?,
                0,
            )
            .map_err(internal)?;
            edit.insert(
                &tauri::menu::PredefinedMenuItem::redo(&app, None).map_err(internal)?,
                1,
            )
            .map_err(internal)?;
        } else {
            for (index, item) in history.into_iter().enumerate() {
                let (entry, _) =
                    project_kind(&app, item, true, |app, id, label, enabled, accelerator| {
                        MenuItem::with_id(app, id, label, enabled, accelerator)
                    })
                    .map_err(internal)?;
                edit.insert(&entry, index).map_err(internal)?;
            }
        }
    }
    if path.is_some() {
        // Keep native separators between nonempty groups, including when availability changes.
        let mut separated = false;
        let mut hints = Vec::new();
        for group in ["create", "navigate", "views"] {
            let entries: Vec<_> = items
                .iter()
                .filter(|item| item.group.as_deref().unwrap_or("navigate") == group)
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
                    project_kind(&app, item, true, |app, id, label, enabled, accelerator| {
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
    } else {
        #[cfg(target_vendor = "apple")]
        native::project_menu_hints(&app, Vec::new()).map_err(internal)?;
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
    project_kind(app, item, false, build).map(|(entry, _)| entry)
}

type MenuHints = Vec<(Vec<usize>, String)>;

// The constructor is the platform boundary: observers can inspect the actual arguments supplied to Tauri.
fn project_kind<R: Runtime>(
    app: &AppHandle<R>,
    item: &Item,
    keep_disabled: bool,
    build: impl Fn(&AppHandle<R>, &str, &str, bool, Option<&str>) -> tauri::Result<MenuItem<R>> + Copy,
) -> tauri::Result<(MenuItemKind<R>, MenuHints)> {
    if let Some(children) = &item.children {
        let sub = Submenu::new(app, &item.label, item.enabled)?;
        let mut hints = Vec::new();
        for (index, child) in children
            .iter()
            .filter(|child| keep_disabled || applicable(child))
            .enumerate()
        {
            let (entry, child_hints) = project_kind(app, child, keep_disabled, build)?;
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
                .filter(|shortcut| {
                    shortcut.starts_with("⌘K ")
                        || (item.id.starts_with("action:") && !shortcut.contains(['⌘', '⌃', '⌥']))
                })
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
mod tests;
