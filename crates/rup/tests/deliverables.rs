//! DV1–DV4: deliberately published results through the real Project Daemon.
#[path = "common/served.rs"]
mod common;
use serde_json::{Value, json};
#[path = "deliverables/publication.rs"]
mod publication;
async fn call(c: &rpc::Client, method: &str, args: Value) -> Value {
    c.request(method, args).await.unwrap()
}

fn identity(record: &Value) -> Value {
    json!({"project":record["project"],"id":record["id"]})
}
async fn refused(c: &rpc::Client, method: &str, args: Value) {
    assert!(c.request(method, args).await.is_err());
}
async fn pad(c: &rpc::Client, name: &str, text: &str) -> Value {
    call(c, "pad.create", json!({"name":name,"text":text})).await
}
async fn list_all(c: &rpc::Client) -> Value {
    call(c, "deliverable.list", json!({})).await
}
async fn retained(c: &rpc::Client, record: &Value) -> Vec<u8> {
    let resolution = call(c, "deliverable.resolve", identity(record)).await;
    std::fs::read(resolution["path"].as_str().unwrap()).unwrap()
}

async fn pad_target(client: &rpc::Client, name: &str, revision: u64) -> Value {
    let source = call(client, "pad.read", json!({"name":name})).await;
    json!({"kind":"pad","name":name,"incarnation":source["incarnation"],"revision":revision})
}

