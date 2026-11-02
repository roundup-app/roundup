//! U449–U451: window operations use the invoking native window, never a webview-selected label.

use rpc::{RpcError, code};
use std::sync::Mutex;
#[cfg(target_vendor = "apple")]
use tauri::Emitter;
use tauri::{Manager, Runtime, Window, plugin::TauriPlugin};

#[derive(Default)]
struct Material(Mutex<bool>);

#[tauri::command]
fn native_material<R: Runtime>(window: Window<R>) -> bool {
    if window.label() != "main" {
        return false;
    }
    *window
        .state::<Material>()
        .0
        .lock()
        .expect("material state poisoned")
}

#[tauri::command]
fn set_window_title<R: Runtime>(window: Window<R>, title: String) -> Result<(), RpcError> {
    window
        .set_title(&title)
        .map_err(|error| RpcError::new(code::INTERNAL, error.to_string()))
}

#[tauri::command]
fn drag_window<R: Runtime>(window: Window<R>) -> Result<(), RpcError> {
    window
        .start_dragging()
        .map_err(|error| RpcError::new(code::INTERNAL, error.to_string()))
}

#[tauri::command]
fn zoom_window<R: Runtime>(window: Window<R>) -> Result<(), RpcError> {
    let result = window.is_maximized().and_then(|maximized| {
        if maximized {
            window.unmaximize()
        } else {
            window.maximize()
        }
    });
    result.map_err(|error| RpcError::new(code::INTERNAL, error.to_string()))
}

/// The browser reset location belongs to the invoking webview, not the plugin JSON store.
#[tauri::command]
async fn webview_data_path<R: Runtime>(webview: tauri::Webview<R>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let folder = native::webview_data_path(&webview)?;
    #[cfg(not(target_os = "macos"))]
    let folder = webview
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    if !folder.is_absolute() {
        return Err("The browser data folder is not absolute".into());
    }
    Ok(folder.to_string_lossy().into_owned())
}

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("window-bar")
        .on_window_ready(|window| {
            window.manage(Material::default());
            #[cfg(target_vendor = "apple")]
            if window.label() == "main" {
                let window = window.clone();
                native::watch_transparency(move |reduced| {
                    let effects = (!reduced).then(|| {
                        tauri::window::EffectsBuilder::new()
                            .effect(tauri::window::Effect::Sidebar)
                            .build()
                    });
                    let applied = window.set_effects(effects);
                    let enabled = !reduced && applied.is_ok();
                    if let Err(error) = applied {
                        crate::diagnostics::failure("apply native material", &error);
                    }
                    *window
                        .state::<Material>()
                        .0
                        .lock()
                        .expect("material state poisoned") = enabled;
                    if let Err(error) = window.emit("native-material", enabled) {
                        crate::diagnostics::failure("deliver native material", &error);
                    }
                });
            }
            #[cfg(target_vendor = "apple")]
            if window.label() == "main"
                && native::watch_fullscreen(window.clone(), {
                    let window = window.clone();
                    move |fullscreen| {
                        if let Err(error) = window.emit("window-fullscreen-completed", fullscreen) {
                            crate::diagnostics::failure("report fullscreen completion", &error);
                        }
                    }
                }).is_err()
            {
                log::warn!(target: "roundup::shell", "observe fullscreen: native observer registration failed");
            }
            #[cfg(not(target_vendor = "apple"))]
            let _ = window;
        })
        .invoke_handler(tauri::generate_handler![
            webview_data_path,
            native_material,
            set_window_title,
            drag_window,
            zoom_window
        ])
        .build()
}
