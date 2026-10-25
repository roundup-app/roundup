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
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .focused(false)
    .build()
    .unwrap();
    let before = main.outer_position().unwrap();
    let panel = native::CapturePanel::new(
        app.handle().clone(),
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    );
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

#[cfg(target_os = "macos")]
pub fn u3787f_panel_uses_invoking_display() {
    use tauri::Manager;

    let mut context = desktop::context();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .plugin(native::capture_plugin())
        .build(context)
        .unwrap();
    let cursor = app.cursor_position().unwrap();
    let invoking = app.monitor_from_point(cursor.x, cursor.y).unwrap().unwrap();
    let panel = native::CapturePanel::new(
        app.handle().clone(),
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    );
    panel.show().unwrap();
    let window = app.get_webview_window("todo-capture").unwrap();
    let actual = window.current_monitor().unwrap().unwrap();
    assert_eq!(actual.position(), invoking.position());
    let area = invoking.work_area();
    let position = window.outer_position().unwrap();
    let size = window.outer_size().unwrap();
    assert!(position.x >= area.position.x && position.y >= area.position.y);
    assert!(
        i64::from(position.x) + i64::from(size.width)
            <= i64::from(area.position.x) + i64::from(area.size.width)
    );
    assert!(
        i64::from(position.y) + i64::from(size.height)
            <= i64::from(area.position.y) + i64::from(area.size.height)
    );
    panel.release().unwrap();
    assert!(app.get_webview_window("todo-capture").is_none());
}
