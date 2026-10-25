//! R24 measurement-only, run-owned evidence. No RPC accepts code or a destination path.
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use tauri::{Manager, Runtime, WebviewWindow, plugin::TauriPlugin};

const LIMIT: usize = 8 * 1024 * 1024;

struct Journal<W> {
    output: W,
    seq: u64,
    bytes: usize,
    stopped: bool,
}

impl<W: Write> Journal<W> {
    fn append(&mut self, at_us: u64, source: &str, body: Value) -> Result<(), String> {
        if self.stopped {
            return Err("R24 collection stopped".into());
        }
        self.seq += 1;
        let mut line = serde_json::to_vec(
            &json!({"v":1,"seq":self.seq,"at_us":at_us,"source":source,"body":body}),
        )
        .map_err(|e| e.to_string())?;
        let full = self.bytes + line.len() + 1 > LIMIT - 1024;
        if full {
            self.stopped = true;
            line = serde_json::to_vec(&json!({"v":1,"seq":self.seq,"at_us":at_us,"source":"error","body":"evidence byte limit"})).map_err(|e| e.to_string())?;
        }
        line.push(b'\n');
        if let Err(error) = self
            .output
            .write_all(&line)
            .and_then(|()| self.output.flush())
        {
            self.stopped = true;
            return Err(format!("R24 evidence write failed: {error}"));
        }
        self.bytes += line.len();
        if full {
            Err("R24 evidence byte limit".into())
        } else {
            Ok(())
        }
    }
}

struct Collector {
    journal: Mutex<Journal<File>>,
    started: Instant,
    web_seq: Mutex<u64>,
    finishing: AtomicBool,
    finished: AtomicBool,
}

impl Collector {
    fn checkpoint(&self, raw: &str) -> Result<(), String> {
        let last = *self.web_seq.lock().map_err(|e| e.to_string())?;
        confirm_checkpoint(raw, last)?;
        self.append("checkpoint", json!({"web_seq":last}))
    }

    fn append(&self, source: &str, body: Value) -> Result<(), String> {
        let mut journal = self.journal.lock().map_err(|e| e.to_string())?;
        let at_us = u64::try_from(self.started.elapsed().as_micros()).map_err(|e| e.to_string())?;
        let result = journal.append(at_us, source, body);
        if let Err(error) = &result {
            eprintln!("{error}");
        }
        result
    }
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    seq: u64,
    at_ms: f64,
    cause: String,
    visibility: Visibility,
    focused: bool,
    project: Option<String>,
    terminal: Option<String>,
    renderer: Option<Renderer>,
    width: u32,
    height: u32,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Visibility {
    Hidden,
    Visible,
}
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum Renderer {
    Webgl,
    Dom,
}

fn confirm_checkpoint(raw: &str, last: u64) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Checkpoint {
        seq: u64,
        pending: u64,
        error: Option<String>,
    }
    let checkpoint: Checkpoint = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if checkpoint.seq == 0
        || checkpoint.seq != last
        || checkpoint.pending != 0
        || checkpoint.error.is_some()
    {
        return Err("R24 incomplete renderer evidence at shutdown".into());
    }
    Ok(())
}

pub(crate) fn with_handler<R: Runtime>(
    ordinary: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    let measurement: fn(tauri::ipc::Invoke<R>) -> bool =
        tauri::generate_handler![record_idle_evidence];
    move |invoke| {
        if invoke.message.command() == "record_idle_evidence" {
            measurement(invoke)
        } else {
            ordinary(invoke)
        }
    }
}

#[tauri::command]
fn record_idle_evidence<R: Runtime>(
    window: WebviewWindow<R>,
    record: Record,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("R24 only the main webview supplies evidence".into());
    }
    let collector = window
        .try_state::<Collector>()
        .ok_or("R24 native producer unavailable")?;
    let mut last = collector.web_seq.lock().map_err(|e| e.to_string())?;
    if record.seq != *last + 1 || !record.at_ms.is_finite() || record.at_ms < 0.0 {
        collector.append("error", json!("missing or invalid renderer sequence/time"))?;
        return Err("R24 missing or invalid renderer evidence".into());
    }
    *last = record.seq;
    collector.append(
        "webview",
        serde_json::to_value(record).map_err(|e| e.to_string())?,
    )?;
    native(&window, "webview-received")
}

