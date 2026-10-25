use super::*;

#[test]
fn r20_runner_rejects_workload_mismatch_and_inactive_flood() {
    let mut report = serde_json::json!({"workload":"flood", "terminal_id":"measured", "flood":{
        "id":"flood", "opened":true, "command":"/usr/bin/yes roundup-flood",
        "samples":[{"at_ms":1,"bytes":10,"state":"visible"},{"at_ms":1001,"bytes":1010,"state":"folded"}],
        "bytes":1000,"interval_ms":1000,"bytes_per_second":1000
    }});
    assert!(checked_workload(&report, true).is_ok());
    assert!(
        checked_workload(&report, false)
            .unwrap_err()
            .to_string()
            .contains("workload")
    );
    for field in ["id", "command", "opened", "samples", "bytes_per_second"] {
        let mut invalid = report.clone();
        invalid["flood"][field] = Value::Null;
        assert!(
            checked_workload(&invalid, true).is_err(),
            "accepted missing {field}"
        );
    }
    report["flood"]["samples"][1]["bytes"] = 10.into();
    assert!(checked_workload(&report, true).is_err());
    report["workload"] = "idle".into();
    assert!(checked_workload(&report, false).is_ok());
    assert!(Args::try_parse_from(["perf-keystroke", "--flood", "--frames"]).is_err());
}

#[tokio::test]
async fn r20_unending_unrelated_output_cannot_evict_or_starve_the_report() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("flood.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut lines = tokio::io::BufReader::new(read).lines();
        let mut rounds = 0;
        while let Some(line) = lines.next_line().await.unwrap() {
            let call: Value = serde_json::from_str(&line).unwrap();
            let result = if call["method"] == "terminal.list" {
                rounds += 1;
                serde_json::json!([{"id":"flood"},{"id":"measured"}])
            } else if call["params"]["id"] == "flood" {
                // Continuous output exceeds the buffer cap; one eviction is unrelated to the report.
                let from = if rounds == 15 {
                    1_500_000
                } else {
                    call["params"]["after"].as_u64().unwrap()
                };
                serde_json::json!({"from":from,"next":from+16384,"text":"y".repeat(16384),"truncated":true})
            } else {
                let text = if rounds < 30 {
                    ""
                } else {
                    "PERF {\"terminal_id\":\"measured\",\"workload\":\"flood\"}\n"
                };
                serde_json::json!({"from":0,"next":0,"text":text,"truncated":false})
            };
            if write
                .write_all(
                    format!(
                        "{}\n",
                        serde_json::json!({"jsonrpc":"2.0","id":call["id"],"result":result})
                    )
                    .as_bytes(),
                )
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let result = collect_report(&socket, "PERF ", Duration::from_secs(2), Some(dir.path())).await;
    server.abort();
    assert_eq!(result.unwrap()["terminal_id"], "measured");
    let saved: Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("collection.json")).unwrap())
            .unwrap();
    assert!(saved["output"]["flood"][1].as_str().unwrap().len() <= 131072);
    assert!(dir.path().join("report.json").is_file());
}

#[tokio::test]
async fn r20_report_cannot_claim_another_terminal_identity() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("identity.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut lines = tokio::io::BufReader::new(read).lines();
        while let Some(line) = lines.next_line().await.unwrap() {
            let call: Value = serde_json::from_str(&line).unwrap();
            let result = if call["method"] == "terminal.list" {
                serde_json::json!([{"id":"flood"}])
            } else {
                serde_json::json!({"from":0,"next":80,"text":"PERF {\"terminal_id\":\"measured\"}\n","truncated":false})
            };
            if write
                .write_all(
                    format!(
                        "{}\n",
                        serde_json::json!({"jsonrpc":"2.0","id":call["id"],"result":result})
                    )
                    .as_bytes(),
                )
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let result = collect_report(&socket, "PERF ", Duration::from_secs(1), None).await;
    server.abort();
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Terminal identity mismatch")
    );
}
