//! U449–U451: window operations use the invoking native window, never a webview-selected label.

use rpc::{RpcError, code};
use tauri::{Runtime, Window, plugin::TauriPlugin};

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

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("window-bar")
        .invoke_handler(tauri::generate_handler![
            set_window_title,
            drag_window,
            zoom_window
        ])
        .build()
}
