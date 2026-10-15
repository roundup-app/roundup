use std::time::Duration;

#[tokio::test]
async fn x14_flood_detects_current_transport_and_cleans_up() {
    let report = perf::flood::observe(Duration::from_secs(60)).await;
    assert!(report.error.is_none(), "{report:?}");
    assert_eq!(report.chunks.len(), 10);
    assert!(report.chunks.values().all(|n| *n > report.capacity));
    assert!(report.lagged > 0, "{report:?}");
    assert!(!report.passed());
    assert!(report.cleaned_up);
}
