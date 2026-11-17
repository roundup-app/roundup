//! CH7077e: an installed build's "Update available" item, offered from its channel's signed feed
//! (`plugins.updater` of its config overlay). Nothing here installs or relaunches until the user
//! presses `Update roundup` (U7208b), and that press installs what the feed offers then.

use crate::Unpoisoned;
use std::fmt;
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

/// The newer version the feed offered at the last look; `None` when it offered none. Managed only
/// on an installed build: a Source build has no feed (U7208a).
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

/// Reads the feed and keeps what it offers now, a newer version or none: the application menu holds
/// "Update available" only while one is offered. A failed read changes nothing.
pub(crate) async fn look<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Update>, Failure> {
    let offer = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    }
    .map_err(|error| Failure::of_look(&error))?;
    *app.state::<Offered>().0.lock().unpoisoned() = offer.clone();
    show(app, offer.is_some());
    Ok(offer)
}

/// Adds "Update available" once while a version is offered, and takes it away once none is.
fn show<R: Runtime>(app: &AppHandle<R>, offered: bool) {
    let shown = application(app).and_then(|application| match application.get(ITEM) {
        Some(item) if !offered => application.remove(&item),
        None if offered => {
            let item = MenuItem::with_id(app, ITEM, "Update available", true, None::<&str>)?;
            application.insert(&item, 3)
        }
        _ => Ok(()),
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

/// `Update roundup`: read the feed again and install what it offers now, never a version an
/// earlier look offered, leave every Daemon so Agents keep running (S5981a), then relaunch on the
/// new bundle. With nothing newer offered now it installs nothing. A failure says why and leaves
/// the Daemons running. Unless it relaunches, the webview hears the facts the click's looks left
/// (U7208b).
pub(crate) async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let ready = app
        .try_state::<Offered>()
        .is_some_and(|offered| offered.0.lock().unpoisoned().is_some());
    if !ready {
        return Err("no update is ready".to_owned());
    }
    let update = match look(app).await {
        Ok(Some(update)) => update,
        Ok(None) => {
            crate::updates::tell(app).await;
            return Ok(());
        }
        Err(why) => return Err(fail(app, why.to_string()).await),
    };
    let report = Report::new(app);
    let install = async {
        put(app, update, &report)
            .await
            .map_err(|why| why.to_string())
    };
    let leave = async {
        app.state::<AppState>()
            .exit_for_update()
            .await
            .map_err(|error| error.message)
    };
    match install_then_leave(install, leave).await {
        Ok(()) => app.restart(),
        Err(why) => Err(fail(app, why).await),
    }
}

/// Downloads and installs `update`. When the server no longer holds its build, reads the feed once
/// more and installs the newer version it offers then.
async fn put<R: Runtime>(
    app: &AppHandle<R>,
    update: Update,
    report: &Report<'_, R>,
) -> Result<(), Failure> {
    let Err(error) = download(&update, report).await else {
        return Ok(());
    };
    if !gone(&error) {
        return Err(Failure::of_install(&error));
    }
    let newer = look(app)
        .await?
        .filter(|newer| newer.version != update.version)
        .ok_or(Failure::Replaced)?;
    download(&newer, report)
        .await
        .map_err(|error| Failure::of_install(&error))
}

async fn download<R: Runtime>(update: &Update, report: &Report<'_, R>) -> Result<(), Error> {
    update
        .download_and_install(|len, total| report.chunk(len, total), || report.finished())
        .await
}

/// Logs why the install failed and tells the webview the facts the click's looks left; answers `why`.
async fn fail<R: Runtime>(app: &AppHandle<R>, why: String) -> String {
    crate::diagnostics::report("install the update", &why);
    crate::updates::tell(app).await;
    why
}

/// Runs `leave` only once `install` has succeeded.
async fn install_then_leave(
    install: impl Future<Output = Result<(), String>>,
    leave: impl Future<Output = Result<(), String>>,
) -> Result<(), String> {
    install.await?;
    leave.await
}

/// The download answered 404 or 410: the release no longer holds the build the feed offered, as the
/// `dev` release keeps only its newest build. The updater names the status only in its text.
fn gone(error: &Error) -> bool {
    matches!(error, Error::Network(status)
        if status.ends_with("404 Not Found") || status.ends_with("410 Gone"))
}

/// Why a look or an install failed. Its text leads with the kind word the webview reads to pick its
/// sentence from the copy catalogue (U7208b), then says the cause in the App's own words for the
/// log; the feed's text stays out of both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Failure {
    /// Neither the feed nor the download could be reached.
    Unreachable,
    /// The feed offers no build for this Mac.
    NoBuild,
    /// The offered build is gone and the feed offers no newer one.
    Replaced,
    /// The download started and broke off.
    BrokeOff,
    /// The server answered the download with an error other than gone.
    Refused,
    /// The download does not match the update's signature.
    Signature,
    /// The download could not be put in place.
    NotInstalled,
    /// Anything else the updater reports.
    Failed,
}

impl Failure {
    /// A failed feed read. The updater reads a feed's error answer as no release.
    fn of_look(error: &Error) -> Self {
        match error {
            Error::Reqwest(_) | Error::Network(_) => Self::Unreachable,
            Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
                Self::NoBuild
            }
            _ => Self::Failed,
        }
    }

    /// A failed download or install.
    fn of_install(error: &Error) -> Self {
        match error {
            Error::Network(_) if gone(error) => Self::Replaced,
            Error::Network(_) => Self::Refused,
            Error::Reqwest(error) if error.is_connect() => Self::Unreachable,
            Error::Reqwest(_) => Self::BrokeOff,
            Error::Minisign(_)
            | Error::Base64(_)
            | Error::SignatureUtf8(_)
            | Error::SignedVersionMismatch { .. }
            | Error::MissingSignedVersion => Self::Signature,
            Error::Io(_)
            | Error::TempDirNotOnSameMountPoint
            | Error::TempDirNotFound
            | Error::PreviousAppNotRestored(_)
            | Error::BinaryNotFoundInArchive => Self::NotInstalled,
            _ => Self::Failed,
        }
    }

    fn kind(self) -> &'static str {
        match self {
            Self::Unreachable => "unreachable",
            Self::NoBuild => "no_build",
            Self::Replaced => "replaced",
            Self::BrokeOff => "broke_off",
            Self::Refused => "refused",
            Self::Signature => "signature",
            Self::NotInstalled => "not_installed",
            Self::Failed => "failed",
        }
    }

    fn cause(self) -> &'static str {
        match self {
            Self::Unreachable => "the update feed or its download could not be reached",
            Self::NoBuild => "the update feed offers no build for this Mac",
            Self::Replaced => "the offered build was replaced and the feed offers no newer one",
            Self::BrokeOff => "the download broke off",
            Self::Refused => "the server refused the download",
            Self::Signature => "the update's signature did not match",
            Self::NotInstalled => "the update could not be installed",
            Self::Failed => "the updater failed",
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind(), self.cause())
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
