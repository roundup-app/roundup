//! U3787f: native delivery waits for the main webview; URLs stay opaque until link.read.
use std::collections::VecDeque;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum NativeOpen {
    Project { path: String },
    Link { url: String },
}

#[derive(Default)]
pub(crate) struct Delivery {
    pending: VecDeque<NativeOpen>,
    consumer: Option<Channel<NativeOpen>>,
}

impl Delivery {
    fn push(&mut self, request: NativeOpen) {
        self.pending.push_back(request);
        self.flush();
    }

    fn flush(&mut self) {
        while let (Some(consumer), Some(request)) = (&self.consumer, self.pending.front()) {
            if consumer.send(request.clone()).is_err() {
                self.consumer = None;
                return;
            }
            self.pending.pop_front();
        }
    }
}

pub(crate) fn deliver<R: Runtime>(app: &AppHandle<R>, request: NativeOpen) {
    app.state::<Mutex<Delivery>>()
        .lock()
        .expect("native delivery lock")
        .push(request);
}

/// The single-instance plugin already forwards links on Linux/Windows. macOS delivers
/// URLs through RunEvent::Opened, which the deep-link plugin alone consumes.
pub(crate) fn second_launch<R: Runtime>(app: &AppHandle<R>, args: Vec<String>, cwd: String) {
    if let Some(path) = args.get(1).filter(|arg| !arg.contains("://")) {
        deliver(
            app,
            NativeOpen::Project {
                path: {
                    let path = Path::new(&cwd).join(path);
                    path.canonicalize()
                        .unwrap_or(path)
                        .to_string_lossy()
                        .into_owned()
                },
            },
        );
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus())
        {
            eprintln!("desktop: cannot show existing App: {error}");
        }
    }
}

pub(crate) fn listen<R: Runtime>(app: &AppHandle<R>) -> tauri_plugin_deep_link::Result<()> {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            deliver(
                &handle,
                NativeOpen::Link {
                    url: url.to_string(),
                },
            );
        }
    });
    // During setup no lifecycle event can run on this thread. Subsequent Opened events
    // arrive only at the listener above, never through a second lifecycle dispatcher.
    if let Some(urls) = app.deep_link().get_current()? {
        for url in urls {
            deliver(
                app,
                NativeOpen::Link {
                    url: url.to_string(),
                },
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn native_open<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, Mutex<Delivery>>,
    channel: Channel<NativeOpen>,
) -> Result<(), rpc::RpcError> {
    if window.label() != "main" {
        return Err(rpc::RpcError::new(
            rpc::code::FORBIDDEN,
            "native opens belong to the main window",
        ));
    }
    let mut delivery = state.lock().expect("native delivery lock");
    delivery.consumer = Some(channel);
    delivery.flush();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn u3787f_second_launch_reuses_the_app_pending_delivery_is_consumed_once() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let copy = received.clone();
        let app = tauri::test::mock_builder()
            .manage(Mutex::new(Delivery::default()))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        second_launch(
            app.handle(),
            vec!["roundup".into(), "project".into()],
            "/work".into(),
        );
        second_launch(
            app.handle(),
            vec!["roundup".into(), "roundup://pad/notes?project=other".into()],
            "/work".into(),
        );
        deliver(
            app.handle(),
            NativeOpen::Link {
                url: "roundup://pad/notes?project=other".into(),
            },
        );
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        native_open(
            window,
            app.state(),
            Channel::new(move |body| {
                let InvokeResponseBody::Json(body) = body else {
                    panic!("expected JSON")
                };
                copy.lock().unwrap().push(body);
                Ok(())
            }),
        )
        .unwrap();
        app.state::<Mutex<Delivery>>().lock().unwrap().flush();
        let received = received.lock().unwrap();
        assert_eq!(received.len(), 2);
        assert!(received[0].contains("/work/project"));
        assert!(received[1].contains("roundup://pad/notes?project=other"));
    }
}