#[tokio::test]
async fn dv4_user_home_wins() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    let home = call(&c, "rail.createWorkstream", json!({"name":"Review"})).await["id"].clone();
    let original =
        call(&c, "rail.createWorkstream", json!({"name":"Original"})).await["id"].clone();
    let maker = rpc::Client::connect(&a.socket()).await.unwrap();
    call(
        &maker,
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":original,"parent":null}}),
    )
    .await;
    let request = json!({"key":"home","title":"Result","target":{"kind":"external","url":"https://example.com/pr/1"}});
    let p = call(&maker, "deliverable.publish", request.clone()).await;
    let moved = call(
        &c,
        "deliverable.move",
        json!({"project":p["project"],"id":p["id"],"home":home}),
    )
    .await;
    refused(
        &c,
        "deliverable.move",
        json!({"project":p["project"],"id":p["id"],"home":format!("0{}",home.as_str().unwrap())}),
    )
    .await;
    assert_eq!(moved["home"], home);
    assert_eq!(call(&maker, "deliverable.publish", request).await, moved);
    assert_eq!(
        call(&c, "deliverable.list", json!({"home":home})).await,
        json!([moved])
    );
    refused(
        &maker,
        "deliverable.move",
        json!({"project":p["project"],"id":p["id"],"home":original}),
    )
    .await;
    assert_eq!(
        call(&c, "deliverable.list", json!({"home":original})).await,
        json!([])
    );
    let touches = call(
        &c,
        "provenance.history",
        json!({"item":format!("deliverable:{}",p["id"].as_str().unwrap())}),
    )
    .await;
    assert_eq!(touches.as_array().unwrap().len(), 1);
    assert_eq!(touches[0]["actor"]["kind"], "user");
    assert_eq!(touches[0]["actor"]["id"], "you");
    assert_eq!(touches[0]["verb"], "wrote");
}
#[tokio::test]
async fn dv3_revoked_access() {
    let mut a = daemon::start(&[]);
    let c = a.client().await;
    pad(&c, "notes", "retained").await;
    let request = json!({"key":"notes","title":"notes","target":pad_target(&c,"notes",1).await});
    let p = call(&c, "deliverable.publish", request).await;
    let id = identity(&p);
    let opened = call(&c, "deliverable.resolve", id.clone()).await;
    let path = std::path::Path::new(opened["path"].as_str().unwrap());
    assert!(path.is_file());
    call(&c, "pad.delete", json!({"name":"notes"})).await;
    assert!(
        !path.exists(),
        "source deletion invalidates cached access immediately"
    );
    pad(&c, "notes", "replacement").await;
    a.restart(&[]);
    let c = a.client().await;
    assert_eq!(
        call(&c, "deliverable.resolve", id).await,
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert_eq!(list_all(&c).await, json!([p]));
}
#[tokio::test]
async fn dv3_no_substitution() {
    let mut a = daemon::start(&[]);
    let c = a.client().await;
    let db = rusqlite::Connection::open(a.data_dir().join("project.db")).unwrap();
    let mut records = Vec::new();
    for (key, cause) in [
        ("corrupt", "integrity-failure"),
        ("missing", "missing-revision"),
    ] {
        call(&c, "pad.create", json!({"name":key,"text":"original"})).await;
        let p = call(
            &c,
            "deliverable.publish",
            json!({"key":key,"title":"equal title","target":pad_target(&c,key,1).await}),
        )
        .await;
        let path = a
            .data_dir()
            .join("publication-files")
            .join(p["id"].as_str().unwrap());
        if key == "corrupt" {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
            std::fs::write(&path, b"corrupt!").unwrap();
        } else {
            std::fs::remove_file(&path).unwrap();
        }
        // A selected reference cannot acquire a fallback BLOB, even after file loss.
        assert!(
            db.execute(
                "INSERT INTO deliverable_bytes VALUES (?1,?2)",
                rusqlite::params![p["id"].as_str().unwrap(), b"original"]
            )
            .is_err()
        );
        std::fs::write(a.dir.path().join(key), "substitute file").unwrap();
        call(&c, "pad.write", json!({"name":key,"text":"substitute"})).await;
        let id = identity(&p);
        assert_eq!(
            call(&c, "deliverable.resolve", id.clone()).await,
            json!({"kind":"unavailable","cause":cause})
        );
        assert_eq!(call(&c, "deliverable.get", id).await, p);
        records.push((p, cause));
    }
    a.restart(&[]);
    let c = a.client().await;
    for (record, cause) in records {
        let id = identity(&record);
        assert_eq!(call(&c, "deliverable.get", id.clone()).await, record);
        assert_eq!(
            call(&c, "deliverable.resolve", id).await,
            json!({"kind":"unavailable","cause":cause})
        );
    }
}
#[tokio::test]
async fn dv3_external_target() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    let url = "https://EXAMPLE.com/Case/../pr/42?x=%2F#Revision";
    let p = call(
        &c,
        "deliverable.publish",
        json!({"key":"url","title":"PR","target":{"kind":"external","url":url}}),
    )
    .await;
    assert_eq!(
        call(&c, "deliverable.resolve", identity(&p)).await,
        json!({"kind":"external","url":url,"availability":"not-checked"})
    );
    for url in [
        "file:///etc/passwd",
        "roundup://other",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ] {
        refused(
            &c,
            "deliverable.publish",
            json!({"key":url,"title":"PR","target":{"kind":"external","url":url}}),
        )
        .await;
    }
}

#[tokio::test]
async fn dv1_only_explicit_publication() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    std::fs::write(a.dir.path().join("scratch.md"), "scratch").unwrap();
    pad(&c, "scratch", "unpublished").await;
    call(
        &c,
        "pad.write",
        json!({"name":"scratch","text":"still unpublished"}),
    )
    .await;
    let t = call(&c, "todo.create", json!({"title":"scratch"})).await;
    call(&c, "todo.complete", json!({"id":t["id"]})).await;
    let terminal=call(&c,"terminal.spawn",json!({"cwd":a.dir.path(),"command":["/bin/sh","-c","printf 'unpublished result'"],"env":{},"cols":80,"rows":24})).await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let output = call(&c, "terminal.read", json!({"id":terminal["id"],"after":0})).await;
            if output["text"]
                .as_str()
                .unwrap()
                .contains("unpublished result")
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("Terminal emitted its unregistered output");
    assert_eq!(list_all(&c).await, json!([]));
    call(
        &c,
        "deliverable.publish",
        json!({"key":"deliberate","title":"Result","target":pad_target(&c,"scratch",2).await}),
    )
    .await;
    assert_eq!(list_all(&c).await.as_array().unwrap().len(), 1);
}

#[allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

async fn reached(path: &std::path::Path) {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while !path.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("Daemon acknowledged publication boundary");
}

