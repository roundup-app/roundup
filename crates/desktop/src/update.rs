//! SU5982e: the application menu's "Restart to update" item, driven by the Build slots the launcher
//! (`tools/update/update.sh`) keeps under `$ROUNDUP_HOME/slots/`. Nothing here starts a build or restarts by itself.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::{MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Runtime};

pub(crate) const ITEM: &str = "restart-to-update";

/// What the item shows: the `update.status` answer.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Status {
    /// `good` names another slot than the one running: the item is enabled.
    Ready { slot: String },
    /// The spare slot holds `failed.json` for a newer commit: the item is disabled and says why.
    Failed { step: String, cause: String },
    /// Nothing to offer: no item.
    Idle,
}

#[derive(Deserialize)]
struct Failed {
    commit: String,
    step: String,
    cause: String,
}

/// `$ROUNDUP_HOME`, or `~/.roundup`.
pub(crate) fn home() -> Option<PathBuf> {
    std::env::var_os("ROUNDUP_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".roundup")))
}

fn read(path: &Path) -> Option<String> {
    Some(std::fs::read_to_string(path).ok()?.trim().to_owned())
}

/// SU5982e: read the slots under `home` for the App running slot `running`.
pub(crate) fn update_status(home: &Path, running: &str) -> Status {
    let slots = home.join("slots");
    let good = read(&slots.join("good")).filter(|good| !good.is_empty());
    match good.as_deref() {
        Some(good) if good != running => Status::Ready {
            slot: good.to_owned(),
        },
        good => {
            let built = good.and_then(|good| read(&slots.join(good).join(".built")));
            ["A", "B"]
                .into_iter()
                .filter(|slot| *slot != running && Some(*slot) != good)
                .find_map(|spare| {
                    let failed: Failed =
                        serde_json::from_str(&read(&slots.join(spare).join("failed.json"))?)
                            .ok()?;
                    (built.as_deref() != Some(failed.commit.as_str())).then_some(Status::Failed {
                        step: failed.step,
                        cause: failed.cause,
                    })
                })
                .unwrap_or(Status::Idle)
        }
    }
}

impl Status {
    /// The item's text, enabled state and tooltip; `None` shows no item.
    pub(crate) fn item(&self) -> Option<(String, bool, Option<&str>)> {
        match self {
            Status::Ready { .. } => Some(("Restart to update".to_owned(), true, None)),
            Status::Failed { step, cause } => {
                Some((format!("Update failed: {step}"), false, Some(cause)))
            }
            Status::Idle => None,
        }
    }
}

/// Choosing the item: relaunch into the `good` slot. The Daemon outlives the App, so no Agent,
/// Terminal or Worktree is signalled; the caller quits afterwards.
pub(crate) fn choose(status: &Status, relaunch: impl FnOnce(&str)) -> bool {
    match status {
        Status::Ready { slot } => {
            relaunch(slot);
            true
        }
        _ => false,
    }
}

/// Starts `just app` for the first Project in the slot's checkout, on the same data folder.
pub(crate) fn relaunch_into(home: &Path, slot: &str) -> std::io::Result<()> {
    let mut command = Command::new("just");
    command
        .arg("app")
        .arg(std::env::args_os().nth(1).unwrap_or_else(|| ".".into()))
        .current_dir(home.join("slots").join(slot))
        .env("ROUNDUP_SLOT", slot)
        .env("ROUNDUP_HOME", home)
        .stdin(Stdio::null());
    command.spawn().map(drop)
}

/// Puts the item in `application` as `status` says, replacing the one there.
pub(crate) fn sync<R: Runtime>(
    app: &AppHandle<R>,
    application: &Submenu<R>,
    status: &Status,
) -> tauri::Result<()> {
    if let Some(MenuItemKind::MenuItem(old)) = application.get(ITEM) {
        application.remove(&old)?;
    }
    if let Some((text, enabled, _)) = status.item() {
        application.insert(
            &MenuItem::with_id(app, ITEM, text, enabled, None::<&str>)?,
            4,
        )?;
    }
    Ok(())
}

/// Re-reads the slots now and every 30 s; only the menu text changes.
pub(crate) fn watch<R: Runtime>(app: &AppHandle<R>, application: Submenu<R>, running: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Some(home) = home()
                && let Err(error) = sync(&app, &application, &update_status(&home, &running))
            {
                crate::diagnostics::failure("refresh Restart to update", &error);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slots(good: Option<&str>, failed: Option<(&str, &str)>) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let slots = home.path().join("slots");
        std::fs::create_dir_all(slots.join("B")).unwrap();
        std::fs::create_dir_all(slots.join("A")).unwrap();
        if let Some(good) = good {
            std::fs::write(slots.join("good"), format!("{good}\n")).unwrap();
            std::fs::write(slots.join(good).join(".built"), "old").unwrap();
        }
        if let Some((step, cause)) = failed {
            std::fs::write(
                slots.join("B").join("failed.json"),
                format!(r#"{{"commit":"new","step":"{step}","cause":"{cause}"}}"#),
            )
            .unwrap();
        }
        home
    }

    #[test]
    fn su5982e_the_item_follows_good_and_failed_json() {
        let ready = slots(Some("B"), None);
        let failed = slots(Some("A"), Some(("open", "app-1: refused")));
        let none = slots(Some("A"), None);
        let stale = slots(Some("A"), None);
        std::fs::write(stale.path().join("slots/A/.built"), "new").unwrap();
        std::fs::write(
            stale.path().join("slots/B/failed.json"),
            r#"{"commit":"new","step":"build","cause":"x"}"#,
        )
        .unwrap();
        let table = [
            (&ready, Some(("Restart to update".to_owned(), true, None))),
            (
                &failed,
                Some((
                    "Update failed: open".to_owned(),
                    false,
                    Some("app-1: refused"),
                )),
            ),
            (&none, None),
            (&stale, None),
        ];
        for (home, want) in table {
            let status = update_status(home.path(), "A");
            assert_eq!(
                status.item().as_ref().map(|(t, e, c)| (t.clone(), *e, *c)),
                want
            );
        }
    }

    #[test]
    fn su5982e_choosing_relaunches_into_the_good_slot_only() {
        let ready = slots(Some("B"), None);
        let mut seen = None;
        assert!(choose(&update_status(ready.path(), "A"), |slot| {
            seen = Some(slot.to_owned());
        }));
        assert_eq!(seen.as_deref(), Some("B"));
        let mut called = false;
        assert!(!choose(&Status::Idle, |_| called = true));
        assert!(!called);
    }
}
