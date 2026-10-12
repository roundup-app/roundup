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

#[test]
fn u452_window_height_is_unchanged() {
    let window = app_window();
    for field in ["height", "minHeight", "maxHeight"] {
        assert!(window.get(field).is_none(), "{field} must stay absent");
    }
}
