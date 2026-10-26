//! U3787f: native delivery waits for the main webview; URLs stay opaque until link.read.
use std::collections::VecDeque;
#[cfg(any(target_os = "macos", test))]
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::Listener;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum NativeOpen {
    Project {
        path: String,
    },
    #[cfg(any(target_os = "macos", test))]
    Link {
        url: String,
    },
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
#[cfg(any(target_os = "macos", test))]
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
    if let Some(window) = app.get_webview_window("main")
        && let Err(error) = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus())
    {
        crate::diagnostics::failure("show existing App", &error);
    }
}

/// Subscribe before deep-link initializes: its cold CLI delivery and later OS delivery
/// then share the event route, with no get_current snapshot that can replay an invocation.
#[cfg(target_os = "macos")]
pub(crate) fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("native-open")
        .setup(|app, _| {
            let handle = app.clone();
            app.listen(
                "deep-link://new-url",
                move |event| match serde_json::from_str::<Vec<String>>(event.payload()) {
                    Ok(urls) => {
                        for url in urls {
                            deliver(&handle, NativeOpen::Link { url });
                        }
                    }
                    Err(error) => log::warn!(target: "roundup::shell", "receive native link: JSON {:?} at {}:{}", error.classify(), error.line(), error.column()),
                },
            );
            Ok(())
        })
        .build()
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
    #[test]
    fn u3787f_logs_report_causes_without_private_content() {
        crate::diagnostics::tests::u3787f_logs_report_causes_without_private_content();
    }

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
