//! B48: the result of `agent.wake` names why a request that fired nothing waits.

use contracts::agent::Woken;

#[test]
fn b48_the_contract_is_regenerated() {
    let generated = include_str!("../../../contracts/generated/agent/Woken.ts");
    assert!(generated.contains("why?: string"), "{generated}");
    let waiting = Woken {
        id: 1,
        fired: false,
        why: Some("already working".into()),
    };
    assert_eq!(
        serde_json::to_value(&waiting).unwrap(),
        serde_json::json!({"id": 1, "fired": false, "why": "already working"})
    );
    let fired = Woken {
        id: 2,
        fired: true,
        why: None,
    };
    assert_eq!(
        serde_json::to_value(&fired).unwrap(),
        serde_json::json!({"id": 2, "fired": true})
    );
}