async fn crash_replay(stages: &[&str], committed: bool) {
    for &stage in stages {
        let observation = tempfile::tempdir().unwrap();
        let env = [
            ("RUPD_PUBLICATION_PAUSE", stage),
            (
                "RUPD_PUBLICATION_OBSERVER",
                observation.path().to_str().unwrap(),
            ),
        ];
        let mut p = daemon::start(&env);
        let c = p.client().await;
        pad(&c, "notes", "one allocation").await;
        let request =
            json!({"key":"once","title":"Result","target":pad_target(&c,"notes",1).await});
        let copy = request.clone();
        let pending = tokio::spawn(async move { c.request("deliverable.publish", copy).await });
        reached(&observation.path().join(stage)).await;
        p.restart(&[]);
        assert!(
            pending.await.unwrap().is_err(),
            "interruption has no acknowledgement"
        );
        let c = p.client().await;
        let list = list_all(&c).await;
        assert_eq!(list.as_array().unwrap().len(), usize::from(committed));
        let record = call(&c, "deliverable.publish", request.clone()).await;
        assert_eq!(
            call(&c, "deliverable.publish", request.clone()).await,
            record
        );
        assert_eq!(list_all(&c).await, json!([record]));
        let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
        let (count, bytes): (i64, i64) = db
            .query_row(
                "SELECT count(*),sum(length) FROM deliverable_files",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, bytes), (1, 14));
        assert_eq!(retained(&c, &record).await, b"one allocation");
        let files = p.data_dir().join("publication-files");
        assert_eq!(std::fs::read_dir(files.join("pending")).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(files).unwrap().count(), 2);
        let mut conflicting = request;
        conflicting["title"] = json!("another request");
        refused(&c, "deliverable.publish", conflicting).await;
    }
}
#[tokio::test]
async fn dv2_publish_replay() {
    crash_replay(&["before_commit"], false).await;
    crash_replay(&["after_commit", "before_cleanup", "before_reply"], true).await;
}
#[tokio::test]
async fn r3778c_pending_file_recovery() {
    crash_replay(
        &[
            "before_file_sync",
            "after_file_sync",
            "after_directory_sync",
        ],
        false,
    )
    .await;
}

#[tokio::test]
async fn dv4_removal_replay() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    pad(&c, "notes", "remove these bytes").await;
    let request = json!({"key":"removed","title":"Result","target":pad_target(&c,"notes",1).await});
    let record = call(&c, "deliverable.publish", request.clone()).await;
    let id = identity(&record);
    let r = call(&c, "deliverable.resolve", id.clone()).await;
    let cache = std::path::PathBuf::from(r["path"].as_str().unwrap());
    call(&c, "deliverable.remove", id.clone()).await;
    assert!(!cache.exists());
    p.restart(&[]);
    let c = p.client().await;
    refused(&c, "deliverable.publish", request.clone()).await;
    refused(&c, "deliverable.get", id.clone()).await;
    refused(&c, "deliverable.resolve", id).await;
    assert_eq!(list_all(&c).await, json!([]));
    let mut fresh = request;
    fresh["key"] = json!("new deliberation");
    let next = call(&c, "deliverable.publish", fresh).await;
    assert_ne!(record["id"], next["id"]);
}

