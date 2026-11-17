//! LH2: the call's structured-output schema and the App's catalogue come from one Rust type.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use serde_json::Value;

#[test]
fn lh2_the_schema_and_the_catalogue_come_from_one_definition() {
    let schema: Value = serde_json::from_str(&contracts::links::schema()).unwrap();
    let defs = &schema["$defs"];
    let entry = &defs["LinkEntry"]["properties"];
    // The generated type of `LinkEntry` names the same fields and kinds as the schema built from
    // it, so neither can drift from the other.
    let generated = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/generated/links/LinkEntry.ts"),
    )
    .unwrap();
    let kinds = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/generated/links/LinkKind.ts"),
    )
    .unwrap();
    let fields: Vec<_> = entry.as_object().unwrap().keys().cloned().collect();
    assert_eq!(fields.len(), 3);
    for field in fields {
        assert!(generated.contains(&format!("\t{field}:")), "{field}");
    }
    let kinds_in_schema = defs["LinkKind"]["enum"].as_array().unwrap();
    assert_eq!(kinds_in_schema.len(), 4);
    for kind in kinds_in_schema {
        let kind = kind.as_str().unwrap();
        assert!(kinds.contains(&format!("\"{kind}\"")), "{kind}");
    }
}
