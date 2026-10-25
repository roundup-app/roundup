//! U3787f: actual AppKit panel operations through the same safe interface as production.
//! Kept in s2297a's main-thread harness; libtest worker threads cannot own AppKit.
pub fn u3787f_panel_does_not_activate_main_window() {
    use tauri::Manager;

    let mut context = desktop::context();
    context.config_mut().app.windows.clear();
    let app = native::register_capture(tauri::Builder::default())
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
    let handle = app.handle().clone();
    let worker = std::thread::spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let panel = native::CapturePanel::new(
                handle.clone(),
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .unwrap();
            // Real OS registration, replacement, invalid-input refusal and release share the
            // production plugin. No synthetic registry stands in for native acknowledgment.
            panel.configure(Some("Super+Shift+KeyT")).unwrap();
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            handle.global_shortcut().register("Super+Alt+KeyY").unwrap();
            assert!(panel.configure(Some("Super+Alt+KeyY")).is_err());
            assert!(handle.global_shortcut().is_registered("Super+Shift+KeyT"));
            handle
                .global_shortcut()
                .unregister("Super+Alt+KeyY")
                .unwrap();
            panel.configure(Some("Super+Alt+KeyY")).unwrap();
            assert!(!handle.global_shortcut().is_registered("Super+Shift+KeyT"));
            assert!(panel.configure(Some("not-a-shortcut")).is_err());
            panel.configure(None).unwrap();
            assert!(!handle.global_shortcut().is_registered("Super+Alt+KeyY"));
            let shown = panel.show().unwrap();
            assert!(shown.visible);
            assert!(!shown.can_become_main);
            assert!(!main.is_visible().unwrap());
            assert!(!main.is_focused().unwrap());
            assert_eq!(main.outer_position().unwrap(), before);
            assert!(panel.show().unwrap().visible);
            assert_eq!(handle.webview_windows().len(), 2);
            assert!(!panel.dismiss().unwrap().visible);
            assert!(!main.is_focused().unwrap());
            panel.release().unwrap();
        }));
        // End the real event loop even if an assertion failed; nextest owns the process bound.
        handle.exit(i32::from(outcome.is_err()));
        outcome
    });
    assert_eq!(app.run_return(|_, _| {}), 0);
    worker.join().unwrap().unwrap();
}

pub fn u3787f_panel_uses_invoking_display() {
    use tauri::Manager;

    let mut context = desktop::context();
    context.config_mut().app.windows.clear();
    let app = native::register_capture(tauri::Builder::default())
        .build(context)
        .unwrap();
    let cursor = app.cursor_position().unwrap();
    let invoking = app.monitor_from_point(cursor.x, cursor.y).unwrap().unwrap();
    let panel = native::CapturePanel::new(
        app.handle().clone(),
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .unwrap();
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
}
