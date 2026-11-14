//! The one failure type of the native crate: what macOS, Tauri or a native library refused.

/// Every message reads as it did when these were strings; callers convert once at their command edge.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Menu(#[from] muda::Error),
    #[error("{0}")]
    Disconnected(#[from] std::sync::mpsc::RecvError),
    #[error("{0}")]
    TimedOut(#[from] std::sync::mpsc::RecvTimeoutError),
    #[error("the native operation did not run on the main thread")]
    OffMainThread,
    #[error("Capture panel integration is not registered")]
    CaptureUnregistered,
    #[error("This window does not own the Capture operation")]
    CaptureNotOwned,
    #[error("Capture panel has no webview")]
    CaptureNoWebview,
    #[error("{0:?}")]
    CaptureMissing(tauri_nspanel::Error),
    #[error("{0}")]
    CaptureStyle(#[from] tauri_nspanel::StyleMaskError),
    #[error("No display at the invoking pointer")]
    NoDisplay,
    #[error("{0}")]
    Shortcut(#[from] tauri_plugin_global_shortcut::Error),
    #[error("poisoned lock: another task failed inside")]
    ShortcutPoisoned,
    #[error("Could not register quick-add: {0}. Choose another shortcut.")]
    ShortcutTaken(tauri_plugin_global_shortcut::Error),
    #[error("Could not release replacement: {rollback}; previous release: {release}")]
    ShortcutRollback {
        rollback: tauri_plugin_global_shortcut::Error,
        release: tauri_plugin_global_shortcut::Error,
    },
    #[error("Could not release the previous quick-add shortcut: {0}. Try again.")]
    ShortcutRelease(tauri_plugin_global_shortcut::Error),
    /// macOS refused banners; the cause is the system's own description or roundup's hint.
    #[error("{0}")]
    BannerRefused(String),
    #[error("WebKit cannot report its browser data configuration")]
    BrowserDataUnreported,
    #[error("WebKit did not report a bounded browser data folder")]
    BrowserDataUnbounded,
    #[error("Dock installation requires the main thread")]
    DockOffMainThread,
    #[error("A Dock section is already installed")]
    DockInstalled,
    #[error("The application has no live delegate")]
    DockNoDelegate,
    #[error("The application delegate already implements an incompatible Dock callback")]
    DockCallbackConflict,
    #[error("Registering the application delegate Dock callback failed")]
    DockCallbackRefused,
    #[error("The application delegate Dock callback is missing after registration")]
    DockCallbackMissing,
}
