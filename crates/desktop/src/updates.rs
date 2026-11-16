//! U7208: the facts Settings › Updates shows, and the hourly look for both newer versions.

use std::sync::Mutex;
use std::time::Duration;

use semver::Version;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{AppState, Unpoisoned, core_update, updater};

/// Sent after each look, with the facts it left.
const EVENT: &str = "updates-changed";

/// How often both feeds are read after the first read at launch.
const EVERY: Duration = Duration::from_secs(60 * 60);

/// One program's version and the newer one ready, if any.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Row {
    pub version: String,
    pub ready: Option<String>,
}

/// What the Updates page shows. `roundup` is `None` on a build with no update feed;
/// `core` is `None` when no herdr-core runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Updates {
    pub roundup: Option<Row>,
    pub core: Option<Row>,
}

/// The newest herdr-core version the release feed named at the last look.
#[derive(Default)]
struct CoreNewest(Mutex<Option<Version>>);

/// Reads the feeds now and every hour, and sends `updates-changed` after each look. A build with no
/// roundup feed (`feed` false) reads herdr-core's alone; with no `core_feed` too, nothing is read.
pub(crate) fn watch<R: Runtime>(app: &AppHandle<R>, feed: bool, core_feed: Option<String>) {
    app.manage(CoreNewest::default());
    if feed {
        app.manage(updater::Offered::default());
    }
    if !feed && core_feed.is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut every = tokio::time::interval(EVERY);
        loop {
            every.tick().await;
            tokio::join!(
                async {
                    if feed {
                        updater::look(&app).await;
                    }
                },
                async {
                    if let Some(url) = &core_feed {
                        look_core(&app, url).await;
                    }
                },
            );
            if let Err(error) = app.emit(EVENT, read(&app).await) {
                crate::diagnostics::failure("send the update facts", &error);
            }
        }
    });
}

async fn look_core<R: Runtime>(app: &AppHandle<R>, url: &str) {
    match core_update::newest(url).await {
        Ok(version) => *app.state::<CoreNewest>().0.lock().unpoisoned() = Some(version),
        Err(why) => {
            crate::diagnostics::report("read the herdr-core release feed", &why);
        }
    }
}

/// What the last look found. herdr-core's own version is read again each time, so one just
/// installed shows.
pub(crate) async fn read<R: Runtime>(app: &AppHandle<R>) -> Updates {
    let state = app.state::<AppState>();
    let core = core_update::installed(state.config()).await.map(|version| {
        let newest = app
            .try_state::<CoreNewest>()
            .and_then(|newest| newest.0.lock().unpoisoned().clone());
        Row {
            ready: core_update::ready(&version, newest.as_ref()).map(|ready| ready.to_string()),
            version: version.to_string(),
        }
    });
    Updates {
        roundup: updater::row(app),
        core,
    }
}
