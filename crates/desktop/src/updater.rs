//! CH7077e: an installed build's "Update available" item, offered from its channel's signed feed
//! (`plugins.updater` of its config overlay). Nothing here installs or relaunches until the user
//! presses `Update roundup` (U7208b).

use crate::Unpoisoned;
use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{MenuItem, MenuItemKind, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

use crate::AppState;
use crate::updates::Row;

pub(crate) const ITEM: &str = "install-update";

/// Sent while `install` runs, as the updater reports the download and when it starts to install.
const PROGRESS: &str = "update-progress";

/// The least time between two `downloading` events; a download's first chunk always sends one.
const EVERY: Duration = Duration::from_millis(250);

/// The newer version the feed offered last; `None` until it offers one. Managed only on an
/// installed build: a Source build has no feed (U7208a).
#[derive(Default)]
pub(crate) struct Offered(Mutex<Option<Update>>);

/// The roundup row of the Updates facts; `None` on a build with no feed.
pub(crate) fn row<R: Runtime>(app: &AppHandle<R>) -> Option<Row> {
    let offered = app.try_state::<Offered>()?;
    let ready = offered
        .0
        .lock()
        .unpoisoned()
        .as_ref()
        .map(|update| update.version.clone());
    Some(Row {
        version: app.package_info().version.to_string(),
        ready,
    })
}

/// Reads the feed once; when it offers a newer version, the application menu holds "Update
/// available". A failed read is logged and changes nothing.
pub(crate) async fn look<R: Runtime>(app: &AppHandle<R>) {
    let checked = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    match checked {
        Ok(Some(update)) => offer(app, update),
        Ok(None) => {}
        Err(error) => {
            crate::diagnostics::report("read the update feed", cause(&error));
        }
    }
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

/// What `update-progress` carries: the bytes so far, the total when the feed said it, and the stage.
#[derive(Clone, Copy, Default, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
    stage: Stage,
}

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "lowercase")]
enum Stage {
    #[default]
    Downloading,
    Installing,
}

/// What a download has reported so far, and when its last `downloading` event went out.
#[derive(Default)]
struct Seen {
    progress: Progress,
    sent: Option<Instant>,
}

/// Sends `update-progress` for one install (U7208b): the download's bytes at most once per `EVERY`,
/// then once when it is whole.
struct Report<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    seen: Mutex<Seen>,
}

impl<'a, R: Runtime> Report<'a, R> {
    fn new(app: &'a AppHandle<R>) -> Self {
        Self {
            app,
            seen: Mutex::default(),
        }
    }

    fn chunk(&self, len: usize, total: Option<u64>) {
        let mut seen = self.seen.lock().unpoisoned();
        seen.progress.downloaded += len as u64;
        seen.progress.total = total;
        if seen.sent.is_none_or(|at| at.elapsed() >= EVERY) {
            seen.sent = Some(Instant::now());
            self.send(seen.progress);
        }
    }

    fn finished(&self) {
        let mut seen = self.seen.lock().unpoisoned();
        seen.progress.stage = Stage::Installing;
        self.send(seen.progress);
    }

    fn send(&self, progress: Progress) {
        if let Err(error) = self.app.emit(PROGRESS, progress) {
            crate::diagnostics::failure("send the update progress", &error);
        }
    }
}

/// `Update roundup`: install the offered update, leave every Daemon so Agents keep running
/// (S5981a), then relaunch on the new bundle. A failure says why, leaves the Daemons running and
/// keeps the update offered (U7208b).
pub(crate) async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let update = app
        .try_state::<Offered>()
        .and_then(|offered| offered.0.lock().unpoisoned().take())
        .ok_or_else(|| "no update is ready".to_owned())?;
    let report = Report::new(app);
    let install = async {
        update
            .download_and_install(|len, total| report.chunk(len, total), || report.finished())
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
            crate::diagnostics::report("install the update", &why);
            Err(why)
        }
    }
}

/// Runs `leave` only once `install` has succeeded.
async fn install_then_leave(
    install: impl Future<Output = Result<(), String>>,
    leave: impl Future<Output = Result<(), String>>,
) -> Result<(), String> {
    install.await?;
    leave.await
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
