//! DV1–DV4: deliberately published results through the real Project Daemon.
#[path = "common/served.rs"]
mod common;
use serde_json::{Value, json};

#[tokio::test]
async fn dv1_publication_identity() {
    let mut projects = Vec::new();
    let mut all = Vec::new();
    for _ in 0..2 {
        let p = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
        let c = rpc::Client::connect(&p.socket()).await.unwrap();
        let home = c
            .request("rail.createWorkstream", json!({"name":"Maker"}))
            .await
            .unwrap()["id"]
            .clone();
        c.request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":home,"parent":null}}),
        )
        .await
        .unwrap();
        c.request("pad.create", json!({"name":"notes","text":"revision one"}))
            .await
            .unwrap();
        std::fs::write(p.dir.path().join("result.txt"), "retained file").unwrap();
        let mut records = Vec::new();
        for (key, target) in [
            ("pad", json!({"kind":"pad","name":"notes","revision":1})),
            ("file", json!({"kind":"file","path":"result.txt"})),
            (
                "external",
                json!({"kind":"external","url":"https://example.com/pr/1"}),
            ),
        ] {
            let request = json!({"key":key,"title":"Result","target":target});
            let r = c
                .request("deliverable.publish", request.clone())
                .await
                .unwrap();
            assert_eq!(r["maker"]["id"], home);
            assert_eq!(r["maker_name"], "Maker");
            assert_eq!(r["home"], home);
            assert_eq!(r["title"], "Result");
            assert_eq!(r["target"]["kind"], key);
            assert_eq!(c.request("deliverable.publish", request).await.unwrap(), r);
            assert!(
                !records
                    .iter()
                    .any(|previous: &Value| previous["id"] == r["id"])
            );
            records.push(r);
        }
        assert_eq!(
            c.request("deliverable.list", json!({})).await.unwrap(),
            json!(records)
        );
        all.push(records);
        projects.push(p);
    }
    assert_ne!(all[0][0]["project"], all[1][0]["project"]);
    let c = rpc::Client::connect(&projects[0].socket()).await.unwrap();
    for r in &all[1] {
        for method in ["deliverable.get", "deliverable.resolve"] {
            assert!(
                c.request(method, json!({"project":r["project"],"id":r["id"]}))
                    .await
                    .is_err()
            );
            assert!(
                c.request(method, json!({"project":all[0][0]["project"],"id":r["id"]}))
                    .await
                    .is_err()
            );
        }
    }
}

