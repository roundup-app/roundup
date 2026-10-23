use super::*;
use serde_json::json;

#[test]
fn a2681a_contract_omits_unavailable_parts() {
    let node: RailNode = serde_json::from_value(json!({
        "id":"1", "kind":"agent", "name":"Rail name", "parent":null, "order":0,
        "status":null, "attempt":null, "status_revision":null, "terminal_id":null,
        "worktree":null, "can_resume":false, "channel":null, "work":null,
        "stray":[], "model":null, "effort":null
    }))
    .unwrap();
    assert!(
        serde_json::to_value(&node)
            .unwrap()
            .get("overview")
            .is_none()
    );
    let overview = ConversationOverview {
        program: "Claude Code".into(),
        id: "opaque".into(),
        name: None,
        used: None,
        limit: None,
        context_parts: None,
        card: Some(ConversationCard {
            intent: Some("Keep intent".into()),
            ..Default::default()
        }),
    };
    assert_eq!(
        serde_json::to_value(overview).unwrap(),
        json!({
            "program":"Claude Code", "id":"opaque", "card":{"intent":"Keep intent"}
        })
    );
}

#[test]
fn a2681d_contract_omits_absent_parts() {
    let overview = ConversationOverview {
        program: "Claude Code".into(),
        id: "opaque".into(),
        name: None,
        used: Some(10),
        limit: None,
        context_parts: Some(vec![ContextPart {
            kind: ContextPartKind::Files,
            tokens: 4,
        }]),
        card: None,
    };
    assert_eq!(
        serde_json::to_value(&overview).unwrap()["context_parts"],
        json!([{"kind":"files","tokens":4}])
    );
    let bare = ConversationOverview {
        context_parts: None,
        ..overview
    };
    assert!(
        serde_json::to_value(bare)
            .unwrap()
            .get("context_parts")
            .is_none()
    );
}
