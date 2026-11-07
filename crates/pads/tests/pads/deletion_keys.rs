use super::*;

#[tokio::test]
async fn p9b_a_client_key_equal_to_a_cascade_key_deletes_and_leaves_the_cascade_receipt() {
    for client in [agent("a"), agent("b")] {
        let rig = Rig::new();
        let owner = agent("a");
        rig.create("notes", "x").await;
        rig.create("other", "y").await;
        let cascade = "rail-op:7";
        {
            let mut db = rusqlite::Connection::open(rig.dir.path().join("project.db")).unwrap();
            let tx = db.transaction().unwrap();
            let params =
                serde_json::from_value(json!({"name": "notes", "operation": cascade})).unwrap();
            pads::retain(&tx, &owner, &params).unwrap();
            tx.commit().unwrap();
        }
        let delete = json!({"name": "other", "operation": cascade});
        let receipt = rig.ok(&client, "pad.delete", delete.clone()).await;
        assert_eq!(receipt["pad"]["name"], "other");
        assert_eq!(rig.ok(&client, "pad.delete", delete).await, receipt);
        let db = rusqlite::Connection::open(rig.dir.path().join("project.db")).unwrap();
        let (actor, request): (String, String) = db
            .query_row(
                "SELECT actor, request FROM pad_deletions WHERE operation=?",
                [cascade],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(actor, serde_json::to_string(&owner).unwrap());
        assert!(request.contains("notes"));
    }
}
