//! U2694a: the macOS system menu (`NSMenu`) the webview asks for, popped up at the pointer.

use crate::Unpoisoned;
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
        .ok_or_else(|| {
            std::io::Error::other("Tauri's macOS default starts with the application submenu")
        })?;
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
    // FS5979a: disabled until a Project is open (`select_project_menu` enables it).
    application.insert(
        &MenuItem::with_id(
            app,
            "fork-sheet",
            "Fork for development…",
            false,
            None::<&str>,
        )?,
        2,
    )?;
    // SU5982e: only a slot-launched App (`ROUNDUP_SLOT`) offers Restart to update.
    if let Ok(running) = std::env::var("ROUNDUP_SLOT") {
        if let Some(home) = crate::update::home() {
            crate::update::sync(
                app,
                &application,
                &crate::update::update_status(&home, &running),
            )?;
        }
        crate::update::watch(app, application.clone(), running);
    }
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

/// The one reader of a menu item's id text.
enum MenuCommand<'a> {
    Update,
    AppSettings,
    ForkSheet,
    /// An id the Project or Edit menu holds, kept whole as the payload's `command`.
    Project(&'a str),
    /// Any other id: the popped-up menu's pending `Choice`.
    Choice,
}

impl<'a> MenuCommand<'a> {
    fn parse(id: &'a str) -> Self {
        match id {
            crate::update::ITEM => Self::Update,
            "app-settings" => Self::AppSettings,
            "fork-sheet" => Self::ForkSheet,
            "import-work" | "project-settings" => Self::Project(id),
            _ if id.starts_with("view:") || id.starts_with("action:") => Self::Project(id),
            _ => Self::Choice,
        }
    }
}

pub(crate) fn app_chosen<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    match MenuCommand::parse(event.id().0.as_str()) {
        MenuCommand::Update => {
            if let (Ok(running), Some(home)) =
                (std::env::var("ROUNDUP_SLOT"), crate::update::home())
                && crate::update::choose(&crate::update::update_status(&home, &running), |slot| {
                    if let Err(error) = crate::update::relaunch_into(&home, slot) {
                        crate::diagnostics::failure(
                            "relaunch into the new build",
                            &tauri::Error::Io(error),
                        );
                    }
                })
            {
                app.exit(0);
            }
        }
        MenuCommand::AppSettings => {
            if let Err(error) = app.emit("open-app-settings", ()) {
                crate::diagnostics::failure("open Settings", &error);
            }
        }
        MenuCommand::ForkSheet => {
            if let Err(error) = app.emit("open-fork-sheet", ()) {
                crate::diagnostics::failure("open the Fork sheet", &error);
            }
        }
        MenuCommand::Project(command) => open_project_page(app, command),
        MenuCommand::Choice => app.state::<Choice>().chosen(event),
    }
}

fn open_project_page<R: Runtime>(app: &AppHandle<R>, command: &str) {
    let owner = if matches!(command, "action:chord:⌘Z" | "action:chord:⇧⌘Z") {
        "edit-menu"
    } else {
        "project-menu"
    };
    let enabled = app
        .menu()
        .and_then(|menu| menu.get(owner))
        .and_then(|item| match item {
            MenuItemKind::Submenu(submenu) => submenu.get(command),
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
    let path = selected.0.lock().unpoisoned();
    if let Some(path) = path.as_ref()
        && let Err(error) = app.emit(
            "open-project-page",
            serde_json::json!({ "path": path, "command": command }),
        )
    {
        crate::diagnostics::failure("open Project page", &error);
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
    project.set_enabled(true).map_err(internal)?;
    if let Some(MenuItemKind::Submenu(application)) =
        menu.items().map_err(internal)?.into_iter().next()
        && let Some(MenuItemKind::MenuItem(fork)) = application.get("fork-sheet")
    {
        fork.set_enabled(path.is_some()).map_err(internal)?;
    }
    let mut items = items.unwrap_or_default();
    if path.is_none() {
        for item in &mut items {
            item.enabled = false;
        }
    }
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
    {
        // Keep native separators between nonempty groups, including when availability changes.
        let mut separated = false;
        let mut hints = Vec::new();
        for group in ["create", "navigate"] {
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
        #[cfg(target_vendor = "apple")]
        native::project_menu_hints(&app, hints).map_err(internal)?;
    }
    *app.state::<ProjectMenu>().0.lock().unpoisoned() = path;
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
    checked: Option<bool>,
    children: Option<Vec<Item>>,
}

/// The chosen id arrives as a menu event after the pop-up returns; at most one menu is open.
#[derive(Default)]
pub struct Choice(Mutex<Option<oneshot::Sender<String>>>);

impl Choice {
    pub fn chosen(&self, event: &MenuEvent) {
        if let Some(sender) = self.0.lock().unpoisoned().take() {
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
        Some(shortcut) if shortcut.contains(' ') => (None, Some(shortcut.to_owned())),
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
    if let Some(checked) = item.checked {
        let entry = tauri::menu::CheckMenuItem::with_id(
            app,
            &item.id,
            &item.label,
            item.enabled,
            checked,
            accelerator.as_deref(),
        )?;
        return Ok((MenuItemKind::Check(entry), Vec::new()));
    }
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
                    shortcut.contains(' ')
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
    *choice.0.lock().unpoisoned() = Some(sender);
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
    choice.0.lock().unpoisoned().take();
    Ok(picked)
}

#[cfg(test)]
mod tests;
