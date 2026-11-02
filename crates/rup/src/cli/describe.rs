use serde_json::Value;

use super::{fields_of, type_name};

/// I11: summary, description, arguments, result, then an example call and its result.
pub(super) fn print(described: &Value) {
    let text = |key: &str| described[key].as_str().unwrap_or_default();
    println!("{}\n\n{}\n", text("summary"), text("description"));
    println!("arguments:");
    let params = described["params"].as_object().cloned().unwrap_or_default();
    let fields = fields_of(&params);
    for field in &fields {
        let need = if field.required {
            "required"
        } else {
            "optional"
        };
        println!("  {}  {}  {need}", field.name, type_name(&field.kind));
    }
    if fields.is_empty() {
        println!("  none");
    }
    let result = &described["result"];
    let shape = result["title"]
        .as_str()
        .or_else(|| result["type"].as_str())
        .unwrap_or("JSON");
    println!("\nresult: {shape}\n");
    println!(
        "example call: {} {}",
        text("name"),
        described["example"]["params"]
    );
    println!("example result: {}", described["example"]["result"]);
}
