//! The App webview’s exact native permission boundary.
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

#[test]
fn s1_the_webview_is_granted_dialogs_the_dock_badge_and_hearing_events_and_nothing_else() {
    let capabilities = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let granted: BTreeSet<String> = std::fs::read_dir(capabilities)
        .unwrap()
        .flat_map(|entry| {
            let file: Value =
                serde_json::from_slice(&std::fs::read(entry.unwrap().path()).unwrap()).unwrap();
            file["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p.as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        })
        .collect();

    let expected = [
        "dialog:allow-open",
        "dialog:allow-save",
        "core:window:allow-set-badge-count",
        "window-bar:allow-set-window-title",
        "window-bar:allow-drag-window",
        "window-bar:allow-zoom-window",
        "core:event:allow-listen",
        "core:event:allow-unlisten",
    ]
    .map(String::from)
    .into();
    assert_eq!(granted, expected);
}
