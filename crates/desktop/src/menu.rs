//! U2694a: the macOS system menu (`NSMenu`) the webview asks for, popped up at the pointer.

use std::sync::Mutex;
use std::time::Duration;

use rpc::{RpcError, code};
use serde::Deserialize;
use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, LogicalPosition, Manager, Runtime, State, WebviewWindow};
use tokio::sync::oneshot;

/// One item of the webview's menu model. `shortcut` is text appended to the label, never an accelerator.
#[derive(Deserialize)]
pub struct Item {
    id: String,
    label: String,
    shortcut: Option<String>,
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

fn text(item: &Item) -> String {
    match &item.shortcut {
        Some(chord) => format!("{}\t{chord}", item.label),
        None => item.label.clone(),
    }
}

fn append<R: Runtime>(app: &AppHandle<R>, into: &Menu<R>, items: &[Item]) -> tauri::Result<()> {
    for item in items {
        into.append(&kind(app, item)?)?;
    }
    Ok(())
}

fn kind<R: Runtime>(app: &AppHandle<R>, item: &Item) -> tauri::Result<MenuItemKind<R>> {
    match &item.children {
        Some(children) => {
            let sub = Submenu::new(app, &item.label, item.enabled)?;
            for child in children {
                sub.append(&kind(app, child)?)?;
            }
            Ok(MenuItemKind::Submenu(sub))
        }
        None => Ok(MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            item.id.clone(),
            text(item),
            item.enabled,
            None::<&str>,
        )?)),
    }
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
    target
        .run_on_main_thread(move || {
            let _ = shown.send(popped.popup_menu_at(&menu, LogicalPosition::new(x, y)));
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

    /// U2694a: the host builds each item with no accelerator; a chord is label text only, so no `NSMenu` key equivalent fires from the menu bar.
    #[test]
    fn u2694a_no_item_carries_an_accelerator() {
        let app = mock_app();
        let rename =
            plain(kind(app.handle(), &item("rename", "Rename", Some("F2"), None)).unwrap());
        let copy = plain(kind(app.handle(), &item("copy", "Copy Link", None, None)).unwrap());

        assert_eq!(rename.text().unwrap(), "Rename\tF2");
        assert_eq!(copy.text().unwrap(), "Copy Link");
    }

    /// U2694a: a `children` list is a submenu, each child an item with its own id and enabled state.
    #[test]
    fn u2694a_children_build_a_submenu() {
        let app = mock_app();
        let mut gone = item("send:x", "x", None, None);
        gone.enabled = false;
        let built = kind(
            app.handle(),
            &item(
                "send",
                "Send to Agent",
                None,
                Some(vec![item("send:a", "a", None, None), gone]),
            ),
        )
        .unwrap();
        let MenuItemKind::Submenu(sub) = built else {
            panic!("expected a submenu")
        };
        let children: Vec<_> = sub.items().unwrap().into_iter().map(plain).collect();

        assert_eq!(
            children
                .iter()
                .map(|child| child.text().unwrap())
                .collect::<Vec<_>>(),
            ["a", "x"]
        );
        assert_eq!(
            children
                .iter()
                .map(|child| child.is_enabled().unwrap())
                .collect::<Vec<_>>(),
            [true, false]
        );
    }
}
