//! Native shell diagnostics: content stays with its owner, not in the log.

use tauri::{Runtime, plugin::TauriPlugin};

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Warn)
        .filter(|metadata| metadata.target() == "roundup::shell")
        .targets([tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("shell".into()),
            },
        )])
        .max_file_size(1_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .build()
}

/// Preserve the original error for the caller; only its typed cause reaches the sink.
pub(crate) fn startup<T>(result: tauri::Result<T>) -> tauri::Result<T> {
    result.inspect_err(|error| failure("start shell", error))
}

pub(crate) fn failure(operation: &'static str, error: &tauri::Error) {
    match error {
        tauri::Error::Io(error) | tauri::Error::CurrentDir(error) => {
            log::warn!(target: "roundup::shell", "{operation}: IO {:?}", error.kind());
        }
        tauri::Error::Json(error) => {
            log::warn!(target: "roundup::shell", "{operation}: JSON {:?} at {}:{}", error.classify(), error.line(), error.column());
        }
        error => {
            let cause = match error {
                tauri::Error::PluginInitialization(_, _) => "plugin initialization failed",
                tauri::Error::Setup(_) => "application setup failed",
                tauri::Error::Runtime(_) => "native runtime failed",
                tauri::Error::Menu(_) => "native menu failed",
                tauri::Error::WindowNotFound => "window not found",
                tauri::Error::WebviewNotFound => "webview not found",
                tauri::Error::UnknownPath => "system folder unavailable",
                tauri::Error::InvalidAppDirectoriesOverride(_, _) => "invalid application folder",
                _ => "shell operation failed (unclassified Tauri error)",
            };
            log::warn!(target: "roundup::shell", "{operation}: {cause}");
        }
    }
}

#[cfg(test)]
#[path = "../tests/diagnostics/mod.rs"]
pub(crate) mod tests;
