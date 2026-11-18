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
    app.manage(Feeds {
        feed,
        core: core_feed,
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut every = tokio::time::interval(EVERY);
        loop {
            every.tick().await;
            if let Err(why) = look(&app).await {
                crate::diagnostics::report("read the update feeds", &why);
            }
        }
    });
}

/// What `watch` reads, kept so a request to look now reads the same.
struct Feeds {
    feed: bool,
    core: Option<String>,
}

/// U7208g: reads both feeds at once, as the hourly look does, then sends the facts. Fails naming
/// each feed that could not be read; the facts stay as they were.
pub(crate) async fn look<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(feeds) = app.try_state::<Feeds>() else {
        return Ok(());
    };
    let (own, core) = tokio::join!(
        async {
            if feeds.feed {
                updater::look(app)
                    .await
                    .map(drop)
                    .map_err(|why| why.to_string())
            } else {
                Ok(())
            }
        },
        async {
            match &feeds.core {
                Some(url) => look_core(app, url).await,
                None => Ok(()),
            }
        },
    );
    tell(app).await;
    let failed: Vec<String> = [own, core].into_iter().filter_map(Result::err).collect();
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed.join("; "))
    }
}

/// Sends `updates-changed` with the facts as they stand.
pub(crate) async fn tell<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = app.emit(EVENT, read(app).await) {
        crate::diagnostics::failure("send the update facts", &error);
    }
}

async fn look_core<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    let version = core_update::newest(url).await?;
    *app.state::<CoreNewest>().0.lock().unpoisoned() = Some(version);
    Ok(())
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
