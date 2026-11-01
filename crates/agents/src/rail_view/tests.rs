use std::sync::Arc;

use crate::Slot;
use crate::tests::*;

#[test]
fn a2681a_stopping_attempt_hides_parts() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    let conversation = "11111111-1111-1111-1111-111111111111";
    let cwd = dir.path().canonicalize().unwrap();
    let key: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let path = dir
        .path()
        .join("projects")
        .join(key)
        .join(format!("{conversation}.jsonl"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, "{}\n").unwrap();
    shared
        .rail()
        .save_conversation(&id, conversation, &cwd.to_string_lossy())
        .unwrap();
    if let Some(Slot::Running(run)) = shared.runs().get_mut(&id) {
        run.ended = true;
    }
    shared
        .rail_view
        .launcher
        .refresh_overview(&cwd, conversation);
    assert!(
        shared.node(&id).unwrap().overview.is_some(),
        "fixture must have visible parts before stopping"
    );
    if let Some(Slot::Running(run)) = shared.runs().get_mut(&id) {
        run.closing = true;
    }
    assert!(shared.node(&id).unwrap().overview.is_none());
}

#[test]
fn u5151d_a_failed_resume_reads_as_a_user_action() {
    let [wait, stop] = [true, false].map(super::resume_cleanup_label);
    assert!(wait.contains("wait") && stop.contains("stop"));
    for label in [wait, stop] {
        assert!(label.ends_with("resume again") && !label.contains("cleanup"));
    }
}
