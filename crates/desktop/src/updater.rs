//! CH7077e: an installed build's "Update available" item, offered from its channel's signed feed
//! (`plugins.updater` of its config overlay). Nothing here installs or relaunches by itself.

use crate::Unpoisoned;
use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

use crate::AppState;

pub(crate) const ITEM: &str = "install-update";

/// How often the feed is read after the first read at launch.
const EVERY: Duration = Duration::from_secs(60 * 60);

/// The newer version the feed offered last; `None` until it offers one.
#[derive(Default)]
pub(crate) struct Offered(Mutex<Option<Update>>);

/// Reads the feed now and every hour; once it offers a newer version, the application menu holds
/// "Update available". A failed read is logged and changes nothing.
pub(crate) fn watch<R: Runtime>(app: &AppHandle<R>) {
    app.manage(Offered::default());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut every = tokio::time::interval(EVERY);
        loop {
            every.tick().await;
            let checked = match app.updater() {
                Ok(updater) => updater.check().await,
                Err(error) => Err(error),
            };
            match checked {
                Ok(Some(update)) => offer(&app, update),
                Ok(None) => {}
                Err(error) => {
                    crate::diagnostics::report("read the update feed", cause(&error));
                }
            }
        }
    });
}

/// Keeps `update` and shows the item, once.
fn offer<R: Runtime>(app: &AppHandle<R>, update: Update) {
    *app.state::<Offered>().0.lock().unpoisoned() = Some(update);
    let shown = application(app).and_then(|application| {
        if application.get(ITEM).is_some() {
            return Ok(());
        }
        let item = MenuItem::with_id(app, ITEM, "Update available", true, None::<&str>)?;
        application.insert(&item, 3)
    });
    if let Err(error) = shown {
        crate::diagnostics::failure("show Update available", &error);
    }
}

/// The application submenu: the first of the App's menu.
fn application<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    match app
        .menu()
        .map(|menu| menu.items())
        .transpose()?
        .and_then(|items| items.into_iter().next())
    {
        Some(MenuItemKind::Submenu(application)) => Ok(application),
        _ => Err(tauri::Error::Io(std::io::Error::other(
            "the App's menu starts with no application submenu",
        ))),
    }
}

/// Choosing the item: install the offered update, leave every Daemon so Agents keep running
/// (S5981a), then relaunch on the new bundle. A failure says why and keeps the App open.
pub(crate) fn choose<R: Runtime>(app: &AppHandle<R>) {
    let Some(update) = app
        .try_state::<Offered>()
        .and_then(|offered| offered.0.lock().unpoisoned().take())
    else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let install = async {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|error| cause(&error).to_owned())
        };
        let leave = async {
            app.state::<AppState>()
                .exit_for_update()
                .await
                .map_err(|error| error.message)
        };
        match install_then_leave(install, leave).await {
            Ok(()) => app.restart(),
            Err(why) => {
                *app.state::<Offered>().0.lock().unpoisoned() = Some(update);
                tell(&app, why);
            }
        }
    });
}

/// Runs `leave` only once `install` has succeeded.
async fn install_then_leave(
    install: impl Future<Output = Result<(), String>>,
    leave: impl Future<Output = Result<(), String>>,
) -> Result<(), String> {
    install.await?;
    leave.await
}

fn tell<R: Runtime>(app: &AppHandle<R>, why: String) {
    use tauri_plugin_dialog::DialogExt;
    crate::diagnostics::report("install the update", &why);
    app.dialog()
        .message(why)
        .title("Update failed")
        .show(|_| {});
}

/// The updater's failure in the App's own words; the feed's text stays out of the log.
fn cause(error: &Error) -> &'static str {
    match error {
        Error::Reqwest(_) | Error::Network(_) | Error::Http(_) => "the update feed did not answer",
        Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "the update feed offers no build for this Mac"
        }
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => "the update's signature was refused",
        Error::Io(_)
        | Error::TempDirNotOnSameMountPoint
        | Error::TempDirNotFound
        | Error::PreviousAppNotRestored(_)
        | Error::BinaryNotFoundInArchive => "the update could not be installed",
        _ => "the updater failed",
    }
}

#[cfg(test)]
mod tests {
    use super::install_then_leave;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn ch7077e_the_update_leaves_the_daemons_only_once_it_is_installed() {
        tauri::async_runtime::block_on(async {
            let left = AtomicBool::new(false);
            let leave = || async {
                left.store(true, Ordering::SeqCst);
                Ok(())
            };
            let failed = install_then_leave(async { Err("no feed".to_owned()) }, leave()).await;
            assert_eq!(failed, Err("no feed".to_owned()));
            assert!(
                !left.load(Ordering::SeqCst),
                "a failed install left the Daemons"
            );

            let stuck = install_then_leave(async { Ok(()) }, async {
                Err("the Daemon of /p did not answer".to_owned())
            })
            .await;
            assert_eq!(stuck, Err("the Daemon of /p did not answer".to_owned()));

            assert_eq!(install_then_leave(async { Ok(()) }, leave()).await, Ok(()));
            assert!(left.load(Ordering::SeqCst));
        });
    }
}
