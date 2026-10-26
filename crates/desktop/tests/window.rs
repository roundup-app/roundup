//! U452 (`scenarios/ui-window.md`): the App's supported window width.

use serde_json::Value;

fn app_window() -> Value {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let windows = config["app"]["windows"].as_array().unwrap();
    assert_eq!(windows.len(), 1, "the App declares one window");
    windows[0].clone()
}

#[test]
fn u452_window_width_is_at_least_1280() {
    let window = app_window();
    assert_eq!(window["minWidth"].as_f64(), Some(1280.0));
    assert!(window["width"].as_f64().unwrap() >= 1280.0);
}

// Unconditional maximization and absent-height assertions are superseded by
// s2297a::u3787e_restore_uses_saved_normal_bounds and the native fallback observer.

// Transparency is a native/webview configuration boundary; Overlay title bars alone leave an opaque backing.
#[test]
fn u134_native_window_and_webview_backing_allow_material() {
    let config: tauri::utils::config::Config =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert!(config.app.macos_private_api);
    assert!(config.app.windows[0].transparent);
    assert!(
        config.app.windows[0].window_effects.is_none(),
        "effects stay disabled until the native accessibility preference is read"
    );
}
