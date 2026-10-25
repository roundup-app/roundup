//! The panel's Objective-C class, handles and thread obligations never leave this module.
use std::sync::mpsc;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use tauri_nspanel::{ManagerExt, WebviewWindowExt};
use tauri_plugin_positioner::{Position, WindowExt};

// Expansion audit: define_class! generates the private RawCapturePanel NSObject subclass,
// NSObjectProtocol and Send/Sync implementations. Only on_main's closure touches those objects;
// the public owner contains a Tauri AppHandle, never an upstream PanelHandle or native pointer.
tauri_nspanel::tauri_panel! {
    panel!(NativeCapturePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false
        }
    })
}

const LABEL: &str = "todo-capture";

/// Native facts sampled on the main thread after the requested operation.
#[derive(Debug)]
pub struct CapturePanelState {
    pub visible: bool,
    pub can_become_main: bool,
}

/// One App's reusable Capture panel. Cloning a safe Tauri handle creates no native object.
/// Methods dispatch to AppKit's main thread and wait for acknowledgment. Call from an async
/// command's blocking task when the caller is not already on the event-loop thread.
pub struct CapturePanel<R: Runtime> {
    app: AppHandle<R>,
    url: WebviewUrl,
}

impl<R: Runtime> CapturePanel<R> {
    pub fn new(app: AppHandle<R>, url: WebviewUrl) -> Result<Self, String> {
        if app
            .try_state::<tauri_nspanel::WebviewPanelManager<R>>()
            .is_none()
        {
            return Err("Capture panel integration is not registered".into());
        }
        Ok(Self { app, url })
    }

    /// Replace the App's OS binding after acknowledgment; a refused registration keeps the old one.
    /// Call from a worker: the official plugin dispatches OS registration to the event loop.
    pub fn configure(&self, chord: Option<&str>) -> Result<(), String> {
        replace_binding(&self.app, chord)
    }

    /// Create once, place on the cursor's display, and order front without activating the App.
    /// A repeated show is inert: it never moves or focuses an already visible panel.
    pub fn show(&self) -> Result<CapturePanelState, String> {
        let url = self.url.clone();
        self.on_main(move |app| {
            let panel = match app.get_webview_panel(LABEL) {
                Ok(panel) => panel,
                Err(_) => {
                    let window = WebviewWindowBuilder::new(app, LABEL, url)
                        .title("Capture a Todo")
                        .inner_size(560.0, 240.0)
                        .visible(false)
                        .focused(false)
                        .decorations(false)
                        .resizable(false)
                        .skip_taskbar(true)
                        .build()
                        .map_err(|error| error.to_string())?;
                    let panel = match window.to_panel::<NativeCapturePanel>() {
                        Ok(panel) => panel,
                        Err(error) => {
                            window.destroy().map_err(|error| error.to_string())?;
                            return Err(error.to_string());
                        }
                    };
                    if let Err(error) = panel
                        .add_style_mask(tauri_nspanel::panel::NSWindowStyleMask::NonactivatingPanel)
                    {
                        if let Some(window) = panel.to_window() {
                            window.destroy().map_err(|error| error.to_string())?;
                        }
                        return Err(error.to_string());
                    }
                    panel.set_floating_panel(true);
                    panel.set_hides_on_deactivate(true);
                    panel
                }
            };
            if !panel.is_visible() {
                let window = app
                    .get_webview_window(LABEL)
                    .ok_or("Capture panel has no webview")?;
                let cursor = app.cursor_position().map_err(|error| error.to_string())?;
                let monitor = app
                    .monitor_from_point(cursor.x, cursor.y)
                    .map_err(|error| error.to_string())?
                    .ok_or("No display at the invoking pointer")?;
                // Positioner centers on the current display; select that display first.
                window
                    .set_position(*monitor.position())
                    .map_err(|error| error.to_string())?;
                window
                    .move_window(Position::Center)
                    .map_err(|error| error.to_string())?;
                // Positioner 2.4 centers in full screen bounds, not the usable work area.
                let area = monitor.work_area();
                let size = window.outer_size().map_err(|error| error.to_string())?;
                let position = window.outer_position().map_err(|error| error.to_string())?;
                let max_x = area.position.x + area.size.width.saturating_sub(size.width) as i32;
                let max_y = area.position.y + area.size.height.saturating_sub(size.height) as i32;
                window
                    .set_position(tauri::PhysicalPosition::new(
                        position.x.clamp(area.position.x, max_x),
                        position.y.clamp(area.position.y, max_y),
                    ))
                    .map_err(|error| error.to_string())?;
                panel.order_front_regardless();
            }
            Ok(CapturePanelState {
                visible: panel.is_visible(),
                can_become_main: panel.can_become_main_window(),
            })
        })
    }

