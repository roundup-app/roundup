//! E11: aimock owns matching and the request journal.
#[path = "e2e/aimock.rs"]
mod aimock;

use serde_json::json;

#[test]
fn e11_an_unmatched_request_fails() {
    let model = aimock::Model::start("unmatched");
    let response = std::process::Command::new("curl")
        .args(["--silent", "--show-error", "--max-time", "10", "-X", "POST"])
        .arg(format!("{}/v1/messages", model.url))
        .args(["-H", "content-type: application/json", "-d"])
        .arg(json!({
            "model": "claude-sonnet-4-6", "max_tokens": 32,
            "messages": [{"role": "user", "content": "this turn has no fixture"}]
        }).to_string())
        .output().unwrap();
    assert!(response.status.success());
    let journal = model.journal();
    assert_eq!(journal.len(), 1);
    assert_eq!(journal[0]["response"]["status"], 503, "{journal:#?}");
    assert!(journal[0]["response"]["fixture"].is_null());
}
