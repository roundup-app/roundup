//! U3787f: actual AppKit panel operations through the same safe interface as production.
//! Kept in s2297a's main-thread harness; libtest worker threads cannot own AppKit.
#[cfg(target_os = "macos")]
pub fn u3787f_panel_does_not_activate_main_window() {
    use tauri::Manager;

    let mut context = desktop::context();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .plugin(native::capture_plugin())
        .build(context)
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(
        &app,
        "capture-observer-main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .visible(false)
    .focused(false)
    .build()
    .unwrap();
    let before = main.outer_position().unwrap();
    let panel = native::CapturePanel::new(app.handle().clone());
    let shown = panel.show().unwrap();
    assert!(shown.visible);
    assert!(!shown.can_become_main);
    assert!(!main.is_visible().unwrap());
    assert!(!main.is_focused().unwrap());
    assert_eq!(main.outer_position().unwrap(), before);
    assert!(panel.show().unwrap().visible);
    assert_eq!(app.webview_windows().len(), 2);
    assert!(!panel.dismiss().unwrap().visible);
    assert!(!main.is_focused().unwrap());
    panel.release().unwrap();
    main.destroy().unwrap();
}