    /// Dismiss without activating any other roundup window. AppKit retains the previous App.
    pub fn dismiss(&self) -> Result<CapturePanelState, String> {
        self.on_main(|app| {
            let panel = app
                .get_webview_panel(LABEL)
                .map_err(|error| format!("{error:?}"))?;
            panel.hide();
            Ok(CapturePanelState {
                visible: panel.is_visible(),
                can_become_main: panel.can_become_main_window(),
            })
        })
    }

    /// Remove the retained native object on the main thread before Tauri destroys its owner.
    pub fn release(&self) -> Result<(), String> {
        self.on_main(|app| {
            if let Ok(panel) = app.get_webview_panel(LABEL) {
                panel.hide();
                if let Some(window) = panel.to_window() {
                    window.destroy().map_err(|error| error.to_string())?;
                }
            }
            Ok(())
        })
    }

    fn on_main<T: Send + 'static>(
        &self,
        work: impl FnOnce(&AppHandle<R>) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        if MainThreadMarker::new().is_some() {
            return work(&self.app);
        }
        let app = self.app.clone();
        let (send, receive) = mpsc::sync_channel(1);
        self.app
            .run_on_main_thread(move || {
                let _main = MainThreadMarker::new().expect("Tauri main-thread dispatch");
                let result = work(&app);
                // A dropped caller cannot authorize a later operation; this only acknowledges it.
                let _ = send.send(result);
            })
            .map_err(|error| error.to_string())?;
        receive.recv().map_err(|error| error.to_string())?
    }
}

/// Register the selected native libraries without granting their JS command permissions.
pub fn register_capture<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let lifetime = tauri::plugin::Builder::new("capture-panel")
        .invoke_handler(tauri::generate_handler![control])
        .setup(|app, _| {
            app.manage(Binding::default());
            Ok(())
        })
        .on_event(|app, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Err(error) =
                    CapturePanel::new(app.clone(), WebviewUrl::App("index.html".into()))
                        .and_then(|panel| panel.release())
            {
                eprintln!("desktop: could not release Capture panel: {error}");
            }
        })
        .build();
    // Builder composition avoids taking AppHandle's plugin lock inside another plugin's setup.
    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(lifetime)
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum CaptureRequest {
    Configure { chord: Option<String> },
    Show,
    Dismiss,
    Publish { snapshot: serde_json::Value },
    Act { action: serde_json::Value },
}

#[derive(Default)]
struct Binding(std::sync::Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>);

#[tauri::command]
async fn control<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    request: CaptureRequest,
) -> Result<(), String> {
    use tauri::Emitter;
    // The panel is a presentation client; only the main window owns settings and drafts.
    let allowed = match &request {
        CaptureRequest::Act { .. } => window.label() == LABEL,
        _ => window.label() == "main",
    };
    if !allowed {
        return Err("This window does not own the Capture operation".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let panel =
            || CapturePanel::new(app.clone(), WebviewUrl::App("index.html?capture=1".into()));
        match request {
            CaptureRequest::Configure { chord } => panel()?.configure(chord.as_deref()),
            CaptureRequest::Show => panel()?.show().map(|_| ()),
            CaptureRequest::Dismiss => panel()?.dismiss().map(|_| ()),
            CaptureRequest::Publish { snapshot } => app
                .emit_to(LABEL, "capture-state", snapshot)
                .map_err(|e| e.to_string()),
            CaptureRequest::Act { action } => app
                .emit_to("main", "capture-action", action)
                .map_err(|e| e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn replace_binding<R: Runtime>(app: &AppHandle<R>, chord: Option<&str>) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
    let next = chord
        .map(str::parse::<Shortcut>)
        .transpose()
        .map_err(|e| e.to_string())?;
    let binding = app.state::<Binding>();
    let mut previous = binding.0.lock().map_err(|e| e.to_string())?;
    if *previous == next {
        return Ok(());
    }
    if let Some(next) = next {
        let down = std::sync::atomic::AtomicBool::new(false);
        app.global_shortcut()
            .on_shortcut(next, move |app, _, event| {
                use std::sync::atomic::Ordering;
                if event.state == ShortcutState::Released {
                    down.store(false, Ordering::Relaxed);
                } else if !down.swap(true, Ordering::Relaxed)
                    && !app
                        .get_webview_window("main")
                        .is_some_and(|main| main.is_focused().unwrap_or(false))
                    && let Err(error) = app.emit_to("main", "capture-requested", ())
                {
                    eprintln!("desktop: could not request Capture: {error}");
                }
            })
            .map_err(|e| format!("Could not register quick-add: {e}. Choose another shortcut."))?;
    }
    if let Some(old) = *previous
        && let Err(error) = app.global_shortcut().unregister(old)
    {
        if let Some(next) = next {
            app.global_shortcut().unregister(next).map_err(|rollback| {
                format!("Could not release replacement: {rollback}; previous release: {error}")
            })?;
        }
        return Err(format!(
            "Could not release the previous quick-add shortcut: {error}. Try again."
        ));
    }
    *previous = next;
    Ok(())
}
