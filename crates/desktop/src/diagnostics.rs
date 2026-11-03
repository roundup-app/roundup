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

/// Tauri creates configured windows and calls setup during run, where errors become panics.
/// Report before unwinding (or an FFI abort), without exposing the foreign panic payload.
pub(crate) fn startup<T>(start: impl FnOnce() -> tauri::Result<T>) -> tauri::Result<T> {
    let thread = std::thread::current().id();
    let previous = std::sync::Arc::new(std::panic::take_hook());
    let other_threads = previous.clone();
    std::panic::set_hook(Box::new(move |info| {
        if std::thread::current().id() == thread {
            report("run shell", "native runtime or application setup panicked");
        } else {
            other_threads(info);
        }
    }));
    // Restore the host's hook outside unwinding, then keep the original fatal failure.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(start));
    std::panic::set_hook(Box::new(move |info| previous(info)));
    match result {
        Ok(result) => result.inspect_err(|error| failure("start shell", error)),
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

pub(crate) fn failure(operation: &'static str, error: &tauri::Error) {
    match error {
        tauri::Error::Io(error) | tauri::Error::CurrentDir(error) => {
            report(operation, &format!("IO {:?}", error.kind()));
        }
        tauri::Error::Json(error) => {
            report(
                operation,
                &format!(
                    "JSON {:?} at {}:{}",
                    error.classify(),
                    error.line(),
                    error.column()
                ),
            );
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
            report(operation, cause);
        }
    }
}

/// Only App-owned causes or the typed foreign causes above may enter this destination.
pub(crate) fn report(operation: &str, cause: &str) -> String {
    let message = format!("{operation}: {cause}");
    eprintln!("{message}");
    log::warn!(target: "roundup::shell", "{message}");
    log::logger().flush();
    message
}

pub(crate) fn message<R: Runtime>(app: &tauri::AppHandle<R>, message: String, code: Option<i32>) {
    use tauri_plugin_dialog::DialogExt;
    let app = app.clone();
    app.clone()
        .dialog()
        .message(message)
        .title("Cannot open roundup")
        .show(move |_| {
            if let Some(code) = code {
                app.exit(code);
            }
        });
}

#[cfg(test)]
#[path = "../tests/diagnostics/mod.rs"]
pub(crate) mod tests;
