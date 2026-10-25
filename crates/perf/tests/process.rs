#[path = "support/process.rs"]
mod process;

#[test]
fn r25_every_method_has_a_perf_disposition() {
    process::coverage(
        contracts::methods::METHODS.iter().map(|method| method.name),
        include_str!("../budgets.json"),
        include_str!("../../../docs/perf.md"),
    )
    .unwrap();
}

#[test]
fn r25_missing_method_or_reason_fails_coverage() {
    for (budgets, reasons, passes) in [
        (r#"{}"#, r#"{}"#, false),
        (r#"{}"#, r#"{"new.call":"  "}"#, false),
        (
            r#"{"latency_ms":{"methods":["new.call"]}}"#,
            r#"{"new.call":""}"#,
            false,
        ),
        (r#"{"latency_ms":{"methods":["new.call"]}}"#, r#"{}"#, true),
        (
            r#"{}"#,
            r#"{"new.call":"Explicit user action outside the steady workload"}"#,
            true,
        ),
    ] {
        let docs = format!("## Off the hot path\n\n```json\n{reasons}\n```\n");
        let result = process::coverage(["new.call"].into_iter(), budgets, &docs);
        assert_eq!(result.is_ok(), passes, "{result:?}");
        if let Err(error) = result {
            assert!(error.contains("new.call"));
        }
    }
}
