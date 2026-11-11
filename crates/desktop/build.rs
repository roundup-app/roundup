mod build_stamp;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = std::env::current_dir()?;
    for path in build_stamp::rerun_paths(&dir) {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!(
        "cargo:rustc-env=ROUNDUP_COMMIT={}",
        build_stamp::stamp(&dir)
    );
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
    )?;
    Ok(())
}
