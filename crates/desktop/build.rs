fn main() {
    let commit = std::process::Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_default();
    println!("cargo:rustc-env=ROUNDUP_COMMIT={}", commit.trim());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "capture-panel",
                tauri_build::InlinedPlugin::new().commands(&["control"]),
            )
            .plugin(
                "window-bar",
                tauri_build::InlinedPlugin::new().commands(&[
                    "webview_data_path",
                    "native_material",
                    "set_window_title",
                    "drag_window",
                    "zoom_window",
                ]),
            ),
    )
    .expect("the current-window plugin permissions must build");
}
