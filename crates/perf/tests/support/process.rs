use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

#[derive(Deserialize)]
struct Metric {
    #[serde(default)]
    methods: Vec<String>,
}

pub fn coverage<'a>(
    methods: impl Iterator<Item = &'a str>,
    budgets: &str,
    docs: &str,
) -> Result<(), String> {
    let metrics: BTreeMap<String, Metric> =
        serde_json::from_str(budgets).map_err(|e| e.to_string())?;
    let measured: BTreeSet<_> = metrics
        .values()
        .flat_map(|m| m.methods.iter().map(String::as_str))
        .collect();
    let json = docs
        .split_once("## Off the hot path\n")
        .and_then(|(_, s)| s.split_once("```json\n"))
        .and_then(|(_, s)| s.split_once("\n```"))
        .ok_or("Off the hot path JSON missing")?
        .0;
    let off_path: BTreeMap<String, String> =
        serde_json::from_str(json).map_err(|e| e.to_string())?;
    let missing: Vec<_> = methods
        .filter(|name| {
            !measured.contains(name)
                && !off_path
                    .get(*name)
                    .is_some_and(|reason| !reason.trim().is_empty())
        })
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!("No perf disposition: {}", missing.join(", ")))
    }
}
