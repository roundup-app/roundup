//! A35: the App has no hand-written caller of `workstream.rewind` and no U374 surface.

use std::path::Path;

#[test]
fn a35_rewind_has_no_app_only_caller_or_u374_surface() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/src");
    let mut stack = vec![src];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            // The generated contract types name the method; no hand-written App code calls it.
            if path.components().any(|c| c.as_os_str() == "generated") {
                continue;
            }
            for word in ["workstream.rewind", "rewindPlan", "U374"] {
                assert!(!text.contains(word), "{} names {word}", path.display());
            }
        }
    }
}