fn native<R: Runtime>(window: &WebviewWindow<R>, cause: &str) -> Result<(), String> {
    let state = window.state::<Collector>();
    let snapshot = (|| -> tauri::Result<Value> {
        let size = window.inner_size()?;
        Ok(
            json!({"cause":cause,"focused":window.is_focused()?,"visible":window.is_visible()?,"minimized":window.is_minimized()?,"width":size.width,"height":size.height,"scale":window.scale_factor()?}),
        )
    })();
    match snapshot {
        Ok(body) => state.append("native", body),
        Err(error) => {
            state.append("error", json!(error.to_string()))?;
            Err(error.to_string())
        }
    }
}

fn open(path: &Path) -> Result<File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("R24 evidence {}: {e}", path.display()))
}

pub(crate) fn guard(
    allow: Option<&str>,
    data: Option<&std::ffi::OsStr>,
    dir: Option<&std::ffi::OsStr>,
) -> Result<(), String> {
    if allow != Some("1") || data.is_none() || dir.is_none() {
        return Err("R24 requires ROUNDUP_ALLOW_WINDOW=1, fresh ROUNDUP_DATA_DIR and ROUNDUP_IDLE_EVIDENCE_DIR".into());
    }
    if std::env::consts::OS != "macos" {
        return Err("R24 native producer requires macOS".into());
    }
    Ok(())
}

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("idle-evidence")
        .setup(|app, _| {
            let Some(dir) = std::env::var_os("ROUNDUP_IDLE_EVIDENCE_DIR") else {
                return Ok(());
            };
            let path = Path::new(&dir).join("app-idle.jsonl");
            let output = open(&path)?;
            app.manage(Collector {
                journal: Mutex::new(Journal {
                    output,
                    seq: 0,
                    bytes: 0,
                    stopped: false,
                }),
                started: Instant::now(),
                web_seq: Mutex::new(0),
                finishing: AtomicBool::new(false),
                finished: AtomicBool::new(false),
            });
            app.state::<Collector>()
                .append("start", json!({"pid":std::process::id()}))?;
            Ok(())
        })
        .on_webview_ready(|view| {
            if view.label() != "main" || view.app_handle().try_state::<Collector>().is_none() {
                return;
            }
            if let Some(window) = view.app_handle().get_webview_window(view.label()) {
                if let Err(error) = native(&window, "initial") {
                    eprintln!("{error}");
                }
                #[cfg(target_vendor = "apple")]
                super::idle_macos::watch(window);
            }
        })
        .on_event(|app, event| {
            if app.try_state::<Collector>().is_none() {
                return;
            }
            match event {
                tauri::RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                    let observed = match event {
                        tauri::WindowEvent::Focused(focused) => Some(json!({"focused":focused})),
                        tauri::WindowEvent::Resized(size) => Some(json!({"width":size.width,"height":size.height})),
                        tauri::WindowEvent::ScaleFactorChanged { scale_factor, new_inner_size, .. } => Some(json!({"scale":scale_factor,"width":new_inner_size.width,"height":new_inner_size.height})),
                        _ => None,
                    };
                    if let Some(observed) = observed {
                        let result = app.state::<Collector>().append("window-event", observed).and_then(|()| {
                            app.get_webview_window(label).ok_or("R24 native window missing".into()).and_then(|window| native(&window, "window-event"))
                        });
                        if let Err(error) = result { eprintln!("{error}"); }
                    }
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if !app
                        .state::<Collector>()
                        .finishing
                        .swap(true, Ordering::SeqCst)
                    {
                        api.prevent_exit();
                        finish(app);
                    }
                }
                tauri::RunEvent::Exit => {
                    if let Err(error) = app.state::<Collector>().append("end", json!("App exited"))
                    {
                        eprintln!("{error}");
                    }
                }
                _ => {}
            }
        })
        .build()
}

fn finish<R: Runtime>(app: &tauri::AppHandle<R>) {
    let handle = app.clone();
    let result = app
        .get_webview_window("main")
        .ok_or("R24 main webview missing".to_string())
        .and_then(|window| {
            window
                .eval_with_callback("globalThis.__roundupIdleEvidence?.()", move |raw| {
                    let state = handle.state::<Collector>();
                    let result = state.checkpoint(&raw);
                    if let Err(error) = &result {
                        let _ = state.append("error", json!(error));
                    }
                    state.finished.store(true, Ordering::SeqCst);
                    handle.exit(if result.is_ok() { 0 } else { 2 });
                })
                .map_err(|error| error.to_string())
        });
    if let Err(error) = result {
        let _ = app.state::<Collector>().append("error", json!(error));
        app.exit(2);
        return;
    }
    let handle = app.clone();
    // Only shutdown has a deadline; no timer wakes the measured idle workload.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let state = handle.state::<Collector>();
        if !state.finished.swap(true, Ordering::SeqCst) {
            let _ = state.append("error", json!("R24 renderer shutdown checkpoint missing"));
            handle.exit(2);
        }
    });
}

