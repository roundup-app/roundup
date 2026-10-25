use super::*;

#[tokio::test]
async fn c4_wire_envelope_bytes_match_before_migration() {
    // Captured from e9485a975 through the real Daemon before migrating the contracts.
    #[derive(serde::Deserialize)]
    struct Envelope {
        request: String,
        reply: String,
    }
    let before: Vec<Envelope> =
        serde_json::from_str(include_str!("fixtures/c4-before-envelopes.json")).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    for envelope in before {
        let request: Value = serde_json::from_str(&envelope.request).unwrap();
        assert_eq!(
            serde_json::to_vec(&request).unwrap(),
            envelope.request.as_bytes()
        );
        let reply = tests::ask(&daemon, &envelope.request).await;
        assert_eq!(
            serde_json::to_vec(&reply).unwrap(),
            envelope.reply.as_bytes()
        );
    }
}
