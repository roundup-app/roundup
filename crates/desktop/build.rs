fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "capture-panel",
                tauri_build::InlinedPlugin::new().commands(&["control"]),
            )
            .plugin(
                "window-bar",
                tauri_build::InlinedPlugin::new().commands(&[
                    "native_material",
                    "set_window_title",
                    "drag_window",
                    "zoom_window",
                ]),
            ),
    )
    .expect("the current-window plugin permissions must build");
}