#[tokio::test]
async fn dv2_publish_failures() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    pad(&c, "notes", "v").await;
    refused(
        &c,
        "deliverable.publish",
        json!({"key":"stale","title":"stale","target":pad_target(&c,"notes",2).await}),
    )
    .await;
    let source = p.dir.path().join("large.bin");
    std::fs::write(&source, vec![0; 32 * 1024 * 1024 + 1]).unwrap();
    let file = json!({"key":"large","title":"large","target":{"kind":"file","path":"large.bin"}});
    refused(&c, "deliverable.publish", file.clone()).await;
    std::fs::write(&source, vec![0; 32 * 1024 * 1024]).unwrap();
    let first = call(&c, "deliverable.publish", file).await;
    for n in 1..32 {
        call(&c,"deliverable.publish",json!({"key":format!("large-{n}"),"title":"large","target":{"kind":"file","path":"large.bin"}})).await;
    }
    // Exactly the Project quota is retained; another byte cannot evict any publication.
    refused(
        &c,
        "deliverable.publish",
        json!({"key":"over-quota","title":"notes","target":pad_target(&c,"notes",1).await}),
    )
    .await;
    let list = list_all(&c).await;
    assert_eq!(list.as_array().unwrap().len(), 32);
    assert_eq!(list[0], first);
    p.restart(&[]);
    let c = p.client().await;
    assert_eq!(list_all(&c).await, list);
    let expected = "83ee47245398adee79bd9c0a8bc57b821e92aba10f5f9ade8a5d1fae4d8c4302";
    for record in list.as_array().unwrap() {
        let r = call(&c, "deliverable.resolve", identity(record)).await;
        let bytes = std::fs::read(r["path"].as_str().unwrap()).unwrap();
        assert_eq!(bytes.len(), 32 * 1024 * 1024);
        assert!(bytes == vec![0u8; bytes.len()]); // one memcmp; a per-byte scan is slow unoptimised
        assert_eq!(record["target"]["sha256"], expected);
        assert_eq!(r["sha256"], record["target"]["sha256"]);
    }
}

