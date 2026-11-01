fn main() {
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "--short=9", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=ROUNDUP_BUILD={sha}");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
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
