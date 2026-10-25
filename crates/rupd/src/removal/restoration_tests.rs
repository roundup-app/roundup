    use super::tests::call;
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn u3787a_reversible_rail_removal_restores_original_identity() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let node = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"})).await.unwrap();
        let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        let removed = call(&daemon, "rail.remove", json!({"id":node["id"],"operation":"chosen"})).await.unwrap();
        assert_eq!(removed["deletion"]["operation"], "chosen");
        assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), json!([]));
        call(&daemon, "rail.restore", removed["deletion"].clone()).await.unwrap();
        assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), before);
        assert_eq!(call(&daemon, "terminal.list", Value::Null).await.unwrap(), json!([]));
    }