#[tokio::test]
async fn dv1_publication_authority() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    std::fs::write(a.dir.path().join("result.txt"), "F1").unwrap();
    let file =
        json!({"key":"file-1","title":"Result","target":{"kind":"file","path":"result.txt"}});
    let p = c
        .request("deliverable.publish", file.clone())
        .await
        .unwrap();
    std::fs::write(a.dir.path().join("result.txt"), "F2").unwrap();
    let r = c
        .request(
            "deliverable.resolve",
            json!({"project":p["project"],"id":p["id"]}),
        )
        .await
        .unwrap();
    assert_eq!(std::fs::read(r["path"].as_str().unwrap()).unwrap(), b"F1");
    assert_eq!(c.request("deliverable.publish", file).await.unwrap(), p);
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret"), "protected").unwrap();
    std::os::unix::fs::symlink(outside.path(), a.dir.path().join("escape")).unwrap();
    std::os::unix::fs::symlink(
        a.dir.path().join(".roundup"),
        a.dir.path().join("internal-escape"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        a.dir.path().join(".roundup/project.db"),
        a.dir.path().join("internal-file"),
    )
    .unwrap();
    std::fs::write(a.dir.path().join("unreadable"), "protected").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        a.dir.path().join("unreadable"),
        std::fs::Permissions::from_mode(0o0),
    )
    .unwrap();
    for path in [
        "../secret",
        "escape/secret",
        "internal-escape/project.db",
        "internal-file",
        "unreadable",
        "escape",
        ".roundup/project.db",
        "/etc/passwd",
    ] {
        assert!(
            c.request(
                "deliverable.publish",
                json!({"key":path,"title":"forbidden","target":{"kind":"file","path":path}})
            )
            .await
            .is_err(),
            "{path}"
        );
    }
    assert!(c.request("deliverable.publish",json!({"key":"spoof","title":"spoof","maker":{"kind":"agent","id":"other"},"target":{"kind":"external","url":"https://example.com"}})).await.is_err());
    assert_eq!(
        c.request("deliverable.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn dv4_user_home_wins() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    let home = c
        .request("rail.createWorkstream", json!({"name":"Review"}))
        .await
        .unwrap()["id"]
        .clone();
    let original = c
        .request("rail.createWorkstream", json!({"name":"Original"}))
        .await
        .unwrap()["id"]
        .clone();
    let maker = rpc::Client::connect(&a.socket()).await.unwrap();
    maker
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":original,"parent":null}}),
        )
        .await
        .unwrap();
    let request = json!({"key":"home","title":"Result","target":{"kind":"external","url":"https://example.com/pr/1"}});
    let p = maker
        .request("deliverable.publish", request.clone())
        .await
        .unwrap();
    let moved = c
        .request(
            "deliverable.move",
            json!({"project":p["project"],"id":p["id"],"home":home}),
        )
        .await
        .unwrap();
    assert_eq!(moved["home"], home);
    assert_eq!(
        maker.request("deliverable.publish", request).await.unwrap(),
        moved
    );
    assert_eq!(
        c.request("deliverable.list", json!({"home":home}))
            .await
            .unwrap(),
        json!([moved])
    );
    assert!(
        maker
            .request(
                "deliverable.move",
                json!({"project":p["project"],"id":p["id"],"home":original})
            )
            .await
            .is_err()
    );
    assert_eq!(
        c.request("deliverable.list", json!({"home":original}))
            .await
            .unwrap(),
        json!([])
    );
    let touches = c
        .request(
            "provenance.history",
            json!({"item":format!("deliverable:{}",p["id"].as_str().unwrap())}),
        )
        .await
        .unwrap();
    assert_eq!(touches.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn dv3_revoked_access() {
    let mut a = daemon::start(&[]);
    let c = a.client().await;
    c.request("pad.create", json!({"name":"notes","text":"retained"}))
        .await
        .unwrap();
    let request =
        json!({"key":"notes","title":"notes","target":{"kind":"pad","name":"notes","revision":1}});
    let p = c.request("deliverable.publish", request).await.unwrap();
    let id = json!({"project":p["project"],"id":p["id"]});
    let opened = c.request("deliverable.resolve", id.clone()).await.unwrap();
    let path = std::path::Path::new(opened["path"].as_str().unwrap());
    assert!(path.is_file());
    c.request("pad.delete", json!({"name":"notes"}))
        .await
        .unwrap();
    assert!(
        !path.exists(),
        "source deletion invalidates cached access immediately"
    );
    c.request("pad.create", json!({"name":"notes","text":"replacement"}))
        .await
        .unwrap();
    a.restart(&[]);
    let c = a.client().await;
    assert_eq!(
        c.request("deliverable.resolve", id).await.unwrap(),
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert_eq!(
        c.request("deliverable.list", json!({})).await.unwrap(),
        json!([p])
    );
}

#[tokio::test]
async fn dv3_no_substitution() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    let db = rusqlite::Connection::open(a.dir.path().join(".roundup/project.db")).unwrap();
    for (key, mutation, cause) in [
        (
            "corrupt",
            "UPDATE deliverable_bytes SET bytes=x'00' WHERE id=?1",
            "integrity-failure",
        ),
        (
            "missing",
            "DELETE FROM deliverable_bytes WHERE id=?1",
            "missing-revision",
        ),
    ] {
        c.request("pad.create", json!({"name":key,"text":"original"}))
            .await
            .unwrap();
        let p=c.request("deliverable.publish",json!({"key":key,"title":"equal title","target":{"kind":"pad","name":key,"revision":1}})).await.unwrap();
        db.execute(mutation, [p["id"].as_str().unwrap()]).unwrap();
        c.request("pad.write", json!({"name":key,"text":"substitute"}))
            .await
            .unwrap();
        let id = json!({"project":p["project"],"id":p["id"]});
        assert_eq!(
            c.request("deliverable.resolve", id.clone()).await.unwrap(),
            json!({"kind":"unavailable","cause":cause})
        );
        assert_eq!(c.request("deliverable.get", id).await.unwrap(), p);
    }
}

#[tokio::test]
async fn dv3_external_target() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    let url = "https://EXAMPLE.com/Case/../pr/42?x=%2F#Revision";
    let p = c
        .request(
            "deliverable.publish",
            json!({"key":"url","title":"PR","target":{"kind":"external","url":url}}),
        )
        .await
        .unwrap();
    assert_eq!(
        c.request(
            "deliverable.resolve",
            json!({"project":p["project"],"id":p["id"]})
        )
        .await
        .unwrap(),
        json!({"kind":"external","url":url,"availability":"not-checked"})
    );
    for url in [
        "file:///etc/passwd",
        "roundup://other",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ] {
        assert!(
            c.request(
                "deliverable.publish",
                json!({"key":url,"title":"PR","target":{"kind":"external","url":url}})
            )
            .await
            .is_err()
        );
    }
}

#[tokio::test]
async fn dv1_only_explicit_publication() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let c = rpc::Client::connect(&a.socket()).await.unwrap();
    std::fs::write(a.dir.path().join("scratch.md"), "scratch").unwrap();
    c.request("pad.create", json!({"name":"scratch","text":"unpublished"}))
        .await
        .unwrap();
    c.request(
        "pad.write",
        json!({"name":"scratch","text":"still unpublished"}),
    )
    .await
    .unwrap();
    let t = c
        .request("todo.create", json!({"title":"scratch"}))
        .await
        .unwrap();
    c.request("todo.complete", json!({"id":t["id"]}))
        .await
        .unwrap();
    assert_eq!(
        c.request("deliverable.list", json!({})).await.unwrap(),
        json!([])
    );
    c.request("deliverable.publish",json!({"key":"deliberate","title":"Result","target":{"kind":"pad","name":"scratch","revision":2}})).await.unwrap();
    assert_eq!(
        c.request("deliverable.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

// The shared real-process fixture exposes helpers used by other integration targets.
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

#[tokio::test]
async fn dv2_publish_replay() {
    for stage in ["before_commit", "after_commit"] {
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
        c.request(
            "pad.create",
            json!({"name":"notes","text":"one allocation"}),
        )
        .await
        .unwrap();
        let request = json!({"key":"once","title":"Result","target":{"kind":"pad","name":"notes","revision":1}});
        let copy = request.clone();
        let pending = tokio::spawn(async move { c.request("deliverable.publish", copy).await });
        reached(&observation.path().join(stage)).await;
        p.restart(&[]);
        assert!(
            pending.await.unwrap().is_err(),
            "interruption has no acknowledgement"
        );
        let c = p.client().await;
        let list = c.request("deliverable.list", json!({})).await.unwrap();
        assert_eq!(
            list.as_array().unwrap().len(),
            usize::from(stage == "after_commit")
        );
        let record = c
            .request("deliverable.publish", request.clone())
            .await
            .unwrap();
        assert_eq!(
            c.request("deliverable.publish", request.clone())
                .await
                .unwrap(),
            record
        );
        assert_eq!(
            c.request("deliverable.list", json!({})).await.unwrap(),
            json!([record])
        );
        let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
        let (count, bytes): (i64, i64) = db
            .query_row(
                "SELECT count(*),sum(length(bytes)) FROM deliverable_bytes",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, bytes), (1, 14));
        let mut conflicting = request;
        conflicting["title"] = json!("another request");
        assert!(c.request("deliverable.publish", conflicting).await.is_err());
    }
}

#[tokio::test]
async fn dv4_removal_replay() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    c.request(
        "pad.create",
        json!({"name":"notes","text":"remove these bytes"}),
    )
    .await
    .unwrap();
    let request = json!({"key":"removed","title":"Result","target":{"kind":"pad","name":"notes","revision":1}});
    let record = c
        .request("deliverable.publish", request.clone())
        .await
        .unwrap();
    let id = json!({"project":record["project"],"id":record["id"]});
    let r = c.request("deliverable.resolve", id.clone()).await.unwrap();
    let cache = std::path::PathBuf::from(r["path"].as_str().unwrap());
    c.request("deliverable.remove", id.clone()).await.unwrap();
    assert!(!cache.exists());
    p.restart(&[]);
    let c = p.client().await;
    assert!(
        c.request("deliverable.publish", request.clone())
            .await
            .is_err()
    );
    assert!(c.request("deliverable.get", id.clone()).await.is_err());
    assert!(c.request("deliverable.resolve", id).await.is_err());
    assert_eq!(
        c.request("deliverable.list", json!({})).await.unwrap(),
        json!([])
    );
    let db = rusqlite::Connection::open(p.data_dir().join("project.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM deliverable_bytes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let mut fresh = request;
    fresh["key"] = json!("new deliberation");
    let next = c.request("deliverable.publish", fresh).await.unwrap();
    assert_ne!(record["id"], next["id"]);
}

#[tokio::test]
async fn dv2_publish_failures() {
    let p = daemon::start(&[]);
    let c = p.client().await;
    c.request("pad.create", json!({"name":"notes","text":"v1"}))
        .await
        .unwrap();
    assert!(c.request("deliverable.publish",json!({"key":"stale","title":"stale","target":{"kind":"pad","name":"notes","revision":2}})).await.is_err());
    let source = p.dir.path().join("large.bin");
    std::fs::write(&source, vec![0; 32 * 1024 * 1024 + 1]).unwrap();
    let file = json!({"key":"large","title":"large","target":{"kind":"file","path":"large.bin"}});
    assert!(
        c.request("deliverable.publish", file.clone())
            .await
            .is_err()
    );
    std::fs::write(&source, vec![0; 32 * 1024 * 1024]).unwrap();
    let first = c.request("deliverable.publish", file).await.unwrap();
    for n in 1..32 {
        c.request("deliverable.publish",json!({"key":format!("large-{n}"),"title":"large","target":{"kind":"file","path":"large.bin"}})).await.unwrap();
    }
    // Exactly the Project quota is retained; another byte cannot evict any publication.
    assert!(c.request("deliverable.publish",json!({"key":"over-quota","title":"notes","target":{"kind":"pad","name":"notes","revision":1}})).await.is_err());
    let list = c.request("deliverable.list", json!({})).await.unwrap();
    assert_eq!(list.as_array().unwrap().len(), 32);
    assert_eq!(list[0], first);
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
    let home = c
        .request("rail.createWorkstream", json!({"name":"Maker"}))
        .await
        .unwrap()["id"]
        .clone();
    c.request(
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":home,"parent":null}}),
    )
    .await
    .unwrap();
    c.request("pad.create", json!({"name":"notes","text":"first"}))
        .await
        .unwrap();
    std::fs::write(p.dir.path().join("result"), "F1").unwrap();
    let mut publications = Vec::new();
    for (key, target) in [
        ("pad", json!({"kind":"pad","name":"notes","revision":1})),
        ("file", json!({"kind":"file","path":"result"})),
    ] {
        let record = c
            .request(
                "deliverable.publish",
                json!({"key":key,"title":"Result","target":target}),
            )
            .await
            .unwrap();
        assert_eq!(record["maker"]["id"], home);
        assert_eq!(record["maker_name"], "Maker");
        assert_eq!(record["home"], home);
        publications.push(record);
    }
    c.request("pad.write", json!({"name":"notes","text":"second"}))
        .await
        .unwrap();
    let user = p.client().await;
    user.request("rail.remove", json!({"id":home}))
        .await
        .unwrap();
    p.restart(&[]);
    let user = p.client().await;
    for mut record in publications {
        let id = json!({"project":record["project"],"id":record["id"]});
        record["home"] = Value::Null;
        assert_eq!(
            user.request("deliverable.get", id.clone()).await.unwrap(),
            record
        );
        let resolved = user.request("deliverable.resolve", id).await.unwrap();
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
        user.request("deliverable.list", json!({"home":home}))
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn dv1_public_cli_mcp() {
    use rmcp::ServiceExt;
    use std::process::Stdio;
    use tokio::process::Command;
    let p = daemon::start(&[]);
    let home = p
        .client()
        .await
        .request("rail.createWorkstream", json!({"name":"Reader"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let output = Command::new(env!("CARGO_BIN_EXE_rup"))
        .args([
            "--json",
            "--agent",
            &home,
            "deliverable",
            "publish",
            "cli",
            "Result",
            "--target",
            r#"{"kind":"external","url":"https://example.com/pr/42"}"#,
        ])
        .env("RUPD_SOCKET", p.socket())
        .env_remove("ROUNDUP_AGENT")
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let published: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_rup"));
    command
        .args(["mcp", &home])
        .env("RUPD_SOCKET", p.socket())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = ().serve(transport).await.unwrap();
    let tools = client.list_all_tools().await.unwrap();
    for name in [
        "deliverable_publish",
        "deliverable_list",
        "deliverable_get",
        "deliverable_resolve",
        "deliverable_move",
        "deliverable_remove",
    ] {
        assert!(tools.iter().any(|t| t.name == name));
    }
    // The public reader must preserve the Project/id pair received from the CLI writer.
    let request = rmcp::model::CallToolRequestParams::new("deliverable_resolve").with_arguments(
        json!({"project":published["project"],"id":published["id"]})
            .as_object()
            .unwrap()
            .clone(),
    );
    let result = client.call_tool(request).await.unwrap();
    assert!(!result.is_error.unwrap_or(false));
    let value: Value = serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
    assert_eq!(
        value,
        json!({"kind":"external","url":"https://example.com/pr/42","availability":"not-checked"})
    );
    client.cancel().await.unwrap();
    child.kill().await.unwrap();
    child.wait().await.unwrap();
}

#[tokio::test]
async fn dv4_cached_access() {
    use std::os::unix::fs::PermissionsExt;
    let mut p = daemon::start(&[]);
    let source = p.dir.path().join("result.txt");
    std::fs::write(&source, "retained").unwrap();
    let c = p.client().await;
    let record = c
        .request(
            "deliverable.publish",
            json!({"key":"access","title":"Result","target":{"kind":"file","path":"result.txt"}}),
        )
        .await
        .unwrap();
    let id = json!({"project":record["project"],"id":record["id"]});
    let opened = c.request("deliverable.resolve", id.clone()).await.unwrap();
    let cache = std::path::PathBuf::from(opened["path"].as_str().unwrap());
    assert_eq!(std::fs::read(&cache).unwrap(), b"retained");
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o0)).unwrap();
    assert_eq!(
        c.request("deliverable.resolve", id.clone()).await.unwrap(),
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert!(!cache.exists());
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
    p.restart(&[]);
    let c = p.client().await;
    assert_eq!(
        c.request("deliverable.resolve", id).await.unwrap(),
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert_eq!(
        c.request("deliverable.list", json!({})).await.unwrap(),
        json!([record])
    );
}

#[tokio::test]
async fn dv3_file_recreation_revokes_identity() {
    let mut p = daemon::start(&[]);
    let source = p.dir.path().join("same.txt");
    std::fs::write(&source, "original").unwrap();
    let c = p.client().await;
    let record = c
        .request(
            "deliverable.publish",
            json!({"key":"original","title":"Result","target":{"kind":"file","path":"same.txt"}}),
        )
        .await
        .unwrap();
    // Keeping the original inode open also makes this probe independent of inode reuse timing.
    let _original = std::fs::File::open(&source).unwrap();
    std::fs::remove_file(&source).unwrap();
    std::fs::write(&source, "replacement").unwrap();
    p.restart(&[]);
    let c = p.client().await;
    assert_eq!(
        c.request(
            "deliverable.resolve",
            json!({"project":record["project"],"id":record["id"]})
        )
        .await
        .unwrap(),
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    assert_eq!(
        c.request("deliverable.list", json!({})).await.unwrap(),
        json!([record])
    );
}
