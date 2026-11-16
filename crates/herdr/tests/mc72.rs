//! MC72: the method `machine.remove` sends is one the checked-in schema lists.

use serde_json::Value;

const SCHEMA: &str = include_str!("../schema/herdr-core-0.1.20.json");
const CONN: &str = include_str!("../src/conn.rs");

#[test]
fn mc72_remove_uses_a_method_in_the_pinned_schema() {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    let sent = CONN
        .split("pub async fn machine_rm")
        .nth(1)
        .and_then(|body| body.split('"').nth(1))
        .unwrap();

    assert_eq!(sent, "machine.rm");
    assert!(
        schema["advertised"]
            .as_array()
            .unwrap()
            .iter()
            .any(|method| method == sent)
    );
}
