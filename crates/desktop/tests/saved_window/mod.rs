//! U3787e: production startup and actual native geometry, on AppKit's main thread.
use tauri::Manager;

pub fn u3787e_restore_uses_saved_normal_bounds() {
    let dir = tempfile::tempdir().unwrap();
    let mut context = desktop::context();
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.path().to_path_buf()),
    );
    let config =
        desktop::Config::locate(None, std::path::Path::new("/unused"), dir.path(), 1).unwrap();
    // Resolve the same platform config directory as the production plugin.
    let mut probe_context = desktop::context();
    probe_context.config_mut().app.windows.clear();
    probe_context.config_mut().app.app_directories_override =
        context.config().app.app_directories_override.clone();
    let probe = tauri::Builder::default().build(probe_context).unwrap();
    let path = probe.path().app_config_dir().unwrap();
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join(".window-state.json"), r#"{"main":{"width":1320,"height":700,"x":40,"y":60,"prev_x":40,"prev_y":60,"scale":1.0,"maximized":false,"fullscreen":false,"visible":true,"decorated":true}}"#).unwrap();
    drop(probe);
    let app = desktop::build(tauri::Builder::default(), config, None, |app, code| {
        app.exit(code)
    })
    .build(context)
    .unwrap();
    let main = app.get_webview_window("main").unwrap();
    assert!(main.is_visible().unwrap());
    assert!(!main.is_maximized().unwrap());
    let scale = main.scale_factor().unwrap();
    let size = main.outer_size().unwrap().to_logical::<f64>(scale);
    assert!((size.width - 1320.0).abs() <= 1.0, "{size:?}");
    let position = main.outer_position().unwrap().to_logical::<f64>(scale);
    assert!((position.x - 40.0).abs() <= 1.0, "{position:?}");
    assert!((position.y - 60.0).abs() <= 1.0, "{position:?}");
}