#[tokio::test]
async fn dv2_changed_capture() {
    let observation = tempfile::tempdir().unwrap();
    let p = daemon::start(&[
        ("RUPD_PUBLICATION_PAUSE", "captured"),
        (
            "RUPD_PUBLICATION_OBSERVER",
            observation.path().to_str().unwrap(),
        ),
    ]);
    std::fs::write(p.dir.path().join("result"), "first").unwrap();
    let c = p.client().await;
    let pending = tokio::spawn(async move {
        c.request(
            "deliverable.publish",
            json!({"key":"changed","title":"Result","target":{"kind":"file","path":"result"}}),
        )
        .await
    });
    reached(&observation.path().join("captured")).await;
    std::fs::write(p.dir.path().join("result"), "other").unwrap();
    std::fs::write(observation.path().join("release"), b"go").unwrap();
    assert!(pending.await.unwrap().is_err());
    assert_eq!(
        p.client()
            .await
            .request("deliverable.list", json!({}))
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn dv4_home_lifecycle() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    let home = call(&c, "rail.createWorkstream", json!({"name":"Maker"})).await["id"].clone();
    call(
        &c,
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":home,"parent":null}}),
    )
    .await;
    pad(&c, "notes", "first").await;
    std::fs::write(p.dir.path().join("result"), "F1").unwrap();
    let mut publications = Vec::new();
    for (key, target) in [
        ("pad", pad_target(&c, "notes", 1).await),
        ("file", json!({"kind":"file","path":"result"})),
    ] {
        let record = call(
            &c,
            "deliverable.publish",
            json!({"key":key,"title":"Result","target":target}),
        )
        .await;
        assert_eq!(record["maker"]["id"], home);
        assert_eq!(record["maker_name"], "Maker");
        assert_eq!(record["home"], home);
        publications.push(record);
    }
    call(&c, "pad.write", json!({"name":"notes","text":"second"})).await;
    let user = p.client().await;
    call(&user, "rail.remove", json!({"id":home})).await;
    p.restart(&[]);
    let user = p.client().await;
    for mut record in publications {
        let id = identity(&record);
        record["home"] = Value::Null;
        assert_eq!(call(&user, "deliverable.get", id.clone()).await, record);
        let resolved = call(&user, "deliverable.resolve", id).await;
        let expected = if record["target"]["kind"] == "pad" {
            "first"
        } else {
            "F1"
        };
        assert_eq!(
            std::fs::read_to_string(resolved["path"].as_str().unwrap()).unwrap(),
            expected
        );
    }
    assert_eq!(
        call(&user, "deliverable.list", json!({"home":home})).await,
        json!([])
    );
}

#[tokio::test]
async fn dv4_cached_access() {
    use std::os::unix::fs::PermissionsExt;
    let mut p = daemon::start(&[]);
    let source = p.dir.path().join("result.txt");
    std::fs::write(&source, "retained").unwrap();
    let c = p.client().await;
    let record = call(
        &c,
        "deliverable.publish",
        json!({"key":"access","title":"Result","target":{"kind":"file","path":"result.txt"}}),
    )
    .await;
    let id = identity(&record);
    let opened = call(&c, "deliverable.resolve", id.clone()).await;
    let cache = std::path::PathBuf::from(opened["path"].as_str().unwrap());
    assert_eq!(std::fs::read(&cache).unwrap(), b"retained");
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o0)).unwrap();
    assert_eq!(
        call(&c, "deliverable.resolve", id.clone()).await,
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert!(!cache.exists());
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
    p.restart(&[]);
    let c = p.client().await;
    assert_eq!(
        call(&c, "deliverable.resolve", id).await,
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert_eq!(list_all(&c).await, json!([record]));
}

#[tokio::test]
async fn dv3_file_recreation_revokes_identity() {
    let mut p = daemon::start(&[]);
    let source = p.dir.path().join("same.txt");
    std::fs::write(&source, "original").unwrap();
    let c = p.client().await;
    let record = call(
        &c,
        "deliverable.publish",
        json!({"key":"original","title":"Result","target":{"kind":"file","path":"same.txt"}}),
    )
    .await;
    // Keeping the original inode open also makes this probe independent of inode reuse timing.
    let _original = std::fs::File::open(&source).unwrap();
    std::fs::remove_file(&source).unwrap();
    std::fs::write(&source, "replacement").unwrap();
    p.restart(&[]);
    let c = p.client().await;
    assert_eq!(
        call(&c, "deliverable.resolve", identity(&record)).await,
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert_eq!(list_all(&c).await, json!([record]));
}

#[tokio::test]
async fn r3778c_file_failure_has_no_publication() {
    for operation in [
        "parent_sync",
        "pending_parent_sync",
        "write",
        "file_sync",
        "link",
        "directory_sync",
    ] {
        let mut p = daemon::start(&[]);
        let c = p.client().await;
        pad(&c, "notes", "durable bytes").await;
        let request =
            json!({"key":"retry","title":"Result","target":pad_target(&c,"notes",1).await});
        let mut previous = request.clone();
        previous["key"] = json!("existing");
        let existing = call(&c, "deliverable.publish", previous).await;
        p.restart(&[("RUPD_PUBLICATION_FAIL", operation)]);
        let c = p.client().await;
        assert!(
            c.request("deliverable.publish", request.clone())
                .await
                .is_err(),
            "{operation}"
        );
        assert_eq!(list_all(&c).await, json!([existing]));
        assert_eq!(retained(&c, &existing).await, b"durable bytes");
        let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
        assert_eq!(
            db.query_row("SELECT sum(length) FROM deliverable_files", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            13
        );
        p.restart(&[]);
        let c = p.client().await;
        let r = call(&c, "deliverable.publish", request.clone()).await;
        assert_eq!(call(&c, "deliverable.publish", request).await, r);
        assert_eq!(retained(&c, &r).await, b"durable bytes");
    }
}

#[tokio::test]
async fn r3778c_removed_file_cleanup() {
    for operation in ["unlink", "removal_sync"] {
        let mut p = daemon::start(&[]);
        let c = p.client().await;
        pad(&c, "notes", "keep quota until cleanup").await;
        let request =
            json!({"key":"removed","title":"Result","target":pad_target(&c,"notes",1).await});
        let record = call(&c, "deliverable.publish", request.clone()).await;
        let mut next = request.clone();
        next["key"] = json!("other");
        let survivor = call(&c, "deliverable.publish", next.clone()).await;
        p.restart(&[("RUPD_PUBLICATION_FAIL", operation)]);
        let c = p.client().await;
        let id = identity(&record);
        refused(&c, "deliverable.remove", id.clone()).await;
        refused(&c, "deliverable.resolve", id).await;
        let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
        assert_eq!(
            db.query_row("SELECT sum(length) FROM deliverable_files", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            48
        );
        p.restart(&[]);
        let c = p.client().await;
        refused(&c, "deliverable.publish", request).await;
        next["key"] = json!("after cleanup");
        call(&c, "deliverable.publish", next).await;
        let r = call(&c, "deliverable.resolve", identity(&survivor)).await;
        assert_eq!(
            std::fs::read(r["path"].as_str().unwrap()).unwrap(),
            b"keep quota until cleanup"
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM deliverable_files WHERE id=?1",
                [record["id"].as_str().unwrap()],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn r3778c_current_revisions_reopen() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    pad(&c, "notes", "legacy revision").await;
    let request = json!({"key":"legacy","title":"Result","target":pad_target(&c,"notes",1).await});
    let legacy = call(&c, "deliverable.publish", request).await;
    let c = p.client().await;
    call(
        &c,
        "pad.write",
        json!({"name":"notes","text":"new revision"}),
    )
    .await;
    let new = call(
        &c,
        "deliverable.publish",
        json!({"key":"new","title":"Result","target":pad_target(&c,"notes",2).await}),
    )
    .await;
    for _ in 0..2 {
        p.restart(&[]);
        let c = p.client().await;
        for (record, bytes) in [
            (&legacy, b"legacy revision".as_slice()),
            (&new, b"new revision".as_slice()),
        ] {
            assert_eq!(retained(&c, record).await, bytes);
            assert_eq!(call(&c, "deliverable.get", identity(record)).await, *record);
        }
    }
}

#[tokio::test]
async fn r3778d_publication_with_public_reads_and_writes() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    let old = pad(&c, "pinned", "old snapshot").await;
    let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
    db.execute_batch("BEGIN").unwrap();
    let before: String = db
        .query_row("SELECT text FROM pads WHERE name='pinned'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let socket = p.socket().to_owned();
    let publishing = tokio::spawn(async move {
        let c = rpc::Client::connect(&socket).await.unwrap();
        for n in 0..8 {
            call(&c,"deliverable.publish",json!({"key":n.to_string(),"title":"Result","target":{"kind":"pad","name":"pinned","incarnation":old["incarnation"],"revision":1}})).await;
        }
    });
    let c2 = p.client().await;
    let writing = tokio::spawn(async move {
        for n in 0..8 {
            call(
                &c2,
                "pad.create",
                json!({"name":format!("new-{n}"),"text":"concurrent revision"}),
            )
            .await;
            call(&c2, "todo.create", json!({"title":format!("Todo {n}")})).await;
            for method in ["rail.tree", "pad.list"] {
                call(&c2, method, json!({})).await;
            }
        }
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        publishing.await.unwrap();
        writing.await.unwrap();
    })
    .await
    .unwrap();
    call(
        &c,
        "pad.write",
        json!({"name":"pinned","text":"new snapshot"}),
    )
    .await;
    assert_eq!(
        db.query_row("SELECT text FROM pads WHERE name='pinned'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        before
    );
    db.execute_batch("ROLLBACK").unwrap();
    let records = list_all(&c).await;
    let events: Vec<String> = {
        let mut s = db.prepare("SELECT event FROM events ORDER BY id").unwrap();
        s.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert!(!events.is_empty());
    p.restart(&[]);
    let c = p.client().await;
    assert_eq!(list_all(&c).await, records);
    assert_eq!(
        call(&c, "pad.read", json!({"name":"pinned"})).await["text"],
        "new snapshot"
    );
    for r in records.as_array().unwrap() {
        assert_eq!(retained(&c, r).await, b"old snapshot");
    }
    let reopened = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
    let mut s = reopened
        .prepare("SELECT event FROM events ORDER BY id")
        .unwrap();
    assert_eq!(
        s.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap(),
        events
    );
}

#[tokio::test]
async fn r3778c_durable_reference_order() {
    let trace = tempfile::NamedTempFile::new().unwrap();
    let p = daemon::start(&[("RUPD_PUBLICATION_TRACE", trace.path().to_str().unwrap())]);
    let c = p.client().await;
    pad(&c, "notes", "durable").await;
    call(
        &c,
        "deliverable.publish",
        json!({"key":"ordered","title":"Result","target":pad_target(&c,"notes",1).await}),
    )
    .await;
    let stages = std::fs::read_to_string(trace.path()).unwrap();
    assert_eq!(
        stages
            .lines()
            .map(|line| line.split_once(' ').unwrap().0)
            .collect::<Vec<_>>()
            .join(" "),
        "capture_start hashed metadata_inserted parent_synced pending_directory_synced before_file_sync after_file_sync after_directory_sync before_commit after_commit before_cleanup pending_directory_synced before_reply"
    );
}

async fn publish_bytes(
    directory: &std::path::Path,
    c: &rpc::Client,
    key: &str,
    length: usize,
    byte: u8,
) -> Value {
    std::fs::write(directory.join("quota.bin"), vec![byte; length]).unwrap();
    call(
        c,
        "deliverable.publish",
        json!({"key":key,"title":key,"target":{"kind":"file","path":"quota.bin"}}),
    )
    .await
}

// Keep the quota cases on the current file-only schema.
mod quota {
    use super::*;

    async fn current_quota(p: &mut daemon::Project) -> Vec<(Value, usize, u8)> {
        // Project-local, read only by test-support builds; retained across fixture restarts.
        std::fs::write(p.data_dir().join("test-publication-quota"), "64").unwrap();
        p.restart(&[]);
        let c = p.client().await;
        // Pad sources avoid making historical access depend on the reused file capture path.
        pad(&c, "legacy-a", "aaaaaaa").await;
        pad(&c, "legacy-b", "bbbbbbbbbbb").await;
        let mut records = Vec::new();
        for (name, length, byte) in [("legacy-a", 7, b'a'), ("legacy-b", 11, b'b')] {
            let record = call(
                &c,
                "deliverable.publish",
                json!({"key":name,"title":name,"target":pad_target(&c,name,1).await}),
            )
            .await;
            records.push((record, length, byte));
        }
        let c = p.client().await;
        records.push((
            publish_bytes(p.dir.path(), &c, "chosen-file", 13, b'c').await,
            13,
            b'c',
        ));
        records.push((
            publish_bytes(p.dir.path(), &c, "fill", 33, b'd').await,
            33,
            b'd',
        ));
        records
    }

    fn allocation_bytes(p: &daemon::Project) -> i64 {
        let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
        let mut files = db
            .prepare("SELECT id,length FROM deliverable_files")
            .unwrap();
        let files = files
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .unwrap();
        files
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

    async fn refuses_one_byte(p: &daemon::Project, c: &rpc::Client, records: &[(Value, usize, u8)]) {
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
        let mut p = daemon::start(&[]);
        let records = current_quota(&mut p).await;
        let c = p.client().await;
        assert_eq!(allocation_bytes(&p), 64);
        refuses_one_byte(&p, &c, &records).await;
        p.restart(&[]);
        let c = p.client().await;
        exact_publications(&c, &records).await;
        assert_eq!(allocation_bytes(&p), 64);
    }

    #[tokio::test]
    async fn r4160b_cleanup_releases_only_chosen_bytes() {
        for chosen in [0, 2] {
            let mut p = daemon::start(&[]);
            let mut records = current_quota(&mut p).await;
            let c = p.client().await;
            assert_eq!(allocation_bytes(&p), 64);
            let (removed, length, _) = records.remove(chosen);
            let id = identity(&removed);
            call(&c, "deliverable.remove", id.clone()).await;
            for step in 0..4 {
                if step == 2 {
                    p.restart(&[]);
                }
                let c = p.client().await;
                if step == 1 || step == 3 {
                    refused(&c, "deliverable.remove", id.clone()).await;
                }
                refused(&c, "deliverable.get", id.clone()).await;
                refused(&c, "deliverable.resolve", id.clone()).await;
                assert_eq!(allocation_bytes(&p), 64 - i64::try_from(length).unwrap());
                let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
                assert_eq!(
                    db.query_row(
                        "SELECT count(*) FROM deliverable_files WHERE id=?1",
                        [removed["id"].as_str().unwrap()],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                    0
                );
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
}
