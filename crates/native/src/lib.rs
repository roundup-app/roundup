//! Native integration owns Objective-C objects and thread obligations; callers supply only safe handles.
#[cfg(target_vendor = "apple")]
mod webkit_rate;
#[cfg(target_vendor = "apple")]
pub use webkit_rate::{Missing, Preferences, plugin};
#[cfg(target_vendor = "apple")]
mod application;
#[cfg(target_vendor = "apple")]
pub use application::{watch, watch_fullscreen};

#[cfg(target_vendor = "apple")]
mod capture;
#[cfg(target_vendor = "apple")]
pub use capture::{CapturePanel, CapturePanelState, register_capture};

// WKPreferences requires the process main thread, so these actual-WebKit proofs use a main-thread harness.
#[cfg(test)]
fn main() {
    #[cfg(target_vendor = "apple")]
    webkit_rate::tests::run();
}

#[cfg(target_vendor = "apple")]
mod transparency;
#[cfg(target_vendor = "apple")]
pub use transparency::watch_transparency;

/// External error messages may carry window titles, paths or user text.
#[cfg(target_vendor = "apple")]
fn diagnostic(operation: &'static str, error: &tauri::Error) {
    let cause = match error {
        tauri::Error::Json(_) => "event serialization failed",
        tauri::Error::Runtime(_) => "native runtime failed",
        tauri::Error::WindowNotFound => "window not found",
        tauri::Error::WebviewNotFound => "webview not found",
        _ => "native dispatch failed",
    };
    log::warn!(target: "roundup::shell", "{operation}: {cause}");
}

#[cfg(target_vendor = "apple")]
mod menu;
#[cfg(target_vendor = "apple")]
pub use menu::{context_menu, project_menu_hints};

#[cfg(target_vendor = "apple")]
mod notification;
#[cfg(target_vendor = "apple")]
pub use notification::banner_permission;

#[cfg(target_vendor = "apple")]
mod alert;
#[cfg(target_vendor = "apple")]
pub use alert::removal_alert;