#[cfg(target_vendor = "apple")]
pub(super) fn application<R: Runtime>(window: &WebviewWindow<R>, cause: &str, hidden: bool) {
    let state = window.state::<Collector>();
    if let Err(error) = state
        .append("application", json!({"cause":cause,"hidden":hidden}))
        .and_then(|()| native(window, cause))
    {
        eprintln!("{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoke(
        builder: tauri::Builder<tauri::test::MockRuntime>,
    ) -> Result<tauri::ipc::InvokeResponseBody, Value> {
        let app = builder
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "record_idle_evidence".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(
                    json!({"record":{"seq":1,"at_ms":0,"cause":"initial","visibility":"visible","focused":true,"project":null,"terminal":null,"renderer":null,"width":1280,"height":800}}),
                ),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    }

    #[test]
    fn r24_missing_native_collector_is_an_explicit_command_refusal() {
        let builder = tauri::test::mock_builder()
            .plugin(plugin())
            .invoke_handler(with_handler(|_| false));
        assert_eq!(
            invoke(builder).unwrap_err(),
            json!("R24 native producer unavailable")
        );
    }

    #[cfg(not(feature = "idle-perf"))]
    #[test]
    fn r24_normal_build_does_not_register_the_measurement_command() {
        let builder = tauri::test::mock_builder().invoke_handler(crate::commands());
        assert!(
            invoke(builder)
                .unwrap_err()
                .as_str()
                .unwrap()
                .contains("not found")
        );
    }

    #[test]
    fn r24_records_initial_and_transient_changes_with_ordered_times() {
        let mut journal = Journal {
            output: Vec::new(),
            seq: 0,
            bytes: 0,
            stopped: false,
        };
        journal
            .append(0, "native", json!({"focused":true}))
            .unwrap();
        journal
            .append(8, "application", json!({"hidden":true}))
            .unwrap();
        journal
            .append(9, "application", json!({"hidden":false}))
            .unwrap();
        let rows: Vec<Value> = String::from_utf8(journal.output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(rows[0]["seq"], 1);
        assert_eq!(rows[1]["body"]["hidden"], true);
        assert_eq!(rows[2]["body"]["hidden"], false);
        assert_eq!(rows[2]["at_us"], 9);
    }

    #[test]
    fn r24_limit_retains_explicit_loss_and_refuses_later_evidence() {
        let mut journal = Journal {
            output: Vec::new(),
            seq: 0,
            bytes: LIMIT - 1024,
            stopped: false,
        };
        assert!(journal.append(1, "native", json!({})).is_err());
        assert!(journal.append(2, "native", json!({})).is_err());
        let row: Value = serde_json::from_slice(&journal.output).unwrap();
        assert_eq!(row["source"], "error");
        assert_eq!(row["body"], "evidence byte limit");
    }

    #[test]
    fn r24_write_loss_refuses_all_later_records() {
        let mut buffer = [];
        let mut journal = Journal {
            output: std::io::Cursor::new(&mut buffer[..]),
            seq: 0,
            bytes: 0,
            stopped: false,
        };
        assert!(
            journal
                .append(0, "start", json!({}))
                .unwrap_err()
                .contains("write failed")
        );
        assert_eq!(
            journal.append(1, "native", json!({})).unwrap_err(),
            "R24 collection stopped"
        );
    }

    #[test]
    fn r24_shutdown_requires_a_complete_acknowledged_renderer_stream() {
        assert!(confirm_checkpoint(r#"{"seq":7,"pending":0,"error":null}"#, 7).is_ok());
        for raw in [
            "null",
            r#"{"seq":0,"pending":0,"error":null}"#,
            r#"{"seq":8,"pending":0,"error":null}"#,
            r#"{"seq":7,"pending":1,"error":null}"#,
            r#"{"seq":7,"pending":0,"error":"lost"}"#,
        ] {
            assert!(confirm_checkpoint(raw, 7).is_err(), "{raw}");
        }
    }

    #[test]
    fn r24_missing_authorization_or_destination_is_refused() {
        assert!(guard(None, None, None).is_err());
        assert!(guard(Some("1"), Some("isolated".as_ref()), None).is_err());
    }
}
