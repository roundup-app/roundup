use super::*;

async fn current_quota(p: &mut QuotaProject) -> Vec<(Value, usize, u8)> {
    let c = p.client().await;
    let mut records = Vec::new();
    for (key, length, byte) in [
        ("first", 7, b'a'),
        ("second", 11, b'b'),
        ("chosen-file", 13, b'c'),
        ("fill", 33, b'd'),
    ] {
        records.push((
            publish_bytes(p.dir.path(), &c, key, length, byte).await,
            length,
            byte,
        ));
    }
    records
}

fn allocation_bytes(p: &QuotaProject) -> i64 {
    let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
    let blobs: i64 = db
        .query_row(
            "SELECT coalesce(sum(length(bytes)),0) FROM deliverable_bytes",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let mut files = db
        .prepare("SELECT id,length FROM deliverable_files")
        .unwrap();
    let files = files
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .unwrap();
    blobs
        + files
            .map(|file| {
                let (id, charged) = file.unwrap();
                let actual = std::fs::metadata(p.data_dir().join("publication-files").join(id))
                    .unwrap()
                    .len();
                assert_eq!(actual, u64::try_from(charged).unwrap());
                charged
            })
            .sum::<i64>()
}

async fn exact_publications(c: &rpc::Client, records: &[(Value, usize, u8)]) {
    assert_eq!(
        list_all(c).await,
        json!(records.iter().map(|r| &r.0).collect::<Vec<_>>())
    );
    for (record, length, byte) in records {
        assert_eq!(call(c, "deliverable.get", identity(record)).await, *record);
        assert_eq!(retained(c, record).await, vec![*byte; *length]);
    }
}

async fn refuses_one_byte(p: &QuotaProject, c: &rpc::Client, records: &[(Value, usize, u8)]) {
    std::fs::write(p.dir.path().join("over.bin"), b"x").unwrap();
    refused(
        c,
        "deliverable.publish",
        json!({"key":"one-over","title":"Over quota","target":{"kind":"file","path":"over.bin"}}),
    )
    .await;
    assert_eq!(
        list_all(c).await,
        json!(records.iter().map(|r| &r.0).collect::<Vec<_>>())
    );
    assert_eq!(allocation_bytes(p), 64);
}

#[tokio::test]
async fn r4160a_current_quota_boundary() {
    let mut p = QuotaProject::start().await;
    let records = current_quota(&mut p).await;
    let c = p.client().await;
    assert_eq!(allocation_bytes(&p), 64);
    refuses_one_byte(&p, &c, &records).await;
    p.restart().await;
    let c = p.client().await;
    exact_publications(&c, &records).await;
    assert_eq!(allocation_bytes(&p), 64);
}

#[tokio::test]
async fn r4160b_cleanup_releases_only_chosen_bytes() {
    for chosen in [0, 2] {
        let mut p = QuotaProject::start().await;
        let mut records = current_quota(&mut p).await;
        let c = p.client().await;
        assert_eq!(allocation_bytes(&p), 64);
        let (removed, length, _) = records.remove(chosen);
        let id = identity(&removed);
        call(&c, "deliverable.remove", id.clone()).await;
        for step in 0..4 {
            if step == 2 {
                p.restart().await;
            }
            let c = p.client().await;
            if step == 1 || step == 3 {
                refused(&c, "deliverable.remove", id.clone()).await;
            }
            refused(&c, "deliverable.get", id.clone()).await;
            refused(&c, "deliverable.resolve", id.clone()).await;
            assert_eq!(allocation_bytes(&p), 64 - i64::try_from(length).unwrap());
            let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
            assert_eq!(db.query_row("SELECT (SELECT count(*) FROM deliverable_bytes WHERE id=?1) + (SELECT count(*) FROM deliverable_files WHERE id=?1)", [removed["id"].as_str().unwrap()], |r| r.get::<_, i64>(0)).unwrap(), 0);
            assert!(
                !p.data_dir()
                    .join("publication-files")
                    .join(removed["id"].as_str().unwrap())
                    .exists()
            );
            exact_publications(&c, &records).await;
        }
        let c = p.client().await;
        let replacement = publish_bytes(p.dir.path(), &c, "replacement", length, b'r').await;
        assert_ne!(replacement["id"], removed["id"]);
        records.push((replacement, length, b'r'));
        assert_eq!(allocation_bytes(&p), 64);
        refuses_one_byte(&p, &c, &records).await;
        exact_publications(&c, &records).await;
    }
}
