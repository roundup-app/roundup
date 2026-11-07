use contracts::{pad, todo};
use serde_json::json;

#[test]
fn p9a_a_key_over_256_bytes_or_empty_is_refused_at_parse() {
    for key in [String::new(), "k".repeat(257)] {
        assert!(
            serde_json::from_value::<pad::DeleteParams>(json!({"name": "n", "operation": key}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<todo::DeleteParams>(json!({"operation": key, "ids": [1]}))
                .is_err()
        );
    }
    // Every key valid before stays valid: Pads took 1 to 256 bytes, Todos 1 to 128.
    for key in ["k".to_string(), "k".repeat(128), "k".repeat(256)] {
        assert!(
            serde_json::from_value::<pad::DeleteParams>(json!({"name": "n", "operation": key}))
                .is_ok()
        );
        assert!(
            serde_json::from_value::<todo::DeleteParams>(json!({"operation": key, "ids": [1]}))
                .is_ok()
        );
    }
    assert!(serde_json::from_value::<pad::DeleteParams>(json!({"name": "n"})).is_err());
}
